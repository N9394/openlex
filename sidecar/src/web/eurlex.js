"use strict"
/**
 * EUR-Lex adapter — EU law from the Publications Office's open Cellar
 * (publications.europa.eu): the SPARQL endpoint for metadata and HTTP
 * content negotiation for the text. Official, no key, no scraping (the
 * eur-lex.europa.eu pages sit behind a bot check; Cellar does not).
 *
 *   search(query)  — a reference ("2016/679", "Regulation (EC) No 593/2008",
 *                    CELEX "32016R0679"), a common name ("GDPR", "DSGVO",
 *                    "AI Act") — fast, ~0.3 s — or title words (slow, ~30 s:
 *                    SPARQL text scan). Each hit carries in-force status and
 *                    the latest consolidated version.
 *   text(celex)    — plain text in the wanted language, optionally one
 *                    article; consolidated version preferred.
 */

const SPARQL = process.env.OPENLEX_CELLAR_SPARQL || 'https://publications.europa.eu/webapi/rdf/sparql'
const CELLAR = process.env.OPENLEX_CELLAR_BASE || 'http://publications.europa.eu/resource/celex'
const UA = 'OpenLex (+https://openlex.dev)'
const STR = '^^<http://www.w3.org/2001/XMLSchema#string>'

// ISO 639-1 → Publications Office authority code (Cellar languages).
const LANG3 = {
  en: 'ENG', de: 'DEU', fr: 'FRA', it: 'ITA', es: 'SPA', nl: 'NLD', pl: 'POL', cs: 'CES', sk: 'SLK', ro: 'RON',
  hu: 'HUN', hr: 'HRV', sl: 'SLV', el: 'ELL', pt: 'POR', bg: 'BUL', da: 'DAN', fi: 'FIN', sv: 'SWE', et: 'EST', lv: 'LAV', lt: 'LIT', mt: 'MLT', ga: 'GLE',
}
// "Article" in each language, for cutting one article out of the text.
const ARTICLE = ['Article', 'Artikel', 'Articolo', 'Artículo', 'Artigo', 'Artykuł', 'Článek', 'Článok', 'Articolul', 'Cikk', 'Članak', 'Člen', 'Άρθρο', 'Член', 'Artikla', 'Artikkel', 'Straipsnis', 'Pants', 'Paragrahv', 'Artiklu', 'Airteagal']

// Common names lawyers use → CELEX of the base act.
const ALIASES = {
  gdpr: '32016R0679', dsgvo: '32016R0679', rgpd: '32016R0679', avg: '32016R0679',
  'rome i': '32008R0593', 'rom i': '32008R0593', 'rome ii': '32007R0864', 'rom ii': '32007R0864',
  'brussels ia': '32012R1215', 'brussels i bis': '32012R1215', 'brüssel ia': '32012R1215', 'eugvvo': '32012R1215',
  dsa: '32022R2065', 'digital services act': '32022R2065', dma: '32022R1925', 'digital markets act': '32022R1925',
  'ai act': '32024R1689', 'ki-verordnung': '32024R1689', 'data act': '32023R2854', nis2: '32022L2555',
  dora: '32022R2554', eidas: '32014R0910', 'mifid ii': '32014L0065', mifir: '32014R0600', csrd: '32022L2464',
  csddd: '32024L1760', 'whistleblower directive': '32019L1937', 'whistleblowing directive': '32019L1937',
  'vat directive': '32006L0112', 'mwst-systemrichtlinie': '32006L0112', 'insolvency regulation': '32015R0848', 'euinsvo': '32015R0848',
  'service of documents regulation': '32020R1784', 'evidence regulation': '32020R1783', 'succession regulation': '32012R0650',
  'mica': '32023R1114', 'tfeu': '12016E', 'aeuv': '12016E', 'teu': '12016M', 'euv': '12016M', 'charter': '12016P', 'grc': '12016P',
}

async function sparql(query, timeoutMs = 60000) {
  const url = `${SPARQL}?${new URLSearchParams({ query })}`
  const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`EU Publications Office SPARQL → HTTP ${res.status}`)
  const json = await res.json()
  return (json.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])))
}

