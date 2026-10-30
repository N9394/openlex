"use strict"
/**
 * Find Case Law — judgments and tribunal decisions of the courts of
 * England and Wales and the UK, from The National Archives
 * (caselaw.nationalarchives.gov.uk). Published API, no key.
 *
 *   GET /atom.xml?query=…&order=relevance&per_page=N   search (Atom)
 *   GET /{uri}/data.xml                                one judgment (LegalDocML)
 *
 * Licence: the Open Justice Licence lets anyone read, copy and reuse the
 * judgments. It does not cover computational analysis — programmatic
 * searching in bulk to identify, extract or enrich content — which needs
 * a separate, free licence from The National Archives. OpenLex only makes
 * per-question look-ups for the lawyer (one search, one judgment), like a
 * person using the site; it does not download, index or analyse the
 * collection. Rate limit: 1,000 requests per rolling 5 minutes per IP;
 * OpenLex sends one at a time, 300 ms apart.
 */

const { getText, htmlToText, SourceError } = require('./http')
const { paced } = require('./pace')
const x = require('./ukxml')

const BASE = () => (process.env.OPENLEX_UKCASELAW_API || 'https://caselaw.nationalarchives.gov.uk').replace(/\/+$/, '')
const SITE = 'https://caselaw.nationalarchives.gov.uk'
const LABEL = 'Find Case Law (UK)'
const GAP_MS = 300 // 1,000 requests per 5 minutes
const MAX_TEXT = 60000

const get = (url) => paced('ukcaselaw', GAP_MS, () => getText(url, { label: LABEL }))
const SLUG_RE = /^(?:[a-z]+\/){1,3}\d{4}\/\d{1,6}$/
const UUID_RE = /^d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The document address for a neutral citation ("[2024] UKSC 12" → uksc/2024/12,
 * "[2022] EWCA Civ 379" → ewca/civ/2022/379, "[2026] EWHC 2767 (Comm)" →
 * ewhc/comm/2026/2767), a Find Case Law address or slug; null otherwise.
 */
function parseRef(q) {
  const s = String(q || '').trim()
  const path = s.replace(/^https?:\/\/caselaw\.nationalarchives\.gov\.uk\/(?:id\/)?/, '').replace(/\/data\.(xml|html|pdf)$/, '').replace(/^\/+|\/+$/g, '').toLowerCase()
  if (SLUG_RE.test(path) || UUID_RE.test(path)) return path
  const m = /\[(\d{4})\]\s+([A-Z]{2,8})((?:\s+[A-Za-z]{2,6})?)\s+(\d{1,6})(?:\s*\(([A-Za-z]{2,8})\))?/.exec(s)
  if (!m) return null
  const parts = [m[2], m[3].trim(), m[5]].filter(Boolean).map((p) => p.toLowerCase())
  return `${parts.join('/')}/${m[1]}/${m[4]}`
}

