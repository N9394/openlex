"use strict"
/**
 * Data sources — plug a firm's own data and its subscriptions into the
 * harness without writing code.
 *
 *   "sources": {
 *     "firm-kb": {
 *       "type": "http", "kind": "firm", "title": "Firm knowledge base",
 *       "url": "https://kb.firm.example/api/search?q={query}&lang={lang}",
 *       "auth": { "header": "Authorization", "prefix": "Bearer " },     // key from the keychain: openlex sources key firm-kb
 *       "results": "hits", "fields": { "title": "title", "text": "snippet", "citation": "ref", "url": "link", "date": "updated" }
 *     },
 *     "commentary": { "type": "mcp", "kind": "commentary", "tool": "mcp__beck__search", "args": { "q": "{query}" }, "jurisdictions": ["DE"] },
 *     "precedents": { "type": "folder", "kind": "firm", "path": "~/Firm/Precedents" }
 *   }
 *
 * kind: law | caselaw | commentary | firm | other  (the agent picks by kind)
 * type:
 *   http    any JSON search API: {query} {jurisdiction} {lang} {limit} in the
 *           URL (or a POST "body"), results at a dotted path, fields mapped by
 *           dotted paths. Auth header from the OS keychain ("source-<name>").
 *   mcp     a tool of a connected MCP server (publisher, DMS, database
 *           connectors). JSON output is mapped like http; plain text becomes
 *           one result.
 *   folder  documents on disk, indexed into the firm library (local).
 *
 * Every search goes through the data policy: http sources on another host
 * and remote MCP servers need "source:<name>" (or the MCP server) on the
 * matter's allow-list; local hosts and folders are local. before_web hooks
 * apply to http sources. Calls are audited without content.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const policy = require('./policy')

const TYPES = ['http', 'mcp', 'folder']
// Built-in law sources (connectors/) are switched on and off in the same
// section: "ris": { "type": "connector", "enabled": false }. They are not
// searched here (see connectors/index.js).
const isConnector = (s) => s?.type === 'connector'

// Ready-made sources a firm can add with `openlex sources add <preset>`.
// Only presets whose responses were checked against the live API.
const PRESETS = {
  oldp: { // Open Legal Data as a firm http source (the built-in connector "openlegaldata" does the same, with full texts)
    type: 'http', kind: 'caselaw', title: 'Open Legal Data (German court decisions)', jurisdictions: ['DE'],
    url: 'https://de.openlegaldata.io/api/cases/search/?text={query}&format=json',
    results: 'results',
    fields: { id: 'id', title: '{court} {decision_type} {date}', text: 'snippets.0.text', citation: '{court} {date} ({decision_type})', url: 'https://de.openlegaldata.io/case/{slug}', date: 'date' },
  },
}
const KINDS = ['law', 'caselaw', 'commentary', 'firm', 'other']
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
const TIMEOUT_MS = 20000
const MAX_TEXT = 1800

function configured() {
  try { return require('./harness').load().sources || {} } catch { return {} }
}

const expandHome = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir())

/** Validate a sources section; returns problems (empty = fine). */
function validate(sources = {}) {
  const problems = []
  for (const [name, s] of Object.entries(sources || {})) {
    const where = `sources.${name}`
    if (isConnector(s)) {
      const ids = require('./connectors').IDS
      if (!ids.includes(name)) problems.push(`${where}: no built-in law source called "${name}" (${ids.join(', ')})`)
      if (s.enabled !== undefined && typeof s.enabled !== 'boolean') problems.push(`${where}: enabled must be true or false`)
      continue
    }
    if (require('./connectors').IDS.includes(name)) { problems.push(`${where}: "${name}" is a built-in law source; use { "type": "connector", "enabled": true|false } or another name`); continue }
    if (!NAME_RE.test(name)) problems.push(`${where}: name must be 2–40 lowercase letters, digits or dashes`)
    if (!s || !TYPES.includes(s.type)) { problems.push(`${where}: type must be one of ${TYPES.join(', ')}`); continue }
    if (s.kind && !KINDS.includes(s.kind)) problems.push(`${where}: kind must be one of ${KINDS.join(', ')}`)
    if (s.type === 'http') {
      try { const u = new URL(String(s.url || '').replace(/\{[a-z]+\}/g, 'x')); if (!/^https?:$/.test(u.protocol)) throw new Error() } catch { problems.push(`${where}: url must be http(s) with {query}`) }
      if (!String(s.url || '').includes('{query}') && !JSON.stringify(s.body || '').includes('{query}')) problems.push(`${where}: put {query} in the url or the body`)
    }
    if (s.type === 'mcp' && !String(s.tool || '').startsWith('mcp__')) problems.push(`${where}: tool must be a connected MCP tool (mcp__<server>__<tool>)`)
    if (s.type === 'folder' && !s.path) problems.push(`${where}: needs a path`)
  }
  return problems
}

