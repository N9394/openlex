"use strict"
/**
 * Monitors (Phase 7.4) — watch official sources for new law and changes.
 *
 *   monitor = { id, title, matterId?, source, topics?: [words], everyHours, summarize? }
 *   source  = { type: 'eurlex', query, lang? }   new EU acts whose title matches (Cellar SPARQL)
 *           | { type: 'ris', query }             new Austrian federal gazette entries (RIS BgblAuth)
 *           | { type: 'rss', url }               any RSS/Atom feed (gazettes, courts, regulators)
 *           | { type: 'page', url }              a public page; alerts when its text changes
 *
 * Each check fetches the source, keeps items it has not seen and that are
 * newer than the monitor's start (the first check sets the baseline, it
 * never floods you with history), filters them by topic, and stores them
 * as alerts. Relevance: topic words, or the decision model (System One
 * yes/no) when one is configured. Optional one-line summaries come from
 * the active model.
 *
 * Everything leaves the machine only as the monitor's own query or URL,
 * and only when the data policy allows "web" (for the monitor's matter,
 * or the default policy). Checks run in the engine every 15 minutes for
 * monitors that are due; alerts are also pushed to the hub (Word + app).
 *
 * Storage: <data dir>/monitors.json (monitors + seen ids) and
 * <data dir>/monitor-alerts.jsonl (alerts).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const policy = require('./policy')

const STORE = path.join(DATA_DIR, 'monitors.json')
const ALERTS = path.join(DATA_DIR, 'monitor-alerts.jsonl')
const TYPES = ['eurlex', 'ris', 'rss', 'page']
const MIN_HOURS = 1
const SEEN_MAX = 2000
const UA = 'OpenLex monitor (+https://openlex.dev)'

// ── storage ──────────────────────────────────────────────────────────────
function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { return { monitors: [] } }
}
function store(db) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  fs.writeFileSync(STORE + '.tmp', JSON.stringify(db, null, 1))
  fs.renameSync(STORE + '.tmp', STORE)
}
const publicView = ({ seen, pageHash, pageText, ...m }) => ({ ...m, seenCount: (seen || []).length })

function list(matterId) {
  return load().monitors.filter((m) => matterId === undefined || (m.matterId || null) === (matterId || null)).map(publicView)
}

function clean(input, prev = {}) {
  const src = input.source || prev.source || {}
  const type = String(src.type || '').toLowerCase()
  if (!TYPES.includes(type)) throw new Error(`source.type must be one of ${TYPES.join(', ')}`)
  const source = { type }
  if (type === 'eurlex' || type === 'ris') {
    source.query = String(src.query || '').trim().slice(0, 200)
    if (!source.query) throw new Error(`a ${type} monitor needs a query (words to look for in titles)`)
    if (type === 'eurlex') source.lang = /^[a-z]{2}$/.test(src.lang || '') ? src.lang : 'en'
  } else {
    try { const u = new URL(String(src.url || '')); if (!/^https?:$/.test(u.protocol)) throw new Error() ; source.url = u.toString() } catch { throw new Error(`a ${type} monitor needs an http(s) url`) }
  }
  const topics = (Array.isArray(input.topics) ? input.topics : String(input.topics || '').split(','))
    .map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
  return {
    title: String(input.title || prev.title || (source.query || source.url)).slice(0, 120),
    matterId: input.matterId !== undefined ? (input.matterId || null) : (prev.matterId || null),
    source,
    topics: input.topics !== undefined ? topics : (prev.topics || []),
    everyHours: (() => { const h = Number(input.everyHours ?? prev.everyHours ?? 24); return Math.max(MIN_HOURS, Number.isFinite(h) ? h : 24) })(),
    summarize: input.summarize !== undefined ? !!input.summarize : !!prev.summarize,
    paused: input.paused !== undefined ? !!input.paused : !!prev.paused,
  }
}

function create(input) {
  const db = load()
  const m = { id: crypto.randomBytes(5).toString('hex'), ...clean(input), seen: [], since: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString(), lastRun: null, lastError: null }
  db.monitors.push(m)
  store(db)
  return publicView(m)
}

function update(id, patch) {
  const db = load()
  const m = db.monitors.find((x) => x.id === id)
  if (!m) throw new Error(`no monitor "${id}"`)
  const next = clean({ ...patch }, m)
  // A new source is a new watch: reset the baseline.
  if (JSON.stringify(next.source) !== JSON.stringify(m.source)) Object.assign(m, { seen: [], pageHash: null, pageText: null, since: new Date().toISOString().slice(0, 10) })
  Object.assign(m, next)
  store(db)
  return publicView(m)
}

function remove(id) {
  const db = load()
  const n = db.monitors.length
  db.monitors = db.monitors.filter((x) => x.id !== id)
  if (db.monitors.length === n) throw new Error(`no monitor "${id}"`)
  store(db)
}

// ── sources ──────────────────────────────────────────────────────────────
async function getText(url, accept) {
  const guard = require('./web/guard')
  await guard.assertPublicUrl(url)
  const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA }, signal: AbortSignal.timeout(45000), redirect: 'follow' })
  if (!res.ok) throw new Error(`${new URL(url).hostname} → HTTP ${res.status}`)
  return res.text()
}

// Feeds often escape their HTML (&lt;p&gt;): decode, then strip the tags that appear.
const decode = (s) => { const { htmlToText } = require('./web/eurlex'); return htmlToText(htmlToText(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))).trim() }

/** RSS 2.0 / Atom → [{ id, title, url, date, text }] */
function parseFeed(xml) {
  const items = []
  const blocks = [...String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0])
  for (const b of blocks) {
    const tag = (name) => { const m = b.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : '' }
    const link = (b.match(/<link\b[^>]*href="([^"]+)"/i) || [])[1] || tag('link')
    const title = tag('title')
    const date = tag('pubDate') || tag('updated') || tag('published') || tag('dc:date')
    const id = tag('guid') || tag('id') || link || title
    if (!title && !link) continue
    const d = date ? new Date(date) : null
    items.push({ id: `rss:${id}`, title: title || link, url: link || null, date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null, text: (tag('description') || tag('summary') || tag('content')).slice(0, 600) })
  }
  return items
}

