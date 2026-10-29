"use strict"
/**
 * eCFR — the Electronic Code of Federal Regulations (United States), from
 * the official eCFR API of the Office of the Federal Register and the
 * Government Publishing Office (www.ecfr.gov/api). No key. Federal
 * regulations are works of the US government, free of copyright
 * (17 U.S.C. § 105). Point in time: every section as it stood on a date.
 *
 *   GET /api/search/v1/results?query=…&per_page=N[&date=YYYY-MM-DD]   search
 *   GET /api/versioner/v1/titles.json                                  "up to date as of" per title
 *   GET /api/versioner/v1/full/{date}/title-{n}.xml?section=… | part=…  the text on a date
 *
 * No published rate limit; OpenLex keeps to one request at a time,
 * half a second apart.
 */

const { getJson, getText, htmlToText, strip, SourceError } = require('./http')
const { paced } = require('./pace')
const { sliceSection } = require('./text')

const BASE = () => (process.env.OPENLEX_ECFR_API || 'https://www.ecfr.gov').replace(/\/+$/, '')
const SITE = 'https://www.ecfr.gov'
const LABEL = 'eCFR'
const GAP_MS = 500
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const call = (fn) => paced('ecfr', GAP_MS, fn)

/** "45/1701.2" (a section) or "45/part-1701" (a whole part) from a ref or a citation like "45 CFR 1701.2". */
function parseRef(ref) {
  const s = String(ref || '').trim()
  let m = s.match(/^(\d{1,2})\s*\/\s*part-(\d+[A-Za-z]?)$/i) || s.match(/^(\d{1,2})\s*C\.?F\.?R\.?\s*(?:part|pt\.?)\s*(\d+[A-Za-z]?)$/i)
  if (m) return { title: m[1], part: m[2] }
  m = s.match(/^(\d{1,2})\s*\/\s*(\d+[A-Za-z]?\.\d+[\w-]*)$/) || s.match(/^(\d{1,2})\s*C\.?F\.?R\.?\s*(?:§+\s*)?(\d+[A-Za-z]?\.\d+[\w-]*)$/i)
  if (m) return { title: m[1], section: m[2] }
  return null
}
const refOf = (p) => (p.section ? `${p.title}/${p.section}` : `${p.title}/part-${p.part}`)
const pageOf = (p, date) => `${SITE}/${date ? `on/${date}` : 'current'}/title-${p.title}/${p.section ? `section-${p.section}` : `part-${p.part}`}`

let titlesCache = { at: 0, map: null }
/** The latest date the eCFR is up to date for a title. */
async function latestDate(title) {
  if (!titlesCache.map || Date.now() - titlesCache.at > 6 * 3600000) {
    const j = await call(() => getJson(`${BASE()}/api/versioner/v1/titles.json`, { label: LABEL }))
    titlesCache = { at: Date.now(), map: Object.fromEntries((j?.titles || []).map((t) => [String(t.number), t.up_to_date_as_of || t.latest_issue_date])) }
  }
  const d = titlesCache.map[String(title)]
  if (!d) throw new SourceError(`${LABEL} has no title ${title}`, 'notfound')
  return d
}

/** eCFR XML → plain text (headings and paragraphs on their own lines). */
function xmlText(xml) {
  return htmlToText(String(xml).replace(/<\?xml[^>]*>/, '').replace(/<HEAD>/g, '<h4>').replace(/<\/HEAD>/g, '</h4>').replace(/<\/(AUTH|SOURCE|CITA|EXTRACT|NOTE|FP)>/g, '</p>'))
}

