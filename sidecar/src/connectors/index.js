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
 *     needsKeyWords?, keyWords?(key), signIn?({ store }), statusNote?(lang),
 *     nightCopy?: { get(), set(on) },
 *     broad?        asked by a search without a jurisdiction (the first six),
 *     community?    kept by someone other than the state (said in the list),
 *     optIn?        off until the lawyer switches it on,
 *     keyId?        shares the key of another id (one PISTE key for France),
 *     ready?(key)   false while there is nothing to search yet (no local
 *                   copy, no key); setupWords: { en, de } then say what to do,
 *     local?        a local copy on this computer (localdata.js),
 *     de?: { label, description, needsKeyWords, keyHelp }   German words for /law,
 *     sample?       a search word for `openlex sources test` }
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
const localdata = require('./localdata')

/** Built-in connectors; a module that is missing in this build is left out. */
const MODULES = [
  './ris', './eurlex', './neuris', './slovlex', './esbirka', './ansvar',
  './legalize', './opencaselaw', './fedlex', './openlegaldata', './gii',
  './ukleg', './ukcaselaw', './bwb', './rechtspraak', './legifrance', './judilibre',
  './ecfr', './govinfo', './courtlistener', './sejm', './saos', './rolegis', './rodata',
]
const CONNECTORS = MODULES.filter((m) => require('fs').existsSync(require('path').join(__dirname, `${m}.js`))).map((m) => require(m))
/**
 * Countries where no open source allows automated access: /law says so and
 * offers the official pages to read in the browser (the lawyer reads, not a
 * program), and docs/SOURCES.md has a template to ask for permission.
 */
const MANUAL = [
  { id: 'hu', country: 'HU', label: 'Hungary', de: { label: 'Ungarn' }, pages: [{ label: 'Nemzeti Jogszabálytár (njt.hu)', url: 'https://njt.hu' }, { label: 'Court decisions (birosag.hu)', url: 'https://eakta.birosag.hu/anonimizalt-hatarozatok' }], why: 'The terms of the national law database (NJT) forbid automated queries, bulk downloads and building a database.' },
  { id: 'cy', country: 'CY', label: 'Cyprus', de: { label: 'Zypern' }, pages: [{ label: 'CyLaw (cylaw.org)', url: 'https://www.cylaw.org' }, { label: 'Official Gazette (mof.gov.cy)', url: 'https://www.mof.gov.cy/mof/gpo/gpo.nsf' }], why: 'CyLaw\'s terms forbid automated indexing; the Official Gazette is not consolidated.' },
  { id: 'za', country: 'ZA', label: 'South Africa', de: { label: 'Südafrika' }, pages: [{ label: 'Acts (gov.za)', url: 'https://www.gov.za/documents/acts' }, { label: 'SAFLII (saflii.org)', url: 'https://www.saflii.org' }, { label: 'Laws.Africa library (lawlibrary.org.za)', url: 'https://lawlibrary.org.za' }], why: 'lawlibrary.org.za is non-commercial and forbids scraping; SAFLII reserves AI use; the Laws.Africa API costs from R500,000 a year.' },
]
/**
 * Sites whose terms limit automated access, for the agent's own browsing
 * too (web/guard.js): no program may read them, or only in given hours.
 * The lawyer can still open them in their own browser.
 */
const HOST_RULES = [
  ...['njt.hu', 'njt.jog.gov.hu'].map((host) => ({ host, rule: 'never', why: 'the terms of Hungary\'s national law database (NJT) forbid automated queries' })),
  ...['cylaw.org'].map((host) => ({ host, rule: 'never', why: 'CyLaw\'s terms forbid automated indexing' })),
  ...['lawlibrary.org.za'].map((host) => ({ host, rule: 'never', why: 'lawlibrary.org.za forbids scraping and bulk downloading' })),
  ...['saflii.org'].map((host) => ({ host, rule: 'never', why: 'SAFLII reserves its content against AI use' })),
  ...['ris.bka.gv.at', 'data.bka.gv.at', 'ogd.ris.bka.gv.at'].map((host) => ({ host, rule: 'ris_window', why: 'RIS only allows automated access 20:00–05:00 Vienna time, at weekends and on Austrian holidays' })),
]

