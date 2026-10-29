"use strict"
/**
 * "Memory for the local AI" — how much of this computer's memory (RAM, or
 * the graphics card's VRAM) the AI that runs on this computer may use.
 *
 * The memory holds the model itself plus its working memory (the "context",
 * llama.cpp --ctx-size / Ollama num_ctx). More memory → a longer context →
 * more of a document fits at once, at the price of a slower start and less
 * memory for everything else. With less, OpenLex still reads long documents:
 * from the document's map, part by part (doc.js sections, ~2,000 characters,
 * the target clause read in advance) — it just has to look things up more.
 *
 * Arithmetic (the same numbers as the depth presets in config.js):
 *   model weights    the GGUF file size (≈ 2.75 GB for the default 4B model)
 *   overhead         0.3 GB (buffers, the server)
 *   working memory   32 KB per token of context (KV cache quantised to 4 bits:
 *                    8K tokens ≈ 256 MB, 64K ≈ 2 GB)
 *
 *   ctxForMemory(gb) = (gb − model − overhead) / 32 KB, rounded down to 4K steps
 *
 * The setting lives in agent-config.json ("localMemoryGB", null = automatic).
 * Automatic keeps today's rule (the depth preset, capped by the RAM tier).
 * runtime.js (the engine's own llama-server) and the desktop app's
 * supervisor read chosenCtx()/effectiveCtx(), so the server and the engine
 * budget always agree.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const KV_BYTES_PER_TOKEN = 32 * 1024
const OVERHEAD_GB = 0.3
const DEFAULT_MODEL_GB = 2.75
const STEP = 4096
const MIN_CTX = 8192
const MAX_CTX = 262144
const CHARS_PER_PAGE = 3000
const GB = 1024 ** 3

/** RAM and graphics memory of this computer (GB); VRAM from the desktop app's hardware check when known. */
function detect() {
  const ramGB = Math.round(os.totalmem() / GB * 10) / 10
  let vramGB = null
  let gpu = null
  try {
    for (const dir of require('./config').USERDATA_DIRS || []) {
      const f = path.join(dir, 'hardware.json')
      if (!fs.existsSync(f)) continue
      const hw = JSON.parse(fs.readFileSync(f, 'utf8'))
      const g = hw.detected?.gpu || hw.gpu
      if (g && Number(g.vramGB) > 0) { vramGB = Number(g.vramGB); gpu = g.name || null }
      break
    }
  } catch { /* unknown */ }
  // Apple Silicon: graphics share the RAM (unified memory).
  const unified = process.platform === 'darwin' && process.arch === 'arm64'
  return { ramGB, vramGB: unified ? null : vramGB, gpu, unified }
}

/** Size of the local model in GB (the GGUF on disk), or the default. */
function modelGB() {
  try {
    const { DATA_DIR, LLM_MODEL_NAME } = require('./config')
    const dirs = [path.join(DATA_DIR, 'models'), ...(require('./config').USERDATA_DIRS || []).map((d) => path.join(d, 'models', 'llm'))]
    for (const d of dirs) {
      if (!fs.existsSync(d)) continue
      const files = fs.readdirSync(d).filter((f) => f.endsWith('.gguf'))
      const pick = files.find((f) => LLM_MODEL_NAME && f.includes(LLM_MODEL_NAME)) || files[0]
      if (pick) return Math.round(fs.statSync(path.join(d, pick)).size / GB * 100) / 100
    }
  } catch { /* default */ }
  return DEFAULT_MODEL_GB
}

const round1 = (x) => Math.round(x * 10) / 10

/** Context size (tokens) that a memory budget allows. */
function ctxForMemory(gb, model = modelGB()) {
  const free = (Number(gb) - model - OVERHEAD_GB) * GB + 1024 * 1024 // + 1 MB: no rounding loss from decimal GB
  const ctx = Math.floor(free / KV_BYTES_PER_TOKEN / STEP) * STEP
  return Math.max(MIN_CTX, Math.min(MAX_CTX, ctx))
}

/** Memory (GB) a context size needs. */
function memoryForCtx(ctx, model = modelGB()) {
  return round1(model + OVERHEAD_GB + (ctx * KV_BYTES_PER_TOKEN) / GB)
}

/** About how many pages of text fit into a context (leaving room for instructions and the answer). */
function pagesFor(ctx) {
  return Math.max(1, Math.floor(((ctx * 0.85 - 3200) * 3.8) / CHARS_PER_PAGE))
}

/** The most the lawyer may give: 60% of RAM (or the graphics card's memory minus 0.5 GB). */
function maxGB(hw = detect()) {
  const cap = hw.vramGB ? hw.vramGB - 0.5 : hw.ramGB * 0.6
  return round1(Math.max(memoryForCtx(MIN_CTX), Math.min(cap, memoryForCtx(MAX_CTX))))
}

