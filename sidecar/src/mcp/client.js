"use strict"
/**
 * MCP client — connectors (DMS, mail, drives, court portals …) plug into the
 * agent as Model Context Protocol servers.
 *
 *   ~/.lexvault/mcp-servers.json
 *   { "servers": { "imanage": { "command": "npx", "args": ["-y", "imanage-mcp"],
 *                               "env": {}, "enabled": true, "remote": true } } }
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0 (MCP 2025-06-18).
 * Tools appear to the agent as mcp__<server>__<tool>.
 *
 * Privacy: a server marked `remote: true` (it forwards data off this
 * machine — a cloud DMS, a SaaS API) is treated like a cloud model
 * provider: its tool calls need the matter's data policy to allow
 * "mcp:<server>". Local servers (filesystem, on-prem DMS) are allowed.
 * Every call is audited (metadata only).
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { DATA_DIR } = require('../config')
const policy = require('../policy')

const CONFIG_PATH = path.join(DATA_DIR, 'mcp-servers.json')
const PROTOCOL_VERSION = '2025-06-18'
const CALL_TIMEOUT_MS = 60000
const MAX_RESULT_CHARS = 12000

const clean = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return c.servers && typeof c.servers === 'object' ? c.servers : {}
  } catch { return {} }
}

function saveConfig(servers) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ servers }, null, 2), { mode: 0o600 })
}

class StdioConnection {
  constructor(name, cfg) {
    this.name = name
    this.cfg = cfg
    this.nextId = 1
    this.pending = new Map()
    this.tools = []
    this.error = null
    this.child = null
  }

  start() {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cfg.command, this.cfg.args || [], {
        env: { ...process.env, ...(this.cfg.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      let buf = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (d) => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line) continue
          let msg
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve: ok, reject: fail, timer } = this.pending.get(msg.id)
            clearTimeout(timer)
            this.pending.delete(msg.id)
            if (msg.error) fail(new Error(msg.error.message || 'MCP error'))
            else ok(msg.result)
          }
        }
      })
      child.stderr.on('data', () => { /* servers log here; ignore */ })
      child.on('error', (err) => { this.error = err.message; reject(err) })
      child.on('exit', (code) => {
        this.error = this.error || `exited (${code})`
        for (const { reject: fail, timer } of this.pending.values()) { clearTimeout(timer); fail(new Error(`MCP server ${this.name} ${this.error}`)) }
        this.pending.clear()
      })
      child.on('spawn', resolve)
    })
  }

  request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    if (!this.child || this.child.exitCode !== null) return Promise.reject(new Error(`MCP server ${this.name} is not running`))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${this.name} ${method} timed out`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  notify(method, params) {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  async init() {
    await this.start()
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'openlex', version: '0.2.0' },
    }, 20000)
    this.notify('notifications/initialized', {})
    const r = await this.request('tools/list', {}, 20000)
    this.tools = (r.tools || []).map((t) => ({
      name: t.name,
      qualified: `mcp__${clean(this.name)}__${clean(t.name)}`,
      description: String(t.description || '').slice(0, 300),
      inputSchema: t.inputSchema || { type: 'object' },
    }))
  }

  stop() {
    try { this.child?.kill() } catch { /* gone */ }
  }
}

const connections = new Map() // name → StdioConnection

async function connectAll() {
  const servers = loadConfig()
  for (const [name, c] of connections) {
    if (!servers[name] || servers[name].enabled === false) { c.stop(); connections.delete(name) }
  }
  await Promise.all(Object.entries(servers).map(async ([name, cfg]) => {
    if (cfg.enabled === false || connections.has(name)) return
    if (!cfg.command) return
    const conn = new StdioConnection(name, cfg)
    connections.set(name, conn)
    try {
      await conn.init()
    } catch (err) {
      conn.error = err.message
      conn.stop()
    }
  }))
  return status()
}

function stopAll() {
  for (const c of connections.values()) c.stop()
  connections.clear()
}

function allTools() {
  const out = []
  for (const c of connections.values()) {
    if (c.error) continue
    for (const t of c.tools) out.push({ ...t, server: c.name, remote: !!c.cfg.remote })
  }
  return out
}

function findTool(qualified) {
  return allTools().find((t) => t.qualified === qualified) || null
}

function hasTool(qualified) {
  return !!findTool(qualified)
}

/** Catalog lines for the agent's system prompt. */
function catalogLines() {
  return allTools().map((t) => `- ${t.qualified}: ${t.description || t.name}${t.remote ? ' (external service)' : ''}`)
}

function schemaFor(qualified) {
  const t = findTool(qualified)
  if (!t) return null
  const props = t.inputSchema?.properties || {}
  const input = {}
  for (const [k, v] of Object.entries(props)) input[k] = `${v.type || 'any'}${v.description ? ` — ${String(v.description).slice(0, 80)}` : ''}`
  return { input, description: t.description }
}

async function callTool(qualified, args) {
  const t = findTool(qualified)
  if (!t) throw new Error(`unknown MCP tool ${qualified}`)
  const matter = policy.currentMatter()
  const descriptor = { id: `mcp:${t.server}`, local: !t.remote }
  const decision = policy.check(descriptor, matter)
  if (!decision.allowed) {
    policy.audit({ provider: descriptor.id, model: t.name, matter, call: 'mcp', decision: 'blocked', reason: decision.reason })
    return { output: `BLOCKED by data policy: ${decision.reason}. The user can allow "mcp:${t.server}" in Settings → Data policy.` }
  }
  const t0 = Date.now()
  try {
    const r = await connections.get(t.server).request('tools/call', { name: t.name, arguments: args || {} })
    const text = (r.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
    policy.audit({ provider: descriptor.id, model: t.name, matter, call: 'mcp', decision: 'allowed', ok: !r.isError, ms: Date.now() - t0, outChars: text.length })
    const out = text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '\n…[truncated]' : text
    return { output: r.isError ? `MCP TOOL ERROR: ${out}` : out }
  } catch (err) {
    policy.audit({ provider: descriptor.id, model: t.name, matter, call: 'mcp', decision: 'allowed', ok: false, ms: Date.now() - t0, error: String(err.message).slice(0, 200) })
    return { output: `MCP ERROR (${t.server}): ${err.message}` }
  }
}

function status() {
  const servers = loadConfig()
  return Object.entries(servers).map(([name, cfg]) => {
    const c = connections.get(name)
    return {
      name, command: cfg.command, args: cfg.args || [], enabled: cfg.enabled !== false, remote: !!cfg.remote,
      connected: !!(c && !c.error), error: c?.error || null, tools: c && !c.error ? c.tools.map((t) => t.qualified) : [],
    }
  })
}

function upsertServer(name, cfg) {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) throw new Error('server name: letters, digits, - and _ only')
  if (!cfg || typeof cfg.command !== 'string' || !cfg.command.trim()) throw new Error('command is required')
  const servers = loadConfig()
  const prev = connections.get(name)
  if (prev) { prev.stop(); connections.delete(name) }
  servers[name] = {
    command: cfg.command.trim(),
    args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
    env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
    enabled: cfg.enabled !== false,
    // Unknown → remote: the safe default is that a connector sends data out.
    remote: cfg.remote !== false,
  }
  saveConfig(servers)
}

function removeServer(name) {
  const servers = loadConfig()
  delete servers[name]
  saveConfig(servers)
  connections.get(name)?.stop()
  connections.delete(name)
}

module.exports = { connectAll, stopAll, allTools, hasTool, catalogLines, schemaFor, callTool, status, upsertServer, removeServer, CONFIG_PATH }
