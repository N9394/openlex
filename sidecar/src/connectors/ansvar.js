"use strict"
/**
 * Ansvar — a paid law-research gateway (Ansvar Systems AB, Sweden): one
 * MCP endpoint for national law of many jurisdictions, EU law and
 * guidance, every answer with its source. EU-hosted, no AI model on their
 * side. https://ansvar.eu
 *
 * Access is MCP-only (Streamable HTTP, JSON-RPC) at gateway.ansvar.eu/mcp
 * with OAuth 2.1. Two credentials work here, both pasted by the lawyer and
 * kept in the OS keychain ("source-ansvar"):
 *   - a service credential "client-id:client-secret" (Ansvar's Premium
 *     plan and above): exchanged for a short-lived token
 *     (OAuth client_credentials) and renewed when it runs out;
 *   - an access token copied from Ansvar (used as is until it expires).
 * OpenLex only ever passes the lawyer's own credential to Ansvar; it never
 * shares, pools or resells access (Ansvar's terms forbid that).
 *
 * Tool names and arguments come from the gateway's own tools/list, so a
 * change on Ansvar's side does not need a new OpenLex release.
 */

const crypto = require('crypto')
const { request, SourceError } = require('./http')

const GATEWAY = () => process.env.OPENLEX_ANSVAR_URL || 'https://gateway.ansvar.eu/mcp'
const TOKEN_URL = () => process.env.OPENLEX_ANSVAR_TOKEN_URL || 'https://auth.ansvar.eu/realms/ansvar/protocol/openid-connect/token'
const LABEL = 'Ansvar'
const PROTOCOL = '2025-06-18'
const MAX_QUERY = 500 // Ansvar refuses longer questions

const tokens = new Map() // credential hash → { token, until }
const toolCache = new Map() // credential hash → { tools, at }
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16)

/** { clientId, clientSecret } for a service credential, { bearer } for a token. */
function parseKey(key) {
  const k = String(key || '').trim()
  if (!k) throw new SourceError('Ansvar needs your key: paste it with /sources', 'key')
  if (k.startsWith('{')) {
    try {
      const j = JSON.parse(k)
      if (j.client_id && j.client_secret) return { clientId: String(j.client_id), clientSecret: String(j.client_secret) }
      if (j.access_token) return { bearer: String(j.access_token) }
    } catch { /* not JSON */ }
  }
  const i = k.indexOf(':')
  if (i > 0 && !/\s/.test(k) && k.split('.').length < 3) return { clientId: k.slice(0, i), clientSecret: k.slice(i + 1) }
  return { bearer: k.replace(/^Bearer\s+/i, '') }
}

async function accessToken(key) {
  const k = parseKey(key)
  if (k.bearer) return k.bearer
  const id = hash(key)
  const hit = tokens.get(id)
  if (hit && hit.until > Date.now() + 30000) return hit.token
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: k.clientId, client_secret: k.clientSecret, scope: 'mcp:tools' })
  let res
  try {
    res = await request(TOKEN_URL(), { label: LABEL, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() })
  } catch (err) {
    if (err.code === 'bad' || err.code === 'key') throw new SourceError('Ansvar did not accept the key (check the client id and secret of your service credential)', 'key', err.message)
    throw err
  }
  const j = await res.json().catch(() => ({}))
  if (!j.access_token) throw new SourceError('Ansvar did not accept the key', 'key', 'no access_token')
  tokens.set(id, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 300) * 1000 })
  return j.access_token
}

/** The JSON-RPC answer with this id from a JSON or an event-stream body. */
function pickResponse(contentType, raw, id) {
  if (/event-stream/.test(contentType)) {
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
      if (!data) continue
      try { const msg = JSON.parse(data); if (msg.id === id) return msg } catch { /* keep looking */ }
    }
    return null
  }
  try { const msg = JSON.parse(raw); return Array.isArray(msg) ? msg.find((m) => m.id === id) : msg } catch { return null }
}