/** CELEX candidates for a reference or common name, or null for free text. */
function parseReference(query) {
  const q = String(query || '').trim()
  const lower = q.toLowerCase().replace(/[.,;:!?]+$/, '')
  if (ALIASES[lower]) return [ALIASES[lower]]
  const celex = q.match(/\b([0-9]{5}[A-Z]{1,2}[0-9]{2,4}(?:\([0-9]+\))?)\b/)
  if (celex) return [celex[1]]
  // "2016/679", "(EU) 2016/679", "No 593/2008", "1215/2012"
  const m = q.match(/(?:No\.?\s*|Nr\.?\s*)?\b(\d{1,4})\s*\/\s*(\d{1,4})\b/i)
  if (!m) return null
  let [a, b] = [m[1], m[2]]
  // Year comes first since 2015 ("2016/679"); before, number first ("593/2008").
  let year, num
  if (a.length === 4 && +a >= 1950 && +a <= 2100 && !(b.length === 4 && +b >= 1950)) { year = a; num = b } else { year = b; num = a }
  if (year.length === 2) year = (+year > 50 ? '19' : '20') + year
  const n = num.padStart(4, '0')
  const t = /regulation|verordnung|règlement|reglement|regolamento|reglamento|nařízení|nariadenie|rozporządzenie|regulamentul/i.test(q) ? ['R']
    : /directive|richtlinie|directiva|direttiva|směrnice|smernica|dyrektywa|directiva/i.test(q) ? ['L']
      : /decision|beschluss|entscheidung|décision|decisione|decisión|rozhodnutí/i.test(q) ? ['D']
        : ['R', 'L', 'D']
  return t.map((x) => `3${year}${x}${n}`)
}

const eurlexUrl = (celex, lang = 'en') => `https://eur-lex.europa.eu/legal-content/${lang.toUpperCase()}/TXT/?uri=CELEX:${encodeURIComponent(celex)}`

async function describe(celexList, lang) {
  const L = LANG3[lang] || 'ENG'
  const values = celexList.map((c) => `"${c.replace(/"/g, '')}"${STR}`).join(' ')
  const rows = await sparql(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT ?celex ?title ?force ?date ?cons ?consDate WHERE {
  VALUES ?celex { ${values} }
  ?w cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?w cdm:resource_legal_in-force ?force }
  OPTIONAL { ?w cdm:work_date_document ?date }
  OPTIONAL { ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${L}> ; cdm:expression_title ?title }
  OPTIONAL { ?c cdm:act_consolidated_based_on_resource_legal ?w ; cdm:resource_legal_id_celex ?cons . OPTIONAL { ?c cdm:act_consolidated_date ?consDate } }
}`, 30000)
  const byCelex = new Map()
  for (const r of rows) {
    const cur = byCelex.get(r.celex) || { celex: r.celex, title: r.title || null, inForce: r.force === undefined ? null : r.force === '1' || r.force === 'true', date: r.date || null, consolidated: null }
    if (!cur.title && r.title) cur.title = r.title
    if (r.cons && (!cur.consolidated || r.cons > cur.consolidated.celex)) cur.consolidated = { celex: r.cons, date: r.consDate || null }
    byCelex.set(r.celex, cur)
  }
  return celexList.map((c) => byCelex.get(c)).filter(Boolean).map((r) => ({ ...r, url: eurlexUrl(r.consolidated?.celex || r.celex, lang) }))
}

async function titleSearch(query, lang, limit) {
  const L = LANG3[lang] || 'ENG'
  const words = String(query).toLowerCase().replace(/["\\]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6)
  if (!words.length) return []
  const rows = await sparql(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex WHERE {
  ?w cdm:resource_legal_id_celex ?celex ; cdm:work_has_resource-type ?type .
  FILTER(?type IN (<http://publications.europa.eu/resource/authority/resource-type/REG>, <http://publications.europa.eu/resource/authority/resource-type/DIR>, <http://publications.europa.eu/resource/authority/resource-type/DEC>))
  ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${L}> ; cdm:expression_title ?t .
  ${words.map((w) => `FILTER(CONTAINS(LCASE(STR(?t)), "${w}"))`).join('\n  ')}
  FILTER(!CONTAINS(STR(?celex), "R("))
} LIMIT ${Math.min(limit, 20)}`, 90000)
  return rows.map((r) => r.celex)
}

