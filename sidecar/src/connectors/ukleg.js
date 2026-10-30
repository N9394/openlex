"use strict"
/**
 * legislation.gov.uk — UK legislation from The National Archives' official
 * service: Acts and statutory instruments of the UK, Scotland, Wales and
 * Northern Ireland, revised (amendments folded in), with point-in-time
 * versions. Open Government Licence v3.0, no key.
 *
 * Published interface (legislation.gov.uk/developer):
 *   GET /all/data.feed?title=…|text=…&results-count=N   search (Atom)
 *   GET /{type}/{year}/data.feed?number=N               one item by number
 *   GET /{type}/{year}/{number}[/{part}/{n}][/{date}]/data.htm
 *                                                        the text (a section, or
 *                                                        the contents of the whole item)
 * Terms: at most 1,500 requests per 5 minutes per IP, and say who you are
 * (User-Agent). OpenLex sends one request at a time, 200 ms apart.
 */

const { getText, htmlToText, SourceError } = require('./http')
const { paced } = require('./pace')
const x = require('./ukxml')

const BASE = () => (process.env.OPENLEX_UKLEG_API || 'https://www.legislation.gov.uk').replace(/\/+$/, '')
const LABEL = 'legislation.gov.uk'
const GAP_MS = 200 // 1,500 requests per 5 minutes
const SITE = 'https://www.legislation.gov.uk'

const TYPES = new Set(['ukpga', 'ukla', 'ukppa', 'uksi', 'ukmo', 'uksro', 'ukci', 'ukcm', 'ukdsi', 'asp', 'ssi', 'sdsi', 'aosp', 'asc', 'anaw', 'mwa', 'wsi', 'nia', 'nisr', 'nisi', 'apni', 'mnia', 'aep', 'apgb', 'gbla', 'nisro', 'eur', 'eudn', 'eudr', 'eut'])
const SECONDARY = new Set(['uksi', 'ssi', 'wsi', 'nisr', 'ukdsi', 'sdsi', 'nisi', 'uksro', 'nisro'])
// UK primary first, then secondary, then retained EU law.
const rank = (type) => (type.startsWith('eu') ? 2 : SECONDARY.has(type) ? 1 : 0)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const get = (url) => paced('ukleg', GAP_MS, () => getText(url, { label: LABEL }))
const site = (path) => `${SITE}/${path}`

/** "ukpga/2018/12" from "ukpga/2018/12", ".../id/ukpga/2018/12/section/3", "2018 c. 12", "S.I. 2018/1234"; null otherwise. */
function parseRef(q) {
  const s = String(q || '').trim()
  const m = /(?:^|\/)([a-z]{2,5})\/(\d{4})\/(\d{1,5})(?=$|\/|\s)/i.exec(s.replace(/^https?:\/\/[^/]+\/(?:id\/)?/, ''))
  if (m && TYPES.has(m[1].toLowerCase())) return `${m[1].toLowerCase()}/${m[2]}/${m[3]}`
  const act = /\b(\d{4})\s*c\.?\s*(\d{1,4})\b/i.exec(s)
  if (act) return `ukpga/${act[1]}/${act[2]}`
  const si = /\bS\.?\s?I\.?\s*(?:No\.?\s*)?(\d{4})\s*\/\s*(\d{1,5})\b/i.exec(s)
  if (si) return `uksi/${si[1]}/${si[2]}`
  const ssi = /\bS\.?\s?S\.?\s?I\.?\s*(\d{4})\s*\/\s*(\d{1,5})\b/i.exec(s)
  if (ssi) return `ssi/${ssi[1]}/${ssi[2]}`
  return null
}

