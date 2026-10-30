"use strict"
/**
 * Saved items per matter (the old app's "Vault", now on the engine): the
 * answers, notes, clauses, templates, drafts and documents a lawyer keeps
 * with a matter — and the results of the chat's tools (an analysis, an
 * investigation, a due-diligence review, a draft), kept by reference.
 *
 *   ~/.lexvault/saved/<matter>.json   { items: [item] }   (<matter> = matter id, or "_none")
 *   item = { id, matterId, kind, title, content, tags[], source?, favorite, createdAt, updatedAt }
 *     kind    answer | note | clause | template | draft | document | analysis | investigation | diligence | panel
 *     source  where it came from: { kind: 'session'|'attachment'|'analysis'|'investigation'|'diligence'|'draft', id, sessionId?, name? }
 *
 * Everything stays on this computer. What the old Vault did and this keeps:
 * add, edit, delete, copy, tags, search, upload a file (its text becomes
 * the item: attach it, then save the attachment), export Word/PDF/Markdown
 * and the list as CSV. What it fixes: notes and documents can be saved
 * (the old server refused them), folders become tags, and items belong to
 * a matter. The chat's /save adds the last answer here.
 *
 *   list({ matterId, q, kind }) · get(id) · add(item) · update(id, patch) · remove(id)
 *   search(q, { matterId, limit })   for the app's search (find.js)
 *   exportItem(id, format) · exportList({ matterId, q, kind, format })
 *   handle(method, path, params, body)   GET /api/saved, POST /api/saved[/update|/delete|/export]
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const DIR = path.join(DATA_DIR, 'saved')
const KINDS = ['answer', 'note', 'clause', 'template', 'draft', 'document', 'analysis', 'investigation', 'diligence', 'panel']
const ID_RE = /^sv_[a-f0-9]{12}$/
const MAX_CONTENT = 2000000
const MAX_ITEMS = 5000

const keyOf = (matterId) => (matterId ? String(matterId).replace(/[^\w-]/g, '').slice(0, 80) || '_none' : '_none')
const fileOf = (matterId) => path.join(DIR, `${keyOf(matterId)}.json`)

function readAll(matterId) {
  try { const d = JSON.parse(fs.readFileSync(fileOf(matterId), 'utf8')); return Array.isArray(d.items) ? d.items : [] } catch { return [] }
}
function writeAll(matterId, items) {
  fs.mkdirSync(DIR, { recursive: true })
  const f = fileOf(matterId)
  const tmp = `${f}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 1), { mode: 0o600 })
  fs.renameSync(tmp, f)
}
/** Every store (all matters): [matterId|null, items]. */
function stores() {
  let names = []
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return names.map((f) => { const k = f.replace(/\.json$/, ''); return [k === '_none' ? null : k, readAll(k === '_none' ? null : k)] })
}

const str = (v, max) => String(v ?? '').slice(0, max)
const cleanTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(','))
  .map((x) => String(x).trim().replace(/^#/, '').slice(0, 40)).filter(Boolean))].slice(0, 20)
function cleanSource(s) {
  if (!s || typeof s !== 'object') return null
  const out = { kind: str(s.kind, 30), id: str(s.id, 120) }
  if (s.sessionId) out.sessionId = str(s.sessionId, 200)
  if (s.name) out.name = str(s.name, 200)
  return out.kind ? out : null
}

/** Items of a matter (null: those without a matter), newest first, favourites on top; optional text and kind filter. */
function list({ matterId = null, q = '', kind = null } = {}) {
  let items = readAll(matterId)
  if (kind) items = items.filter((x) => x.kind === kind)
  if (q) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean)
    items = items.filter((x) => { const hay = `${x.title}\n${x.tags.join(' ')}\n${x.content}`.toLowerCase(); return words.every((w) => hay.includes(w)) })
  }
  return items.sort((a, b) => (b.favorite - a.favorite) || String(b.createdAt).localeCompare(String(a.createdAt)))
}

function find(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('unknown saved item')
  for (const [matterId, items] of stores()) {
    const it = items.find((x) => x.id === id)
    if (it) return { matterId, items, item: it }
  }
  throw new Error('unknown saved item')
}
function get(id) { return find(id).item }