function rpcError(e) {
  const m = `${e.message || ''} ${JSON.stringify(e.data || '')}`
  if (/cap_exceeded|rate|limit/i.test(m)) return new SourceError('Ansvar says the searches included in your plan are used up for today', 'limit', String(e.message).slice(0, 120))
  if (e.code === -32601 || /plan|tier|upgrade/i.test(m)) return new SourceError('Your Ansvar plan does not include this kind of search', 'unsupported', String(e.message).slice(0, 160))
  return new SourceError('Ansvar could not answer this request', 'bad', String(e.message || e.code).slice(0, 160))
}

/** One MCP session over Streamable HTTP. */
class Session {
  constructor(token) { this.token = token; this.sid = null; this.next = 1 }
  async send(method, params, notify = false) {
    const id = notify ? undefined : this.next++
    const headers = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL }
    if (this.sid) headers['Mcp-Session-Id'] = this.sid
    const res = await request(GATEWAY(), { label: LABEL, method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }), timeoutMs: 45000 })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sid = sid
    if (notify) return null
    const msg = pickResponse(res.headers.get('content-type') || '', await res.text(), id)
    if (!msg) throw new SourceError('Ansvar sent an answer OpenLex cannot read', 'bad', method)
    if (msg.error) throw rpcError(msg.error)
    return msg.result
  }
  async open() {
    await this.send('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'OpenLex', version: require('../../package.json').version } })
    await this.send('notifications/initialized', null, true)
    return this
  }
}

async function session(key) {
  try { return await new Session(await accessToken(key)).open() } catch (err) {
    if (err.code === 'key') tokens.delete(hash(key))
    throw err
  }
}

async function toolsOf(s, key) {
  const id = hash(key)
  const hit = toolCache.get(id)
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.tools
  const r = await s.send('tools/list', {})
  const tools = Array.isArray(r?.tools) ? r.tools : []
  toolCache.set(id, { tools, at: Date.now() })
  return tools
}

const props = (t) => t?.inputSchema?.properties || {}
const firstProp = (t, names) => names.find((n) => Object.prototype.hasOwnProperty.call(props(t), n)) || null
function stringProp(t, names) {
  const named = firstProp(t, names)
  if (named) return named
  const req = (t?.inputSchema?.required || []).find((n) => props(t)[n]?.type === 'string')
  return req || null
}

