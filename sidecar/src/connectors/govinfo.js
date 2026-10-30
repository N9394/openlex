"use strict"
/**
 * GovInfo — the US Government Publishing Office's official publications
 * (api.govinfo.gov): the United States Code (USCODE), public and private
 * laws (PLAW) and opinions of the federal courts (USCOURTS). Works of the
 * US government, free of copyright (17 U.S.C. § 105).
 *
 * Needs the lawyer's own free key from api.data.gov (instant, name and
 * e-mail), sent as the X-Api-Key header. api.data.gov allows 1,000
 * requests an hour per key; OpenLex sends one at a time, a second apart.
 *
 *   POST /search                                          { query, pageSize, offsetMark }
 *   GET  /packages/{package}/granules/{granule}/summary   metadata and download links
 *   GET  …/htm (USCODE, PLAW) or …/pdf (USCOURTS)          the text
 */

const { request, getJson, htmlToText, strip, SourceError } = require('./http')
const { paced } = require('./pace')
const { sliceSection } = require('./text')

const BASE = () => (process.env.OPENLEX_GOVINFO_API || 'https://api.govinfo.gov').replace(/\/+$/, '')
const LABEL = 'GovInfo'
const GAP_MS = 1000
const COLLECTIONS = { law: ['USCODE', 'PLAW'], caselaw: ['USCOURTS'] }
const REF_RE = /^[A-Z]+-[\w.-]+(\/[A-Z]+-[\w.-]+)?$/
const KINDS = { USCODE: 'United States Code', PLAW: 'Public law', USCOURTS: 'Federal court opinion' }

const call = (fn) => paced('govinfo', GAP_MS, fn)
const hdr = (key) => ({ 'X-Api-Key': String(key || '') })

/** Same host only: the key is never sent anywhere else. */
function own(url) {
  const u = new URL(url, BASE())
  const base = new URL(BASE())
  if (u.host !== base.host && u.host !== 'api.govinfo.gov') throw new SourceError(`${LABEL} sent a link OpenLex does not follow`, 'bad', u.host)
  if (u.host === 'api.govinfo.gov' && u.host !== base.host) return `${BASE()}${u.pathname}${u.search}`
  return `${base.protocol}//${base.host}${u.pathname}${u.search}`
}

function citationOf(r) {
  const g = String(r.granuleId || '')
  let m = g.match(/^USCODE-\d{4}-title(\d+)[\w-]*?-sec([\w.-]+)$/)
  if (m) return `${m[1]} U.S.C. § ${m[2]} (GovInfo)`
  m = String(r.packageId || '').match(/^PLAW-(\d+)(publ|pvtl)(\d+)$/)
  if (m) return `${m[2] === 'publ' ? 'Pub. L.' : 'Priv. L.'} ${m[1]}-${m[3]} (GovInfo)`
  if (r.collectionCode === 'USCOURTS') return `${strip(r.title || '')}${r.dateIssued ? `, ${r.dateIssued}` : ''} (GovInfo, ${r.packageId})`
  return `${r.granuleId || r.packageId} (GovInfo)`
}

