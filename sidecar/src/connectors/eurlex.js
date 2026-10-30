"use strict"
/**
 * EUR-Lex — EU law from the Publications Office's open Cellar (SPARQL for
 * metadata, content negotiation for the text). Reuses web/eurlex.js.
 * Reuse is free with attribution (Commission Decision 2011/833/EU).
 */

const { SourceError } = require('./http')

function wrap(err) {
  if (err instanceof SourceError) throw err
  const m = String(err?.message || err)
  if (/not a CELEX|not found in/i.test(m)) throw new SourceError(`EUR-Lex: ${m}`, 'notfound')
  if (/HTTP 404/.test(m)) throw new SourceError('EUR-Lex has no such act in this language', 'notfound', m)
  if (/HTTP \d/.test(m)) throw new SourceError('EUR-Lex is not answering right now; try again later', 'down', m)
  throw new SourceError('EUR-Lex could not be reached (no internet connection, or the service is down)', 'offline', m.slice(0, 120))
}

const connector = {
  id: 'eurlex',
  label: 'EUR-Lex',
  country: 'EU',
  jurisdictions: ['EU'],
  kind: 'law',
  description: 'EU law from the EU Publications Office: regulations, directives and decisions, with in-force status and consolidated versions',
  licence: '© European Union, free reuse with attribution (Commission Decision 2011/833/EU)',
  licenceUrl: 'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html',
  homepage: 'https://eur-lex.europa.eu',
  de: { label: 'EUR-Lex', description: 'EU-Recht vom Amt für Veröffentlichungen der EU: Verordnungen, Richtlinien und Beschlüsse, mit Geltungsstatus und konsolidierten Fassungen' },
  needsKey: false,
  broad: true,
  hosts: ['publications.europa.eu'],

  async search(query, { limit = 8, lang = 'en' } = {}) {
    let r
    try { r = await require('../web/eurlex').search(query, { lang, limit }) } catch (err) { wrap(err) }
    return r.results.map((x) => ({
      ref: x.celex,
      title: x.title || x.celex,
      citation: connector.citation(x.celex, x),
      url: x.url,
      snippet: [x.inForce === false ? 'not in force' : x.inForce ? 'in force' : '', x.consolidated ? `consolidated version ${x.consolidated.date || x.consolidated.celex}` : ''].filter(Boolean).join(' · '),
      date: x.date,
      inForce: x.inForce,
    }))
  },

  async get(ref, { lang = 'en', article = null } = {}) {
    let r
    try { r = await require('../web/eurlex').text(String(ref || '').trim(), { lang, article }) } catch (err) { wrap(err) }
    return { ref: r.celex, title: `CELEX ${r.celex}${r.article ? `, Article ${r.article}` : ''}`, citation: connector.citation(r.celex, { article: r.article }), url: r.url, text: r.text }
  },

  /** "Article 17, CELEX 32016R0679 (EUR-Lex)". */
  citation(ref, x = {}) {
    return `${x.article ? `Article ${x.article}, ` : ''}CELEX ${ref} (EUR-Lex)`
  },
}

module.exports = connector
