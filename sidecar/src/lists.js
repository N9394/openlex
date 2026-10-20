"use strict"
/**
 * Lists (Phase 7.5) — checklists and trackers for a matter: closing
 * checklists, regulatory trackers, consent lists, deadline lists.
 *
 *   list = { id, matterId, title, items: [item], audit: [entry] }
 *   item = { id, text, owner, due (YYYY-MM-DD|null), status: open|done|blocked|n/a, note, source? }
 *
 * Every change is written to the list's audit trail (who, when, what,
 * from → to). "who" is the OS user unless the caller names someone.
 * Lists can be seeded from a chronology (future deadlines → due items) or
 * from review findings (high-risk findings → action items); each seeded
 * item keeps its source document and verbatim quote.
 *
 * Storage: <data dir>/lists/<id>.json. Export: .xlsx, .csv and .ics (due
 * dates as all-day events) into the matter's workspace folder.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')

const LIST_DIR = path.join(DATA_DIR, 'lists')
const STATUSES = ['open', 'done', 'blocked', 'n/a']
const MAX_ITEMS = 2000

const file = (id) => path.join(LIST_DIR, `${String(id).replace(/[^\w-]/g, '')}.json`)
const newId = () => crypto.randomBytes(5).toString('hex')
const whoami = () => { try { return os.userInfo().username } catch { return 'user' } }

function save(list) {
  fs.mkdirSync(LIST_DIR, { recursive: true })
  list.updatedAt = new Date().toISOString()
  fs.writeFileSync(file(list.id) + '.tmp', JSON.stringify(list, null, 1))
  fs.renameSync(file(list.id) + '.tmp', file(list.id))
  return list
}
function get(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')) } catch { throw new Error(`no list "${id}"`) }
}
function all(matterId) {
  let names = []
  try { names = fs.readdirSync(LIST_DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return names.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(LIST_DIR, f), 'utf8')) } catch { return null } })
    .filter((l) => l && (matterId === undefined || (l.matterId || null) === (matterId || null)))
    .map((l) => ({ id: l.id, title: l.title, matterId: l.matterId, items: l.items.length, open: l.items.filter((i) => i.status === 'open' || i.status === 'blocked').length, overdue: overdue(l).length, updatedAt: l.updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

const today = () => new Date().toISOString().slice(0, 10)
const overdue = (l) => l.items.filter((i) => i.due && i.due < today() && (i.status === 'open' || i.status === 'blocked'))

function cleanDue(d) {
  if (d === null || d === undefined || d === '') return null
  const p = require('./workflows').parseDate(String(d).slice(0, 10))
  if (!p || p.display.length !== 10) throw new Error(`due date must be YYYY-MM-DD (got "${d}")`)
  return p.display
}

function cleanItem(input, prev = {}) {
  const text = String(input.text ?? prev.text ?? '').trim()
  if (!text) throw new Error('an item needs text')
  const status = input.status ?? prev.status ?? 'open'
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
  return {
    text: text.slice(0, 1000),
    owner: String(input.owner ?? prev.owner ?? '').slice(0, 80),
    due: input.due !== undefined ? cleanDue(input.due) : (prev.due ?? null),
    status,
    note: String(input.note ?? prev.note ?? '').slice(0, 2000),
    ...(input.source || prev.source ? { source: input.source || prev.source } : {}),
  }
}

function log(list, entry, by) {
  list.audit.push({ at: new Date().toISOString(), by: by || whoami(), ...entry })
  if (list.audit.length > 5000) list.audit = list.audit.slice(-5000)
}

function create({ matterId = null, title, items = [], by } = {}) {
  const list = { id: newId(), matterId: matterId || null, title: String(title || 'Checklist').slice(0, 120), items: [], audit: [], createdAt: new Date().toISOString() }
  log(list, { action: 'create', title: list.title }, by)
  for (const it of items.slice(0, MAX_ITEMS)) { const item = { id: newId(), ...cleanItem(it) }; list.items.push(item); log(list, { action: 'add', item: item.id, text: item.text }, by) }
  return save(list)
}

function addItem(id, input, by) {
  const list = get(id)
  if (list.items.length >= MAX_ITEMS) throw new Error(`a list holds at most ${MAX_ITEMS} items`)
  const item = { id: newId(), ...cleanItem(input) }
  list.items.push(item)
  log(list, { action: 'add', item: item.id, text: item.text }, by)
  save(list)
  return item
}

/** Change an item; every changed field is audited as from → to. */
function updateItem(id, itemId, patch = {}, by) {
  const list = get(id)
  const item = list.items.find((i) => i.id === itemId)
  if (!item) throw new Error(`no item "${itemId}"`)
  const next = cleanItem(patch, item)
  for (const k of ['text', 'owner', 'due', 'status', 'note']) {
    if ((item[k] ?? null) !== (next[k] ?? null)) log(list, { action: 'change', item: itemId, field: k, from: item[k] ?? null, to: next[k] ?? null }, by)
  }
  Object.assign(item, next)
  save(list)
  return item
}

function removeItem(id, itemId, by) {
  const list = get(id)
  const item = list.items.find((i) => i.id === itemId)
  if (!item) throw new Error(`no item "${itemId}"`)
  list.items = list.items.filter((i) => i.id !== itemId)
  log(list, { action: 'remove', item: itemId, text: item.text }, by)
  save(list)
}

function rename(id, title, by) {
  const list = get(id)
  log(list, { action: 'rename', from: list.title, to: String(title).slice(0, 120) }, by)
  list.title = String(title).slice(0, 120)
  return save(list)
}

function remove(id) {
  try { fs.unlinkSync(file(id)) } catch { throw new Error(`no list "${id}"`) }
}