function hostOf(s) {
  try { return new URL(String(s.url).replace(/\{[a-z]+\}/g, 'x')).hostname } catch { return '' }
}

/** Is this source on this machine (or the local network)? Local sources need no allow-list. */
function isLocal(name, s) {
  if (s.type === 'folder') return true
  if (s.type === 'http') return require('./decide').isLocalHost(hostOf(s))
  if (s.type === 'mcp') {
    const server = String(s.tool).split('__')[1]
    const st = require('./mcp/client').status().find((x) => x.name === server)
    return st ? !st.remote : false
  }
  return false
}

/** The firm's own sources (built-in law sources are listed by connectors/). */
function own() {
  return Object.fromEntries(Object.entries(configured()).filter(([, s]) => !isConnector(s)))
}

function list() {
  return Object.entries(own()).map(([name, s]) => {
    const problems = validate({ [name]: s })
    return { name, type: s?.type, kind: s?.kind || 'other', title: s?.title || name, jurisdictions: s?.jurisdictions || [], local: problems.length ? null : isLocal(name, s), ...(problems.length ? { error: problems.join('; ') } : {}) }
  })
}

// ── mapping helpers ──────────────────────────────────────────────────────
function at(obj, dotted) {
  if (!dotted) return obj
  return String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** A field spec is a dotted path ("hits.0.title") or a template ("{court} {date}"). */
function field(r, spec, fallback) {
  const sp = spec || fallback
  if (String(sp).includes('{')) {
    const out = String(sp).replace(/\{([\w.]+)\}/g, (m, p) => { const v = at(r, p); return v == null ? '' : (typeof v === 'object' ? (v.name || '') : String(v)) })
    return out.replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim()
  }
  const v = at(r, sp)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v.name || v.title || '') : v
}

function mapItems(json, s, name) {
  let rows = at(json, s.results)
  if (!Array.isArray(rows)) rows = Array.isArray(json) ? json : []
  const f = s.fields || {}
  return rows.slice(0, s.limit || 10).map((r, i) => ({
    source: name,
    kind: s.kind || 'other',
    id: String(field(r, f.id, 'id') ?? `${name}-${i}`),
    title: strip(field(r, f.title, 'title')) || `${name} result ${i + 1}`,
    text: strip(field(r, f.text, 'text')).slice(0, MAX_TEXT),
    citation: strip(field(r, f.citation, 'citation')) || null,
    url: field(r, f.url, 'url') || null,
    date: field(r, f.date, 'date') || null,
    jurisdiction: field(r, f.jurisdiction, 'jurisdiction') || s.jurisdictions?.[0] || null,
  }))
}

function fill(template, vars) {
  return String(template).replace(/\{(query|jurisdiction|lang|limit)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : encodeURIComponent(String(vars[k]))))
}
function fillDeep(v, vars) {
  if (typeof v === 'string') return v.replace(/\{(query|jurisdiction|lang|limit)\}/g, (m, k) => String(vars[k] ?? ''))
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, vars))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, vars)]))
  return v
}

// ── adapters ─────────────────────────────────────────────────────────────
const adapters = {
  async http(name, s, vars) {
    const url = fill(s.url, vars)
    const guard = require('./web/guard')
    if (!isLocal(name, s)) await guard.assertPublicUrl(url) // public sources: no pivot into private networks
    const blocked = await guard.webHook(hostOf(s), `source:${name}`, url)
    if (blocked) throw new Error(blocked)
    const headers = { Accept: 'application/json', 'User-Agent': 'OpenLex (+https://github.com/N9394/openlex)', ...(s.headers || {}) }
    const key = await require('./secrets').getKey(`source-${name}`)
    if (s.auth && key) headers[s.auth.header || 'Authorization'] = `${s.auth.prefix ?? 'Bearer '}${key}`
    const init = { method: s.body ? 'POST' : 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) }
    if (s.body) { init.body = JSON.stringify(fillDeep(s.body, vars)); headers['Content-Type'] = 'application/json' }
    const res = await fetch(url, init)
    if (!res.ok) throw new Error(`${hostOf(s)} → HTTP ${res.status}`)
    return mapItems(await res.json(), s, name)
  },
  async mcp(name, s, vars) {
    const client = require('./mcp/client')
    const r = await client.callTool(s.tool, fillDeep(s.args || { query: '{query}' }, vars))
    const out = String(r.output || '')
    if (/^(BLOCKED|MCP (TOOL )?ERROR)/.test(out)) throw new Error(out.slice(0, 200))
    try { return mapItems(JSON.parse(out), s, name) } catch { /* plain text */ }
    return out.trim() ? [{ source: name, kind: s.kind || 'other', id: `${name}-0`, title: s.title || name, text: out.slice(0, MAX_TEXT * 2), citation: null, url: null, date: null, jurisdiction: null }] : []
  },
  async folder(name, s, vars) {
    const lib = require('./library')
    const dir = path.resolve(expandHome(s.path))
    if (!lib.status().folders.some((f) => path.resolve(f.path) === dir)) {
      if (!fs.existsSync(dir)) throw new Error(`folder not found: ${dir}`)
      await lib.addFolder(dir, '')
    }
    const hits = await lib.search(vars.query, { limit: vars.limit * 3 })
    return (hits || []).filter((h) => h.path && path.resolve(h.path).startsWith(dir + path.sep)).slice(0, vars.limit).map((h, i) => ({
      source: name, kind: s.kind || 'firm', id: `${h.path}#${h.chunk ?? i}`, title: h.title || path.basename(h.path),
      text: String(h.text || '').slice(0, MAX_TEXT), citation: path.basename(h.path), url: null, date: null, jurisdiction: null,
    }))
  },
}

