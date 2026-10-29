"use strict"
/**
 * Large documents: how a document is read, decided by the model that will
 * read it (founder decision, docs/LARGE_DOCUMENTS.md).
 *
 *   local model   the document map + sections pulled on demand (~2,000
 *                 characters each, the target clause read in advance). How
 *                 much fits at once depends on "Memory for the local AI"
 *                 (local_memory.js). A document that fits is read in full.
 *   cloud model   the whole document, when it fits the model's context
 *                 window with headroom, as a stable prefix the provider can
 *                 cache (follow-up questions then do not pay full price for
 *                 it again). Beyond the window: the structured approach
 *                 (document map + parts, sections on demand).
 *
 * Headroom ("fits") follows the DeepSeek harness's compaction trigger
 * (deepseek-ai/deepseek-harness, routed-model context policy): a prompt may
 * use at most min(80% of the window, window − output reserve − 64K tokens),
 * the 64K shrinking to a quarter of the window for small windows.
 *
 *   forModel({ tokens, role, matterId, outputTokens }) →
 *     { kind: 'local'|'cloud', mode: 'full'|'parts', ctx, limit, tokens,
 *       partChars, cache, provider, label }
 *   explain(strategy, { name, pages, lang }) → one plain sentence
 */

const OUTPUT_RESERVE = 4000
const PROMPT_RESERVE = 3200

/** The most prompt tokens (document + instructions) a window of `ctx` tokens may carry. */
function fitLimit(ctx, outputTokens = OUTPUT_RESERVE) {
  const headroom = Math.min(65536, Math.floor(ctx * 0.25))
  return Math.max(0, Math.floor(Math.min(ctx * 0.8, ctx - outputTokens - headroom)))
}

/** The model a call for `role` would use first, with its context window. */
function target({ role = 'analyze', matterId = null } = {}) {
  try {
    const p = require('./routing').primary({ role, matterId })
    const local = p.kind === 'local'
    const profile = require('./models').profileFor({ kind: local ? 'local' : 'hosted', model: p.model })
    const ctx = local ? Math.min(require('./local_memory').effectiveCtx(), profile.ctx || Infinity) : (p.ctx || profile.ctx || 32768)
    return { kind: local ? 'local' : 'cloud', ctx, provider: p.id || (local ? 'local' : 'cloud'), label: local ? 'this computer' : (p.label || p.id), model: p.model || null, region: p.region || null }
  } catch {
    return { kind: 'local', ctx: 8192, provider: 'local', label: 'this computer', model: null, region: null }
  }
}

function forModel({ tokens = 0, role = 'analyze', matterId = null, outputTokens = OUTPUT_RESERVE, t = null } = {}) {
  const tg = t || target({ role, matterId })
  const limit = fitLimit(tg.ctx, outputTokens)
  // Local: the chat's rule (agent.js fullTextMaxChars) — the plan call's budget.
  const fits = tg.kind === 'local'
    ? tokens * 3.8 <= Math.max(12000, (tg.ctx * 0.85 - 3200) * 4)
    : tokens + PROMPT_RESERVE <= limit
  // Parts sized so the reply still fits (2,500–12,000 characters, as before);
  // a cloud model beyond its window gets big parts (half the usable window).
  const small = Math.max(2500, Math.min(12000, (tg.ctx - 3500) * 3))
  const partChars = tg.kind === 'local' ? small : Math.max(small, Math.floor((limit - PROMPT_RESERVE) * 0.5 * 3.5))
  return {
    kind: tg.kind,
    mode: fits ? 'full' : 'parts',
    ctx: tg.ctx,
    limit,
    tokens,
    partChars,
    // Prompt caching pays off for a cloud model reading a long document in full.
    cache: tg.kind === 'cloud' && fits && tokens >= 1024,
    provider: tg.provider,
    label: tg.label,
    model: tg.model,
    region: tg.region,
  }
}

const SERVICE = (s) => (s.kind === 'local' ? 'the AI on this computer' : `${s.label}${s.region ? ` (${/^eu/i.test(s.region) ? 'EU' : s.region})` : ''}`)

/** One sentence for the lawyer: how this document will be read and why. */
function explain(s, { name = 'The document', pages = null, lang = 'en' } = {}) {
  const de = /^de/i.test(lang)
  const size = pages ? (de ? ` (${pages} Seiten)` : ` (${pages} page${pages === 1 ? '' : 's'})`) : ''
  if (s.mode === 'full') {
    if (de) return `${name}${size} wird von ${s.kind === 'local' ? 'der KI auf diesem Computer' : s.label} vollständig gelesen.${s.cache ? ' Folgefragen nutzen den Zwischenspeicher des Anbieters und kosten weniger.' : ''}`
    return `${name}${size} is read in full by ${SERVICE(s)}.${s.cache ? ' Follow-up questions reuse the provider\'s cache, so they cost less.' : ''}`
  }
  if (s.kind === 'local') {
    if (de) return `${name}${size} ist länger, als der Speicher der lokalen KI auf einmal fasst: OpenLex liest es anhand der Gliederung Teil für Teil. Mehr Speicher (Einstellungen → Speicher für die lokale KI) lässt mehr auf einmal lesen.`
    return `${name}${size} is longer than the local AI's memory holds at once, so OpenLex reads it part by part from its outline. More memory (Settings → Memory for the local AI) lets it read more at once.`
  }
  if (de) return `${name}${size} ist länger als das, was ${s.label} auf einmal lesen kann: OpenLex liest es anhand der Gliederung in großen Teilen.`
  return `${name}${size} is longer than ${SERVICE(s)} can read at once, so OpenLex reads it in large parts, guided by its outline.`
}

module.exports = { forModel, explain, fitLimit, target, OUTPUT_RESERVE, PROMPT_RESERVE }