// ── seeding from workflows ───────────────────────────────────────────────
/**
 * Items from a workflow result, with provenance:
 *   events   (chronology) → future-dated events become items due on that date
 *   findings (review)     → high-risk findings (or all with all=true) become action items
 */
function seed(id, { events = [], findings = [], all = false } = {}, by) {
  const list = get(id)
  const known = new Set(list.items.map((i) => `${i.source?.document}|${i.source?.quote}`))
  let added = 0
  for (const e of events) {
    const due = String(e.display || e.date || '').slice(0, 10)
    if (due.length !== 10 || due < today()) continue
    const src = { document: e.document, quote: e.quote }
    if (known.has(`${src.document}|${src.quote}`)) continue
    const item = { id: newId(), ...cleanItem({ text: e.event, due, source: src }) }
    list.items.push(item); known.add(`${src.document}|${src.quote}`); added++
    log(list, { action: 'add', item: item.id, text: item.text, from: 'chronology' }, by)
  }
  for (const f of findings) {
    if (!all && f.risk !== 'high') continue
    const src = { document: f.document, quote: f.quote, location: f.location || '' }
    if (known.has(`${src.document}|${src.quote}`)) continue
    const item = { id: newId(), ...cleanItem({ text: `${f.document}: ${f.answer}`, note: f.question || '', source: src }) }
    list.items.push(item); known.add(`${src.document}|${src.quote}`); added++
    log(list, { action: 'add', item: item.id, text: item.text, from: 'review' }, by)
  }
  save(list)
  return { added, list }
}

/** RFC 4180 CSV (quoted fields, "" escapes, newlines inside quotes) → rows. */
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text || '').replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x !== ''))
}

/**
 * Seed from a workflow output file in the matter folder: a chronology CSV
 * (date,event,document,quote) or a review CSV (document,check,risk,answer,quote,location).
 */
function seedFromFile(id, csvPath, opts = {}, by) {
  const ws = require('./workspace')
  const abs = path.isAbsolute(csvPath) ? csvPath : ws.resolve(csvPath)
  const base = ws.resolve('')
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('the file must be inside the OpenLex workspace')
  const [header, ...rows] = parseCsv(fs.readFileSync(abs, 'utf8'))
  const h = (header || []).map((x) => x.trim().toLowerCase())
  const col = (r, name) => r[h.indexOf(name)] ?? ''
  if (h.includes('event') && h.includes('date')) {
    return seed(id, { events: rows.map((r) => ({ date: col(r, 'date'), event: col(r, 'event'), document: col(r, 'document'), quote: col(r, 'quote') })) }, by)
  }
  if (h.includes('check') && h.includes('risk')) {
    return seed(id, { findings: rows.map((r) => ({ document: col(r, 'document'), question: col(r, 'check'), risk: col(r, 'risk'), answer: col(r, 'answer'), quote: col(r, 'quote'), location: col(r, 'location') })), all: !!opts.all }, by)
  }
  throw new Error('not a chronology or review CSV from OpenLex')
}

/** Workflow CSVs in a matter's folder that can seed a list (newest first). */
function sources(matterId) {
  const ws = require('./workspace')
  const folder = ws.matterFolder(require('./workflows').matterLabel(matterId))
  return ws.listFiles(folder).filter((f) => /(^|\/)(chronology|review)-[^/]*\.csv$/.test(f.path))
    .map((f) => ({ file: path.join(folder, path.basename(f.path)), name: path.basename(f.path), kind: path.basename(f.path).startsWith('review') ? 'review' : 'chronology' }))
    .sort((a, b) => ((b.name.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]).localeCompare((a.name.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]) || a.name.localeCompare(b.name))
}

// ── export ───────────────────────────────────────────────────────────────
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n').slice(0, 200)

function toICS(list) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenLex//Lists//EN', 'CALSCALE:GREGORIAN']
  for (const i of list.items) {
    if (!i.due || i.status === 'done' || i.status === 'n/a') continue
    const start = i.due.replace(/-/g, '')
    const end = new Date(Date.parse(i.due + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '') // all-day: DTEND is exclusive
    L.push('BEGIN:VEVENT', `UID:${list.id}-${i.id}@openlex`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsText(i.text)}`, ...(i.owner || i.note ? [`DESCRIPTION:${icsText([i.owner && `Owner: ${i.owner}`, i.note].filter(Boolean).join(' — '))}`] : []), 'END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.join('\r\n') + '\r\n'
}

function exportList(id) {
  const list = get(id)
  const ws = require('./workspace')
  const wf = require('./workflows')
  const { xlsxBuffer } = require('./xlsx_write')
  const rows = [['Item', 'Owner', 'Due', 'Status', 'Note', 'Source document', 'Quote'], ...list.items.map((i) => [i.text, i.owner, i.due || '', i.status, i.note, i.source?.document || '', i.source?.quote || ''])]
  const audit = [['When', 'Who', 'Action', 'Item', 'Field', 'From', 'To'], ...list.audit.map((a) => [a.at, a.by, a.action, a.text || a.item || '', a.field || '', a.from ?? '', a.to ?? ''])]
  const slug = list.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || list.id
  const base = `${ws.matterFolder(wf.matterLabel(list.matterId))}/list-${slug}-${today()}`
  return {
    files: [
      ws.writeFileBinary(`${base}.xlsx`, xlsxBuffer([{ name: 'Items', rows }, { name: 'Audit trail', rows: audit }])),
      ws.writeFile(`${base}.csv`, rows.map((r) => r.map(wf.csvCell).join(',')).join('\n')),
      ws.writeFile(`${base}.ics`, toICS(list)),
    ],
  }
}

module.exports = { create, get, all, addItem, updateItem, removeItem, rename, remove, seed, seedFromFile, sources, parseCsv, exportList, toICS, overdue, STATUSES }
