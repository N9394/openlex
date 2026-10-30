"use strict"
/**
 * Fedlex — Swiss federal law from the Federal Chancellery's publication
 * platform (fedlex.admin.ch), read through its open linked-data interface:
 * the SPARQL endpoint (fedlex.data.admin.ch/sparqlendpoint, JOLux model)
 * for the act, its SR number, title and consolidated versions, and the
 * official filestore for the text (HTML of the consolidated version).
 * No key. Federal acts are not protected by copyright (Art. 5 URG).
 *
 * A look-up is by SR number ("220", "SR 210", "0.101") or by words of the
 * title or the abbreviation ("Obligationenrecht", "DSG"). get() returns the
 * consolidated text in force today (or on `date`), one article with
 * article: "Art. 41" / "41" / "40a".
 */

const { request, getText, htmlToText, SourceError } = require('./http')
const { paced } = require('./pace')

const LABEL = 'Fedlex Switzerland'
const SPARQL = () => process.env.OPENLEX_FEDLEX_SPARQL || 'https://fedlex.data.admin.ch/sparqlendpoint'
const FILES = () => (process.env.OPENLEX_FEDLEX_FILES || '').replace(/\/+$/, '') // tests: where the filestore is
const ELI = 'https://fedlex.data.admin.ch/eli/cc/'
const SITE = 'https://www.fedlex.admin.ch/eli/cc/'
const PREFIX = 'PREFIX jolux: <http://data.legilux.public.lu/resource/ontology/jolux#>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\nPREFIX skos: <http://www.w3.org/2004/02/skos/core#>\n'
// Official languages only: the English translations on Fedlex are not legally binding.
const LANGS = { de: 'DEU', fr: 'FRA', it: 'ITA' }
const GAP_MS = 500 // no published limit: two requests a second at most, one at a time
const MAX_TEXT = 60000

const langOf = (lang) => (LANGS[String(lang || '').toLowerCase()] ? String(lang).toLowerCase() : 'de')
const langIri = (lang) => `<http://publications.europa.eu/resource/authority/language/${LANGS[langOf(lang)]}>`
const lit = (s) => `"${String(s).replace(/["\\\n\r]/g, ' ')}"`
const today = () => new Date().toISOString().slice(0, 10)

/** Rows of a SPARQL SELECT ([{ var: value }]). */
async function sparql(query) {
  const res = await paced('fedlex', GAP_MS, () => request(SPARQL(), {
    label: LABEL, method: 'POST', timeoutMs: 45000,
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ query: PREFIX + query }).toString(),
  }))
  let j
  try { j = await res.json() } catch { throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not JSON') }
  return (j?.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])))
}

/** "220" for "SR 220", "220", "SR-Nr. 0.101"; null otherwise. */
function parseSr(q) {
  const s = String(q || '').trim()
  const m = s.match(/^(?:SR(?:[- ]?Nr\.?)?\s*)?(\d{1,3}(?:\.\d{1,4})*)$/i) || s.match(/\bSR(?:[- ]?Nr\.?)?\s*(\d{1,3}(?:\.\d{1,4})*)\b/i)
  return m ? m[1] : null
}

