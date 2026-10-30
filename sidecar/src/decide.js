"use strict"
/**
 * Decision models (Phase 9) — the System One API that TypeSafe's Jev
 * defined and Kev (open source) implements:
 *
 *   POST {url}/v1/systemone
 *   { state, model, questions: { <id>: { type: noul|choice|score, instructions, criteria } } }
 *   → { answers: { <id>: { type, noul | choice+probabilities+confidence | score+legend+probabilities+confidence } } }
 *
 * Instead of writing text, a decision model returns a typed answer with a
 * calibrated probability: yes/no, one of up to 255 options, or a level on
 * a rubric. Any endpoint that speaks this API works: a local Kev server,
 * our own decision model, or Jev in the cloud.
 *
 * Config: <data dir>/decide.json  { url, model, region? } for an endpoint,
 * or { provider: "gowa" } for OpenLex's own model in this process
 * (gowa.js). Key (optional, Bearer) in the OS keychain under "decide". The
 * data policy treats the endpoint like any model provider with id
 * "decide": GOWA, an endpoint on this machine or the local network is
 * local; anything else (Jev, a US cloud service) needs "decide" on the
 * matter's allow-list (and an approved region when the policy has
 * regions), and never runs for a privileged matter. Every call is
 * audited, metadata only.
 *
 * backend({ localOnly }) says which of them would answer a task
 * (decide_tasks.js): the configured one, else GOWA when installed.
 */

const fs = require('fs')
const path = require('path')
const net = require('net')
const { DATA_DIR } = require('./config')
const policy = require('./policy')
const secrets = require('./secrets')

const CONFIG_PATH = path.join(DATA_DIR, 'decide.json')
const TYPES = ['noul', 'choice', 'score']
const MAX_OPTIONS = 255
const TIMEOUT_MS = 60000
const MAX_STATE = 200000

const GOWA = { provider: 'gowa', model: 'gowa-small' }

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (c && c.provider === 'gowa') return { ...GOWA }
    return c && c.url ? { url: String(c.url).replace(/\/+$/, ''), model: c.model || 'kev-latest', ...(c.region ? { region: String(c.region) } : {}) } : null
  } catch { return null }
}

function saveConfig(cfg) {
  if (cfg === null) { try { fs.unlinkSync(CONFIG_PATH) } catch { /* not set */ } return null }
  if (cfg && cfg.provider === 'gowa') {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ provider: 'gowa' }, null, 2))
    return { ...GOWA }
  }
  let u
  try { u = new URL(String(cfg.url || '')) } catch { throw new Error('decide: url must be an http(s) URL, e.g. http://127.0.0.1:8009') }
  if (!/^https?:$/.test(u.protocol)) throw new Error('decide: url must be http or https')
  if (u.protocol === 'http:' && !isLocalHost(u.hostname)) throw new Error('decide: a remote endpoint must use https')
  const clean = { url: u.toString().replace(/\/+$/, ''), model: String(cfg.model || 'kev-latest').slice(0, 80) }
  if (cfg.region) clean.region = String(cfg.region).slice(0, 40)
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2))
  return clean
}

/** Loopback, private (RFC 1918 / ULA / link-local) and .local hosts count as this machine or LAN. */
function isLocalHost(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) // last: Tailscale CGNAT
  }
  if (net.isIPv6(h)) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
  return false
}

function descriptor(cfg = loadConfig()) {
  if (!cfg) return null
  if (cfg.provider === 'gowa') return { id: 'decide', label: 'OpenLex model (GOWA)', local: true, host: 'this computer', model: cfg.model, gowa: true }
  const host = new URL(cfg.url).hostname
  return { id: 'decide', label: 'Decision model', local: isLocalHost(host), host, model: cfg.model, ...(cfg.region ? { region: cfg.region } : {}) }
}