const connector = {
  id: 'ecfr',
  label: 'eCFR (US federal regulations)',
  country: 'US',
  jurisdictions: ['US'],
  kind: 'law',
  description: 'The Code of Federal Regulations of the United States, updated daily by the Office of the Federal Register, with every section as it stood on any date',
  licence: 'US government work, public domain (17 U.S.C. § 105)',
  licenceUrl: 'https://www.ecfr.gov/reader-aids/using-ecfr/getting-started',
  homepage: 'https://www.ecfr.gov',
  needsKey: false,
  guide: 'ecfr',
  hosts: ['www.ecfr.gov'],
  sample: 'disclosure of information',
  de: {
    label: 'eCFR (US-Bundesverordnungen)',
    description: 'Der Code of Federal Regulations der USA, täglich aktualisiert vom Office of the Federal Register, jeder Abschnitt auch in der Fassung eines bestimmten Tages',
  },

  async search(query, { limit = 8, date = null } = {}) {
    const params = new URLSearchParams({ query: String(query), per_page: String(Math.min(limit, 20)) })
    if (date && DATE_RE.test(String(date))) params.set('date', String(date))
    const j = await call(() => getJson(`${BASE()}/api/search/v1/results?${params}`, { label: LABEL }))
    if (!Array.isArray(j?.results)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no results list')
    const out = []
    for (const r of j.results) {
      const h = r.hierarchy || {}
      if (!h.title || (!h.section && !h.part)) continue
      const p = h.section ? { title: h.title, section: h.section } : { title: h.title, part: h.part }
      const heads = r.headings || {}
      const name = strip(heads.section || heads.appendix || heads.part || '')
      const where = p.section ? `${p.title} CFR ${p.section}` : `${p.title} CFR Part ${p.part}`
      out.push({
        ref: refOf(p),
        title: `${where}${name ? ` – ${name}` : ''}`,
        citation: connector.citation(refOf(p)),
        url: pageOf(p, date && DATE_RE.test(String(date)) ? String(date) : null),
        snippet: [strip(heads.part || ''), strip(r.full_text_excerpt || '')].filter(Boolean).join(' · ').slice(0, 600),
        date: r.starts_on || null,
        inForce: r.removed ? false : r.ends_on ? false : true,
      })
      if (out.length >= limit) break
    }
    return out
  },

  /** The text of a section (or a part; one section of it with article: "1701.2"), today or on a date. */
  async get(ref, { article = null, date = null } = {}) {
    const p = parseRef(ref)
    if (!p) throw new SourceError(`${LABEL}: give the section from a search result (for example 45/1701.2 or "45 CFR 1701.2")`, 'bad')
    const on = date && DATE_RE.test(String(date)) ? String(date) : await latestDate(p.title)
    const q = p.section ? `section=${encodeURIComponent(p.section)}` : `part=${encodeURIComponent(p.part)}`
    const xml = await call(() => getText(`${BASE()}/api/versioner/v1/full/${on}/title-${p.title}.xml?${q}`, { label: LABEL, headers: { Accept: 'application/xml' } }))
    const full = xmlText(xml)
    const want = article && !p.section ? String(article).replace(/^\s*§+\s*/, '').trim() : null
    const part = want ? sliceSection(full, want, '§') : null
    if (want && !part) throw new SourceError(`${LABEL}: § ${want} was not found in ${p.title} CFR Part ${p.part}`, 'notfound')
    const head = (full.split('\n')[0] || '').trim()
    const sec = want ? { title: p.title, section: want } : p
    return {
      ref: refOf(sec),
      title: `${p.section ? `${p.title} CFR ${p.section}` : `${p.title} CFR Part ${p.part}`}${head && !want ? ` – ${head.replace(/^§\s*[\d.A-Za-z-]+\s*/, '')}` : ''}`,
      citation: connector.citation(refOf(sec)),
      url: pageOf(sec, date ? on : null),
      text: part || full,
      version: on,
      note: date ? `As it stood on ${on}` : `eCFR up to date as of ${on}`,
    }
  },

  /** "45 CFR 1701.2 (eCFR)". */
  citation(ref) {
    const p = parseRef(ref)
    if (!p) return `${ref} (eCFR)`
    return p.section ? `${p.title} CFR ${p.section} (eCFR)` : `${p.title} CFR Part ${p.part} (eCFR)`
  },
}

module.exports = { ...connector, parseRef, _reset: () => { titlesCache = { at: 0, map: null } } }
