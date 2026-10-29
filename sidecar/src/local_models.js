"use strict"
/**
 * "Download a local model": is an AI program installed on this computer,
 * which model fits its memory, and a one-click download through Ollama.
 *
 *   detect()                → { ollama, llamacpp, ramGb, recommended, options, install }
 *   pull(model, { onProgress, signal })  Ollama's own download (POST /api/pull)
 *   installed()             → the models on this computer: Ollama's, and GGUF
 *                             files in the models folders (OpenLex's, the App's)
 *   use(idOrName)           switch to one (Ollama: at once; a GGUF file: the
 *                             llama-server restarts with it, about 20 s)
 *   remove(id)              delete one to free disk space (never the one in use)
 *
 * The chosen GGUF file is kept in DATA_DIR/local-model.json; the engine's
 * own llama-server and the desktop App's both start with it, so nobody
 * needs OPENLEX_LLM_MODEL (it still wins when set).
 *
 * OpenLex never installs or bundles these programs: when neither is
 * there, the lawyer gets the official download link (and, on a Mac, the
 * Homebrew command for llama.cpp). Only loopback addresses are used.
 *
 *   OLLAMA_HOST       Ollama's own setting (host:port or URL); loopback only
 *   OPENLEX_BIN_DIRS  where to look for the programs instead of PATH (tests)
 *   OPENLEX_RAM_GB    memory to size the suggestion for (tests)
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const OLLAMA_DOWNLOAD = 'https://ollama.com/download'
const LLAMACPP_DOWNLOAD = 'https://github.com/ggml-org/llama.cpp/releases'
const LLAMA_SERVER_URL = 'http://127.0.0.1:8080'

// Sized to the computer's memory (the model needs about its download size
// in RAM plus room for the document). Ollama names; the llama.cpp line
// uses the same model from Qwen's own GGUF repository.
const MODELS = [
  { minGb: 0, name: 'qwen3:4b', title: 'Qwen3 4B', sizeGb: 2.5, gguf: 'Qwen/Qwen3-4B-GGUF:Q4_K_M' },
  { minGb: 12, name: 'qwen3:8b', title: 'Qwen3 8B', sizeGb: 5.2, gguf: 'Qwen/Qwen3-8B-GGUF:Q4_K_M' },
  { minGb: 24, name: 'qwen3:14b', title: 'Qwen3 14B', sizeGb: 9.3, gguf: 'Qwen/Qwen3-14B-GGUF:Q4_K_M' },
  { minGb: 48, name: 'qwen3:32b', title: 'Qwen3 32B', sizeGb: 20, gguf: 'Qwen/Qwen3-32B-GGUF:Q4_K_M' },
]

const MODEL_NAME = /^[a-z0-9][a-z0-9._/-]{0,80}(:[a-z0-9._-]{1,40})?$/i
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

function ramGb() {
  const env = parseFloat(process.env.OPENLEX_RAM_GB || '')
  if (env > 0) return env
  return Math.round(os.totalmem() / 1024 ** 3)
}

/** The model suggested for this much memory. */
function recommend(gb = ramGb()) {
  let pick = MODELS[0]
  for (const m of MODELS) if (gb >= m.minGb) pick = m
  return { ...pick }
}

/** Ollama's address (OLLAMA_HOST, loopback only), without a trailing slash. */
function ollamaBase() {
  let raw = String(process.env.OLLAMA_HOST || '').trim()
  if (!raw) return 'http://127.0.0.1:11434'
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`
  try {
    const u = new URL(raw)
    // OLLAMA_HOST may name the bind-all address; Ollama is then reached on loopback.
    const host = /^0(\.0){3}$/.test(u.hostname) || !u.hostname ? '127.0.0.1' : u.hostname
    if (!LOOPBACK.has(host)) return 'http://127.0.0.1:11434'
    return `${u.protocol}//${host}:${u.port || '11434'}`
  } catch { return 'http://127.0.0.1:11434' }
}

function searchDirs() {
  if (process.env.OPENLEX_BIN_DIRS) return process.env.OPENLEX_BIN_DIRS.split(path.delimiter).filter(Boolean)
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/Applications/Ollama.app/Contents/Resources')
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama'))
  return [...new Set(dirs)]
}

/** Full path of a program on this computer, or null. */
function which(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of searchDirs()) {
    for (const ext of exts) {
      const f = path.join(dir, name + ext)
      try {
        const st = fs.statSync(f)
        if (!st.isFile()) continue
        if (process.platform !== 'win32') fs.accessSync(f, fs.constants.X_OK)
        return f
      } catch { /* not here */ }
    }
  }
  return null
}

