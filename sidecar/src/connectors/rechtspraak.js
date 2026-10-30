"use strict"
/**
 * Dutch case law from the judiciary's open data service (data.rechtspraak.nl):
 * every published decision (uitspraak) of Dutch courts with its ECLI,
 * metadata and full text. Public Domain Mark (data.overheid.nl). No key.
 *
 *   GET /uitspraken/content?id=ECLI:NL:HR:2019:1734            decision + metadata (XML)
 *   GET /uitspraken/content?id=ECLI:…&return=META              metadata only
 *
 * The open data service has no free-text search (its /uitspraken/zoeken
 * lists decisions by court, area and date, not by words), so OpenLex finds
 * a decision by its ECLI; for searching by words, the lawyer uses
 * uitspraken.rechtspraak.nl in the browser.
 */

const { getText, SourceError } = require('./http')
const { paced } = require('./pace')

const BASE = () => (process.env.OPENLEX_RECHTSPRAAK_API || 'https://data.rechtspraak.nl').replace(/\/+$/, '')
const LABEL = 'Dutch case law (rechtspraak.nl)'
const SITE = 'https://uitspraken.rechtspraak.nl'
const GAP_MS = 200 // no published limit: at most five requests a second
const ECLI_RE = /\bECLI:NL:[A-Z0-9]{2,7}:\d{4}:[A-Z0-9.]{1,25}\b/gi

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
const field = (xml, name) => { const m = new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`).exec(xml); return m ? decode(m[1]).trim() : null }
const eclisOf = (q) => [...new Set((String(q).match(ECLI_RE) || []).map((e) => e.toUpperCase().replace(/\.+$/, '')))]

/** Decision XML (uitspraak / inhoudsindicatie) → readable text, one paragraph a line. */
function bodyText(xml) {
  return decode(String(xml)
    .replace(/<\?linebreak\?>/g, '\n')
    .replace(/<\/nr>\s*/g, ' ')
    .replace(/<\/(para|title|parablock|paragroup|section|listitem|row|entry)>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** Metadata of one decision from its XML. */
function meta(xml, ecli) {
  const desc = (/<rdf:Description>([\s\S]*?)<\/rdf:Description>/.exec(xml) || [])[1] || xml
  return {
    ecli: field(desc, 'dcterms:identifier') || ecli,
    court: field(desc, 'dcterms:creator'),
    date: field(desc, 'dcterms:date'),
    caseNo: field(desc, 'psi:zaaknummer'),
    area: field(desc, 'dcterms:subject'),
    procedure: field(desc, 'psi:procedure'),
    title: field(xml, 'dcterms:title'),
    summary: (/<inhoudsindicatie\b[^>]*>([\s\S]*?)<\/inhoudsindicatie>/.exec(xml) || [])[1] || '',
  }
}

async function fetchDecision(ecli, { metaOnly = false } = {}) {
  const url = `${BASE()}/uitspraken/content?${new URLSearchParams({ id: ecli, ...(metaOnly ? { return: 'META' } : {}) })}`
  const xml = await paced('rechtspraak', GAP_MS, () => getText(url, { label: LABEL, headers: { Accept: 'application/xml' } }))
  if (!/<open-rechtspraak/.test(xml)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not open-rechtspraak XML')
  return xml
}

const nlDate = (d) => (/^\d{4}-\d\d-\d\d$/.test(d || '') ? d.split('-').reverse().join('-') : d)

const connector = {
  id: 'rechtspraak',
  label: LABEL,
  country: 'NL',
  jurisdictions: ['NL'],
  kind: 'caselaw',
  description: 'Published decisions of Dutch courts from the judiciary\'s open data (data.rechtspraak.nl), found by their ECLI, with the full text',
  licence: 'Public Domain Mark 1.0 (open data of the Dutch judiciary)',
  licenceUrl: 'https://www.rechtspraak.nl/Uitspraken/Paginas/Open-Data.aspx',
  homepage: SITE,
  needsKey: false,
  guide: 'rechtspraak',
  hosts: ['data.rechtspraak.nl'],
  de: { label: 'Niederländische Rechtsprechung (rechtspraak.nl)', description: 'Veröffentlichte Entscheidungen niederländischer Gerichte aus den offenen Daten der Justiz (data.rechtspraak.nl), nach ECLI, mit Volltext' },
  sample: 'ECLI:NL:HR:2019:1734',
  /** The open data service finds decisions by ECLI only. */
  canSearch: (q) => eclisOf(q).length > 0,
  searchHint: 'rechtspraak.nl\'s open data has no search by words: give the ECLI of the decision (for example ECLI:NL:HR:2019:1734), or search by words on uitspraken.rechtspraak.nl in your browser',

  async search(query, { limit = 8 } = {}) {
    const out = []
    for (const ecli of eclisOf(query).slice(0, Math.min(limit, 10))) {
      let xml
      try { xml = await fetchDecision(ecli, { metaOnly: true }) } catch (err) { if (err.code === 'notfound') continue; throw err }
      const m = meta(xml, ecli)
      out.push({
        ref: m.ecli,
        title: [m.court, nlDate(m.date), m.caseNo].filter(Boolean).join(', ') || m.ecli,
        citation: connector.citation(m.ecli, m),
        url: `${SITE}/details?id=${encodeURIComponent(m.ecli)}`,
        snippet: [m.area, m.procedure, bodyText(m.summary)].filter(Boolean).join(' · ').slice(0, 600),
        date: m.date,
        inForce: null,
      })
    }
    return out
  },

  /** The decision: summary (inhoudsindicatie), then the full text. */
  async get(ref) {
    const [ecli] = eclisOf(ref)
    if (!ecli) throw new SourceError(`${LABEL}: give the ECLI of the decision (for example ECLI:NL:HR:2019:1734)`, 'bad')
    const xml = await fetchDecision(ecli)
    const m = meta(xml, ecli)
    const body = (/<uitspraak\b[^>]*>([\s\S]*?)<\/uitspraak>/.exec(xml) || [])[1] || ''
    const summary = bodyText(m.summary)
    let text = [summary ? `Inhoudsindicatie\n${summary}` : '', bodyText(body)].filter(Boolean).join('\n\n')
    if (!text) throw new SourceError(`${LABEL} has no text for this decision`, 'notfound')
    if (text.length > 60000) text = text.slice(0, 60000)
    return { ref: m.ecli, title: [m.court, nlDate(m.date), m.caseNo].filter(Boolean).join(', ') || m.ecli, citation: connector.citation(m.ecli, m), url: `${SITE}/details?id=${encodeURIComponent(m.ecli)}`, text, date: m.date }
  },

  /** "Hoge Raad 08-11-2019, ECLI:NL:HR:2019:1734". */
  citation(ref, x = {}) {
    const who = [x.court, nlDate(x.date)].filter(Boolean).join(' ')
    return `${who ? `${who}, ` : ''}${ref}`
  },
}

module.exports = { ...connector, eclisOf, bodyText }
