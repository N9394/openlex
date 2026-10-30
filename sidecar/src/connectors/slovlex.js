"use strict"
/**
 * Slov-Lex — Slovak law from the Ministry of Justice's legislative portal,
 * read from its official JavaScript-free static edition
 * (static.slov-lex.sk): per act a version history and the full text of
 * each version. No key. Slovak legislation is an official work without
 * copyright (§ 5 of Act 185/2015 Z. z.), published as open data.
 *
 * Slov-Lex has no public search API, so a lookup is by the act's number
 * ("513/1991", "č. 40/1964 Zb.") or its common name ("Obchodný zákonník").
 */

const { getText, htmlToText, SourceError } = require('./http')
const { sliceSection } = require('./text')

const BASE = () => (process.env.OPENLEX_SLOVLEX_BASE || 'https://static.slov-lex.sk').replace(/\/+$/, '')
const LABEL = 'Slov-Lex'

// Common names → year/number of the act.
const ALIASES = {
  'ústava': [1992, 460], 'ustava': [1992, 460],
  'občiansky zákonník': [1964, 40], 'obciansky zakonnik': [1964, 40],
  'obchodný zákonník': [1991, 513], 'obchodny zakonnik': [1991, 513],
  'zákonník práce': [2001, 311], 'zakonnik prace': [2001, 311],
  'trestný zákon': [2005, 300], 'trestny zakon': [2005, 300],
  'trestný poriadok': [2005, 301], 'trestny poriadok': [2005, 301],
  'civilný sporový poriadok': [2015, 160], 'civilny sporovy poriadok': [2015, 160],
  'správny poriadok': [1967, 71], 'spravny poriadok': [1967, 71],
  'exekučný poriadok': [1995, 233], 'exekucny poriadok': [1995, 233],
  'autorský zákon': [2015, 185], 'autorsky zakon': [2015, 185],
  'zákon o ochrane osobných údajov': [2018, 18], 'ochrana osobných údajov': [2018, 18],
  'zákon o dani z pridanej hodnoty': [2004, 222], 'dph': [2004, 222],
  'zákon o dani z príjmov': [2003, 595],
  'zákon o obchodnom registri': [2003, 530],
  'zákon o konkurze a reštrukturalizácii': [2005, 7],
  'zákon o ochrane spotrebiteľa': [2024, 108],
}

/** [year, number] for "513/1991", "č. 40/1964 Zb.", "Z. z. 18/2018" or a common name; null otherwise. */
function parseRef(query) {
  const q = String(query || '').trim()
  const alias = ALIASES[q.toLowerCase().replace(/[.,;:!?]+$/, '')]
  if (alias) return alias
  const m = q.match(/\b(\d{1,4})\s*\/\s*(\d{4})\b/)
  if (m && +m[2] >= 1918 && +m[2] <= 2100) return [+m[2], +m[1]]
  const ref = q.match(/^(\d{4})\/(\d{1,4})$/) // our own ref form "1991/513"
  return ref ? [+ref[1], +ref[2]] : null
}

const zb = (year) => (year < 1993 ? 'Zb.' : 'Z. z.')
const nameOf = (y, n) => Object.entries(ALIASES).find(([k, v]) => v[0] === y && v[1] === n && /[^\x00-\x7f]/.test(k))?.[0] || null
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const portalUrl = (y, n) => `https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/${y}/${n}/`

/** Versions from the history page: [{ version, from, until }] (until '' = in force). */
async function versions(y, n) {
  const html = await getText(`${BASE()}/static/SK/ZZ/${y}/${n}/`, { label: LABEL })
  const out = []
  const re = /<tr class="effectivenessHistoryItem"[^>]*data-iri="[^"]*\/([\w]+)"[^>]*data-vyhlasene="(\d)"[^>]*data-ucinnostod="([^"]*)"[^>]*data-ucinnostdo="([^"]*)"/g
  let m
  while ((m = re.exec(html))) out.push({ version: m[1], promulgated: m[2] === '1', from: m[3] || null, until: m[4] || null })
  return out
}

