"use strict"
/**
 * Redaction check, version 2 — built around the decision model (GOWA).
 *
 *   stage 1  candidates, aimed at recall: the patterns, the matter's and the
 *            firm's lists, titles and legal forms (pii_detect.scan, as in
 *            version 1) plus the pluggable candidate sources
 *            (pii_candidates.js: first names, capitalised words, GLiNER when
 *            installed)
 *   stage 2  the decision model classifies each distinct candidate in its
 *            context (`choice`: person / organisation / address / ID number /
 *            other personal data / not personal data) with a calibrated
 *            probability:
 *              confident and personal   → ticked
 *              unsure                   → a new candidate is shown unticked; a version-1
 *                                         finding keeps version 1's tick
 *              confident "not personal" → a list or rule finding stays shown
 *                                         unticked; a mere capitalised word is dropped
 *
 * The lists (term, firm) and the patterns with a fixed shape (e-mail, IBAN,
 * phone, ID numbers…) are never overruled by the model. Long documents:
 * each candidate is asked with its own short window, distinct candidates
 * once per check, in batches. Everything runs on this computer (the task is
 * local-only: a cloud decision service is never used for it).
 *
 * Version 1 (pii_detect.scan alone, GLiNER as the model when installed)
 * stays the fallback: when the switch is off, no local decision model is
 * ready, or the model fails.
 *
 * It finds candidates and suggests; it does not guarantee anything. Names
 * without any clue (no title, no list entry, lower case, no first name we
 * know) depend on candidate generation: what no source proposes, the model
 * never sees. The lawyer's review is the check.
 *
 *   ready()                         may version 2 run now?
 *   detection()                     'basic' | 'name-finder' | 'gowa'
 *   findings(text, opts)            → { findings, stats }
 */

const detect = require('./pii_detect')
const candidates = require('./pii_candidates')

const WINDOW = 240 // characters of context on each side
const MAX_ASK = 2000 // distinct candidates asked per check; beyond that, version 1 decides
const BATCH = 32
// Which stage-1 findings the model may re-classify (lists and fixed-shape patterns stay as they are).
const ASK_SOURCES = new Set(['heuristic', 'model', 'gliner', 'names', 'ngrams'])
const ASK_KINDS = new Set(['PERSON', 'ORG', 'ADDRESS', 'OTHER'])

function ready() {
  try { return require('./decide_tasks').enabled('redaction') } catch { return false }
}

/** What the check says about its detection, honestly. */
function detection() {
  if (ready()) return 'gowa'
  try { if (require('./pii_ner').status().installed) return 'name-finder' } catch { /* no name finder */ }
  return 'basic'
}

/** The passage around a candidate, the candidate marked ⟦like this⟧. */
function context(text, start, end) {
  const a = Math.max(0, start - WINDOW)
  const b = Math.min(text.length, end + WINDOW)
  return `${a > 0 ? '…' : ''}${text.slice(a, start)}⟦${text.slice(start, end)}⟧${text.slice(end, b)}${b < text.length ? '…' : ''}`
}

/**
 * @param {string} text
 * @param {object} o
 *   terms, keep, patterns   as for pii_detect.scan
 *   cache                   Map norm(text) → decision, shared across the documents of one check
 *   signal
 * @returns {Promise<{ findings, stats: { candidates, asked, automated, escalated, dropped, partial, sources } }>}
 */
