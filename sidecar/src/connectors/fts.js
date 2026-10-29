"use strict"
/**
 * A small full-text index on the lawyer's computer for a local copy of a
 * law source (a legalize-dev clone, the German federal laws download).
 * SQLite FTS5 when this Node has SQLite (better-sqlite3, else node:sqlite),
 * otherwise a plain scan of a JSON-lines file: slower, same answers.
 *
 *   const ix = fts.open('/…/law-data/legalize/at/index')
 *   ix.replace([{ id, title, body, meta }])      (or append / upsert / remove)
 *   ix.search('Gewährleistung Frist', { limit: 8 }) → [{ id, title, snippet, meta }]
 */

const fs = require('fs')
const path = require('path')

let backendCache
function driver() {
  if (backendCache !== undefined) return backendCache
  backendCache = null
  if (process.env.OPENLEX_FTS === 'scan') return backendCache
  try {
    const Database = require('better-sqlite3')
    const probe = new Database(':memory:')
    probe.exec('CREATE VIRTUAL TABLE t USING fts5(a)')
    probe.close()
    backendCache = { name: 'sqlite', open: (f) => new Database(f) }
    return backendCache
  } catch { /* not installed */ }
  try {
    const emit = process.emitWarning
    process.emitWarning = () => {} // node:sqlite is still marked experimental on some versions
    let DatabaseSync
    try { ({ DatabaseSync } = require('node:sqlite')) } finally { process.emitWarning = emit }
    const probe = new DatabaseSync(':memory:')
    probe.exec('CREATE VIRTUAL TABLE t USING fts5(a)')
    probe.close()
    backendCache = { name: 'node:sqlite', open: (f) => new DatabaseSync(f) }
  } catch { /* old Node: scan */ }
  return backendCache
}

/** Words of a query, lower case, letters and digits only. */
const words = (q) => [...new Set((String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 || /\d/.test(w)))].slice(0, 12)
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A short passage around the first match (for the scan index). */
function around(text, terms, n = 220) {
  const low = fold(text)
  let at = -1
  for (const t of terms) { const i = low.indexOf(fold(t)); if (i >= 0 && (at < 0 || i < at)) at = i }
  if (at < 0) return String(text).slice(0, n).replace(/\s+/g, ' ').trim()
  const from = Math.max(0, at - Math.floor(n / 3))
  return `${from ? '…' : ''}${String(text).slice(from, from + n).replace(/\s+/g, ' ').trim()}…`
}

class SqliteIndex {
  constructor(file, d) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = d.open(`${file}.sqlite`)
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(id UNINDEXED, title, body, meta UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')`)
  }
  tx(fn) { this.db.exec('BEGIN'); try { fn(); this.db.exec('COMMIT') } catch (e) { this.db.exec('ROLLBACK'); throw e } }
  replace(docs) { this.tx(() => { this.db.exec('DELETE FROM docs'); this._insert(docs) }) }
  upsert(docs) { this.tx(() => { const del = this.db.prepare('DELETE FROM docs WHERE id = ?'); for (const d of docs) del.run(String(d.id)); this._insert(docs) }) }
  remove(ids) { this.tx(() => { const del = this.db.prepare('DELETE FROM docs WHERE id = ?'); for (const id of ids) del.run(String(id)) }) }
  /** Add documents without looking for older ones (a fresh index built in batches). */
  append(docs) { this.tx(() => this._insert(docs)) }
  _insert(docs) { const ins = this.db.prepare('INSERT INTO docs (id, title, body, meta) VALUES (?, ?, ?, ?)'); for (const d of docs) ins.run(String(d.id), String(d.title || ''), String(d.body || ''), JSON.stringify(d.meta || {})) }
  count() { return Number(this.db.prepare('SELECT count(*) AS n FROM docs').get().n) }
  search(q, { limit = 8 } = {}) {
    const ws = words(q)
    if (!ws.length) return []
    const run = (expr) => this.db.prepare(`SELECT id, title, meta, snippet(docs, 2, '', '', '…', 24) AS snip FROM docs WHERE docs MATCH ? ORDER BY bm25(docs, 0, 8.0, 1.0) LIMIT ?`).all(expr, limit)
    let rows = run(ws.map((w) => `"${w}"`).join(' '))
    if (!rows.length && ws.length > 1) rows = run(ws.map((w) => `"${w}"`).join(' OR '))
    return rows.map((r) => ({ id: r.id, title: r.title, snippet: String(r.snip || '').replace(/\s+/g, ' ').trim(), meta: JSON.parse(r.meta || '{}') }))
  }
  close() { try { this.db.close() } catch { /* closed */ } }
}

/** No SQLite: one JSON line per document, searched by reading them all. */
class ScanIndex {
  constructor(file) { this.file = `${file}.jsonl`; fs.mkdirSync(path.dirname(this.file), { recursive: true }) }
  _all() { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
  _write(list) { fs.writeFileSync(this.file, list.map((d) => JSON.stringify({ id: String(d.id), title: d.title || '', body: d.body || '', meta: d.meta || {} })).join('\n') + (list.length ? '\n' : '')) }
  replace(docs) { this._write(docs) }
  upsert(docs) { const ids = new Set(docs.map((d) => String(d.id))); this._write([...this._all().filter((d) => !ids.has(d.id)), ...docs]) }
  remove(ids) { const drop = new Set(ids.map(String)); this._write(this._all().filter((d) => !drop.has(d.id))) }
  append(docs) { fs.appendFileSync(this.file, docs.map((d) => `${JSON.stringify({ id: String(d.id), title: d.title || '', body: d.body || '', meta: d.meta || {} })}\n`).join('')) }
  count() { return this._all().length }
  search(q, { limit = 8 } = {}) {
    const ws = words(q).map(fold)
    if (!ws.length) return []
    const scored = []
    for (const d of this._all()) {
      const t = fold(d.title)
      const b = fold(d.body)
      const hits = ws.filter((w) => t.includes(w) || b.includes(w)).length
      if (!hits) continue
      const all = hits === ws.length
      scored.push({ d, score: (all ? 1000 : 0) + hits * 10 + ws.filter((w) => t.includes(w)).length * 50 })
    }
    const full = scored.some((s) => s.score >= 1000)
    return scored.filter((s) => !full || s.score >= 1000).sort((a, b) => b.score - a.score).slice(0, limit)
      .map(({ d }) => ({ id: d.id, title: d.title, snippet: around(d.body, words(q)), meta: d.meta }))
  }
  close() {}
}

const open = (file) => { const d = driver(); return d ? new SqliteIndex(file, d) : new ScanIndex(file) }
const backend = () => driver()?.name || 'scan'

module.exports = { open, backend, words, _reset: () => { backendCache = undefined } }
