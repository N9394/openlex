"use strict"
/**
 * Citation verification (Batch 1.5 — the anti-hallucination promise).
 *
 * Cross-checks a model-cited statute + section against the pack's citation
 * directory (~/.lexvault/directories/<jur>-directory.sqlite, shipped by
 * pack_ingest). Verdicts:
 *   { ok: true, statute }                    — statute identified, section exists
 *   { ok: false, statute, nearest }          — statute identified, section NOT found
 *   null                                     — statute not identifiable → no verdict
 *                                             (never flag what we can't verify)
 *
 * Known abbreviations are expanded (ABGB, UGB, …) because the directory
 * stores full statute names.
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

let Database = null
try { Database = require('better-sqlite3') } catch { Database = null }

const ABBREVS = {
  AT: { abgb: 'allgemeines burgerliches gesetzbuch', ugb: 'unternehmensgesetzbuch', stgb: 'strafgesetzbuch', gmbhg: 'gmbh-gesetz', stpo: 'strafprozessordnung 1975', zpo: 'zivilprozessordnung', kschg: 'konsumentenschutzgesetz', mrg: 'mietrechtsgesetz', kfg: 'kraftfahrgesetz 1967', stvo: 'strassenverkehrsordnung 1960' },
  DE: { bgb: 'burgerliches gesetzbuch', gmbhg: 'gmbh-gesetz', hgb: 'handelsgesetzbuch', stgb: 'strafgesetzbuch' },
}

/** Lowercase + transliteration to match the directory's statute_lc form. */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[äáàâãå]/g, 'a').replace(/[öóòôõ]/g, 'o').replace(/[üúùû]/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

function dirPath(jurisdiction) {
  return path.join(DATA_DIR, 'directories', `${String(jurisdiction).toLowerCase()}-directory.sqlite`)
}

/**
 * @returns {{ok:boolean, statute:string, nearest?:number} | null}
 */
function lookup(jurisdiction, source, section) {
  if (!Database) return null
  const p = dirPath(jurisdiction)
  if (!fs.existsSync(p)) return null
  let db = null
  try {
    db = new Database(p, { readonly: true })
    let nSrc = norm(source)
    if (!nSrc) return null
    // Expand known abbreviations to the directory's full names.
    const abbrMap = ABBREVS[String(jurisdiction).toUpperCase()] || {}
    if (abbrMap[nSrc]) nSrc = norm(abbrMap[nSrc])
    const rows = db.prepare('SELECT DISTINCT statute_lc, statute_name FROM citation WHERE jurisdiction = ?').all(jurisdiction)
    // Both sides normalized to stripped-alnum (the stored statute_lc keeps
    // hyphens/spaces: "gmbh-gesetz" — the model cites "GmbH-Gesetz").
    const cand = rows.filter((r) => norm(r.statute_lc).includes(nSrc) || nSrc.includes(norm(r.statute_lc)))
    if (!cand.length) return null // not identifiable — no verdict
    const num = String(section || '').replace(/\D/g, '')
    if (!num) return null
    const target = parseInt(num, 10)
    if (isNaN(target)) return null
    const exists = db.prepare('SELECT COUNT(*) AS c FROM citation WHERE jurisdiction = ? AND statute_lc = ? AND number = ?')
      .get(jurisdiction, cand[0].statute_lc, num)
    if (exists.c > 0) return { ok: true, statute: cand[0].statute_name }
    const nums = db.prepare('SELECT number FROM citation WHERE jurisdiction = ? AND statute_lc = ?')
      .all(jurisdiction, cand[0].statute_lc)
      .map((r) => parseInt(r.number, 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b)
    let nearest = null
    if (nums.length) nearest = nums.reduce((best, n) => Math.abs(n - target) < Math.abs(best - target) ? n : best)
    return { ok: false, statute: cand[0].statute_name, nearest }
  } catch {
    return null
  } finally {
    if (db) { try { db.close() } catch { /* ignore */ } }
  }
}

module.exports = { lookup, norm, dirPath }
