"use strict"
/**
 * NeuRIS — German federal law from the federal government's new legal
 * information portal (rechtsinformationen.bund.de), still in its public
 * test phase. Documented open API, no key, 600 requests a minute per IP.
 * Federal statutes are official works without copyright (§ 5 UrhG); a
 * licence for the portal's data has not been published yet, so the source
 * says "(test phase, licence not yet published)". Statutes and the
 * decisions of the federal courts (BVerfG, BGH, BVerwG, BFH, BAG, BSG,
 * BPatG); court decisions are official works too (§ 5 UrhG).
 *
 *   GET /v1/legislation?searchTerm=…&size=N    search statutes (with text matches)
 *   GET /v1/legislation/{eli expression}       metadata + encodings (HTML, XML)
 *   GET /v1/rechtsprechung?searchTerm=…&size=N search federal decisions
 *   GET /v1/rechtsprechung/{documentNumber}    one decision (Leitsatz, Tenor, Gründe …)
 */

const { getJson, getText, htmlToText, strip, SourceError } = require('./http')
const { sliceSection } = require('./text')
const { paced } = require('./pace')

const BASE = () => (process.env.OPENLEX_NEURIS_API || 'https://testphase.rechtsinformationen.bund.de').replace(/\/+$/, '')
const LABEL = 'German federal law (NeuRIS)'
const REF_RE = /^eli\/bund\/[\w/.-]+$/
const DOC_RE = /^[A-Z]{4,6}\d{6,12}$/ // a decision's document number (KORE303362011)
const GAP_MS = 100 // the API allows 600 requests a minute per address
const PORTAL = () => 'https://testphase.rechtsinformationen.bund.de' // the public page of a decision

const abs = (p) => (/^https?:/.test(p) ? p : `${BASE()}${p}`)
const json = (url) => paced('neuris', GAP_MS, () => getJson(url, { label: LABEL }))
const text = (url, opts) => paced('neuris', GAP_MS, () => getText(url, opts))
const deDate = (d) => (/^\d{4}-\d\d-\d\d$/.test(String(d)) ? String(d).split('-').reverse().join('.') : d || '')
const DECISION_PARTS = [['leitsatz', 'Leitsatz'], ['orientierungssatz', 'Orientierungssatz'], ['tenor', 'Tenor'], ['tatbestand', 'Tatbestand'], ['entscheidungsgruende', 'Entscheidungsgründe'], ['gruende', 'Gründe'], ['abweichendeMeinung', 'Abweichende Meinung']]