/**
 * Search the configured sources (all, or by name/kind/jurisdiction) in
 * parallel under the data policy. Results keep their source and citation.
 * @returns {Promise<{ results: object[], searched: string[], skipped: object[] }>}
 */
async function search({ query, sources: only, kind, jurisdiction, lang, limit = 5 } = {}) {
  if (!String(query || '').trim()) throw new Error('query required')
  const all = own()
  const matter = policy.currentMatter()
  const skipped = []
  const picked = Object.entries(all).filter(([name, s]) => {
    if (only?.length && !only.includes(name)) return false
    if (kind && (s.kind || 'other') !== kind) return false
    if (jurisdiction && s.jurisdictions?.length && !s.jurisdictions.map((x) => String(x).toUpperCase()).includes(String(jurisdiction).toUpperCase())) return false
    const problems = validate({ [name]: s })
    if (problems.length) { skipped.push({ source: name, reason: problems.join('; ') }); return false }
    if (!isLocal(name, s)) {
      const d = policy.check({ id: `source:${name}`, local: false }, matter)
      if (!d.allowed) {
        policy.audit({ provider: `source:${name}`, model: s.type, matter, call: 'source', decision: 'blocked', reason: d.reason })
        skipped.push({ source: name, reason: `blocked by data policy (allow "source:${name}" for this matter)` })
        return false
      }
    }
    return true
  })
  const vars = { query: String(query), jurisdiction: jurisdiction || '', lang: lang || '', limit }
  const runs = await Promise.all(picked.map(async ([name, s]) => {
    const t0 = Date.now()
    try {
      const items = await adapters[s.type](name, { ...s, limit: Math.min(limit, s.limit || limit) }, vars)
      policy.audit({ provider: `source:${name}`, model: s.type, matter, call: 'source', decision: 'allowed', ok: true, ms: Date.now() - t0, results: items.length })
      return items
    } catch (err) {
      policy.audit({ provider: `source:${name}`, model: s.type, matter, call: 'source', decision: 'allowed', ok: false, ms: Date.now() - t0, error: String(err.message).slice(0, 200) })
      skipped.push({ source: name, reason: String(err.message).slice(0, 200) })
      return []
    }
  }))
  // Interleave by rank so one large source does not crowd out the others.
  const results = []
  for (let i = 0; i < Math.max(0, ...runs.map((r) => r.length)); i++) for (const r of runs) if (r[i]) results.push(r[i])
  return { results, searched: picked.map(([n]) => n), skipped }
}

/** One quick query to check a source works (Settings / `openlex sources test`). */
async function test(name, query = 'contract') {
  const s = own()[name]
  if (!s) throw new Error(`no source "${name}"`)
  const r = await search({ query, sources: [name], limit: 3 })
  if (r.skipped.length) return { ok: false, error: r.skipped[0].reason }
  return { ok: true, results: r.results.length, sample: r.results[0] ? { title: r.results[0].title, citation: r.results[0].citation } : null }
}

/** Add a preset (or a full definition) to the user layer of openlex.json. */
function add(name, def) {
  const d = def || PRESETS[name]
  if (!d) throw new Error(`no preset "${name}" (presets: ${Object.keys(PRESETS).join(', ')})`)
  const problems = validate({ [name]: d })
  if (problems.length) throw new Error(problems.join('; '))
  const harness = require('./harness')
  const cur = harness.layers().user.data?.sources || {}
  harness.setUserSection('sources', { ...cur, [name]: d })
  return { name, ...d }
}

function remove(name) {
  const harness = require('./harness')
  const cur = { ...(harness.layers().user.data?.sources || {}) }
  if (!cur[name]) throw new Error(`no source "${name}" in your layer`)
  delete cur[name]
  harness.setUserSection('sources', Object.keys(cur).length ? cur : null)
}

module.exports = { list, search, test, add, remove, validate, mapItems, isLocal, TYPES, KINDS, PRESETS, adapters }