/**
 * Save something with a matter. { matterId, kind, title, content, tags, source }
 * or { attachment: <id> } (a file the lawyer attached: its text becomes the item).
 */
function add(o = {}) {
  let { matterId = null, kind = 'note', title = '', content = '', tags = [], source = null } = o
  if (o.attachment) {
    const at = require('./attachments')
    const m = at.meta(o.attachment)
    content = at.text(o.attachment)
    title = title || m.name
    kind = o.kind || 'document'
    source = { kind: 'attachment', id: m.id, name: m.name }
  }
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of: ${KINDS.join(', ')}`)
  content = String(content || '')
  // A panel kept by reference: its text (question, summary, transcript) makes it searchable.
  if (!content.trim() && source?.kind === 'panel') {
    try { const r = require('./panel').get(source.id); content = require('./panel').toMarkdown(r); title = title || `Panel: ${r.question.slice(0, 100)}`; matterId = matterId || r.matterId } catch { /* gone: saved by reference only */ }
  }
  if (!content.trim() && !source) throw new Error('nothing to save')
  if (content.length > MAX_CONTENT) throw new Error('too long to save (more than 2 million characters) — save the document in the matter folder instead')
  title = str(title, 200).trim() || firstLine(content) || 'Saved item'
  const now = new Date().toISOString()
  const item = { id: `sv_${crypto.randomBytes(6).toString('hex')}`, matterId: matterId || null, kind, title, content, tags: cleanTags(tags), ...(cleanSource(source) ? { source: cleanSource(source) } : {}), favorite: false, createdAt: now, updatedAt: now }
  const items = readAll(matterId)
  // The same result saved twice stays one item.
  if (item.source && item.source.kind !== 'session' && item.source.kind !== 'attachment') {
    const same = items.find((x) => x.source?.kind === item.source.kind && x.source?.id === item.source.id)
    if (same) return same
  }
  items.push(item)
  if (items.length > MAX_ITEMS) throw new Error(`a matter keeps up to ${MAX_ITEMS} saved items — delete some first`)
  writeAll(matterId, items)
  return item
}

function firstLine(s) { return String(s || '').replace(/^#+\s*/gm, '').split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 120) || '' }

function update(id, patch = {}) {
  const { matterId, items, item } = find(id)
  if (patch.title !== undefined) item.title = str(patch.title, 200).trim() || item.title
  if (patch.content !== undefined) { if (String(patch.content).length > MAX_CONTENT) throw new Error('too long to save'); item.content = String(patch.content) }
  if (patch.tags !== undefined) item.tags = cleanTags(patch.tags)
  if (patch.kind !== undefined) { if (!KINDS.includes(patch.kind)) throw new Error('unknown kind'); item.kind = patch.kind }
  if (patch.favorite !== undefined) item.favorite = !!patch.favorite
  item.updatedAt = new Date().toISOString()
  writeAll(matterId, items)
  return item
}

function remove(id) {
  const { matterId, items } = find(id)
  writeAll(matterId, items.filter((x) => x.id !== id))
  return { removed: id }
}

/** For the app's search: items whose title, tags or text contain the words. */
function search(q, { matterId, limit = 8 } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out = []
  for (const [mid, items] of stores()) {
    if (matterId !== undefined && matterId !== null && mid !== matterId) continue
    for (const x of items) {
      const title = x.title.toLowerCase()
      const hay = `${title}\n${x.tags.join(' ').toLowerCase()}\n${x.content.toLowerCase()}`
      if (!words.every((w) => hay.includes(w))) continue
      const at = x.content.toLowerCase().indexOf(words[0])
      out.push({ id: x.id, matterId: mid, kind: x.kind, title: x.title, snippet: at >= 0 ? x.content.slice(Math.max(0, at - 40), at + 100).replace(/\s+/g, ' ') : '', score: words.every((w) => title.includes(w)) ? 2 : 1, createdAt: x.createdAt })
    }
  }
  return out.sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit)
}

// ── exports ──────────────────────────────────────────────────────────────
const KIND_WORDS = { answer: 'Answer', note: 'Note', clause: 'Clause', template: 'Template', draft: 'Draft', document: 'Document', analysis: 'Analysis', investigation: 'Investigation', diligence: 'Due diligence', panel: 'Panel' }

function reportOf(item) {
  const meta = [KIND_WORDS[item.kind] || item.kind, item.createdAt.slice(0, 10), item.tags.length ? item.tags.map((t) => `#${t}`).join(' ') : ''].filter(Boolean).join(' · ')
  // The content is Markdown: "## Heading" lines become sections.
  const sections = []
  let cur = { title: KIND_WORDS[item.kind] || 'Text', text: [] }
  for (const block of String(item.content).split(/\n{2,}/)) {
    const h = /^#{1,3}\s+(.+)$/.exec(block.trim())
    if (h && !block.trim().includes('\n')) { if (cur.text.length) sections.push(cur); cur = { title: h[1], text: [] }; continue }
    cur.text.push(block)
  }
  if (cur.text.length || !sections.length) sections.push(cur)
  return { title: item.title, subtitle: meta, sections }
}

