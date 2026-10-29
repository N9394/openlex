"use strict"
/**
 * Law sources — OpenLex connects lawyers to existing law databases instead
 * of keeping its own copy. One list, plain words:
 *
 *   official, free, no key:  RIS Austria, EUR-Lex, German federal law
 *                            (NeuRIS), Slov-Lex Slovakia, e-Sbírka Czechia
 *   paste-a-key gateways:    Ansvar (the lawyer's own subscription)
 *
 * Every connector has the same shape:
 *
 *   { id, label, country, jurisdictions, kind, description, licence,
 *     licenceUrl, homepage, needsKey, hosts, gateway?,
 *     search(query, { limit, lang, jurisdiction }, { key }) → [{ ref, title, citation, url, snippet, date, inForce }]
 *     get(ref, { article, lang }, { key })                  → { ref, title, citation, url, text }
 *     citation(ref) → string }
 *
 * and every result leaves here with its provenance: source, URL, retrieval
 * time and licence.
 *
 * Switching on and off: the harness map's "sources" section, by id
 * ("ris": { "type": "connector", "enabled": false }); built-ins are on by
 * default. A firm can switch one off in its openlex.json and lock the
 * section ("lock": ["sources"]). Keys live in the OS keychain
 * ("source-<id>"), never in a file.
 *
 * Client data: a search sends the search words (never the document) to
 * the source. Official sources count as web access ("web" in the matter's
 * data policy, web/guard.js); a paid gateway is a third party of its own
 * ("source:<id>"). Privileged matters stay offline. Firm before_web hooks
 * apply. Every call is audited without the query.
 */

const policy = require('../policy')
const { SourceError } = require('./http')

const CONNECTORS = [require('./ris'), require('./eurlex'), require('./neuris'), require('./slovlex'), require('./esbirka'), require('./ansvar')]
const BY_ID = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]))
const IDS = CONNECTORS.map((c) => c.id)
const TIMEOUT_MS = 60000

function cfg() {
  try {
    const h = require('../harness')
    const all = h.load()
    return { sources: all.sources || {}, locked: all.locked.includes('sources'), firm: h.layers().firm.data?.sources || {} }
  } catch { return { sources: {}, locked: false, firm: {} } }
}

const isOn = (id, c = cfg()) => c.sources[id]?.enabled !== false
const keyOf = async (id) => { try { return await require('../secrets').getKey(`source-${id}`) } catch { return null } }

/** null when this connector may be contacted for the current matter, else a plain reason. */
async function gate(c) {
  const guard = require('../web/guard')
  if (c.gateway) {
    const matter = policy.currentMatter()
    const d = policy.check({ id: `source:${c.id}`, local: false }, matter)
    policy.audit({ provider: `source:${c.id}`, model: 'connector', matter, call: 'law_source', decision: d.allowed ? 'allowed' : 'blocked', ...(d.allowed ? {} : { reason: d.reason }) })
    if (!d.allowed) return `your client-data rule does not allow ${c.label} for this matter (allow "source:${c.id}" in the data policy)`
  } else if (guard.checkWeb(c.hosts[0], `source:${c.id}`)) {
    return 'your client-data rule keeps OpenLex offline for this matter (allow "web" in the data policy to look things up online)'
  }
  const hook = await guard.webHook(c.hosts[0], `source:${c.id}`)
  return hook ? hook.replace(/^BLOCKED by firm rule:\s*/, 'your firm\'s rule: ') : null
}

/** Would the data policy let this connector go online? (No audit: for the status list.) */
function policyAllows(c, matterId) {
  return policy.check({ id: c.gateway ? `source:${c.id}` : 'web', local: false }, matterId).allowed
}

