"use strict"
/**
 * The optional on-device name finder for the redaction check.
 *
 * Model: GLiNER-X small (knowledgator/gliner-x-small, Apache-2.0), an
 * mT5-based span model trained for ~20 languages (among them German,
 * English, Czech, Polish, Romanian; Slovak and Hungarian work through
 * their neighbours, less reliably). The int8 ONNX file is ~173 MB.
 * It runs in this process (onnxruntime-node, tokenizer from
 * @huggingface/transformers) — nothing is sent anywhere.
 *
 * Never bundled: downloaded on request from Hugging Face at a fixed
 * revision, every file checked against its SHA-256 before it is used.
 * Without it the check still works (patterns, the matter's list, titles and
 * legal forms) and says detection is "basic".
 *
 *   status()               { installed, name, license, bytes, … }
 *   install({ onProgress }) download + verify
 *   remove()
 *   find(text)              [{ kind: PERSON|ORG|ADDRESS, start, end, confidence }]
 *   setRunner(fn)           tests: replace the model with fn(text) → findings
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const MODEL = {
  id: 'gliner-x-small',
  name: 'GLiNER-X small (multilingual name finder)',
  repo: 'knowledgator/gliner-x-small',
  revision: 'd51a0984d11084a55f9df3899d9dbf7704f580f5',
  license: 'Apache-2.0',
  source: 'https://huggingface.co/knowledgator/gliner-x-small',
  files: [
    { name: 'onnx/model_quantized.onnx', to: 'model_quantized.onnx', bytes: 172716978, sha256: 'd76b3349fd4bfe44573221c0912ed459f432d14317552fdc65935dabcb833c4a' },
    { name: 'tokenizer.json', bytes: 16335050, sha256: '619d3790cf59a0e50afdf04239db19093568fbd8d806963e35d54a8fb71d099c' },
    { name: 'tokenizer_config.json', bytes: 19602, sha256: '08540ea44a5b8bf6a155e89902698c642d623657996c6e4d898236b159589404' },
    { name: 'special_tokens_map.json', bytes: 416, sha256: '80f4c6c5cf3867d7669ff8aa8f6aebb8a7499322e62d7faae06262d6014edd61' },
    { name: 'added_tokens.json', bytes: 45, sha256: '93afe6f29473301199fb234b4f0c4c21cde56a912c62f3ffc0b6993015028157' },
    { name: 'gliner_config.json', bytes: 3541, sha256: 'f8e7758e503d37be53b70910c7d3cebf327fe7f23c8f65f355c9941878940206' },
  ],
}
const LABELS = [['person', 'PERSON'], ['organization', 'ORG'], ['address', 'ADDRESS']]
const ENT = 250100 // <<ENT>>
const SEP = 250101 // <<SEP>>
const EOS = 1
const MAX_WIDTH = 12
const CHUNK_WORDS = 280
const THRESHOLD = 0.5
const MAX_WORDS = 60000 // ~ 150 pages (about a minute); beyond that the patterns and lists carry on alone

const dir = () => path.join(DATA_DIR, 'models', MODEL.id)
const totalBytes = MODEL.files.reduce((n, f) => n + f.bytes, 0)

let runner = null // tests
let loaded = null // { session, tokenizer, ort }
let job = null // the running download

function installed() {
  return MODEL.files.every((f) => { try { return fs.statSync(path.join(dir(), f.to || f.name)).size === f.bytes } catch { return false } })
}

function status() {
  return {
    installed: !!runner || installed(), name: MODEL.name, id: MODEL.id, license: MODEL.license, source: MODEL.source,
    bytes: totalBytes, sizeMB: Math.round(totalBytes / 1e6),
    downloading: job ? { received: job.received, total: totalBytes, pct: Math.round((job.received / totalBytes) * 100) } : null,
    error: lastError,
  }
}
let lastError = null

async function fetchTo(url, dest, f, onChunk) {
  const res = await fetch(url, { headers: { 'User-Agent': 'OpenLex-Engine' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status}) for ${f.name}`)
  const hash = crypto.createHash('sha256')
  const partial = `${dest}.partial`
  const out = fs.createWriteStream(partial)
  try {
    for await (const chunk of res.body) { hash.update(chunk); out.write(chunk); onChunk(chunk.length) }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())))
  } catch (err) { out.destroy(); fs.rmSync(partial, { force: true }); throw err }
  const got = hash.digest('hex')
  if (got !== f.sha256) { fs.rmSync(partial, { force: true }); throw new Error(`${f.name}: checksum does not match (the download was changed or broken); nothing was installed`) }
  fs.renameSync(partial, dest)
}

/** Download the model files (once; checked by SHA-256). */
async function install({ onProgress } = {}) {
  if (job) return job.promise
  lastError = null
  job = { received: 0 }
  job.promise = (async () => {
    fs.mkdirSync(dir(), { recursive: true })
    for (const f of MODEL.files) {
      const dest = path.join(dir(), f.to || f.name)
      try { if (fs.statSync(dest).size === f.bytes) { job.received += f.bytes; continue } } catch { /* not there yet */ }
      const url = `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${f.name}`
      await fetchTo(url, dest, f, (n) => { job.received += n; onProgress?.(status().downloading) })
    }
    return status()
  })()
  try { return await job.promise } catch (err) { lastError = err.message; throw err } finally { job = null }
}

