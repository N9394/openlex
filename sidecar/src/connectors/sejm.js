"use strict"
/**
 * Sejm ELI — Polish statutes from the Sejm's official ELI API
 * (api.sejm.gov.pl/eli): the Journal of Laws (Dziennik Ustaw, DU) and the
 * Monitor Polski (MP), with in-force status, the unofficial consolidated
 * text the Sejm Chancellery prepares (tekst ujednolicony, PDF) and the text
 * as published (HTML or PDF). No key. Statutes and official documents are
 * not protected by copyright (art. 4 of the Polish Copyright Act).
 *
 *   GET /acts/search?title=…&limit=N        search by words of the title
 *   GET /acts/{DU|MP}/{year}/{pos}          one act (metadata, list of texts)
 *   GET /acts/{…}/text.html                 the text as published (HTML)
 *   GET /acts/{…}/text/{U|O|T}/{file}.pdf   consolidated / original PDF
 *
 * The API publishes no rate limit; OpenLex sends one request at a time,
 * a third of a second apart.
 */

const { getJson, request, htmlToText, strip, SourceError } = require('./http')
const { sliceSection } = require('./text')
const { paced } = require('./pace')

const BASE = () => (process.env.OPENLEX_SEJM_API || 'https://api.sejm.gov.pl/eli').replace(/\/+$/, '')
const LABEL = 'Sejm ELI (Poland)'
const GAP_MS = 350
const ISAP = 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id='
const MAX_TEXT = 400000

const call = (url, opts = {}) => paced('sejm', GAP_MS, () => getJson(url, { label: LABEL, ...opts }))
const fetchRaw = (url, opts = {}) => paced('sejm', GAP_MS, () => request(url, { label: LABEL, timeoutMs: 60000, ...opts }))

/** "DU/1964/93" for "Dz.U. 1964 nr 16 poz. 93", "Dz. U. z 2024 r. poz. 1061", "M.P. 2023 poz. 5", "DU/2024/1061"; null otherwise. */
function parseRef(query) {
  const q = String(query || '').trim()
  let m = q.match(/^(DU|MP)\/(\d{4})\/(\d{1,5})$/i)
  if (m) return `${m[1].toUpperCase()}/${m[2]}/${+m[3]}`
  m = q.match(/\b(Dz\.?\s*U\.?|M\.?\s*P\.?)\s*(?:z\s*)?(\d{4})\s*(?:r\.?)?\s*(?:,?\s*(?:nr|Nr)\.?\s*\d+)?\s*,?\s*poz\.?\s*(\d{1,5})\b/)
  if (m) return `${/^M/i.test(m[1]) ? 'MP' : 'DU'}/${m[2]}/${+m[3]}`
  return null
}

const AMENDING = /\bo zmianie\b|\bzmieniając|\bzmieniające\b/i
const STATUS_WORDS = { IN_FORCE: 'in force', NOT_IN_FORCE: 'not in force', UNKNOWN: '' }
const urlOf = (a) => (a.address ? `${ISAP}${a.address}` : `${BASE()}/acts/${a.ELI}`)

function item(a, extra = {}) {
  const ref = a.ELI || `${a.publisher}/${a.year}/${a.pos}`
  return {
    ref,
    title: strip(a.title),
    citation: connector.citation(ref, { display: a.displayAddress }),
    url: urlOf(a),
    snippet: [STATUS_WORDS[a.inForce] || '', a.status ? `status: ${a.status}` : '', a.type || ''].filter(Boolean).join(' · '),
    date: a.promulgation || a.announcementDate || null,
    inForce: a.inForce === 'IN_FORCE' ? true : a.inForce === 'NOT_IN_FORCE' ? false : null,
    ...extra,
  }
}

/**
 * The search finds acts by the words of their title, newest first. What a
 * lawyer usually wants is the act itself in its consolidated form, so an
 * announcement of a consolidated text (obwieszczenie … tekstu jednolitego)
 * points to the act it consolidates, and acts that only amend come last.
 */
function rank(items, limit) {
  const out = []
  const seen = new Set()
  const push = (r, score) => { if (!seen.has(r.ref)) { seen.add(r.ref); out.push({ r, score, i: out.length }) } }
  for (const a of items) {
    const base = a.references?.['Tekst jednolity dla aktu']?.[0]?.id
    if (base && a.type === 'Obwieszczenie') {
      const name = String(a.title).replace(/^.*?jednolitego tekstu\s+/i, '').replace(/^ustawy\s*-\s*/i, '').replace(/^ustawy\b/i, 'ustawa').replace(/^rozporządzenia\b/i, 'rozporządzenie').trim()
      push({
        ref: base,
        title: name ? name.charAt(0).toUpperCase() + name.slice(1) : base,
        citation: connector.citation(base),
        url: `${BASE()}/acts/${base}`,
        snippet: `consolidated text announced in ${a.displayAddress} (${a.promulgation || a.announcementDate})`,
        date: a.promulgation || null,
        inForce: a.inForce === 'IN_FORCE' ? true : null,
      }, 10)
      continue
    }
    push(item(a), (a.inForce === 'IN_FORCE' ? 3 : 0) + (AMENDING.test(a.title) ? -5 : 2) + (a.type === 'Obwieszczenie' ? -3 : 0))
  }
  return out.sort((x, y) => y.score - x.score || x.i - y.i).slice(0, limit).map((x) => x.r)
}

