"use strict"
/**
 * Review grid (Phase 7.1) — rows are documents, columns are questions,
 * every cell is an answer with a verbatim quote from its document.
 *
 *   grid = { id, matterId, title, documents: [path], columns: [column], cells: { "<doc>::<col>": cell } }
 *   column = { id, label, prompt, type: text|yesno|choice|date|number, options?, dependsOn?: [colId], reference?: path }
 *   cell = { value, quote, location, status, locked?, edited?, inputs, at }
 *
 * Cell status:
 *   ok         answered, quote found verbatim in the document
 *   unverified the model answered but its quote is not in the document — shown flagged, never as fact
 *   invalid    answer doesn't fit the column type (a choice that isn't an option, a non-date…)
 *   not_found  the document doesn't address the question
 *   edited     typed by the lawyer (also locked, so reruns keep it)
 *   error      the model call failed
 *
 * Dependent columns ("dependsOn") get the document's answers to those
 * columns as context and run after them. A cell remembers the inputs it
 * was computed from; when an upstream answer changes, the cell is stale and
 * the next run recomputes it. Locked cells are never touched by a run.
 *
 * One model call per document part per dependency level (all columns of a
 * level together), under the matter's data policy like every other call.
 * Grids live in <data dir>/grids/<id>.json; exports (.xlsx + .csv) go to
 * the matter's workspace folder.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR } = require('./config')
const wf = require('./workflows')

const GRID_DIR = path.join(DATA_DIR, 'grids')
const TYPES = ['text', 'yesno', 'choice', 'date', 'number']
const REFERENCE_CHARS = 4000
const MAX_COLUMNS = 40

// ── storage ──────────────────────────────────────────────────────────────
const file = (id) => path.join(GRID_DIR, `${String(id).replace(/[^\w-]/g, '')}.json`)

function save(grid) {
  fs.mkdirSync(GRID_DIR, { recursive: true })
  grid.updatedAt = new Date().toISOString()
  const tmp = file(grid.id) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(grid, null, 1))
  fs.renameSync(tmp, file(grid.id))
  return grid
}

function get(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')) } catch { throw new Error(`no grid "${id}"`) }
}

function list(matterId) {
  let names = []
  try { names = fs.readdirSync(GRID_DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return names.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(GRID_DIR, f), 'utf8')) } catch { return null } })
    .filter((g) => g && (matterId === undefined || (g.matterId || null) === (matterId || null)))
    .map((g) => ({ id: g.id, title: g.title, matterId: g.matterId || null, documents: g.documents.length, columns: g.columns.length, updatedAt: g.updatedAt }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function remove(id) {
  try { fs.unlinkSync(file(id)) } catch { throw new Error(`no grid "${id}"`) }
}

// ── columns ──────────────────────────────────────────────────────────────
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

function cleanColumns(columns) {
  if (!Array.isArray(columns)) throw new Error('columns must be an array')
  if (columns.length > MAX_COLUMNS) throw new Error(`at most ${MAX_COLUMNS} columns`)
  const out = []
  const ids = new Set()
  for (const c of columns) {
    if (!c || !String(c.prompt || c.label || '').trim()) throw new Error('every column needs a prompt')
    let id = slug(c.id || c.label || c.prompt) || `col${out.length + 1}`
    while (ids.has(id)) id += '_'
    ids.add(id)
    const type = TYPES.includes(c.type) ? c.type : 'text'
    const col = { id, label: String(c.label || c.prompt).slice(0, 80), prompt: String(c.prompt || c.label).slice(0, 2000), type }
    if (type === 'choice') {
      col.options = (Array.isArray(c.options) ? c.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 50)
      if (col.options.length < 2) throw new Error(`column "${col.label}": a choice column needs at least two options`)
    }
    if (Array.isArray(c.dependsOn) && c.dependsOn.length) col.dependsOn = c.dependsOn.map(String)
    if (c.reference) col.reference = String(c.reference)
    out.push(col)
  }
  for (const col of out) {
    for (const d of col.dependsOn || []) if (!ids.has(d)) throw new Error(`column "${col.label}" depends on unknown column "${d}"`)
  }
  levels(out) // throws on cycles
  return out
}

/** Columns grouped into dependency levels: level 0 has no dependencies. */
function levels(columns) {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const depth = new Map()
  const visit = (c, stack) => {
    if (depth.has(c.id)) return depth.get(c.id)
    if (stack.has(c.id)) throw new Error(`columns depend on each other in a cycle (${[...stack, c.id].join(' → ')})`)
    stack.add(c.id)
    const d = Math.max(-1, ...(c.dependsOn || []).map((x) => visit(byId.get(x), stack))) + 1
    stack.delete(c.id)
    depth.set(c.id, d)
    return d
  }
  columns.forEach((c) => visit(c, new Set()))
  const out = []
  for (const c of columns) (out[depth.get(c.id)] ||= []).push(c)
  return out
}