function item(e) {
  const ncnTag = /<tna:identifier\b[^>]*type="ukncn"[^>]*>([^<]*)<\/tna:identifier>/.exec(e)
  const ncnSlug = ncnTag ? (/slug="([^"]*)"/.exec(ncnTag[0]) || [])[1] : null
  const uri = x.tag(e, 'tna:uri')
  const alt = (/<link href="([^"]*)" rel="alternate"\/>/.exec(e) || [])[1] || null
  const ref = ncnSlug || uri || (alt ? alt.replace(/^https?:\/\/[^/]+\//, '') : null)
  const title = x.tag(e, 'title') || ref
  const ncn = ncnTag ? x.decode(ncnTag[1]) : null
  const court = x.decode((/<author>\s*<name>([^<]*)<\/name>/.exec(e) || [])[1] || '') || null
  const date = (x.tag(e, 'published') || '').slice(0, 10) || null
  return {
    ref,
    title: [title, ncn].filter(Boolean).join(' '),
    citation: connector.citation(ref, { name: title, ncn }),
    url: alt || `${SITE}/${ref}`,
    snippet: [court, date ? `judgment of ${date}` : ''].filter(Boolean).join(' · '),
    date,
    inForce: null,
  }
}

/** Plain text of a LegalDocML judgment (header and body, without the metadata). */
function judgmentText(xml) {
  const body = String(xml)
    .replace(/<meta>[\s\S]*?<\/meta>/, '')
    .replace(/<html:style[\s\S]*?<\/html:style>/g, '')
    .replace(/<(?:authorialNote|note)\b[\s\S]*?<\/(?:authorialNote|note)>/g, '')
    .replace(/<\/?(?:span|i|b|u|sup|sub|a|inline|marker)\b[^>]*>/g, '')
    .replace(/<\/?(?:content|neutralCitation|party|docDate|role|judge|ref|courtType|docTitle|docNumber|date|organization|location|lawyer|signature)\b[^>]*>/g, ' ')
    .replace(/<\/?(?:paragraph|subparagraph|level|blockList|item|p|heading|num|tr|td|intro|wrapUp|blockContainer|tblock|crossHeading)\b[^>]*>/g, '<p>')
  return htmlToText(body).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** Paragraph n of a judgment ("23" or "[23]"): from its number to the next one. */
function paragraph(text, n) {
  const num = String(n).replace(/^\s*(?:para(?:graph)?\.?|§)?\s*\[?\s*|\s*\]?\s*$/gi, '')
  if (!/^\d{1,4}$/.test(num)) return null
  const lines = text.split('\n')
  const head = new RegExp(`^\\[?${num}\\]?[.)]?(\\s|$)`)
  const start = lines.findIndex((l) => head.test(l))
  if (start < 0) return null
  const next = new RegExp(`^\\[?${+num + 1}\\]?[.)]?(\\s|$)`)
  let end = lines.findIndex((l, i) => i > start && next.test(l))
  if (end < 0) end = Math.min(lines.length, start + 40)
  return lines.slice(start, end).join('\n')
}

const connector = {
  id: 'ukcaselaw',
  label: 'Find Case Law (UK)',
  country: 'UK',
  jurisdictions: ['UK', 'GB'],
  kind: 'caselaw',
  description: 'Judgments and tribunal decisions of the courts of England and Wales and the UK, from The National Archives (2001 onwards; reading is free under the Open Justice Licence; OpenLex makes per-question look-ups only, never bulk analysis)',
  licence: 'Open Justice Licence (The National Archives); computational analysis of judgments needs TNA\'s separate free licence',
  licenceUrl: 'https://caselaw.nationalarchives.gov.uk/open-justice-licence',
  homepage: 'https://caselaw.nationalarchives.gov.uk',
  needsKey: false,
  guide: 'ukcaselaw',
  hosts: ['caselaw.nationalarchives.gov.uk'],
  sample: 'action short of dismissal',
  de: {
    label: 'Find Case Law (Vereinigtes Königreich)',
    description: 'Urteile und Tribunal-Entscheidungen aus England und Wales und dem Vereinigten Königreich, von The National Archives (ab 2001; Lesen ist frei unter der Open Justice Licence; OpenLex fragt nur einzeln pro Frage ab, keine Massenauswertung)',
  },

  async search(query, { limit = 8 } = {}) {
    const ref = parseRef(query)
    if (ref) {
      try { const d = await connector.get(ref); return [{ ref: d.ref, title: d.title, citation: d.citation, url: d.url, snippet: d.snippet, date: d.date, inForce: null }] } catch (err) { if (err.code !== 'notfound') throw err }
    }
    const q = String(query).trim()
    const xml = await get(`${BASE()}/atom.xml?${new URLSearchParams({ query: q, order: 'relevance', per_page: String(Math.min(Math.max(limit, 1), 25)) })}`)
    if (!/<feed\b/.test(xml)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not an Atom feed')
    return x.entries(xml).map(item).filter((it) => it.ref).slice(0, limit)
  },

  /** One judgment (one paragraph with article: "23" or "[23]"). */
  async get(ref, { article = null } = {}) {
    const id = parseRef(ref)
    if (!id) throw new SourceError(`${LABEL}: give the neutral citation (for example [2024] UKSC 12) or the address from a search result`, 'bad')
    const xml = await get(`${BASE()}/${id}/data.xml`)
    if (!/<akomaNtoso\b/.test(xml)) throw new SourceError(`${LABEL} has no readable text for this judgment (it may only exist as a PDF)`, 'notfound')
    const name = x.attr(xml, 'FRBRname', 'value') || id
    const ncn = x.tag(xml, 'uk:cite')
    const date = x.attr(xml, 'FRBRdate', 'date', 'name="judgment"')
    const courtId = (/<FRBRWork>[\s\S]*?<FRBRauthor href="#([^"]+)"/.exec(xml) || [])[1]
    const court = courtId ? x.attr(xml, 'TLCOrganization', 'showAs', `eId="${courtId}"`) : null
    let text = judgmentText(xml)
    let note = null
    if (article) {
      const para = paragraph(text, article)
      if (!para) throw new SourceError(`${LABEL}: paragraph ${String(article).replace(/[[\]]/g, '')} was not found in ${ncn || id}`, 'notfound')
      text = para
    } else if (text.length > MAX_TEXT) {
      text = `${text.slice(0, MAX_TEXT)}\n…`
      note = 'Long judgment: the start is shown; ask for one paragraph.'
    }
    const para = article ? String(article).replace(/^\s*(?:para(?:graph)?\.?)?\s*\[?\s*|\s*\]?\s*$/gi, '') : null
    return {
      ref: id,
      title: [name, ncn].filter(Boolean).join(' '),
      citation: connector.citation(id, { name, ncn, para }),
      url: `${SITE}/${id}`,
      snippet: [court, date ? `judgment of ${date}` : ''].filter(Boolean).join(' · '),
      date,
      text,
      ...(note ? { note } : {}),
    }
  },

  /** "Secretary of State for Business and Trade v Mercer [2024] UKSC 12, [23] (Find Case Law)". */
  citation(ref, { name = null, ncn = null, para = null } = {}) {
    const main = [name, ncn].filter(Boolean).join(' ') || ref
    return `${main}${para ? `, [${para}]` : ''} (Find Case Law)`
  },
}

module.exports = { ...connector, parseRef, judgmentText, paragraph }