/** null when the agent may open this host now, else one plain sentence. */
function hostRule(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '')
  const r = HOST_RULES.find((x) => h === x.host || h.endsWith(`.${x.host}`))
  if (!r) return null
  if (r.rule === 'ris_window' && require('../web/ris').liveAllowed()) return null
  return `Not opened by OpenLex: ${r.why}. You can open the page in your own browser and read it there.`
}

const MANUAL_WORDS = { en: 'No open source allows automated access here; OpenLex can open pages for you to read (browser)', de: 'Keine offene Quelle erlaubt hier automatischen Zugriff; OpenLex kann Seiten für Sie zum Lesen öffnen (Browser)' }
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

const isOn = (id, c = cfg()) => { const v = c.sources[id]?.enabled; return v === undefined ? !BY_ID[id]?.optIn : v !== false }

/** The keychain, as the connectors see it (tests swap it for a map). */
let store = {
  get: async (name) => require('../secrets').getKey(name),
  set: async (name, value) => (value == null || value === '' ? require('../secrets').deleteKey(name) : require('../secrets').setKey(name, String(value))),
}
const keyName = (id) => `source-${BY_ID[id]?.keyId || id}`
/** Which sources have a key saved (kept in step, for decisions that cannot wait for the keychain). */
const keyed = new Set()
const noteKey = (id, v) => { if (v) keyed.add(id); else keyed.delete(id); return v }
const keyOf = async (id) => { try { return noteKey(id, await store.get(keyName(id))) } catch { return null } }
/** Read the gateways' keys once at start, so the first search knows Ansvar is connected. */
const warm = () => Promise.all(CONNECTORS.filter((c) => c.gateway).map((c) => keyOf(c.id))).catch(() => {})
setImmediate(warm)
const saverOf = (id) => (value) => store.set(keyName(id), value)

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

const W = {
  en: { off: 'off', firmOff: 'off (your firm turned it off)', howTo: 'how to get it', pasteKey: 'paste your key', keySaved: 'key saved', free: 'free', offline: 'but your client-data rule keeps OpenLex offline', connectedFree: 'connected, free', connectedKey: 'connected with your key', connectedFreeKey: 'connected, free (with your key)', connected: 'connected', testPhase: 'test phase', community: 'community source' },
  de: { off: 'aus', firmOff: 'aus (von Ihrer Kanzlei ausgeschaltet)', howTo: 'so erhalten Sie ihn', pasteKey: 'Schlüssel einfügen', keySaved: 'Schlüssel gespeichert', free: 'kostenlos', offline: 'aber Ihre Mandantendaten-Regel hält OpenLex offline', connectedFree: 'verbunden, kostenlos', connectedKey: 'verbunden mit Ihrem Schlüssel', connectedFreeKey: 'verbunden, kostenlos (mit Ihrem Schlüssel)', connected: 'verbunden', testPhase: 'Testphase', community: 'Community-Quelle' },
}

/** The words after "<label>: " in one language. */
function wordsFor(x, lang, { state, firmOff, hasKey, keyWords }) {
  const w = W[lang]
  const de = lang === 'de' ? x.de || {} : {}
  const testPhase = x.testPhase ? (x.testPhase === true ? w.testPhase : lang === 'de' ? de.testPhase || w.testPhase : x.testPhase) : null
  const community = x.community ? ` (${w.community})` : ''
  if (state === 'off') return firmOff ? w.firmOff : w.off
  if (state === 'needs_key') return `${(lang === 'de' ? de.needsKeyWords : x.needsKeyWords) || w.pasteKey}: ${w.howTo}`
  if (state === 'needs_setup') return `${x.setupWords?.[lang] || x.setupWords?.en || w.free}${community}`
  if (state === 'offline') return `${keyWords || (x.needsKey ? w.keySaved : w.free)}, ${w.offline}`
  let words = keyWords ? `${w.connected}, ${keyWords}` : x.gateway ? w.connectedKey : x.needsKey || (x.optionalKey && hasKey) ? w.connectedFreeKey : `${w.connectedFree}${testPhase ? ` (${testPhase})` : ''}`
  words += community
  if (x.statusNote) words += x.statusNote(lang) || ''
  return words
}