/** A consolidated or published PDF as plain text, without the page furniture. */
async function pdfToText(url) {
  const res = await fetchRaw(url, { headers: { Accept: '*/*' } })
  const buf = Buffer.from(await res.arrayBuffer())
  let text
  try { text = await require('../pdf_text').pdfText(buf, { ocr: false }) } catch (err) {
    throw new SourceError(`${LABEL} sent a text OpenLex cannot read`, 'bad', String(err.message).slice(0, 120))
  }
  return text
    .replace(/^\[Page \d+[^\]]*\]\n(?:©Kancelaria Sejmu s\. \d+\/\d+\n)?(?:\d{4}-\d{2}-\d{2}\n)?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const cache = new Map() // url → text (the last few)
async function textOf(url, kind) {
  if (cache.has(url)) return cache.get(url)
  const text = kind === 'html' ? htmlToText(await (await fetchRaw(url, { headers: { Accept: '*/*' } })).text()) : await pdfToText(url)
  cache.set(url, text)
  while (cache.size > 6) cache.delete(cache.keys().next().value)
  return text
}

/** Which text to read: the consolidated one when there is one, else the text as published. */
function pickText(ref, meta) {
  const texts = meta.texts || []
  const u = texts.find((t) => t.type === 'U' && /\.pdf$/i.test(t.fileName))
  if (u) return { url: `${BASE()}/acts/${ref}/text/U/${u.fileName}`, kind: 'pdf', note: 'Unofficial consolidated text (tekst ujednolicony) prepared by the Chancellery of the Sejm; the binding text is the one published in the journal.' }
  if (meta.textHTML || texts.some((t) => t.type === 'H')) return { url: `${BASE()}/acts/${ref}/text.html`, kind: 'html', note: 'Text as published in the journal (later amendments are not included).' }
  const o = texts.find((t) => t.type === 'T' && /\.pdf$/i.test(t.fileName)) || texts.find((t) => t.type === 'O' && /\.pdf$/i.test(t.fileName))
  if (o) return { url: `${BASE()}/acts/${ref}/text/${o.type}/${o.fileName}`, kind: 'pdf', note: 'Text as published in the journal (later amendments are not included).' }
  return null
}

const artNum = (a) => String(a).replace(/^\s*(art\.?|artykuł)\s*/i, '').replace(/\^(\d+)/, '[$1]').replace(/\.$/, '').trim()

const connector = {
  id: 'sejm',
  label: LABEL,
  country: 'PL',
  jurisdictions: ['PL'],
  kind: 'law',
  description: 'Polish statutes and regulations from the Sejm\'s official ELI service (Journal of Laws and Monitor Polski), with in-force status and the consolidated text',
  licence: 'Statutes and official documents, no copyright (art. 4 of the Polish Copyright Act); published by the Chancellery of the Sejm',
  licenceUrl: 'https://api.sejm.gov.pl/eli.html',
  homepage: 'https://isap.sejm.gov.pl',
  needsKey: false,
  guide: 'sejm',
  hosts: ['api.sejm.gov.pl'],
  sample: 'kodeks cywilny',
  de: { label: 'Sejm ELI (Polen)', description: 'Polnische Gesetze und Verordnungen aus dem amtlichen ELI-Dienst des Sejm (Gesetzblatt und Monitor Polski), mit Geltungsstatus und konsolidiertem Text' },

  async search(query, { limit = 8 } = {}) {
    const ref = parseRef(query)
    if (ref) {
      try { return [item(await call(`${BASE()}/acts/${ref}`))] } catch (err) { if (err.code !== 'notfound') throw err; return [] }
    }
    const title = String(query).replace(/["„”]/g, ' ').replace(/\s+/g, ' ').trim()
    const json = await call(`${BASE()}/acts/search?${new URLSearchParams({ title, limit: '50' })}`)
    if (!Array.isArray(json?.items)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no items')
    return rank(json.items, limit)
  },

  /** The text of an act (one article with article: "535" or "Art. 535"). */
  async get(ref, { article = null } = {}) {
    const id = parseRef(ref)
    if (!id) throw new SourceError(`${LABEL}: give the act from a search result (DU/1964/93) or its journal reference (Dz.U. 1964 nr 16 poz. 93)`, 'bad')
    const meta = await call(`${BASE()}/acts/${id}`)
    const pick = pickText(id, meta)
    if (!pick) throw new SourceError(`${LABEL} has no readable text for this act`, 'notfound')
    let text = await textOf(pick.url, pick.kind)
    const num = article ? artNum(article) : null
    const part = num ? sliceSection(text, num, 'Art\\.') : null
    if (num && !part) throw new SourceError(`${LABEL}: Art. ${num} was not found in ${meta.displayAddress || id}`, 'notfound')
    text = part || text
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT)
    return {
      ref: id,
      title: strip(meta.title),
      citation: connector.citation(id, { display: meta.displayAddress, article: num }),
      url: pick.url,
      text,
      note: pick.note,
      inForce: meta.inForce === 'IN_FORCE' ? true : meta.inForce === 'NOT_IN_FORCE' ? false : null,
    }
  },

  /** "art. 535 Dz.U. 1964 nr 16 poz. 93 (Sejm ELI)". */
  citation(ref, x = {}) {
    const m = String(ref).match(/^(DU|MP)\/(\d{4})\/(\d+)$/)
    const display = x.display || (m ? `${m[1] === 'DU' ? 'Dz.U.' : 'M.P.'} ${m[2]} poz. ${m[3]}` : ref)
    return `${x.article ? `art. ${x.article} ` : ''}${display} (Sejm ELI)`
  },
}

module.exports = { ...connector, parseRef, _clearCache: () => cache.clear() }
