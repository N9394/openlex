"use strict"
/**
 * RIS Austria — consolidated federal law from the official open-data API
 * of the Rechtsinformationssystem des Bundes (data.bka.gv.at, OGD,
 * CC BY 4.0). Search reuses web/ris.js; a document is read from its
 * official HTML rendering (ogd.ris.bka.gv.at). Both follow the RIS
 * open-data terms (web/ris.js): one request at a time, two seconds apart,
 * live only 20:00–05:00 Vienna time, at weekends and on Austrian holidays;
 * otherwise from the lawyer's local copy, with its date.
 */

const { htmlToText, SourceError } = require('./http')

const closed = (err) => { if (err?.code === 'window') throw new SourceError(err.plain, 'window'); throw err }

const DOCS = () => process.env.OPENLEX_RIS_DOCS || 'https://ogd.ris.bka.gv.at/Dokumente/Bundesnormen'
const REF_RE = /^NOR\d{5,12}$/

const connector = {
  id: 'ris',
  label: 'RIS Austria',
  country: 'AT',
  jurisdictions: ['AT'],
  kind: 'law',
  description: 'Austria\'s official federal law database (Rechtsinformationssystem des Bundes), current consolidated versions',
  licence: 'CC BY 4.0 (open government data, Republic of Austria)',
  licenceUrl: 'https://www.data.gv.at/katalog/dataset/ris-bundesrecht-konsolidiert',
  homepage: 'https://www.ris.bka.gv.at',
  needsKey: false,
  hosts: ['data.bka.gv.at', 'ogd.ris.bka.gv.at'],
  /** Extra words for the list: outside the RIS window, answers come from the local copy. */
  statusNote: () => (require('../web/ris').liveAllowed() ? '' : ' (live look-ups only 20:00–05:00 and at weekends; your local copy now)'),
  nightCopy: {
    get: () => require('../web/ris').nightCopyOn(),
    set: (on) => require('../web/ris').setNightCopy(on),
  },

  async search(query, { limit = 8 } = {}) {
    let r
    try { r = await require('../web/ris').searchBundesrecht(query, { limit: Math.min(limit, 20) }) } catch (err) {
      if (err?.code === 'window') closed(err)
      if (err instanceof SourceError) throw err
      if (/HTTP \d/.test(err.message)) throw new SourceError('RIS Austria is not answering right now; try again later', 'down', err.message)
      throw new SourceError('RIS Austria could not be reached (no internet connection, or the service is down)', 'offline', String(err.message).slice(0, 120))
    }
    const items = r.results.map((x) => ({
      ref: x.id,
      title: x.title,
      citation: connector.citation(x.id, x),
      url: x.url || x.htmlUrl,
      snippet: [x.inForce ? 'in force' : `not in force since ${x.inForceUntil}`, x.inForceFrom ? `version from ${x.inForceFrom}` : '', x.lastAmendment || ''].filter(Boolean).join(' · '),
      date: x.inForceFrom,
      inForce: x.inForce,
    }))
    return r.note ? { items, note: r.note } : items
  },

  async get(ref) {
    const id = String(ref || '').trim()
    if (!REF_RE.test(id)) throw new SourceError('RIS Austria: give the document number from a search result (NOR…)', 'bad')
    const url = `${DOCS()}/${id}/${id}.html`
    // Screen-reader duplicates ("§ 922Paragraph 922") are dropped.
    let page
    try { page = await require('../web/ris').fetchDocument(url) } catch (err) {
      if (err?.code === 'window') closed(err)
      if (/HTTP \d/.test(err.message)) throw new SourceError(/HTTP 404/.test(err.message) ? 'RIS Austria has no such document' : 'RIS Austria is not answering right now; try again later', /HTTP 404/.test(err.message) ? 'notfound' : 'down', err.message)
      throw new SourceError('RIS Austria could not be reached (no internet connection, or the service is down)', 'offline', String(err.message).slice(0, 120))
    }
    const all = htmlToText(page.html.replace(/<span class="sr-only"[^>]*>[\s\S]*?<\/span>/g, ''))
    const field = (name) => { const m = new RegExp(`(^|\\n)${name}\\n([^\\n]+)`).exec(all); return m ? m[2].trim() : null }
    const name = field('Kurztitel')
    const section = field('§/Artikel/Anlage')
    const at = all.search(/(^|\n)Text\n/)
    const text = at >= 0 ? all.slice(at).replace(/^\n?Text\n/, '') : all
    const title = [name, section].filter(Boolean).join(' ') || id
    return { ref: id, title, citation: connector.citation(id, { title }), url, text, inForceFrom: field('Inkrafttretensdatum'), ...(page.note ? { note: page.note } : {}) }
  },

  /** "ABGB § 933 (RIS, NOR12019008)". */
  citation(ref, x = {}) {
    const name = [x.abbreviation || x.title, x.abbreviation && x.section ? x.section : ''].filter(Boolean).join(' ').trim()
    return `${name ? `${name} ` : ''}(RIS, ${ref})`
  },
}

module.exports = connector