async function getJson(url, ms = 1500) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** What is installed and running, and the suggestion for this computer. */
async function detect() {
  const base = ollamaBase()
  const ollamaBin = which('ollama')
  let running = false
  let version = null
  let models = []
  try {
    const v = await getJson(`${base}/api/version`)
    running = true
    version = v.version || null
    const tags = await getJson(`${base}/api/tags`, 3000)
    models = (tags.models || []).map((m) => ({ name: m.name || m.model, sizeGb: m.size ? Math.round((m.size / 1024 ** 3) * 10) / 10 : null })).filter((m) => m.name)
  } catch { /* not running */ }
  const llamaBin = which('llama-server')
  let llamaRunning = false
  try { await getJson(`${LLAMA_SERVER_URL}/v1/models`, 1000); llamaRunning = true } catch { /* not running */ }
  const gb = ramGb()
  const rec = recommend(gb)
  return {
    ollama: { installed: !!ollamaBin || running, running, version, address: base, models },
    llamacpp: { installed: !!llamaBin, running: llamaRunning, address: LLAMA_SERVER_URL, command: `llama-server -hf ${rec.gguf} --jinja --port 8080` },
    ramGb: gb,
    recommended: { ...rec, installed: models.some((m) => m.name === rec.name || m.name === `${rec.name}:latest`) },
    options: MODELS.map((m) => ({ ...m, fits: gb >= m.minGb, installed: models.some((x) => x.name === m.name) })),
    install: {
      platform: process.platform,
      ollama: OLLAMA_DOWNLOAD,
      llamacpp: LLAMACPP_DOWNLOAD,
      brew: process.platform === 'darwin' ? 'brew install llama.cpp' : null,
    },
  }
}

/**
 * Download a model through the lawyer's own Ollama. Calls onProgress with
 * { status, completed, total, percent } and resolves with { model } once
 * Ollama reports success. Stops when `signal` aborts.
 */
async function pull(model, { onProgress = () => {}, signal } = {}) {
  const name = String(model || '').trim()
  if (!MODEL_NAME.test(name)) throw new Error('not a model name Ollama knows (for example qwen3:8b)')
  const base = ollamaBase()
  let res
  try {
    res = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true }),
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error('Ollama is not running on this computer. Start it, then try again.')
  }
  if (!res.ok) throw new Error(`Ollama could not download ${name} (HTTP ${res.status})`)
  const parts = new Map() // digest → { total, completed }
  const decoder = new TextDecoder()
  let buf = ''
  let ok = false
  const handle = (line) => {
    if (!line.trim()) return
    let ev
    try { ev = JSON.parse(line) } catch { return }
    if (ev.error) throw new Error(`Ollama: ${String(ev.error).slice(0, 200)}`)
    if (ev.digest && ev.total) parts.set(ev.digest, { total: ev.total, completed: ev.completed || 0 })
    let total = 0
    let completed = 0
    for (const p of parts.values()) { total += p.total; completed += p.completed }
    if (ev.status === 'success') ok = true
    onProgress({ status: String(ev.status || ''), completed, total, percent: total ? Math.min(100, Math.floor((completed / total) * 100)) : null })
  }
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1) }
  }
  handle(buf)
  if (!ok) throw new Error(`Ollama stopped before ${name} was complete`)
  return { model: name, address: base }
}

// ── the models on this computer, switching and removing ─────────────────

const { DATA_DIR } = require('./config')
const CHOICE_PATH = path.join(DATA_DIR, 'local-model.json')

/** One plain line: what a model of this size is good for (EN + DE). */
function goodFor(sizeGb) {
  const gb = Number(sizeGb) || 0
  if (gb && gb < 3.5) return { en: 'Quick questions and short documents; runs on most computers.', de: 'Kurze Fragen und kurze Dokumente; läuft auf den meisten Computern.' }
  if (gb < 7) return { en: 'Everyday questions and drafts.', de: 'Alltägliche Fragen und Entwürfe.' }
  if (gb < 13) return { en: 'Longer documents and more careful answers; needs 24 GB of memory or more.', de: 'Längere Dokumente und sorgfältigere Antworten; braucht 24 GB Arbeitsspeicher oder mehr.' }
  return { en: 'The most careful answers; needs a strong computer (48 GB of memory or more).', de: 'Die sorgfältigsten Antworten; braucht einen leistungsstarken Computer (48 GB Arbeitsspeicher oder mehr).' }
}

/** Folders that hold GGUF files: OpenLex's own, and the desktop App's (it announces it in run/app.json). */
function modelDirs() {
  const dirs = [path.join(DATA_DIR, 'models')]
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'run', 'app.json'), 'utf8'))
    if (reg && typeof reg.modelsDir === 'string' && path.isAbsolute(reg.modelsDir)) dirs.push(reg.modelsDir)
  } catch { /* no App */ }
  return [...new Set(dirs.map((d) => path.resolve(d)))]
}

function ggufFiles() {
  const out = []
  for (const dir of modelDirs()) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const f of names) {
      if (!/\.gguf$/i.test(f) || /^mmproj/i.test(f)) continue
      const file = path.join(dir, f)
      try { const st = fs.statSync(file); if (st.isFile()) out.push({ file, name: f.replace(/\.gguf$/i, ''), sizeGb: Math.round((st.size / 1024 ** 3) * 10) / 10 }) } catch { /* gone */ }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}