/** One line per source, in plain words ("RIS Austria: connected, free"), with the German words as statusDe. */
async function status({ matterId = null } = {}) {
  const c = cfg()
  const list = await Promise.all(CONNECTORS.map(async (x) => {
    const enabled = isOn(x.id, c)
    const key = await keyOf(x.id)
    const hasKey = !!key
    const firmOff = c.firm[x.id]?.enabled === false
    const online = policyAllows(x, matterId)
    let ready = true
    try { ready = x.ready ? !!(await x.ready(key)) : true } catch { ready = false }
    let state
    if (!enabled) state = 'off'
    else if (x.needsKey && !hasKey) state = 'needs_key'
    else if (!ready) state = 'needs_setup'
    else if (!online && !(x.offlineOnly && (() => { try { return x.offlineOnly(key, {}) } catch { return false } })())) state = 'offline'
    else state = 'ready'
    const keyWords = hasKey && x.keyWords ? x.keyWords(key) : null
    const words = wordsFor(x, 'en', { state, firmOff, hasKey, keyWords })
    const wordsDe = wordsFor(x, 'de', { state, firmOff, hasKey, keyWords })
    let local = null
    if (x.local) {
      try { local = { items: await x.local.items(), parts: x.local.parts ? await x.local.parts() : [], jobs: localdata.allJobs(x) } } catch { local = { items: [], parts: [], jobs: [] } }
    }
    return {
      id: x.id, label: x.label, labelDe: x.de?.label || x.label, country: x.country, jurisdictions: x.jurisdictions || [], kind: x.kind, description: x.description, descriptionDe: x.de?.description || null,
      licence: x.licence, licenceUrl: x.licenceUrl, homepage: x.homepage,
      needsKey: !!x.needsKey, optionalKey: !!x.optionalKey, keyHelp: x.keyHelp || null, keyHelpDe: x.de?.keyHelp || null, guide: guideUrl(x), signIn: !!x.signIn, nightCopy: x.nightCopy ? !!x.nightCopy.get() : null, gateway: !!x.gateway, testPhase: !!x.testPhase, community: !!x.community, optIn: !!x.optIn,
      local,
      recommended: !!x.recommended, enabled, hasKey, managedByFirm: c.locked, state, status: `${x.label}: ${words}`, statusDe: `${x.de?.label || x.label}: ${wordsDe}`,
    }
  }))
  list.sort((a, b) => Number(b.recommended) - Number(a.recommended)) // Ansvar (free plan) first, where it covers the country
  for (const m of MANUAL) {
    list.push({
      id: m.id, label: m.label, labelDe: m.de.label, country: m.country, jurisdictions: [m.country], kind: 'manual', description: m.why, descriptionDe: null,
      licence: null, licenceUrl: null, homepage: m.pages[0].url, pages: m.pages, manual: true,
      needsKey: false, optionalKey: false, keyHelp: null, guide: `${GUIDE}#no-automated-access`, signIn: false, nightCopy: null, gateway: false, testPhase: false, community: false, optIn: false, local: null,
      enabled: true, hasKey: false, managedByFirm: c.locked, state: 'manual', status: `${m.label}: ${MANUAL_WORDS.en}`, statusDe: `${m.de.label}: ${MANUAL_WORDS.de}`,
    })
  }
  return list
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
  if (on && !c.optIn && h.layers().firm.data?.sources?.[c.id]?.enabled !== false) delete cur[c.id]
  else if (!on && c.optIn && h.layers().firm.data?.sources?.[c.id]?.enabled !== true) delete cur[c.id]
  else cur[c.id] = { type: 'connector', enabled: !!on }
  h.setUserSection('sources', Object.keys(cur).length ? cur : null)
  return { id: c.id, enabled: !!on }
}

