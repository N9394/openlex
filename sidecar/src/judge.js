"use strict"
/**
 * Judge pass — local proofreader (spec §5.2). One Lotus call at temp 0 per
 * suggestion batch: verifies each suggestion against (a) the document
 * passage it anchors to and (b) the cited law chunk when present.
 *
 * Verdicts: verified | rewrite (regenerate once) | drop.
 * Verdicts are recorded in the doc-memory ledger → audit trail.
 */

const { chat } = require('./llm')
const { getChunk } = require('./search')
const { estimateTokens } = require('./compress')

const JUDGE_PROMPT = `You are a legal proofreader for LexVault — you DOUBLE-CHECK the drafting agent's work, you do not grade its proposals against the law. A drafting agent produced suggestions for a contract. Each suggestion carries its own "document_passage" — the FULL VERBATIM text of the clause it refers to (the "anchor_text" is only a short fragment used to locate the clause in Word; never judge from the fragment alone).

WHAT THE PROPOSED_TEXT IS: the agent's suggested NEW wording (a rewrite or rebalance). It is a recommendation — it does NOT need to be found in the document passage, and it does NOT need to be a statute or quote the law. Rewrites are supposed to CHANGE the clause (e.g. favor the client more). Never drop a suggestion because the proposed text is new, one-sided, or not backed by a statute.

What you verify instead:
1. FACTS IN THE ANALYSIS: every factual claim in the suggestion's "summary" about the CURRENT contract must be consistent with its document_passage (full clause). E.g. "the clause lets either party walk away" must match the clause; "there is a EUR 100k cap" must match the clause. If the summary misstates the clause, drop it (or rewrite the summary).
2. FACT PRESERVATION IN THE PROPOSAL: the proposed_text must not silently alter concrete facts that the summary did not flag as intentional — party names, defined terms, amounts, dates, durations, percentages. Changing a number is fine ONLY if the summary says so; otherwise rewrite the proposal.
3. CITED LAW: only when the suggestion CLAIMS a statute or legal rule (e.g. "GmbH-Gesetz § 16 requires X") — then "cited_law" must exist and the statute must be named in full (e.g. "GmbH-Gesetz - § 16"), no bracket references. A suggestion without a statute claim needs NO law at all — document-grounded favoring/rebalancing is fully valid.
4. LANGUAGE: the suggestion should match the document's language.
5. STYLE: proposed text should be grammatically clean.
6. NOT A REWRITE: a proposed_text that is a clarification or request for more information (e.g. "N/A", "please specify which clause", "need clarification", "no change needed", under 20 chars) is NOT a valid rewrite — return "rewrite" with a corrected summary+proposal, or "drop". Such text must never be marked verified: auto-applying it would replace a real clause with garbage.

Return a JSON array with one object per suggestion, in order:
[{"status": "verified" | "rewrite" | "drop", "note": "short reason"}]
- verified: summary is consistent with the clause, proposal preserves un-flagged facts (or states its changes), cited law valid when claimed.
- rewrite: fixable issue — set "note" to the corrected summary or proposed text.
- drop: ONLY a clear contradiction — the summary misstates the clause on a verifiable fact, the proposal silently changes a concrete fact, or a claimed statute is absent from cited_law.

When in doubt, VERIFY. The judge is a safety net, not a second drafter.`

/**
 * @param {object} ctx { doc, memory }
 * @param {Array} suggestions agent suggestions (may carry chunk_id)
 * @param {string} finalText agent's answer text (context)
 * @returns {Promise<Array<{status,note}>>} verdicts, same length
 */
async function judgeSuggestions(ctx, suggestions, finalText) {
  if (!suggestions.length) return []

  // Pull the cited law chunks (only when the suggestion carries a chunk_id).
  const chunks = {}
  for (const s of suggestions) {
    const id = s.basis?.chunk_id
    if (id && !chunks[id]) chunks[id] = await getChunk(id)
  }

  // Build the fallback doc passage the judge verifies against: the FULL
  // text of the clauses the model read (runAction sets
  // ctx.readSectionText), plus the anchored text of each suggestion.
  // Each suggestion additionally carries its own document_passage — the
  // full clause it anchors to (runAction resolves clauseText). Judging
  // against a 160-char anchor fragment alone let shallow rewrites pass —
  // the judge must see the real clause to catch a rewrite that
  // contradicts it. Sections are ≤2K chars by construction, so the full
  // clause always fits the judge budget.
  const docText = ctx?.doc?.text || ''
  const docPassage = (() => {
    const parts = []
    if (ctx?.readSectionText) parts.push(String(ctx.readSectionText).slice(0, 6000))
    const anchors = suggestions.map((s) => s.anchor?.text).filter(Boolean)
    if (anchors.length) parts.push(anchors.join(' … '))
    return parts.length ? parts.join(' … ') : String(docText).slice(0, 4000)
  })()

  const payload = {
    document_passage: docPassage,
    suggestions: suggestions.map((s) => ({
      summary: s.summary,
      proposed_text: s.proposed_text || null,
      severity: s.severity,
      anchor_text: s.anchor?.text || null,
      // The FULL verbatim clause the suggestion refers to — never the
      // 160-char fragment. Falls back to the aggregate passage only when
      // the clause couldn't be resolved.
      document_passage: s.clauseText || docPassage,
      cited_law: s.basis ? { jurisdiction: s.basis.jurisdiction, source: s.basis.source, section: s.basis.section, chunk: s.basis.chunk_id ? chunks[s.basis.chunk_id] : null } : null,
    })),
  }

  try {
    const raw = await chat([
      { role: 'system', content: JUDGE_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ], { maxTokens: 1200, role: 'judge' })

    const verdicts = JSON.parse(raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim())
    if (!Array.isArray(verdicts)) throw new Error('judge: expected array')
    return suggestions.map((_, i) => verdicts[i] || { status: 'drop', note: 'judge returned no verdict' })
  } catch (err) {
    // Judge failure → keep suggestions but flag them (never silently drop).
    console.warn('[judge] failed:', err.message)
    return suggestions.map(() => ({ status: 'verified', note: 'judge unavailable — unverified' }))
  }
}

module.exports = { judgeSuggestions, JUDGE_PROMPT }
