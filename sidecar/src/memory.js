"use strict"
/**
 * Document memory (SQLite via better-sqlite3, JSON-file fallback).
 *
 * Per-document: facts table, defined-term glossary, suggestion ledger.
 * Used to (a) avoid re-suggesting the same edit, (b) answer "what have we
 * changed so far?" without re-reading the doc, (c) persist analysis across
 * sessions. Never holds conversation transcripts.
 */

const fs = require('fs')
const path = require('path')

let sqlite = null
try { sqlite = require('better-sqlite3') } catch { /* fall back to JSON */ }

// <data dir>/memory (~/.lexvault/memory unless LEXVAULT_DATA_DIR says otherwise).
const DATA_DIR = path.join(require('./config').DATA_DIR, 'memory')
fs.mkdirSync(DATA_DIR, { recursive: true })

const safeId = (docId) => String(docId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')

function dbFor(docId) {
  const safe = safeId(docId)
  if (sqlite) {
    const db = sqlite(path.join(DATA_DIR, `${safe}.sqlite`))
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT, claim TEXT, section TEXT, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS glossary (term TEXT PRIMARY KEY, definition TEXT);
      CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, summary TEXT, type TEXT, status TEXT DEFAULT 'open', anchor TEXT, created_at TEXT DEFAULT (datetime('now')));
    `)
    return db
  }
  // JSON fallback (no native module)
  const file = path.join(DATA_DIR, `${safe}.json`)
  const state = { facts: [], glossary: {}, suggestions: [] }
  if (fs.existsSync(file)) Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8')))
  return { file, state }
}

class DocMemory {
  constructor(docId) {
    this.docId = docId
    this.sql = sqlite ? dbFor(docId) : dbFor(docId)
  }

  addFact(entity, claim, section) {
    if (sqlite) {
      this.sql.prepare('INSERT INTO facts (entity, claim, section) VALUES (?,?,?)').run(entity, claim, section)
    } else {
      this.sql.state.facts.push({ entity, claim, section, created_at: new Date().toISOString() })
      this._persistJson()
    }
  }

  recall(topic) {
    const t = String(topic || '').toLowerCase()
    if (sqlite) {
      if (!t) return this.sql.prepare('SELECT entity, claim, section FROM facts').all()
      return this.sql.prepare('SELECT entity, claim, section FROM facts WHERE entity LIKE ? OR claim LIKE ?').all(`%${t}%`, `%${t}%`)
    }
    return this.sql.state.facts.filter((f) => !t || f.entity.toLowerCase().includes(t) || f.claim.toLowerCase().includes(t))
  }

  addTerm(term, definition) {
    if (sqlite) this.sql.prepare('INSERT OR REPLACE INTO glossary (term, definition) VALUES (?,?)').run(term, definition)
    else { this.sql.state.glossary[term] = definition; this._persistJson() }
  }

  glossaryEntries() {
    if (sqlite) return this.sql.prepare('SELECT term, definition FROM glossary').all()
    return Object.entries(this.sql.state.glossary).map(([term, definition]) => ({ term, definition }))
  }

  suggestionExists(summary) {
    if (sqlite) return !!this.sql.prepare('SELECT 1 FROM suggestions WHERE summary = ?').get(summary)
    return this.sql.state.suggestions.some((s) => s.summary === summary)
  }

  registerSuggestion(s) {
    if (sqlite) {
      this.sql.prepare('INSERT OR IGNORE INTO suggestions (id, summary, type, anchor) VALUES (?,?,?,?)')
        .run(s.id, s.summary, s.type, JSON.stringify(s.anchor || null))
    } else {
      this.sql.state.suggestions.push({ id: s.id, summary: s.summary, type: s.type, anchor: s.anchor })
      this._persistJson()
    }
  }

  ledger() {
    if (sqlite) return this.sql.prepare('SELECT id, summary, type, status, anchor FROM suggestions ORDER BY created_at DESC').all()
    return this.sql.state.suggestions
  }

  _persistJson() {
    fs.writeFileSync(this.sql.file, JSON.stringify(this.sql.state, null, 2))
  }

  close() {
    if (sqlite && this.sql.close) this.sql.close()
  }
}

/**
 * The stored facts of one document, read-only, with when they were noted:
 * [{ entity, claim, section, at }]. Never creates a store (the matter
 * overview reads every linked document; most have none).
 */
function factsFor(docId) {
  const safe = safeId(docId)
  const sqlFile = path.join(DATA_DIR, `${safe}.sqlite`)
  const jsonFile = path.join(DATA_DIR, `${safe}.json`)
  try {
    if (sqlite && fs.existsSync(sqlFile)) {
      const db = sqlite(sqlFile, { readonly: true })
      try {
        return db.prepare('SELECT entity, claim, section, created_at FROM facts ORDER BY id').all()
          .map((f) => ({ entity: f.entity, claim: f.claim, section: f.section, at: f.created_at ? `${String(f.created_at).replace(' ', 'T')}Z` : null }))
      } finally { db.close() }
    }
    if (fs.existsSync(jsonFile)) {
      const state = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
      return (state.facts || []).map((f) => ({ entity: f.entity, claim: f.claim, section: f.section, at: f.created_at || null }))
    }
  } catch { /* unreadable store: no facts */ }
  return []
}

module.exports = { DocMemory, factsFor, DATA_DIR }
