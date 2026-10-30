"use strict"
/**
 * In-process BGE-M3 (B1) — dense + sparse heads via onnxruntime-node.
 *
 * This is the plugin-only path: when neither the App's embeddings service
 * (:11435) nor a llama.cpp/Ollama embedding endpoint is available, the
 * sidecar loads bge-m3-int8.onnx itself and runs BGE-M3 in this process.
 *
 * Assets:
 *   - model:  bge-m3-int8.onnx (569 MB, int8, dense+sparse heads) —
 *             downloaded from the license server via downloads.js
 *             (registry variant `bge-m3-int8`, sha256-verified)
 *   - tokenizer: tokenizer.json + config from HF `aapot/bge-m3-onnx`
 *             (~22 MB, static assets, ship them with the plugin installer;
 *             dev falls back to a direct HF fetch)
 *
 * Runtime: the engine's one ONNX runtime (onnx_runtime.js — onnxruntime-node
 * + @huggingface/tokenizers, shared with the name finder). Without it (CLI
 * tarball, Homebrew) this backend says so at once, before any download.
 *
 * Encode output matches the App's /api/hybrid shape exactly:
 *   { dense: number[1024], sparse: { indices: number[], values: number[] } }
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const { DATA_DIR } = require('./config')
const { downloadModel } = require('./downloads')
const runtime = require('./onnx_runtime')

const MODELS_DIR = path.join(DATA_DIR, 'models')
const TOK_DIR = path.join(MODELS_DIR, 'bge-m3-tokenizer')
const MODEL_PATH = () => path.join(MODELS_DIR, 'bge-m3-int8.onnx')

const VECTOR_DIM = 1024
const MAX_TOKENS = 512
// XLM-RoBERTa special tokens: <s>=0 <pad>=1 </s>=2 <unk>=3 <mask>=250001
const SPECIAL_TOKEN_IDS = new Set([0, 1, 2, 3, 250001])

// Static tokenizer assets (HF aapot/bge-m3-onnx). Tiny and immutable —
// ship with the installer; dev fetches directly.
const TOKENIZER_FILES = [
  { name: 'tokenizer.json', bytes: 17_100_000 },
  { name: 'tokenizer_config.json', bytes: 1170 },
  { name: 'config.json', bytes: 700 },
  { name: 'special_tokens_map.json', bytes: 1000 },
  { name: 'sentencepiece.bpe.model', bytes: 5_070_000 },
]
const HF_REPO = 'aapot/bge-m3-onnx'

let runtimePromise = null
// One load at a time; a failed one (no network, no runtime) may be tried again.
const runtimeReady = () => (runtimePromise ||= ensureRuntime().catch((err) => { runtimePromise = null; throw err }))
let session = null
let tokenizer = null

function downloadHfFile(name) {
  const dest = path.join(TOK_DIR, name)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const req = (u) => {
      https.get(u, { headers: { 'User-Agent': 'OpenLex-Engine' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return req(new URL(res.headers.location, u).toString())
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${name}`))
        }
        const sink = fs.createWriteStream(dest)
        res.pipe(sink)
        sink.on('finish', () => sink.close(resolve))
        sink.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    req(`https://huggingface.co/${HF_REPO}/resolve/main/${name}`)
  })
}

async function ensureRuntime() {
  if (session && tokenizer) return { session, tokenizer }
  // No runtime here: say so before downloading 569 MB that could not run.
  const ort = runtime.ort()
  // 1. Model via the normal download manager (token-gated, resumable,
  //    sha256-verified). No-op when already installed.
  await downloadModel('bge-m3-int8', {})
  // 2. Tokenizer assets — local dir first, HF fallback for dev.
  fs.mkdirSync(TOK_DIR, { recursive: true })
  await Promise.all(TOKENIZER_FILES.map((f) => downloadHfFile(f.name)))

  tokenizer = runtime.tokenizer(TOK_DIR)

  const t0 = Date.now()
  session = await ort.InferenceSession.create(MODEL_PATH(), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  })
  console.log(`[onnx-bge] session ready in ${Date.now() - t0}ms (in: ${session.inputNames.join(',')}, out: ${session.outputNames.join(',')})`)
  return { session, tokenizer }
}

/**
 * Extract dense + sparse vectors for one sequence from a session run.
 * @param {number} rowOffset  dense start index (i*1024 for batch i)
 */