/** One line per source, in plain words ("RIS Austria: connected, free"). */
async function status({ matterId = null } = {}) {
  const c = cfg()
  return Promise.all(CONNECTORS.map(async (x) => {
    const enabled = isOn(x.id, c)
    const hasKey = !!(await keyOf(x.id))
    const firmOff = c.firm[x.id]?.enabled === false
    const online = policyAllows(x, matterId)
    let state
    let words
    if (!enabled) { state = 'off'; words = firmOff ? 'off (your firm turned it off)' : 'off' }
    else if (x.needsKey && !hasKey) { state = 'needs_key'; words = 'paste your key' }
    else if (!online) { state = 'offline'; words = `${x.needsKey ? 'key saved' : 'free'}, but your client-data rule keeps OpenLex offline` }
    else { state = 'ready'; words = x.needsKey ? 'connected with your key' : `connected, free${x.optionalKey && hasKey ? ' (with your API key)' : ''}${x.testPhase ? ' (test phase)' : ''}` }
    return {
      id: x.id, label: x.label, country: x.country, kind: x.kind, description: x.description,
      licence: x.licence, licenceUrl: x.licenceUrl, homepage: x.homepage,
      needsKey: !!x.needsKey, optionalKey: !!x.optionalKey, keyHelp: x.keyHelp || null, gateway: !!x.gateway, testPhase: !!x.testPhase,
      enabled, hasKey, managedByFirm: c.locked, state, status: `${x.label}: ${words}`,
    }
  }))
}

function connector(id) {
  const c = BY_ID[String(id || '').toLowerCase()]
  if (!c) throw new SourceError(`There is no law source called "${id}" (${IDS.join(', ')})`, 'bad')
  return c
}

/** Switch a source on or off (your own layer; refused when the firm manages the list). */
function setEnabled(id, on) {
  const c = connector(id)
  const h = require('../harness')
  if (h.load().locked.includes('sources')) throw new SourceError('Your firm manages the law sources, so this cannot be changed here. Ask the person who looks after OpenLex at your firm.', 'locked')
  const cur = { ...(h.layers().user.data?.sources || {}) }
  if (on && h.layers().firm.data?.sources?.[c.id]?.enabled !== false) delete cur[c.id]
  else cur[c.id] = { type: 'connector', enabled: !!on }
  h.setUserSection('sources', Object.keys(cur).length ? cur : null)
  return { id: c.id, enabled: !!on }
}

async function setKey(id, key) {
  const c = connector(id)
  const secrets = require('../secrets')
  if (key === null || key === undefined || key === '') { await secrets.deleteKey(`source-${c.id}`); return { id: c.id, hasKey: false } }
  if (c.gateway) require('./ansvar').parseKey(key) // throws a plain message for an empty key
  await secrets.setKey(`source-${c.id}`, String(key))
  return { id: c.id, hasKey: true }
}

const withProvenance = (c, item, at) => ({
  source: c.id,
  sourceLabel: c.label,
  jurisdiction: item.jurisdiction || (c.country !== 'INT' ? c.country : null),
  ...item,
  licence: c.licence,
  retrieved: at,
})

const timeout = (p, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new SourceError(`${label} took too long to answer; try again later`, 'down')), TIMEOUT_MS).unref())])

async function run(c, fn) {
  const matter = policy.currentMatter()
  const t0 = Date.now()
  try {
    const r = await timeout(fn(), c.label)
    policy.audit({ provider: `source:${c.id}`, model: 'connector', matter, call: 'law_source', decision: 'allowed', ok: true, ms: Date.now() - t0, results: Array.isArray(r) ? r.length : 1 })
    return r
  } catch (err) {
    policy.audit({ provider: `source:${c.id}`, model: 'connector', matter, call: 'law_source', decision: 'allowed', ok: false, ms: Date.now() - t0, error: String(err.message).slice(0, 200) })
    throw err
  }
}

const plainError = (c, err) => (err instanceof SourceError ? err.plain : `${c.label} could not be used right now`)

/**
 * Which sources a search would ask: the ones named, else the ones for the
 * jurisdiction, else every official one. A paid gateway is only asked
 * when named, or when no official source covers the jurisdiction.
 */
