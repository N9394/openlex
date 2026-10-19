"use strict"
/**
 * Context manager (spec §4 + plan §3): token guard + compaction ladder.
 *
 * Every LLM request goes through here before send. If the estimated message
 * size exceeds the working budget (minus output reserve), we compact — in
 * order — until it fits. llama.cpp is never allowed to truncate silently.
 *
 * Compaction ladder:
 *   1. drop oldest assistant+tool hop pairs (sliding window, keep newest)
 *   2. digest remaining tool outputs to their first N sentences
 *   3. truncate the doc summary to headings only
 *
 * Estimation uses the same ~4 chars/token heuristic as compress.js; it's a
 * guard, not a hard tokenizer — the 15% headroom absorbs the error.
 */

const { estimateTokens, isHeading } = require('./compress')
const { effectiveAgent } = require('./agent-config')

const TOKEN_HEADROOM = 0.15 // reserve 15% of budget for estimator error
const MAX_TOOL_OUTPUT_TOKENS = 220
const MAX_SUMMARY_TOKENS = 350

function ctxBudgetTokens() {
  return effectiveAgent().CTX_BUDGET_TOKENS
}

/**
 * @param {Array<{role:string, content:string}>} messages
 * @returns {number} estimated total tokens
 */
function estimate(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0)
}

/**
 * Compact a message list to fit within `budget − outputReserve`.
 * Returns { messages, compacted } — compacted describes what was dropped.
 */
function compact(messages, outputReserve = 0, budget = ctxBudgetTokens()) {
  const budgetLimit = Math.floor(budget * (1 - TOKEN_HEADROOM)) - outputReserve
  let current = estimate(messages)
  const actions = []

  if (current <= budgetLimit) return { messages, compacted: actions.length ? actions : null }

  // 1. Drop oldest assistant+tool hop pairs (sliding window). Keep the
  //    system prompt, the LATEST user message (always), and at least 2 hop
  //    pairs (4 messages) of working memory so the model keeps recent
  //    context. The user message is never dropped.
  const keepSystem = messages.filter((m) => m.role === 'system')
  const others = messages.filter((m) => m.role !== 'system')
  const userIdx = others.map((m) => m.role).lastIndexOf('user')
  const userMsg = userIdx >= 0 ? others.splice(userIdx, 1)[0] : null
  const rest = others // assistant/tool only — droppable
  const minKeep = 4 // 2 hop pairs minimum
  let dropped = 0
  while (current > budgetLimit && rest.length > minKeep) {
    // Remove the oldest assistant/tool message.
    const removed = rest.shift()
    current -= estimateTokens(removed.content || '')
    dropped++
    actions[0] = `dropped ${dropped} oldest step(s)`
  }

  // 2. Digest remaining tool outputs to their first N sentences.
  for (const m of rest) {
    if (m.role !== 'tool' || !m.content) continue
    const tok = estimateTokens(m.content)
    if (tok <= MAX_TOOL_OUTPUT_TOKENS) continue
    const digested = digestToolOutput(m.content)
    current -= tok - estimateTokens(digested)
    m.content = digested
    actions.push('digested tool outputs')
  }

  // 3. Compress the doc summary (system content) to fit the remaining
  //    budget. Compression, not truncation: every section stays
  //    represented (headings always, paragraph first-sentences at a
  //    shrinking budget), the glossary is kept. The old hard 8K cap cut
  //    whole tail sections out of the prompt ("truncated doc summary").
  if (current > budgetLimit) {
    let needed = current - budgetLimit
    for (const m of keepSystem) {
      if (needed <= 0) break
      const tok = estimateTokens(m.content)
      if (tok <= MAX_SUMMARY_TOKENS) continue
      // Target chars for THIS message: shrink by the tokens we still need
      // (≈4 chars/token), floor at a small floor so it always compresses
      // toward the requirement.
      const targetChars = Math.max(600, (tok - needed) * 4)
      const compressed = compressDocBlock(m.content, targetChars)
      const newTok = estimateTokens(compressed.text)
      if (newTok >= tok) continue
      current -= tok - newTok
      needed -= tok - newTok
      m.content = compressed.text
      actions.push(compressed.level === 'outline' ? 'compressed doc summary (outline)' : 'compressed doc summary')
    }
  }

  const out = [...keepSystem, ...(userMsg ? [userMsg] : []), ...rest]
  return { messages: out, compacted: actions.length ? [...new Set(actions)] : null }
}