/** Today's automatic context: depth preset capped by the RAM tier (unchanged rule). */
function autoCtx(hw = detect()) {
  const { DEPTH_PRESETS, ramCtxFor } = require('./config')
  let depth = 'balanced'
  try { depth = require('./agent-config').agentBudget().depth } catch { /* default */ }
  const ramCtx = ramCtxFor(hw.ramGB)
  return Math.min(DEPTH_PRESETS[depth]?.ctx || ramCtx, ramCtx)
}

/** The lawyer's choice in GB, or null (automatic). */
function chosenGB() {
  try { return require('./agent-config').load().localMemoryGB || null } catch { return null }
}

/** The context the lawyer's choice gives, or null when automatic. */
function chosenCtx() {
  const gb = chosenGB()
  if (!gb) return null
  return ctxForMemory(Math.min(gb, maxGB()))
}

/** The context the local AI runs with (chosen, else automatic). */
function effectiveCtx() {
  return chosenCtx() || autoCtx()
}

const WORDS = {
  en: {
    title: 'Memory for the local AI',
    what: 'How much of this computer\'s memory the AI that runs on this computer may use. More memory lets it read more of a long document at once.',
    tradeoff: 'More memory: more pages at once, but the AI takes longer to start and other programs have less memory. Less memory: it starts faster and reads long documents part by part (it still finds what it needs, it just looks things up more often).',
    cloud: 'This does not matter for AI services online (for example Claude): they bring their own memory.',
    auto: 'Automatic',
    restart: 'The AI on this computer restarts with the new memory the next time it is used (about 10 seconds).',
  },
  de: {
    title: 'Speicher für die lokale KI',
    what: 'Wie viel Arbeitsspeicher dieses Computers die KI nutzen darf, die auf diesem Computer läuft. Mit mehr Speicher liest sie mehr von einem langen Dokument auf einmal.',
    tradeoff: 'Mehr Speicher: mehr Seiten auf einmal, aber die KI startet langsamer und anderen Programmen bleibt weniger Speicher. Weniger Speicher: sie startet schneller und liest lange Dokumente Teil für Teil (sie findet trotzdem, was sie braucht, schlägt nur öfter nach).',
    cloud: 'Für KI-Dienste im Internet (zum Beispiel Claude) spielt das keine Rolle: Sie bringen ihren eigenen Speicher mit.',
    auto: 'Automatisch',
    restart: 'Die KI auf diesem Computer startet beim nächsten Einsatz mit dem neuen Speicher neu (etwa 10 Sekunden).',
  },
}

/** Everything the Settings page shows: { auto, gb, ctx, pages, min, max, options, detected, words }. */
function describe(lang = 'en') {
  const hw = detect()
  const model = modelGB()
  const auto = autoCtx(hw)
  const chosen = chosenGB()
  const ctx = chosen ? ctxForMemory(Math.min(chosen, maxGB(hw)), model) : auto
  const min = memoryForCtx(MIN_CTX, model)
  const max = maxGB(hw)
  const options = []
  for (const c of [8192, 16384, 32768, 65536, 131072, 262144]) {
    const gb = memoryForCtx(c, model)
    if (gb > max + 0.05) break
    options.push({ gb, ctx: c, pages: pagesFor(c) })
  }
  const w = WORDS[/^de/i.test(lang) ? 'de' : 'en']
  return {
    automatic: !chosen,
    gb: chosen ? round1(Math.min(chosen, max)) : memoryForCtx(auto, model),
    ctx,
    pages: pagesFor(ctx),
    auto: { gb: memoryForCtx(auto, model), ctx: auto, pages: pagesFor(auto) },
    min,
    max,
    options,
    model: { gb: model },
    detected: hw,
    words: w,
  }
}

/** Save the lawyer's choice (GB) or null for automatic. */
function set(gb) {
  const ac = require('./agent-config')
  if (gb === null || gb === undefined || gb === '' || gb === 'auto') { ac.save({ localMemoryGB: null }); return describe() }
  const n = Number(gb)
  if (!Number.isFinite(n) || n <= 0) throw new Error('memory must be a number of GB, or "auto"')
  const min = memoryForCtx(MIN_CTX)
  const max = maxGB()
  if (n < min) throw new Error(`at least ${min} GB: the local model alone needs ${modelGB()} GB`)
  ac.save({ localMemoryGB: round1(Math.min(n, max)) })
  return describe()
}

/** GET/POST /api/config/local-memory → { status, json } or null. */
function handle(method, p, params, body = {}) {
  if (p !== '/api/config/local-memory') return null
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  if (method === 'GET') return { status: 200, json: describe(get('lang') || 'en') }
  if (method !== 'POST') return { status: 405, json: { error: 'use GET or POST' } }
  try {
    set(body.auto ? null : body.gb)
    return { status: 200, json: describe(body.lang || 'en') }
  } catch (err) {
    return { status: 400, json: { error: err.message } }
  }
}

module.exports = { detect, modelGB, ctxForMemory, memoryForCtx, pagesFor, maxGB, autoCtx, chosenGB, chosenCtx, effectiveCtx, describe, set, handle, KV_BYTES_PER_TOKEN }
