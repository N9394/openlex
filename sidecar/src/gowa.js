"use strict"
/**
 * GOWA — General OpenLex Worker Agent: OpenLex's own decision model, run
 * on this computer.
 *
 * Model: mmBERT-small (jhu-clsp/mmBERT-small, MIT, 140M parameters) with
 * ONE Kev-style decision head (gowa_format.js): it answers typed questions
 * about a text — yes/no (noul), one of up to 255 options (choice), a level
 * on a rubric (score) — with calibrated probabilities. It speaks the same
 * System One API as decide.js, so a local Kev server, GOWA and Jev are
 * interchangeable behind decide.systemOne().
 *
 * Runs in this process (onnxruntime-node, the tokenizer from
 * @huggingface/transformers). Nothing is sent anywhere. Loaded on first
 * use, unloaded after a few idle minutes, CPU threads capped.
 *
 * Files in <data>/models/gowa-small/:
 *   model.onnx            the int8 model: inputs input_ids, attention_mask,
 *                         option_index [B,K], decide_index [B]; output option_logits [B,K]
 *   tokenizer.json, tokenizer_config.json
 *   gowa-model.json       the head config: format, markers, max_length,
 *                         temperature (+ per task family), thresholds per
 *                         task (from calibration), versions
 *
 * Never bundled. Downloaded on request from a configurable address
 * (Hugging Face once released) at a pinned revision, every file checked
 * against its SHA-256 — like the name finder (pii_ner.js). Until the
 * weights exist the manifest says "not yet available"; a model trained
 * with models/gowa/ can be put into the folder by hand.
 *
 *   status() · install({ onProgress }) · remove()
 *   systemOne({ state, questions, task })   the System One answer shape
 *   config()                                gowa-model.json of the installed model
 *   unload()
 *   _setTestBackend({ encode, config, run }) tests: no files, no onnxruntime
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const fmt = require('./gowa_format')

const FORMAT = 'gowa-decision-v1'
const REQUIRED = ['model.onnx', 'tokenizer.json', 'tokenizer_config.json', 'gowa-model.json']

/** The built-in manifest. Weights do not exist yet: no files, status "not yet available". */
const MANIFEST = {
  id: 'gowa-small',
  version: 'v0',
  name: 'GOWA small v0',
  label: 'OpenLex model (GOWA)',
  base: 'jhu-clsp/mmBERT-small (MIT)',
  license: 'Apache-2.0',
  source: null, // e.g. 'https://huggingface.co/<org>/gowa-small' once published
  url: null, // template with {revision} and {file}
  revision: null,
  files: [], // [{ name, bytes, sha256 }] — pinned when the weights are released
  note: 'Not yet available: the GOWA weights have not been trained yet. Everything that would use it keeps working without it.',
}

const dir = () => path.join(DATA_DIR, 'models', MANIFEST.id)

// ── settings (openlex.json → "decide": { "gowa": { … } }) ─────────────────
function settings() {
  let g = {}
  try { g = require('./harness').load().decide?.gowa || {} } catch { /* defaults */ }
  const cpus = Math.max(1, (os.cpus() || []).length)
  const threads = Number.isInteger(g.threads) && g.threads > 0 ? Math.min(g.threads, cpus) : Math.min(2, cpus)
  const idleMinutes = Number(g.idleMinutes) > 0 ? Number(g.idleMinutes) : 5
  const batch = Number.isInteger(g.batch) && g.batch > 0 ? Math.min(g.batch, 64) : 8
  return { threads, idleMinutes, batch, source: g.source && typeof g.source === 'object' ? g.source : null }
}

/**
 * The manifest in effect: the built-in one, or a release the firm pinned in
 * openlex.json ("decide.gowa.source": { url, revision, files: [{ name, bytes, sha256 }] }).
 * Every file needs a SHA-256: nothing unverified is ever installed.
 */
function manifest() {
  const s = settings().source
  if (!s) return MANIFEST
  const files = (Array.isArray(s.files) ? s.files : []).filter((f) => f && typeof f.name === 'string' && /^[a-f0-9]{64}$/i.test(String(f.sha256 || '')) && Number(f.bytes) > 0)
    .map((f) => ({ name: f.name, bytes: Number(f.bytes), sha256: String(f.sha256).toLowerCase() }))
  return { ...MANIFEST, url: String(s.url || ''), revision: String(s.revision || ''), files, version: String(s.version || MANIFEST.version), source: s.source || s.url || null, configured: true }
}

function fileUrl(m, f) {
  if (!m.url) throw new Error('GOWA: no download address configured')
  const u = m.url.replace('{revision}', encodeURIComponent(m.revision || 'main')).replace('{file}', f.name.split('/').map(encodeURIComponent).join('/'))
  let parsed
  try { parsed = new URL(u) } catch { throw new Error('GOWA: the download address is not a URL') }
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('GOWA: the download address must use https')
  return u
}

// ── runtime availability ──────────────────────────────────────────────────
// Kept independent of how the app packages onnxruntime-node; swap for the
// shared check once the desktop bundling lands.
let rt = null
function runtime() {
  if (rt) return rt
  try { require('onnxruntime-node'); rt = { available: true } } catch (err) { rt = { available: false, error: String(err.message || err).split('\n')[0].slice(0, 200) } }
  return rt
}