// ── request validation (mirrors the API's 422 rules, so errors are local and clear) ──
function cleanQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) throw new Error('questions must be an object { id: question }')
  const ids = Object.keys(questions)
  if (!ids.length) throw new Error('at least one question')
  const out = {}
  for (const id of ids) {
    const q = questions[id] || {}
    if (!TYPES.includes(q.type)) throw new Error(`question "${id}": type must be one of ${TYPES.join(', ')}`)
    const c = { type: q.type }
    if (q.instructions !== undefined) c.instructions = q.instructions
    // OpenLex extension: a question may carry its own state (many short texts in one call).
    if (typeof q.state === 'string' && q.state) c.state = q.state.slice(0, MAX_STATE)
    if (q.type === 'choice') {
      const crit = Array.isArray(q.criteria) ? Object.fromEntries(q.criteria.map((o) => [String(o), null])) : q.criteria
      if (!crit || typeof crit !== 'object' || !Object.keys(crit).length) throw new Error(`question "${id}": a choice needs criteria { option: description|null }`)
      if (Object.keys(crit).length > MAX_OPTIONS) throw new Error(`question "${id}": at most ${MAX_OPTIONS} options`)
      c.criteria = crit
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || !q.criteria.length || q.criteria.length > MAX_OPTIONS) throw new Error(`question "${id}": a score needs 1–${MAX_OPTIONS} levels, lowest first`)
      c.criteria = q.criteria
    } else if (q.criteria) c.criteria = q.criteria
    out[id] = c
  }
  return out
}

/**
 * Ask a decision model. Throws POLICY_BLOCKED when the matter's policy
 * forbids the endpoint, like llm.js does for model providers.
 * @returns {Promise<{answers:object, model:string, latency_ms?:number}>}
 */
