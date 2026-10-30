"use strict"
/**
 * Bounded agent loop (spec §3.3): PLAN → TOOL HOPS (≤3) → WRITE → JUDGE.
 * Working context budget 8K tokens. Every LLM call temp 0.
 *
 * The loop is deliberately simple — no free-form agentic looping. Each
 * user action costs at most 5 local LLM calls (plan, ≤3 hops, write) plus
 * 1 judge call. The tools' outputs are compressed before entering context.
 */

const { chat, chatWithReasoning } = require('./llm')
const { dispatch, resolveSection } = require('./tools')
const { compressToolOutput } = require('./compression')
const { estimateTokens } = require('./compress')
const { judgeSuggestions } = require('./judge')
const { AGENT } = require('./config')
const { effectiveAgent } = require('./agent-config')
const maxHops = () => effectiveAgent().MAX_HOPS
const KNOWN_TOOLS = new Set(Object.keys(require('./tools').TOOLS))

/**
 * Retry output budget that FITS the context window. Doubling maxTokens
 * blindly (WRITE_MAX_TOKENS * 2) overflowed num_ctx once the full doc is
 * in system + tool history → llama truncated the PROMPT → the retry
 * truncated too → the retry loop the field kept hitting. Cap the retry
 * output to what the context can actually hold after the messages.
 */
function retryTokensFor(messages) {
  const budget = effectiveAgent().CTX_BUDGET_TOKENS
  const used = (messages || []).reduce((sum, m) => sum + estimateTokens(m.content || ''), 0)
  return Math.max(2000, Math.min(AGENT.WRITE_MAX_TOKENS * 2, Math.floor((budget - used * 1.25) * 0.95)))
}
// Lotus was fine-tuned with its own tool names (search_legal_database …)
// and occasionally generalizes near-misses (search_legal_provisions).
// Map them onto our tool surface instead of failing the call.
const TOOL_ALIASES = {
  search_legal_database: 'search_law',
  search_legal_provisions: 'search_law',
  search_firm_docs: 'search_firm_library',
  search_precedents: 'search_firm_library',
  get_document_section: 'get_range_text',
  read_law_section: 'get_law_section',
  get_clause_by_section: 'get_clause_analysis',
  get_clause: 'get_clause_analysis',
  analyze_clause: 'get_clause_analysis',
}

// The system prompt is assembled per call from the prompt roadmap
// (src/prompts.js): stable blocks first, turn-specific ones only when the
// turn needs them. docs/PROMPTS.md has the table.
const prompts = require('./prompts')

/** The planning model's profile (models.js): extra instructions, and whether it gets every prompt block at once. */
function planProfile() {
  try {
    const p = require('./routing').primary({ role: 'plan', matterId: require('./policy').currentMatter() })
    return require('./models').profileFor({ kind: p.kind, model: p.model })
  } catch { return {} }
}

const TYPES = new Set(['rephrase', 'flag-favoring', 'legal-risk', 'alternative', 'compliance'])
const SEVERITIES = new Set(['high', 'medium', 'low'])

/** Combined doc context: heading map + glossary + cross-action memory.
 * Small documents are injected in FULL so the model actually reads the
 * contract instead of hop-gathering it; larger docs keep the map and hop
 * via get_range_text. The threshold is BUDGET-AWARE: the full text must
 * fit the PLAN call's budget (the only call with a small output reserve) —
 * a doc that fits there can be injected; anything bigger hops. The WRITE
 * call NEVER carries the full doc (it has PRE-READ + tool history; the
 * write's 6000-token output reserve + the doc overflowed num_ctx and
 * llama truncated the PROMPT mid-JSON — the "writing… (truncated —
 * retrying)" loop, 2026-08-16).
 */
// A long document read in full is the stable prefix a hosted provider can
// cache (providers/common.js); everything that changes per turn (memory,
// the conversation) comes after the mark.
const { CACHE_MARK } = require('./providers/common')
const FULL_TEXT_MIN_CHARS = 12000
function fullTextMaxChars() {
  const eff = effectiveAgent()
  const ctx = eff.CTX_BUDGET_TOKENS
  // Hosted models: the whole document whenever it fits the window with
  // headroom (strategy.js, the DeepSeek-harness rule), as a cached prefix.
  if (eff.PROVIDER !== 'local') return Math.max(FULL_TEXT_MIN_CHARS, Math.floor((require('./strategy').fitLimit(ctx, AGENT.WRITE_MAX_TOKENS) - 3200) * 3.8))
  return Math.max(FULL_TEXT_MIN_CHARS, Math.floor((ctx * 0.85 - 3200) * 4))
}
function docCtx(ctx, phase) {
  const base = ctx.doc.summary()
  const mem = memorySummary(ctx.memory)
  const text = String(ctx.doc.text || '')
  const full = phase !== 'writing' && text.length <= fullTextMaxChars() ? `\nFULL DOCUMENT TEXT:\n${ctx.doc.text}` : ''
  const mark = full && text.length >= 4000 ? CACHE_MARK : ''
  // The document is data, not instructions (prompt injection, untrusted.js):
  // its map and text sit in a marked block the model is told to treat as such.
  const doc = text.trim() ? untrusted.wrap(`${base}${full}`, docLabel(ctx)) : `${base}${full}`
  // Conversation memory (Batch 1): the rolling per-doc history rides in
  // the system prompt as a CONVERSATION block — droppable-FIRST under
  // compaction (truncateSummary discards USER:/ASSISTANT: lines before
  // anything else; it's context, not correctness).
  const conv = ctx.session ? ctx.session.contextBlock() : ''
  return `${doc}${mark}${mem ? '\n' + mem : ''}${conv}`
}
const untrusted = require('./untrusted')
// Document names are internal ids (Word, app, panels): the block just says "document".
const docLabel = () => 'document'

/**
 * Cross-action memory injection (plan §6): top facts + suggestion ledger
 * status from DocMemory, appended to the doc context (~100 tok). The model
 * gets prior-action handoff without needing to call `recall`.
 */
function memorySummary(memory) {
  if (!memory) return ''
  const parts = []
  try {
    const facts = memory.recall('')
    if (facts.length) {
      parts.push('PREVIOUS: ' + facts.slice(0, 3).map((f) => `${f.entity}: ${String(f.claim).slice(0, 80)}`).join('; '))
    }
    const ledger = memory.ledger ? memory.ledger().slice(0, 2) : []
    if (ledger.length) {
      parts.push(`LEDGER: ${ledger.map((s) => `${s.type}:${s.status}`).join(', ')}`)
    }
  } catch { /* memory unavailable — no injection */ }
  return parts.join('\n')
}

// ── Pre-read pass (edit/rewrite asks) ──────────────────────────────────────
// Scripted context sweep BEFORE the plan call: the document map + the
// target clause (by heading/name) + one neighbor section each side,
// injected VERBATIM into the system prompt. System content survives the
// compaction ladder (only tool hops get digested/rolled off), so the full
// clause is guaranteed in context for plan AND write — zero LLM cost, no
// hop budget spent re-fetching it. Only kicks in when the document was
// NOT fully injected (bigger than FULL_TEXT_MAX_CHARS).
const EDIT_INTENT_RE = /rewrite|re-write|rephrase|modify|change|edit|favor|favou|rebalan|improv|strengthen|weaken|limit (the )?(liab|indemnif)|terminat(e|ion)|add a clause|draft a clause/i
const CLAUSE_NAME_RE = /(?:the\s+)?["']?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\- ]{2,60}?)["']?\s+clause|clause\s+["']?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\- ]{2,60}?)["']?/i

function prereadBlock(ctx, userMessage) {
  if (!EDIT_INTENT_RE.test(String(userMessage || ''))) return { block: '', indices: [] }
  const parts = []
  const readIndices = []
  const map = ctx.doc.map()
  parts.push('DOCUMENT MAP:\n' + map.sections.map((s) => `${s.index}:${s.heading || '(untitled)'}`).join('\n'))
  let target = null
  const m = String(userMessage || '').match(CLAUSE_NAME_RE)
  const name = (m && (m[1] || m[2])) || null
  if (name) target = resolveSection(ctx.doc, { heading: name })
  if (!target) {
    const words = String(userMessage || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3)
    const byHeading = map.sections.find((s) => s.heading && words.some((w) => s.heading.toLowerCase().includes(w)))
    if (byHeading) target = ctx.doc.section(byHeading.index)
  }
  if (!target) {
    // Selection-aware targeting (Batch 1.2): the pane quotes the user's
    // selection — find the section containing it verbatim.
    const quoted = String(userMessage || '').match(/"([^"]{40,600})"/)
    if (quoted) {
      const norm = (t) => String(t || '').replace(/\s+/g, ' ')
      const sel = norm(quoted[1])
      const byBody = ctx.doc.sections.find((s) => norm(s.text).includes(sel))
      if (byBody) target = byBody
    }
  }
  if (target) {
    for (const i of [target.index - 1, target.index, target.index + 1]) {
      if (i < 0 || i >= ctx.doc.sections.length) continue
      const s = ctx.doc.section(i)
      readIndices.push(s.index)
      const first = String(s.text.split('\n')[0] || '').slice(0, 60)
      parts.push(`PRE-READ SECTION ${s.index}${first ? ' — ' + first : ''}:\n${String(s.text).slice(0, 2200)}`)
    }
  }
  if (parts.length <= 1) return { block: '', indices: [] }
  return { block: '\n\nPRE-READ SECTIONS (verbatim — use these, do not re-fetch them):\n' + untrusted.wrap(parts.join('\n\n'), docLabel(ctx)), indices: readIndices }
}