/**
 * @returns {Promise<{ results: Array<{celex,title,inForce,date,consolidated,url}>, mode: 'reference'|'title' }>}
 */
async function search(query, { lang = 'en', limit = 8, inForceOnly = false } = {}) {
  const ref = parseReference(query)
  let results
  if (ref) results = await describe(ref, lang)
  else {
    const celexes = await titleSearch(query, lang, limit * 2)
    results = celexes.length ? await describe(celexes, lang) : []
  }
  if (inForceOnly) results = results.filter((r) => r.inForce !== false)
  // In force first, newest first.
  results.sort((a, b) => (b.inForce === true) - (a.inForce === true) || String(b.date || '').localeCompare(String(a.date || '')))
  return { results: results.slice(0, limit), mode: ref ? 'reference' : 'title' }
}

const NAMED = {
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ecirc: 'ê', Eacute: 'É',
  aacute: 'á', agrave: 'à', acirc: 'â', iacute: 'í', oacute: 'ó', uacute: 'ú', ccedil: 'ç', ntilde: 'ñ', scaron: 'š', zcaron: 'ž', ccaron: 'č',
  ndash: '–', mdash: '—', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', sect: '§', para: '¶', euro: '€', copy: '©', deg: '°', middot: '·',
}

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&([A-Za-z]+);/g, (m, n) => NAMED[n] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{2,}/g, '\n')
    // Paragraph markers sit in their own table cell: "1.\nText" → "1. Text".
    .replace(/(^|\n)(\(?[0-9]{1,3}[a-z]?[.)]|\([a-z]{1,4}\)|[a-z]\))[ \t]*\n/g, '$1$2 ')
    .trim()
}

/** One article: from its heading line to the next article heading. */
function sliceArticle(text, article) {
  const words = ARTICLE.join('|')
  const num = String(article).replace(/[^\dA-Za-z]/g, '')
  const start = new RegExp(`(^|\\n)(?:${words})\\s+${num}\\s*\\n`, 'iu').exec(text)
  if (!start) return null
  const from = start.index + start[1].length
  const rest = text.slice(from + start[0].length - start[1].length)
  const next = new RegExp(`\\n(?:${words})\\s+\\d+[a-z]?\\s*\\n`, 'iu').exec(rest)
  return text.slice(from, from + (start[0].length - start[1].length) + (next ? next.index : rest.length)).trim()
}

/**
 * Text of an act (consolidated version when one exists).
 * @returns {Promise<{ celex, lang, text, article: string|null, url }>}
 */
async function text(celex, { lang = 'en', article = null, preferConsolidated = true } = {}) {
  let target = String(celex || '').trim()
  if (!/^[0-9][0-9A-Z()\-]+$/.test(target)) throw new Error(`not a CELEX number: ${celex}`)
  if (preferConsolidated && target.startsWith('3')) {
    try { target = (await describe([target], lang))[0]?.consolidated?.celex || target } catch { /* fall back to the OJ text */ }
  }
  const L3 = (LANG3[lang] || 'ENG').toLowerCase()
  const res = await fetch(`${CELLAR}/${encodeURIComponent(target)}`, {
    headers: { Accept: 'application/xhtml+xml, text/html;q=0.9', 'Accept-Language': L3, 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`Cellar ${target} (${lang}) → HTTP ${res.status}`)
  const full = htmlToText(await res.text())
  const part = article ? sliceArticle(full, article) : null
  if (article && !part) throw new Error(`Article ${article} not found in ${target}`)
  return { celex: target, lang, text: part || full, article: part ? String(article) : null, url: eurlexUrl(target, lang) }
}

module.exports = { search, text, sparql, parseReference, sliceArticle, htmlToText, ALIASES, LANG3 }
