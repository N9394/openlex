"use strict"
/**
 * Structured clause extraction (spec §4.1 "Facts" row, B2).
 *
 * Turns one section into a compact structured table — parties, obligations,
 * rights, prohibitions, warranties, conditions, values, dates, and a
 * favoring verdict — without any LLM call. Deterministic, instant, ~400
 * tokens of output vs ~2K raw. This is the input to `get_clause_analysis`
 * (agent tool) and the red-flag driver for `search_law` (only risky
 * clauses trigger law search).
 */

// ── obligation/right/prohibition/warranty markers ───────────────────────────
const OBLIGATION_RE = /\b(shall|must|agrees to|undertakes to|is obligated to|is obliged to|shall use (?:best|reasonable|commercially reasonable) efforts to|covenants? to)\b/i
const RIGHT_RE = /\b(may|is entitled to|has the right to|has the option to|may elect to|shall be entitled to|is permitted to)\b/i
const PROHIBITION_RE = /\b(shall not|must not|may not|cannot|is prohibited from|shall in no event|neither party shall|no party shall|without (?:the )?prior written consent)\b/i
const WARRANTY_RE = /\b(warrants?|represents|represents and warrants|covenants? that)\b/i
const CONDITION_RE = /\b(subject to|provided that|provided,? however|unless|if and only if|condition precedent|condition subsequent|on condition that)\b/i

// Party roles: capitalized role words + "the X" patterns. Order matters.
const ROLE_RE = /\b(the\s+)?(seller|buyer|purchaser|vendor|supplier|provider|client|customer|company|corporation|borrower|lender|guarantor|lessor|lessee|landlord|tenant|licensor|licensee|assignor|assignee|indemnitor|indemnitee|obligor|obligee|contractor|subcontractor|employer|employee|agent|principal|trustee|beneficiary|party a|party b|counterparty)\b/gi
const NAMED_RE = /\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,}){0,3})\b/g // proper-name candidates (used w/ role list, not standalone)

// Values & dates
const VALUE_RE = /(?:€|EUR|USD|\$|£|GBP)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d{1,3}(?:[.,]\d{3})*\s?(?:EUR|USD|euro|dollars?|€)|-?\d{1,2}(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?(?:million|billion|thousand)/gi
const DURATION_RE = /\b(\d{1,3})\s?(?:business\s+)?(days?|months?|years?|quarters?|weeks?)\b/gi
const DATE_RE = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)[a-z]*\s+\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi

const SPLIT_SENTENCES = /[^.!?\n]+[.!?]+|\S[^.!?\n]*$/g

function sentenceType(sentence) {
  if (PROHIBITION_RE.test(sentence)) return 'prohibition'
  if (WARRANTY_RE.test(sentence)) return 'warranty'
  if (OBLIGATION_RE.test(sentence)) return 'obligation'
  if (RIGHT_RE.test(sentence)) return 'right'
  if (CONDITION_RE.test(sentence)) return 'condition'
  return null
}

function extractParties(sentence, roleSet) {
  const found = new Set()
  const roles = sentence.match(ROLE_RE) || []
  for (const r of roles) {
    const role = r.trim().replace(/^the\s+/i, '')
    if (roleSet.has(role)) found.add(role)
  }
  return found
}

/** Subject of a modal clause — the party the verb attaches to. */
function subjectOf(sentence, roleSet) {
  const parts = sentence.split(/\b(shall|must|may|cannot|agrees to|undertakes to|warrants|represents|covenants|is entitled|has the right|is obligated)\b/i)
  if (parts.length < 2) return null
  const head = parts[0].trim()
  // "Subject shall ..." — pick role words in the head, preferring the last one.
  const roles = head.match(ROLE_RE) || []
  for (let i = roles.length - 1; i >= 0; i--) {
    const role = roles[i].trim().replace(/^the\s+/i, '')
    if (roleSet.has(role)) return role
  }
  if (/\b(each party|both parties|the parties|either party|neither party|no party|such party|indemnifying party|non-indemnifying party)\b/i.test(head)) return 'both/either party'
  if (/^i[fn]/i.test(head) && /^it/i.test(head)) return null
  return null
}

/**
 * Analyze one section. Returns the structured table.
 *
 * @param {string} text       raw section text
 * @param {Set<string>} roleSet  known party roles (from glossary/doc) — optional
 */
