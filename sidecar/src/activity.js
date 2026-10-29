"use strict"
/**
 * What OpenLex did for each request, in a form a front end can explain to
 * a lawyer: what was asked, what was looked at, where the data went and
 * the result. One JSONL file per matter (~/.lexvault/activity/<matter>.jsonl,
 * the last MAX_RECORDS kept), served by GET /api/activity.
 *
 * Metadata only: the question (the conversation session stores it
 * already), clause headings, law citations, search words, web hosts,
 * file names, the AI services used. Never document text or the answer.
 *
 * toolDetail() is also what the agent puts on its `step` events, so a
 * front end can say "Searching Austrian law: “Gewährleistung Frist”"
 * instead of "tool: search_law".
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const DIR = path.join(DATA_DIR, 'activity')
const MAX_RECORDS = 200
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const hostOf = (u) => { try { return new URL(String(u)).hostname } catch { return '' } }

/**
 * The safe, short arguments of a tool call worth showing (search words,
 * jurisdiction, clause, web host, file name) — never content, never a full
 * URL (its query string may carry client data), never a command line.
 */
function toolDetail(tool, args = {}, section = null) {
  const a = args || {}
  const d = {}
  if (a.query) d.query = clip(a.query, 120)
  if (a.jurisdiction) d.jurisdiction = clip(a.jurisdiction, 8)
  if (a.url) d.host = hostOf(a.url)
  if (a.celex) d.celex = clip(a.celex, 20)
  if (a.article) d.article = clip(a.article, 12)
  if (a.kind && typeof a.kind === 'string') d.kind = clip(a.kind, 20)
  if (a.type && typeof a.type === 'string' && tool === 'find_clause') d.type = clip(a.type, 40)
  if (a.name && tool === 'run_playbook') d.name = clip(a.name, 60)
  if (a.format) d.format = clip(a.format, 8)
  if (a.path && typeof a.path === 'string') d.file = path.basename(a.path).slice(0, 80)
  if (a.to && typeof a.to === 'string' && tool === 'rename_file') d.to = path.basename(a.to).slice(0, 80)
  // File tools: in the working folder (folder.js) or the OpenLex workspace? Never the full path.
  if (/^(read_file|write_file|append_file|list_directory|search_local_files|search_docs|delete_file|rename_file)$/.test(tool)) {
    try {
      const fo = require('./folder')
      if (fo.current()) { const loc = fo.tryLocate(tool.startsWith('search') ? a.directory || '' : a.path || ''); if (loc) d.where = loc.area }
    } catch { /* no folder module in old tests */ }
  }
  // Law sources (connectors/): which ones, never more than their ids.
  if (/^(search_law_sources|get_law_source)$/.test(tool)) {
    const list = Array.isArray(a.sources) ? a.sources : typeof a.sources === 'string' && a.sources ? a.sources.split(/[\s,]+/) : a.source ? [a.source] : []
    if (list.length) d.sources = list.slice(0, 6).map((x) => clip(String(x).toLowerCase(), 20))
  }
  if (a.topic) d.topic = clip(a.topic, 60)
  const sec = section || null
  if (sec && (sec.heading || Number.isInteger(sec.index))) d.clause = { index: sec.index ?? null, heading: sec.heading ? clip(sec.heading, 80) : null }
  else if (a.heading) d.clause = { index: Number.isInteger(+a.index) ? +a.index : null, heading: clip(a.heading, 80) }
  else if (Number.isInteger(+a.index) && a.index !== '' && a.index !== undefined && a.index !== null && /get_range_text|get_clause_analysis/.test(tool)) d.clause = { index: +a.index, heading: null }
  return d
}

const fileFor = (matterId) => path.join(DIR, `${String(matterId || 'none').replace(/[^\w\-.]/g, '_').slice(0, 80)}.jsonl`)

/**
 * Start recording one request. `see(event)` takes every event sent to the
 * front end; `finish(result)` writes the record (best effort).
 */
function start({ matterId = null, kind = 'question', asked = '', client = null, files = [] } = {}) {
  const t0 = Date.now()
  const rec = { at: new Date(t0).toISOString(), kind, asked: clip(asked, 200), ...(client ? { client: clip(client, 20) } : {}), ...(files.length ? { files: files.map((f) => path.basename(String(f)).slice(0, 80)).slice(0, 10) } : {}), looked: [], sources: [], data: [], suggestions: 0 }
  const seenLook = new Set()
  const look = (item) => {
    const key = JSON.stringify(item)
    if (seenLook.has(key) || rec.looked.length >= 30) return
    seenLook.add(key)
    rec.looked.push(item)
  }
  let stopped = false
  let failed = ''
  const see = (e) => {
    if (!e || typeof e !== 'object') return
    if (e.type === 'step' && e.tool) look({ tool: e.tool, ...(e.detail && Object.keys(e.detail).length ? { detail: e.detail } : {}), ...(e.kind && e.kind !== 'tool' ? { status: e.kind } : {}) })
    else if (e.type === 'law') {
      for (const s of e.sources || []) {
        const cite = clip([s.source_name, s.section].filter(Boolean).join(' '), 80)
        if (cite && !rec.sources.includes(cite) && rec.sources.length < 20) rec.sources.push(cite)
      }
    } else if (e.type === 'model') {
      const key = `${e.provider}|${e.region || ''}|${e.redacted ? 1 : 0}`
      const hit = rec.data.find((x) => x.key === key)
      if (hit) hit.calls++
      else rec.data.push({ key, provider: e.provider, label: e.label || e.provider, model: e.model || null, local: !!e.local, region: e.region || null, redacted: !!e.redacted, calls: 1 })
    } else if (e.type === 'suggestion') rec.suggestions++
    else if (e.type === 'progress' && e.name) look({ document: clip(e.name, 80) })
    else if (e.type === 'progress' && e.document) look({ document: clip(e.document, 80) })
    else if (e.type === 'done' && e.stopped) stopped = true
    else if (e.type === 'error') failed = clip(e.message, 200)
  }
  const finish = ({ aborted = false, files: out = [], error = '' } = {}) => {
    try {
      const record = {
        ...rec,
        data: rec.data.map(({ key, ...x }) => x),
        ms: Date.now() - t0,
        result: error || failed ? 'failed' : (aborted || stopped) ? 'stopped' : 'done',
        ...(error || failed ? { error: clip(error || failed, 200) } : {}),
        ...(out.length ? { saved: out.filter(Boolean).map((f) => path.basename(String(f)).slice(0, 80)).slice(0, 10) } : {}),
      }
      fs.mkdirSync(DIR, { recursive: true })
      const file = fileFor(matterId)
      fs.appendFileSync(file, JSON.stringify(record) + '\n')
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      if (lines.length > MAX_RECORDS) fs.writeFileSync(file, lines.slice(-MAX_RECORDS).join('\n') + '\n')
      return record
    } catch (err) {
      console.warn('[activity] write failed:', err.message)
      return null
    }
  }
  return { see, finish }
}

/** The last `limit` records of a matter, newest first. */
function list(matterId, limit = 20) {
  try {
    const lines = fs.readFileSync(fileFor(matterId), 'utf8').split('\n').filter(Boolean)
    const out = []
    for (const l of lines.slice(-Math.max(1, Math.min(+limit || 20, MAX_RECORDS))).reverse()) {
      try { out.push(JSON.parse(l)) } catch { /* skip a broken line */ }
    }
    return out
  } catch {
    return []
  }
}

module.exports = { toolDetail, start, list, MAX_RECORDS, DIR }