/** "27/317_321_377" from a search ref, an ELI address or a fedlex.admin.ch link; null otherwise. */
function parseEli(ref) {
  const m = String(ref || '').trim().match(/(?:^|eli\/cc\/)(\d{1,4}\/[\w-]+)(?:\/|$|#)/)
  return m && !m[1].split('/').includes('..') ? m[1] : null
}

const actRows = (where, lang, limit) => sparql(`SELECT DISTINCT ?cc ?sr ?t ?ab ?st ?since WHERE {
  ?cc a jolux:ConsolidationAbstract ; jolux:classifiedByTaxonomyEntry ?x ; jolux:isRealizedBy ?e . ?x skos:notation ?sr .
  ?e jolux:language ${langIri(lang)} ; jolux:title ?t .
  OPTIONAL { ?e jolux:titleShort ?ab }
  OPTIONAL { ?cc jolux:inForceStatus ?st }
  OPTIONAL { ?cc jolux:dateEntryInForce ?since }
  ${where}
} LIMIT ${limit}`)

const titleOf = (r) => `${r.t}${r.ab && !String(r.t).includes(r.ab) ? ` (${r.ab})` : ''}`
const inForceOf = (st) => (st ? /\/enforcement-status\/0$/.test(st) : null)

function item(r, lang) {
  const id = r.cc.slice(ELI.length)
  const inForce = inForceOf(r.st)
  return {
    ref: id,
    title: titleOf(r),
    citation: connector.citation(id, { sr: r.sr, abbreviation: r.ab }),
    url: `${SITE}${id}/${langOf(lang)}`,
    snippet: [`SR ${r.sr}`, inForce === true ? 'in force' : inForce === false ? 'no longer in force' : ''].filter(Boolean).join(' · '),
    date: r.since || null,
    inForce,
  }
}

/** In force first, then the shortest title (the act itself before its ordinances). */
const order = (rows, abbr = null) => rows.sort((a, b) => (abbr ? (String(b.ab || '').toLowerCase() === abbr) - (String(a.ab || '').toLowerCase() === abbr) : 0) || (inForceOf(b.st) === true) - (inForceOf(a.st) === true) || a.t.length - b.t.length)

/** The consolidated version on a day ({ iri, date, file }), else null. */
async function version(id, lang, day) {
  const rows = await sparql(`SELECT ?c ?d ?file WHERE {
  ?c jolux:isMemberOf <${ELI}${id}> ; jolux:dateApplicability ?d . FILTER(?d <= ${lit(day)}^^xsd:date)
  ?c jolux:isRealizedBy ?ce . ?ce jolux:language ${langIri(lang)} ; jolux:isEmbodiedBy ?m .
  ?m jolux:userFormat <https://fedlex.data.admin.ch/vocabulary/user-format/html> ; jolux:isExemplifiedBy ?file
} ORDER BY DESC(?d) LIMIT 1`)
  return rows[0] ? { iri: rows[0].c, date: rows[0].d, file: rows[0].file } : null
}

/** The filestore address (tests point it at a fake server). */
const fileUrl = (file) => (FILES() ? file.replace(/^https:\/\/fedlex\.data\.admin\.ch\/filestore/, FILES()) : file)

/** "art_41", "art_40_a" for "Art. 41", "40a", "art. 40 a". */
function articleId(article) {
  const m = String(article || '').trim().match(/^(?:art(?:icle|ikel|\.)?\s*)?(\d+)\s*([a-z]{0,6})$/i)
  return m ? `art_${m[1]}${m[2] ? `_${m[2].toLowerCase()}` : ''}` : null
}

/** Plain text of a Fedlex HTML page or part of it (footnote markers and notes dropped). */
function textOf(html) {
  const clean = String(html)
    .replace(/<div class="footnotes">[\s\S]*?<\/div>/g, '')
    .replace(/<sup><a href="#fn[^"]*"[^>]*>[^<]*<\/a><\/sup>/g, '')
    .replace(/<a name="[^"]*"><\/a>/g, '')
    .replace(/<\/dl>/g, '<br>').replace(/<dt[^>]*>/g, '<br>').replace(/<\/dt>\s*<dd[^>]*>/g, ' ')
  return htmlToText(clean).replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const connector = {
  id: 'fedlex',
  label: 'Fedlex Switzerland',
  country: 'CH',
  jurisdictions: ['CH'],
  kind: 'law',
  description: 'Swiss federal law from the Federal Chancellery\'s official publication platform: the Classified Compilation (SR), consolidated versions in German, French and Italian',
  licence: 'Federal acts are free of copyright (Art. 5 URG); official publication of the Swiss Federal Chancellery',
  licenceUrl: 'https://www.fedlex.admin.ch/de/broadcasters',
  homepage: 'https://www.fedlex.admin.ch',
  needsKey: false,
  guide: 'fedlex',
  hosts: ['fedlex.data.admin.ch'],
  sample: '220',
  de: {
    label: 'Fedlex Schweiz',
    description: 'Schweizer Bundesrecht von der amtlichen Publikationsplattform der Bundeskanzlei: Systematische Rechtssammlung (SR), konsolidierte Fassungen auf Deutsch, Französisch und Italienisch',
  },

  async search(query, { limit = 8, lang = 'de' } = {}) {
    const sr = parseSr(query)
    if (sr) {
      const rows = await actRows(`FILTER(STR(?sr) = ${lit(sr)})`, lang, 10)
      if (rows.length) return order(rows).slice(0, limit).map((r) => item(r, lang))
    }
    const words = [...new Set((String(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []))].slice(0, 6)
    if (!words.length) return []
    const abbr = words.length === 1 ? ` || LCASE(STR(?ab)) = ${lit(words[0])}` : ''
    const rows = await actRows(`FILTER((${words.map((w) => `CONTAINS(LCASE(STR(?t)), ${lit(w)})`).join(' && ')})${abbr})`, lang, 40)
    return order(rows, words.length === 1 ? words[0] : null).slice(0, limit).map((r) => item(r, lang))
  },

  /** The consolidated text in force today (or on `date`); one article with article: "Art. 41". */
  async get(ref, { article = null, lang = 'de', date = null } = {}) {
    let id = parseEli(ref)
    const l = langOf(lang)
    if (!id) {
      const sr = parseSr(ref)
      if (!sr) throw new SourceError(`${LABEL}: give the SR number (for example 220) or the reference from a search result`, 'bad')
      const rows = order(await actRows(`FILTER(STR(?sr) = ${lit(sr)})`, l, 10))
      if (!rows.length) throw new SourceError(`${LABEL} has no such document`, 'notfound')
      id = rows[0].cc.slice(ELI.length)
    }
    const day = /^\d{4}-\d\d-\d\d$/.test(String(date || '')) ? date : today()
    const [meta] = await actRows(`FILTER(?cc = <${ELI}${id}>)`, l, 1)
    const v = await version(id, l, day)
    if (!v) throw new SourceError(`${LABEL} has no consolidated text of this act${date ? ` for ${day}` : ''} in this language`, 'notfound')
    const html = await paced('fedlex', GAP_MS, () => getText(fileUrl(v.file), { label: LABEL, headers: { Accept: 'text/html' }, timeoutMs: 60000 }))
    let text
    const art = article ? articleId(article) : null
    if (article) {
      if (!art) throw new SourceError(`${LABEL}: give the article as "Art. 41" or "41"`, 'bad')
      const m = html.match(new RegExp(`<article id="${art}">([\\s\\S]*?)</article>`))
      if (!m) throw new SourceError(`${LABEL}: Art. ${String(article).replace(/^\s*art(?:icle|ikel|\.)?\s*/i, '')} was not found in ${meta?.ab || `SR ${meta?.sr || id}`}`, 'notfound')
      text = textOf(m[1])
    } else {
      const main = html.match(/<main id="maintext">([\s\S]*)<\/main>/)
      text = textOf(main ? main[1] : html)
      if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n…`
    }
    const artNo = art ? art.replace(/^art_/, '').replace('_', '') : null
    const title = meta ? titleOf(meta) : id
    return {
      ref: id,
      title,
      citation: connector.citation(id, { sr: meta?.sr, abbreviation: meta?.ab, article: artNo }),
      url: `${SITE}${id}/${l}${art ? `#${art}` : ''}`,
      text,
      version: v.date,
      note: `Consolidated version of ${v.date}`,
    }
  },

  /** "Art. 41 OR (SR 220, Fedlex)". */
  citation(ref, x = {}) {
    const name = [x.article ? `Art. ${x.article}` : '', x.abbreviation || ''].filter(Boolean).join(' ')
    return `${name ? `${name} ` : ''}(${x.sr ? `SR ${x.sr}` : `eli/cc/${ref}`}, Fedlex)`
  },
}

module.exports = { ...connector, parseSr, articleId }
