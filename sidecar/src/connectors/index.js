"use strict"
/**
 * Law sources — OpenLex connects lawyers to existing law databases instead
 * of keeping its own copy. One list, plain words:
 *
 *   official, free, no key:     RIS Austria (live only in the hours the RIS
 *                               terms allow, else the local copy), EUR-Lex
 *                               (Cellar), German federal law (NeuRIS, test
 *                               phase), Slov-Lex Slovakia, e-Sbírka Czechia
 *                               (CC0 open data; the lawyer's free REST key
 *                               is an optional upgrade)
 *   gateways (own account):     Ansvar (browser sign-in or a service credential)
 *
 * Official paths only: a published API or an official static edition, never
 * the private service behind a website. Where the official path needs a
 * registration or key, OpenLex requires it and says how to get it (the
 * guide in docs/SOURCES.md, one section per source).
 *
 * Every connector has the same shape:
 *
 *   { id, label, country, jurisdictions, kind, description, licence,
 *     licenceUrl, homepage, needsKey, hosts, gateway?,
 *     search(query, { limit, lang, jurisdiction }, { key, saveKey }) → [{ ref, title, citation, url, snippet, date, inForce }]
 *     get(ref, { article, lang }, { key, saveKey })                  → { ref, title, citation, url, text }
 *     citation(ref) → string,
 *     needsKeyWords?, keyWords?(key), signIn?({ store }), statusNote?(),
 *     nightCopy?: { get(), set(on) } }
 *
 * search() may return { items, note } instead of the list, and get() a
 * note: a plain sentence shown with the answer (for example "using your
 * local copy from …").
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
const GUIDE = 'https://github.com/N9394/openlex/blob/main/docs/SOURCES.md'
/** Short, on every law-source answer: this is a look-up, not legal advice. */
const NOTICE = 'Check the official version before relying on it.'
const guideUrl = (c) => `${GUIDE}#${c.guide || c.id}`
/** "needs your free key from the Czech agency (how to get it: …)". */
const keyReason = (c) => `${c.label} ${c.needsKeyWords || 'needs your key'} (how to get it: ${guideUrl(c)})`

function cfg() {
  try {
    const h = require('../harness')
    const all = h.load()
    return { sources: all.sources || {}, locked: all.locked.includes('sources'), firm: h.layers().firm.data?.sources || {} }
  } catch { return { sources: {}, locked: false, firm: {} } }
}

const isOn = (id, c = cfg()) => c.sources[id]?.enabled !== false

/** The keychain, as the connectors see it (tests swap it for a map). */
let store = {
  get: async (name) => require('../secrets').getKey(name),
  set: async (name, value) => (value == null || value === '' ? require('../secrets').deleteKey(name) : require('../secrets').setKey(name, String(value))),
}
const keyOf = async (id) => { try { return await store.get(`source-${id}`) } catch { return null } }
const saverOf = (id) => (value) => store.set(`source-${id}`, value)

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
    const keyWords = hasKey && x.keyWords ? x.keyWords(await keyOf(x.id)) : null
    if (!enabled) { state = 'off'; words = firmOff ? 'off (your firm turned it off)' : 'off' }
    else if (x.needsKey && !hasKey) { state = 'needs_key'; words = `${x.needsKeyWords || 'paste your key'}: how to get it` }
    else if (!online) { state = 'offline'; words = `${keyWords || (x.needsKey ? 'key saved' : 'free')}, but your client-data rule keeps OpenLex offline` }
    else { state = 'ready'; words = keyWords ? `connected, ${keyWords}` : x.gateway ? 'connected with your key' : x.needsKey || (x.optionalKey && hasKey) ? 'connected, free (with your key)' : `connected, free${x.testPhase ? ` (${x.testPhase === true ? 'test phase' : x.testPhase})` : ''}` }
    if (state === 'ready' && x.statusNote) words += x.statusNote()
    return {
      id: x.id, label: x.label, country: x.country, kind: x.kind, description: x.description,
      licence: x.licence, licenceUrl: x.licenceUrl, homepage: x.homepage,
      needsKey: !!x.needsKey, optionalKey: !!x.optionalKey, keyHelp: x.keyHelp || null, guide: guideUrl(x), signIn: !!x.signIn, nightCopy: x.nightCopy ? !!x.nightCopy.get() : null, gateway: !!x.gateway, testPhase: !!x.testPhase,
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
  if (key === null || key === undefined || key === '') { await store.set(`source-${c.id}`, null); return { id: c.id, hasKey: false } }
  if (c.gateway) require('./ansvar').parseKey(key) // throws a plain message for an empty key
  await store.set(`source-${c.id}`, String(key).trim())
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

/** Keep a local copy, fetched in the hours the source allows (RIS Austria). */
function setNightCopy(id, on) {
  const c = connector(id)
  if (!c.nightCopy) throw new SourceError(`${c.label} has no local copy to keep`, 'bad')
  c.nightCopy.set(!!on)
  return { id: c.id, nightCopy: !!on }
}

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
    if (c.needsKey && !key) { if (named || jurisdiction) skipped.push({ source: c.id, reason: keyReason(c) }); continue }
    const blocked = await gate(c)
    if (blocked) { skipped.push({ source: c.id, reason: blocked }); continue }
    ready.push({ c, key })
  }
  const at = new Date().toISOString()
  const notes = []
  const runs = await Promise.all(ready.map(async ({ c, key }) => {
    try {
      const out = await run(c, () => c.search(q, { limit, lang, jurisdiction }, { key, saveKey: saverOf(c.id) }))
      const items = Array.isArray(out) ? out : out?.items || []
      if (out?.note) notes.push({ source: c.id, note: out.note })
      return items.map((it) => withProvenance(c, it, at))
    } catch (err) {
      skipped.push({ source: c.id, reason: plainError(c, err) })
      return []
    }
  }))
  const results = []
  for (let i = 0; i < Math.max(0, ...runs.map((r) => r.length)); i++) for (const r of runs) if (r[i]) results.push(r[i])
  return { results, searched: ready.map(({ c }) => c.id), skipped, ...(notes.length ? { notes } : {}), ...(results.length ? { notice: NOTICE } : {}) }
}

