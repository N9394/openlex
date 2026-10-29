/**
 * The terminal app's view of the engine: thin, named calls over the shared
 * client (bin/client.js), plain-language wording for what the engine
 * reports, and a log file (~/.lexvault/logs/tui.log) for the details that
 * never go on screen.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const client = require('../bin/client.js')
const { matchInvocation } = require('../src/agents.js')

export { matchInvocation }

const LOG = path.join(client.LOG_DIR, 'tui.log')

/** Append a line to tui.log (best effort; never throws). */
export function log(what, err) {
  try {
    fs.mkdirSync(client.LOG_DIR, { recursive: true })
    const detail = err ? ` ${err.stack || err.message || err}` : ''
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${what}${detail}\n`)
  } catch { /* logging must not break the app */ }
}

/** Friendly names for where data goes; never "provider". */
export const NAMES = {
  local: 'this computer', anthropic: 'Anthropic', openai: 'OpenAI', azure: 'Azure OpenAI', mistral: 'Mistral',
  openrouter: 'OpenRouter', bedrock: 'AWS Bedrock', vertex: 'Google Vertex', custom: 'your firm server', web: 'web search',
  scaleway: 'Scaleway', ovhcloud: 'OVHcloud', stackit: 'STACKIT', ionos: 'IONOS', 'local-server': 'this computer',
}
export const nameOf = (id) => NAMES[id] || (String(id).startsWith('mcp:') ? `connector ${String(id).slice(4)}` : String(id).startsWith('source:') ? `source ${String(id).slice(7)}` : id)

/** Errors in plain words (bin/friendly.js): friendly() in one line, errorParts() as what · why · what to do. */
const { friendly, errorParts } = require('../bin/friendly.js')
export { friendly, errorParts }

const q = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(); return s ? `?${s}` : '' }

/** Every engine call the screens use. `call` wraps errors: logged in full, shown friendly. */
export function createApi(c = client) {
  const call = async (method, p, body, opts) => {
    try { return await c.request(method, p, body, opts) } catch (err) {
      log(`${method} ${p} failed:`, err)
      throw Object.assign(new Error(friendly(err)), { raw: err.message })
    }
  }
  const stream = (p, body, onEvent, signal) => call('POST', p, body, { onEvent, signal })
  return {
    ensureEngine: (opts) => c.ensureEngine(opts),
    openPath: (f) => c.openPath(f),
    status: () => call('GET', '/api/status'),
    providers: () => call('GET', '/api/providers'),
    useProvider: (id, overrides) => call('POST', '/api/providers', { active: id, ...(overrides && Object.keys(overrides).length ? { provider: id, overrides } : {}) }),
    saveKey: (provider, key) => call('POST', '/api/providers/key', { provider, key }),
    localModels: () => call('GET', '/api/local/models'),
    useLocalModel: (name) => call('POST', '/api/local/use', { name }),
    testProvider: (provider, matterId) => call('POST', '/api/providers/test', { provider, ...(matterId ? { matterId } : {}) }),
    policy: () => call('GET', '/api/policy'),
    setPolicy: (rule) => call('POST', '/api/policy', { rule }),
    setMatterPolicy: (id, rule) => call('POST', '/api/matters/policy', { id, rule }),
    matters: () => call('GET', '/api/matters'),
    createMatter: (m) => call('POST', '/api/matters', m),
    updateMatter: (id, patch) => call('POST', '/api/matters/update', { id, patch }),
    agents: () => call('GET', '/api/agents'),
    skills: () => call('GET', '/api/skills'),
    playbooks: () => call('GET', '/api/workflows/playbooks'),
    documents: (matterId) => call('GET', `/api/workflows/documents${q({ matterId })}`),
    workspace: () => call('GET', '/api/workspace'),
    setWorkspace: (p) => call('POST', '/api/config/workspace', { path: p }),
    addFolder: (p, matterId) => call('POST', '/api/library/folders', { path: p, matterId }),
    chat: (body, onEvent, signal) => stream('/api/chat', body, onEvent, signal),
    runWorkflow: (body, onEvent, signal) => stream('/api/workflows/run', body, onEvent, signal),
    createGrid: (g) => call('POST', '/api/grids', g),
    runGrid: (id, onEvent, signal, extra = {}) => stream('/api/grids/run', { id, ...extra }, onEvent, signal),
    exportGrid: (id) => call('POST', '/api/grids/export', { id }),
    proposePlan: (goal, matterId) => call('POST', '/api/plans', { goal, matterId }),
    approvePlan: (id) => call('POST', '/api/plans/approve', { id }),
    runPlan: (id, onEvent, signal, extra = {}) => stream('/api/plans/run', { id, interactive: true, ...extra }, onEvent, signal),
    answerPermission: (id, decision) => call('POST', '/api/permissions/answer', { id, decision }),
    permissions: () => call('GET', '/api/permissions'),
    permissionRule: (action, pattern, matterId) => call('POST', '/api/permissions/rules', { action, pattern, ...(matterId ? { matterId } : {}) }),
    clearConversation: (docId) => call('POST', '/api/session/clear', { docId }),
    sessions: (matterId) => call('GET', `/api/sessions${q({ matterId })}`),
    session: (id) => call('GET', `/api/session${q({ id })}`),
    followHub: (onEvent, signal) => (c.followHub ? c.followHub(onEvent, signal) : Promise.resolve()),
    decidePlan: (id, stepId, decision) => call('POST', '/api/plans/decide', { id, stepId, decision }),
    getPlan: (id) => call('GET', `/api/plans/get${q({ id })}`),
    activity: (matterId, limit = 20) => call('GET', `/api/activity${q({ matterId, limit })}`),
    record: (params = {}) => call('GET', `/api/record${q(params)}`),
    recordVerify: () => call('GET', '/api/record/verify'),
    recordExport: (body) => call('POST', '/api/record/export', body),
    lawSection: (chunkId) => call('GET', `/api/law/section${q({ chunk_id: chunkId })}`),
    folderInfo: (p) => call('GET', `/api/folder${q({ path: p })}`),
    saveInFolder: (body) => call('POST', '/api/folder/save', body),
    lawSources: (matterId) => call('GET', `/api/sources/law${q({ matterId })}`),
    enableSource: (name, on) => call('POST', '/api/sources/enable', { name, on }),
    saveSourceKey: (name, key) => call('POST', '/api/sources/key', { name, key }),
    startSourceSignIn: (name) => call('POST', '/api/sources/law/signin', { name }),
    sourceSignInStatus: (name) => call('GET', `/api/sources/law/signin${q({ name })}`),
    cancelSourceSignIn: (name) => call('POST', '/api/sources/law/signin/cancel', { name }),
    setSourceNightCopy: (name, on) => call('POST', '/api/sources/law/nightcopy', { name, on }),
    // The tools that moved from the old desktop app: saved items, investigation, due diligence, drafts.
    saved: (matterId) => call('GET', `/api/saved${q({ matterId })}`),
    saveItem: (body) => call('POST', '/api/saved', body),
    batchStart: (body) => call('POST', '/api/batch/start', body),
    batch: (id) => call('GET', `/api/batch${q({ id })}`),
    batchStop: (id) => call('POST', '/api/batch/stop', { id }),
    exportResult: (kind, id, format) => call('POST', `/api/${kind}/export`, { id, format }),
    getResult: (kind, id) => call('GET', `/api/${kind}${q({ id })}`),
    draftCreate: (body) => call('POST', '/api/draft', body),
  }
}

// ── small preferences of the terminal app (not engine settings) ─────────
const PREFS = path.join(client.DATA_DIR, 'tui.json')
export function loadPrefs() { try { return JSON.parse(fs.readFileSync(PREFS, 'utf8')) } catch { return {} } }
export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch }
  try { fs.mkdirSync(path.dirname(PREFS), { recursive: true }); fs.writeFileSync(PREFS, JSON.stringify(next, null, 2)) } catch (err) { log('saving tui.json failed:', err) }
  return next
}

// ── describing the current setup in plain words ─────────────────────────
const isEu = (region) => /^(eu|europe)/i.test(String(region || ''))

/**
 * Which AI, in words: "Claude (Anthropic, EU) — online AI service" or
 * "on this computer". No model ids (those are in Settings → AI).
 */
export function describeModel(info) {
  const st = info?.status?.model
  const prov = info?.providers?.providers?.find((p) => p.id === info?.providers?.active)
  if (!st && !prov) return 'not set up yet'
  if (prov?.local || st?.local) return `on this computer${st && !st.loaded ? ' (not ready)' : ''}`
  if (prov?.id === 'custom') return 'your firm\'s AI server'
  const id = prov?.id || st?.provider
  const model = String(prov?.model || st?.name || '')
  const family = id === 'anthropic' ? 'Claude' : id === 'mistral' ? 'Mistral' : /claude/i.test(model) ? 'Claude' : /gpt|^o\d/i.test(model) ? 'GPT' : /mistral/i.test(model) ? 'Mistral' : /gemini/i.test(model) ? 'Gemini' : ''
  const where = [family && family !== nameOf(id) ? nameOf(id) : '', isEu(prov?.region) ? 'EU' : ''].filter(Boolean).join(', ')
  return `${family && family !== nameOf(id) ? family : nameOf(id)}${where ? ` (${where})` : ''} — online AI service`
}

/** Where client data may go under a rule, in one short phrase. */
export function describeRule(rule, matter) {
  if (matter?.privileged) return 'stays on this computer (privileged)'
  if (!rule || rule.mode !== 'allow-list' || !(rule.providers || []).length) return 'stays on this computer'
  const extras = [rule.regions?.length ? (rule.regions.every(isEu) ? 'EU only' : rule.regions.join(', ')) : '', rule.redact ? 'names hidden' : ''].filter(Boolean)
  return `may go to ${rule.providers.map(nameOf).join(', ')}${extras.length ? ` (${extras.join(', ')})` : ''}`
}

/** Should the first-run setup open? Nothing ready and nothing configured. */
export function needsSetup(info, prefs = {}) {
  if (prefs.setupDone) return false
  const st = info?.status?.model
  const pr = info?.providers
  if (st?.loaded) return false
  if (pr?.active && pr.active !== 'local') return false
  return !(pr?.providers || []).some((p) => p.hasKey)
}

export { client }