// ── status ────────────────────────────────────────────────────────────────
let test = null // _setTestBackend
let loaded = null // { session, ort, encode, cfg }
let loading = null
let idleTimer = null
let job = null
let lastError = null

function readConfig(file = path.join(dir(), 'gowa-model.json')) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'))
  return validateConfig(c)
}

/** gowa-model.json → a checked config (throws with a plain reason). */
function validateConfig(c) {
  if (!c || typeof c !== 'object') throw new Error('gowa-model.json is not an object')
  if (c.format !== FORMAT) throw new Error(`gowa-model.json: format must be "${FORMAT}"`)
  const m = c.markers || {}
  for (const k of ['cls', 'sep', 'pad', 'state', 'question', 'opt_open', 'opt_close', 'decide']) if (!Number.isInteger(m[k]) || m[k] < 0) throw new Error(`gowa-model.json: markers.${k} must be a token id`)
  const T = Number(c.temperature ?? 1)
  if (!(T > 0)) throw new Error('gowa-model.json: temperature must be > 0')
  return {
    ...c,
    max_length: Number.isInteger(c.max_length) && c.max_length >= 16 ? c.max_length : 512,
    temperature: T,
    temperatures: c.temperatures && typeof c.temperatures === 'object' ? c.temperatures : {},
    thresholds: c.thresholds && typeof c.thresholds === 'object' ? c.thresholds : {},
    unk: Number.isInteger(c.unk) ? c.unk : 0,
  }
}

function installed() {
  if (test) return true
  const m = manifest()
  if (m.files.length) {
    return m.files.every((f) => { try { return fs.statSync(path.join(dir(), f.name)).size === f.bytes } catch { return false } })
  }
  // A model trained with models/gowa/ and copied into the folder by hand.
  return REQUIRED.every((f) => fs.existsSync(path.join(dir(), f)))
}

function status() {
  const m = manifest()
  const isIn = installed()
  const bytes = m.files.reduce((n, f) => n + f.bytes, 0)
  let cfg = null
  if (isIn) { try { cfg = test ? test.config : readConfig() } catch (err) { lastError = err.message } }
  const state = job ? 'downloading' : isIn ? 'installed' : m.files.length ? 'available' : 'not-yet-available'
  return {
    id: m.id, name: m.name, label: m.label, version: cfg?.version || m.version, base: m.base, license: m.license, source: m.source,
    status: state, installed: isIn, available: m.files.length > 0 || isIn,
    bytes, sizeMB: Math.round(bytes / 1e6),
    ...(state === 'not-yet-available' ? { note: m.note } : {}),
    runtime: test ? { available: true } : runtime(),
    loaded: !!loaded || (!!test && !!test.loaded),
    downloading: job ? { received: job.received, total: bytes, pct: bytes ? Math.round((job.received / bytes) * 100) : 0 } : null,
    error: lastError,
  }
}

/** Ready to answer: installed and the runtime loads. */
function ready() {
  const s = status()
  return s.installed && s.runtime.available
}