/** One document (or one section of it) with provenance. */
async function get({ source, ref, article = null, lang = 'en' } = {}) {
  const c = connector(source)
  if (!isOn(c.id)) throw new SourceError(`${c.label} is switched off`, 'off')
  if (!String(ref || '').trim()) throw new SourceError(`Say which document of ${c.label} to open`, 'bad')
  const key = await keyOf(c.id)
  if (c.needsKey && !key) throw new SourceError(keyReason(c), 'key')
  const blocked = await gate(c)
  if (blocked) throw new SourceError(`Not looked up: ${blocked}`, 'blocked')
  const doc = await run(c, () => c.get(String(ref).trim(), { article, lang }, { key, saveKey: saverOf(c.id) }))
  return { ...withProvenance(c, doc, new Date().toISOString()), notice: NOTICE }
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

// ── Browser sign-in (Ansvar) ──────────────────────────────────────────────
const signins = new Map() // id → { state, flow, url, userCode, expiresAt, error, cancel }
const view = (id, e) => (e ? { source: id, state: e.state, flow: e.flow, url: e.url, pageUrl: e.pageUrl, userCode: e.userCode, expiresAt: e.expiresAt, opened: !!e.opened, ...(e.error ? { error: e.error } : {}) } : { source: id, state: 'none' })

/**
 * Start a browser sign-in: returns the code to type and the page to open
 * (and opens it, unless open is false). The engine waits for the sign-in in
 * the background and keeps the tokens in the keychain; signInStatus says
 * when it is done.
 */
async function signIn(id, { open = true, pollMs } = {}) {
  const c = connector(id)
  if (!c.signIn) throw new SourceError(`${c.label} has no browser sign-in; paste a key instead`, 'bad')
  signins.get(c.id)?.cancel?.()
  const s = await c.signIn({ store, pollMs })
  const e = { state: 'pending', flow: s.flow, url: s.url, pageUrl: s.pageUrl, userCode: s.userCode, expiresAt: new Date(Date.now() + s.expiresIn * 1000).toISOString(), cancel: s.cancel }
  signins.set(c.id, e)
  s.done.then(async (cred) => {
    if (signins.get(c.id) !== e) return
    await store.set(`source-${c.id}`, cred)
    e.state = 'done'
  }).catch((err) => {
    if (signins.get(c.id) !== e) return
    e.state = err?.code === 'cancelled' ? 'cancelled' : 'failed'
    e.error = err instanceof SourceError ? err.plain : `The ${c.label} sign-in did not work`
  })
  if (open) e.opened = require('./oauth').openBrowser(s.url)
  return view(c.id, e)
}

function signInStatus(id) {
  const c = connector(id)
  return view(c.id, signins.get(c.id))
}

function cancelSignIn(id) {
  const c = connector(id)
  const e = signins.get(c.id)
  if (e && e.state === 'pending') e.cancel?.()
  return view(c.id, e)
}

module.exports = {
  CONNECTORS, IDS, NOTICE, GUIDE, status, setEnabled, setKey, setNightCopy, search, get, citation, test, planned, connector, signIn, signInStatus, cancelSignIn, SourceError,
  _setStore: (s) => { store = s; signins.clear() },
}