/** Text of a tools/call result (MCP content blocks). */
function resultText(r) {
  if (r?.structuredContent) return JSON.stringify(r.structuredContent)
  return (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

const pick = (o, names) => { for (const n of names) if (o && o[n] != null && o[n] !== '') return o[n]; return null }
const flat = (v) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? (v.text || v.name || v.title || JSON.stringify(v)) : String(v))

/** Map whatever list the gateway returns into results; plain text becomes one result. */
function mapResults(text, limit) {
  let json = null
  try { json = JSON.parse(text) } catch { /* plain text */ }
  const rows = Array.isArray(json) ? json : json && typeof json === 'object' ? pick(json, ['results', 'items', 'hits', 'provisions', 'documents', 'data']) : null
  if (Array.isArray(rows)) {
    return rows.slice(0, limit).map((r, i) => ({
      ref: String(pick(r, ['id', 'provision_id', 'document_id', 'ref', 'reference', 'uri']) ?? `ansvar-${i + 1}`),
      title: flat(pick(r, ['title', 'name', 'heading', 'label'])) || `Ansvar result ${i + 1}`,
      citation: flat(pick(r, ['citation', 'reference', 'cite', 'provision', 'ref'])) || null,
      url: flat(pick(r, ['url', 'source_url', 'link', 'href'])) || null,
      snippet: flat(pick(r, ['snippet', 'excerpt', 'summary', 'text', 'content'])).slice(0, 1500),
      date: flat(pick(r, ['date', 'effective_date', 'in_force_from', 'updated'])) || null,
      jurisdiction: flat(pick(r, ['jurisdiction', 'country'])) || null,
      inForce: null,
    }))
  }
  const t = String(text || '').trim()
  return t ? [{ ref: 'ansvar-answer', title: 'Ansvar', citation: null, url: null, snippet: t.slice(0, 4000), date: null, inForce: null }] : []
}

const connector = {
  id: 'ansvar',
  label: 'Ansvar',
  country: 'INT',
  jurisdictions: [], // many: national law of EU and other countries, EU law
  kind: 'law',
  gateway: true,
  description: 'Paid law-research gateway by Ansvar Systems (Sweden): national law of many countries, EU law and guidance, each answer with its source',
  licence: 'Your own Ansvar subscription; Ansvar\'s terms apply (no sharing or reselling of access or results)',
  licenceUrl: 'https://ansvar.eu/terms',
  homepage: 'https://ansvar.eu',
  needsKey: true,
  keyHelp: 'Paste the service credential from your Ansvar workspace as client-id:client-secret (Ansvar Premium plan or higher). Each lawyer uses their own.',
  hosts: ['gateway.ansvar.eu', 'auth.ansvar.eu'],

  async search(query, { limit = 8, jurisdiction = null } = {}, { key = null } = {}) {
    const s = await session(key)
    const tools = await toolsOf(s, key)
    const tool = tools.find((t) => t.name === 'search') || tools.find((t) => /^search(_law|_legislation)?$/.test(t.name)) || tools.find((t) => /search/.test(t.name))
    if (!tool) throw new SourceError('Your Ansvar plan offers no search', 'unsupported')
    const q = stringProp(tool, ['query', 'q', 'question', 'text']) || 'query'
    const args = { [q]: String(query).slice(0, MAX_QUERY) }
    const jur = firstProp(tool, ['jurisdiction', 'jurisdictions', 'country'])
    if (jur && jurisdiction) args[jur] = props(tool)[jur]?.type === 'array' ? [String(jurisdiction).toUpperCase()] : String(jurisdiction).toUpperCase()
    const lim = firstProp(tool, ['limit', 'max_results', 'top_k'])
    if (lim) args[lim] = limit
    const r = await s.send('tools/call', { name: tool.name, arguments: args })
    if (r?.isError) throw new SourceError('Ansvar could not answer this search', 'bad', resultText(r).slice(0, 160))
    return mapResults(resultText(r), limit)
  },

  async get(ref, { article = null } = {}, { key = null } = {}) {
    const s = await session(key)
    const tools = await toolsOf(s, key)
    const tool = tools.find((t) => t.name === 'get_provision') || tools.find((t) => /^get_/.test(t.name))
    if (!tool) throw new SourceError('Your Ansvar plan offers no full texts', 'unsupported')
    const p = stringProp(tool, ['id', 'provision_id', 'reference', 'ref', 'uri', 'citation']) || 'id'
    const args = { [p]: String(ref) }
    const sec = firstProp(tool, ['section', 'article', 'provision'])
    if (sec && article && sec !== p) args[sec] = String(article)
    const r = await s.send('tools/call', { name: tool.name, arguments: args })
    if (r?.isError) throw new SourceError('Ansvar could not open this document', 'notfound', resultText(r).slice(0, 160))
    const text = resultText(r)
    let j = null
    try { j = JSON.parse(text) } catch { /* plain text */ }
    return {
      ref: String(ref),
      title: flat(pick(j, ['title', 'name', 'heading'])) || String(ref),
      citation: flat(pick(j, ['citation', 'reference', 'cite'])) || connector.citation(ref),
      url: flat(pick(j, ['url', 'source_url', 'link'])) || null,
      text: j ? flat(pick(j, ['text', 'content', 'body'])) || text : text,
    }
  },

  citation(ref) {
    return `${ref} (via Ansvar)`
  },
}

module.exports = { ...connector, parseKey, mapResults, pickResponse, _reset: () => { tokens.clear(); toolCache.clear() } }
