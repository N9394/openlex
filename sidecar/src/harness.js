"use strict"
/**
 * Harness configuration — one map of how OpenLex works, customizable at
 * every turn, in layers (later layers win, section by section):
 *
 *   1. built-in defaults (this file)
 *   2. the firm:  <workspace>/openlex.json   (shared, version it like playbooks)
 *   3. the user:  <data dir>/openlex.json
 *
 * The firm can lock sections ("lock": ["routes", "hooks"]); a locked
 * section ignores the user layer. Sections:
 *
 *   routes   which model handles which role (routing.js)
 *   hooks    checks and actions at the harness's decision points (hooks.js)
 *   agents   named agent profiles: instructions, tools, routes, budgets (agents.js)
 *   features switch whole features on or off
 *   sources  the firm's own data and subscriptions as searchable sources (sources.js)
 *   models   model profiles: thinking, tool protocol, temperature, context, extra instructions (models.js)
 *   prompts  the prompt roadmap: change or add instruction blocks and when they are injected (prompts.js)
 *   permissions  what the agent may do without asking: allow / ask / deny patterns (permissions.js)
 *
 * Files are re-read when they change (mtime), so edits apply without a
 * restart. Invalid JSON never takes the engine down: that layer is
 * skipped and reported by errors().
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const USER_PATH = path.join(DATA_DIR, 'openlex.json')
const SECTIONS = ['routes', 'hooks', 'agents', 'features', 'sources', 'models', 'prompts', 'permissions']

const DEFAULTS = {
  routes: { roles: {}, rules: [], fallback: [] },
  hooks: {},
  agents: {},
  sources: {},
  models: {},
  prompts: {},
  permissions: { allow: [], ask: [], deny: [] },
  // shell (run_bash) is off unless a firm turns it on; it also needs an OS sandbox.
  features: { monitors: true, browser: true, skillSuggestions: true, grid: true, plans: true, lists: true, shell: false },
}

function firmPath() {
  try { return require('./workspace').resolve('openlex.json') } catch { return null }
}

const cache = new Map() // path → { mtime, data, error }
function readLayer(file) {
  if (!file) return { data: null, error: null }
  let st
  try { st = fs.statSync(file) } catch { cache.delete(file); return { data: null, error: null } }
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit
  let entry
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('must be a JSON object')
    entry = { mtime: st.mtimeMs, data, error: null }
  } catch (err) {
    entry = { mtime: st.mtimeMs, data: null, error: `${file}: ${err.message}` }
  }
  cache.set(file, entry)
  return entry
}

/**
 * Merge one section: objects merge by key (one level deep), arrays and
 * scalars replace. Permissions add up instead: the firm's deny list must
 * survive a user's own rules (permissions.js decides layer by layer; this
 * merged view is what the map shows).
 */
function mergeSection(base, over, section) {
  if (over === undefined) return base
  if (section === 'permissions' && over && typeof over === 'object' && !Array.isArray(over)) {
    const out = { ...base }
    for (const k of ['allow', 'ask', 'deny']) out[k] = [...new Set([...(Array.isArray(base?.[k]) ? base[k] : []), ...(Array.isArray(over[k]) ? over[k] : [])])]
    const matters = { ...(base?.matters || {}) }
    for (const [id, m] of Object.entries(over.matters && typeof over.matters === 'object' ? over.matters : {})) matters[id] = { allow: [...new Set([...(matters[id]?.allow || []), ...(Array.isArray(m?.allow) ? m.allow : [])])] }
    if (Object.keys(matters).length) out.matters = matters
    return out
  }
  if (!base || typeof base !== 'object' || Array.isArray(base) || !over || typeof over !== 'object' || Array.isArray(over)) return over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? { ...base[k], ...v } : v
  }
  return out
}

/**
 * The effective configuration plus where each section came from.
 * @returns {{ routes, hooks, agents, features, sources, origins: object, locked: string[] }}  (origins: which layer each section came from)
 */
function load() {
  const firm = readLayer(firmPath())
  const user = readLayer(USER_PATH)
  const locked = Array.isArray(firm.data?.lock) ? firm.data.lock.filter((s) => SECTIONS.includes(s)) : []
  const out = { origins: {}, locked }
  for (const s of SECTIONS) {
    let v = DEFAULTS[s]
    let src = 'default'
    if (firm.data && firm.data[s] !== undefined) { v = mergeSection(v, firm.data[s], s); src = 'firm' }
    if (user.data && user.data[s] !== undefined && !locked.includes(s)) { v = mergeSection(v, user.data[s], s); src = src === 'firm' ? 'firm+user' : 'user' }
    out[s] = v
    out.origins[s] = src
  }
  return out
}

function errors() {
  return [readLayer(firmPath()).error, readLayer(USER_PATH).error].filter(Boolean)
}

function feature(name) {
  return load().features[name] !== false
}

/** Raw layer contents (for the settings UI), never merged. */
function layers() {
  return { firm: { path: firmPath(), ...readLayer(firmPath()) }, user: { path: USER_PATH, ...readLayer(USER_PATH) } }
}

/** Write one section of the user layer (the firm layer is edited as a file, under the firm's control). */
function setUserSection(section, value) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown section "${section}" (${SECTIONS.join(', ')})`)
  if (load().locked.includes(section)) throw new Error(`the firm has locked "${section}"`)
  const cur = readLayer(USER_PATH).data || {}
  if (value === null) delete cur[section]
  else cur[section] = value
  fs.mkdirSync(path.dirname(USER_PATH), { recursive: true })
  fs.writeFileSync(USER_PATH, JSON.stringify(cur, null, 2))
  cache.delete(USER_PATH)
  return load()
}

module.exports = { load, errors, feature, layers, setUserSection, SECTIONS, USER_PATH, DEFAULTS }