async function findings(text, { terms = [], keep = [], patterns = [], cache = new Map(), signal } = {}) {
  text = String(text || '')
  const stats = { candidates: 0, asked: 0, automated: 0, escalated: 0, dropped: 0, partial: false, sources: [] }
  const { found, used } = await candidates.find(text, { signal })
  stats.sources = used
  const gliner = found.filter((f) => f.source === 'gliner').map(({ source, ...f }) => ({ ...f }))
  // Stage 1: the version-1 scan (with GLiNER as its model), then the extra sources where nothing was found.
  const base = detect.scan(text, { terms, keep, patterns, model: gliner, all: true })
  const keepSet = new Set(keep.map(detect.norm))
  const extra = []
  const overlaps = (f, list) => list.some((t) => f.start < t.end && t.start < f.end)
  for (const f of found.filter((x) => x.source !== 'gliner').sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (keepSet.has(detect.norm(text.slice(f.start, f.end)))) continue
    if (!overlaps(f, base) && !overlaps(f, extra)) extra.push(f)
  }
  stats.candidates = base.length + extra.length

  // Stage 2: one question per distinct candidate text.
  const askable = [
    ...base.filter((f) => ASK_SOURCES.has(f.source) && ASK_KINDS.has(f.kind)).map((f) => ({ f, base: true })),
    ...extra.map((f) => ({ f, base: false })),
  ]
  const todo = new Map()
  for (const a of askable) {
    const key = detect.norm(text.slice(a.f.start, a.f.end))
    if (cache.has(key) || todo.has(key)) continue
    if (cache.size + todo.size >= MAX_ASK) { stats.partial = true; continue }
    todo.set(key, { text: text.slice(a.f.start, a.f.end), context: context(text, a.f.start, a.f.end) })
  }
  const keys = [...todo.keys()]
  const tasks = require('./decide_tasks')
  for (let i = 0; i < keys.length; i += BATCH) {
    if (signal?.aborted) break
    const part = keys.slice(i, i + BATCH)
    const res = await tasks.classifyCandidates(part.map((k) => todo.get(k)), { signal })
    if (!res) { stats.partial = true; break }
    part.forEach((k, j) => { if (res[j]) cache.set(k, res[j]) })
  }
  stats.asked = keys.length

  // Apply the decisions.
  const out = []
  const dec = (f) => cache.get(detect.norm(text.slice(f.start, f.end)))
  for (const f of base) {
    const d = ASK_SOURCES.has(f.source) && ASK_KINDS.has(f.kind) ? dec(f) : null
    if (!d) { out.push(f); continue }
    if (d.outcome === 'automate') stats.automated++
    else stats.escalated++
    if (d.kind === null) {
      // The model says "not personal data": shown, unticked (the lawyer can still tick it).
      out.push({ ...f, on: d.outcome === 'automate' ? false : f.on, decided: { answer: d.answer, p: d.p, outcome: d.outcome } })
    } else if (d.outcome === 'automate') {
      out.push({ ...f, kind: d.kind, group: detect.GROUPS[d.kind] || 'other', label: detect.KIND_LABELS[d.kind] || f.label, confidence: d.p, on: true, decided: { answer: d.answer, p: d.p, outcome: d.outcome } })
    } else {
      // Unsure: version 1's choice stands (missing a name is worse than one tick too many).
      out.push({ ...f, decided: { answer: d.answer, p: d.p, outcome: d.outcome } })
    }
  }
  for (const f of extra) {
    const d = dec(f)
    if (!d) continue // not asked (switch off, model failed, or over the limit): version 1 shows nothing for a bare capitalised word
    if (d.kind === null && d.outcome === 'automate') { stats.dropped++; stats.automated++; continue }
    if (d.outcome === 'automate') stats.automated++
    else stats.escalated++
    const kind = d.kind || (f.kind === 'PERSON' ? 'PERSON' : 'OTHER')
    out.push({ kind, group: detect.GROUPS[kind] || 'other', text: text.slice(f.start, f.end), start: f.start, end: f.end, confidence: d.p, source: 'model', label: detect.KIND_LABELS[kind], on: d.outcome === 'automate' && d.kind !== null, decided: { answer: d.answer, p: d.p, outcome: d.outcome } })
  }
  out.sort((a, b) => a.start - b.start)
  return { findings: out.map((f, i) => ({ ...f, id: `f${i + 1}` })), stats }
}

module.exports = { ready, detection, findings, context, WINDOW, MAX_ASK }