/** The section in the address: "94" → section/94; "reg. 3" → regulation/3; "Sch. 1" → schedule/1. */
function partOf(article, type) {
  const a = String(article || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!a) return null
  const m = /^(?:(s|sec|section|ss|reg|regulation|r|art|article|sch|schedule|para|paragraph|rule)\.?\s*)?([0-9]+[a-z]{0,3}|[ivxlc]+)$/i.exec(a)
  if (!m) throw new SourceError(`${LABEL}: give the section as a number, for example "94", "reg. 3" or "Sch. 1"`, 'bad')
  const word = m[1] || ''
  const kind = /^(reg|regulation|r)$/.test(word) ? 'regulation' : /^(art|article)$/.test(word) ? 'article' : /^(sch|schedule)$/.test(word) ? 'schedule' : /^(para|paragraph)$/.test(word) ? 'paragraph' : /^rule$/.test(word) ? 'rule' : word ? 'section' : type.startsWith('eu') ? 'article' : SECONDARY.has(type) ? 'regulation' : 'section'
  return { kind, num: m[2].toUpperCase().replace(/^([0-9]+)([A-Z]*)$/, (_, n, l) => n + l) }
}
const SHORT = { section: 's.', regulation: 'reg.', article: 'art.', schedule: 'Sch.', paragraph: 'para.', rule: 'r.' }

