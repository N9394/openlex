"use strict"
/**
 * German federal laws from gesetze-im-internet.de, the Federal Ministry of
 * Justice's official consolidated edition (with the Federal Office of
 * Justice): about 6,000 statutes and regulations, current version only,
 * updated daily, "zur freien Nutzung und Weiterverwendung". No key.
 *
 * Online by default, per question:
 *   - the table of contents (gii-toc.xml: title and link of every law) is
 *     fetched once a day and kept in the data folder; a search matches the
 *     law's abbreviation and the words of its title;
 *   - a law's text comes from its official XML (/<abbreviation>/xml.zip),
 *     one section with article ("§ 433").
 *
 * Offline mode (only when the lawyer asks, after seeing the size): every
 * law's xml.zip is downloaded from the official site, one request a
 * second, and indexed on this computer (fts.js). With a local copy,
 * search and get never go online.
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { request, strip, SourceError } = require('./http')
const { paced } = require('./pace')
const localdata = require('./localdata')
const fts = require('./fts')

const BASE = () => (process.env.OPENLEX_GII_BASE || 'https://www.gesetze-im-internet.de').replace(/\/+$/, '')
const SITE = 'https://www.gesetze-im-internet.de'
const LABEL = 'gesetze-im-internet.de'
const GAP_MS = 1000
const TOC_MAX_AGE = 24 * 3600 * 1000
const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,80}$/
const PART = 'all'

const get = (url, opts = {}) => paced('gii', GAP_MS, () => request(url, { label: LABEL, ...opts }))
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&')
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// ── zip (the official xml.zip holds one XML file) ─────────────────────────

/** The files of a zip archive: [{ name, data: Buffer }] (stored or deflated). */
function unzip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new SourceError(`${LABEL} sent a file OpenLex cannot read`, 'bad', 'not a zip')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    if (method === 0) out.push({ name, data: raw })
    else if (method === 8) out.push({ name, data: zlib.inflateRawSync(raw) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// ── the official XML (gii-norm.dtd) ───────────────────────────────────────

/** XML of a <Content> block → plain text, one paragraph a line. */
function contentText(xml) {
  return decode(String(xml)
    .replace(/<noindex>[\s\S]*?<\/noindex>/g, '')
    .replace(/<BR\s*\/?>/gi, '\n')
    .replace(/<\/DT>/gi, ' ')
    .replace(/<\/(P|LA|DD|Title|Subtitle|row)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** { abbreviation, title, date, stand, sections: [{ num, heading, text }] } of a law's XML. */
function parseLaw(xml) {
  const tag = (s, t) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(s); return m ? decode(strip(m[1])) : '' }
  const norms = String(xml).match(/<norm[\s>][\s\S]*?<\/norm>/g) || []
  const head = norms[0] || ''
  const law = {
    abbreviation: tag(head, 'amtabk') || tag(head, 'jurabk'),
    title: tag(head, 'langue') || tag(head, 'kurzue'),
    date: tag(head, 'ausfertigung-datum') || null,
    stand: (() => { const st = [...head.matchAll(/<standtyp>([\s\S]*?)<\/standtyp>\s*<standkommentar>([\s\S]*?)<\/standkommentar>/g)]; const pick = st.find((x) => /^Stand$/.test(x[1].trim())) || st[0]; return pick ? decode(strip(pick[2])) : '' })(),
    sections: [],
  }
  for (const n of norms.slice(1)) {
    const num = tag(n, 'enbez')
    const content = /<textdaten>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/.exec(n)
    const body = content ? contentText(content[1]) : ''
    const gl = /<gliederungseinheit>[\s\S]*?<gliederungsbez>([\s\S]*?)<\/gliederungsbez>[\s\S]*?(?:<gliederungstitel>([\s\S]*?)<\/gliederungstitel>)?/.exec(n)
    if (!num && gl) { law.sections.push({ num: decode(strip(gl[1])), heading: gl[2] ? decode(strip(gl[2])) : '', text: '', structure: true }); continue }
    if (!num && !body) continue
    law.sections.push({ num, heading: tag(n, 'titel'), text: body })
  }
  return law
}

const lawText = (law) => law.sections.map((s) => [[s.num, s.heading].filter(Boolean).join(' '), s.text].filter(Boolean).join('\n')).join('\n\n')
const normNum = (a) => String(a || '').replace(/^\s*(§+|art\.?|artikel)\s*/i, '').trim().toLowerCase()
const sectionOf = (law, article) => { const n = normNum(article); return law.sections.find((s) => !s.structure && normNum(s.num) === n) || null }
const sectionUrl = (slug, num) => `${SITE}/${slug}/${/^art/i.test(String(num)) ? 'art_' : '__'}${normNum(num).replace(/\s+/g, '_')}.html`

// ── the table of contents (cached for a day) ──────────────────────────────

const tocFile = () => path.join(localdata.dirOf('gii'), 'toc.json')

function parseToc(xml) {
  const items = []
  for (const m of String(xml).matchAll(/<item>\s*<title>([\s\S]*?)<\/title>\s*<link>([\s\S]*?)<\/link>\s*<\/item>/g)) {
    const slug = (/gesetze-im-internet\.de\/([^/]+)\/xml\.zip/.exec(m[2]) || [])[1]
    if (slug && SLUG_RE.test(slug)) items.push({ title: decode(m[1]).replace(/\s*\*\)\s*$/, '').trim(), slug })
  }
  return items
}

async function toc() {
  let cached = null
  try { cached = JSON.parse(fs.readFileSync(tocFile(), 'utf8')) } catch { /* none yet */ }
  if (cached && Date.now() - Date.parse(cached.at) < TOC_MAX_AGE) return cached.items
  try {
    const items = parseToc(await (await get(`${BASE()}/gii-toc.xml`)).text())
    if (!items.length) throw new SourceError(`${LABEL} sent a table of contents OpenLex cannot read`, 'bad')
    fs.mkdirSync(path.dirname(tocFile()), { recursive: true })
    fs.writeFileSync(tocFile(), JSON.stringify({ at: new Date().toISOString(), items }))
    return items
  } catch (err) {
    if (cached) return cached.items // yesterday's list is good enough when the site is down
    throw err
  }
}

/** "§ 433 BGB" → { slug: 'bgb', article: '433' }; "BGB" → { slug: 'bgb' }. */
function parseRef(q, items = null) {
  const s = String(q || '').trim()
  const m = /^(?:(§+|art\.?|artikel)\s*([\w.]+)\s+)?([A-Za-zÄÖÜäöüß][\w\-ÄÖÜäöüß./ ]*?)(?:\s+(§+|art\.?|artikel)\s*([\w.]+))?$/i.exec(s)
  if (!m) return null
  const name = m[3].trim()
  const article = m[2] || m[5] || null
  const want = fold(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (!want || !SLUG_RE.test(want)) return null
  if (!items) return { slug: want, article }
  const exact = items.find((x) => x.slug === want)
  if (exact) return { slug: exact.slug, article }
  const prefixed = items.filter((x) => x.slug.startsWith(`${want}_`)).sort((a, b) => a.slug.length - b.slug.length)[0]
  return prefixed ? { slug: prefixed.slug, article } : null
}

// ── local copy (offline mode) ─────────────────────────────────────────────

const copyDir = () => localdata.dirOf('gii', PART)
const metaFile = () => path.join(copyDir(), 'meta.json')
const localMeta = () => { try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')) } catch { return null } }
const hasLocal = () => !!localMeta()?.complete
let index = null
const ix = () => { if (!index) index = fts.open(path.join(copyDir(), 'index')); return index }
const localXml = (slug) => {
  const f = path.join(copyDir(), 'xml', `${slug}.zip`)
  if (!fs.existsSync(f)) return null
  return unzip(fs.readFileSync(f)).find((x) => /\.xml$/i.test(x.name))?.data.toString('utf8') || null
}

async function fetchXml(slug, signal) {
  const res = await get(`${BASE()}/${slug}/xml.zip`, { timeoutMs: 60000 })
  const buf = Buffer.from(await res.arrayBuffer())
  if (signal?.aborted) throw new Error('aborted')
  const xml = unzip(buf).find((x) => /\.xml$/i.test(x.name))
  if (!xml) throw new SourceError(`${LABEL} sent a file OpenLex cannot read`, 'bad', 'no XML in the zip')
  return { buf, xml: xml.data.toString('utf8') }
}

const local = {
  parts: async () => [{ part: PART, label: 'All German federal laws (gesetze-im-internet.de)' }],

  /** The size before anything is downloaded: the list, and the size of a sample of laws, extrapolated. */
  async plan() {
    const items = await toc()
    const step = Math.max(1, Math.floor(items.length / 12))
    const sizes = []
    for (let i = 0; i < items.length && sizes.length < 12; i += step) {
      const n = await paced('gii', GAP_MS, () => localdata.remoteSize(`${BASE()}/${items[i].slug}/xml.zip`))
      if (n) sizes.push(n)
    }
    const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 40000
    const bytes = Math.round(avg * items.length * 2) // the zips, and about as much again for the search index
    return {
      part: PART,
      label: `All German federal laws (${items.length} laws and regulations)`,
      bytes,
      estimate: true,
      from: `${SITE} (official, Federal Ministry of Justice)`,
      licence: connector.licence,
      note: `One request a second: about ${Math.ceil(items.length / 60)} minutes.`,
    }
  },

  async run(_part, { dir, progress, signal }) {
    const items = await toc()
    const xmlDir = path.join(dir, 'xml')
    fs.mkdirSync(xmlDir, { recursive: true })
    try { fs.rmSync(metaFile(), { force: true }) } catch { /* none */ }
    if (index) { index.close(); index = null }
    for (const ext of ['.sqlite', '.jsonl']) try { fs.rmSync(path.join(dir, `index${ext}`), { force: true }) } catch { /* none */ }
    const docs = []
    let bytes = 0
    let failed = 0
    progress({ done: 0, total: items.length, bytes: 0, message: 'Downloading the federal laws from gesetze-im-internet.de…' })
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) throw new Error('aborted')
      const it = items[i]
      try {
        const { buf, xml } = await fetchXml(it.slug, signal)
        fs.writeFileSync(path.join(xmlDir, `${it.slug}.zip`), buf)
        bytes += buf.length
        const law = parseLaw(xml)
        for (const s of law.sections) {
          if (s.structure || !s.text) continue
          docs.push({ id: `${it.slug}#${s.num}`, title: `${s.num} ${law.abbreviation || it.slug.toUpperCase()} ${s.heading}`.trim(), body: s.text, meta: { slug: it.slug, num: s.num, abbreviation: law.abbreviation, law: law.title || it.title } })
        }
      } catch (err) {
        if (signal?.aborted) throw err
        failed++
      }
      progress({ done: i + 1, total: items.length, bytes })
      if (docs.length > 5000) { ix().upsert(docs.splice(0)) }
    }
    progress({ message: 'Building the search index on this computer…' })
    if (docs.length) ix().upsert(docs)
    fs.writeFileSync(metaFile(), JSON.stringify({ complete: true, updated: new Date().toISOString(), laws: items.length - failed, failed }))
  },

  async items() {
    const m = localMeta()
    if (!m?.complete) return []
    return [{ part: PART, label: 'All German federal laws', bytes: localdata.folderBytes(copyDir()), updated: m.updated, stale: Date.now() - Date.parse(m.updated) > 60 * 86400000, licence: connector.licence, laws: m.laws }]
  },

  async remove() {
    if (index) { index.close(); index = null }
    fs.rmSync(copyDir(), { recursive: true, force: true })
  },
}

// ── the connector ─────────────────────────────────────────────────────────

const connector = {
  id: 'gii',
  label: 'German federal laws (gesetze-im-internet.de)',
  country: 'DE',
  jurisdictions: ['DE'],
  kind: 'law',
  description: 'The official consolidated edition of all German federal statutes and regulations (Federal Ministry of Justice), current versions; a law by its abbreviation ("§ 433 BGB") or title words',
  licence: 'Official works, free of copyright (§ 5 UrhG); gesetze-im-internet.de: free use and reuse',
  licenceUrl: 'https://www.gesetze-im-internet.de/hinweise.html',
  homepage: 'https://www.gesetze-im-internet.de',
  needsKey: false,
  guide: 'gii',
  hosts: ['www.gesetze-im-internet.de'],
  sample: '§ 433 BGB',
  de: {
    label: 'Bundesgesetze (gesetze-im-internet.de)',
    description: 'Die amtliche konsolidierte Fassung aller Bundesgesetze und -verordnungen (Bundesministerium der Justiz), aktuelle Fassungen; ein Gesetz über seine Abkürzung („§ 433 BGB“) oder Wörter aus dem Titel',
  },
  local,
  /** With a local copy, nothing goes online. */
  offlineOnly: () => hasLocal(),
  statusNote: (lang) => {
    const m = localMeta()
    if (!m?.complete) return ''
    const day = String(m.updated).slice(0, 10)
    return lang === 'de' ? ` (lokale Kopie vom ${day})` : ` (your local copy from ${day})`
  },

  async search(query, { limit = 8 } = {}) {
    if (hasLocal()) {
      const ref = parseRef(query)
      const hits = ix().search(query, { limit })
      const out = hits.map((h) => ({
        ref: `${h.meta.slug}${h.meta.num ? ` ${h.meta.num}` : ''}`,
        title: h.title,
        citation: connector.citation(h.meta.slug, { abbreviation: h.meta.abbreviation, section: h.meta.num }),
        url: sectionUrl(h.meta.slug, h.meta.num),
        snippet: h.snippet,
        date: null,
        inForce: true,
      }))
      if (ref?.article && localXml(ref.slug)) {
        const law = parseLaw(localXml(ref.slug))
        const s = sectionOf(law, ref.article)
        if (s) out.unshift({ ref: `${ref.slug} ${s.num}`, title: `${s.num} ${law.abbreviation} ${s.heading}`.trim(), citation: connector.citation(ref.slug, { abbreviation: law.abbreviation, section: s.num }), url: sectionUrl(ref.slug, s.num), snippet: s.text.slice(0, 400), date: null, inForce: true })
      }
      return { items: out.slice(0, limit), note: `from your local copy of ${LABEL} (${String(localMeta().updated).slice(0, 10)})` }
    }
    const items = await toc()
    const ref = parseRef(query, items)
    const words = fold(query).match(/[\p{L}\p{N}]{3,}/gu) || []
    const scored = []
    for (const it of items) {
      if (ref && it.slug === ref.slug) { scored.push({ it, score: 1e6 }); continue }
      const t = fold(it.title)
      const hits = words.filter((w) => t.includes(w)).length
      if (hits) scored.push({ it, score: hits * 100 - it.title.length / 100 })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ it }) => {
      const art = ref && it.slug === ref.slug ? ref.article : null
      return {
        ref: art ? `${it.slug} § ${art}` : it.slug,
        title: it.title,
        citation: connector.citation(it.slug, { section: art ? `§ ${art}` : null }),
        url: art ? sectionUrl(it.slug, art) : `${SITE}/${it.slug}/`,
        snippet: art ? `Open § ${art} with get` : 'Federal law, current version (gesetze-im-internet.de)',
        date: null,
        inForce: true,
      }
    })
  },

  /** A law's text from its official XML (one section with article: "§ 433"). Ref: "bgb", "bgb § 433", "§ 433 BGB". */
  async get(ref, { article = null } = {}) {
    const r = String(ref || '').trim()
    const m = /^([a-z0-9][a-z0-9_.-]*)\s+((?:§+|art\.?|artikel)?\s*[\w.]+)$/i.exec(r)
    let slug
    let art = article
    if (m && SLUG_RE.test(m[1].toLowerCase()) && /§|art/i.test(m[2])) { slug = m[1].toLowerCase(); art = art || m[2] }
    else if (SLUG_RE.test(r)) slug = r
    else {
      const p = parseRef(r, hasLocal() ? null : await toc())
      if (!p) throw new SourceError(`${LABEL}: give the law's abbreviation, for example "BGB" or "§ 433 BGB"`, 'bad')
      slug = p.slug
      art = art || p.article
    }
    let xml = hasLocal() ? localXml(slug) : null
    if (!xml && hasLocal()) throw new SourceError(`${LABEL} has no such law in your local copy`, 'notfound')
    if (!xml) xml = (await fetchXml(slug)).xml
    const law = parseLaw(xml)
    const abbr = law.abbreviation || slug.toUpperCase()
    let text = lawText(law)
    let section = null
    if (art) {
      const s = sectionOf(law, art)
      if (!s) throw new SourceError(`${LABEL}: ${/^art/i.test(String(art)) ? '' : '§ '}${normNum(art)} was not found in ${abbr}`, 'notfound')
      section = s.num
      text = [[s.num, s.heading].filter(Boolean).join(' '), s.text].join('\n')
    }
    return {
      ref: section ? `${slug} ${section}` : slug,
      title: [abbr, law.title].filter(Boolean).join(' – '),
      citation: connector.citation(slug, { abbreviation: abbr, section }),
      url: section ? sectionUrl(slug, section) : `${SITE}/${slug}/`,
      text,
      date: law.date,
      ...(law.stand ? { note: law.stand } : {}),
      ...(hasLocal() ? { note: `from your local copy of ${LABEL} (${String(localMeta().updated).slice(0, 10)})${law.stand ? `; ${law.stand}` : ''}` } : {}),
    }
  },

  /** "§ 433 BGB (gesetze-im-internet.de)". */
  citation(ref, x = {}) {
    const abbr = x.abbreviation || String(ref).split(/\s/)[0].toUpperCase()
    return `${x.section ? `${x.section} ` : ''}${abbr} (${LABEL})`
  },
}

module.exports = { ...connector, parseLaw, parseToc, parseRef, unzip, _reset: () => { if (index) index.close(); index = null } }