// ── download ──────────────────────────────────────────────────────────────
async function fetchTo(url, dest, f, onChunk) {
  const res = await fetch(url, { headers: { 'User-Agent': 'OpenLex-Engine' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status}) for ${f.name}`)
  const hash = crypto.createHash('sha256')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const partial = `${dest}.partial`
  const out = fs.createWriteStream(partial)
  try {
    for await (const chunk of res.body) { hash.update(chunk); out.write(chunk); onChunk(chunk.length) }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())))
  } catch (err) { out.destroy(); fs.rmSync(partial, { force: true }); throw err }
  if (hash.digest('hex') !== f.sha256) { fs.rmSync(partial, { force: true }); throw new Error(`${f.name}: checksum does not match (the download was changed or broken); nothing was installed`) }
  fs.renameSync(partial, dest)
}

/** Download the pinned files (checked by SHA-256). Refused while the weights are not available. */
async function install({ onProgress } = {}) {
  if (job) return job.promise.then(() => status())
  const m = manifest()
  if (!m.files.length) { const e = new Error(m.note); e.code = 'NOT_AVAILABLE'; throw e }
  if (!REQUIRED.every((n) => m.files.some((f) => f.name === n))) throw new Error(`GOWA: the release must list ${REQUIRED.join(', ')}`)
  lastError = null
  job = { received: 0 }
  job.promise = (async () => {
    fs.mkdirSync(dir(), { recursive: true })
    for (const f of m.files) {
      const dest = path.join(dir(), f.name)
      if (!dest.startsWith(dir() + path.sep)) throw new Error(`GOWA: bad file name ${f.name}`)
      try { if (fs.statSync(dest).size === f.bytes) { job.received += f.bytes; continue } } catch { /* not there yet */ }
      await fetchTo(fileUrl(m, f), dest, f, (n) => { job.received += n; onProgress?.(status().downloading) })
    }
    readConfig() // a release with a broken head config is not "installed"
  })()
  try { await job.promise } catch (err) { lastError = err.message; throw err } finally { job = null }
  return status()
}

function remove() {
  unload()
  fs.rmSync(dir(), { recursive: true, force: true })
  lastError = null
  return status()
}

// ── load / unload ─────────────────────────────────────────────────────────
function touch() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(unload, settings().idleMinutes * 60000)
  idleTimer.unref?.()
}

function unload() {
  clearTimeout(idleTimer)
  idleTimer = null
  if (test) test.loaded = false
  const l = loaded
  loaded = null
  try { l?.session?.release?.() } catch { /* already gone */ }
  return { unloaded: !!l }
}

async function load() {
  if (test) { test.loaded = true; touch(); return { cfg: test.config, encode: test.encode, run: test.run } }
  if (loaded) { touch(); return loaded }
  if (loading) return loading
  loading = (async () => {
    if (!installed()) throw new Error('GOWA is not installed')
    const r = runtime()
    if (!r.available) throw new Error(`the on-device runtime (onnxruntime-node) is not available: ${r.error}`)
    const cfg = readConfig()
    const ort = require('onnxruntime-node')
    const { AutoTokenizer, env } = await import('@huggingface/transformers')
    env.allowRemoteModels = false
    env.localModelPath = path.dirname(dir())
    const tok = await AutoTokenizer.from_pretrained(MANIFEST.id)
    const s = settings()
    const session = await ort.InferenceSession.create(path.join(dir(), 'model.onnx'), { intraOpNumThreads: s.threads, interOpNumThreads: 1, graphOptimizationLevel: 'all' })
    const names = new Set(session.inputNames)
    const encode = (text) => tok.encode(String(text), { add_special_tokens: false }).map((x) => (Number.isInteger(x) ? x : cfg.unk))
    const big = (a) => BigInt64Array.from(a, (x) => BigInt(x))
    const run = async (b) => {
      const feeds = {}
      const add = (name, data, dims) => { if (names.has(name)) feeds[name] = new ort.Tensor('int64', big(data), dims) }
      add('input_ids', b.inputIds, [b.B, b.L])
      add('attention_mask', b.attention, [b.B, b.L])
      add('option_index', b.optionIndex, [b.B, b.K])
      add('decide_index', b.decideIndex, [b.B])
      const out = await session.run(feeds)
      const t = out.option_logits || out[session.outputNames[0]]
      return Array.from(t.data, Number)
    }
    loaded = { session, ort, encode, cfg, run }
    touch()
    return loaded
  })()
  try { return await loading } finally { loading = null }
}

function config() {
  if (test) return test.config
  return installed() ? readConfig() : null
}

// ── answering ─────────────────────────────────────────────────────────────
let queue = Promise.resolve() // one batch at a time: the CPU cap holds across callers

/**
 * Answer System One questions on this computer.
 * @param {object} p
 *   state      the text (string, object or array)
 *   questions  already validated by decide.cleanQuestions()
 *   task       optional task family: picks its fitted temperature
 *   signal     stops between batches
 * @returns {Promise<{ answers, model, latency_ms, usage, truncated }>}
 */
async function systemOne({ state, questions, task = null, signal } = {}) {
  const t0 = Date.now()
  const m = await load()
  const cfg = m.cfg
  const T = Number(cfg.temperatures?.[task]) > 0 ? Number(cfg.temperatures[task]) : cfg.temperature
  const ids = Object.keys(questions)
  const seqs = ids.map((id) => fmt.buildSequence({ state, question: questions[id], encode: m.encode, markers: cfg.markers, maxLen: cfg.max_length, cfg }))
  const answers = {}
  const size = settings().batch
  let tokens = 0
  for (let at = 0; at < seqs.length; at += size) {
    if (signal?.aborted) throw new Error('cancelled')
    const part = seqs.slice(at, at + size)
    const b = fmt.packBatch(part, cfg.markers.pad)
    tokens += part.reduce((n, s) => n + s.ids.length, 0)
    const logits = await (queue = queue.catch(() => {}).then(() => m.run(b)))
    part.forEach((s, j) => {
      const q = questions[ids[at + j]]
      const row = logits.slice(j * b.K, j * b.K + s.optionIndex.length)
      answers[ids[at + j]] = fmt.answerFrom(q, row, T)
    })
  }
  touch()
  return {
    answers,
    model: `${MANIFEST.id}-${cfg.version || MANIFEST.version}`,
    latency_ms: Date.now() - t0,
    usage: { input_tokens: tokens, output_tokens: 0 },
    truncated: seqs.some((s) => s.truncated),
    temperature: T,
  }
}

/** Per-task thresholds the calibration wrote into gowa-model.json ({} without a model). */
function thresholds() {
  try { return config()?.thresholds || {} } catch { return {} }
}

/** Tests: a backend without files or onnxruntime. run(batch) → flat logits [B*K]. */
function _setTestBackend(b) {
  unload()
  test = b ? { ...b, config: validateConfig(b.config), loaded: false } : null
}

module.exports = { MANIFEST, FORMAT, REQUIRED, manifest, settings, status, ready, installed, install, remove, load, unload, config, thresholds, systemOne, runtime, validateConfig, _setTestBackend, dir }
