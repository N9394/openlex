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
const ASK_SOURCES = new Set(['heuristic', 'model', 'gliner', 'names', 'ngrams', 'caps', 'cues'])
const ASK_KINDS = new Set(['PERSON', 'ORG', 'ADDRESS', 'OTHER'])

function ready() {
  try { return require('./decide_tasks').enabled('redaction') } catch { return false }
}

/** Why version 2 does or does not run: 'ready' | 'off' | 'not-yet-available' | 'not-installed' | 'unavailable' (no ONNX runtime). */
function status() {
  if (ready()) return 'ready'
  try { if (!require('./decide_tasks').flags().redaction) return 'off' } catch { return 'off' }
  try {
    const g = require('./gowa').status()
    if (!g.runtime.available) return 'unavailable'
    if (!g.installed) return g.status === 'not-yet-available' ? 'not-yet-available' : 'not-installed'
  } catch { return 'unavailable' }
  return 'off'
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
 * @returns {Promise<{ findings, stats: { candidates, asked, automated, escalated, dropped, partial, failed?, sources } }>}
 */
async function findings(text, { terms = [], keep = [], patterns = [], cache = new Map(), signal, respread = false } = {}) {
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
    if (!res) { stats.partial = true; stats.failed = true; break } // the model failed: what is left is version 1
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
  // Names the model confidently ticked are spread like the matter's list: every other form of
  // them in this text (surname alone, initials, declension, capitals) is found and ticked too,
  // and the model is not asked again about those forms (a lookalike surname stays ticked).
  if (!respread) {
    const have = new Set(terms.map((t) => detect.norm(typeof t === 'string' ? t : t.text)))
    const found = new Map()
    for (const f of out) {
      if (!f.on || !['PERSON', 'ORG'].includes(f.kind) || !f.decided || f.decided.outcome !== 'automate') continue
      const k = detect.norm(f.text)
      if (!have.has(k)) found.set(k, { text: f.text, kind: f.kind, source: 'found' })
    }
    if (found.size) {
      const again = await findings(text, { terms: [...terms, ...found.values()], keep, patterns, cache, signal, respread: true })
      // Keep the model's own decision on the spans it decided (the AI record shows it).
      const first = new Map(out.filter((f) => f.decided).map((f) => [`${f.start}:${f.end}`, f]))
      again.findings = again.findings.map((f) => {
        const d = first.get(`${f.start}:${f.end}`)
        return d && !f.decided ? { ...f, kind: d.kind, group: d.group, label: d.label, confidence: d.confidence, decided: d.decided } : f
      })
      again.stats.asked += stats.asked
      return addresses(text, await occurrences(text, again, signal))
    }
    return addresses(text, await occurrences(text, { findings: out.map((f, i) => ({ ...f, id: `f${i + 1}` })), stats }, signal))
  }
  return { findings: out.map((f, i) => ({ ...f, id: `f${i + 1}` })), stats }
}

/**
 * One person, one finding, and one address, one finding: a ticked name is widened over its first
 * name, initials and title (pii_person.js); the pieces of an address are joined (pii_address.js).
 */
function addresses(text, result) {
  const before = result.findings.length
  const persons = require('./pii_person').glue(text, result.findings)
  result.stats.names_widened = persons.filter((f) => f.widened).length
  result.findings = require('./pii_address').glue(text, persons).map(({ widened, ...f }, i) => ({ ...f, id: `f${i + 1}` }))
  result.stats.addresses = result.findings.filter((f) => f.source === 'address').length
  result.stats.address_pieces_joined = Math.max(0, before - result.findings.length + result.stats.addresses)
  return result
}

const MAX_OCCURRENCES = 600

/**
 * The second look, per occurrence. Decisions above are made once per distinct text, and a
 * name's forms are spread everywhere — so "Koch" the surname and "der Koch" the cook, or "Brno"
 * in an address and in a hospital's name, get the same answer. The uncertain ones are asked
 * again, each in its own context:
 *   a single word that is ticked because a name was spread (a surname alone), or
 *   a single word the model decided once that appears more than once.
 * The model may only untick, and only when it is confident; the occurrence stays in the check
 * (shown, unticked), so the lawyer still sees it. It never drops anything.
 */
async function occurrences(text, result, signal) {
  const count = new Map()
  for (const f of result.findings) { const k = detect.norm(f.text); count.set(k, (count.get(k) || 0) + 1) }
  const ask = result.findings.filter((f) => f.on && ['PERSON', 'ORG', 'ADDRESS', 'OTHER'].includes(f.kind) && !/\s/.test(f.text) &&
    (f.source === 'spread' || (f.decided && count.get(detect.norm(f.text)) > 1))).slice(0, MAX_OCCURRENCES)
  result.stats.occurrences = 0
  if (!ask.length) return result
  const tasks = require('./decide_tasks')
  const verdict = new Map()
  for (let i = 0; i < ask.length; i += BATCH) {
    if (signal?.aborted) break
    const part = ask.slice(i, i + BATCH)
    const res = await tasks.classifyCandidates(part.map((f) => ({ text: f.text, context: context(text, f.start, f.end) })), { signal })
    if (!res) break // the model stopped: the ticks stay (the safe side)
    part.forEach((f, j) => { if (res[j]) verdict.set(f.id, res[j]) })
    result.stats.occurrences += part.length
  }
  result.findings = result.findings.map((f) => {
    const d = verdict.get(f.id)
    if (!d || d.kind !== null || d.outcome !== 'automate') return f
    return { ...f, on: false, decided: { answer: d.answer, p: d.p, outcome: d.outcome, occurrence: true } }
  })
  return result
}

module.exports = { ready, status, detection, findings, context, WINDOW, MAX_ASK }