/** First ~2 sentences of a tool output (keeps source names + holding). */
function digestToolOutput(text) {
  const s = String(text || '')
  const parts = s.split(/(?<=[.!?])\s+/)
  if (parts.length <= 2) return s
  return parts.slice(0, 2).join(' ') + ' …'
}

/** Structural doc-block compression ladder (compress, never truncate).
 * The FULL DOCUMENT TEXT segment is compressed level-wise — headings are
 * always kept in full, every paragraph keeps its first `budget` chars,
 * and the per-paragraph char counts stay visible so the model can pull
 * detail with get_range_text. Everything OUTSIDE the doc block (map /
 * PREVIOUS / glossary) is kept; conversation lines drop first.
 *
 * Levels: L0 keep-all · L1 340 chars/para · L2 180 · L3 90 · L4 outline.
 * Picks the smallest level that fits `targetChars`; the outline is the
 * last resort. Returns { text, level } — level 'keep' | 1..4 | 'outline'. */
const DOC_LEVELS = [
  { chars: 340, level: 1 },   // most detail that still compresses
  { chars: 180, level: 2 },
  { chars: 90, level: 3 },
  { chars: 0, level: 4 },     // outline: headings + paragraph sizes only
]
const CONV_LINE = /^USER:|^ASSISTANT:|^CONVERSATION /
const SECTION_MARK = /^DOCUMENT:|^HEADINGS:|^PREVIOUS:|^PRE-READ/

function compressDocBlock(content, targetChars) {
  const s = String(content || '')
  const lines = s.split('\n')

  // Locate the doc block (FULL DOCUMENT TEXT: … until a section mark).
  let docStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^FULL DOCUMENT TEXT:/.test(lines[i])) { docStart = i; break }
  }
  if (docStart < 0) {
    // No doc block: just shed conversation lines, keep the rest verbatim.
    return { text: lines.filter((l) => !CONV_LINE.test(l)).join('\n'), level: 'keep' }
  }
  let docEnd = lines.length
  for (let i = docStart + 1; i < lines.length; i++) {
    if (SECTION_MARK.test(lines[i])) { docEnd = i; break }
  }

  const head = lines.slice(0, docStart).filter((l) => !CONV_LINE.test(l))
  const doc = lines.slice(docStart + 1, docEnd)
  const tail = lines.slice(docEnd).filter((l) => !CONV_LINE.test(l))

  const render = (budget) => {
    const out = []
    let para = [] // paragraph accumulation (non-heading lines)
    const flush = () => {
      if (!para.length) return
      const size = para.join(' ').length
      if (budget === 0) {
        out.push(`  … (${size} chars — get_range_text)`)
      } else {
        let kept = 0
        for (const l of para) {
          if (kept >= budget) break
          const take = Math.min(l.length, budget - kept)
          out.push(take < l.length ? l.slice(0, take) + ' …' : l)
          kept += take + 1
        }
      }
      para = []
    }
    for (const l of doc) {
      if (CONV_LINE.test(l)) continue
      if (isHeading(l)) { flush(); out.push(l); continue }
      if (budget === Infinity) { out.push(l); continue }
      para.push(l)
    }
    flush()
    return out
  }

  const sizeOf = (arr) => arr.reduce((n, l) => n + l.length + 1, 0)
  const fixed = sizeOf(head) + sizeOf(tail)
  let chosen = null
  for (const { chars, level } of DOC_LEVELS) {
    const rendered = render(chars)
    if (fixed + sizeOf(rendered) <= targetChars) { chosen = { lines: rendered, level }; break }
  }
  if (!chosen) {
    // Even the outline is too big — keep it anyway (structure over size);
    // the ladder's earlier steps (drop hops, digest tools) run first, so
    // this only fires on pathological documents.
    chosen = { lines: render(0), level: 'outline' }
  }

  const label = chosen.level === 4 ? 'FULL DOCUMENT TEXT (outline — pull detail with get_range_text):' : `FULL DOCUMENT TEXT (compressed):`
  const out = [...head, label, ...chosen.lines, ...tail]
  return { text: out.join('\n'), level: chosen.level === 4 ? 'outline' : chosen.level }
}

module.exports = { compact, estimate, ctxBudgetTokens }
