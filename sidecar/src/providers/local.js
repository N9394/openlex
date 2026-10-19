"use strict"
/**
 * Local provider: llama.cpp / Ollama on LLM_BASE (Lotus by default).
 * llama-server speaks an Ollama-compatible surface (/v1/chat/completions
 * + /api/tags). Moved from src/llm.js unchanged; src/llm.js is now the
 * provider facade (policy + audit + routing) and calls into this module.
 *
 * Throws on failure — no canned responses (product policy since 2026-07-13).
 */

const http = require('http')
const { LLM_BASE, LLM_MODEL, AGENT } = require('../config')
const { effectiveAgent } = require('../agent-config')
const activeCtx = () => effectiveAgent().CTX_BUDGET_TOKENS

const url = new URL(LLM_BASE)

function request(method, pathname, body, timeoutMs = 120000, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        method,
        path: pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)) } catch { resolve({ content: text }) }
          } else {
            reject(new Error(`llama.cpp ${pathname} → HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('llama.cpp timeout')))
    req.on('error', reject)
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * API surface detection. The bundled llama-server (b10333+) mounts the
 * OpenAI-compatible surface under --api-prefix /api:
 *   /api/v1/chat/completions, /api/v1/models
 * Older llama.cpp builds and Ollama answer at:
 *   /v1/chat/completions, /api/tags
 * Probe once, cache the winner. Falls back per-call if unsure.
 */
let chatPath = null
let tagsPath = null
let resolvedModel = null // name the attached service actually exposes

async function detectSurface() {
  if (chatPath && tagsPath) return
  for (const c of ['/api/v1/chat/completions', '/api/chat/completions', '/v1/chat/completions']) {
    try {
      const r = await request('POST', c, { model: LLM_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, 8000)
      if (r.choices || r.content) { chatPath = c; break }
    } catch { /* try next */ }
  }
  // /api/tags first: the App's LLM proxy answers it directly (no model
  // load); /api/v1/models passes through and would lazy-spawn llama-server.
  for (const t of ['/api/tags', '/api/v1/models', '/api/models']) {
    try {
      const r = await request('GET', t, null, 5000)
      if (Array.isArray(r.models)) { tagsPath = t; break }
    } catch { /* try next */ }
  }
  if (!chatPath) chatPath = '/api/v1/chat/completions'
  if (!tagsPath) tagsPath = '/api/tags'
}

async function detectTagsPath() {
  if (tagsPath) return tagsPath
  // Tags only — never probes chat, so /api/status stays cheap when the
  // App's LLM proxy is present (no lazy model spawn).
  for (const t of ['/api/tags', '/api/v1/models', '/api/models']) {
    try {
      const r = await request('GET', t, null, 5000)
      if (Array.isArray(r.models)) { tagsPath = t; return t }
    } catch { /* try next */ }
  }
  tagsPath = '/api/tags'
  return tagsPath
}

/**
 * Model name for requests. When we spawn our own llama-server it accepts
 * any name and serves the loaded GGUF. When attaching to an existing
 * service (the App's llama-server, or Ollama), the request must name a
 * model the service knows — prefer the one it reports (Lotus when it has
 * it, else its first available model), falling back to LLM_MODEL.
 */
async function resolveModelName() {
  try {
    const tags = await request('GET', await detectTagsPath(), null, 5000)
    const models = (tags.models || []).map((m) => m.name || m.model || m.id).filter(Boolean)
    const lotus = models.find((m) => /lotus|lotus-ai/i.test(m))
    resolvedModel = lotus || models[0] || LLM_MODEL
  } catch { resolvedModel = LLM_MODEL }
  return resolvedModel
}

async function ping() {
  try {
    const tags = await request('GET', await detectTagsPath(), null, 5000)
    const models = (tags.models || []).map((m) => m.name || m.model || m.id)
    resolvedModel = models.find((m) => /lotus/i.test(m)) || models[0] || LLM_MODEL
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function withFallback(body, opts = {}) {
  await detectSurface()
  const primary = chatPath
  try {
    const res = await request('POST', primary, body, opts.timeoutMs || 120000)
    const content = res.choices?.[0]?.message?.content
    if (content !== undefined && content !== null) return res
    throw new Error('no content in reply')
  } catch (err) {
    // The first request failed (timeout, 5xx, empty reply, model busy).
    // Re-probe the surface — the cached chatPath may be stale (e.g. a
    // restart moved llama.cpp to a different prefix) — then retry ONCE on
    // whatever detectSurface() now believes is correct. Never guess a
    // hardcoded path: /v1/chat/completions does not exist on b10333 and
    // 404s the whole analyze run.
    console.warn(`[llm] primary ${primary} failed (${err.message}) — re-probing surface`)
    chatPath = null
    tagsPath = null
    await detectSurface()
    if (chatPath === primary) {
      // Same path still — the failure was transient, retry it directly.
      const res = await request('POST', chatPath, body, opts.timeoutMs || 120000)
      const content = res.choices?.[0]?.message?.content
      if (content !== undefined && content !== null) return res
      throw new Error('no content in reply (after surface re-probe)')
    }
    return request('POST', chatPath, body, opts.timeoutMs || 120000)
  }
}

/**
 * Non-streaming chat completion (agent planning, tools, judge).
 * Thinking is OFF here (deterministic quick calls: judge, pings, small
 * hops). Use chatWithReasoning when short thinking steps help.
 * @param {Array<{role:string,content:string}>} messages
 * @param {{maxTokens?:number}} opts
 */
async function chat(messages, opts = {}) {
  const { compact } = require('../ctx')
  const out = compact(messages, opts.maxTokens || AGENT.GENERATION_MAX_TOKENS)
  if (out.compacted) opts.onCompacted?.(out.compacted)
  const body = {
    model: await resolveModelName(),
    messages: out.messages,
    temperature: AGENT.TEMP,
    max_tokens: opts.maxTokens || AGENT.GENERATION_MAX_TOKENS,
    stream: false,
    // Disable thinking: llama.cpp b10333+ uses chat_template_kwargs;
    // Ollama-compatible servers read `think`. Send both.
    chat_template_kwargs: { enable_thinking: false },
    think: false,
    options: { num_ctx: activeCtx() },
  }
  const res = await withFallback(body)
  const content = res.choices?.[0]?.message?.content
  if (!content) throw new Error('llama.cpp returned no content')
  return content
}

/**
 * Chat completion with short, inline reasoning (spec §3). Per the agent
 * config, NATIVE thinking is OFF for the Lotus GGUF (INLINE_REASONING):
 * Lotus was fine-tuned to emit a one-line reasoning field inside the tool
 * JSON, and native <think> blocks just burn max_tokens until finish:length
 * with no content — which showed up as truncation-retry loops. So the
 * request disables thinking; `reasoning` comes back from the model's JSON
 * and is surfaced by the agent, not from reasoning_content deltas.
 *
 * @param {Array<{role:string,content:string}>} messages
 * @param {{maxTokens?:number, thinkingBudget?:number, onReasoning?:Function}} opts
 * @returns {Promise<{content:string, reasoning:string}>}
 */
async function chatWithReasoning(messages, opts = {}) {
  const { compact } = require('../ctx')
  const out = compact(messages, opts.maxTokens || AGENT.GENERATION_MAX_TOKENS)
  if (out.compacted) opts.onCompacted?.(out.compacted)
  const inlineReasoning = !!AGENT.INLINE_REASONING
  const body = {
    model: await resolveModelName(),
    messages: out.messages,
    temperature: AGENT.TEMP,
    max_tokens: opts.maxTokens || AGENT.GENERATION_MAX_TOKENS,
    stream: true,
    // Primary thinking bound is the llama-server --reasoning-budget flag
    // (injects the end-of-thought tag Lotus never emits). Keep the client
    // control enabled as a secondary stop for old servers without the flag.
    reasoning_control: true,
    chat_template_kwargs: { enable_thinking: !inlineReasoning && opts.thinking !== false },
    think: false,
    options: { num_ctx: activeCtx() },
  }
  await detectSurface()
  const payload = JSON.stringify(body)

  const stream = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, method: 'POST', path: chatPath,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res)
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode} POST ${chatPath}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`))
        })
        res.resume()
      }
    )
    req.on('error', reject)
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    req.write(payload)
    req.end()
  })

  const budget = opts.thinkingBudget ?? AGENT.THINKING_BUDGET ?? 120
  let reasoning = ''
  let content = ''
  let reasoningChars = 0
  let buffer = ''

  for await (const chunk of stream) {
    buffer += chunk.toString('utf8')
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let delta = null
      try {
        delta = JSON.parse(data).choices?.[0]?.delta || {}
      } catch { continue } // partial frames — skip, never swallow the guard
      if (delta.reasoning_content) {
        reasoningChars += String(delta.reasoning_content).length
        reasoning += delta.reasoning_content
        opts.onReasoning?.(delta.reasoning_content)
        // Hard client-side thinking cap. The server-side --reasoning-budget
        // flag is the primary bound, but servers WITHOUT it (old builds,
        // manually started llama-server) monologue unbounded and starve
        // the JSON that follows — the 21-98s "thinking" stalls in the
        // field. Budget ≈ chars/4. The model often emits stray whitespace
        // as early content, so "no content" means <50 substantive chars,
        // not literally empty. Abort with a distinctive error so the
        // agent can retry the call with thinking disabled. MUST throw
        // outside any try/catch (a swallow-catch here made an earlier
        // guard dead code — 2026-08-15 incident).
        if (reasoningChars / 4 > (budget * 2) && String(content).trim().length < 50) {
          const err = new Error('THINK_OVERFLOW: thinking exceeded the budget with no content')
          err.code = 'THINK_OVERFLOW'
          throw err
        }
      }
      if (delta.content) {
        content += delta.content
        opts.onContent?.(delta.content) // token streaming for the pane
      }
    }
  }
  // Fallback: if control never fired (old server without the endpoint),
  // the budget only caps via max_tokens — the caller sees what it gets.
  return { content, reasoning }
}

/**
 * Streaming chat completion. Yields text chunks; used by the add-in pane.
 */
async function* chatStream(messages, opts = {}) {
  const { compact } = require('../ctx')
  const out = compact(messages, opts.maxTokens || AGENT.GENERATION_MAX_TOKENS)
  if (out.compacted) opts.onCompacted?.(out.compacted)
  const body = {
    model: await resolveModelName(),
    messages: out.messages,
    temperature: AGENT.TEMP,
    max_tokens: opts.maxTokens || AGENT.GENERATION_MAX_TOKENS,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
    think: false,
    options: { num_ctx: activeCtx() },
  }
  await detectSurface()
  const payload = JSON.stringify(body)
  const stream = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, method: 'POST', path: chatPath,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res)
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode} POST ${chatPath}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`))
        })
        res.resume()
      }
    )
    req.on('error', reject)
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    req.write(payload)
    req.end()
  })
  let buffer = ''
  for await (const chunk of stream) {
    buffer += chunk.toString('utf8')
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch { /* partial frames — skip */ }
    }
  }
}

module.exports = { ping, chat, chatStream, chatWithReasoning }
