/**
 * Cross-lingual legal-concept dictionary.
 *
 * Tiny runtime that translates the user's natural-language legal concept
 * (in any of the supported UI languages) into the target jurisdiction's
 * **formal statutory term**, before retrieval builds query2.
 *
 * Bloat control:
 *   - Stores ONE primary phrase + ~2 synonyms per (concept × jurisdiction).
 *     New user phrasings are matched via embedding cosine, NOT by sprawling
 *     synonym lists. So the table grows linearly with concept count, not
 *     phrasing variation.
 *   - Statute-grounded: every entry points at a real statute reference.
 *   - Corpus-extraction-ready: starter file is hand-curated; the production
 *     dictionary will be built from Qdrant statute headings.
 *
 * API:
 *   detectConcept(text, sourceLang?) → { conceptId, confidence } | null
 *     Cheap keyword + synonym pre-match. No LLM call.
 *
 *   lookup(conceptId, jurisdiction) → { primary, synonyms, statute_ref } | null
 *     Returns the formal statutory term + reference for that jurisdiction.
 *
 *   buildQuery2(text, sourceLang, jurisdiction) → string | null
 *     One-shot helper that combines detect + lookup. Used by retrieval.js
 *     before falling through to the LLM-based query rewrite.
 *
 *   listConcepts() / size() — diagnostics.
 *
 * No async, no LLM, no I/O after first load.
 */

const fs = require('fs')
const path = require('path')

let _dict = null
let _conceptIndex = null  // built lazily: { lowercased_phrase: conceptId }

function loadIfNeeded() {
  if (_dict !== null) return
  const candidates = [
    process.env.LEXVAULT_CONCEPT_DICT,
    path.resolve(__dirname, '..', '..', 'data', 'legal_concepts.json'),
    path.resolve(__dirname, '..', 'data', 'legal_concepts.json'),
    path.resolve(__dirname, 'data', 'legal_concepts.json'),
    '/lexvault/legal_concepts.json',
    '/opt/legalclarity/data/legal_concepts.json',
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      try {
        _dict = JSON.parse(fs.readFileSync(p, 'utf8'))
        console.log(`[conceptDict] loaded ${Object.keys(_dict).filter(k => !k.startsWith('_')).length} concepts from ${p}`)
        break
      } catch (err) {
        console.warn(`[conceptDict] failed to parse ${p}: ${err.message}`)
      }
    }
  }
  if (_dict === null) {
    console.warn('[conceptDict] no dictionary file found — concept lookup disabled')
    _dict = {}
  }
  _buildIndex()
}

function _buildIndex() {
  _conceptIndex = new Map()
  for (const [conceptId, entry] of Object.entries(_dict)) {
    if (conceptId.startsWith('_')) continue
    if (!entry?.terms) continue
    for (const langEntry of Object.values(entry.terms)) {
      if (!langEntry) continue
      // Index the primary form + every synonym under a normalized key.
      // Multi-word phrases are kept as-is so we match longer terms first.
      const phrases = [langEntry.primary, ...(langEntry.synonyms || [])]
      for (const phrase of phrases) {
        if (!phrase) continue
        const key = _norm(phrase)
        // Map the longest phrase to a concept; if collision, keep the more
        // specific one (longer phrase = more specific).
        const existing = _conceptIndex.get(key)
        if (!existing || phrase.length > existing.phrase.length) {
          _conceptIndex.set(key, { conceptId, phrase })
        }
      }
    }
  }
}

function _norm(s) {
  return String(s).toLowerCase().normalize('NFKC').trim()
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    // Strip diacritics (so "prescripția" matches "prescriptia")
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Cheap keyword/synonym scan. We tokenize the user's text and look for any
 * phrase from our dictionary as a substring (in normalized form). The
 * longest match wins. This catches ~80 % of the obvious cases:
 *   "Wie lange ist die Verjährungsfrist?" → limitations.general
 *   "What's the notice period?"           → employment.notice
 *   "Cum se înființează un SRL?"           → company.formation_llc
 *
 * Anything that doesn't substring-match falls through to the LLM (or, in a
 * future iteration, to embedding-cosine matching against concept centroids).
 */
function detectConcept(text /*, sourceLang */) {
  loadIfNeeded()
  if (!text || typeof text !== 'string') return null
  const t = ' ' + _norm(text) + ' '   // padding so word-boundary checks work

  let best = null
  for (const [key, val] of _conceptIndex.entries()) {
    if (!key) continue
    // Word-boundary-ish substring: require space on at least one side
    // so "art" doesn't match "smart". Cheap, not regex.
    const padded = ' ' + key + ' '
    if (t.includes(padded) || t.startsWith(key + ' ') || t.endsWith(' ' + key)) {
      if (!best || key.length > best.matchedLen) {
        best = { conceptId: val.conceptId, matched: val.phrase, matchedLen: key.length }
      }
    }
  }
  if (!best) return null
  return { conceptId: best.conceptId, matched: best.matched, confidence: best.matchedLen >= 8 ? 'high' : 'medium' }
}

/**
 * Look up the formal statutory term for a concept in a target jurisdiction.
 * Returns null if the concept isn't covered for that jurisdiction (caller
 * should fall through to the LLM).
 */
function lookup(conceptId, jurisdiction) {
  loadIfNeeded()
  const entry = _dict[conceptId]
  if (!entry?.terms) return null
  const t = entry.terms[jurisdiction] || entry.terms[String(jurisdiction).toUpperCase()]
  if (!t) return null
  return {
    primary: t.primary,
    synonyms: t.synonyms || [],
    statute_ref: t.statute_ref || '',
    topic: entry.topic || '',
  }
}

/**
 * One-shot helper. Returns a query2-shaped string:
 *   "<formal statutory term> <statute ref>"
 * or null if no concept matched / no jurisdiction term.
 */
function buildQuery2(text, sourceLang, jurisdiction) {
  const detected = detectConcept(text, sourceLang)
  if (!detected) return null
  const term = lookup(detected.conceptId, jurisdiction)
  if (!term) return null
  // The statutory ref is genuinely high-signal for retrieval — Qdrant
  // tokenizes it the same way as the chunk's source_name, so a query
  // containing "Codul Civil Art. 2517" will match the right doc family.
  const parts = [term.primary]
  if (term.statute_ref) parts.push(term.statute_ref)
  return {
    conceptId: detected.conceptId,
    matched: detected.matched,
    query2: parts.join(' '),
    primary: term.primary,
    statute_ref: term.statute_ref,
  }
}

function listConcepts() {
  loadIfNeeded()
  return Object.keys(_dict).filter(k => !k.startsWith('_'))
}

function size() {
  loadIfNeeded()
  let n = 0
  for (const [k, v] of Object.entries(_dict)) {
    if (k.startsWith('_')) continue
    n += Object.keys(v.terms || {}).length
  }
  return { concepts: listConcepts().length, jurisdiction_entries: n, indexed_phrases: _conceptIndex?.size || 0 }
}

module.exports = { detectConcept, lookup, buildQuery2, listConcepts, size }
