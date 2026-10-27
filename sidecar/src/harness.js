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
 *
 * Files are re-read when they change (mtime), so edits apply without a
 * restart. Invalid JSON never takes the engine down: that layer is
 * skipped and reported by errors().
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const USER_PATH = path.join(DATA_DIR, 'openlex.json')
const SECTIONS = ['routes', 'hooks', 'agents', 'features']

const DEFAULTS = {
  routes: { roles: {}, rules: [], fallback: [] },
  hooks: {},
  agents: {},
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

/** Merge one section: objects merge by key (one level deep), arrays and scalars replace. */
function mergeSection(base, over) {
  if (over === undefined) return base
  if (!base || typeof base !== 'object' || Array.isArray(base) || !over || typeof over !== 'object' || Array.isArray(over)) return over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? { ...base[k], ...v } : v
  }
  return out
}

/**
 * The effective configuration plus where each section came from.
 * @returns {{ routes, hooks, agents, features, sources: object, locked: string[] }}
 */
function load() {
  const firm = readLayer(firmPath())
  const user = readLayer(USER_PATH)
  const locked = Array.isArray(firm.data?.lock) ? firm.data.lock.filter((s) => SECTIONS.includes(s)) : []
  const out = { sources: {}, locked }
  for (const s of SECTIONS) {
    let v = DEFAULTS[s]
    let src = 'default'
    if (firm.data && firm.data[s] !== undefined) { v = mergeSection(v, firm.data[s]); src = 'firm' }
    if (user.data && user.data[s] !== undefined && !locked.includes(s)) { v = mergeSection(v, user.data[s]); src = src === 'firm' ? 'firm+user' : 'user' }
    out[s] = v
    out.sources[s] = src
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