/**
 * Normalize a model-produced suggestion into the canonical shape
 * (spec §5.1) so the Judge has a consistent schema to verify. Fills
 * missing fields from what the model did provide; never invents law.
 */
function normalizeSuggestion(raw, i) {
  const s = raw || {}
  const parts = [s.party && `favors ${s.party}`, s.statute && `per ${s.statute}`, s.reason || s.note].filter(Boolean)
  return {
    id: s.id || `s-${Date.now().toString(36)}-${i}`,
    // Empty/whitespace anchor text from the model is a MISSING anchor —
    // keep it null so the backfill fills a real one (empty anchors caused
    // empty ORIGINAL diffs + a silent no-op Apply, 2026-08-15 incident).
    anchor: (() => {
      const a = s.anchor || (s.anchor_text ? { text: s.anchor_text } : null)
      return a && String(a.text || '').trim() ? a : null
    })(),
    type: TYPES.has(s.type) ? s.type : 'flag-favoring',
    severity: SEVERITIES.has(s.severity) ? s.severity : 'medium',
    // Summary fallback: "suggestion N" placeholders leaked into the summary
    // line + autopilot lines when the model omitted summary fields (BILLA
    // log 2026-08-24). Derive from type/parts, else the proposal's first
    // words — anything beats "suggestion 1".
    summary: (() => {
      const explicit = s.summary || s.summary_text
      if (explicit && String(explicit).trim()) return String(explicit).slice(0, 300)
      const typed = [s.type && String(s.type), s.clause && String(s.clause), ...parts].filter(Boolean).join(' — ')
      if (typed) return typed.slice(0, 300)
      const t = String(s.proposed_text || s.replacement || (s.anchor && s.anchor.text) || '').replace(/\s+/g, ' ').trim()
      if (t) return t.length > 80 ? t.slice(0, 80) + '…' : t
      return `suggestion ${i + 1}`
    })(),
    // NO-OP "rewrites" must never become proposed_text — a clarification
    // ("N/A", "please specify the clause") auto-applied REPLACES the real
    // clause with garbage (2026-08-15 incident: the FM clause was
    // overwritten with "N/A - need clarification"). Short or clarification
    // text → null → the suggestion is flag-only, no Apply, no auto-apply.
    proposed_text: (() => {
      const t = String(s.proposed_text || s.replacement || '').trim()
      if (!t || t.length < 20) return null
      if (NOOP_REWRITE_RE.test(t)) return null
      return t
    })(),
    basis: s.basis || (s.source || s.section || s.chunk_id ? {
      source: s.source || s.statute,
      section: s.section,
      chunk_id: s.chunk_id,
    } : null),
  }
}

// Clarification/no-op text masquerading as a rewrite — never applyable.
const NOOP_REWRITE_RE = /^(n\/?a|n\/?a\.|please specify|please provide|need clarification|i need more|not enough (information|context)|no change|no rewrite|no changes needed|not applicable|no modification|unchanged|as is|none|nothing|unable to rewrite)/i

/**
 * Bounded LLM call with short thinking. PLAN + tool hops + WRITE benefit
 * from a brief reasoning step (context retention, better hopping) —
 * bounded via reasoning_control so a hop stays ~160 tokens of thought,
 * never the model's natural 32K-token monologue. Judge stays thinking-free.
 */
/**
 * Reasoning shown to the user — UNCAPPED except for a generous safety
 * ceiling (the thinking budget already bounds real reasoning via the
 * llama.cpp control endpoint; this only guards against a runaway stream).
 */
function showReasoning(r) {
  const t = (r || '').trim()
  return t.length > 2000 ? t.slice(0, 2000) + '…' : t
}

/** One-line summary of what was proposed, replaces the old boilerplate. */
function suggestionsSummary(list) {
  if (!list.length) return ''
  const top = list.slice(0, 5).map((s) => s.summary || 'change').join(', ')
  const extra = list.length > 5 ? ` +${list.length - 5} more` : ''
  return `Proposed ${list.length} change${list.length === 1 ? '' : 's'}: ${top}${extra} — review & Apply below.`
}

/** Injected context lines the model sometimes echoes verbatim into its
 * answer (they end up on the user's screen as "Tool results obtained…").
 * Strip them from the final text. */