function item(e) {
  const id = String(x.tag(e, 'id') || '').replace(/^https?:\/\/[^/]+\/id\//, '')
  const type = id.split('/')[0]
  const updated = x.tag(e, 'updated')
  const created = x.attr(e, 'ukm:CreationDate', 'Date')
  const title = x.tag(e, 'title') || id
  const summary = x.tag(e, 'summary')
  return {
    ref: id,
    title,
    citation: connector.citation(id, { title }),
    url: site(id),
    snippet: [created ? `made ${created}` : '', updated ? `revised text as at ${updated.slice(0, 10)}` : '', summary && !/^urn:/.test(summary) && summary !== title ? summary : ''].filter(Boolean).join(' · ').slice(0, 400),
    date: created || null,
    inForce: null,
    type,
  }
}

async function feed(url) {
  const xml = await get(url)
  if (!/<feed\b/.test(xml)) throw new SourceError(`${LABEL} sent an answer OpenLex cannot read`, 'bad', 'not an Atom feed')
  return x.entries(xml).map(item).filter((it) => it.ref && TYPES.has(it.ref.split('/')[0]))
}

/** The text block of a legislation page, without annotations and extent marks. */
function pageText(html) {
  let body = x.block(html, 'div', 'LegSnippet') || ''
  body = x.dropBlocks(body, 'div', 'LegAnnotations')
  body = x.dropBlocks(body, 'span', 'LegExtentRestriction|LegChangeDelimiter')
  body = x.dropBlocks(body, 'p', 'LegNotification')
  body = body.replace(/<a\b[^>]*class="[^"]*LegCommentaryLink[^"]*"[^>]*>[\s\S]*?<\/a>/g, '')
  return htmlToText(body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const meta = (html, name) => { const m = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html); return m ? x.decode(m[1]) : null }
const statusWarning = (html) => {
  const w = x.block(html, 'div', 'uptoDate|outstanding|statusWarning') || (/<div[^>]*id="statusWarning"[\s\S]*?<\/div>/.exec(html) || [])[0]
  if (!w) return null
  const t = htmlToText(w.replace(/<a\b[\s\S]*?<\/a>/g, '')).replace(/\s+/g, ' ').replace(/^Changes to legislation:\s*/, '').trim()
  return t ? t.replace(/\s*(Changes that have been made appear|Changes to Legislation\b).*$/, '').slice(0, 300) : null
}

const connector = {
  id: 'ukleg',
  label: 'legislation.gov.uk',
  country: 'UK',
  jurisdictions: ['UK', 'GB'],
  kind: 'law',
  description: 'UK legislation from The National Archives: Acts and statutory instruments of the UK, Scotland, Wales and Northern Ireland, revised with amendments, and how a section read on a past date',
  licence: 'Open Government Licence v3.0 (Crown and Parliamentary copyright)',
  licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  homepage: 'https://www.legislation.gov.uk',
  needsKey: false,
  guide: 'ukleg',
  hosts: ['www.legislation.gov.uk'],
  sample: 'Employment Rights Act',
  de: {
    label: 'legislation.gov.uk (Vereinigtes Königreich)',
    description: 'Britisches Recht von The National Archives: Gesetze und Verordnungen des Vereinigten Königreichs, Schottlands, Wales\' und Nordirlands, konsolidiert, auch in früheren Fassungen',
  },

  async search(query, { limit = 8 } = {}) {
    const ref = parseRef(query)
    if (ref) {
      const [type, year, number] = ref.split('/')
      const hit = (await feed(`${BASE()}/${type}/${year}/data.feed?${new URLSearchParams({ number })}`)).filter((it) => it.ref === ref)
      if (hit.length) return hit.slice(0, 1).map(({ type, ...it }) => it)
    }
    const q = String(query).replace(/\b\d{4}\s*c\.?\s*\d+\b/gi, ' ').replace(/\s+/g, ' ').trim()
    if (!q) return []
    const n = Math.min(Math.max(limit, 1), 20)
    const byTitle = await feed(`${BASE()}/all/data.feed?${new URLSearchParams({ title: q, 'results-count': String(Math.min(n * 3, 50)) })}`)
    const out = byTitle.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.type) - rank(b.it.type) || a.i - b.i).map((r) => r.it).slice(0, n)
    if (out.length < n) {
      const byText = await feed(`${BASE()}/all/data.feed?${new URLSearchParams({ text: q, 'results-count': String(n) })}`)
      for (const it of byText) if (out.length < n && !out.some((o) => o.ref === it.ref)) out.push(it)
    }
    return out.map(({ type, ...it }) => it)
  },

  /**
   * One section ("94", "s. 94", "reg. 3", "Sch. 1") as it stands today, or as
   * it read on `date` (YYYY-MM-DD); without a section, the contents.
   */
  async get(ref, { article = null, date = null } = {}) {
    const id = parseRef(ref)
    if (!id) throw new SourceError(`${LABEL}: give the item from a search result, for example ukpga/1996/18`, 'bad')
    const type = id.split('/')[0]
    if (date && !DATE_RE.test(String(date))) throw new SourceError(`${LABEL}: give the date as YYYY-MM-DD`, 'bad')
    // A section in the reference itself ("ukpga/1996/18/section/94") counts as the article.
    const inRef = /\/(section|regulation|article|schedule|paragraph|rule)\/([0-9]+[A-Za-z]*)/.exec(String(ref))
    const part = article ? partOf(article, type) : inRef ? { kind: inRef[1], num: inRef[2] } : null
    const tries = part ? [part, ...(SECONDARY.has(type) && part.kind === 'regulation' && !/reg/i.test(String(article || '')) ? [{ ...part, kind: 'article' }] : [])] : [null]
    let html = null
    let path = null
    for (const p of tries) {
      path = `${id}${p ? `/${p.kind}/${p.num}` : '/contents'}${date ? `/${date}` : ''}`
      try { html = await get(`${BASE()}/${path}/data.htm`); break } catch (err) {
        if (err.code !== 'notfound' || p === tries.at(-1)) {
          if (err.code === 'notfound') throw new SourceError(p ? `${LABEL}: ${SHORT[p.kind]} ${p.num} was not found in ${id}` : `${LABEL} has no such document`, 'notfound', err.message)
          throw err
        }
      }
    }
    const used = tries.find((p) => path.includes(p ? `/${p.kind}/${p.num}` : '/contents'))
    const title = meta(html, 'DC.title') || (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || id
    let text = pageText(html)
    if (!text) throw new SourceError(`${LABEL} has no readable text for this document`, 'notfound')
    if (!used && text.length > 30000) text = `${text.slice(0, 30000)}\n…`
    const warning = date ? null : statusWarning(html)
    const notes = [date ? `As it read on ${date} (point in time).` : null, !used ? 'This is the table of contents: ask for one section.' : null, warning].filter(Boolean)
    return {
      ref: id,
      title: used ? `${title}, ${SHORT[used.kind]} ${used.num}` : title,
      citation: connector.citation(id, { title: x.decode(title), part: used }),
      url: site(path),
      text,
      date: date || meta(html, 'DC.Date.Modified') || null,
      ...(notes.length ? { note: notes.join(' ') } : {}),
    }
  },

  /** "Employment Rights Act 1996, s. 94 (legislation.gov.uk, ukpga/1996/18)". */
  citation(ref, { title = null, part = null } = {}) {
    const name = [title, part ? `${SHORT[part.kind] || part.kind} ${part.num}` : null].filter(Boolean).join(', ')
    return `${name ? `${name} ` : ''}(legislation.gov.uk, ${ref})`
  },
}

module.exports = { ...connector, parseRef, partOf, pageText }
