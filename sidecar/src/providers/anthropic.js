"use strict"
/**
 * Anthropic Messages API provider (Claude).
 *
 * Thinking is not requested: the agent's text-JSON tool protocol and its
 * own reasoning field work without it, and extended thinking would force
 * temperature 1 and a ≥1024-token budget on every hop.
 */

const { normalizeMessages, httpError, sseEvents, timeoutSignal } = require('./common')
const native = require('./native_tools')

const API_VERSION = '2023-06-01'

function buildBody(p, messages, opts, stream) {
  const { system, turns } = normalizeMessages(messages)
  const body = {
    model: p.model,
    max_tokens: opts.maxTokens || 1024,
    messages: turns,
    stream,
  }
  if (system) body.system = system
  if (p.vertex) {
    // Claude on Vertex AI: model is in the URL, version in the body.
    delete body.model
    body.anthropic_version = 'vertex-2023-10-16'
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.nativeTools?.tools.length) {
    body.tools = native.forAnthropic(opts.nativeTools.tools)
    body.tool_choice = { type: 'auto', disable_parallel_tool_use: true }
  }
  return body
}

async function post(p, key, body, opts) {
  if (!key) throw new Error(`${p.label}: no API key configured (Settings → Model provider)`)
  // Vertex AI supplies its own URL (rawPredict / streamRawPredict) and an
  // OAuth bearer token instead of an Anthropic API key.
  const url = p.vertex ? p.vertex.url(body.stream) : `${p.baseUrl}/v1/messages`
  const auth = p.vertex ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': API_VERSION }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(body),
    signal: timeoutSignal(opts.timeoutMs || 180000, opts.signal),
  })
  if (!res.ok) throw await httpError(res, p.label)
  return res
}

async function complete(p, key, messages, opts = {}) {
  const res = await post(p, key, buildBody(p, messages, opts, false), opts)
  const json = await res.json()
  const blocks = json.content || []
  const use = blocks.find((b) => b.type === 'tool_use')
  const content = use && opts.nativeTools
    ? native.asTextCall(opts.nativeTools.names, use.name, use.input)
    : blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
  return { content, reasoning: '', usage: json.usage || null }
}

async function stream(p, key, messages, opts = {}) {
  const res = await post(p, key, buildBody(p, messages, opts, true), opts)
  let content = ''
  let tool = null // first tool_use block: { name, json }
  for await (const ev of sseEvents(res)) {
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && !tool) {
      tool = { name: ev.content_block.name, json: '', index: ev.index }
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta' && tool && ev.index === tool.index) {
      tool.json += ev.delta.partial_json || ''
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      content += ev.delta.text
      opts.onContent?.(ev.delta.text)
    } else if (ev.type === 'error') {
      throw new Error(`Anthropic stream error: ${ev.error?.message || 'unknown'}`)
    }
  }
  if (tool && opts.nativeTools) return { content: native.asTextCall(opts.nativeTools.names, tool.name, tool.json), reasoning: '' }
  return { content, reasoning: '' }
}

async function test(p, key) {
  const r = await complete(p, key, [{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 16, temperature: 0, timeoutMs: 30000 })
  return { ok: true, sample: r.content.slice(0, 40) }
}

module.exports = { complete, stream, test, buildBody }
