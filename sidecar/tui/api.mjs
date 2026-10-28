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
}
export const nameOf = (id) => NAMES[id] || (String(id).startsWith('mcp:') ? `connector ${String(id).slice(4)}` : String(id).startsWith('source:') ? `source ${String(id).slice(7)}` : id)

/**
 * One line a lawyer can act on, from whatever went wrong. The raw message is
 * logged; this is what goes on screen.
 */
export function friendly(err) {
  const m = String(err?.message || err || '')
  if (/Blocked by data policy|POLICY_BLOCKED|local-only|not on the allow-list/i.test(m)) return 'Your client-data rule does not allow sending this to the AI model. Change it in Settings → Where client data may go, or use the AI on this computer.'
  if (/outside the approved regions|no pinned region/i.test(m)) return 'This AI model is not in an approved region (EU only). Pick an EU model in Settings, or change the client-data rule.'
  if (/no API key|NO_KEY|no AWS credentials/i.test(m)) return 'There is no key for this AI model yet. Add it in Settings → AI model.'
  if (/401|403|invalid.*key|unauthori[sz]ed|authentication|permission denied/i.test(m)) return 'The AI service did not accept your key. Check the key in Settings → AI model (copy it again from your account page).'
  if (/429|rate limit|quota|insufficient/i.test(m)) return 'The AI service says the account has reached its limit. Try again in a minute, or check your plan with the provider of your key.'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed? ?out|network|socket hang up/i.test(m) && !/engine/i.test(m)) return 'The AI service could not be reached. Check the internet connection (or that the firm server is running) and try again.'
  if (/cannot reach the engine|engine is not running|registry is stale|did not start/i.test(m)) return 'OpenLex is not running in the background. Restart this app; if it keeps happening, see the log file.'
  if (/model not installed|local engine unavailable/i.test(m)) return 'No AI model is installed on this computer yet. Choose Settings → AI model to set one up (or use your own key).'
  if (/model unavailable|not loaded|no model|llama/i.test(m)) return 'The AI model is not ready. Open Settings → AI model to set it up.'
  if (/not a folder|ENOENT|no such file/i.test(m)) return 'That file or folder was not found. Check the path (you can drag the file into this window).'
  if (/matter title is required/i.test(m)) return 'Please give the matter a name.'
  if (/privileged/i.test(m)) return 'This matter is privileged, so its documents stay on this computer. Turn "Privileged" off first if that is really intended.'
  const first = m.split('\n')[0].replace(/^Error:\s*/, '')
  return first.length > 160 ? `${first.slice(0, 157)}…` : first || 'Something went wrong.'
}

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
    runGrid: (id, onEvent, signal) => stream('/api/grids/run', { id }, onEvent, signal),
    exportGrid: (id) => call('POST', '/api/grids/export', { id }),
    proposePlan: (goal, matterId) => call('POST', '/api/plans', { goal, matterId }),
    approvePlan: (id) => call('POST', '/api/plans/approve', { id }),
    runPlan: (id, onEvent, signal) => stream('/api/plans/run', { id }, onEvent, signal),
    decidePlan: (id, stepId, decision) => call('POST', '/api/plans/decide', { id, stepId, decision }),
    getPlan: (id) => call('GET', `/api/plans/get${q({ id })}`),
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

/** "claude-sonnet-5-5 — cloud: Anthropic" / "… — on this computer". */
export function describeModel(info) {
  const st = info?.status?.model
  const prov = info?.providers?.providers?.find((p) => p.id === info?.providers?.active)
  if (!st && !prov) return 'not set up yet'
  const name = st?.name || prov?.model || 'AI model'
  if (prov?.local || st?.local) return `${name} — on this computer${st && !st.loaded ? ' (not ready)' : ''}`
  return `${name} — cloud: ${nameOf(prov?.id || st?.provider)}${isEu(prov?.region) ? ', EU' : ''}`
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