function pick({ sources: only, jurisdiction } = {}) {
  const c = cfg()
  const J = jurisdiction ? String(jurisdiction).toUpperCase() : null
  const named = Array.isArray(only) && only.length ? new Set(only.map((s) => String(s).toLowerCase())) : null
  const on = CONNECTORS.filter((x) => isOn(x.id, c))
  if (named) return { picked: on.filter((x) => named.has(x.id)), named: true, off: [...named].filter((n) => !on.some((x) => x.id === n)) }
  const official = on.filter((x) => !x.gateway && (!J || x.jurisdictions.includes(J)))
  const gateways = on.filter((x) => x.gateway && (!J ? false : !official.length))
  return { picked: [...official, ...gateways], named: false, off: [] }
}

/** The connectors a search would contact (for permissions and transparency). */
function planned(args = {}) {
  return pick(args).picked
}

/**
 * Search law sources under the data policy.
 * @returns {Promise<{ results: object[], searched: string[], skipped: Array<{source, reason}> }>}
 */
async function search({ query, sources, jurisdiction, lang, limit = 5 } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new SourceError('Type what to look for', 'bad')
  const { picked, named, off } = pick({ sources, jurisdiction })
  const skipped = off.map((id) => ({ source: id, reason: BY_ID[id] ? `${BY_ID[id].label} is switched off` : `there is no law source called "${id}"` }))
  const ready = []
  for (const c of picked) {
    if (c.canSearch && !c.canSearch(q)) { if (named || jurisdiction) skipped.push({ source: c.id, reason: c.searchHint }); continue }
    const key = await keyOf(c.id)
    if (c.needsKey && !key) { if (named) skipped.push({ source: c.id, reason: `${c.label} needs your key (add it under Law sources: /law)` }); continue }
    const blocked = await gate(c)
    if (blocked) { skipped.push({ source: c.id, reason: blocked }); continue }
    ready.push({ c, key })
  }
  const at = new Date().toISOString()
  const runs = await Promise.all(ready.map(async ({ c, key }) => {
    try {
      const items = await run(c, () => c.search(q, { limit, lang, jurisdiction }, { key }))
      return items.map((it) => withProvenance(c, it, at))
    } catch (err) {
      skipped.push({ source: c.id, reason: plainError(c, err) })
      return []
    }
  }))
  const results = []
  for (let i = 0; i < Math.max(0, ...runs.map((r) => r.length)); i++) for (const r of runs) if (r[i]) results.push(r[i])
  return { results, searched: ready.map(({ c }) => c.id), skipped }
}

/** One document (or one section of it) with provenance. */
async function get({ source, ref, article = null, lang = 'en' } = {}) {
  const c = connector(source)
  if (!isOn(c.id)) throw new SourceError(`${c.label} is switched off`, 'off')
  if (!String(ref || '').trim()) throw new SourceError(`Say which document of ${c.label} to open`, 'bad')
  const key = await keyOf(c.id)
  if (c.needsKey && !key) throw new SourceError(`${c.label} needs your key (add it under Law sources: /law)`, 'key')
  const blocked = await gate(c)
  if (blocked) throw new SourceError(`Not looked up: ${blocked}`, 'blocked')
  const doc = await run(c, () => c.get(String(ref).trim(), { article, lang }, { key }))
  return withProvenance(c, doc, new Date().toISOString())
}

/** A citation for a reference, without going online. */
function citation(source, ref) {
  return connector(source).citation(ref)
}

/** One quick live search to check a source works (`openlex sources test ris`). */
async function test(id, query) {
  const c = connector(id)
  const sample = { ris: 'Gewährleistung', eurlex: 'GDPR', neuris: 'Kaufvertrag', slovlex: '513/1991', esbirka: '89/2012', ansvar: 'GDPR right to erasure' }
  const r = await search({ query: query || sample[c.id] || 'contract', sources: [c.id], limit: 3 })
  if (r.skipped.length) return { ok: false, source: c.id, error: r.skipped[0].reason }
  return { ok: true, source: c.id, results: r.results.length, sample: r.results[0] ? { title: r.results[0].title, citation: r.results[0].citation, url: r.results[0].url } : null }
}

module.exports = { CONNECTORS, IDS, status, setEnabled, setKey, search, get, citation, test, planned, connector, SourceError }
