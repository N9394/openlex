"use strict"
/**
 * RIS adapter — Austrian federal law via the official open-data API
 * (data.bka.gv.at, Rechtsinformationssystem des Bundes). API first: no
 * scraping, stable fields, and it says which version is in force.
 *
 * The RIS open-data terms (data.bka.gv.at/ris/api/v2.6, "Welche technischen
 * Limitierungen sind bei der Benutzung der Schnittstellen einzuhalten?")
 * are binding ("zwingend") for every application:
 *   - at most 0.5 requests a second (a two-second pause between requests);
 *   - no parallel connections;
 *   - queries only outside office hours: 20:00–05:00 Vienna time, or at
 *     weekends and on Austrian public holidays;
 *   - anything beyond single look-ups comparable to manual use of the RIS
 *     (a mass download) is announced to ris.it@bka.gv.at first.
 * So every RIS request here goes through one queue (one at a time, two
 * seconds apart) and only inside the window. Outside it, answers come from
 * the lawyer's local copy (what was looked up live before), with the date
 * of that copy; nothing is fetched. "Keep a local copy" (opt-in) fetches
 * what was asked for during the day, and refreshes old copies, in the next
 * window, a few dozen requests a night at most (single look-ups, not a
 * mass download).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const API = () => process.env.OPENLEX_RIS_API || 'https://data.bka.gv.at/ris/api/v2.6'
const PAGE_SIZES = { 10: 'Ten', 20: 'Twenty', 50: 'Fifty', 100: 'OneHundred' }
const UA = 'OpenLex (+https://github.com/N9394/openlex)'
const WINDOW_TEXT = 'RIS only allows live lookups 20:00–05:00 and on weekends'
const NIGHT_MAX = 60 // requests per night for the local copy
const STALE_DAYS = 7

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : [])

// ── the terms: window and pace ────────────────────────────────────────────
let clock = () => new Date()

function easter(y) { // Gregorian computus (Meeus/Jones/Butcher)
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const d = Math.floor(b / 4); const e = b % 4
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(y, month - 1, day)
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Austrian public holidays (gesetzliche Feiertage) of a year, as YYYY-MM-DD. */
function holidays(y) {
  const e = easter(y)
  const day = 86400000
  return new Set([
    `${y}-01-01`, `${y}-01-06`, iso(e + day), `${y}-05-01`, iso(e + 39 * day), iso(e + 50 * day), iso(e + 60 * day),
    `${y}-08-15`, `${y}-10-26`, `${y}-11-01`, `${y}-12-08`, `${y}-12-25`, `${y}-12-26`,
  ])
}

/** Vienna local date, hour and weekday of a moment. */
function vienna(d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday }
}

/** May RIS be queried now? (20:00–05:00 Vienna time, weekends, Austrian holidays.) */
function liveAllowed(d = clock()) {
  const v = vienna(d)
  if (v.hour >= 20 || v.hour < 5) return true
  if (v.weekday === 'Sat' || v.weekday === 'Sun') return true
  return holidays(Number(v.date.slice(0, 4))).has(v.date)
}

const GAP_MS = () => { const n = Number(process.env.OPENLEX_RIS_GAP_MS); return process.env.OPENLEX_RIS_GAP_MS !== undefined && Number.isFinite(n) && n >= 0 ? n : 2000 } // lower only in tests
let chain = Promise.resolve()
let last = 0
/** One RIS request at a time, two seconds after the previous one ended. */
function serial(fn) {
  const run = chain.then(async () => {
    const wait = last + GAP_MS() - Date.now()
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait))
    try { return await fn() } finally { last = Date.now() }
  })
  chain = run.catch(() => {})
  return run
}

class RisClosed extends Error {
  constructor(plain) { super(plain); this.plain = plain; this.code = 'window' }
}

/** fetch() for RIS: inside the window, one at a time, two seconds apart. */
async function risFetch(url, { accept = 'application/json' } = {}) {
  if (!liveAllowed()) throw new RisClosed(`${WINDOW_TEXT} (Vienna time; also on Austrian public holidays)`)
  return serial(async () => {
    const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`RIS → HTTP ${res.status}`)
    return res.text()
  })
}

