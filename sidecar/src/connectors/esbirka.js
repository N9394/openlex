"use strict"
/**
 * e-Sbírka — Czech law from the state's electronic Collection of Laws
 * (e-sbirka.gov.cz). Czech legislation is an official work without
 * copyright (§ 3 of Act 121/2000 Sb.).
 *
 * Official paths only, two of them:
 *   - without a key (the default): the state's open data for e-Sbírka,
 *     published under CC0 (opendata.eselpoint.cz, SPARQL endpoint): an act
 *     by its number, full-text search over the consolidated versions in
 *     force, and the text of an act or one § of it;
 *   - with the lawyer's own free key (an upgrade): the registered public
 *     REST API, api.e-sbirka.gov.cz (header esel-api-access-key), with the
 *     state's own relevance search. The key comes from the Ministry of the
 *     Interior by data box (docs/SOURCES.md#esbirka).
 * OpenLex does not use the JSON service behind the e-Sbírka website: it is
 * not a published interface.
 */

const { getJson, request, strip, SourceError } = require('./http')

const LABEL = 'e-Sbírka'
const API = () => (process.env.OPENLEX_ESBIRKA_API || 'https://api.e-sbirka.gov.cz').replace(/\/+$/, '')
const SPARQL = () => process.env.OPENLEX_ESBIRKA_SPARQL || 'https://opendata.eselpoint.cz/sparql'
const ELI = 'https://opendata.eselpoint.gov.cz/esel-esb/eli/cz'
const PREFIX = 'PREFIX s: <https://slovník.gov.cz/datový/sbírka/pojem/>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n'
const SITE = 'https://e-sbirka.gov.cz'
const MAX_PAGES = 30
const MAX_FRAGMENTS = 2500

async function call(path, key, { method = 'GET', body } = {}) {
  const opts = { label: LABEL, headers: { 'esel-api-access-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, method, redirect: 'manual' }
  if (body) opts.body = JSON.stringify(body)
  return getJson(`${API()}${path}`, opts)
}

/** Rows of a SPARQL SELECT on the open-data endpoint ([{ var: value }]). */
async function sparql(query) {
  const res = await request(SPARQL(), {
    label: LABEL, method: 'POST', timeoutMs: 45000,
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ query: PREFIX + query }).toString(),
  })
  let j
  try { j = await res.json() } catch { throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not JSON') }
  return (j?.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])))
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
const today = () => new Date().toISOString().slice(0, 10)
const lit = (s) => `"${String(s).replace(/["\\\n\r]/g, ' ')}"`

// ── open data (no key) ───────────────────────────────────────────────────

/** The version in force today ({ iri, date, from, until }), else the latest one before today, else the promulgated text. */
async function currentVersion(ref) {
  const rows = await sparql(`SELECT ?v ?od ?do ?t WHERE { <${ELI}${ref}> s:má-znění ?v . OPTIONAL { ?v s:účinnost-znění-od ?od } OPTIONAL { ?v s:účinnost-znění-do ?do } OPTIONAL { ?v s:má-typ-znění-právního-aktu ?t } }`)
  if (!rows.length) return null
  const t = today()
  const list = rows.map((r) => ({ iri: r.v, date: r.v.slice(r.v.lastIndexOf('/') + 1), from: r.od || null, until: r.do || null, consolidated: /KONSOL$/.test(r.t || '') }))
  const cons = list.filter((v) => v.consolidated && v.from).sort((a, b) => a.from.localeCompare(b.from))
  const now = cons.find((v) => v.from <= t && (!v.until || v.until >= t))
  const past = cons.filter((v) => v.from <= t).at(-1)
  const v = now || past || list.find((x) => !x.consolidated) || list[0]
  return { ...v, inForce: now ? true : past ? false : null }
}

/** "Zákon č. 89/2012 Sb., občanský zákoník" from the first fragments of a version. */
async function titleOf(versionIri, ref) {
  const m = ref.match(/^\/sb\/(\d{4})\/(\d{1,4})$/)
  const code = m ? `${m[2]}/${m[1]} Sb.` : ref
  let rows = []
  try { rows = await sparql(`SELECT ?ord ?txt WHERE { <${versionIri}> s:má-fragment-znění ?f . ?f s:pořadí-fragmentu-znění-právního-aktu ?ord ; s:obsahuje-fragment ?x . ?x s:text-fragmentu ?txt } ORDER BY ?ord LIMIT 8`) } catch { /* the number is enough */ }
  const texts = rows.map((r) => strip(r.txt)).filter(Boolean)
  const kindAt = texts.findIndex((x) => /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]{5,}$/.test(x))
  const kind = kindAt >= 0 ? texts[kindAt].charAt(0) + texts[kindAt].slice(1).toLowerCase() : 'Předpis'
  const dated = texts.findIndex((x, i) => i > kindAt && /^ze dne /.test(x))
  const name = dated >= 0 && texts[dated + 1] && !/usnesl|nařizuje|stanoví/.test(texts[dated + 1]) ? texts[dated + 1] : ''
  return `${kind} č. ${code}${name ? `, ${name}` : ''}`
}

