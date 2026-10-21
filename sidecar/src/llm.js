"use strict"
/**
 * Model facade — the one entry point the agent loop, judge and server use.
 *
 * Routes every call to the active provider (providers/settings.js):
 * local llama.cpp/Ollama (Lotus) or a cloud API with the user's own key.
 * Before any request leaves the machine the data policy is checked
 * (policy.js — default local-only), and every call is audited (metadata
 * only). Same exports as the original llama.cpp client, so agent.js and
 * judge.js are provider-agnostic.
 *
 * Throws on failure — no canned responses (product policy since 2026-07-13).
 */

const local = require('./providers/local')
const settings = require('./providers/settings')
const policy = require('./policy')
const secrets = require('./secrets')
const { AGENT } = require('./config')

const ADAPTERS = {
  openai: require('./providers/openai'),
  azure: require('./providers/openai'),
  anthropic: require('./providers/anthropic'),
  bedrock: require('./providers/bedrock'),
  vertex: require('./providers/vertex'),
}

function active() {
  return settings.resolve()
}

// ── routing (routing.js): which provider(s) to try for this call ─────────
const routing = require('./routing')

/** Errors worth trying the next candidate for: network, timeouts, 429, 5xx, missing key. */
function retryable(err) {
  if (!err) return false
  if (err.code === 'POLICY_BLOCKED' || err.code === 'NO_KEY') return true
  const m = String(err.message || err)
  return /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|timed? ?out|aborted due to timeout|HTTP (429|5\d\d)|\b(429|50[0-4])\b|overloaded|rate limit/i.test(m) && !/AbortError|cancel/i.test(m)
}

/**
 * Run a call against the routed candidates in order. `runLocal()` serves
 * the local model, `runCloud(p)` a hosted provider. Falls through to the
 * next candidate on policy blocks, missing keys and retryable failures —
 * but never after content was streamed to the user.
 */
async function routed(kind, messages, opts, runLocal, runCloud) {
  const cands = routing.candidates({ role: opts.role, phase: opts.phase, matterId: policy.currentMatter(), chars: chars(messages) })
  let streamed = false
  const optsOut = opts.onContent ? { ...opts, onContent: (t) => { if (t) streamed = true; opts.onContent(t) } } : opts
  let firstErr = null
  for (const [i, c] of cands.entries()) {
    try {
      if (c.provider.kind === 'local') { auditLocal(kind, opts.role || opts.phase, c.reason); return await runLocal(optsOut) }
      return await runCloud(c.provider, optsOut, c.reason)
    } catch (err) {
      if (!firstErr || (firstErr.code === 'POLICY_BLOCKED' && err.code !== 'POLICY_BLOCKED')) firstErr = err
      const last = i === cands.length - 1
      if (last || streamed || !retryable(err) || opts.signal?.aborted) throw err.code === 'POLICY_BLOCKED' && firstErr ? firstErr : err
      console.warn(`[llm] ${c.provider.id} failed for ${opts.role || opts.phase || kind} (${String(err.message).slice(0, 120)}), trying ${cands[i + 1].provider.id}`)
    }
  }
  throw firstErr || new Error('no model provider available')
}

/**
 * Policy gate + key lookup for a cloud provider. Throws POLICY_BLOCKED
 * (audited) when the matter's data policy forbids this provider.
 */
async function prepare(p, kind) {
  const matter = policy.currentMatter()
  const decision = policy.check(p, matter)
  if (!decision.allowed) {
    policy.audit({ provider: p.id, model: p.model || null, matter, call: kind, decision: 'blocked', reason: decision.reason })
    const err = new Error(`Blocked by data policy: ${decision.reason}. Change it in Settings → Data policy, or switch to a local model.`)
    err.code = 'POLICY_BLOCKED'
    throw err
  }
  const key = await secrets.getKey(p.id)
  if (p.needsKey && !key) { const e = new Error(`${p.label}: no API key set (Settings → Model provider)`); e.code = 'NO_KEY'; throw e }
  return { key, matter }
}

const chars = (messages) => messages.reduce((n, m) => n + String(m.content || '').length, 0)

