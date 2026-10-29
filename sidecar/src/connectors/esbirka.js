"use strict"
/**
 * e-Sbírka — Czech law from the state's electronic Collection of Laws
 * (e-sbirka.gov.cz, Digital and Information Agency). Full-text search,
 * act metadata and the consolidated text as fragments. Czech legislation is
 * an official work without copyright (§ 3 of Act 121/2000 Sb.).
 *
 * Two ways in, same paths and answers:
 *   - with a free API key from the agency (header esel-api-access-key):
 *     the registered open-data API, api.e-sbirka.gov.cz;
 *   - without a key: the public JSON service behind the e-Sbírka website.
 */

const { getJson, strip, SourceError } = require('./http')

const LABEL = 'e-Sbírka'
const KEYED = () => (process.env.OPENLEX_ESBIRKA_API || 'https://api.e-sbirka.gov.cz').replace(/\/+$/, '')
const PUBLIC = () => (process.env.OPENLEX_ESBIRKA_PUBLIC || 'https://e-sbirka.gov.cz/sbr-cache').replace(/\/+$/, '')
const SITE = 'https://e-sbirka.gov.cz'
const MAX_PAGES = 30

function channel(key) {
  return key ? { base: KEYED(), headers: { 'esel-api-access-key': key }, redirect: 'manual' } : { base: PUBLIC(), headers: {}, redirect: 'follow' }
}

async function call(path, key, { method = 'GET', body } = {}) {
  const c = channel(key)
  const opts = { label: LABEL, headers: { ...c.headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, method, redirect: c.redirect }
  if (body) opts.body = JSON.stringify(body)
  return getJson(`${c.base}${path}`, opts)
}

/** "/sb/2012/89" for "89/2012", "č. 89/2012 Sb.", "/sb/2012/89/2026-01-01"; null otherwise. */
function parseRef(query) {
  const q = String(query || '').trim()
  const stale = q.match(/^\/sb\/(\d{4})\/(\d{1,4})(?:\/[\d-]+)?/)
  if (stale) return `/sb/${stale[1]}/${stale[2]}`
  const m = q.match(/\b(\d{1,4})\s*\/\s*(\d{4})\b/)
  return m && +m[2] >= 1918 && +m[2] <= 2100 ? `/sb/${m[2]}/${m[1]}` : null
}
const baseRef = (staleUrl) => String(staleUrl || '').replace(/^(\/sb\/\d{4}\/\d{1,4}).*$/, '$1')
const enc = (stale) => encodeURIComponent(stale)

const STATES = { AKTUALNE_PLATNY: 'in force', PLATNY: 'in force', ZRUSENY: 'repealed', VYHLASENY_BEZ_UCINNOSTI: 'promulgated, not yet in effect' }

const connector = {
  id: 'esbirka',
  label: 'e-Sbírka Czechia',
  country: 'CZ',
  jurisdictions: ['CZ'],
  kind: 'law',
  description: 'Czech law from the state\'s electronic Collection of Laws, current consolidated versions with full-text search',
  licence: 'Official works, free of copyright (§ 3 of Act 121/2000 Sb.); published by the Digital and Information Agency',
  licenceUrl: 'https://e-sbirka.gov.cz',
  homepage: 'https://e-sbirka.gov.cz',
  needsKey: false,
  optionalKey: true,
  keyHelp: 'Optional: a free key for the registered e-Sbírka API from the Digital and Information Agency (DIA). Without it OpenLex uses the public e-Sbírka service.',
  hosts: ['e-sbirka.gov.cz', 'api.e-sbirka.gov.cz'],

  async search(query, { limit = 8 } = {}, { key = null } = {}) {
    const ref = parseRef(query)
    if (ref) {
      try {
        const d = await call(`/dokumenty-sbirky/${enc(ref)}`, key)
        return [connector._item({ staleUrl: d.staleUrl || ref, nazev: d.uplnaCitace || d.nazev, kodDokumentuSbirky: d.kodDokumentuSbirky, stavDokumentuSbirky: d.typZneni === 'AKTUALNI' ? 'AKTUALNE_PLATNY' : null, datum: d.datumUcinnostiZneniOd })]
      } catch (err) { if (err.code !== 'notfound') throw err }
    }
    const text = String(query).replace(/[„“"',;:()]|\bč\.|\bSb\./g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return []
    const d = await call('/rozsirena-vyhledavani', key, { method: 'POST', body: { start: 0, pocet: Math.min(limit, 20), razeni: ['+relevance'], fulltextVsechnaSlova: text } })
    if (!Array.isArray(d?.seznam)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no seznam')
    return d.seznam.slice(0, limit).map((x) => connector._item(x))
  },

  _item(x) {
    const ref = baseRef(x.staleUrl)
    return {
      ref,
      title: strip(x.nazev) || x.kodDokumentuSbirky || ref,
      citation: connector.citation(ref, { code: x.kodDokumentuSbirky }),
      url: `${SITE}${x.staleUrl || ref}`,
      snippet: STATES[x.stavDokumentuSbirky] || '',
      date: x.datum || null,
      inForce: x.stavDokumentuSbirky ? /PLATNY$/.test(x.stavDokumentuSbirky) : null,
    }
  },

  /** The current consolidated text (one section with article: "§ 2894" or "2894"). */
  async get(ref, { article = null } = {}, { key = null } = {}) {
    const base = parseRef(ref)
    if (!base) throw new SourceError(`${LABEL}: give the number of the law, for example 89/2012`, 'bad')
    const meta = await call(`/dokumenty-sbirky/${enc(base)}`, key)
    const stale = meta.staleUrl || base
    const num = article ? String(article).replace(/^\s*§+\s*/, '').trim() : null
    const want = num ? new RegExp(`#par_${num.replace(/[^\w]/g, '')}(?:$|-)`) : null
    const lines = []
    let pages = 1
    for (let page = 0; page < Math.min(pages, MAX_PAGES); page++) {
      const d = await call(`/dokumenty-sbirky/${enc(stale)}/fragmenty?cisloStranky=${page}`, key)
      pages = d.pocetStranek || 1
      for (const f of d.seznam || []) {
        if (!f.xhtml) continue
        if (want && !want.test(f.staleUrl || '')) { if (lines.length) break; continue }
        lines.push(strip(f.xhtml.replace(/<\/?var>/g, '')))
      }
      if (want && lines.length) break
      if (!want && lines.join('\n').length > 60000) break
    }
    if (num && !lines.length) throw new SourceError(`${LABEL}: § ${num} was not found in ${meta.kodDokumentuSbirky || base}`, 'notfound')
    return {
      ref: base,
      title: meta.uplnaCitace || meta.nazev || base,
      citation: connector.citation(base, { code: meta.kodDokumentuSbirky, section: num }),
      url: `${SITE}${stale}${num ? `#par_${num}` : ''}`,
      text: lines.join('\n'),
    }
  },

  /** "§ 2894 zákona č. 89/2012 Sb. (e-Sbírka)". */
  citation(ref, x = {}) {
    const m = String(ref).match(/^\/sb\/(\d{4})\/(\d{1,4})/)
    const code = x.code || (m ? `${m[2]}/${m[1]} Sb.` : ref)
    return `${x.section ? `§ ${x.section} zákona ` : ''}č. ${code} (e-Sbírka)`
  },
}

module.exports = { ...connector, parseRef }
