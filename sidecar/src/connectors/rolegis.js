"use strict"
/**
 * legislatie.just.ro — Romanian legislation from the Ministry of Justice's
 * official free web service (FreeWebService, SOAP 1.1): GetToken, then
 * Search by number and year, by words of the title or by words of the
 * text. Every hit carries its text. No key, no registration.
 *
 *   POST http://legislatie.just.ro/apiws/FreeWebService.svc/SOAP
 *     SOAPAction "http://tempuri.org/IFreeWebService/GetToken" → token
 *     SOAPAction "http://tempuri.org/IFreeWebService/Search"   → Legi[]
 *
 * The service's own description (WSDL) publishes a plain-http address and
 * its https side does not answer programs, so the search words travel
 * unencrypted to the ministry (never a document). Official texts are not
 * protected by copyright (art. 9 of Law 8/1996). No published rate limit:
 * one request at a time, a second apart.
 */

const { request, strip, SourceError } = require('./http')
const { sliceSection } = require('./text')
const { paced } = require('./pace')

const URL_ = () => process.env.OPENLEX_ROLEGIS_API || 'http://legislatie.just.ro/apiws/FreeWebService.svc/SOAP'
const LABEL = 'legislatie.just.ro (Romania)'
const GAP_MS = 1000
const TOKEN_TTL = 20 * 60 * 1000
const NS_A = 'http://schemas.datacontract.org/2004/07/FreeWebService'

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const xmlText = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')
const envelope = (body) => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`

async function soap(action, body) {
  return paced('rolegis', GAP_MS, async () => {
    const res = await request(URL_(), {
      label: LABEL, method: 'POST', timeoutMs: 60000,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://tempuri.org/IFreeWebService/${action}"`, Accept: 'text/xml' },
      body: envelope(body),
    })
    const xml = await res.text()
    if (/<(?:s:)?Fault>/.test(xml)) throw new SourceError(`${LABEL} could not answer this request`, 'bad', strip(xml).slice(0, 160))
    return xml
  })
}

let token = null // { value, at }
async function getToken(force = false) {
  if (!force && token && Date.now() - token.at < TOKEN_TTL) return token.value
  const xml = await soap('GetToken', '<GetToken xmlns="http://tempuri.org/"/>')
  const m = xml.match(/<GetTokenResult>([^<]+)<\/GetTokenResult>/)
  if (!m) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'no token')
  token = { value: m[1].trim(), at: Date.now() }
  return token.value
}

const field = (x, name) => { const m = x.match(new RegExp(`<a:${name}(?: [^>]*)?>([\\s\\S]*?)</a:${name}>`)); return m ? xmlText(m[1]) : '' }

/** The Legi items of a Search answer. */
function parseLegi(xml) {
  const out = []
  for (const m of String(xml).matchAll(/<a:Legi>([\s\S]*?)<\/a:Legi>/g)) {
    const x = m[1]
    out.push({ date: field(x, 'DataVigoare'), issuer: field(x, 'Emitent'), link: field(x, 'LinkHtml'), number: field(x, 'Numar'), gazette: field(x, 'Publicatie'), text: field(x, 'Text'), type: field(x, 'TipAct'), title: field(x, 'Titlu') })
  }
  return out
}

async function searchRaw({ number = null, year = null, title = null, text = null, size = 5 }) {
  const model = [
    `<a:NumarPagina>0</a:NumarPagina><a:RezultatePagina>${Math.max(1, Math.min(size, 20))}</a:RezultatePagina>`,
    year ? `<a:SearchAn>${xmlEsc(year)}</a:SearchAn>` : '',
    number ? `<a:SearchNumar>${xmlEsc(number)}</a:SearchNumar>` : '',
    text ? `<a:SearchText>${xmlEsc(text)}</a:SearchText>` : '',
    title ? `<a:SearchTitlu>${xmlEsc(title)}</a:SearchTitlu>` : '',
  ].join('')
  const body = (tok) => `<Search xmlns="http://tempuri.org/"><SearchModel xmlns:a="${NS_A}">${model}</SearchModel><tokenKey>${xmlEsc(tok)}</tokenKey></Search>`
  try { return parseLegi(await soap('Search', body(await getToken()))) } catch (err) {
    if (err.code !== 'bad' && err.code !== 'key') throw err
    return parseLegi(await soap('Search', body(await getToken(true)))) // the token ran out: once more with a new one
  }
}

const docId = (link) => (String(link).match(/DetaliiDocument(?:Afis)?\/(\d+)/) || [])[1] || null
const clean = (s) => String(s).replace(/^﻿/, '').replace(/\s+/g, ' ').trim()
/** "LEGE nr. 31 din 22 martie 1991 privind …" → the title without the issuer/gazette tail. */
const titleOf = (t) => clean(t).replace(/\s*EMITENT[\s\S]*$/i, '').trim()
const yearOf = (l) => (titleOf(l.title).match(/\bdin\s+\d{1,2}\s+\p{L}+\s+(\d{4})\b/u) || [])[1] || (String(l.date).match(/^(\d{4})/) || [])[1] || null
const TYPE_WORDS = { LEGE: 'Legea', 'ORDONANȚĂ DE URGENȚĂ': 'OUG', 'ORDONANŢĂ DE URGENŢĂ': 'OUG', 'HOTĂRÂRE': 'HG', ORDONANȚĂ: 'OG', ORDONANŢĂ: 'OG', DECRET: 'Decretul', DECIZIE: 'Decizia' }