/** Run one cloud call with compaction, policy, and audit around it. */
async function cloudCall(kind, messages, opts, run, provider, routeReason) {
  const p = provider || active()
  const adapter = ADAPTERS[p.kind]
  if (!adapter) throw new Error(`provider kind not supported: ${p.kind}`)
  const { compact } = require('./ctx')
  const out = compact(messages, opts.maxTokens || AGENT.GENERATION_MAX_TOKENS)
  if (out.compacted) opts.onCompacted?.(out.compacted)
  const { key, matter } = await prepare(p, kind)
  // Redact-before-send when the matter's policy asks for it: placeholders
  // go out, the reply (and every streamed token) is restored locally.
  const red = require('./redact').forMatter(matter)
  const messagesOut = red ? red.redactMessages(out.messages) : out.messages
  const restorer = red && opts.onContent ? red.streamRestorer(opts.onContent) : null
  // Native tool calling (hosted models): agent phases get real tool
  // definitions. Not on calls that stream prose to the pane — a hosted
  // model's "Let me check…" preamble before a tool call would leak into
  // the answer. The text-JSON protocol still works there as a fallback.
  const wantTools = p.nativeTools !== false && opts.phase && opts.tools !== false &&
    (opts.phase === 'planning' || opts.phase === 'analyzing' || !opts.onContent)
  const callOpts = {
    ...opts,
    ...(wantTools ? { nativeTools: require('./providers/native_tools').toolList() } : {}),
    maxTokens: opts.maxTokens || AGENT.GENERATION_MAX_TOKENS,
    temperature: opts.temperature ?? AGENT.TEMP ?? 0,
    ...(restorer ? { onContent: restorer.push } : {}),
  }
  const t0 = Date.now()
  try {
    let r = await run(adapter, p, key, messagesOut, callOpts)
    if (red) {
      restorer?.flush()
      r = { ...r, content: red.restore(r.content), reasoning: red.restore(r.reasoning) }
    }
    policy.audit({ provider: p.id, model: p.model || null, ...(p.region ? { region: p.region } : {}), matter, call: kind, ...(opts.role || opts.phase ? { role: opts.role || routing.PHASE_ROLE[opts.phase] || opts.phase } : {}), ...(routeReason ? { route: routeReason } : {}), decision: 'allowed', ok: true, ms: Date.now() - t0, inChars: chars(messagesOut), outChars: (r.content || '').length, ...(red ? { redacted: red.replaced } : {}) })
    return r
  } catch (err) {
    policy.audit({ provider: p.id, model: p.model || null, matter, call: kind, decision: 'allowed', ok: false, ms: Date.now() - t0, inChars: chars(out.messages), error: String(err.message).slice(0, 200) })
    throw err
  }
}

function auditLocal(kind, role, routeReason) {
  policy.audit({ provider: 'local', model: null, matter: policy.currentMatter(), call: kind, ...(role ? { role: routing.PHASE_ROLE[role] || role } : {}), ...(routeReason ? { route: routeReason } : {}), decision: 'allowed' })
}

async function ping() {
  const p = active()
  if (p.kind === 'local') return local.ping()
  const hasKey = p.needsKey ? await secrets.hasKey(p.id) : true
  const decision = policy.check(p, policy.currentMatter())
  return {
    ok: hasKey && decision.allowed,
    models: [p.model || p.label],
    provider: p.id,
    error: !hasKey ? 'no API key set' : (!decision.allowed ? decision.reason : null),
  }
}

/** Non-streaming chat → string. */
async function chat(messages, opts = {}) {
  return routed('chat', messages, opts, (o) => local.chat(messages, o), async (p, o, why) => {
    const r = await cloudCall('chat', messages, o, (a, pp, key, msgs, oo) => a.complete(pp, key, msgs, oo), p, why)
    if (!r.content) throw new Error(`${p.label} returned no content`)
    return r.content
  })
}

/** Streaming chat with reasoning callbacks → { content, reasoning }. */
async function chatWithReasoning(messages, opts = {}) {
  return routed('chatWithReasoning', messages, opts, (o) => local.chatWithReasoning(messages, o),
    (p, o, why) => cloudCall('chatWithReasoning', messages, o, (a, pp, key, msgs, oo) => a.stream(pp, key, msgs, oo), p, why))
}

/** Streaming chat → async iterator of text chunks. */
async function* chatStream(messages, opts = {}) {
  const first = routing.primary({ role: opts.role, phase: opts.phase, matterId: policy.currentMatter(), chars: chars(messages) })
  if (first.kind === 'local') { auditLocal('chatStream', opts.role || opts.phase, 'primary'); yield* local.chatStream(messages, opts); return }
  const queue = []
  let done = false
  let failure = null
  let wake = null
  const notify = () => { if (wake) { wake(); wake = null } }
  routed('chatStream', messages, { ...opts, onContent: (t) => { queue.push(t); notify() } },
    () => { throw new Error('local model is not the primary route for this stream') },
    (p, o, why) => cloudCall('chatStream', messages, o, (a, pp, key, msgs, oo) => a.stream(pp, key, msgs, oo), p, why))
    .catch((err) => { failure = err })
    .finally(() => { done = true; notify() })
  while (true) {
    if (queue.length) { yield queue.shift(); continue }
    if (done) break
    await new Promise((r) => { wake = r })
  }
  if (failure) throw failure
}

/** Settings → Test: one tiny call against a provider (policy still applies). */
async function testProvider(id) {
  const p = settings.resolve(id)
  if (p.kind === 'local') {
    const r = await local.ping()
    return { ok: r.ok, sample: r.models?.[0] || null, error: r.error || null }
  }
  const { key } = await prepare(p, 'test')
  const r = await ADAPTERS[p.kind].test(p, key)
  policy.audit({ provider: p.id, model: p.model || null, matter: policy.currentMatter(), call: 'test', decision: 'allowed', ok: true })
  return r
}

/** The provider a call for this role would try first (for concurrency and display). */
function providerFor(role) {
  return routing.primary({ role, matterId: policy.currentMatter() })
}

module.exports = { ping, chat, chatStream, chatWithReasoning, testProvider, activeProvider: active, providerFor, retryable }
