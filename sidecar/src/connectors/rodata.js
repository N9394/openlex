"use strict"
/**
 * Romanian legislation, community data (opt-in, offline only): the daily
 * GitHub release of scriptogre/romanian-law-data, a Parquet export of the
 * acts on legislatie.just.ro (about 250,000 documents with their text).
 * Kept by a volunteer, not by the ministry; the repository has NO licence
 * file and says the data was collected from the portal's public pages. The
 * texts themselves are official and free of copyright (art. 9 of Law
 * 8/1996), but the collection is not "open data": OpenLex labels it
 * "community data, no licence file", keeps it off until the lawyer
 * switches it on, and only uses it from a copy on the lawyer's computer
 * (downloaded from GitHub after showing the size; searched locally with a
 * full-text index). The official route for Romania is the ministry's free
 * web service (rolegis.js).
 */

const fs = require('fs')
const path = require('path')
const { getJson, SourceError } = require('./http')
const { sliceSection } = require('./text')
const { paced } = require('./pace')
const localdata = require('./localdata')
const fts = require('./fts')

const API = () => (process.env.OPENLEX_RODATA_API || 'https://api.github.com/repos/scriptogre/romanian-law-data').replace(/\/+$/, '')
const LABEL = 'Romanian law (community data, no licence file)'
const PART = 'documents'
const FILE = 'documents.parquet'
const STALE_DAYS = 60
const MAX_BODY = 60000
const COLUMNS = ['id', 'type', 'document_citation', 'title', 'content', 'published_at', 'effective_at', 'link', 'status']

const dir = () => localdata.dirOf('rodata', PART)
const readyFile = () => path.join(dir(), 'ready.json')
const readyInfo = () => { try { return JSON.parse(fs.readFileSync(readyFile(), 'utf8')) } catch { return null } }
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null)

/** The Parquet reader (hyparquet); tests may swap it. */
const parquetReader = {
  async open(file) {
    const { asyncBufferFromFile, parquetMetadataAsync } = await import('hyparquet')
    const buf = await asyncBufferFromFile(file)
    const metadata = await parquetMetadataAsync(buf)
    return { buf, metadata, rows: Number(metadata.num_rows), groups: metadata.row_groups.map((g) => Number(g.num_rows)) }
  },
  async read(h, rowStart, rowEnd, columns = COLUMNS) {
    const { parquetReadObjects } = await import('hyparquet')
    const { compressors } = await import('hyparquet-compressors')
    return parquetReadObjects({ file: h.buf, metadata: h.metadata, rowStart, rowEnd, columns, compressors })
  },
}
let reader = parquetReader

/** The newest daily release that has the documents file. */
async function latestRelease() {
  const list = await paced('rodata', 1000, () => getJson(`${API()}/releases?per_page=10`, { label: 'GitHub' }))
  for (const r of Array.isArray(list) ? list : []) {
    const a = (r.assets || []).find((x) => x.name === FILE)
    if (a) return { tag: r.tag_name, published: iso(r.published_at), url: a.browser_download_url, bytes: a.size }
  }
  throw new SourceError('The Romanian community data has no release to download right now', 'notfound')
}

function stale(info) {
  return !!info?.published && Date.now() - Date.parse(info.published) > STALE_DAYS * 86400000
}

const docText = (row) => String(row.content || '')
function toDoc(row, n) {
  return {
    id: String(row.id),
    title: String(row.title || row.document_citation || row.id).replace(/\s+/g, ' ').trim().slice(0, 400),
    body: docText(row).slice(0, MAX_BODY),
    meta: { row: n, citation: row.document_citation || null, type: row.type || null, link: row.link || null, published: iso(row.published_at), effective: iso(row.effective_at), status: row.status || null },
  }
}

/** Build the local full-text index from the downloaded Parquet file, one row group at a time. */
async function buildIndex(file, { progress = () => {}, signal } = {}) {
  const h = await reader.open(file)
  const ix = fts.open(path.join(dir(), 'index'))
  try {
    ix.replace([])
    const append = (b) => ix.append(b)
    const rowOf = {}
    let start = 0
    for (let g = 0; g < h.groups.length; g++) {
      if (signal?.aborted) throw new Error('aborted')
      const end = start + h.groups[g]
      const rows = await reader.read(h, start, end)
      rows.forEach((r, i) => { rowOf[String(r.id)] = start + i })
      append(rows.map((r, i) => toDoc(r, start + i)))
      start = end
      progress({ done: start, total: h.rows, message: `Building the search index (${start.toLocaleString('en')} of ${h.rows.toLocaleString('en')} acts)` })
    }
    fs.writeFileSync(path.join(dir(), 'rows.json'), JSON.stringify(rowOf))
    return h.rows
  } finally { ix.close() }
}