function remove() {
  loaded = null
  fs.rmSync(dir(), { recursive: true, force: true })
  return status()
}

async function load() {
  if (loaded) return loaded
  const ort = require('onnxruntime-node')
  const { AutoTokenizer, env } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.localModelPath = path.dirname(dir())
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL.id)
  const session = await ort.InferenceSession.create(path.join(dir(), 'model_quantized.onnx'), { intraOpNumThreads: 2 })
  loaded = { ort, tokenizer, session }
  return loaded
}

const WORD_RE = /[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|\S/gu

/** One window of words through the model → span findings (character offsets in `text`). */
async function runWindow(m, text, words) {
  const { ort, tokenizer, session } = m
  const ids = []
  const wmask = []
  for (const [label] of LABELS) {
    ids.push(ENT); wmask.push(0)
    for (const t of tokenizer.encode(label, { add_special_tokens: false })) { ids.push(t); wmask.push(0) }
  }
  ids.push(SEP); wmask.push(0)
  words.forEach((w, i) => {
    const toks = tokenizer.encode(w.w, { add_special_tokens: false })
    toks.forEach((t, j) => { ids.push(t); wmask.push(j === 0 ? i + 1 : 0) })
  })
  ids.push(EOS); wmask.push(0)
  const n = words.length
  const big = (a) => BigInt64Array.from(a, (x) => BigInt(x))
  const span = []
  const smask = []
  for (let i = 0; i < n; i++) for (let w = 0; w < MAX_WIDTH; w++) { span.push(i, Math.min(i + w, n - 1)); smask.push(i + w < n ? 1 : 0) }
  const out = await session.run({
    input_ids: new ort.Tensor('int64', big(ids), [1, ids.length]),
    attention_mask: new ort.Tensor('int64', big(ids.map(() => 1)), [1, ids.length]),
    words_mask: new ort.Tensor('int64', big(wmask), [1, ids.length]),
    text_lengths: new ort.Tensor('int64', big([n]), [1, 1]),
    span_idx: new ort.Tensor('int64', big(span), [1, n * MAX_WIDTH, 2]),
    span_mask: new ort.Tensor('bool', Uint8Array.from(smask), [1, n * MAX_WIDTH]),
  })
  const d = out.logits.data
  const C = LABELS.length
  const cands = []
  for (let i = 0; i < n; i++) {
    for (let w = 0; w < MAX_WIDTH && i + w < n; w++) {
      for (let c = 0; c < C; c++) {
        const p = 1 / (1 + Math.exp(-d[(i * MAX_WIDTH + w) * C + c]))
        if (p >= THRESHOLD) cands.push({ i, j: i + w, kind: LABELS[c][1], p })
      }
    }
  }
  // Flat spans: the most certain first, no overlaps.
  cands.sort((a, b) => b.p - a.p)
  const taken = []
  for (const c of cands) if (!taken.some((t) => c.i <= t.j && t.i <= c.j)) taken.push(c)
  return taken.map((c) => ({ kind: c.kind, start: words[c.i].s, end: words[c.j].e, confidence: Math.round(c.p * 100) / 100 }))
}

/** Names, organisations and addresses the model finds in a text. [] when the model is not installed. */
async function find(text, { signal } = {}) {
  text = String(text || '')
  if (!text.trim()) return []
  if (runner) return runner(text)
  if (!installed()) return []
  const m = await load()
  const words = []
  for (const x of text.matchAll(WORD_RE)) { words.push({ w: x[0], s: x.index, e: x.index + x[0].length }); if (words.length >= MAX_WORDS) break }
  const out = []
  // Overlapping windows so a name on a window edge is still seen whole.
  const step = CHUNK_WORDS - 30
  for (let at = 0; at < words.length; at += step) {
    if (signal?.aborted) break
    const win = words.slice(at, at + CHUNK_WORDS)
    for (const f of await runWindow(m, text, win)) if (!out.some((o) => o.start === f.start && o.end === f.end)) out.push(f)
    if (at + CHUNK_WORDS >= words.length) break
  }
  return out
}

function setRunner(fn) { runner = fn || null }

module.exports = { MODEL, status, install, remove, find, setRunner, installed }
