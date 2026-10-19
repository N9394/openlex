#!/usr/bin/env node
"use strict"
/**
 * OpenLex as an MCP server — legal search for Claude, Cursor, opencode and
 * any other MCP client.
 *
 *   { "mcpServers": { "openlex": { "command": "node", "args": ["<repo>/sidecar/src/mcp/server.js"] } } }
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0 (MCP 2025-06-18).
 * Uses the local law index (Qdrant from the App or the Word sidecar) and
 * local embeddings — nothing is fetched from the internet.
 *
 * Tools:
 *   openlex_search_law          hybrid search over installed jurisdiction packs
 *   openlex_get_law_section     full text of one law chunk
 *   openlex_list_jurisdictions  installed packs
 *   openlex_search_firm_library the firm's own documents — OFF by default:
 *     the calling app usually sends tool results to a cloud model. Enable
 *     with ~/.lexvault/mcp-expose.json { "firmLibrary": true }.
 *
 * Every call is audited (~/.lexvault/audit/llm-calls.jsonl, metadata only).
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('../config')
const policy = require('../policy')

const PROTOCOL_VERSION = '2025-06-18'
const VERSION = (() => { try { return require('../../package.json').version } catch { return '0.0.0' } })()

function exposeFirmLibrary() {
  try { return !!JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mcp-expose.json'), 'utf8')).firmLibrary } catch { return false }
}

const TOOLS = [
  {
    name: 'openlex_search_law',
    description: 'Search statutes in the locally installed OpenLex jurisdiction packs (AT, DE, CZ, SK, RO, US, US-CA, ZA, CY …). Write the query in the jurisdiction\'s language with statutory terms. Returns sections with chunk ids for openlex_get_law_section.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query in the jurisdiction language' },
        jurisdiction: { type: 'string', description: 'Jurisdiction code, e.g. AT, DE, SK (optional)' },
        limit: { type: 'integer', description: 'Max results (1-15, default 8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'openlex_get_law_section',
    description: 'Full text of one law section by chunk id (from openlex_search_law).',
    inputSchema: { type: 'object', properties: { chunk_id: { type: 'string' } }, required: ['chunk_id'] },
  },
  {
    name: 'openlex_search_eu_law',
    description: 'EU law from the official EU Publications Office (EUR-Lex data): find regulations, directives and decisions by reference ("2016/679", "Regulation (EC) No 593/2008"), common name ("GDPR", "Rome I", "AI Act") or title words. Returns CELEX numbers, in-force status and the latest consolidated version.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, language: { type: 'string', description: 'en, de, fr, … (default en)' } },
      required: ['query'],
    },
  },
  {
    name: 'openlex_get_eu_law',
    description: 'Text of an EU act by CELEX number (consolidated version when available), optionally a single article.',
    inputSchema: {
      type: 'object',
      properties: { celex: { type: 'string' }, article: { type: 'string' }, language: { type: 'string' } },
      required: ['celex'],
    },
  },
  {
    name: 'openlex_list_jurisdictions',
    description: 'Jurisdiction packs installed on this machine.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const FIRM_TOOL = {
  name: 'openlex_search_firm_library',
  description: "Search the firm's own documents (precedents, templates, know-how) indexed on this machine.",
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, matter_id: { type: 'string', description: 'Limit to one matter (optional)' } },
    required: ['query'],
  },
}

function listTools() {
  return exposeFirmLibrary() ? [...TOOLS, FIRM_TOOL] : TOOLS
}

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })

async function callTool(name, args = {}) {
  policy.audit({ provider: 'mcp-server', model: name, matter: null, call: 'mcp-serve', decision: 'allowed' })
  switch (name) {
    case 'openlex_search_law': {
      const query = String(args.query || '').trim()
      if (!query) return text('query is required', true)
      const limit = Math.min(15, Math.max(1, parseInt(args.limit, 10) || 8))
      const [vec] = await require('../embeddings').embedQueries([query])
      const { results, error } = await require('../search').hybridSearch(vec, { jurisdiction: args.jurisdiction ? String(args.jurisdiction).toUpperCase() : undefined, limit })
      if (error) return text(`Search failed: ${error}. Is the OpenLex app or Word plugin running (local law index)?`, true)
      if (!results.length) return text(`No results for "${query}"${args.jurisdiction ? ` in ${args.jurisdiction}` : ''}.`)
      return text(results.map((r) => {
        const p = r.payload || {}
        return `[${r.id}] ${p.source_name || ''}${p.section ? ` — ${p.section}` : ''} (${p.jurisdiction || '?'}${p.in_force === false ? ', NOT IN FORCE' : ''})\n${String(p.content || '').slice(0, 700)}`
      }).join('\n\n'))
    }
    case 'openlex_get_law_section': {
      const p = await require('../search').getChunk(String(args.chunk_id || ''))
      if (!p) return text('No such chunk (or the local law index is not running).', true)
      return text(`${p.source_name || ''}${p.section ? ` — ${p.section}` : ''} (${p.jurisdiction || '?'})\n\n${p.content || ''}`)
    }
    // EU law is public; the only thing that leaves the machine is the query
    // (to publications.europa.eu), as with any search engine.
    case 'openlex_search_eu_law': {
      const query = String(args.query || '').trim()
      if (!query) return text('query is required', true)
      try {
        const r = await require('../web/eurlex').search(query, { lang: String(args.language || 'en').slice(0, 2).toLowerCase(), limit: 8 })
        if (!r.results.length) return text(`No EU acts found for "${query}".`)
        return text(r.results.map((x) => `CELEX ${x.celex} — ${x.title || '(no title in this language)'} — ${x.inForce === false ? 'NOT in force' : x.inForce ? 'in force' : 'status unknown'}${x.consolidated ? `; consolidated ${x.consolidated.celex}` : ''}\n${x.url}`).join('\n\n'))
      } catch (err) { return text(`EUR-Lex error: ${err.message}`, true) }
    }
    case 'openlex_get_eu_law': {
      try {
        const r = await require('../web/eurlex').text(String(args.celex || ''), { lang: String(args.language || 'en').slice(0, 2).toLowerCase(), article: args.article ? String(args.article) : null })
        return text(`${r.celex}${r.article ? `, Article ${r.article}` : ''} (${r.lang}) — ${r.url}\n\n${r.text.slice(0, 30000)}`)
      } catch (err) { return text(`EUR-Lex error: ${err.message}`, true) }
    }
    case 'openlex_list_jurisdictions': {
      const packs = require('../packstore').scanPacks()
      if (!packs.length) return text('No jurisdiction packs installed.')
      return text(packs.map((p) => `${p.jurisdiction || p.code || '?'} ${p.version || ''}`.trim()).join('\n'))
    }
    case 'openlex_search_firm_library': {
      if (!exposeFirmLibrary()) return text('The firm library is not exposed over MCP on this machine.', true)
      const hits = await require('../library').search(String(args.query || ''), { matterId: args.matter_id || null, limit: 6 })
      if (!hits.length) return text('No results in the firm library.')
      return text(hits.map((h) => `[${h.title} · part ${h.chunk + 1}]\n${h.text}`).join('\n\n'))
    }
    default:
      return text(`Unknown tool: ${name}`, true)
  }
}

async function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'openlex', version: VERSION } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: listTools() }
    case 'tools/call':
      try { return await callTool(params?.name, params?.arguments || {}) } catch (err) { return text(`Error: ${err.message}`, true) }
    default:
      if (id === undefined) return undefined // notification (e.g. notifications/initialized)
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

function main() {
  // stdout is the protocol channel — route stray logs to stderr.
  console.log = console.warn = console.info = (...a) => process.stderr.write(a.join(' ') + '\n')
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
        continue
      }
      handle(msg).then((result) => {
        if (msg.id === undefined) return
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
      }).catch((err) => {
        if (msg.id === undefined) return
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } }) + '\n')
      })
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

if (require.main === module) main()

module.exports = { handle, listTools }