/** The text with one article per line block ("Articolul 1" / "Art. 1"). */
function bodyOf(l) {
  return String(l.text || '')
    .replace(/\s*\n?\s*\+\s*\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*(Articolul\s+\d+|Art\.\s*\d+)/g, '\n$1')
    .replace(/\s*(CAPITOLUL\s+[IVXLC]+|TITLUL\s+[IVXLC]+|SECȚIUNEA\s+\w+|SECŢIUNEA\s+\w+)/g, '\n\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^﻿/, '')
    .trim()
}

const seen = new Map() // document id → Legi (the last few hits, so opening one needs no new search)
function remember(l) { const id = docId(l.link); if (id) { seen.set(id, l); while (seen.size > 40) seen.delete(seen.keys().next().value) } }

function item(l) {
  const id = docId(l.link)
  const year = yearOf(l)
  const number = l.number && l.number !== '0' ? l.number : null
  const ref = number && year ? `${id}/${number}/${year}` : String(id)
  const preview = clean(l.text).replace(/^.*?(?=Articolul\s+1\b|Art\.\s*1\b)/, '')
  return {
    ref,
    title: titleOf(l.title),
    citation: connector.citation(ref, { type: l.type, number, year }),
    url: l.link || null,
    snippet: /în curs de procesare/i.test(l.text) ? 'the ministry has not published the text of this act yet' : preview.slice(0, 400),
    date: l.date || null,
    inForce: null,
  }
}

/** { number, year } for "Legea nr. 287/2009", "287/2009", "OUG 195/2002"; null otherwise. */
function parseNumber(q) {
  const m = String(q).match(/\b(\d{1,5})\s*\/\s*(\d{4})\b/)
  return m && +m[2] >= 1800 && +m[2] <= 2100 ? { number: m[1], year: m[2] } : null
}

const connector = {
  id: 'rolegis',
  label: LABEL,
  country: 'RO',
  jurisdictions: ['RO'],
  kind: 'law',
  description: 'Romanian legislation from the Ministry of Justice\'s official free web service (legislatie.just.ro): look-up by number and year, by title words or by words of the text',
  licence: 'Official texts, no copyright (art. 9 of Law 8/1996); free reuse of the Ministry of Justice\'s legislation portal',
  licenceUrl: 'https://legislatie.just.ro',
  homepage: 'https://legislatie.just.ro',
  needsKey: false,
  guide: 'rolegis',
  hosts: ['legislatie.just.ro'],
  sample: '31/1991',
  de: { label: 'legislatie.just.ro (Rumänien)', description: 'Rumänische Rechtsvorschriften aus dem amtlichen kostenlosen Webdienst des Justizministeriums (legislatie.just.ro): Suche nach Nummer und Jahr, nach Titelwörtern oder nach Wörtern im Text' },

  async search(query, { limit = 8 } = {}) {
    const q = String(query).trim()
    const n = parseNumber(q)
    let hits = []
    if (n) hits = await searchRaw({ ...n, size: limit })
    if (!hits.length) {
      const words = q.replace(/\b\d{1,5}\s*\/\s*\d{4}\b|\bnr\.?/gi, ' ').replace(/\s+/g, ' ').trim()
      if (!words) return []
      hits = await searchRaw({ title: words, size: limit })
      if (!hits.length) hits = await searchRaw({ text: words, size: limit })
    }
    hits.forEach(remember)
    return hits.filter((l) => docId(l.link)).slice(0, limit).map(item)
  },

  /** The text of an act (one article with article: "5" or "Articolul 5"). */
  async get(ref, { article = null } = {}) {
    const m = String(ref || '').trim().match(/^(\d{1,9})(?:\/(\d{1,5})\/(\d{4}))?$/)
    if (!m) throw new SourceError(`${LABEL}: give the reference from a search result (for example 1480/31/1991)`, 'bad')
    const [, id, number, year] = m
    let l = seen.get(id)
    if (!l && number) {
      const hits = await searchRaw({ number, year, size: 20 })
      hits.forEach(remember)
      l = hits.find((x) => docId(x.link) === id)
    }
    if (!l) throw new SourceError(number ? `${LABEL} has no such document` : `${LABEL}: search for this act again first (by its number and year)`, number ? 'notfound' : 'bad')
    if (/în curs de procesare/i.test(l.text)) throw new SourceError(`${LABEL} has not published the text of this act yet`, 'notfound')
    const full = bodyOf(l)
    const num = article ? String(article).replace(/^\s*(articolul|art\.?)\s*/i, '').replace(/\.$/, '').trim() : null
    const part = num ? sliceSection(full, num, 'Articolul|Art\\.') : null
    if (num && !part) throw new SourceError(`${LABEL}: Articolul ${num} was not found in this act`, 'notfound')
    const it = item(l)
    return {
      ref: it.ref,
      title: it.title,
      citation: connector.citation(it.ref, { type: l.type, number: l.number !== '0' ? l.number : null, year: yearOf(l), article: num }),
      url: it.url,
      text: part || full,
      note: 'The text as the ministry\'s free service returns it; the consolidated version (forma consolidată) is on the act\'s page on legislatie.just.ro.',
    }
  },

  /** "art. 5 din Legea nr. 31/1991 (legislatie.just.ro 1480)". */
  citation(ref, x = {}) {
    const id = String(ref).split('/')[0]
    const kind = TYPE_WORDS[String(x.type || '').toUpperCase()] || (x.type ? String(x.type).charAt(0) + String(x.type).slice(1).toLowerCase() : '')
    const act = x.number && x.year ? `${kind || 'Actul'} nr. ${x.number}/${x.year}` : kind
    return `${x.article ? `art. ${x.article} din ` : ''}${act ? `${act} ` : ''}(legislatie.just.ro ${id})`
  },
}

module.exports = { ...connector, parseLegi, _reset: () => { token = null; seen.clear() } }