function current(list) {
  const today = new Date().toISOString().slice(0, 10)
  const real = list.filter((v) => !v.promulgated && v.from)
  return real.find((v) => v.from <= today && (!v.until || v.until >= today)) || real.filter((v) => v.from <= today).at(-1) || list.at(-1) || null
}

const connector = {
  id: 'slovlex',
  label: 'Slov-Lex Slovakia',
  country: 'SK',
  jurisdictions: ['SK'],
  kind: 'law',
  description: 'Slovak law from the Ministry of Justice\'s official portal, current consolidated versions; looked up by the number of the law or its common name',
  licence: 'Official works, free of copyright (§ 5 of Act 185/2015 Z. z.), open data of the Ministry of Justice',
  licenceUrl: 'https://www.slov-lex.sk',
  homepage: 'https://www.slov-lex.sk',
  de: { label: 'Slov-Lex Slowakei', description: 'Slowakisches Recht aus dem Portal des Justizministeriums, geltende konsolidierte Fassung (Suche nach Nummer oder Name des Gesetzes)' },
  needsKey: false,
  broad: true,
  hosts: ['static.slov-lex.sk'],
  /** Only a law number or a known name can be looked up. */
  canSearch: (query) => !!parseRef(query),
  searchHint: 'Slov-Lex is looked up by the number of the law (for example 513/1991) or its common name (Obchodný zákonník)',

  async search(query) {
    const ref = parseRef(query)
    if (!ref) throw new SourceError(connector.searchHint, 'unsupported')
    const [y, n] = ref
    let list
    try { list = await versions(y, n) } catch (err) {
      if (err.code === 'notfound') return []
      throw err
    }
    const cur = current(list)
    if (!cur) return []
    const name = nameOf(y, n)
    return [{
      ref: `${y}/${n}`,
      title: `${name ? `${cap(name)}, ` : ''}č. ${n}/${y} ${zb(y)}`,
      citation: connector.citation(`${y}/${n}`),
      url: portalUrl(y, n),
      snippet: cur.from ? `version in force from ${cur.from}${cur.until ? ` until ${cur.until}` : ''}` : 'as promulgated',
      date: cur.from,
      inForce: !cur.until || cur.until >= new Date().toISOString().slice(0, 10),
      version: cur.version,
    }]
  },

  /** Full text of the version in force (one section with article: "§ 40"). */
  async get(ref, { article = null } = {}) {
    const r = parseRef(ref)
    if (!r) throw new SourceError(`${LABEL}: give the number of the law, for example 513/1991`, 'bad')
    const [y, n] = r
    const cur = current(await versions(y, n))
    if (!cur) throw new SourceError(`${LABEL} has no text for č. ${n}/${y} ${zb(y)}`, 'notfound')
    const url = `${BASE()}/static/SK/ZZ/${y}/${n}/${cur.version}.html`
    const html = await getText(url, { label: LABEL })
    const at = html.indexOf('id="predpis"')
    const body = at >= 0 ? html.slice(html.lastIndexOf('<', at)) : html
    const full = htmlToText(body.replace(/<div id="footer"[\s\S]*$/i, ''))
    const part = article ? sliceSection(full, article, '§') : null
    if (article && !part) throw new SourceError(`${LABEL}: § ${String(article).replace(/^§\s*/, '')} was not found in č. ${n}/${y} ${zb(y)}`, 'notfound')
    const name = nameOf(y, n)
    return { ref: `${y}/${n}`, title: `${name ? `${cap(name)}, ` : ''}č. ${n}/${y} ${zb(y)} (version from ${cur.from || 'promulgation'})`, citation: connector.citation(`${y}/${n}`, { section: part ? String(article).replace(/^§\s*/, '') : null }), url, text: part || full }
  },

  /** "§ 40 zákona č. 513/1991 Zb. (Slov-Lex)". */
  citation(ref, x = {}) {
    const r = parseRef(ref)
    if (!r) return `${ref} (Slov-Lex)`
    const [y, n] = r
    return `${x.section ? `§ ${x.section} zákona ` : ''}č. ${n}/${y} ${zb(y)} (Slov-Lex)`
  },
}

module.exports = { ...connector, parseRef, _versions: versions }