const local = {
  parts: () => [{ part: PART, label: 'Romanian legislation (community data, no licence file)' }],

  async plan() {
    const r = await latestRelease()
    return {
      part: PART,
      label: `Romanian legislation, community data of ${r.published} (no licence file)`,
      bytes: r.bytes,
      estimate: false,
      from: r.url,
      licence: 'No licence file: a volunteer\'s collection of the official texts (art. 9 of Law 8/1996)',
      note: `Downloads ${localdata.sizeWords(r.bytes)} from GitHub; the search index on this computer takes about as much again.`,
    }
  },

  async run(part, { dir: into, progress, signal }) {
    const r = await latestRelease()
    const file = path.join(into, FILE)
    progress({ total: r.bytes, done: 0, bytes: 0, message: `Downloading ${localdata.sizeWords(r.bytes)} from GitHub…` })
    await localdata.downloadFile(r.url, file, { label: 'GitHub', signal, onBytes: (_, n) => progress({ done: n, bytes: n }) })
    try { fs.rmSync(readyFile(), { force: true }) } catch { /* none */ }
    const rows = await buildIndex(file, { progress, signal })
    fs.writeFileSync(readyFile(), JSON.stringify({ tag: r.tag, published: r.published, rows, at: new Date().toISOString() }))
  },

  async items() {
    const info = readyInfo()
    if (!info) return []
    return [{ part: PART, label: 'Romanian legislation (community data, no licence file)', bytes: localdata.folderBytes(dir()), updated: info.published, stale: stale(info), licence: 'No licence file (community data)' }]
  },
}

const connector = {
  id: 'rodata',
  label: LABEL,
  country: 'RO',
  jurisdictions: ['RO'],
  kind: 'law',
  community: true,
  optIn: true,
  description: 'Romanian acts with their text from a volunteer\'s daily export of legislatie.just.ro (scriptogre/romanian-law-data on GitHub), searched on this computer; no licence file, so off until you switch it on',
  licence: 'No licence file (community data); the texts are official and free of copyright (art. 9 of Law 8/1996)',
  licenceUrl: 'https://github.com/scriptogre/romanian-law-data',
  homepage: 'https://github.com/scriptogre/romanian-law-data',
  needsKey: false,
  guide: 'rodata',
  hosts: ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
  sample: 'codul muncii',
  setupWords: { en: 'community data, no licence file: download it first (opt-in)', de: 'Community-Daten ohne Lizenzdatei: zuerst herunterladen (nur auf Wunsch)' },
  de: { label: 'Rumänisches Recht (Community-Daten, ohne Lizenzdatei)', description: 'Rumänische Rechtsakte mit Text aus dem täglichen Export eines Freiwilligen von legislatie.just.ro (scriptogre/romanian-law-data auf GitHub), auf diesem Computer durchsucht; ohne Lizenzdatei, daher aus, bis Sie sie einschalten' },
  local,
  ready: () => !!readyInfo(),
  offlineOnly: () => true,
  statusNote: (lang) => {
    const info = readyInfo()
    if (!info) return ''
    const words = lang === 'de' ? `, Ihre Kopie vom ${info.published}${stale(info) ? ' (älter als 60 Tage)' : ''}` : `, your copy of ${info.published}${stale(info) ? ' (over 60 days old: may be out of date)' : ''}`
    return words
  },

  async search(query, { limit = 8 } = {}) {
    const info = readyInfo()
    if (!info) throw new SourceError(`${LABEL}: download it first in /law`, 'setup')
    const ix = fts.open(path.join(dir(), 'index'))
    try {
      const hits = ix.search(query, { limit })
      const items = hits.map((h) => ({
        ref: h.id,
        title: h.title,
        citation: connector.citation(h.id, { citation: h.meta.citation }),
        url: h.meta.link || null,
        snippet: h.snippet,
        date: h.meta.effective || h.meta.published || null,
        inForce: null,
      }))
      return { items, note: `From your local copy of the community data of ${info.published} (no licence file)${stale(info) ? '; it is over 60 days old' : ''}.` }
    } finally { ix.close() }
  },

  async get(ref, { article = null } = {}) {
    const info = readyInfo()
    if (!info) throw new SourceError(`${LABEL}: download it first in /law`, 'setup')
    const id = String(ref || '').trim()
    if (!/^\d{1,9}$/.test(id)) throw new SourceError(`${LABEL}: give the number from a search result`, 'bad')
    let n = null
    try { n = JSON.parse(fs.readFileSync(path.join(dir(), 'rows.json'), 'utf8'))[id] } catch { /* no map */ }
    let row = null
    if (Number.isInteger(n)) {
      const h = await reader.open(path.join(dir(), FILE))
      row = (await reader.read(h, n, n + 1))[0]
      if (row && String(row.id) !== id) row = null
    }
    if (!row) throw new SourceError(`${LABEL} has no such document in your copy`, 'notfound')
    const full = docText(row).replace(/\r\n?/g, '\n')
    const num = article ? String(article).replace(/^\s*(articolul|art\.?)\s*/i, '').replace(/\.$/, '').trim() : null
    const part = num ? sliceSection(full, num, 'Articolul|Art\\.') : null
    if (num && !part) throw new SourceError(`${LABEL}: Articolul ${num} was not found in this act`, 'notfound')
    return {
      ref: id,
      title: String(row.title || row.document_citation || id).replace(/\s+/g, ' ').trim(),
      citation: connector.citation(id, { citation: row.document_citation, article: num }),
      url: row.link || null,
      text: part || full,
      note: `From your local copy of the community data of ${info.published} (no licence file). Check the act on legislatie.just.ro.`,
    }
  },

  /** "art. 5 din Legea 53/2003 (community data, legislatie.just.ro 41627)". */
  citation(ref, x = {}) {
    return `${x.article ? `art. ${x.article} din ` : ''}${x.citation ? `${x.citation} ` : ''}(community data, legislatie.just.ro ${ref})`
  },
}

module.exports = { ...connector, _setReader: (r) => { reader = r || parquetReader } }