/** The GGUF file chosen in the picker (absolute path), or null. */
function chosenGguf() {
  try {
    const j = JSON.parse(fs.readFileSync(CHOICE_PATH, 'utf8'))
    const f = j && typeof j.file === 'string' ? path.resolve(j.file) : null
    if (!f || !/\.gguf$/i.test(f) || !modelDirs().includes(path.dirname(f)) || !fs.existsSync(f)) return null
    return f
  } catch { return null }
}

/** The local GGUF model's name (for its profile): the pinned setting, else the picker's choice, else the default. */
function currentName() {
  const { LLM_MODEL_NAME } = require('./config')
  if (process.env.LEXVAULT_LLM_MODEL) return LLM_MODEL_NAME
  const f = chosenGguf()
  return f ? path.basename(f).replace(/\.gguf$/i, '') : LLM_MODEL_NAME
}

const pretty = (id) => require('./providers/describe').prettyModel(id)

/** Every model on this computer, with which one is in use. */
async function installed() {
  const settings = require('./providers/settings')
  const active = settings.load().active
  const server = settings.resolve('local-server')
  const out = []
  let ollamaRunning = false
  try {
    const tags = await getJson(`${ollamaBase()}/api/tags`, 3000)
    ollamaRunning = true
    for (const m of tags.models || []) {
      const name = m.name || m.model
      if (!name) continue
      const sizeGb = m.size ? Math.round((m.size / 1024 ** 3) * 10) / 10 : null
      out.push({ id: `ollama:${name}`, runtime: 'ollama', name, title: pretty(name), sizeGb, goodFor: goodFor(sizeGb), active: active === 'local-server' && server.model === name })
    }
  } catch { /* Ollama not running */ }
  const envPinned = !!process.env.LEXVAULT_LLM_MODEL
  let current = null
  try { current = require('./runtime').resolveModelPath() } catch { current = null }
  for (const g of ggufFiles()) {
    out.push({ id: `gguf:${path.basename(g.file)}`, runtime: 'gguf', name: g.name, title: pretty(g.name), sizeGb: g.sizeGb, goodFor: goodFor(g.sizeGb), active: active === 'local' && !!current && path.resolve(current) === g.file })
  }
  return { models: out, ollamaRunning, pinnedByEnv: envPinned }
}

function findModel(list, idOrName) {
  const w = String(idOrName || '').trim().toLowerCase()
  if (!w) return null
  return list.find((m) => m.id.toLowerCase() === w) ||
    list.find((m) => m.name.toLowerCase() === w || m.title.toLowerCase() === w) ||
    list.find((m) => m.name.toLowerCase().startsWith(w) || m.title.toLowerCase().startsWith(w)) || null
}

/**
 * Switch the AI on this computer to one installed model. Ollama: the
 * "AI program on this computer" service with that model, at once. A GGUF
 * file: remembered, then the llama-server restarts with it (the engine's
 * own one here; the desktop App's restarts on its own when it sees the
 * choice) — about 20 s.
 */
async function use(idOrName) {
  const { models } = await installed()
  const m = findModel(models, idOrName)
  if (!m) throw new Error(`there is no model called "${idOrName}" on this computer`)
  const settings = require('./providers/settings')
  if (m.runtime === 'ollama') {
    settings.update({ provider: 'local-server', overrides: { baseUrl: `${ollamaBase()}/v1`, model: m.name } })
    settings.update({ active: 'local-server' })
    return { ok: true, model: m, restarted: false, seconds: 0 }
  }
  if (process.env.LEXVAULT_LLM_MODEL) throw new Error('the model on this computer is fixed by the OPENLEX_LLM_MODEL setting; remove it to choose here')
  const file = ggufFiles().find((g) => `gguf:${path.basename(g.file)}` === m.id).file
  fs.mkdirSync(path.dirname(CHOICE_PATH), { recursive: true })
  fs.writeFileSync(CHOICE_PATH, JSON.stringify({ file, at: new Date().toISOString() }, null, 2))
  settings.update({ active: 'local' })
  const r = await require('./runtime').switchModel()
  return { ok: r.ok !== false, model: m, restarted: true, seconds: 20, reason: r.reason || null }
}

/** Delete a model to free disk space. Never the one in use. */
async function remove(id) {
  const { models } = await installed()
  const m = models.find((x) => x.id === id)
  if (!m) throw new Error(`there is no model "${id}" on this computer`)
  if (m.active) throw new Error(`${m.title} is in use. Switch to another model first.`)
  if (m.runtime === 'ollama') {
    const res = await fetch(`${ollamaBase()}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`Ollama could not remove ${m.name} (HTTP ${res.status})`)
  } else {
    const g = ggufFiles().find((x) => `gguf:${path.basename(x.file)}` === m.id)
    if (chosenGguf() === g.file) { try { fs.rmSync(CHOICE_PATH, { force: true }) } catch { /* ignore */ } }
    fs.rmSync(g.file)
  }
  return { ok: true, removed: m.id, freedGb: m.sizeGb }
}

module.exports = { detect, pull, recommend, which, ollamaBase, ramGb, MODELS, installed, use, remove, chosenGguf, currentName, goodFor, modelDirs, CHOICE_PATH }