const fetchers = {
  async eurlex(src, since) {
    const { LANG3 } = require('./web/eurlex')
    const L = (LANG3 && LANG3[src.lang]) || 'ENG'
    const words = src.query.toLowerCase().replace(/["\\]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 5)
    const types = ['REG', 'DIR', 'DEC', 'REG_IMPL', 'REG_DEL', 'DIR_IMPL', 'DIR_DEL', 'DEC_IMPL', 'DEC_DEL'].map((t) => `<http://publications.europa.eu/resource/authority/resource-type/${t}>`).join(', ')
    const rows = await require('./web/eurlex').sparql(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex ?date ?title WHERE {
  ?w cdm:work_date_document ?date .
  FILTER(?date >= "${since}"^^xsd:date)
  ?w cdm:resource_legal_id_celex ?celex ; cdm:work_has_resource-type ?type .
  FILTER(?type IN (${types}))
  ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${L}> ; cdm:expression_title ?title .
  ${words.map((w) => `FILTER(CONTAINS(LCASE(STR(?title)), "${w}"))`).join('\n  ')}
} ORDER BY DESC(?date) LIMIT 50`, 60000)
    return rows.map((r) => ({ id: `celex:${r.celex}`, title: r.title, url: `https://eur-lex.europa.eu/legal-content/${src.lang.toUpperCase()}/TXT/?uri=CELEX:${encodeURIComponent(r.celex)}`, date: String(r.date).slice(0, 10), text: '' }))
  },
  async ris(src, since) {
    const API = process.env.OPENLEX_RIS_API || 'https://data.bka.gv.at/ris/api/v2.6'
    const url = `${API}/Bundesrecht?${new URLSearchParams({ Applikation: 'BgblAuth', Suchworte: src.query, ImRisSeit: 'EinemMonat', DokumenteProSeite: 'Fifty' })}`
    const d = JSON.parse(await getText(url, 'application/json'))
    const refs = [].concat(d?.OgdSearchResult?.OgdDocumentResults?.OgdDocumentReference || [])
    return refs.map((ref) => {
      const m = ref.Data?.Metadaten || {}
      const auth = m.Bundesrecht?.BgblAuth || {}
      return { id: `ris:${m.Technisch?.ID}`, title: `${auth.Bgblnummer || ''} ${m.Bundesrecht?.Titel || m.Bundesrecht?.Kurztitel || ''}`.trim(), url: m.Bundesrecht?.Eli || m.Allgemein?.DokumentUrl || null, date: auth.Ausgabedatum || null, text: '' }
    }).filter((x) => x.id !== 'ris:undefined' && (!x.date || x.date >= since))
  },
  async rss(src) {
    return parseFeed(await getText(src.url, 'application/rss+xml, application/atom+xml, application/xml, text/xml'))
  },
  async page(src, since, m) {
    const text = decode(await getText(src.url, 'text/html, */*')).replace(/\s+/g, ' ').slice(0, 200000)
    const hash = crypto.createHash('sha256').update(text).digest('hex')
    if (!m.pageHash) { m.pageHash = hash; m.pageText = text.slice(0, 20000); return [] } // baseline
    if (hash === m.pageHash) return []
    const before = new Set(String(m.pageText || '').split(/(?<=[.!?])\s+/))
    const added = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20 && !before.has(s)).slice(0, 5)
    m.pageHash = hash
    m.pageText = text.slice(0, 20000)
    return [{ id: `page:${hash.slice(0, 16)}`, title: `Changed: ${src.url}`, url: src.url, date: new Date().toISOString().slice(0, 10), text: added.join(' ').slice(0, 600) }]
  },
}

// ── relevance + summary ──────────────────────────────────────────────────
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

async function relevant(m, items) {
  if (!m.topics?.length || !items.length) return items.map((it) => ({ ...it, relevance: null }))
  const decide = require('./decide')
  if (decide.loadConfig()) {
    try {
      const out = []
      for (const it of items) {
        const r = await decide.systemOne({ state: `${it.title}\n${it.text || ''}`, questions: { rel: { type: 'noul', instructions: `Is this new legal text relevant to: ${m.topics.join('; ')}?` } } })
        const p = Number(r.answers.rel?.noul)
        if (p >= 0.5) out.push({ ...it, relevance: Math.round(p * 100) / 100 })
      }
      return out
    } catch { /* fall back to words */ }
  }
  const topics = m.topics.map(fold)
  return items.filter((it) => topics.some((t) => fold(`${it.title} ${it.text}`).includes(t))).map((it) => ({ ...it, relevance: null }))
}

async function summarize(items) {
  const { chat } = require('./llm')
  for (const it of items) {
    try {
      const s = await chat([
        { role: 'system', content: 'You summarise new legislation for lawyers in one sentence. Only what the title and text say; no speculation.' },
        { role: 'user', content: `${it.title}\n${it.text || ''}` },
      ], { maxTokens: 120, temperature: 0, role: 'summarize' })
      it.summary = String(s).replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 400)
    } catch { /* summary is optional */ }
  }
}

// ── check ────────────────────────────────────────────────────────────────
function appendAlerts(alerts) {
  if (!alerts.length) return
  fs.mkdirSync(path.dirname(ALERTS), { recursive: true })
  fs.appendFileSync(ALERTS, alerts.map((a) => JSON.stringify(a)).join('\n') + '\n')
}

/** Check one monitor now. Returns { alerts, checked, error? }. */
async function check(id) {
  const db = load()
  const m = db.monitors.find((x) => x.id === id)
  if (!m) throw new Error(`no monitor "${id}"`)
  return policy.withMatter(m.matterId, async () => {
    const decision = policy.check({ id: 'web', local: false }, m.matterId)
    policy.audit({ provider: 'web', model: m.source.type === 'eurlex' ? 'publications.europa.eu' : m.source.type === 'ris' ? 'data.bka.gv.at' : (() => { try { return new URL(m.source.url).hostname } catch { return '?' } })(), matter: m.matterId, call: 'monitor', decision: decision.allowed ? 'allowed' : 'blocked' })
    m.lastRun = new Date().toISOString()
    const hostOf = m.source.type === 'eurlex' ? 'publications.europa.eu' : m.source.type === 'ris' ? 'data.bka.gv.at' : (() => { try { return new URL(m.source.url).hostname } catch { return '' } })()
    const hookBlock = decision.allowed ? await require('./web/guard').webHook(hostOf, 'monitor', m.source.url || null) : null
    if (hookBlock) {
      m.lastError = hookBlock
      store(db)
      return { alerts: [], checked: 0, error: m.lastError }
    }
    if (!decision.allowed) {
      m.lastError = `blocked by data policy: ${decision.reason}`
      store(db)
      return { alerts: [], checked: 0, error: m.lastError }
    }
    try {
      const items = await fetchers[m.source.type](m.source, m.since, m)
      const seen = new Set(m.seen || [])
      const fresh = items.filter((it) => !seen.has(it.id) && (!it.date || it.date >= m.since))
      for (const it of items) seen.add(it.id)
      m.seen = [...seen].slice(-SEEN_MAX)
      const hits = await relevant(m, fresh)
      if (m.summarize && hits.length) await summarize(hits)
      const alerts = hits.map((it) => ({ id: crypto.randomBytes(6).toString('hex'), monitorId: m.id, monitor: m.title, matterId: m.matterId, title: it.title, url: it.url, date: it.date, text: it.text || '', summary: it.summary || null, relevance: it.relevance, at: new Date().toISOString(), read: false }))
      appendAlerts(alerts)
      m.lastError = null
      store(db)
      if (alerts.length) { try { require('./hub').publish('monitor-alert', { monitorId: m.id, count: alerts.length, title: m.title }, 'engine') } catch { /* hub optional */ } }
      return { alerts, checked: items.length }
    } catch (err) {
      m.lastError = String(err.message || err).slice(0, 300)
      store(db)
      return { alerts: [], checked: 0, error: m.lastError }
    }
  })
}

/** Check every monitor that is due. Called by the engine's timer. */
async function checkDue(now = Date.now()) {
  const out = []
  for (const m of load().monitors) {
    if (m.paused) continue
    if (m.lastRun && now - Date.parse(m.lastRun) < m.everyHours * 3600000) continue
    out.push({ id: m.id, ...(await check(m.id)) })
  }
  return out
}

// ── alerts ───────────────────────────────────────────────────────────────
function readAlerts() {
  try { return fs.readFileSync(ALERTS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

function alerts({ matterId, unread = false, limit = 100 } = {}) {
  return readAlerts().filter((a) => (matterId === undefined || (a.matterId || null) === (matterId || null)) && (!unread || !a.read)).reverse().slice(0, limit)
}

function markRead(ids) {
  const want = new Set(ids === 'all' ? readAlerts().map((a) => a.id) : ids || [])
  const all = readAlerts().map((a) => (want.has(a.id) ? { ...a, read: true } : a))
  fs.mkdirSync(path.dirname(ALERTS), { recursive: true })
  fs.writeFileSync(ALERTS, all.map((a) => JSON.stringify(a)).join('\n') + (all.length ? '\n' : ''))
  return all.filter((a) => !a.read).length
}

/** File an alert into its matter's folder as a short note (provenance kept). */
function fileAlert(id) {
  const a = readAlerts().find((x) => x.id === id)
  if (!a) throw new Error(`no alert "${id}"`)
  const ws = require('./workspace')
  const wf = require('./workflows')
  const base = `${ws.matterFolder(wf.matterLabel(a.matterId))}/monitor-${(a.date || a.at.slice(0, 10))}-${a.id}.md`
  return ws.writeFile(base, [`# ${a.title}`, '', `Source: ${a.url || '—'}`, `Date: ${a.date || '—'} · found by monitor "${a.monitor}" on ${a.at}`, '', a.summary || '', a.text ? `\n> ${a.text}` : ''].join('\n'))
}

let timer = null
function startScheduler(intervalMs = 15 * 60 * 1000) {
  if (timer) return
  const tick = () => checkDue().catch((err) => console.warn('[monitors]', err.message))
  timer = setInterval(tick, intervalMs)
  timer.unref?.()
  setTimeout(tick, 60000).unref?.() // first pass a minute after start
}

module.exports = { list, create, update, remove, check, checkDue, alerts, markRead, fileAlert, parseFeed, fetchers, startScheduler, TYPES }