// ── the local copy ───────────────────────────────────────────────────────
const dir = () => path.join(require('../config').DATA_DIR, 'law-cache', 'ris')
const fileOf = (key) => path.join(dir(), `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`)

function readCopy(key) {
  try { return JSON.parse(fs.readFileSync(fileOf(key), 'utf8')) } catch { return null }
}
function writeCopy(key, req, data) {
  try {
    fs.mkdirSync(dir(), { recursive: true })
    fs.writeFileSync(fileOf(key), JSON.stringify({ key, req, at: clock().toISOString(), data }))
  } catch { /* the copy is a convenience */ }
}

const SETTINGS = () => path.join(dir(), 'settings.json')
function settings() { try { return JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')) } catch { return {} } }
function saveSettings(s) { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(SETTINGS(), JSON.stringify(s)) }
const nightCopyOn = () => settings().nightCopy === true
function setNightCopy(on) { saveSettings({ ...settings(), nightCopy: !!on }); return { nightCopy: !!on } }

const QUEUE = () => path.join(dir(), 'queue.json')
function queue() { try { return JSON.parse(fs.readFileSync(QUEUE(), 'utf8')) } catch { return [] } }
function enqueue(req) {
  if (!nightCopyOn()) return false
  const q = queue()
  if (!q.some((x) => JSON.stringify(x) === JSON.stringify(req))) q.push(req)
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(QUEUE(), JSON.stringify(q.slice(-200)))
  return true
}

/** Outside the window: the local copy, or a plain sentence saying why there is none. */
function fromCopy(key, req) {
  const hit = readCopy(key)
  if (hit) return { data: hit.data, copiedAt: hit.at, note: `${WINDOW_TEXT}; using your local copy from ${hit.at.slice(0, 10)}` }
  const queued = enqueue(req)
  throw new RisClosed(`${WINDOW_TEXT} (Vienna time; also on Austrian public holidays), and there is no local copy of this yet${queued ? '; OpenLex fetches it tonight' : '. Turn on "Keep a local copy" for RIS Austria in /law to have it fetched tonight'}`)
}

// ── look-ups ─────────────────────────────────────────────────────────────

async function liveSearch(query, { limit = 10, inForceOnly = true } = {}) {
  const params = new URLSearchParams({ Applikation: 'BrKons', Suchworte: query, DokumenteProSeite: PAGE_SIZES[limit <= 10 ? 10 : 20] })
  if (inForceOnly) params.set('Fassung.FassungVom', clock().toISOString().slice(0, 10))
  const d = JSON.parse(await risFetch(`${API()}/Bundesrecht?${params}`))
  const docs = d?.OgdSearchResult?.OgdDocumentResults || {}
  const total = parseInt(docs.Hits?.['#text'] || '0', 10)
  const today = clock().toISOString().slice(0, 10)
  const results = asArray(docs.OgdDocumentReference).slice(0, limit).map((ref) => {
    const meta = ref.Data?.Metadaten || {}
    const br = meta.Bundesrecht || {}
    const k = br.BrKons || {}
    const urls = asArray(ref.Data?.Dokumentliste?.ContentReference).flatMap((c) => asArray(c.Urls?.ContentUrl))
    const until = k.Ausserkrafttretensdatum || null
    return {
      id: meta.Technisch?.ID || null,
      title: `${br.Kurztitel || ''} ${k.ArtikelParagraphAnlage || ''}`.trim(),
      abbreviation: k.Abkuerzung || null,
      section: k.ArtikelParagraphAnlage || null,
      inForceFrom: k.Inkrafttretensdatum || null,
      inForceUntil: until,
      inForce: !until || until >= today,
      lastAmendment: [k.NovellenBeziehung, k.NovellenPublikationsorgan, k.NovellenBgblnummer].filter(Boolean).join(' ') || null,
      url: br.Eli || meta.Allgemein?.DokumentUrl || null,
      htmlUrl: urls.find((u) => u.DataType === 'Html')?.Url || null,
    }
  })
  return { total, results }
}

const searchKey = (query, limit, inForceOnly) => `search|${String(query).trim().toLowerCase()}|${limit <= 10 ? 10 : 20}|${inForceOnly ? 1 : 0}`

/**
 * Search consolidated federal law (Bundesrecht konsolidiert): live inside
 * the window (and kept as the local copy), else from the local copy.
 * @returns {Promise<{total:number, results:Array, copiedAt?:string, note?:string}>}
 */
async function searchBundesrecht(query, { limit = 10, inForceOnly = true } = {}) {
  const key = searchKey(query, limit, inForceOnly)
  const req = { kind: 'search', query: String(query), limit, inForceOnly }
  if (!liveAllowed()) {
    const c = fromCopy(key, req)
    return { ...c.data, copiedAt: c.copiedAt, note: c.note }
  }
  const r = await liveSearch(query, { limit, inForceOnly })
  writeCopy(key, req, r)
  return r
}

/** The HTML of one RIS document (live inside the window, else the local copy). */
async function fetchDocument(url) {
  const u = new URL(url)
  const docs = process.env.OPENLEX_RIS_DOCS
  if (!/(^|\.)ris\.bka\.gv\.at$/.test(u.hostname) && !(docs && u.href.startsWith(docs))) throw new Error('not a RIS document URL')
  const key = `doc|${u.href}`
  const req = { kind: 'doc', url: u.href }
  if (!liveAllowed()) {
    const c = fromCopy(key, req)
    return { html: c.data, copiedAt: c.copiedAt, note: c.note }
  }
  const html = await risFetch(u.href, { accept: 'text/html' })
  writeCopy(key, req, html)
  return { html }
}

/** Plain text of one RIS document (HTML content URL from searchBundesrecht). */
async function documentText(htmlUrl) {
  const { html } = await fetchDocument(htmlUrl)
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

// ── the night copy (opt-in) ───────────────────────────────────────────────

/**
 * Inside the window, when "Keep a local copy" is on and the client-data
 * rule allows online look-ups: fetch what was asked for during the day,
 * then refresh copies older than a week. At most NIGHT_MAX requests a night.
 */
async function nightly() {
  if (!nightCopyOn() || !liveAllowed()) return { fetched: 0 }
  const policy = require('../policy')
  if (!policy.check({ id: 'web', local: false }, null).allowed) return { fetched: 0, skipped: 'data policy' }
  const s = settings()
  const night = vienna(new Date(clock().getTime() - 5 * 3600000)).date // a night belongs to the evening it starts
  let used = s.night === night ? s.used || 0 : 0
  const stale = []
  try {
    for (const f of fs.readdirSync(dir())) {
      if (!/^[0-9a-f]{32}\.json$/.test(f)) continue
      try { const c = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')); if (clock().getTime() - Date.parse(c.at) > STALE_DAYS * 86400000 && c.req) stale.push(c.req) } catch { /* skip */ }
    }
  } catch { /* no copy yet */ }
  const done = []
  let fetched = 0
  for (const req of [...queue(), ...stale]) {
    if (used >= NIGHT_MAX || !liveAllowed()) break
    try {
      if (req.kind === 'search') await searchBundesrecht(req.query, { limit: req.limit, inForceOnly: req.inForceOnly })
      else if (req.kind === 'doc') await fetchDocument(req.url)
      fetched++
    } catch { /* try again next night */ }
    used++
    done.push(JSON.stringify(req))
  }
  const left = queue().filter((x) => !done.includes(JSON.stringify(x)))
  try { fs.writeFileSync(QUEUE(), JSON.stringify(left)) } catch { /* none */ }
  saveSettings({ ...settings(), night, used })
  if (fetched) policy.audit({ provider: 'web', model: 'data.bka.gv.at', call: 'ris_night_copy', decision: 'allowed', ok: true, results: fetched })
  return { fetched, left: left.length }
}

let timer = null
function startNightly(intervalMs = 15 * 60 * 1000) {
  if (timer) return
  timer = setInterval(() => nightly().catch(() => {}), intervalMs)
  timer.unref?.()
}

module.exports = {
  searchBundesrecht, documentText, fetchDocument, risFetch, liveAllowed, holidays, nightly, startNightly, nightCopyOn, setNightCopy, queue,
  RisClosed, WINDOW_TEXT,
  _setClock: (fn) => { clock = fn || (() => new Date()) },
}
