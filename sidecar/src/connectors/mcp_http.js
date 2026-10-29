"use strict"
/**
 * The engine's MCP client for remote law sources: Streamable HTTP,
 * JSON-RPC 2.0 (MCP 2025-06-18), answers as JSON or as an event stream.
 * Used by connectors that reach a source through its published MCP server
 * (opencaselaw.ch; Ansvar has its own sign-in on top of the same calls).
 * Local MCP servers (stdio) are the other half, in mcp/client.js.
 *
 *   const s = await new McpSession({ url, label }).open()
 *   const tools = await s.tools()
 *   const text = resultText(await s.call('search_decisions', { query }))
 */

const { request, SourceError } = require('./http')

const PROTOCOL = '2025-06-18'

/** The JSON-RPC answer with this id from a JSON or an event-stream body. */
function pickResponse(contentType, raw, id) {
  if (/event-stream/.test(contentType)) {
    for (const block of String(raw).split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
      if (!data) continue
      try { const msg = JSON.parse(data); if (msg.id === id) return msg } catch { /* keep looking */ }
    }
    return null
  }
  try { const msg = JSON.parse(raw); return Array.isArray(msg) ? msg.find((m) => m.id === id) : msg } catch { return null }
}

/** Text of a tools/call result (MCP content blocks; structured content as JSON). */
function resultText(r) {
  if (r?.structuredContent) return JSON.stringify(r.structuredContent)
  return (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

/** A JSON value from a tool result, or null when it is plain text. */
function resultJson(r) {
  if (r?.structuredContent) return r.structuredContent
  try { return JSON.parse(resultText(r)) } catch { return null }
}

const defaultError = (label) => (e) => {
  const m = `${e.message || ''} ${JSON.stringify(e.data || '')}`
  if (/rate|limit|quota/i.test(m)) return new SourceError(`${label} says the limit of searches is reached for now`, 'limit', String(e.message).slice(0, 120))
  return new SourceError(`${label} could not answer this request`, 'bad', String(e.message || e.code).slice(0, 160))
}

class McpSession {
  /**
   * @param {{ url: string, label: string, token?: string, headers?: object, timeoutMs?: number, onError?: (rpcError) => Error }} o
   */
  constructor({ url, label, token = null, headers = {}, timeoutMs = 45000, onError = null }) {
    Object.assign(this, { url, label, token, headers, timeoutMs, sid: null, next: 1, onError: onError || defaultError(label) })
  }

  async send(method, params, notify = false) {
    const id = notify ? undefined : this.next++
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL, ...this.headers }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (this.sid) headers['Mcp-Session-Id'] = this.sid
    const res = await request(this.url, { label: this.label, method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }), timeoutMs: this.timeoutMs })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sid = sid
    if (notify) return null
    const msg = pickResponse(res.headers.get('content-type') || '', await res.text(), id)
    if (!msg) throw new SourceError(`${this.label} sent an answer OpenLex cannot read`, 'bad', method)
    if (msg.error) throw this.onError(msg.error)
    return msg.result
  }

  async open() {
    await this.send('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'OpenLex', version: require('../../package.json').version } })
    await this.send('notifications/initialized', null, true)
    return this
  }

  async tools() {
    const r = await this.send('tools/list', {})
    return Array.isArray(r?.tools) ? r.tools : []
  }

  /** Call a tool; a tool-level error (isError) becomes a plain SourceError. */
  async call(name, args = {}, { notFound = false } = {}) {
    const r = await this.send('tools/call', { name, arguments: args })
    if (r?.isError) throw new SourceError(notFound ? `${this.label} has no such document` : `${this.label} could not answer this request`, notFound ? 'notfound' : 'bad', resultText(r).slice(0, 160))
    return r
  }
}

module.exports = { McpSession, pickResponse, resultText, resultJson, PROTOCOL }
