"use strict"
/**
 * Aggressive local context compression (spec §4.1).
 *
 * - Sectioning: split document text into ≤2K-char sections on paragraph
 *   boundaries.
 * - Extractive compression: keep only sentences with legal signal —
 *   modals (shall/must/may/may not), numbers/dates/€/$/%, defined terms,
 *   obligations markers. Drop boilerplate via a stop-list.
 * - Defined-term extraction: ACRONYM + definition pairs → glossary.
 * - Law digest: source + § + first 2 sentences.
 *
 * All local, no LLM involvement (embeddings not required either).
 */

const SECTION_MAX_CHARS = 2000

const MODAL_RE = /\b(shall|shall not|must|may|may not|must not|undertakes|agrees to|warrants|represents|covenants|will indemnify|is obligated|obligation|right|entitled|liable|liability|indemnif|hereby)\b/i
const NUMERIC_RE = /\b(\d{1,3}([.,]\d{3})*|\d{4}|\d{1,2}%\s*(p\.?a\.?|per annum)?|€|EUR|USD|\$|euro|days?|months?|years?)\b/i
const BOILERPLATE_RE = /^(this agreement|in witness whereof|entered into|made this|regarding this|further to the|this contract is|party a|party b|now therefore)\b/i

/**
 * Heading predicate — shared by splitSections (heading = section boundary)
 * and the document map (heading = tree node title). Covers the forms real
 * contracts actually use:
 *   Section 2: Force Majeure | SECTION 3 — TERMINATION | Art. 4.1 Rights
 *   4. Intellectual Property | 1.1 Definitions | I. Parties | SERVICE AGREEMENT
 * A line longer than 120 chars is body text, never a heading.
 */
function isHeading(line) {
  const l = String(line || '').trim()
  if (!l || l.length > 120) return false
  if (/^(?:section|sec\.?|art\.?|article|clause|par\.?|paragraph|§|s\.?)\s*\d+(?:\.\d+)*[:.)–—\-]?(\s+|$)/i.test(l)) return true
  // "4. Intellectual Property" or "1.1 Definitions" — the separator is the
  // final '.' of the number run or the space after it.
  if (/^\d+(?:\.\d+)*[.)\s]+[A-ZÀ-ÿ0-9]/.test(l)) return true
  if (/^(?:i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})\b[.)–—:]?\s+[A-ZÀ-ÿ]/i.test(l)) return true
  if (/^[A-ZÀ-ÿ][A-ZÀ-ÿ0-9'’&.()\- ]{4,80}$/.test(l)) return true
  return false
}

// Word built-in heading styles → outline level (Batch 2.6). The pane sends
// the document's real paragraph styles; a styled heading breaks sections
// even when the text heuristic misses it, and gets the true level.
const STYLE_LEVEL = { title: 0, subtitle: 0, heading1: 1, heading2: 2, heading3: 3, heading4: 4, heading5: 5, heading6: 6 }

function styleLevel(style) {
  if (!style) return null
  const key = String(style).toLowerCase().replace(/[^a-z0-9]/g, '')
  return STYLE_LEVEL[key] ?? null
}

function splitSections(text, maxChars = SECTION_MAX_CHARS, paraStyles = null) {
  // Word's body.text separates paragraphs with \r (line breaks inside a
  // paragraph stay \n). Normalize every paragraph mark to \n, then treat
  // any run of newlines as a paragraph boundary — otherwise a Word doc
  // arrives as ONE paragraph and the map collapses to a single section.
  const paragraphs = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const sections = []
  let current = []
  let currentLen = 0
  let currentStart = -1 // paragraph index where the current section began
  let currentStyleLevel = null

  const flush = () => {
    if (!current.length) return
    sections.push({
      index: sections.length,
      text: current.join('\n\n'),
      paraStart: currentStart,
      paraCount: current.length,
      styleLevel: currentStyleLevel,
    })
    current = []
    currentLen = 0
    currentStart = -1
    currentStyleLevel = null
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi]
    const stLevel = paraStyles ? styleLevel(paraStyles[pi]) : null
    // A heading starts its own section — the map must show every titled
    // clause (previously headings inside a merged section were swallowed).
    // Real Word heading styles count even when the text heuristic misses.
    if (isHeading(p) || stLevel !== null) {
      flush()
      current.push(p)
      currentLen = p.length + 2
      currentStart = pi
      currentStyleLevel = stLevel
      continue
    }
    // A long paragraph becomes its own section regardless.
    if (p.length >= maxChars) {
      flush()
      sections.push({ index: sections.length, text: p, paraStart: pi, paraCount: 1, styleLevel: stLevel })
      continue
    }
    if (currentLen + p.length > maxChars) {
      flush()
      currentStart = pi
    } else if (currentStart < 0) {
      currentStart = pi
    }
    current.push(p)
    currentLen += p.length + 2
  }
  flush()
  return sections
}

function isHighSignal(sentence) {
  if (MODAL_RE.test(sentence)) return true
  if (NUMERIC_RE.test(sentence)) return true
  if (BOILERPLATE_RE.test(sentence)) return false
  return sentence.length >= 40 // substantial clauses even without keywords
}

/**
 * Compress a section to the sentences that matter. Returns the same text if
 * nothing can be cut.
 */
function compressSection(text) {
  const sentences = String(text)
    .replace(/\n/g, ' ')
    .match(/[^.!?]+[.!?]+|\S[^.!?]*$/g)
    .map((s) => s.trim())
    .filter(Boolean)

  const kept = sentences.filter(isHighSignal)
  if (kept.length === sentences.length) return text // already dense
  // Floor lowered 30% → 20% (plan §6): boilerplate-heavy sections previously
  // bailed out too early, keeping raw text. 20% still guards against
  // destroying a section that's mostly procedural.
  if (kept.length < Math.max(2, Math.ceil(sentences.length * 0.2))) return text
  return kept.join(' ')
}

/**
 * Extract defined terms: "“Affiliate” means …" / "Affiliate (as defined in
 * Section X)" / "…the "Company"…" patterns.
 */
function extractDefinedTerms(sectionText) {
  const terms = []
  const re = /[“"]([A-Z][A-Za-z0-9 -]{2,60})[”"](?:\s+(?:means?|as defined in|shall mean|has the meaning given))[^.\n]{0,200}/g
  let m
  while ((m = re.exec(sectionText))) terms.push({ term: m[1].trim(), definition: m[0].slice(0, 220) })
  return terms
}

/**
 * Law chunk digest for the agent context: source name + section + first N
 * sentences. ~100 tokens vs ~800 raw.
 */
function lawDigest(chunk, sentences = 2) {
  const parts = [chunk.source_name]
  if (chunk.section) parts.push(chunk.section)
  const text = String(chunk.content || '').replace(/\s+/g, ' ').trim()
  const first = text.split(/(?<=[.!?])\s+/).slice(0, sentences).join(' ')
  return parts.join(' - ') + ': ' + first
}

function estimateTokens(text) {
  // rough: ~4 chars/token for legal prose
  return Math.ceil(String(text).length / 4)
}

module.exports = { splitSections, compressSection, extractDefinedTerms, lawDigest, estimateTokens, isHighSignal, isHeading }