function vectorsFromRun(out, ids, mask, seqLen, rowOffset = 0, batchStride = 0) {
  const denseSlice = batchStride
    ? out.dense_vecs.data.subarray(rowOffset, rowOffset + VECTOR_DIM)
    : out.dense_vecs.data
  const dense = Array.from(denseSlice)
  if (dense.length !== VECTOR_DIM) throw new Error(`unexpected dense dim ${dense.length} (expected ${VECTOR_DIM})`)
  // Sparse rows are contiguous per batch row (row i covers [i*seqLen, (i+1)*seqLen))
  const sparseStart = batchStride ? rowOffset / VECTOR_DIM * batchStride : 0
  const sparseRaw = batchStride ? out.sparse_vecs.data.subarray(sparseStart, sparseStart + seqLen) : out.sparse_vecs.data
  const sparseMap = new Map()
  for (let i = 0; i < seqLen; i++) {
    if (Number(mask[i]) === 0) continue // skip padding
    const tid = Number(ids[i])
    if (SPECIAL_TOKEN_IDS.has(tid)) continue
    const w = sparseRaw[i]
    if (w <= 0) continue
    const cur = sparseMap.get(tid)
    if (cur === undefined || w > cur) sparseMap.set(tid, w)
  }
  return {
    dense,
    sparse: { indices: Array.from(sparseMap.keys()), values: Array.from(sparseMap.values()) },
    backend: 'onnx',
  }
}

/**
 * <s> text </s>, cut to MAX_TOKENS like transformers' truncation (the text
 * is cut, the special tokens stay), as int64 tensors' data.
 */
function encodeText(tok, text) {
  const body = tok.encode(String(text ?? ''), { add_special_tokens: false }).ids.slice(0, MAX_TOKENS - 2)
  const ids = BigInt64Array.from([0, ...body, 2], (x) => BigInt(x))
  return { input_ids: { data: ids }, attention_mask: { data: new BigInt64Array(ids.length).fill(1n) } }
}

async function encodeOne(text) {
  const { session, tokenizer } = await runtimeReady()
  const enc = encodeText(tokenizer, text)
  const ort = runtime.ort()
  const ids = enc.input_ids.data
  const mask = enc.attention_mask.data
  const seqLen = ids.length
  const out = await session.run({
    input_ids: new ort.Tensor('int64', ids, [1, seqLen]),
    attention_mask: new ort.Tensor('int64', mask, [1, seqLen]),
  })
  return vectorsFromRun(out, ids, mask, seqLen)
}

/**
 * Batch-encode queries, running one ONNX pass per length-bucket.
 *
 * The BGE-M3 graph's mean pooling dilutes embeddings with any padding
 * (verified: 1 pad token → 1.2e-2 vector shift) — so we NEVER pad. Queries
 * sharing an exact token length batch together (one run per bucket); unique
 * lengths run singly. This keeps embeddings bit-identical to single encodes
 * while still collapsing the common same-length case (e.g. 3 similar search
 * queries) into one ONNX pass.
 */
async function embed(queries) {
  const { session, tokenizer } = await runtimeReady()
  const ort = runtime.ort()

  // Bucket by exact token length.
  const encs = queries.map((q) => encodeText(tokenizer, q))
  const buckets = new Map() // len → [{enc, idx}]
  encs.forEach((enc, idx) => {
    const len = enc.input_ids.data.length
    if (!buckets.has(len)) buckets.set(len, [])
    buckets.get(len).push({ enc, idx })
  })

  const results = new Array(queries.length)
  for (const [len, group] of buckets) {
    if (group.length === 1) {
      const { enc, idx } = group[0]
      const out = await session.run({
        input_ids: new ort.Tensor('int64', enc.input_ids.data, [1, len]),
        attention_mask: new ort.Tensor('int64', enc.attention_mask.data, [1, len]),
      })
      results[idx] = vectorsFromRun(out, enc.input_ids.data, enc.attention_mask.data, len)
      continue
    }
    // Same-length batch: no padding needed.
    const n = group.length
    const idsBatch = new BigInt64Array(n * len)
    const maskBatch = new BigInt64Array(n * len)
    group.forEach(({ enc }, i) => {
      idsBatch.set(enc.input_ids.data, i * len)
      maskBatch.set(enc.attention_mask.data, i * len)
    })
    const out = await session.run({
      input_ids: new ort.Tensor('int64', idsBatch, [n, len]),
      attention_mask: new ort.Tensor('int64', maskBatch, [n, len]),
    })
    group.forEach(({ enc, idx }, i) => {
      const start = i * len
      results[idx] = vectorsFromRun(out,
        idsBatch.subarray(start, start + len), maskBatch.subarray(start, start + len), len,
        i * VECTOR_DIM, len)
    })
  }
  return results
}

function ready() {
  return runtime.available() && fs.existsSync(MODEL_PATH()) && fs.existsSync(path.join(TOK_DIR, 'tokenizer.json'))
}

module.exports = { embed, encodeOne, ready, encodeText, MODEL_PATH, TOK_DIR }
