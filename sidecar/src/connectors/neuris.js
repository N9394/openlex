"use strict"
/**
 * NeuRIS — German federal law from the federal government's new legal
 * information portal (rechtsinformationen.bund.de), still in its public
 * test phase. Documented open API, no key, 600 requests a minute per IP.
 * Federal statutes are official works without copyright (§ 5 UrhG); a
 * licence for the portal's data has not been published yet, so the source
 * says "(test phase, licence not yet published)". Statutes only here (case
 * law moved from /v1/case-law to /v1/rechtsprechung; not used yet).
 *
 *   GET /v1/legislation?searchTerm=…&size=N   search (with text matches)
 *   GET /v1/legislation/{eli expression}      metadata + encodings (HTML, XML)
 */

const { getJson, getText, htmlToText, strip, SourceError } = require('./http')
const { sliceSection } = require('./text')

const BASE = () => (process.env.OPENLEX_NEURIS_API || 'https://testphase.rechtsinformationen.bund.de').replace(/\/+$/, '')
const LABEL = 'German federal law (NeuRIS)'
const REF_RE = /^eli\/bund\/[\w/.-]+$/

const abs = (p) => (/^https?:/.test(p) ? p : `${BASE()}${p}`)
const htmlOf = (item) => (item.encoding || []).find((e) => e.encodingFormat === 'text/html')?.contentUrl || null

const connector = {
  id: 'neuris',
  label: 'German federal law (NeuRIS)',
  country: 'DE',
  jurisdictions: ['DE'],
  kind: 'law',
  description: 'German federal statutes and regulations from the federal government\'s new legal information portal (public test phase: coverage may be incomplete)',
  licence: 'Statutes are official works, free of copyright (§ 5 UrhG); test service of the Federal Ministry of Justice, data licence not yet published',
  licenceUrl: 'https://docs.rechtsinformationen.bund.de/',
  homepage: 'https://testphase.rechtsinformationen.bund.de',
  needsKey: false,
  testPhase: 'test phase, licence not yet published',
  hosts: ['testphase.rechtsinformationen.bund.de'],

  async search(query, { limit = 8 } = {}) {
    const url = `${BASE()}/v1/legislation?${new URLSearchParams({ searchTerm: String(query), size: String(Math.min(limit, 20)) })}`
    const json = await getJson(url, { label: LABEL })
    if (!Array.isArray(json?.member)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no member list')
    return json.member.slice(0, limit).map((m) => {
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

  /** Text of a statute (one section with article: "§ 433" or "433"). */
  async get(ref, { article = null } = {}) {
    const id = String(ref || '').trim().replace(/^\/?v1\/legislation\//, '')
    if (!REF_RE.test(id) || id.split('/').includes('..')) throw new SourceError(`${LABEL}: give the identifier from a search result (eli/bund/…)`, 'bad')
    const meta = await getJson(`${BASE()}/v1/legislation/${id}`, { label: LABEL })
    const html = htmlOf(meta)
    if (!html) throw new SourceError(`${LABEL} has no readable text for this document`, 'notfound')
    const full = htmlToText(await getText(abs(html), { label: LABEL, headers: { Accept: 'text/html' } }))
    const part = article ? sliceSection(full, article, '§') : null
    if (article && !part) throw new SourceError(`${LABEL}: § ${String(article).replace(/^§\s*/, '')} was not found in ${meta.abbreviation || 'this statute'}`, 'notfound')
    const title = [meta.abbreviation, meta.name].filter(Boolean).join(' – ')
    return { ref: id, title, citation: connector.citation(id, { abbreviation: meta.abbreviation, section: part ? `§ ${String(article).replace(/^§\s*/, '')}` : null }), url: abs(html), text: part || full }
  },

  /** "BGB § 433 (NeuRIS, eli/bund/…)". */
  citation(ref, x = {}) {
    const name = [x.abbreviation, x.section ? strip(x.section).replace(/^(§+\s*[\w.]+).*$/, '$1') : ''].filter(Boolean).join(' ')
    return `${name ? `${name} ` : ''}(NeuRIS, ${ref})`
  },
}

module.exports = connector