/** Federal court decisions for a search (the case-law half). */
async function searchDecisions(query, limit) {
  const r = await json(`${BASE()}/v1/rechtsprechung?${new URLSearchParams({ searchTerm: String(query), size: String(Math.min(limit, 20)) })}`)
  if (!Array.isArray(r?.member)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no member list')
  return r.member.slice(0, limit).map((m) => {
    const it = m.item || {}
    const match = (m.textMatches || []).find((t) => t.text && t.name !== 'titleLine') || (m.textMatches || [])[0]
    return {
      ref: it.documentNumber,
      title: [it.headline, it.titleLine].filter(Boolean).join(' '),
      citation: connector.citation(it.documentNumber, { decision: it }),
      url: `${PORTAL()}/gerichtsentscheidungen/${it.documentNumber}`,
      snippet: match ? strip(match.text) : '',
      date: it.decisionDate || null,
      inForce: null,
      kind: 'caselaw',
    }
  })
}
const htmlOf = (item) => (item.encoding || []).find((e) => e.encodingFormat === 'text/html')?.contentUrl || null

const connector = {
  id: 'neuris',
  label: 'German federal law (NeuRIS)',
  country: 'DE',
  jurisdictions: ['DE'],
  kind: 'law+caselaw',
  description: 'German federal statutes and regulations, and decisions of the federal courts, from the federal government\'s new legal information portal (public test phase: coverage may be incomplete)',
  de: {
    label: 'Bundesrecht Deutschland (NeuRIS)',
    description: 'Bundesgesetze und -verordnungen sowie Entscheidungen der Bundesgerichte aus dem neuen Rechtsinformationsportal des Bundes (öffentliche Testphase: Abdeckung ggf. unvollständig)',
    testPhase: 'Testphase, Lizenz noch nicht veröffentlicht',
  },
  sample: 'Kaufvertrag',
  licence: 'Statutes are official works, free of copyright (§ 5 UrhG), and so are court decisions; test service of the Federal Ministry of Justice, data licence not yet published',
  licenceUrl: 'https://docs.rechtsinformationen.bund.de/',
  homepage: 'https://testphase.rechtsinformationen.bund.de',
  needsKey: false,
  broad: true,
  testPhase: 'test phase, licence not yet published',
  hosts: ['testphase.rechtsinformationen.bund.de'],

  /** Statutes first, then federal decisions (kind: 'law' or 'caselaw' asks for one half only). */
  async search(query, { limit = 8, kind = null } = {}) {
    const wantLaw = !kind || kind === 'law'
    const wantCases = !kind || kind === 'caselaw'
    const laws = wantLaw ? await connector._searchLaw(query, limit) : []
    if (!wantCases) return laws
    let cases = []
    try { cases = await searchDecisions(query, limit) } catch (err) { if (!wantLaw) throw err } // the statutes still answer
    if (!wantLaw) return cases
    const nLaw = Math.min(laws.length, Math.max(Math.ceil(limit / 2), limit - cases.length))
    return [...laws.slice(0, nLaw), ...cases.slice(0, limit - nLaw)]
  },

  async _searchLaw(query, limit) {
    const url = `${BASE()}/v1/legislation?${new URLSearchParams({ searchTerm: String(query), size: String(Math.min(limit, 20)) })}`
    const found = await json(url)
    if (!Array.isArray(found?.member)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no member list')
    return found.member.slice(0, limit).map((m) => {
      const it = m.item || {}
      const match = (m.textMatches || []).find((t) => t.text)
      const html = htmlOf(it)
      return {
        ref: it.legislationIdentifier,
        title: [it.abbreviation, it.name].filter(Boolean).join(' – '),
        citation: connector.citation(it.legislationIdentifier, { abbreviation: it.abbreviation, section: match?.name }),
        url: html ? abs(html) : abs(it['@id'] || ''),
        snippet: match ? `${match.name ? `${strip(match.name)}: ` : ''}${strip(match.text)}` : '',
        date: it.exampleOfWork?.legislationDate || null,
        inForce: it.legislationLegalForce ? it.legislationLegalForce === 'InForce' : null,
      }
    })
  },

  /** Text of a statute (one section with article: "§ 433" or "433"), or of a federal decision (document number). */
  async get(ref, { article = null } = {}) {
    const doc = String(ref || '').trim().replace(/^.*\/(gerichtsentscheidungen|rechtsprechung)\//, '')
    if (DOC_RE.test(doc)) return getDecision(doc)
    const id = String(ref || '').trim().replace(/^\/?v1\/legislation\//, '')
    if (!REF_RE.test(id) || id.split('/').includes('..')) throw new SourceError(`${LABEL}: give the identifier from a search result (eli/bund/…)`, 'bad')
    const meta = await json(`${BASE()}/v1/legislation/${id}`)
    const html = htmlOf(meta)
    if (!html) throw new SourceError(`${LABEL} has no readable text for this document`, 'notfound')
    const full = htmlToText(await text(abs(html), { label: LABEL, headers: { Accept: 'text/html' } }))
    const part = article ? sliceSection(full, article, '§') : null
    if (article && !part) throw new SourceError(`${LABEL}: § ${String(article).replace(/^§\s*/, '')} was not found in ${meta.abbreviation || 'this statute'}`, 'notfound')
    const title = [meta.abbreviation, meta.name].filter(Boolean).join(' – ')
    return { ref: id, title, citation: connector.citation(id, { abbreviation: meta.abbreviation, section: part ? `§ ${String(article).replace(/^§\s*/, '')}` : null }), url: abs(html), text: part || full }
  },

  /** "BGB § 433 (NeuRIS, eli/bund/…)"; a decision: "BGH, Urteil vom 13.04.2011 – VIII ZR 220/10 (NeuRIS, KORE303362011)". */
  citation(ref, x = {}) {
    if (x.decision) {
      const d = x.decision
      const court = d.courtName || d.gericht || d.courtType || ''
      const type = d.documentType || d.dokumenttyp || ''
      const date = d.decisionDate || d.datum || ''
      const file = (d.fileNumbers || d.aktenzeichenListe || [])[0] || d.aktenzeichen || ''
      const ecli = d.ecli ? `, ${d.ecli}` : ''
      return `${[court, [type, date ? `vom ${deDate(date)}` : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ')}${file ? ` – ${file}` : ''}${ecli} (NeuRIS, ${ref})`
    }
    const name = [x.abbreviation, x.section ? strip(x.section).replace(/^(§+\s*[\w.]+).*$/, '$1') : ''].filter(Boolean).join(' ')
    return `${name ? `${name} ` : ''}(NeuRIS, ${ref})`
  },
}

/** One decision: Leitsatz, Tenor, Tatbestand, Gründe as plain text. */
async function getDecision(doc) {
  const d = await json(`${BASE()}/v1/rechtsprechung/${doc}`)
  const parts = DECISION_PARTS.filter(([k]) => d[k]).map(([k, head]) => `${head}\n${strip(String(d[k]).replace(/<br\s*\/?>/gi, '\n'))}`)
  if (!parts.length) throw new SourceError(`${LABEL} has no readable text for this decision`, 'notfound')
  return {
    ref: doc,
    title: [d.kurztitel, d.titelzeile].filter(Boolean).join(' '),
    citation: connector.citation(doc, { decision: d }),
    url: `${PORTAL()}/gerichtsentscheidungen/${doc}`,
    text: parts.join('\n\n'),
    date: d.datum || null,
  }
}

module.exports = connector