// ── create / update ──────────────────────────────────────────────────────
// A document attached in a chat stays "att:<id>" (attachments.js); a file is an absolute path.
const docPath = (d) => (String(d).startsWith('att:') ? String(d) : path.resolve(String(d)))
/** The name a row shows: the attachment's file name, else the file's. */
const nameOf = (grid, d) => grid.names?.[d] || path.basename(d)

function create({ matterId = null, title, columns = [], documents, names } = {}) {
  const docs = documents?.length ? documents.map(docPath) : wf.listDocs(wf.matterFolders(matterId))
  const grid = {
    id: crypto.randomBytes(6).toString('hex'),
    matterId: matterId || null,
    title: String(title || 'Review grid').slice(0, 120),
    documents: [...new Set(docs)],
    columns: cleanColumns(columns),
    cells: {},
    ...(names && typeof names === 'object' ? { names: Object.fromEntries(Object.entries(names).map(([k, v]) => [docPath(k), String(v).slice(0, 200)])) } : {}),
    createdAt: new Date().toISOString(),
  }
  return save(grid)
}

/** Patch title, columns (replace the list) or documents (replace the list). Cells of removed rows/columns are dropped. */
function update(id, patch = {}) {
  const grid = get(id)
  if (patch.title !== undefined) grid.title = String(patch.title).slice(0, 120)
  if (patch.columns !== undefined) {
    grid.columns = cleanColumns(patch.columns)
  }
  if (patch.documents !== undefined) grid.documents = [...new Set(patch.documents.map(docPath))]
  const colIds = new Set(grid.columns.map((c) => c.id))
  const docSet = new Set(grid.documents)
  for (const key of Object.keys(grid.cells)) {
    const [doc, col] = splitKey(key)
    if (!docSet.has(doc) || !colIds.has(col)) delete grid.cells[key]
  }
  return save(grid)
}

const key = (doc, col) => `${doc}::${col}`
const splitKey = (k) => { const i = k.lastIndexOf('::'); return [k.slice(0, i), k.slice(i + 2)] }

/** The lawyer's own value for a cell (locks it), or just lock/unlock. */
function setCell(id, { document, column, value, locked } = {}) {
  const grid = get(id)
  const doc = grid.documents.find((d) => d === document || path.basename(d) === document || nameOf(grid, d) === document)
  if (!doc) throw new Error(`document "${document}" is not in this grid`)
  if (!grid.columns.some((c) => c.id === column)) throw new Error(`no column "${column}"`)
  const k = key(doc, column)
  const cell = grid.cells[k] || { value: '', quote: '', location: '', status: 'not_found' }
  if (value !== undefined) Object.assign(cell, { value: String(value), status: 'edited', edited: true, locked: true, at: new Date().toISOString() })
  if (locked !== undefined) cell.locked = !!locked
  grid.cells[k] = cell
  save(grid)
  return cell
}