const INJECTED_ECHOES = [
  'Tool results obtained. Now write the final answer.',
  'This is all the analysis you will get.',
  'Continue',
]
// Whitespace-flexible echo patterns — the model regurgitates fine-tune-time
// prompt templates with arbitrary line breaks inside (field log 2026-08-24:
// "You are a legal document\n\nreasoner.\n\nAnalyze\n\n…Return your analysis as
// JSON"). Spans are bounded by the stream echo guard (512) so a match is
// always fully catchable before its first char is emitted.
const ECHO_RES = [
  /You\s+are\s+a\s+legal\s+document\s+reasoner[\s\S]{0,400}?Return\s+your\s+analysis\s+as\s+JSON\.?/gi,
  /Tool\s+results\s+obtained[\s\S]{0,120}?final\s+answer\.?/gi,
]
function stripEchoes(text) {
  let out = String(text || '')
  for (const phrase of INJECTED_ECHOES) {
    out = out.split(phrase).join('')
  }
  for (const re of ECHO_RES) {
    out = out.replace(re, '')
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Backfilled suggestion anchor, capped to a word boundary — a raw slice
 * can cut a word in half ("…circumstances be" + "yond the reasonable…"),
 * and the pane then replaces only the fragment, corrupting the document.
 * Prefer a sentence end (punctuation + space) within the cap, then any
 * word boundary; only if neither exists inside a sane minimum does it
 * hard-slice.
 */
function anchorSnippet(text, max = 160) {
  const t = String(text || '').trim().replace(/\s+/g, ' ')
  if (!t || t.length <= max) return t
  const limit = Math.min(max, t.length - 1)
  for (let i = limit; i >= 0; i--) {
    if (t[i] === ' ' && /[.!?;:]/.test(t[i - 1] || '')) return t.slice(0, i)
  }
  const lastSpace = t.lastIndexOf(' ', limit)
  if (lastSpace >= 30) return t.slice(0, lastSpace)
  return t.slice(0, max)
}

async function thinkChat(messages, opts = {}) {
  const { logTurn, estMessages } = require('./turndump')
  const reasoning = []
  const t0 = Date.now()
  const est = estMessages(messages)
  const compacted = []
  const onCompacted = (actions) => {
    if (actions) for (const a of actions) compacted.push(a)
    opts.onCompacted?.(actions)
    opts.emit?.('compact', { actions: actions || [], phase: opts.phase || 'working' })
  }
  const dump = (stop, err, res) => logTurn({
    phase: opts.phase, estTokens: est, compacted: [...new Set(compacted)],
    latencyMs: Date.now() - t0,
    reasoningChars: reasoning.join('').length,
    contentChars: res ? (res.content || '').length : 0,
    stop, err: err ? String(err.message || err) : '',
  })
  try {
    const res = await chatWithReasoning(messages, {
      ...opts,
      onReasoning: (piece) => {
        reasoning.push(piece)
        // Stream reasoning to pane in real-time (not just at the end).
        // Keep the raw piece: trimming individual tokens turns "The user"
        // into "Theuser" on the client. The pane appends streaming pieces
        // into one live line and trims only the settled full thought.
        opts.emit?.('reasoning', { text: String(piece || ''), streaming: true })
      },
      onContent: (t) => opts.onContent?.(t),
      signal: opts.signal,
      onCompacted,
    })
    dump('done', null, res)
    return { content: res.content, reasoning: reasoning.join('') }
  } catch (err) {
    // Runaway thinking on servers without --reasoning-budget (old llama
    // builds) — the work must still get done: retry the SAME call with
    // thinking disabled instead of dying mid-run (2026-08-15 incident:
    // 21-98s monologues → truncated JSON → aborted stream).
    if (err && err.code === 'THINK_OVERFLOW') {
      onCompacted(['thinking capped — continuing without reasoning'])
      try {
        const res = await chatWithReasoning(messages, {
          ...opts,
          thinking: false,
          signal: opts.signal,
          onReasoning: () => {},
          onContent: (t) => opts.onContent?.(t),
          onCompacted,
        })
        dump('overflow', null, res)
        return { content: res.content, reasoning: reasoning.join('') }
      } catch (err2) {
        dump('error', err2, null)
        throw err2
      }
    }
    dump('error', err, null)
    throw err
  }
}

/**
 * Run one user action. `ctx` carries doc, memory, search, embeddings, judge.
 * Returns { text, suggestions, log }.
 */
async function runAction(ctx, userMessage, onEvent, opts = {}) {
  const log = []
  // Every step carries `plain` (a sentence for the lawyer) and `online` (explain.js).
  const emit = (type, data) => { const e = { type, ...data }; if (type === 'step') require('./explain').withPlain(e); log.push(e); onEvent?.(e) }
  const suggestions = [] // hoisted — stopEarly() references it
  // Stop support (Batch 1.3): the pane can abort mid-run; we check between
  // phases and stop cleanly, keeping whatever arrived.
  const aborted = () => !!(opts.signal && opts.signal.aborted)
  const stopEarly = () => {
    emit('done', { stopped: true })
    return { text: '⏹ Stopped — partial results kept.', suggestions, log, streamed: false, stopped: true }
  }

  // opts.prose: the answer is prose only (a panel's turn, panel.js) — never suggestion cards.
  const wantsSuggestions = !opts.prose && /suggest|analy|risk|favor|favou|flag/i.test(userMessage)
  const wantsRewrite = !opts.prose && EDIT_INTENT_RE.test(userMessage) // deliverable = suggestion card
  // Token streaming: prose answers stream to the pane as they generate —
  // BATCHED: deltas accumulate and flush every ~150ms / ≥80 chars, so the
  // pane gets a handful of text events instead of one per token (the
  // "100 messages of tokens" complaint, 2026-08-16). JSON tool calls are
  // buffered (they become suggestion cards, never raw text). streamed=true
  // makes server.js skip its final full-text event.
  let streamed = false
  let streamOpen = false
  let streamDecided = false // first significant char seen → one-time verdict
  let streamBuf = ''
  let streamTimer = null
  // Echo guard: stripEchoes only covered non-streamed finalText — the model
  // regurgitated injected prompt text INTO the live stream (field log
  // 2026-08-24). Strip per flush and hold back a tail window: any echo
  // phrase/pattern shorter than the guard is guaranteed fully catchable
  // before its first char is ever emitted.
  const ECHO_GUARD = 512
  const flushStream = () => {
    if (!streamBuf) return
    let out = streamBuf
    for (const phrase of INJECTED_ECHOES) out = out.split(phrase).join('')
    for (const re of ECHO_RES) out = out.replace(re, '')
    if (out.length <= ECHO_GUARD) { streamBuf = out; return }
    const cut = out.length - ECHO_GUARD
    emit('text', { text: out.slice(0, cut) })
    streamBuf = out.slice(cut)
  }
  const endStream = () => {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null }
    if (!streamBuf) return
    const out = stripEchoes(streamBuf)
    streamBuf = ''
    if (out) emit('text', { text: out })
  }
  const onContent = (t) => {
    const s = String(t || '')
    if (!s) return
    if (streamOpen) {
      streamBuf += s
      if (streamBuf.length >= 80) flushStream()
      return
    }
    if (streamDecided) return // verdict was '{' → tool call → buffered forever
    // Wait for the first SIGNIFICANT character before deciding: a leading
    // newline/space chunk used to open the stream, leaking tool-call JSON
    // into the chat as raw text (2026-08-16 incident). '{' → tool call →
    // buffered (becomes suggestion cards, never text). One-time decision:
    // the '{' and the rest of the JSON arrive in SEPARATE chunks.
    const sig = s.trimStart()
    if (!sig) return
    streamDecided = true
    if (!sig.startsWith('{')) {
      streamOpen = true
      streamed = true
      streamBuf = s
      streamTimer = setInterval(flushStream, 150)
    }
  }

  if (aborted()) return stopEarly()

  // Pre-read pass: edit/rewrite asks on big docs get the map + target
  // clause + neighbors injected verbatim into the SYSTEM prompt BEFORE
  // the plan call — system content survives compaction, so the full
  // clause is guaranteed in context for plan AND write (zero LLM cost,
  // no hop budget spent re-fetching). Small docs already carry the full
  // text — pre-read would be redundant.
  const pre = String(ctx.doc?.text || '').length <= fullTextMaxChars() ? { block: '', indices: [] } : prereadBlock(ctx, userMessage)
  // Active firm skill (Phase 7.2): its instructions ride in the system
  // prompt (survives compaction); an optional tool allow-list narrows
  // what the agent may call while the skill runs.
  // Agent profile (agents.js): its instructions and tool allow-list combine with the skill's.
  const skillBlock = require('./agents').promptBlock(opts.agent) + (opts.skill ? require('./skills').promptBlock(opts.skill) : '')
  const skillTools = require('./agents').allowedTools(opts.agent, opts.skill)
  const profile = planProfile()
  const intents = prompts.intentsOf(userMessage)
  const unlocked = new Set() // tools the model loaded with get_tool_schemas this run
  const staging = () => prompts.stageTools({ intents, unlocked, allowed: skillTools, staged: profile.prompts !== 'all' })
  const mcpNames = () => { try { return require('./mcp/client').allTools().map((t) => t.qualified) } catch { return [] } }
  // The lawyer's answer language (Settings → AI): 'auto' | 'de' | 'en'. A `lang` sent with the chat request is ignored.
  const answerLang = (() => { try { return require('./agent-config').load().answerLang } catch { return 'auto' } })()
  // What this run has read from outside (prompt injection, untrusted.js): the
  // open document from the start, then every outside tool result. Outbound
  // and risky tools ask the lawyer once something was read.
  const turn = new untrusted.Turn({
    message: userMessage,
    conversation: (() => { try { return (ctx.session?.load?.() || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n') } catch { return '' } })(),
    matterId: require('./policy').currentMatter(),
    document: ctx.doc,
  })
  const sysCtx = (phase, afterTool = null) => prompts.build({
    phase, message: userMessage, intents, afterTool,
    docFull: phase !== 'writing' && String(ctx.doc?.text || '').length <= fullTextMaxChars(),
    all: profile.prompts === 'all',
    model: profile.instructions || '',
    profile: skillBlock.trim(),
    toolIndex: phase === 'writing' ? '' : prompts.toolIndex({ ...staging(), mcp: profile.prompts === 'all' ? [] : mcpNames() }),
    context: docCtx(ctx, phase) + pre.block,
    answerLang,
  }).text
  // Hosted models get native definitions for the offered tools only.
  const toolNames = () => staging().offered

  // 1. PLAN — a single LLM call that decides the tool path (or answers directly)
  const planRes = await thinkChat([
    { role: 'system', content: sysCtx('planning') },
    { role: 'user', content: userMessage },
  ], { maxTokens: 1200, phase: 'planning', signal: opts.signal, emit, toolNames: toolNames() })  // 600 was starved once thinking grew (shared max_tokens)
  if (aborted()) return stopEarly()
  if (planRes.reasoning.trim()) emit('reasoning', { text: showReasoning(planRes.reasoning), plan: true })
  // Visible plan card removed (0.1.65) — the plan line duplicated the
  // reasoning card's first line; the reasoning event alone is enough.
  const plan = planRes.content

  let hops = 0
  let suppressed = 0 // re-fetch attempts on already-in-context sections
  let finalText = null
  let finalRetried = false
  let writeRetried = false
  let steerRetried = false
  let suggestionsAreFinal = false // summary is the deliverable, not prose
  const readSections = [] // clause sections the model read (anchor backfill)
  const lawUsed = [] // laws pulled from the local packs (pane surfacing)
  const evidence = [] // what the sources said (tool outputs), for the second pass and a panel's checks
  const toolHistory = [] // compressed hop results — caps context growth
  const analysisSummary = [] // running findings across hops (compact)
  const toolCache = new Map() // tool:args → output (breaks analysis loops)

  // Compression is handled by compression.js — tooltrim-style structured
  // extraction at the boundary. The model can call compress_context to
  // compress further, and delegate_task to work in fresh contexts.

  // 2. TOOL HOP(S) — up to MAX_HOPS, each taking the model's JSON tool call
  let cursor = plan
  let totalIterations = 0 // hard cap — cache hits don't increment hops, so the
  // model can loop forever requesting the same tool. After 6 iterations we
  // inject a rethink nudge; after 10 we force the write phase.
  const MAX_ITERATIONS = Math.max(10, maxHops() + 4)
  const RETHINK_AFTER = Math.max(6, maxHops())
  // Wall-clock cap: even if the model is generating useful work, 90s of
  // hopping is enough for any analysis. Prevents the 3+ minute hangs seen
  // in the field when thinking chains are long (field log 2026-08-24).
  const HOP_TIMEOUT_MS = effectiveAgent().HOP_TIMEOUT_MS || 90000
  const hopStart = Date.now()
  while (hops < maxHops() && totalIterations < MAX_ITERATIONS) {
    totalIterations++
    if (Date.now() - hopStart > HOP_TIMEOUT_MS) {
      emit('step', { text: 'analysis time limit reached — writing answer', kind: 'timeout' })
      break
    }
    const call = parseToolCall(cursor)
    if (!call) {
      // Prose — but the model may have embedded a tool call inside it
      // (Lotus wraps JSON in reasoning text occasionally). Extract it.
      const embedded = extractToolCall(cursor)
      if (embedded) {
        cursor = embedded.raw
        continue
      }
      // Unparseable JSON starting with { is almost always a truncation
      // (max_tokens cut mid-object). Retry once with a bigger budget —
      // a truncated tool call must never become the user-facing answer.
      if (/^\s*\{/.test(cursor) && !finalRetried) {
        console.warn('[agent] truncated reply:', cursor.length, 'chars:', JSON.stringify(String(cursor).slice(0, 300)))
        emit('step', { text: 'writing… (truncated — retrying)', kind: 'retry' })
        finalRetried = true
        // Full conversation, not just the last result: the model needs the
        // whole tool trail to resume a multi-hop analysis. User role keeps
        // the model from echoing prior assistant lines as its own output.
        const retryMsgs = [
          { role: 'system', content: sysCtx('planning') },
          { role: 'user', content: userMessage },
          ...toolHistory,
        ]
        retryMsgs.push({ role: 'user', content: 'Your previous reply was cut off and lost. Emit the complete tool call JSON now. JSON only, no prose.' })
        // thinking:false — resume is bookkeeping, and a shorter generation
        // is more likely to complete on the unstable RDNA1 Vulkan backend
        // (box quirk: complex generations get cut mid-string ~400 tokens).
        const retry = await thinkChat(retryMsgs, { maxTokens: retryTokensFor(retryMsgs), phase: 'planning', thinking: false, emit })
        if (retry.reasoning.trim()) emit('reasoning', { text: showReasoning(retry.reasoning), retry: true })
        cursor = retry.content
        continue
      }
      // A prose plan answer on a REWRITE ask is not a deliverable — the
      // user needs the suggestion card (Apply / tracked change). Defer to
      // the write phase, which then requires propose_suggestions.
      if (wantsRewrite) {
        finalText = null
        break
      }
      finalText = stripEchoes(cursor)
      break
    }
    if (call.tool === 'propose_suggestions') {
      for (const s of call.args.suggestions || []) suggestions.push(normalizeSuggestion(s, suggestions.length))
      suggestionsAreFinal = true
      break
    }
    // Alias fine-tune-era tool names onto the live tool surface.
    const toolName = TOOL_ALIASES[call.tool] || call.tool
    if (toolName === 'get_tool_schemas') for (const n of [].concat(call.args?.names || call.args?.name || call.args?.tool || [])) unlocked.add(String(n))
    if ((!KNOWN_TOOLS.has(toolName) && !require('./mcp/client').hasTool(toolName)) || (skillTools && !skillTools.has(toolName))) {
      // Unknown tool: NEVER surface raw JSON as the answer. Steer once
      // with the valid tool list, then hand over to the write phase.
      console.warn('[agent] unknown tool response:', String(cursor).slice(0, 120))
      if (!steerRetried) {
        steerRetried = true
        emit('step', { text: `retrying… ("${call.tool}" not available)`, kind: 'retry' })
        const steer = await thinkChat([
          { role: 'system', content: sysCtx('analyzing') },
          { role: 'user', content: userMessage },
          ...toolHistory,
          { role: 'user', content: `"${call.tool}" is not an available tool${skillTools ? ' for this agent profile or skill' : ''}. Available: ${[...(skillTools || KNOWN_TOOLS)].join(', ')}. To write or apply changes, use propose_suggestions with the full replacement text in proposed_text — there is no separate write tool. Emit a valid tool call or answer in plain text.` },
        ], { maxTokens: AGENT.WRITE_MAX_TOKENS, phase: 'analyzing', thinking: false, emit })
        if (steer.reasoning.trim()) emit('reasoning', { text: showReasoning(steer.reasoning), steer: true })
        cursor = steer.content
        continue
      }
      finalText = null
      break
    }
    if (aborted()) return stopEarly()
    // Front ends explain the step in plain words from tool + detail
    // (search words, jurisdiction, clause, web host — never content).
    let stepSection = null
    if (toolName === 'get_range_text' || toolName === 'get_clause_analysis') { try { stepSection = ctx.doc ? resolveSection(ctx.doc, call.args || {}) : null } catch { stepSection = null } }
    const stepDetail = require('./activity').toolDetail(toolName, call.args || {}, stepSection)
    emit('step', { text: `tool: ${toolName}`, kind: 'tool', tool: toolName, detail: stepDetail })
    if (call.reasoning) emit('reasoning', { text: showReasoning(call.reasoning), tool: call.tool })
    require('./turndump').logTool(toolName, call.args || {})
    let suppress = false
    if (toolName === 'get_range_text' || toolName === 'get_clause_analysis') {
      // Remember which clause the model read — used to anchor suggestions
      // the model forgot to anchor, and to ground the judge's passage.
      const section = resolveSection(ctx.doc, call.args || {})
      if (section) {
        readSections.push(section)
        // The section is ALREADY verbatim in context (full-doc injection
        // or the PRE-READ pass) — re-fetching burns time + hops and the
        // model loops (2026-08-15: 3× get_range_text on the same clause).
        // get_range_text only: get_clause_analysis is served for real —
        // it's the deterministic structured table (parties/obligations/
        // favoring) the model legitimately wants on top of the verbatim
        // text; stubbing it made the model re-request in a loop.
        suppress = toolName === 'get_range_text' &&
                   (String(ctx.doc?.text || '').length <= fullTextMaxChars() ||
                    pre.indices.includes(section.index))
      }
    }
    // Cache tool outputs: the model often re-requests an analysis tool it
    // already ran (Lotus hops get repetitive under thinking). Serve the
    // cached result without burning a hop or an LLM call.
    const cacheKey = toolName + ':' + JSON.stringify(call.args || {})
    let output
    let r = null
    if (suppress) {
      output = 'That section is ALREADY in your context verbatim (full document text or PRE-READ SECTIONS). Do not re-fetch it — proceed with your analysis of it.'
      r = { output }
      suppressed++
      if (suppressed > 3) {
        // The model refuses to stop re-requesting — force the write phase.
        finalText = null
        break
      }
    } else if (toolCache.has(cacheKey)) {
      output = toolCache.get(cacheKey)
    } else {
      const hooks = require('./hooks')
      const gate = hooks.has('before_tool') ? await hooks.run('before_tool', { tool: toolName, args: call.args || {}, matterId: require('./policy').currentMatter() }) : { decision: 'allow' }
      // Permission gate (permissions.js): deny rules → allow rules →
      // defaults; "ask" waits for the lawyer's answer in the front end.
      const perm = gate.decision === 'deny' ? null : await require('./permissions').authorize({ tool: toolName, args: call.args || {}, matterId: require('./policy').currentMatter(), turn })
      if (gate.decision === 'deny') {
        r = { output: `BLOCKED by firm rule: ${gate.reason}. Do not retry this tool; continue with what you have or explain the limitation.` }
        emit('step', { text: `blocked: ${toolName}`, kind: 'blocked', tool: toolName, detail: stepDetail })
      } else if (!perm.allowed) {
        r = { output: perm.output }
        if (perm.by === 'sandbox') emit('step', { text: `outside: ${toolName}`, kind: 'outside', tool: toolName, detail: stepDetail })
        else emit('step', { text: `${['rule', 'non-interactive'].includes(perm.by) ? 'not allowed' : 'declined'}: ${toolName}`, kind: ['rule', 'non-interactive'].includes(perm.by) ? 'not_allowed' : 'declined', tool: toolName, detail: stepDetail })
      } else {
        try {
          r = await dispatch(ctx, toolName, call.args || {})
        } catch (err) {
          // A broken tool (no law packs, embeddings service down, network)
          // must not end the run: the model gets the error and carries on.
          console.warn(`[agent] tool ${toolName} failed:`, err.message)
          const why = /ECONNREFUSED|ENOTFOUND|fetch failed/.test(String(err.message)) ? 'the service it needs is not available on this machine' : String(err.message).slice(0, 200)
          r = { output: `ERROR: ${toolName} failed (${why}). Do not retry it; continue with the other tools or explain what could not be checked.` }
          emit('step', { text: `failed: ${toolName}`, kind: 'tool_failed', tool: toolName, detail: stepDetail, offline: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|timed? ?out/i.test(String(err.message)) })
        }
        if (hooks.has('after_tool')) hooks.run('after_tool', { tool: toolName, args: call.args || {}, ok: !/^ERROR|BLOCKED/.test(String(r.output || '')), chars: String(r.output || '').length, matterId: require('./policy').currentMatter() }).catch(() => {})
      }
      output = r.output
      if (perm?.allowed) turn.readTool(toolName, call.args || {}, output)
      // Handle delegate_task: spawn a fresh LLM call with focused context
      if (r.delegate) {
        emit('step', { text: `delegating: ${call.args.task?.slice(0, 60)}…`, kind: 'delegate' })
        try {
          const freshMessages = [
            { role: 'system', content: `You are a legal analyst. Complete this task:\n${call.args.task}\n\nReturn your findings as concise text. Include statute citations.` },
            { role: 'user', content: call.args.context || '' },
          ]
          const delegateResult = await chat(freshMessages, { maxTokens: 2000, temperature: 0 })
          const { text: delegated } = compressToolOutput('delegate_task', call.args, delegateResult.content || '')
          output = `[Delegated task result]: ${delegated}`
        } catch (err) {
          output = `[Delegation failed: ${err.message}]`
        }
      }
      // Handle compress_context: compress the current tool history
      if (r.compress) {
        const before = toolHistory.reduce((s, h) => s + h.content.length, 0)
        // Evict all but last 3 tool results
        const toolEntries = toolHistory.filter((h) => h.content.startsWith('Tool result'))
        const toEvict = toolEntries.slice(0, Math.max(0, toolEntries.length - 3))
        for (const evicted of toEvict) {
          const idx = toolHistory.indexOf(evicted)
          if (idx >= 0) {
            const tn = evicted.content.match(/Tool result \(([^)]+)\)/)?.[1] || 'unknown'
            toolHistory[idx] = { role: 'user', content: `[Evicted: ${tn} — findings preserved in analysis summary]` }
          }
        }
        const after = toolHistory.reduce((s, h) => s + h.content.length, 0)
        output = `[Compressed: ${before} → ${after} chars, evicted ${toEvict.length} tool results]`
      }
      toolCache.set(cacheKey, output)
    }
    // Streaming notes: the agent's `remember` calls become clickable
    // bookmarks in the pane (note events carry the section index).
    if (toolName === 'remember' && r?.note) emit('note', r.note)
    // Risk scorecard → dedicated card in the pane (Batch 5).
    if (toolName === 'risk_scorecard' && r?.scorecard) {
      emit('scorecard', { scorecard: r.scorecard, doc: ctx.doc?.name })
    }
    // Laws pulled from the database → surfacing card in the pane. The
    // model cites sources in prose; the pane shows the actual laws found
    // (source + section + snippet) so the lawyer can verify the basis.
    // A source's key: the front end shows a secure field (the key never enters the conversation).
    if (r?.keyRequest) emit('key_request', r.keyRequest)
    if (r?.lawSources?.length) {
      emit('law', { sources: r.lawSources, tool: call.tool })
      lawUsed.push(...r.lawSources)
    }
    if (EVIDENCE_TOOLS.has(toolName) && output && !/^(ERROR|BLOCKED|NO RESULTS|SEARCH ERROR)/.test(String(output))) {
      evidence.push({ tool: toolName, text: String(output).slice(0, 6000), sources: r?.lawSources || [] })
    }

    // Compress tool output at the boundary (tooltrim-style).
    // Deduplication: if the same tool+args was called before, note it.
    const { text: compressed } = compressToolOutput(toolName, call.args, output)
    const dedupKey = toolName + ':' + JSON.stringify(call.args || {})
    const isDup = toolHistory.some((h) => h.content.startsWith(`Tool result (${toolName}):`) && h._dedupKey === dedupKey)
    const entry = isDup
      ? { role: 'user', content: `Tool result (${toolName}): [same as previous call — no new findings]`, _dedupKey: dedupKey }
      : { role: 'user', content: `Tool result (${toolName}):\n${untrusted.forModel(toolName, compressed, call.args)}`, _dedupKey: dedupKey }
    toolHistory.push(entry)
    // Eviction: keep last 3 tool results, evict older ones (Pichay-style).
    // The model can re-request evicted results via expand() if needed.
    const toolEntries = toolHistory.filter((h) => h.content.startsWith('Tool result'))
    if (toolEntries.length > 3) {
      const toEvict = toolEntries.slice(0, toolEntries.length - 3)
      for (const evicted of toEvict) {
        const idx = toolHistory.indexOf(evicted)
        if (idx >= 0) {
          const toolName = evicted.content.match(/Tool result \(([^)]+)\)/)?.[1] || 'unknown'
          toolHistory[idx] = { role: 'user', content: `[Evicted: ${toolName} — findings preserved in analysis summary]` }
        }
      }
    }
    // Running analysis summary: accumulate findings for the write phase.
    // The model's `remember` calls store detailed facts; here we keep a
    // compact one-liner per tool call so the write phase has context
    // without the full tool output.
    if (toolName !== 'remember' && toolName !== 'recall') {
      const finding = `${toolName}: ${compressed.split('\n')[0].slice(0, 120)}`
      if (!analysisSummary.some((f) => f === finding)) analysisSummary.push(finding)
    }
    if (!suppress) hops++
    if (toolName === 'search_law' || toolName === 'get_law_section') {
      emit('step', { text: 'searching local law packs…', kind: 'law_search' })
    }
    let hop
    try {
      hop = await thinkChat([
        { role: 'system', content: sysCtx('analyzing', toolName) },
        { role: 'user', content: userMessage },
        { role: 'assistant', content: JSON.stringify(call) },
        { role: 'tool', content: untrusted.forModel(toolName, output, call.args) },
      ], { maxTokens: AGENT.WRITE_MAX_TOKENS, phase: 'analyzing', thinking: true, emit, toolNames: toolNames() })
    } catch (hopErr) {
      console.warn('[agent] hop LLM failed:', hopErr.message)
      emit('step', { text: 'LLM temporarily unavailable — writing with what we have', kind: 'model_unavailable' })
      break
    }
    if (hop.reasoning.trim()) emit('reasoning', { text: showReasoning(hop.reasoning), hop: true })
    cursor = hop.content
    // Rethink nudge: after RETHINK_AFTER iterations, inject a prompt that
    // tells the model to reconsider its approach. This breaks analysis
    // loops where the model keeps requesting the same tools with minor
    // variations. After MAX_ITERATIONS we force the write phase.
    if (totalIterations === RETHINK_AFTER) {
      emit('step', { text: 'rethinking approach…', kind: 'rethink' })
      toolHistory.push({ role: 'user', content: 'You have been iterating for a while. Pause: is your current approach yielding new information? If yes, continue with ONE more targeted step. If not, stop tool calls and emit your findings as {"tool": "propose_suggestions", "args": {"suggestions": [...]}} or answer in plain text.' })
    }
  }

  // 3. WRITE — if the loop ended in a tool result without final text, ask
  //    for the answer. When the model's final call WAS propose_suggestions,
  //    the suggestion cards ARE the deliverable (approve/reject/defer in
  //    the pane) — a follow-up write call only risks a second, conflicting
  //    suggestion set and burns 15-25s. The summary is built after the
  //    judge pass so its count reflects verified suggestions only.
  if (!finalText && !suggestionsAreFinal) {
    if (aborted()) return stopEarly()
    emit('step', { text: 'writing…', kind: 'writing' })
    const writeCtx = [
      { role: 'system', content: sysCtx('writing') },
      { role: 'user', content: userMessage },
      // Active context compression: for rewrite asks, use the compact
      // analysis summary instead of the full tool history. This frees
      // ~3-4K tokens for the suggestion JSON output. Non-rewrite queries
      // keep the full tool history since their output is shorter prose.
      ...(wantsRewrite && analysisSummary.length > 0
        ? [{ role: 'user', content: `ANALYSIS SUMMARY (${analysisSummary.length} findings):\n${analysisSummary.join('\n')}` }]
        : toolHistory),
      { role: 'assistant', content: 'Tool results obtained. Now write the final answer.' },
    ]
    if (wantsRewrite) {
      // Rewrite asks MUST land as a suggestion (Apply / tracked change).
      // Full-clause rewrites stay complete; partial edits use granular
      // anchors so untouched parts are never replaced (all-or-nothing was
      // destructive — 2026-08-16 feedback).
      writeCtx.push({ role: 'user', content: `This is a clause REWRITE request. You MUST emit {"tool": "propose_suggestions", "args": {"suggestions": [...]}}.

CRITICAL RULES FOR proposed_text:
- proposed_text is the NEW LEGAL TEXT that replaces the original clause. It must be a complete, enforceable contract provision — not a summary, not a description, not the user's request echoed back.
- proposed_text must be written in the SAME LANGUAGE as the original clause (e.g. if the clause is in German, write in German).
- proposed_text must preserve ALL operative provisions (parties, dates, deadlines, remedies, definitions) — only adjust what the user asked to change.
- NEVER put the user's prompt or your analysis into proposed_text. proposed_text = what the rewritten clause SAYS, not what you think about it.
- Example: if the original says "Der Lieferant haftet nicht für Schäden" and the user asks to add a liability cap, proposed_text should be "Der Lieferant haftet für Schäden bis zu einem Betrag von EUR X. Ausgenommen sind Schäden aus Vorsatz oder grober Fahrlässigkeit." — NOT "Ich schlage vor, eine Haftungsbegrenzung hinzuzufügen" (that's a description, not a clause).

ANCHOR RULE: never quote more than ONE sentence (≤220 chars) in an anchor — long verbatim anchors make the reply end prematurely and the JSON gets cut off (EOS mid-string). Do NOT answer in plain text — the pane needs the suggestion JSON to apply the change.` })
    } else if (wantsSuggestions && !suggestions.length) {
      writeCtx.push({ role: 'user', content: 'If you found anything worth suggesting (legal risk, favoring, rephrase), emit {"tool": "propose_suggestions", "args": {"suggestions": [...]}} now. Otherwise answer in plain text.' })
    } else if (suggestions.length) {
      writeCtx.push({ role: 'user', content: `Your suggestions were recorded (${suggestions.map((s) => s.summary).join('; ')}). Reply in plain text only — do NOT emit another tool call.` })
    }
    // Rewrite asks never stream prose — the deliverable is the suggestion
    // card, and streamed prose on rewrites was pure echo garbage (field log
    // 2026-08-24: the truncated-retry path regurgitated prompt templates).
    // Normal Q&A keeps live typing.
    // Write phase: thinking OFF — reasoning happened during hops; disabling
    // thinking here gives the model maximum output tokens for the JSON.
    const w = await thinkChat(writeCtx, { maxTokens: AGENT.WRITE_MAX_TOKENS, phase: 'writing', thinking: false, onContent: wantsRewrite ? undefined : onContent, emit })
    if (w.reasoning.trim()) emit('reasoning', { text: showReasoning(w.reasoning), write: true })
    const call = parseToolCall(w.content)
    if (call && call.tool === 'propose_suggestions') {
      // The model chose to emit suggestions as its final answer.
      for (const s of call.args.suggestions || []) suggestions.push(normalizeSuggestion(s, suggestions.length))
      finalText = suggestionsSummary(suggestions)
    } else if (call) {
      // The model STILL tool-calls at write time (analysis loop). Do not
      // dispatch again — force a decision with the evidence in context.
      emit('step', { text: 'writing… (final answer)', kind: 'writing' })
      const forceCtx = [
        { role: 'system', content: sysCtx('writing') },
        { role: 'user', content: userMessage },
        ...(wantsRewrite && analysisSummary.length > 0
          ? [{ role: 'user', content: `ANALYSIS SUMMARY (${analysisSummary.length} findings):\n${analysisSummary.join('\n')}` }]
          : toolHistory),
        { role: 'user', content: 'This is all the analysis you will get. Decide now and output ONLY one of: (1) the JSON {"tool": "propose_suggestions", "args": {"suggestions": [...]}} with your findings, or (2) the plain-text answer. Do not mention this instruction.' },
      ]
      const w2 = await thinkChat(forceCtx, { maxTokens: AGENT.WRITE_MAX_TOKENS, phase: 'writing', emit })
      if (w2.reasoning.trim()) emit('reasoning', { text: showReasoning(w2.reasoning), write: true })
      const call2 = parseToolCall(w2.content)
      if (call2 && call2.tool === 'propose_suggestions') {
        for (const s of call2.args.suggestions || []) suggestions.push(normalizeSuggestion(s, suggestions.length))
        finalText = suggestionsSummary(suggestions)
      } else {
        // Even a forced decision produced a tool call or truncation —
        // fall back to prose (never surface raw JSON to the user).
        const embedded2 = extractToolCall(w2.content)
        if (embedded2?.call?.tool === 'propose_suggestions') {
          for (const s of embedded2.call.args?.suggestions || []) suggestions.push(normalizeSuggestion(s, suggestions.length))
          finalText = suggestionsSummary(suggestions)
        } else {
          const plain = call2 ? w2.content.replace(/\{[\s\S]*\}/, '').trim() : w2.content
          finalText = stripEchoes(plain) || 'Analysis complete. See suggestions above (or none were warranted).'
        }
      }
    } else {
      // parseToolCall returned null — the model often wraps the tool JSON
      // in prose, or the reply was truncated mid-JSON (native thinking
      // shares the max_tokens budget). Retry once when it looks like
      // cut-off JSON so raw JSON never reaches the user.
      let content = w.content
      if (!writeRetried && /^\s*\{/.test(String(content || '').trim())) {
        console.warn('[agent] write truncated:', String(content || '').length, 'chars:', JSON.stringify(String(content || '').slice(0, 300)))
        emit('step', { text: 'writing… (truncated — retrying)', kind: 'retry' })
        writeRetried = true
        const retryMsgs = [...writeCtx, { role: 'user', content: 'Your previous reply was cut off mid-JSON (it ended prematurely). Emit the complete tool call now. ANCHOR RULE: each anchor ≤220 chars (one sentence only) — long verbatim anchors make the reply end early. Keep proposed_text complete.' }]
        // thinking:false — shorter generation, more likely to complete on RDNA1
        const wRetry = await thinkChat(retryMsgs, { maxTokens: retryTokensFor(retryMsgs), phase: 'writing', thinking: false, emit })
        console.warn('[agent] write retry:', String(wRetry.content || '').length, 'chars:', JSON.stringify(String(wRetry.content || '').slice(0, 160)))
        if (wRetry.reasoning.trim()) emit('reasoning', { text: showReasoning(wRetry.reasoning), write: true })
        content = wRetry.content
      }
      // Rewrite ask answered in prose despite the instruction → one hard
      // retry: the suggestion JSON is the deliverable, prose is not.
      if (wantsRewrite && !extractToolCall(content) && !writeRetried) {
        emit('step', { text: 'writing… (rewrite must land as a suggestion)', kind: 'retry' })
        writeRetried = true
        const wForce = await thinkChat([
          { role: 'system', content: sysCtx('writing') },
          { role: 'user', content: userMessage },
          ...(wantsRewrite && analysisSummary.length > 0
            ? [{ role: 'user', content: `ANALYSIS SUMMARY (${analysisSummary.length} findings):\n${analysisSummary.join('\n')}` }]
            : toolHistory),
          { role: 'user', content: 'The pane can only apply clause rewrites as tracked changes when you emit {"tool": "propose_suggestions", "args": {"suggestions": [...]}} with the complete rewritten clause in proposed_text. Emit ONLY that JSON now.' },
        ], { maxTokens: retryTokensFor([...writeCtx]), phase: 'writing', thinking: false, emit })
        if (wForce.reasoning.trim()) emit('reasoning', { text: showReasoning(wForce.reasoning), write: true })
        content = wForce.content
      }
      const embedded = extractToolCall(content)
      if (embedded?.call?.tool === 'propose_suggestions') {
        for (const s of embedded.call.args?.suggestions || []) suggestions.push(normalizeSuggestion(s, suggestions.length))
        finalText = suggestionsSummary(suggestions)
      } else {
        // Bare suggestions array: [{"type": "rephrase", ...}]
        const trimmed = String(content || '').trim()
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const arr = JSON.parse(trimmed)
            if (Array.isArray(arr)) {
              for (const s of arr) suggestions.push(normalizeSuggestion(s, suggestions.length))
              if (suggestions.length) finalText = suggestionsSummary(suggestions)
            }
          } catch { /* not JSON — fall through */ }
        }
        if (!finalText) {
          const t = stripEchoes(content)
          // Still broken JSON (e.g. the retry truncated again): never
          // surface it — a neutral line beats raw braces.
          if (/^\s*\{/.test(t) && !parseToolCall(t)) finalText = 'Analysis complete — see suggestions above (or none were warranted).'
          else finalText = t
        }
      }
    }
  }

  endStream() // flush any remaining streamed prose (write phase finished)

  // 3b. GARBAGE FILTER — drop suggestions that are clearly wrong before the
  // judge wastes time verifying them. Catches: prompt echo (model wrote the
  // user's request into proposed_text), near-duplicate of the original clause,
  // and proposals shorter than a sentence.
  if (suggestions.length) {
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const userWords = new Set(norm(userMessage).split(/\s+/).filter((w) => w.length > 3))
    const filtered = []
    for (const s of suggestions) {
      const prop = norm(s.proposed_text || '')
      const anchor = norm(s.anchor?.text || s.clauseText || '')
      // Prompt echo: proposed_text contains many words from the user's message
      // (model echoed the prompt into the replacement instead of writing a rewrite)
      if (prop && userWords.size > 3) {
        const overlap = [...userWords].filter((w) => prop.includes(w)).length
        if (overlap / userWords.size > 0.5) {
          emit('step', { text: `dropped suggestion: echoed user prompt (${overlap}/${userWords.size} words matched)`, kind: 'dropped' })
          continue
        }
      }
      // Near-duplicate: proposed_text is very similar to the original (no-op rewrite)
      if (prop && anchor && prop === anchor) {
        emit('step', { text: 'dropped suggestion: proposed text identical to original', kind: 'dropped' })
        continue
      }
      // Too short to be a real clause rewrite
      if (prop && prop.length < 30 && s.type !== 'flag-favoring') {
        emit('step', { text: `dropped suggestion: too short (${prop.length} chars)`, kind: 'dropped' })
        continue
      }
      filtered.push(s)
    }
    if (filtered.length < suggestions.length) {
      emit('step', { text: `garbage filter: ${suggestions.length} → ${filtered.length} suggestions`, kind: 'dropped' })
      suggestions.length = 0
      suggestions.push(...filtered)
    }
  }

  // 4. JUDGE — proofread every suggestion against its anchor + cited law
  // (unless the lawyer switched the second pass off: then cards say "not double-checked").
  if (suggestions.length && !require('./judge').enabled()) {
    suggestions.splice(0, suggestions.length, ...suggestions.map((s, i) => ({ ...s, id: `s-${Date.now().toString(36)}-${i}`, verdict: { status: 'unchecked', note: 'second pass switched off' } })))
    for (const s of suggestions) ctx.memory?.registerSuggestion?.(s)
  } else if (suggestions.length) {
    if (aborted()) return stopEarly()
    emit('step', { text: `judge: verifying ${suggestions.length} suggestion(s)…`, kind: 'judge', total: suggestions.length })
    // Give the judge the FULL text of the clauses the model read — a
    // fragment-anchored suggestion must be checked against the real
    // clause, not against itself.
    ctx.readSectionText = readSections.map((s) => s.text).join(' … ')
    // Anchor backfill: Lotus often omits anchor_text, but the pane needs
    // it to render the diff and Apply the change, and the judge needs it
    // to ground verification. Fall back to the first clause the model
    // read (its first body sentence, verbatim). The same clause also
    // becomes the suggestion's sectionIndex — the pane shows
    // "§10 · Force Majeure" in the chat card so the lawyer knows exactly
    // where the change lands.
    if (readSections.length) {
      const { isHeading } = require('./compress')
      const lines = String(readSections[0].text).split('\n').map((l) => l.trim()).filter(Boolean)
      const bodyLine = lines.find((l) => !isHeading(l)) || lines[0] || ''
      const fallbackAnchor = anchorSnippet(bodyLine)
      const firstIdx = readSections[0].index
      for (const s of suggestions) {
        // wholeParagraph: the pane replaces the ENTIRE containing paragraph
        // on Approve — the anchor is only a search probe (Word caps search
        // text at 255 chars), never the replacement boundary.
        if ((!s.anchor || !String(s.anchor.text || '').trim()) && fallbackAnchor) {
          s.anchor = { text: fallbackAnchor, wholeParagraph: true }
        }
        if (s.sectionIndex == null) s.sectionIndex = firstIdx
        if (s.paraIndex == null && readSections[0].paraStart != null) {
          s.paraIndex = readSections[0].paraStart
          s.paraCount = readSections[0].paraCount || 1
        }
      }
    }
    // Per-suggestion judge grounding: resolve the FULL text of the clause
    // each suggestion anchors to — the read sections first (cheapest, and
    // the ones the model built its rewrite on), then a scan of the whole
    // doc (covers the injected-full-text path where the model never
    // hopped, so the judge never falls back to a 160-char fragment).
    // Whitespace-collapsed matching: anchor text has collapsed whitespace
    // while section text keeps newlines.
    const norm = (t) => String(t || '').replace(/\s+/g, ' ')
    for (const s of suggestions) {
      const target = s.anchor && s.anchor.text ? norm(s.anchor.text) : ''
      if (!target) continue
      const found = [...readSections, ...(ctx.doc?.sections || [])].find((sec) => sec && norm(sec.text).includes(target))
      if (found) {
        s.clauseText = found.text
        if (s.paraIndex == null && found.paraStart != null) {
          s.paraIndex = found.paraStart
          s.paraCount = found.paraCount || 1
        }
        // Collapse guard (deterministic, no LLM): a whole-clause rewrite that
        // comes back FAR shorter than the original destroyed operative
        // provisions — field log 2026-08-24: the full §4 liability clause
        // (carve-outs for intent/gross negligence/product liability) was
        // replaced by one generic sentence, judge passed it, autopilot
        // applied it. Flag it: the pane warns + autopilot skips; manual
        // Apply stays possible (an intentional "shorten this" still works).
        if (s.proposed_text) {
          const clauseLen = norm(s.clauseText).length
          const anchorLen = target.length
          const propLen = norm(s.proposed_text).length
          if (clauseLen > 200 && anchorLen > clauseLen * 0.6 && propLen < clauseLen * 0.4) {
            s.collapseWarning = `rewrite is far shorter than the original clause (${propLen} vs ${clauseLen} chars) — may have dropped operative provisions`
          }
        }
      }
    }
    const verdicts = await judgeSuggestions(ctx, suggestions, finalText)
    // Citation verification (Batch 1.5): cross-check every cited statute
    // + section against the pack's citation directory; flag wrong section
    // numbers on the card (never flag what can't be verified).
    try {
      const { lookup } = require('./citation')
      for (const s of suggestions) {
        const b = s.basis || {}
        if (!b.source || !b.section) continue
        const v = lookup(b.jurisdiction, b.source, b.section)
        if (v && !v.ok) {
          s.citationWarning = `§ ${b.section} not found in ${v.statute} — nearest: § ${v.nearest ?? '?'}`
        }
      }
    } catch { /* verification is best-effort */ }
    const verified = suggestions.filter((_, i) => verdicts[i]?.status !== 'drop')
    emit('step', { text: `judge: ${verified.length}/${suggestions.length} verified`, kind: 'judged', verified: verified.length, total: suggestions.length })
    suggestions.length = 0
    suggestions.push(...verified.map((s, i) => ({ ...s, id: `s-${Date.now().toString(36)}-${i}`, verdict: verdicts[i] })))
    for (const s of suggestions) ctx.memory?.registerSuggestion?.(s)
  }

  // Suggestions-only answer: build the summary AFTER the judge so the
  // count reflects what actually survived verification.
  if (suggestionsAreFinal && !finalText) {
    finalText = suggestions.length ? suggestionsSummary(suggestions) : 'Analysis complete — no changes proposed.'
  }

  // Never surface an empty answer: fall back to the suggestion summary or
  // a neutral completion line if every write path came up blank.
  if (!finalText || !finalText.trim()) {
    finalText = suggestions.length ? suggestionsSummary(suggestions) : 'Analysis complete.'
  }
  // 5. SECOND PASS on a prose answer (judge.js): checked against what the
  // sources it used actually say. On by default; the lawyer (or the firm)
  // can switch it off. The turn always says whether it ran.
  if (opts.judge !== false && !aborted()) {
    const judgeMod = require('./judge')
    if (!judgeMod.enabled()) emit('judge', { ran: false, reason: 'off' })
    else if (suggestions.length) emit('judge', { ran: true, ok: true, kind: 'suggestions', notes: [] })
    else if (!evidence.length && !readSections.length) emit('judge', { ran: false, reason: 'no-sources' })
    else {
      emit('step', { text: 'judge: checking the answer…', kind: 'judge_answer' })
      const v = await judgeMod.checkAnswer({ question: userMessage, answer: finalText, evidence: [...evidence, ...readSections.map((x) => ({ tool: 'get_range_text', text: String(x.text || '') }))] }, { signal: opts.signal })
      emit('judge', { ran: true, kind: 'answer', ok: v.ok, notes: v.notes, unavailable: !!v.unavailable })
    }
  }
  emit('done', {})
  return { text: finalText, suggestions, log, streamed, evidence, sources: lawUsed }
}

// Tools whose output is a source an answer can rest on (the second pass checks against them).
const EVIDENCE_TOOLS = new Set(['search_law', 'get_law_section', 'search_ris', 'search_eurlex', 'get_eu_law', 'search_law_sources', 'get_law_source', 'search_firm_library', 'search_sources', 'find_clause', 'web_fetch', 'get_range_text', 'get_clause_analysis', 'search_docs', 'read_file'])

/**
 * Repair the model's JSON before declaring it truncated. Lotus commonly
 * emits RAW NEWLINES inside string values (multi-line proposed_text) —
 * invalid JSON, but the object is complete. Misdiagnosing it as
 * "truncated" triggered the write-retry loop the field kept hitting.
 * Pass 1: escape newlines inside strings (state machine — safe for the
 * rest of the text). Pass 2: drop trailing commas before }/].
 */
function escapeNewlinesInStrings(text) {
  let out = ''
  let inStr = false
  let esc = false
  for (const ch of String(text)) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue }
      if (ch === '\\') { out += ch; esc = true; continue }
      if (ch === '"') { inStr = false; out += ch; continue }
      if (ch === '\n' || ch === '\r') { out += '\\n'; continue }
      out += ch
      continue
    }
    if (ch === '"') inStr = true
    out += ch
  }
  return out
}

function repairJson(text) {
  return escapeNewlinesInStrings(text)
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .trim()
}

function tryParse(s) {
  if (!s) return null
  try { return JSON.parse(s) } catch { /* fall through to repair */ }
  try { return JSON.parse(repairJson(s)) } catch { return null }
}

function parseToolCall(text) {
  if (!text) return null
  const cleaned = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  // Bare JSON ARRAY of tool calls — Lotus's fine-tune emits this shape
  // (remember/note objects, suggestion arrays) instead of our single
  // {"tool": ...} object. Normalize the first recognizable element.
  if (cleaned.startsWith('[')) {
    const arr = tryParse(repairJson(cleaned))
    if (Array.isArray(arr)) {
      const el = arr.find((x) => x && typeof x === 'object' && (x.tool || x.entity || x.claim || x.type || x.summary))
      if (el) {
        if (el.tool) return { tool: el.tool, args: el.args || {}, reasoning: el.reasoning || null, think: el.think === true }
        if (el.entity || el.claim) {
          return { tool: 'remember', args: { entity: el.entity, claim: el.claim, section: el.section }, reasoning: el.reasoning || null }
        }
        if (el.type || el.summary || el.proposed_text) {
          return { tool: 'propose_suggestions', args: { suggestions: arr }, reasoning: el.reasoning || null }
        }
      }
    }
  }
  // Direct answer (no JSON) → conversation continues
  if (!cleaned.startsWith('{')) return null
  // Extract a single top-level JSON object: match balanced braces so nested
  // args (suggestions arrays, objects) survive.
  let obj = null
  try { obj = JSON.parse(cleaned) } catch {
    try { obj = JSON.parse(repairJson(cleaned)) } catch {
      let depth = 0, start = -1
      for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i]
        if (ch === '{') { if (depth === 0) start = i; depth++ }
        else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { obj = tryParse(cleaned.slice(start, i + 1)); break } }
      }
    }
  }
  if (!obj || typeof obj !== 'object') return null
  // The MODEL decides when to think: a tool call may carry "think": true
  // (this step's result needs deep analysis) — absence/false means the
  // continuation runs fast, no reasoning (2026-08-16: hops default to no
  // thinking; the model opts in when it wants to).
  const think = obj.think === true
  // Our native format: {"tool": "...", "args": {...}}
  if (typeof obj.tool === 'string' && obj.tool) {
    // Native JSON with FLAT args: {"tool": "search_law", "query": "...", "section": "..."}.
    // Normalize the rest of the object into args so dispatch gets them.
    if (!obj.args || typeof obj.args !== 'object') {
      const args = { ...obj }
      delete args.tool
      delete args.reasoning
      delete args.think
      delete args.thought
      return { tool: obj.tool, args, reasoning: obj.reasoning || null, think }
    }
    return { ...obj, think }
  }
  // OpenAI function-calling format — Lotus sometimes falls into its
  // fine-tune's tool_calls shape. Normalize to our format.
  const tc = Array.isArray(obj.tool_calls) ? obj.tool_calls[0] : null
  if (tc && tc.function && typeof tc.function.name === 'string' && tc.function.name) {
    let args = {}
    try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* keep {} */ }
    return { tool: tc.function.name, args, reasoning: obj.reasoning || null, think }
  }
  return null
}


/**
 * Find a tool-call JSON object embedded inside prose. The model sometimes
 * writes "reasoning text {…json…}" instead of a pure JSON reply; scan for
 * the first balanced-brace object that parses and has a `tool` field.
 * Returns { call, raw } or null.
 */
function extractToolCall(text) {
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < s.length; j++) {
      const ch = s[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const call = tryParse(s.slice(i, j + 1))
          if (call && typeof call.tool === 'string' && call.tool) return { call, raw: s.slice(i, j + 1) }
          break
        }
      }
    }
  }
  return null
}

module.exports = { runAction, parseToolCall, extractToolCall }