async function setKey(id, key) {
  const c = connector(id)
  if (key === null || key === undefined || key === '') { await store.set(keyName(c.id), null); keyed.delete(c.id); return { id: c.id, hasKey: false } }
  if (c.gateway) require('./ansvar').parseKey(key) // throws a plain message for an empty key
  if (c.checkKey) c.checkKey(String(key).trim()) // throws a plain message for a key of the wrong shape
  await store.set(keyName(c.id), String(key).trim())
  keyed.add(c.id)
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
function pick({ sources: only, jurisdiction, kind } = {}) {
  const c = cfg()
  const J = jurisdiction ? String(jurisdiction).toUpperCase().replace(/^GB$/, 'UK') : null
  const K = kind ? String(kind).toLowerCase() : null
  const named = Array.isArray(only) && only.length ? new Set(only.map((s) => String(s).toLowerCase())) : null
  const on = CONNECTORS.filter((x) => isOn(x.id, c))
  if (named) return { picked: on.filter((x) => named.has(x.id)), named: true, off: [...named].filter((n) => !on.some((x) => x.id === n)) }
  const kindOk = (x) => !K || String(x.kind).split('+').includes(K)
  const official = on.filter((x) => !x.gateway && kindOk(x) && (J ? x.jurisdictions.includes(J) : x.broad))
  // A gateway the lawyer connected (Ansvar) is asked first for the countries it covers;
  // the official sources answer too, as the second source. Without a
  // connected one, it is only asked where no official source exists.
  const gateways = on.filter((x) => x.gateway && J && kindOk(x) && ((x.jurisdictions.includes(J) && keyed.has(x.id)) || !official.length))
  return { picked: [...gateways, ...official], named: false, off: [] }
}

/** The connectors a search would contact (for permissions and transparency). */
function planned(args = {}) {
  return pick(args).picked
}

/**
 * Search law sources under the data policy.
 * @returns {Promise<{ results: object[], searched: string[], skipped: Array<{source, reason}> }>}
 */
async function search({ query, sources, jurisdiction, kind, lang, limit = 5, date } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new SourceError('Type what to look for', 'bad')
  await warm()
  const { picked, named, off } = pick({ sources, jurisdiction, kind })
  const skipped = off.map((id) => ({ source: id, reason: BY_ID[id] ? `${BY_ID[id].label} is switched off` : `there is no law source called "${id}"` }))
  const ready = []
  for (const c of picked) {
    if (c.canSearch && !c.canSearch(q)) { if (named || jurisdiction) skipped.push({ source: c.id, reason: c.searchHint }); continue }
    const key = await keyOf(c.id)
    if (c.needsKey && !key) { if (named || jurisdiction) skipped.push({ source: c.id, reason: keyReason(c) }); continue }
    let usable = true
    try { usable = c.ready ? !!(await c.ready(key, { jurisdiction })) : true } catch { usable = false }
    if (!usable) { if (named) skipped.push({ source: c.id, reason: `${c.label}: ${c.setupWords?.en || 'not set up yet'} (/law)` }); continue }
    const local = !!c.offlineOnly?.(key, { jurisdiction })
    if (!local && offlineOn()) { if (named || jurisdiction) skipped.push({ source: c.id, reason: `you work fully offline and there is no copy of ${c.label} on this computer (/law)` }); continue }
    const blocked = local ? null : await gate(c)
    if (blocked) { skipped.push({ source: c.id, reason: blocked }); continue }
    ready.push({ c, key })
  }
  const at = new Date().toISOString()
  const notes = []
  const runs = await Promise.all(ready.map(async ({ c, key }) => {
    try {
      const out = await run(c, () => c.search(q, { limit, lang, jurisdiction, date, kind }, { key, saveKey: saverOf(c.id) }))
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
async function get({ source, ref, article = null, lang = 'en', date = null } = {}) {
  const c = connector(source)
  if (!isOn(c.id)) throw new SourceError(`${c.label} is switched off`, 'off')
  if (!String(ref || '').trim()) throw new SourceError(`Say which document of ${c.label} to open`, 'bad')
  const key = await keyOf(c.id)
  if (c.needsKey && !key) throw new SourceError(keyReason(c), 'key')
  const offline = c.offlineOnly?.(key, { ref: String(ref).trim(), date })
  if (!offline && offlineOn()) throw new SourceError(`Not looked up: you work fully offline and there is no copy of ${c.label} on this computer (/law)`, 'blocked')
  const blocked = offline ? null : await gate(c)
  if (blocked) throw new SourceError(`Not looked up: ${blocked}`, 'blocked')
  const doc = await run(c, () => c.get(String(ref).trim(), { article, lang, date }, { key, saveKey: saverOf(c.id) }))
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
  const r = await search({ query: query || sample[c.id] || c.sample || 'contract', sources: [c.id], limit: 3 })
  if (r.skipped.length) return { ok: false, source: c.id, error: r.skipped[0].reason }
  return { ok: true, source: c.id, results: r.results.length, sample: r.results[0] ? { title: r.results[0].title, citation: r.results[0].citation, url: r.results[0].url } : null }
}

// ── Local copies (git clones, official bulk downloads) ────────────────────
/** What a download would be: size first, nothing downloaded. */
async function downloadPlan(id, part) {
  const c = connector(id)
  if (!c.local) throw new SourceError(`${c.label} has nothing to download`, 'bad')
  const blocked = await gate(c)
  if (blocked) throw new SourceError(`Not downloaded: ${blocked}`, 'blocked')
  return localdata.plan(c, part)
}

/** Start it, only with confirm: true (the lawyer saw the size and said yes). */
async function download(id, part, { confirm = false, history = false } = {}) {
  const c = connector(id)
  if (!c.local) throw new SourceError(`${c.label} has nothing to download`, 'bad')
  if (!isOn(c.id)) throw new SourceError(`${c.label} is switched off`, 'off')
  const blocked = await gate(c)
  if (blocked) throw new SourceError(`Not downloaded: ${blocked}`, 'blocked')
  policy.audit({ provider: `source:${c.id}`, model: 'connector', matter: policy.currentMatter(), call: 'law_source_download', decision: 'allowed', part: part || null })
  return localdata.start(c, part, { confirm, opts: { history: !!history } })
}

const downloadStatus = (id, part) => localdata.status(connector(id), part)
const cancelDownload = (id, part) => localdata.cancel(connector(id), part)
const removeDownload = (id, part) => localdata.remove(connector(id), part)

/** Keep local copies fresh (git pull and the like), once a day, when the default data rule allows online look-ups. */
async function refreshLocal() {
  if (!policy.check({ id: 'web', local: false }, null).allowed) return { refreshed: 0, skipped: 'data policy' }
  let refreshed = 0
  for (const c of CONNECTORS) {
    if (!c.local?.refresh || !isOn(c.id)) continue
    try { refreshed += (await c.local.refresh()) || 0 } catch { /* next time */ }
  }
  return { refreshed }
}
let refreshTimer = null
function startRefresh(intervalMs = 6 * 3600 * 1000) {
  if (refreshTimer) return
  refreshTimer = setInterval(() => refreshLocal().catch(() => {}), intervalMs)
  refreshTimer.unref?.()
  setTimeout(() => refreshLocal().catch(() => {}), 5 * 60 * 1000).unref?.()
}

// ── "Work fully offline" ──────────────────────────────────────────────────
// Online is the default: every source answers live, nothing is installed.
// The offline mode is one switch: it says what it will download for the
// chosen countries (sizes first), downloads it after a yes, and from then
// on OpenLex only answers from what is on this computer.
const OFFLINE_DEFAULT = ['AT', 'DE', 'EU']
const offlineFile = () => require('path').join(localdata.root(), 'offline.json')
function offlineState() {
  try { const o = JSON.parse(require('fs').readFileSync(offlineFile(), 'utf8')); return { on: !!o.on, countries: Array.isArray(o.countries) && o.countries.length ? o.countries : OFFLINE_DEFAULT } } catch { return { on: false, countries: OFFLINE_DEFAULT } }
}
function saveOffline(o) {
  const fs = require('fs')
  fs.mkdirSync(localdata.root(), { recursive: true })
  fs.writeFileSync(offlineFile(), JSON.stringify(o, null, 2))
}
const offlineOn = () => offlineState().on

/** What each country needs for offline work: [{ source, part, label }]. */
function offlineParts(countries) {
  const out = []
  for (const raw of countries) {
    const C = String(raw).toUpperCase().replace(/^GB$/, 'UK')
    for (const c of CONNECTORS) {
      if (!c.local || c.optIn || !isOn(c.id)) continue
      if (c.id === 'legalize') { if (c.countries?.[C]) out.push({ source: c.id, part: C, label: `${c.label}: ${c.countries[C]}` }) } else if (c.jurisdictions.includes(C)) out.push({ source: c.id, part: null, label: c.label })
    }
  }
  return out
}

/** The offline switch, what is on this computer, and (with plan: true) what turning it on would download. */
async function offline({ countries, plan: wantPlan = false } = {}) {
  const st = offlineState()
  const list = (countries && countries.length ? countries : st.countries).map((x) => String(x).toUpperCase())
  const out = { on: st.on, countries: list }
  if (wantPlan) {
    out.downloads = []
    for (const p of offlineParts(list)) {
      try { out.downloads.push({ ...(await downloadPlan(p.source, p.part)), label: p.label }) } catch (err) { out.downloads.push({ source: p.source, part: p.part, label: p.label, error: err.plain || String(err.message) }) }
    }
    const total = out.downloads.reduce((n, d) => n + (d.bytes || 0), 0)
    out.total = { bytes: total, size: localdata.sizeWords(total, true) }
  }
  return out
}

/**
 * Turn the offline mode on (only with confirm: true, after the plan was
 * shown: then the downloads start) or off (the copies stay until removed).
 */
async function setOffline(on, { countries, confirm = false } = {}) {
  const st = offlineState()
  const list = (countries && countries.length ? countries : st.countries).map((x) => String(x).toUpperCase())
  if (!on) { saveOffline({ on: false, countries: list }); return { on: false, countries: list } }
  if (!confirm) throw new SourceError('Look at what will be downloaded first, then confirm', 'confirm')
  const started = []
  for (const p of offlineParts(list)) {
    try { started.push(await download(p.source, p.part, { confirm: true })) } catch (err) { started.push({ source: p.source, part: p.part, state: 'failed', error: err.plain || String(err.message) }) }
  }
  saveOffline({ on: true, countries: list })
  return { on: true, countries: list, downloads: started }
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
    keyed.add(c.id)
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
  CONNECTORS, IDS, MANUAL, HOST_RULES, hostRule, NOTICE, GUIDE, status, setEnabled, setKey, setNightCopy, search, get, citation, test, planned, connector, signIn, signInStatus, cancelSignIn, SourceError,
  downloadPlan, download, downloadStatus, cancelDownload, removeDownload, refreshLocal, startRefresh, offline, setOffline, offlineOn,
  _setStore: (s) => { store = s; signins.clear(); keyed.clear(); return warm() },
}
