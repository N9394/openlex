"use strict"
/**
 * Dutch statutes from the Basiswettenbestand (BWB), the state's collection
 * of consolidated national legislation behind wetten.overheid.nl, run by
 * KOOP. Open data under CC0 (data.overheid.nl). No key.
 *
 *   search: the BWB SRU service (zoekservice.overheid.nl/sru/Search,
 *           x-connection=BWB), by title words or BWBR identifier, limited to
 *           the version in force today (overheidbwb.geldigheidsdatum);
 *   text:   the XML of that version (toestand) from the official repository
 *           (repository.officiele-overheidspublicaties.nl/bwb/…).
 * The SRU service searches titles, not the text of the law.
 * "6:162 BW" is understood: the book of the Civil Code and the article.
 */

const { getText, SourceError } = require('./http')
const { paced } = require('./pace')

const SRU = () => process.env.OPENLEX_BWB_SRU || 'https://zoekservice.overheid.nl/sru/Search'
const REPO = 'https://repository.officiele-overheidspublicaties.nl/'
/** The repository address of a version (tests point it at a local server). */
const repoUrl = (u) => (process.env.OPENLEX_BWB_REPO ? u.replace(REPO, `${process.env.OPENLEX_BWB_REPO.replace(/\/+$/, '')}/`) : u)
const LABEL = 'Dutch law (BWB)'
const SITE = 'https://wetten.overheid.nl'
const GAP_MS = 250 // no published limit: a calm pace

/** Books of the Civil Code (Burgerlijk Wetboek). */
const BW = { 1: 'BWBR0002656', 2: 'BWBR0003045', 3: 'BWBR0005291', 4: 'BWBR0002761', 5: 'BWBR0005288', 6: 'BWBR0005289', 7: 'BWBR0005290', '7a': 'BWBR0006000', 8: 'BWBR0005034', 10: 'BWBR0030068' }
const ID_RE = /\bBWBR\d{7}\b/i

const today = () => new Date().toISOString().slice(0, 10)
const isoDate = (d) => (/^\d{4}-\d\d-\d\d$/.test(String(d || '')) ? String(d) : today())

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
const tag = (xml, name) => { const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml); return m ? decode(m[1]).trim() : null }
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'g'))].map((m) => decode(m[1]).trim())