const STATE_WORDS = (v) => (v.inForce ? `in force, version from ${v.from}` : v.inForce === false ? `no version in force today (last from ${v.from})` : 'as promulgated')

async function openByNumber(ref) {
  const v = await currentVersion(ref)
  if (!v) return []
  return [{ ref, title: await titleOf(v.iri, ref), citation: connector.citation(ref), url: `${SITE}${ref}/${v.date}`, snippet: STATE_WORDS(v), date: v.from, inForce: v.inForce }]
}

/** Full text over the consolidated versions in force today: one hit per act. */
async function openSearch(query, limit) {
  const words = [...new Set((String(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !/^(a|i|o|u|v|z|s|k|na|do|se|je|č|sb)$/.test(w)))].slice(0, 6)
  if (!words.length) return []
  const t = today()
  const rows = await sparql(`SELECT ?url ?cit ?txt ?od ?do WHERE {
  ?x s:text-fragmentu ?txt . ?txt bif:contains '${words.map((w) => `"${w}"`).join(' AND ')}' .
  ?o s:obsahuje-fragment ?x ; s:url-fragmentu-znění ?url . FILTER(STRSTARTS(?url, "/sb/"))
  ?v s:má-fragment-znění ?o ; s:má-typ-znění-právního-aktu ?t ; s:účinnost-znění-od ?od . FILTER(STRENDS(STR(?t), "/KONSOL"))
  OPTIONAL { ?v s:účinnost-znění-do ?do }
  OPTIONAL { ?o s:citace-označení-fragmentu-znění-právního-aktu ?cit }
  FILTER(?od <= "${t}"^^xsd:date && (!BOUND(?do) || ?do >= "${t}"^^xsd:date))
} LIMIT 80`)
  const out = []
  const seen = new Set()
  for (const r of rows) {
    const ref = baseRef(r.url)
    if (!/^\/sb\/\d{4}\/\d{1,4}$/.test(ref) || seen.has(ref)) continue
    seen.add(ref)
    const m = ref.match(/^\/sb\/(\d{4})\/(\d{1,4})$/)
    const section = r.cit ? String(r.cit).trim() : ''
    out.push({
      ref,
      title: `č. ${m[2]}/${m[1]} Sb.${section ? `, ${section}` : ''}`,
      citation: connector.citation(ref, { section: /^§/.test(section) ? section.replace(/^§\s*/, '') : null }),
      url: `${SITE}${r.url}`,
      snippet: `in force, version from ${r.od} · ${strip(String(r.txt).replace(/<\/?var>/g, ''))}`.slice(0, 600),
      date: r.od,
      inForce: true,
    })
    if (out.length >= limit) break
  }
  return out
}

async function openGet(base, num) {
  const v = await currentVersion(base)
  if (!v) throw new SourceError(`${LABEL} has no such document`, 'notfound')
  const head = num
    ? `{ <${v.iri}> s:má-fragment-znění ?p . ?p s:citace-označení-fragmentu-znění-právního-aktu ?pc . FILTER(STR(?pc) = ${lit(`§ ${num}`)}) ?f s:má-předka+ ?p . }`
    : `<${v.iri}> s:má-fragment-znění ?f .`
  const rows = await sparql(`SELECT ?ord ?txt WHERE { ${head} ?f s:pořadí-fragmentu-znění-právního-aktu ?ord ; s:obsahuje-fragment ?x . ?x s:text-fragmentu ?txt } ORDER BY ?ord LIMIT ${MAX_FRAGMENTS}`)
  const lines = rows.map((r) => strip(String(r.txt).replace(/<\/?var>/g, ''))).filter(Boolean)
  if (num && !lines.length) throw new SourceError(`${LABEL}: § ${num} was not found in ${base.replace(/^\/sb\/(\d{4})\/(\d{1,4})$/, '$2/$1 Sb.')}`, 'notfound')
  let text = (num ? [`§ ${num}`, ...lines] : lines).join('\n')
  if (text.length > 60000) text = text.slice(0, 60000)
  return {
    ref: base,
    title: await titleOf(v.iri, base),
    citation: connector.citation(base, { section: num }),
    url: `${SITE}${base}/${v.date}${num ? `#par_${num}` : ''}`,
    text,
    version: v.from,
  }
}

// ── registered REST API (with the key) ───────────────────────────────────

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
  keyHelp: 'Optional: your free key for the official e-Sbírka REST API, from the Czech Ministry of the Interior by data box (answer within 10 working days). Without it OpenLex uses the state\'s open data, which covers look-ups by number, full-text search and the text in force.',
  guide: 'esbirka',
  hosts: ['opendata.eselpoint.cz', 'api.e-sbirka.gov.cz'],

  async search(query, { limit = 8 } = {}, { key = null } = {}) {
    if (!key) {
      const ref = parseRef(query)
      if (ref) { const hit = await openByNumber(ref); if (hit.length) return hit }
      return openSearch(query.replace(/\b\d{1,4}\s*\/\s*\d{4}\b|\bč\.|\bSb\./g, ' '), limit)
    }
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
    if (!key) return openGet(base, article ? String(article).replace(/^\s*§+\s*/, '').trim() : null)
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
