"use strict"
/**
 * OpenAI-compatible provider: OpenAI, Azure OpenAI, Mistral, OpenRouter
 * and any custom /chat/completions gateway (vLLM, LM Studio, LiteLLM).
 *
 * Request bodies carry only portable fields — no llama.cpp extras
 * (chat_template_kwargs, think, options), which strict APIs reject.
 * Reasoning models that refuse `temperature` get one automatic retry
 * without it.
 */

const { normalizeMessages, httpError, sseEvents, timeoutSignal } = require('./common')
const native = require('./native_tools')

function endpoint(p) {
  if (!p.baseUrl) throw new Error(`${p.label}: no endpoint URL configured (Settings → Model provider)`)
  if (p.kind === 'azure') {
    return `${p.baseUrl}/chat/completions?api-version=${encodeURIComponent(p.apiVersion || '2024-10-21')}`
  }
  return `${p.baseUrl}/chat/completions`
}

function headers(p, key) {
  const h = { 'Content-Type': 'application/json' }
  if (key) {
    if (p.kind === 'azure') h['api-key'] = key
    else h.Authorization = `Bearer ${key}`
  }
  if (p.id === 'openrouter') {
    h['HTTP-Referer'] = 'https://openlex.dev'
    h['X-Title'] = 'OpenLex'
  }
  return h
}

function buildBody(p, messages, opts, stream) {
  const { system, turns } = normalizeMessages(messages)
  const body = {
    messages: system ? [{ role: 'system', content: system }, ...turns] : turns,
    stream,
  }
  if (p.kind !== 'azure' && p.model) body.model = p.model
  body[p.maxTokensField || 'max_tokens'] = opts.maxTokens || 1024
  if (opts.temperature !== undefined && !opts._noTemperature) body.temperature = opts.temperature
  // OpenRouter routes to reasoning models that otherwise spend the whole
  // token budget thinking and return no content. OpenLex budgets its own
  // thinking, so hosted reasoning is off unless a call asks for it.
  if (p.id === 'openrouter' && !opts._noReasoningParam) body.reasoning = { effort: opts.thinking === true ? 'low' : 'none' }
  if (opts.nativeTools?.tools.length) {
    body.tools = native.forOpenAI(opts.nativeTools.tools)
    body.tool_choice = 'auto'
  }
  return body
}

// Some models (OpenAI reasoning models) reject temperature; some reject a
// reasoning setting. Retry once without the parameter they name.
const isTemperatureError = (err) => err.status === 400 && /temperature/i.test(err.body || '')
const isReasoningError = (err) => err.status === 400 && /reasoning/i.test(err.body || '')
const retryOpts = (err, opts) => (isTemperatureError(err) ? { ...opts, _noTemperature: true } : isReasoningError(err) ? { ...opts, _noReasoningParam: true } : null)

async function post(p, key, body, opts) {
  const res = await fetch(endpoint(p), {
    method: 'POST',
    headers: headers(p, key),
    body: JSON.stringify(body),
    signal: timeoutSignal(opts.timeoutMs || 180000, opts.signal),
  })
  if (!res.ok) throw await httpError(res, `${p.label}`)
  return res
}

/** Non-streaming completion → { content, reasoning, usage } */
async function complete(p, key, messages, opts = {}) {
  let res
  try {
    res = await post(p, key, buildBody(p, messages, opts, false), opts)
  } catch (err) {
    const again = retryOpts(err, opts)
    if (!again) throw err
    res = await post(p, key, buildBody(p, messages, again, false), opts)
  }
  const json = await res.json()
  const msg = json.choices?.[0]?.message || {}
  const call = msg.tool_calls?.[0]?.function
  return {
    // A native tool call becomes the agent's text-JSON tool call.
    content: call && opts.nativeTools ? native.asTextCall(opts.nativeTools.names, call.name, call.arguments) : (msg.content || ''),
    reasoning: msg.reasoning_content || msg.reasoning || '',
    usage: json.usage || null,
  }
}

/** Streaming completion; calls onContent/onReasoning, returns the totals. */
async function stream(p, key, messages, opts = {}) {
  let res
  try {
    res = await post(p, key, buildBody(p, messages, opts, true), opts)
  } catch (err) {
    const again = retryOpts(err, opts)
    if (!again) throw err
    res = await post(p, key, buildBody(p, messages, again, true), opts)
  }
  let content = ''
  let reasoning = ''
  const calls = [] // native tool calls, assembled from deltas by index
  for await (const ev of sseEvents(res)) {
    const delta = ev.choices?.[0]?.delta || {}
    const r = delta.reasoning_content || delta.reasoning
    if (r) { reasoning += r; opts.onReasoning?.(r) }
    if (delta.content) { content += delta.content; opts.onContent?.(delta.content) }
    for (const tc of delta.tool_calls || []) {
      const i = tc.index ?? 0
      calls[i] = calls[i] || { name: '', args: '' }
      if (tc.function?.name) calls[i].name += tc.function.name
      if (tc.function?.arguments) calls[i].args += tc.function.arguments
    }
  }
  // The agent runs one tool per hop; the first call wins (prose preamble
  // is dropped — the loop treats the reply as a tool call).
  const call = calls.find((c) => c && c.name)
  if (call && opts.nativeTools) return { content: native.asTextCall(opts.nativeTools.names, call.name, call.args), reasoning }
  return { content, reasoning }
}

/** Cheap connectivity + auth check for Settings → Test. */
async function test(p, key) {
  const r = await complete(p, key, [{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 16, temperature: 0, timeoutMs: 30000 })
  return { ok: true, sample: r.content.slice(0, 40) }
}

module.exports = { complete, stream, test, buildBody }