/** BWB toestand XML → readable text: headings and paragraphs on their own lines, no metadata. */
function xmlToText(xml) {
  return decode(String(xml)
    .replace(/<meta-data>[\s\S]*?<\/meta-data>/g, '')
    .replace(/<\?linebreak\?>/g, '\n')
    .replace(/<\/lidnr>\s*/g, '. ')
    .replace(/<\/(label)>\s*/g, ' ')
    .replace(/<\/(kop|al|titel|lid|li|tussenkop|intitule|citeertitel|regeling-tekst|p|tr)>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** "6:162 BW", "art. 7:17 BW" → { id, article }; "BWBR0005289" → { id }; else null. */
function parseRef(query) {
  const q = String(query || '')
  const bw = q.match(/\b(?:art(?:ikel|\.)?\s*)?(\d{1,2}a?)\s*:\s*(\d+[a-z]?)\s*(?:BW\b|Burgerlijk Wetboek)/i)
  if (bw && BW[bw[1].toLowerCase()]) return { id: BW[bw[1].toLowerCase()], article: `${bw[1]}:${bw[2]}`, book: bw[1] }
  const id = q.match(ID_RE)
  return id ? { id: id[0].toUpperCase() } : null
}

const cqlLit = (s) => `"${String(s).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`

/** SRU records → [{ id, title, type, from, until, xml, areas }]. */
async function sru(cql, max = 20) {
  const url = `${SRU()}?${new URLSearchParams({ 'x-connection': 'BWB', operation: 'searchRetrieve', version: '1.2', maximumRecords: String(max), query: cql })}`
  const xml = await paced('bwb', GAP_MS, () => getText(url, { label: LABEL, headers: { Accept: 'application/xml' } }))
  if (/<diagnostic\b/.test(xml) && !/<record>/.test(xml)) throw new SourceError(`${LABEL} could not run this search`, 'bad', tag(xml, 'message') || 'diagnostic')
  if (!/<searchRetrieveResponse/.test(xml)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not SRU')
  return [...xml.matchAll(/<record>([\s\S]*?)<\/record>/g)].map((m) => {
    const r = m[1]
    return {
      id: tag(r, 'dcterms:identifier'),
      title: tag(r, 'dcterms:title'),
      type: tag(r, 'dcterms:type'),
      from: tag(r, 'overheidbwb:geldigheidsperiode_startdatum'),
      until: tag(r, 'overheidbwb:geldigheidsperiode_einddatum'),
      xml: tag(r, 'overheidbwb:locatie_toestand'),
      areas: tags(r, 'overheidbwb:rechtsgebied'),
    }
  }).filter((r) => r.id)
}

/** The version valid on a date (today by default). */
async function version(id, date) {
  const [r] = await sru(`dcterms.identifier = ${id} and overheidbwb.geldigheidsdatum = ${cqlLit(isoDate(date))}`, 1)
  return r || null
}

/** One article out of the toestand XML ("162", "7:17" → label "Artikel 162" / "Artikel 17"). */
function articleXml(xml, article) {
  const n = String(article).replace(/^\s*(art(ikel|\.)?)\s*/i, '').replace(/^\d{1,2}a?\s*:\s*/, '').trim()
  if (!n) return null
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`<artikel\\b[^>]*\\blabel="Artikel ${esc}"[^>]*>`).exec(xml)
  if (!m) return null
  const end = xml.indexOf('</artikel>', m.index)
  return { xml: xml.slice(m.index, end < 0 ? undefined : end + 10), path: (/bwb-ng-variabel-deel="([^"]+)"/.exec(m[0]) || [])[1] || null, num: n }
}

const words = (q) => (String(q).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !/^(de|het|een|van|en|op|in|bw|art|artikel)$/.test(w)).slice(0, 8)

const connector = {
  id: 'bwb',
  label: LABEL,
  country: 'NL',
  jurisdictions: ['NL'],
  kind: 'law',
  description: 'Dutch national legislation from the Basiswettenbestand behind wetten.overheid.nl: the version in force today, by title or "6:162 BW"',
  licence: 'CC0 1.0 (open data of the Dutch government, KOOP)',
  licenceUrl: 'https://data.overheid.nl/dataset/basis-wettenbestand',
  homepage: SITE,
  needsKey: false,
  guide: 'bwb',
  hosts: ['zoekservice.overheid.nl', 'repository.officiele-overheidspublicaties.nl'],
  de: { label: 'Niederländisches Recht (BWB)', description: 'Niederländische Gesetze aus dem Basiswettenbestand (wetten.overheid.nl): die heute geltende Fassung, nach Titel oder „6:162 BW“' },
  sample: 'Burgerlijk Wetboek',

  async search(query, { limit = 8, date = null } = {}) {
    const ref = parseRef(query)
    const on = cqlLit(isoDate(date))
    if (ref) {
      const v = await version(ref.id, date)
      return v ? [connector._item(v, ref.article)] : []
    }
    const ws = words(query)
    if (!ws.length) return []
    const rows = await sru(`overheidbwb.titel all ${cqlLit(ws.join(' '))} and overheidbwb.geldigheidsdatum = ${on}`, 50)
    // Most relevant first: the law itself before the acts amending or introducing it.
    const score = (r) => { const t = String(r.title).toLowerCase(); return (/^(wijzigingswet|invoeringswet|aanpassingswet|reparatiewet|verzamelwet)/.test(t) ? 100 : 0) + (r.type === 'wet' ? 0 : 10) + t.length / 100 }
    return rows.sort((a, b) => score(a) - score(b)).slice(0, limit).map((r) => connector._item(r))
  },

  _item(r, article = null) {
    return {
      ref: r.id,
      title: r.title,
      citation: connector.citation(r.id, { title: r.title, article }),
      url: `${SITE}/${r.id}/${r.from || today()}`,
      snippet: [r.type, r.from ? `version in force from ${r.from}` : '', r.areas.slice(0, 3).join(', ')].filter(Boolean).join(' · '),
      date: r.from,
      inForce: !r.until || r.until >= today(),
    }
  },

  /** The text in force today (or on `date`); one article with article: "162", "6:162", "Artikel 7:17". */
  async get(ref, { article = null, date = null } = {}) {
    const parsed = parseRef(ref)
    if (!parsed) throw new SourceError(`${LABEL}: give the identifier from a search result (BWBR…) or an article like 6:162 BW`, 'bad')
    const art = article || parsed.article || null
    const v = await version(parsed.id, date)
    if (!v || !v.xml) throw new SourceError(`${LABEL} has no such document`, 'notfound')
    if (!v.xml.startsWith(REPO)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'unexpected host')
    const xml = await paced('bwb', GAP_MS, () => getText(repoUrl(v.xml), { label: LABEL, headers: { Accept: 'application/xml' }, timeoutMs: 60000 }))
    const base = `${SITE}/${v.id}/${v.from || today()}`
    if (art) {
      const a = articleXml(xml, art)
      if (!a) throw new SourceError(`${LABEL}: Artikel ${String(art).replace(/^\s*(art(ikel|\.)?)\s*/i, '')} was not found in ${v.title}`, 'notfound')
      return { ref: v.id, title: v.title, citation: connector.citation(v.id, { title: v.title, article: art }), url: a.path ? `${base}#${a.path.replace(/^\//, '').replace(/\//g, '_')}` : base, text: xmlToText(a.xml), version: v.from }
    }
    let text = xmlToText(xml.replace(/^[\s\S]*?(<wetgeving\b)/, '$1'))
    if (text.length > 60000) text = text.slice(0, 60000)
    return { ref: v.id, title: v.title, citation: connector.citation(v.id, { title: v.title }), url: base, text, version: v.from }
  },

  /** "art. 6:162 BW (BWB, BWBR0005289)", "Huurprijzenwet woonruimte (BWB, BWBR…)". */
  citation(ref, x = {}) {
    const bwBook = Object.entries(BW).find(([, id]) => id === ref)?.[0]
    let name = x.title || ''
    if (x.article) {
      const n = String(x.article).replace(/^\s*(art(ikel|\.)?)\s*/i, '').trim()
      name = bwBook ? `art. ${/:/.test(n) ? n : `${bwBook}:${n}`} BW` : `art. ${n.replace(/^\d{1,2}a?\s*:\s*/, '')} ${x.title || ''}`.trim()
    }
    return `${name ? `${name} ` : ''}(BWB, ${ref})`
  },
}

module.exports = { ...connector, parseRef, xmlToText }