function exportItem(id, format) {
  const item = get(id)
  // A saved tool result exports as that tool's own report.
  if (item.source && ['analysis', 'investigation', 'diligence', 'draft', 'panel'].includes(item.source.kind) && format !== 'md') {
    try {
      if (item.source.kind === 'analysis') return require('./analysis').exportAnalysis(item.source.id, format)
      if (item.source.kind === 'investigation') return require('./investigate').exportInvestigation(item.source.id, format)
      if (item.source.kind === 'diligence') return require('./diligence').exportDiligence(item.source.id, format)
      if (item.source.kind === 'draft') return require('./draft').exportDraft(item.source.id, format)
      if (item.source.kind === 'panel') return require('./panel').exportPanel(item.source.id, format)
    } catch { /* the result is gone: export the saved text */ }
  }
  return require('./report').save({ report: reportOf(item), format, matterId: item.matterId, base: `saved-${item.title}` })
}

/** The list of saved items as a table (CSV / Excel) or one document with every item (Word / PDF). */
function exportList({ matterId = null, q = '', kind = null, format = 'csv' } = {}) {
  const items = list({ matterId, q, kind })
  const report = {
    title: 'Saved items',
    subtitle: `${items.length} item${items.length === 1 ? '' : 's'} · ${new Date().toISOString().slice(0, 10)}`,
    sections: items.map((x) => ({ title: `${KIND_WORDS[x.kind] || x.kind}: ${x.title}`, text: x.content.slice(0, 20000) })),
    csv: [['Kind', 'Title', 'Tags', 'Saved', 'Text'], ...items.map((x) => [KIND_WORDS[x.kind] || x.kind, x.title, x.tags.join(', '), x.createdAt.slice(0, 16).replace('T', ' '), x.content.replace(/\s+/g, ' ').slice(0, 30000)])],
  }
  return require('./report').save({ report, format, matterId, base: 'saved-items' })
}

/** The local API → { status, json } or null. */
function handle(method, p, params, body = {}) {
  const q = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  if (p !== '/api/saved' && !p.startsWith('/api/saved/')) return null
  try {
    if (method === 'GET' && p === '/api/saved') return { status: 200, json: { items: list({ matterId: q('matterId'), q: q('q') || '', kind: q('kind') }), kinds: KINDS } }
    if (method === 'GET' && p === '/api/saved/item') return { status: 200, json: { item: get(q('id')) } }
    if (method !== 'POST') return { status: 405, json: { error: 'use POST' } }
    if (p === '/api/saved') return { status: 200, json: { item: add(body) } }
    if (p === '/api/saved/update') return { status: 200, json: { item: update(body.id, body.patch || {}) } }
    if (p === '/api/saved/delete') return { status: 200, json: remove(body.id) }
    if (p === '/api/saved/export') return { status: 200, json: body.id ? exportItem(body.id, body.format) : exportList(body) }
    return { status: 404, json: { error: 'not found' } }
  } catch (err) {
    return { status: 400, json: { error: err.message } }
  }
}

module.exports = { list, get, add, update, remove, search, exportItem, exportList, handle, KINDS, DIR }
