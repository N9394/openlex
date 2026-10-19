/**
 * Citation directory validator (Layer 3).
 *
 * Each statute pack ships a `directory.sqlite` file that lists every valid
 * (jurisdiction, statute_name, marker, number) triple known to exist in
 * that pack's chunks. After pack ingest the App writes the file to
 *   <userData>/packs/directories/<code>-directory.sqlite
 *
 * This module opens those files lazily (one per jurisdiction, on first
 * lookup) and answers two questions:
 *   isValidCitation(jurisdiction, statute, marker, number) → boolean
 *   parseAndValidate(jurisdiction, text)                  → [{ citation, valid, suggestion }]
 *
 * Uses sql.js (pure-JS SQLite via WASM) so the bundled server doesn't need
 * a native sqlite module that would need rebuilding for Electron's Node ABI.
 *
 * Each opened db sits in memory (~10-200 MB per jurisdiction depending on
 * pack size). For typical solo lawyers using 1-3 jurisdictions, total
 * footprint stays under 300 MB. Idle eviction TBD; for now we hold
 * everything until process exit.
 */

const fs = require('fs')
const path = require('path')

// Same regex as data-packager/build_directory.py. Two shapes accepted:
//   "<statute> - § <num>[ - <title>]"        (most jurisdictions)
//   "<statute> § <num>[ - <title>]"          (US CFR: no dash)
//   "<statute> - Section <num>[ - <title>]"  (UK/CY/ZA)
//   "<statute> - Art. <num>[ - <title>]"     (RO)
const CITATION_RE = /^(.+?)\s*(?:-\s*)?(§|Section|Art\.|Article)\s*([^\s-][^-]*?)(?:\s*-\s*(.+))?$/

function normalize(s) {
  // Diacritic-strip + lowercase for fuzzy statute-name lookup
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function parseCitation(text) {
  if (!text) return null
  const m = CITATION_RE.exec(text.trim())
  if (!m) return null
  return { statute: m[1].trim(), marker: m[2], number: m[3].trim(), title: (m[4] || '').trim() || null }
}

let _SQL = null
async function sqlJs() {
  if (_SQL) return _SQL
  const initSqlJs = require('sql.js')
  _SQL = await initSqlJs({})
  return _SQL
}

const _dbs = new Map()  // jurisdiction code → SQL.Database

async function loadDirectory(jurisdiction, directoryPath) {
  const key = jurisdiction.toUpperCase()
  if (_dbs.has(key)) return _dbs.get(key)
  const filePath = directoryPath || _defaultPath(key)
  if (!filePath || !fs.existsSync(filePath)) return null
  const SQL = await sqlJs()
  const buf = fs.readFileSync(filePath)
  const db = new SQL.Database(new Uint8Array(buf))
  _dbs.set(key, db)
  return db
}

function _defaultPath(code) {
  // Best-effort lookup. Caller can override with explicit path; this is the
  // path the App writes during pack_ingest.
  const dirsDir = process.env.LEXVAULT_DIRECTORIES_DIR
    || path.join(process.env.HOME || process.cwd(), '.config', 'LexVault', 'packs', 'directories')
  return path.join(dirsDir, `${code.toLowerCase()}-directory.sqlite`)
}

async function isValidCitation(jurisdiction, statute, marker, number, options = {}) {
  const db = await loadDirectory(jurisdiction, options.directoryPath)
  if (!db) return { available: false, valid: null }
  const stmt = db.prepare('SELECT 1 FROM citation WHERE jurisdiction = ? AND statute_name = ? AND marker = ? AND number = ? LIMIT 1')
  stmt.bind([jurisdiction.toUpperCase(), statute, marker, number])
  const exact = stmt.step()
  stmt.free()
  if (exact) return { available: true, valid: true, match: 'exact' }
  // Fuzzy: same number on a statute whose normalized name matches
  const lc = normalize(statute)
  const fuzzy = db.exec('SELECT statute_name, title FROM citation WHERE jurisdiction = $j AND statute_lc = $lc AND marker = $m AND number = $n LIMIT 1', {
    $j: jurisdiction.toUpperCase(), $lc: lc, $m: marker, $n: number,
  })
  if (fuzzy.length && fuzzy[0].values.length) {
    return { available: true, valid: true, match: 'fuzzy', canonical: fuzzy[0].values[0][0], title: fuzzy[0].values[0][1] }
  }
  // Not found — try to suggest the closest statute name
  const suggestion = await suggestStatute(jurisdiction, statute, options)
  return { available: true, valid: false, suggestion }
}

async function suggestStatute(jurisdiction, statute, options = {}) {
  const db = await loadDirectory(jurisdiction, options.directoryPath)
  if (!db) return null
  // Match by prefix on normalized name; return up to 3
  const lc = normalize(statute)
  const r = db.exec('SELECT statute_name, section_count FROM statute WHERE jurisdiction = $j AND statute_lc LIKE $p ORDER BY section_count DESC LIMIT 3', {
    $j: jurisdiction.toUpperCase(),
    $p: lc.slice(0, Math.min(lc.length, 10)) + '%',
  })
  if (!r.length) return null
  return r[0].values.map(([name, count]) => ({ name, sections: count }))
}

async function parseAndValidate(jurisdiction, text, options = {}) {
  // Walk the text for citation-shaped tokens. Conservative: only matches
  // when a clear "<word(s)> - § N" pattern appears; doesn't try to repair
  // sentences. Tighter precision is more useful than recall here — the
  // model can be told "we couldn't verify this fragment" and re-cite.
  const out = []
  const matches = text.matchAll(/([\p{L}\p{N}\s.,()&'"-]{6,80}?)\s+(§|Section|Art\.|Article)\s*([^\s,;.]+)/gu)
  for (const m of matches) {
    const statute = m[1].replace(/^[\s,;.-]+/, '').replace(/[\s,;.-]+$/, '')
    const marker = m[2]
    const number = m[3].replace(/[.,;:]+$/, '')
    if (!statute || statute.length < 3) continue
    const result = await isValidCitation(jurisdiction, statute, marker, number, options)
    out.push({ raw: m[0], statute, marker, number, ...result })
  }
  return out
}

function status() {
  // Diagnostic snapshot for the Dependencies tab
  const loaded = Array.from(_dbs.keys())
  return { loaded, count: loaded.length }
}

module.exports = { parseCitation, isValidCitation, parseAndValidate, loadDirectory, status, normalize }
