"use strict"
/**
 * Phase 3 connectors: OpenLex as MCP client and as MCP server.
 *
 *   node --test test/mcp.test.js
 *
 * Loopback: the client connects to OpenLex's own MCP server (local) and to
 * a tiny echo server flagged remote, checking discovery, namespacing,
 * agent catalog/schema integration and the data-policy gate.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-mcp-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.LEXVAULT_QDRANT_URL = 'http://127.0.0.1:1' // no law index in this test

const SERVER = path.join(__dirname, '..', 'src', 'mcp', 'server.js')
const ECHO = path.join(DATA, 'echo-mcp.js')
fs.writeFileSync(ECHO, `
let b=''; process.stdin.on('data', d => { b += d; let i; while ((i = b.indexOf('\\n')) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); if (!l.trim()) continue
  const m = JSON.parse(l); if (m.id === undefined) continue
  let result
  if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo' } }
  else if (m.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'what to echo' } } } }] }
  else if (m.method === 'tools/call') result = { content: [{ type: 'text', text: 'ECHO:' + m.params.arguments.text }] }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n') } })`)

const mcp = require('../src/mcp/client')
const policy = require('../src/policy')
test.after(() => { mcp.stopAll(); fs.rmSync(DATA, { recursive: true, force: true }) })

function rpc(lines) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], { env: process.env })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('exit', () => resolve(out.trim().split('\n').filter(Boolean).map(JSON.parse)))
    child.stdin.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  })
}

test('OpenLex MCP server: initialize, list, call, errors', async () => {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'openlex_list_jurisdictions', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'openlex_search_firm_library', arguments: { query: 'x' } } },
    { jsonrpc: '2.0', id: 5, method: 'nope' },
  ])
  const byId = Object.fromEntries(res.map((r) => [r.id, r]))
  assert.strictEqual(byId[1].result.serverInfo.name, 'openlex')
  assert.deepStrictEqual(byId[2].result.tools.map((t) => t.name), ['openlex_search_law', 'openlex_get_law_section', 'openlex_search_eu_law', 'openlex_get_eu_law', 'openlex_list_jurisdictions'])
  assert.match(byId[3].result.content[0].text, /packs/i)
  assert.strictEqual(byId[4].result.isError, true, 'firm library is not exposed by default')
  assert.strictEqual(byId[5].error.code, -32601)
  assert.strictEqual(res.length, 5, 'no response to notifications')
})

test('firm library is exposed only when the user opts in', async () => {
  fs.writeFileSync(path.join(DATA, 'mcp-expose.json'), JSON.stringify({ firmLibrary: true }))
  const [r] = await rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])
  assert.ok(r.result.tools.some((t) => t.name === 'openlex_search_firm_library'))
  fs.rmSync(path.join(DATA, 'mcp-expose.json'))
})

test('client: connects, namespaces tools, joins the agent catalog', async () => {
  mcp.upsertServer('openlex', { command: process.execPath, args: [SERVER], remote: false })
  mcp.upsertServer('echo', { command: process.execPath, args: [ECHO] }) // remote by default
  const st = await mcp.connectAll()
  assert.deepStrictEqual(st.map((s) => [s.name, s.connected, s.remote]), [['openlex', true, false], ['echo', true, true]])
  assert.ok(mcp.hasTool('mcp__openlex__openlex_list_jurisdictions'))
  assert.ok(mcp.hasTool('mcp__echo__echo'))

  const { getCatalogText, getSchemas } = require('../src/catalog')
  assert.match(getCatalogText(), /mcp__echo__echo: Echo text back \(external service\)/)
  assert.match(getSchemas(['mcp__echo__echo']).mcp__echo__echo.input.text, /what to echo/)
})

test('client: local servers allowed, remote servers need the data policy', async () => {
  const local = await mcp.callTool('mcp__openlex__openlex_list_jurisdictions', {})
  assert.match(local.output, /packs/i)

  const blocked = await mcp.callTool('mcp__echo__echo', { text: 'client secret' })
  assert.match(blocked.output, /BLOCKED by data policy/)

  policy.setRule(null, { mode: 'allow-list', providers: ['mcp:echo'] })
  const ok = await mcp.callTool('mcp__echo__echo', { text: 'hi' })
  assert.strictEqual(ok.output, 'ECHO:hi')

  // Privileged matter stays closed even with the default allow-list.
  policy.setRule('m_priv', { mode: 'local-only' })
  const priv = await policy.withMatter('m_priv', () => mcp.callTool('mcp__echo__echo', { text: 'x' }))
  assert.match(priv.output, /BLOCKED/)

  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  assert.ok(!audit.includes('client secret'), 'audit never stores arguments')
})

test('dispatch routes mcp__ tools; get_tool_schemas works for built-ins', async () => {
  const { dispatch } = require('../src/tools')
  const r = await dispatch({}, 'mcp__echo__echo', { text: 'via dispatch' })
  assert.strictEqual(r.output, 'ECHO:via dispatch')
  const s = await dispatch({}, 'get_tool_schemas', { names: ['search_law', 'mcp__echo__echo'] })
  const parsed = JSON.parse(s.output)
  assert.ok(parsed.search_law && parsed.mcp__echo__echo)
})
