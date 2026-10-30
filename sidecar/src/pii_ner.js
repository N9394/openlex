"use strict"
/**
 * The optional on-device name finder for the redaction check.
 *
 * Model: GLiNER-X small (knowledgator/gliner-x-small, Apache-2.0), an
 * mT5-based span model trained for ~20 languages (among them German,
 * English, Czech, Polish, Romanian; Slovak and Hungarian work through
 * their neighbours, less reliably). The int8 ONNX file is ~173 MB.
 * It runs in this process through the engine's ONNX runtime
 * (onnx_runtime.js: onnxruntime-node + @huggingface/tokenizers) — nothing
 * is sent anywhere. That runtime comes with the desktop app; the CLI
 * tarball and Homebrew leave it out, so there the name finder is not
 * offered ("needs the desktop app").
 *
 * Never bundled: downloaded on request from Hugging Face at a fixed
 * revision, every file checked against its SHA-256 before it is used.
 * Without it the check still works (patterns, the matter's list, titles and
 * legal forms) and says detection is "basic".
 *
 *   status()               { available, installed, runtime, name, license, bytes, … }
 *                           available: the runtime loads here (tried once, cached)
 *                           installed: the model files are on disk
 *   install({ onProgress }) download + verify (refused when not available)
 *   remove()
 *   run(text)               { findings, ran } — ran: the model really went
 *                           through this text (false: not installed, no
 *                           runtime, stopped); the check reports "basic" then
 *   find(text)              run(text).findings:
 *                           [{ kind: PERSON|ORG|ADDRESS, start, end, confidence }]
 *   setRunner(fn)           tests: replace the model with fn(text) → findings
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const runtime = require('./onnx_runtime')

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
let loaded = null // { session, tokenizer, ort, labels }
let job = null // the running download

function installed() {
  return MODEL.files.every((f) => { try { return fs.statSync(path.join(dir(), f.to || f.name)).size === f.bytes } catch { return false } })
}

function status() {
  const rt = runner ? { available: true, reason: null, error: null } : runtime.info()
  return {
    available: rt.available, installed: !!runner || installed(), runtime: rt, name: MODEL.name, id: MODEL.id, license: MODEL.license, source: MODEL.source,
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
  if (!status().available) {
    const rt = runtime.info()
    const e = new Error(rt.reason === 'not-bundled' ? 'The name finder needs the desktop app (this build has no ONNX runtime).' : `The name finder cannot run on this computer: ${rt.error}`)
    e.code = 'ONNX_UNAVAILABLE'
    throw e
  }
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
  const ort = runtime.ort()
  const tokenizer = runtime.tokenizer(dir())
  const session = await ort.InferenceSession.create(path.join(dir(), 'model_quantized.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 2 })
  const labels = LABELS.map(([label]) => tokenizer.encode(label, { add_special_tokens: false }).ids)
  loaded = { ort, tokenizer, session, labels }
  return loaded
}

const WORD_RE = /[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|\S/gu

/** One window of words through the model → span findings (character offsets in `text`). */
async function runWindow(m, text, words) {
  const { ort, tokenizer, session, labels } = m
  const ids = []
  const wmask = []
  for (const toks of labels) {
    ids.push(ENT); wmask.push(0)
    for (const t of toks) { ids.push(t); wmask.push(0) }
  }
  ids.push(SEP); wmask.push(0)
  words.forEach((w, i) => {
    const toks = tokenizer.encode(w.w, { add_special_tokens: false }).ids
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

/**
 * Names, organisations and addresses the model finds in a text.
 * @returns {{ findings: object[], ran: boolean }} ran is false when the model
 *   did not go through the text (not installed, no runtime, stopped); a
 *   failure to load throws.
 */
async function run(text, { signal } = {}) {
  text = String(text || '')
  if (runner) return { findings: text.trim() ? await runner(text) : [], ran: true }
  if (!installed() || !runtime.available()) return { findings: [], ran: false }
  if (!text.trim()) return { findings: [], ran: true }
  const m = await load()
  const words = []
  for (const x of text.matchAll(WORD_RE)) { words.push({ w: x[0], s: x.index, e: x.index + x[0].length }); if (words.length >= MAX_WORDS) break }
  const out = []
  // Overlapping windows so a name on a window edge is still seen whole.
  const step = CHUNK_WORDS - 30
  for (let at = 0; at < words.length; at += step) {
    if (signal?.aborted) return { findings: out, ran: false }
    const win = words.slice(at, at + CHUNK_WORDS)
    for (const f of await runWindow(m, text, win)) if (!out.some((o) => o.start === f.start && o.end === f.end)) out.push(f)
    if (at + CHUNK_WORDS >= words.length) break
  }
  return { findings: out, ran: true }
}

/** run(text).findings — [] when the model is not installed or cannot run. */
async function find(text, opts) { return (await run(text, opts)).findings }

function setRunner(fn) { runner = fn || null }

module.exports = { MODEL, status, install, remove, run, find, setRunner, installed }