function analyzeSection(text, roleSet) {
  const roles = roleSet || new Set(['Seller', 'Buyer', 'Company', 'Supplier', 'Client', 'Lender', 'Borrower', 'Guarantor', 'Lessor', 'Lessee', 'Licensor', 'Licensee', 'Employer', 'Employee', 'Contractor', 'Subcontractor', 'Party A', 'Party B'])
  const sentences = String(text || '').replace(/\n+/g, ' ').match(SPLIT_SENTENCES).map((s) => s.trim()).filter(Boolean)

  const rows = [] // { subject, type, clause (≤160 chars), values, favoring }
  const values = new Set()
  const durations = new Set()
  const dates = new Set()
  const partyMentions = new Set()
  const counts = { obligation: 0, right: 0, prohibition: 0, warranty: 0, condition: 0 }

  for (const sentence of sentences) {
    const type = sentenceType(sentence)
    if (!type) continue
    const subject = subjectOf(sentence, roles) || 'unspecified'
    const parties = extractParties(sentence, roles)
    for (const p of parties) partyMentions.add(p)
    counts[type]++

    const v = sentence.match(VALUE_RE) || []
    const d = sentence.match(DURATION_RE) || []
    const da = sentence.match(DATE_RE) || []
    for (const x of v) values.add(x)
    for (const x of d) durations.add(x.toLowerCase())
    for (const x of da) dates.add(x)

    rows.push({
      subject: subject === 'unspecified' && parties.size === 1 ? [...parties][0] : subject,
      type,
      clause: sentence.slice(0, 160),
      value: v.slice(0, 3).join('; '),
      duration: d.slice(0, 3).join('; '),
      date: da.slice(0, 2).join('; '),
    })
  }

  // Favoring: the side carrying fewer obligations (and more rights) is
  // favored. When only one party appears, it's the one with the duties.
  const perParty = new Map()
  for (const r of rows) {
    const key = r.subject === 'unspecified' ? 'unspecified' : r.subject
    const e = perParty.get(key) || { obligation: 0, right: 0, prohibition: 0, warranty: 0 }
    e[r.type]++
    perParty.set(key, e)
  }
  const balance = []
  for (const [party, e] of perParty) {
    const duty = e.obligation + e.prohibition + e.warranty
    const benefit = e.right
    balance.push({ party, duty, benefit, score: benefit - duty })
  }
  balance.sort((a, b) => b.score - a.score)
  let favoring = null
  if (balance.length >= 2 && balance[0].score > balance[1].score) {
    favoring = `${balance[0].party} favored (${balance[0].benefit} rights vs ${balance[0].duty} duties; ${balance[1].party}: ${balance[1].benefit}/${balance[1].duty})`
  } else if (balance.length === 1 && balance[0].duty > 0) {
    favoring = `${balance[0].party} carries all duties (${balance[0].duty}); no counter-party in this section`
  }

  return {
    parties: [...partyMentions].slice(0, 12),
    rows: rows.slice(0, 16),
    counts,
    values: [...values].slice(0, 8),
    durations: [...durations].slice(0, 6),
    dates: [...dates].slice(0, 4),
    favoring,
  }
}

/**
 * Compact serialization for the agent context (~400 tokens/section).
 */
function formatClauseAnalysis(analysis, index) {
  const lines = [`SECTION ${index} — ${analysis.rows.length} operative sentence(s)`, `counts: obligations ${analysis.counts.obligation} · rights ${analysis.counts.right} · prohibitions ${analysis.counts.prohibition} · warranties ${analysis.counts.warranty} · conditions ${analysis.counts.condition}`]
  if (analysis.parties.length) lines.push('parties: ' + analysis.parties.join(', '))
  if (analysis.values.length) lines.push('values: ' + analysis.values.join(' · '))
  if (analysis.durations.length) lines.push('durations: ' + analysis.durations.join(' · '))
  if (analysis.favoring) lines.push('favoring: ' + analysis.favoring)
  for (const r of analysis.rows.slice(0, 8)) {
    const suffix = [r.value, r.duration, r.date].filter(Boolean).join(' · ')
    lines.push(`- [${r.type}] ${r.subject}: ${r.clause}${suffix ? '  («' + suffix + '»)': ''}`)
  }
  if (analysis.rows.length > 8) lines.push(`… ${analysis.rows.length - 8} more`)
  return lines.join('\n')
}

module.exports = { analyzeSection, formatClauseAnalysis }