// ── answers ──────────────────────────────────────────────────────────────
// What a model says when told to answer every column but the document is silent.
const NOT_STATED = /^(not stated|not specified|not addressed|not found|n\/a|none stated)\.?$/i
const YES = /^(yes|y|true|ja|oui|si|sí|da|ano|áno|tak|igen|ναι)\b/i
const NO = /^(no|n|false|nein|non|nu|ne|nie|nem|όχι)\b/i

/** Normalise a model answer to the column type. Returns { value } or { invalid }. */
function typed(col, raw, quote) {
  const v = String(raw ?? '').trim()
  if (!v) return { invalid: 'empty answer' }
  if (NOT_STATED.test(v)) return { notStated: true }
  switch (col.type) {
    case 'yesno':
      if (YES.test(v)) return { value: 'Yes' }
      if (NO.test(v)) return { value: 'No' }
      return { invalid: `"${v.slice(0, 40)}" is not yes/no` }
    case 'choice': {
      const hit = col.options.find((o) => o.toLowerCase() === v.toLowerCase()) ||
        col.options.find((o) => v.toLowerCase().startsWith(o.toLowerCase()))
      return hit ? { value: hit } : { invalid: `"${v.slice(0, 40)}" is not one of the options` }
    }
    case 'date': {
      const dmy = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
      const d = wf.parseDate(v) || wf.parseDate(wf.datesInText(v)[0]) || (dmy && wf.parseDate(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`))
      if (d) return { value: d.display }
      // The quote proves the date: one date stated in it → use that one.
      const stated = wf.datesInText(quote || '')
      if (stated.length === 1) return { value: stated[0] }
      return { invalid: `"${v.slice(0, 40)}" is not a date (YYYY-MM-DD)` }
    }
    case 'number': {
      const m = v.replace(/[\s'’]/g, '').match(/-?\d[\d.,]*/)
      if (!m) return { invalid: `"${v.slice(0, 40)}" is not a number` }
      return { value: v.slice(0, 200) } // keep currency/units as written; the quote proves it
    }
    default:
      return { value: v.slice(0, 2000) }
  }
}

function typeHint(col) {
  switch (col.type) {
    case 'yesno': return 'answer "Yes" or "No"'
    case 'choice': return `answer exactly one of: ${col.options.map((o) => `"${o}"`).join(', ')}`
    case 'date': return 'answer a date as YYYY-MM-DD (or YYYY-MM)'
    case 'number': return 'answer the number with its unit or currency as written'
    default: return 'answer in one or two sentences'
  }
}

function referenceText(col, cache) {
  if (!col.reference) return ''
  if (!cache.has(col.reference)) {
    cache.set(col.reference, wf.readDoc(col.reference).then((t) => String(t).slice(0, REFERENCE_CHARS)).catch(() => ''))
  }
  return cache.get(col.reference)
}

async function cellPrompt(cols, docName, part, idx, total, upstream, refCache, retry = false) {
  const lines = []
  for (const c of cols) {
    lines.push(`- ${c.id}: ${c.prompt} (${typeHint(c)})`)
    const ref = await referenceText(c, refCache)
    if (ref) lines.push(`  Reference standard for ${c.id} (compare the document against it):\n  """${ref.replace(/\n/g, '\n  ')}"""`)
  }
  const known = Object.entries(upstream).filter(([, v]) => v)
  return [
    { role: 'system', content: 'You fill a review table for a law firm. Answer only from the document text. Never guess. Every answer must quote the document verbatim (copy the exact words).' },
    { role: 'user', content: `DOCUMENT: ${docName}${total > 1 ? ` (part ${idx + 1} of ${total})` : ''}\n"""\n${part}\n"""\n${known.length ? `\nALREADY ESTABLISHED FOR THIS DOCUMENT:\n${known.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n` : ''}\nCOLUMNS:\n${lines.join('\n')}\n\n${retry ? 'Answer EVERY column. Questions about the document as a whole (its type, parties, date) are always answerable. Only if the text really does not say, use the value "NOT STATED" and an empty quote.' : 'For each column this text answers, return one object. Skip columns it does not address.'}\nReply with JSON only: [{"column": "<id>", "value": "<answer>", "quote": "<exact words from the document, max 300 chars>", "location": "<clause/section number or [Page N] if visible>"}]` },
  ]
}

// ── run ──────────────────────────────────────────────────────────────────
const inputsKey = (col, grid, doc) => (col.dependsOn || []).map((d) => `${d}=${grid.cells[key(doc, d)]?.value ?? ''}`).join('|') + (col.reference ? `|ref=${col.reference}` : '') + `|p=${col.prompt}|t=${col.type}|o=${(col.options || []).join(',')}`

function needsRun(grid, doc, col, force) {
  const c = grid.cells[key(doc, col.id)]
  if (c?.locked) return false
  if (force || !c) return true
  if (c.status === 'error') return true
  return c.inputs !== inputsKey(col, grid, doc)
}

/**
 * Fill the grid. Options: documents / columns (subsets, by path or name /
 * id), force (recompute unlocked cells), onProgress, signal.
 * Cloud providers run several documents at once; the local model one at a time.
 */
async function run(id, { documents, columns, force = false, onProgress, signal } = {}) {
  const grid = get(id)
  const docs = grid.documents.filter((d) => !documents?.length || documents.some((x) => x === d || path.basename(d) === x || nameOf(grid, d) === x))
  const wanted = new Set(columns?.length ? columns : grid.columns.map((c) => c.id))
  const lv = levels(grid.columns)
  const stats = { documents: docs.length, cells: 0, ok: 0, unverified: 0, invalid: 0, not_found: 0, errors: [] }
  const refCache = new Map()
  const local = ((p) => p.kind === 'local' || p.id === 'local-server')(require('./llm').providerFor('extract'))
  const width = local ? 1 : 4
  let done = 0

  async function doDoc(doc) {
    const name = nameOf(grid, doc)
    let text
    try { text = String(await wf.readDoc(doc)) } catch (err) {
      stats.errors.push(`${name}: ${err.message}`)
      return
    }
    const ps = wf.parts(text)
    for (const level of lv) {
      if (signal?.aborted) return
      // A dependent column is also recomputed when it wasn't asked for but its inputs changed.
      const cols = level.filter((c) => (wanted.has(c.id) || (c.dependsOn || []).some((d) => wanted.has(d))) && needsRun(grid, doc, c, force && wanted.has(c.id)))
      if (!cols.length) continue
      const upstream = {}
      for (const c of cols) for (const d of c.dependsOn || []) upstream[d] = grid.cells[key(doc, d)]?.value || ''
      const found = new Map()
      const ask = async (pending, retry) => {
        for (const [pi, part] of ps.entries()) {
          const open = pending.filter((c) => !found.has(c.id) || found.get(c.id).status !== 'ok')
          if (!open.length || signal?.aborted) break
          let items
          try {
            items = await wf.askJson(await cellPrompt(open, name, part, pi, ps.length, upstream, refCache, retry), 400 + 250 * open.length)
          } catch (err) {
            for (const c of open) if (!found.has(c.id)) found.set(c.id, { value: '', quote: '', location: '', status: 'error', error: String(err.message).slice(0, 200) })
            continue
          }
          for (const it of Array.isArray(items) ? items : []) {
            const col = open.find((c) => c.id === it?.column)
            if (!col) continue
            const quote = String(it.quote || '').slice(0, 600)
            const t = typed(col, it.value, quote)
            if (t.notStated) continue
            let cell
            if (t.invalid) cell = { value: String(it.value ?? '').slice(0, 200), quote, location: String(it.location || ''), status: 'invalid', note: t.invalid }
            else if (!wf.quoteInSource(quote, text)) cell = { value: t.value, quote, location: String(it.location || ''), status: 'unverified' }
            else cell = { value: t.value, quote, location: String(it.location || ''), status: 'ok' }
            const prev = found.get(col.id)
            // Keep the first verified answer; a verified one replaces a weaker one.
            if (!prev || (prev.status !== 'ok' && cell.status === 'ok') || prev.status === 'error') found.set(col.id, cell)
          }
        }
      }
      await ask(cols, false)
      // Small models skip items in a long column list: ask once more for
      // the columns still without a verified answer, on their own.
      const missing = cols.filter((c) => found.get(c.id)?.status !== 'ok')
      if (missing.length && !signal?.aborted) await ask(missing, true)
      for (const c of cols) {
        const cell = found.get(c.id) || { value: '', quote: '', location: '', status: 'not_found' }
        cell.inputs = inputsKey(c, grid, doc)
        cell.at = new Date().toISOString()
        grid.cells[key(doc, c.id)] = cell
        stats.cells++
        if (cell.status === 'error') stats.errors.push(`${name} / ${c.label}: ${cell.error}`)
        else stats[cell.status] = (stats[cell.status] || 0) + 1
        onProgress?.({ step: 'cell', document: name, column: c.id, status: cell.status, value: cell.value })
      }
    }
    done++
    onProgress?.({ step: 'document', index: done, total: docs.length, name })
    save(grid)
  }

  const queue = [...docs]
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length && !signal?.aborted) await doDoc(queue.shift())
  }))
  save(grid)
  return { grid, stats }
}

// ── export ───────────────────────────────────────────────────────────────
const STATUS_LABEL = { ok: '', unverified: 'UNVERIFIED', invalid: 'CHECK', not_found: 'not found', edited: 'edited', error: 'ERROR' }

function rowsFor(grid) {
  const header = ['Document', ...grid.columns.map((c) => c.label)]
  const values = grid.documents.map((d) => [nameOf(grid, d), ...grid.columns.map((c) => {
    const cell = grid.cells[key(d, c.id)]
    if (!cell) return ''
    const flag = STATUS_LABEL[cell.status]
    return cell.status === 'not_found' ? '—' : (flag ? `${cell.value} [${flag}]` : cell.value)
  })])
  const sources = [['Document', 'Column', 'Answer', 'Status', 'Quote', 'Location']]
  for (const d of grid.documents) {
    for (const c of grid.columns) {
      const cell = grid.cells[key(d, c.id)]
      if (cell && cell.status !== 'not_found') sources.push([nameOf(grid, d), c.label, cell.value, cell.status, cell.quote || '', cell.location || ''])
    }
  }
  return { table: [header, ...values], sources }
}

function exportGrid(id) {
  const grid = get(id)
  const ws = require('./workspace')
  const { xlsxBuffer } = require('./xlsx_write')
  const { table, sources } = rowsFor(grid)
  const folder = ws.matterFolder(wf.matterLabel(grid.matterId))
  const stamp = new Date().toISOString().slice(0, 10)
  const base = `${folder}/grid-${slug(grid.title) || grid.id}-${stamp}`
  const xlsx = ws.writeFileBinary(`${base}.xlsx`, xlsxBuffer([{ name: 'Grid', rows: table }, { name: 'Sources', rows: sources }]))
  const csv = ws.writeFile(`${base}.csv`, table.map((r) => r.map(wf.csvCell).join(',')).join('\n'))
  return { files: [xlsx, csv] }
}

/** Grid as the pane/app shows it: rows with cells in column order. */
function view(id) {
  const grid = get(id)
  return {
    id: grid.id, title: grid.title, matterId: grid.matterId, columns: grid.columns, updatedAt: grid.updatedAt,
    rows: grid.documents.map((d) => ({ document: d, name: nameOf(grid, d), cells: grid.columns.map((c) => grid.cells[key(d, c.id)] || null) })),
  }
}

module.exports = { nameOf, key, create, get, list, update, remove, setCell, run, exportGrid, view, typed, levels, cleanColumns, rowsFor, TYPES, GRID_DIR }