async function systemOne({ state, questions, signal, task = null, use = null } = {}) {
  const cfg = use === 'gowa' ? { ...GOWA } : loadConfig()
  if (!cfg) throw new Error('No decision model configured (Settings → Decision model, or POST /api/decide/config { url } or { provider: "gowa" })')
  const qs = cleanQuestions(questions)
  const own = Object.values(qs).filter((q) => q.state).length
  if ((state === undefined || state === null || state === '') && own < Object.keys(qs).length) throw new Error('state is required')
  const p = descriptor(cfg)
  const matter = policy.currentMatter()
  if (p.gowa) return gowaCall({ state, qs, signal, task, matter })
  // An endpoint takes one state per request: questions with their own state go in groups.
  if (own) {
    const groups = new Map()
    for (const [id, q] of Object.entries(qs)) {
      const { state: st, ...rest } = q
      const key = st || state
      if (!groups.has(key)) groups.set(key, {})
      groups.get(key)[id] = rest
    }
    const answers = {}
    let model = cfg.model
    for (const [st, group] of groups) {
      const r = await systemOne({ state: st, questions: group, signal, task, use })
      Object.assign(answers, r.answers)
      model = r.model
    }
    return { answers, model }
  }
  let decision = policy.check(p, matter)
  if (decision.allowed && !p.local && privileged(matter)) decision = { allowed: false, reason: 'this matter is privileged and stays on this computer' }
  if (!decision.allowed) {
    policy.audit({ provider: 'decide', model: cfg.model, host: p.host, matter, call: 'systemone', decision: 'blocked', reason: decision.reason })
    const err = new Error(`Blocked by data policy: ${decision.reason}.`)
    err.code = 'POLICY_BLOCKED'
    throw err
  }
  const key = await secrets.getKey('decide')
  const body = JSON.stringify({ state, model: cfg.model, questions: qs })
  const t0 = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  signal?.addEventListener?.('abort', () => ac.abort())
  try {
    const r = await fetch(`${cfg.url}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body,
      signal: ac.signal,
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`decision model HTTP ${r.status}: ${text.slice(0, 200)}`)
    const json = JSON.parse(text)
    if (!json.answers || typeof json.answers !== 'object') throw new Error('decision model returned no answers')
    policy.audit({ provider: 'decide', model: cfg.model, host: p.host, ...(p.region ? { region: p.region } : {}), matter, call: 'systemone', decision: 'allowed', ok: true, ms: Date.now() - t0, inChars: body.length, questions: Object.keys(qs).length })
    return { answers: json.answers, model: json.model || cfg.model, ...(json.latency_ms !== undefined ? { latency_ms: json.latency_ms } : {}) }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'decision model timed out or was cancelled' : err.message
    policy.audit({ provider: 'decide', model: cfg.model, host: p.host, matter, call: 'systemone', decision: 'allowed', ok: false, ms: Date.now() - t0, error: String(msg).slice(0, 200) })
    throw new Error(msg)
  } finally {
    clearTimeout(timer)
  }
}

function privileged(matterId) {
  try { return !!(matterId && require('./matters').get(matterId)?.privileged) } catch { return false }
}

/** OpenLex's own model in this process: local by construction, audited like any call (metadata only). */
async function gowaCall({ state, qs, signal, task, matter }) {
  const gowa = require('./gowa')
  const t0 = Date.now()
  try {
    const r = await gowa.systemOne({ state, questions: qs, task, signal })
    policy.audit({ provider: 'decide', model: r.model, host: 'this computer', local: true, matter, call: 'systemone', decision: 'allowed', ok: true, ms: Date.now() - t0, questions: Object.keys(qs).length, ...(task ? { task } : {}) })
    return r
  } catch (err) {
    policy.audit({ provider: 'decide', model: 'gowa-small', host: 'this computer', local: true, matter, call: 'systemone', decision: 'allowed', ok: false, ms: Date.now() - t0, error: String(err.message).slice(0, 200) })
    throw err
  }
}

/**
 * Which decision model would answer: the configured endpoint or GOWA, else
 * GOWA when installed (no configuration needed for the model on this
 * computer). localOnly: content that must not leave this computer (the
 * redaction check) — a cloud endpoint is skipped.
 * @returns {null | { use: 'gowa'|null, descriptor }}
 */
function backend({ localOnly = false } = {}) {
  const cfg = loadConfig()
  const d = cfg ? descriptor(cfg) : null
  const gowaReady = () => { try { return require('./gowa').ready() } catch { return false } }
  if (d && d.gowa) return gowaReady() ? { use: 'gowa', descriptor: d } : null
  if (d && (d.local || !localOnly)) return { use: null, descriptor: d }
  if (gowaReady()) return { use: 'gowa', descriptor: descriptor({ ...GOWA }) }
  return null
}

/**
 * Convenience: the winning answer per question plus how sure the model is,
 * as one shape for all three types:
 *   { id: { answer, p, confidence, probabilities? } }
 * noul → answer true/false, p = probability of that answer.
 */
function summarize(answers) {
  const out = {}
  for (const [id, a] of Object.entries(answers || {})) {
    if (a.type === 'noul') { const yes = Number(a.noul); out[id] = { answer: yes >= 0.5, p: yes >= 0.5 ? yes : 1 - yes, confidence: Math.abs(yes - 0.5) * 2 } }
    else if (a.type === 'choice') out[id] = { answer: a.choice, p: a.probabilities?.[a.choice] ?? null, confidence: a.confidence ?? null, probabilities: a.probabilities }
    else if (a.type === 'score') out[id] = { answer: a.score, level: a.legend?.[String(Math.round(a.score))] ?? null, confidence: a.confidence ?? null, probabilities: a.probabilities }
  }
  return out
}

/** Settings → Test: models list from the endpoint (policy still applies to the call itself). */
async function test() {
  const cfg = loadConfig()
  if (!cfg) return { ok: false, error: 'not configured' }
  const r = await systemOne({ state: 'The contract is governed by Austrian law.', questions: { austrian: { type: 'noul', instructions: 'Is Austrian law chosen?' } } })
  const yes = Number(r.answers.austrian?.noul)
  return { ok: Number.isFinite(yes), model: r.model, sample: yes, latency_ms: r.latency_ms ?? null }
}

module.exports = { loadConfig, saveConfig, descriptor, isLocalHost, cleanQuestions, systemOne, summarize, backend, test, CONFIG_PATH }
