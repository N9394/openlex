"use strict"
/**
 * Shared helpers for the cloud providers: message normalisation and SSE
 * parsing over fetch().
 */

/**
 * The agent loop speaks a llama.cpp dialect: a bare `tool` role (no
 * tool_call_id) and system messages mid-conversation. Hosted APIs reject
 * both. Normalise to: leading system prompt(s) + strictly alternating
 * user/assistant turns, starting with user.
 *   - leading system messages → `system` (joined)
 *   - later system messages   → user turn prefixed "[System note]"
 *   - tool messages           → user turn prefixed "[Tool result]"
 *   - consecutive same-role   → merged
 */
/**
 * Prompt caching: text before CACHE_MARK in the system prompt is a stable
 * prefix (a long document read in full). Providers with explicit caching
 * (Anthropic, Bedrock) put a cache breakpoint there; every other provider
 * gets the text without the mark (OpenAI, DeepSeek, Mistral … cache stable
 * prefixes on their own, which is why the document comes first).
 */
const CACHE_MARK = '\n\u0001openlex:cache\u0001\n'
const stripCache = (s) => String(s ?? '').split(CACHE_MARK).join('\n')

function normalizeMessages(messages) {
  const systemParts = []
  const turns = []
  let seenNonSystem = false
  for (const m of messages) {
    const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
    if (m.role === 'system' && !seenNonSystem) { systemParts.push(raw); continue }
    const content = stripCache(raw)
    seenNonSystem = true
    let role = m.role
    let text = content
    if (role === 'system') { role = 'user'; text = `[System note]\n${content}` }
    else if (role === 'tool') { role = 'user'; text = `[Tool result]\n${content}` }
    else if (role !== 'assistant') role = 'user'
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content += `\n\n${text}`
    else turns.push({ role, content: text })
  }
  if (turns.length && turns[0].role !== 'user') turns.unshift({ role: 'user', content: '(continue)' })
  if (!turns.length) turns.push({ role: 'user', content: '(continue)' })
  const joined = systemParts.join('\n\n')
  // systemBlocks: [{ text, cache }] — the last block before a mark is cached.
  const pieces = joined.split(CACHE_MARK)
  const systemBlocks = pieces.map((text, i) => ({ text, cache: i < pieces.length - 1 })).filter((b) => b.text)
  return { system: stripCache(joined), systemBlocks, turns }
}

/** Error with the HTTP status + a short body excerpt (never the request). */
async function httpError(res, label) {
  let text = ''
  try { text = await res.text() } catch { /* ignore */ }
  const err = new Error(`${label} → HTTP ${res.status}: ${text.slice(0, 300)}`)
  err.status = res.status
  err.body = text
  return err
}

/** Yield parsed JSON payloads from an SSE response body. */
async function* sseEvents(res) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try { yield JSON.parse(data) } catch { /* partial frame — skip */ }
    }
  }
}

function timeoutSignal(ms, outer) {
  const signals = [AbortSignal.timeout(ms)]
  if (outer) signals.push(outer)
  return AbortSignal.any(signals)
}

module.exports = { CACHE_MARK, stripCache, normalizeMessages, httpError, sseEvents, timeoutSignal }