const connector = {
  id: 'govinfo',
  label: 'GovInfo (US Code, laws, federal courts)',
  country: 'US',
  jurisdictions: ['US'],
  kind: 'law+caselaw',
  description: 'Official publications of the US Government Publishing Office: the United States Code, public laws, and opinions of the federal courts',
  licence: 'US government work, public domain (17 U.S.C. § 105)',
  licenceUrl: 'https://www.govinfo.gov/about/policies',
  homepage: 'https://www.govinfo.gov',
  needsKey: true,
  needsKeyWords: 'needs your free key from api.data.gov',
  keyHelp: 'Free and instant: open https://api.data.gov/signup, enter your name and e-mail, and copy the key from the e-mail or the page. Paste it here.',
  guide: 'govinfo',
  hosts: ['api.govinfo.gov'],
  sample: 'securities fraud',
  de: {
    label: 'GovInfo (US Code, Gesetze, Bundesgerichte)',
    description: 'Amtliche Veröffentlichungen des US Government Publishing Office: United States Code, Bundesgesetze und Urteile der Bundesgerichte',
    needsKeyWords: 'braucht Ihren kostenlosen Schlüssel von api.data.gov',
    keyHelp: 'Kostenlos und sofort: https://api.data.gov/signup öffnen, Name und E-Mail eingeben, den Schlüssel kopieren und hier einfügen.',
  },

  checkKey(key) {
    if (!/^[A-Za-z0-9]{20,64}$/.test(String(key).trim())) throw new SourceError('That does not look like an api.data.gov key (40 letters and digits)', 'key')
  },

  /** kind: "law" (US Code, public laws), "caselaw" (court opinions); both when not given. */
  async search(query, { limit = 8, kind = null } = {}, { key = null } = {}) {
    const cols = COLLECTIONS[kind] || [...COLLECTIONS.law, ...COLLECTIONS.caselaw]
    const words = String(query).replace(/[()\\]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!words) return []
    const body = { query: `(${cols.map((c) => `collection:${c}`).join(' OR ')}) AND (${words})`, pageSize: Math.min(limit, 20), offsetMark: '*', sorts: [{ field: 'score', sortOrder: 'DESC' }] }
    const res = await call(() => request(`${BASE()}/search`, { label: LABEL, method: 'POST', headers: { ...hdr(key), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }))
    let j
    try { j = await res.json() } catch { throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not JSON') }
    if (!Array.isArray(j?.results)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no results')
    return j.results.slice(0, limit).map((r) => ({
      ref: r.granuleId ? `${r.packageId}/${r.granuleId}` : r.packageId,
      title: `${KINDS[r.collectionCode] || r.collectionCode}: ${strip(r.title || r.granuleId || r.packageId)}`,
      citation: citationOf(r),
      url: `https://www.govinfo.gov/app/details/${r.packageId}${r.granuleId ? `/${r.granuleId}` : ''}`,
      snippet: [(r.governmentAuthor || []).join(', '), r.dateIssued ? `issued ${r.dateIssued}` : ''].filter(Boolean).join(' · '),
      date: r.dateIssued || null,
      inForce: null,
    }))
  },

  /** The text of a US Code section, a public law or a court opinion (one § of a long text with article). */
  async get(ref, { article = null } = {}, { key = null } = {}) {
    const id = String(ref || '').trim()
    if (!REF_RE.test(id)) throw new SourceError(`${LABEL}: give the reference from a search result (for example USCODE-2024-title15/USCODE-2024-title15-chap2B-sec78a)`, 'bad')
    const [pkg, granule] = id.split('/')
    const path = granule ? `/packages/${pkg}/granules/${granule}/summary` : `/packages/${pkg}/summary`
    const meta = await call(() => getJson(`${BASE()}${path}`, { label: LABEL, headers: hdr(key) }))
    const dl = meta.download || {}
    let text = ''
    let note = null
    if (dl.txtLink) {
      const res = await call(() => request(own(dl.txtLink), { label: LABEL, headers: { ...hdr(key), Accept: 'text/html' } }))
      text = htmlToText(String(await res.text()).replace(/<!--[\s\S]*?-->/g, ''))
    } else if (dl.pdfLink) {
      const res = await call(() => request(own(dl.pdfLink), { label: LABEL, headers: { ...hdr(key), Accept: 'application/pdf' } }))
      const buf = Buffer.from(await res.arrayBuffer())
      try { text = await require('../pdf_text').pdfText(buf, { maxPages: 80, ocr: false }) } catch { text = '' }
      if (!text.trim()) { text = strip(meta.docketText || ''); note = 'The full text is only published as a PDF that OpenLex could not read; open the link to read it.' }
    } else {
      text = strip(meta.docketText || '')
      note = 'GovInfo has no text for this document; open the link to read it.'
    }
    const want = article ? String(article).replace(/^\s*§+\s*/, '').trim() : null
    const part = want ? sliceSection(text, want, '§') : null
    if (want && !part && text) throw new SourceError(`${LABEL}: § ${want} was not found in this document`, 'notfound')
    if (text.length > 120000) text = text.slice(0, 120000)
    return {
      ref: id,
      title: `${KINDS[meta.collectionCode] || meta.collectionName || ''}: ${strip(meta.title || meta.heading || id)}`.replace(/^: /, ''),
      citation: citationOf({ ...meta, packageId: meta.packageId || pkg, granuleId: meta.granuleId || granule }),
      url: meta.detailsLink || `https://www.govinfo.gov/app/details/${pkg}${granule ? `/${granule}` : ''}`,
      text: part || text,
      date: meta.dateIssued || null,
      ...(note ? { note } : {}),
    }
  },

  citation(ref) {
    const [pkg, granule] = String(ref).split('/')
    return citationOf({ packageId: pkg, granuleId: granule, collectionCode: String(pkg).split('-')[0] })
  },
}

module.exports = { ...connector, citationOf }
