// A test stack for the desktop client in a plain browser: a fake
// OpenAI-compatible model, the real engine (sidecar/) on spare ports with a
// throw-away data folder, and a static server for the built client
// (desktop/client/dist) with an /__engine proxy. BRIDGE stands in for the
// Electron preload (window.lexvault). No paid calls, no real keys, no local LLMs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const ENGINE_PORT = Number(process.env.E2E_ENGINE_PORT || 18271)
const MODEL_PORT = ENGINE_PORT + 1
export const WEB_PORT = ENGINE_PORT + 2

const ANSWER = '**Short answer:** under § 879 ABGB a two-year non-compete is enforceable only if it is reasonable.\n\n| Point | Assessment |\n|---|---|\n| Duration | two years: likely too long |\n| Territory | EU-wide: likely too wide |\n\nArbeitnehmerschutzvorschriftenumsetzungsgesetzesnovellierungsverordnung.'

/**
 * opts.answer(prompt, body) → the fake model's reply (default: a fixed answer);
 * the returned `seen` holds every prompt the fake model received.
 */
export async function startStack(opts = {}) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-e2e-'))
  const seen = []
  const model = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* empty */ }
      const prompt = (body.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
      seen.push(prompt)
      const reply = opts.answer ? opts.answer(prompt, body) : ANSWER
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        for (const piece of reply.match(/.{1,40}/gs)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
        res.write('data: [DONE]\n\n'); return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    })
  })
  await new Promise((r) => model.listen(MODEL_PORT, '127.0.0.1', r))

  const env = { ...process.env, LEXVAULT_DATA_DIR: DATA, OPENLEX_DATA_DIR: DATA, LEXVAULT_SIDECAR_PORT: String(ENGINE_PORT), OPENLEX_KEY_OPENAI: 'sk-test-fake', OPENLEX_MONITORS: '0',
    LEXVAULT_SIDECAR_CERT: '/nonexistent', LEXVAULT_SIDECAR_KEY: '/nonexistent', LEXVAULT_LLM_URL: 'http://127.0.0.1:1', LEXVAULT_QDRANT_URL: 'http://127.0.0.1:2', OLLAMA_HOST: 'http://127.0.0.1:3', LEXVAULT_KEEPALIVE: '1',
    OPENLEX_TRUSTED_ORIGINS: `http://127.0.0.1:${WEB_PORT}` }
  const out = execFileSync(process.execPath, ['-e', `
    const s = require('./src/providers/settings')
    s.update({ provider: 'openai', overrides: { baseUrl: 'http://127.0.0.1:${MODEL_PORT}/v1', model: 'gpt-test', nativeTools: false } })
    s.update({ active: 'openai' })
    require('./src/cloud_notice').acknowledge('openai')
    require('./src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
    require('./src/agent-config').save({ workspace: ${JSON.stringify(path.join(DATA, 'workspace'))} })
    const M = require('./src/matters')
    const a = M.create({ title: 'Alpine share deal', client: 'Alpine AG', number: '2026-014' })
    M.create({ title: 'Gewährleistungsansprüche aus dem Unternehmenskaufvertrag Müller-Lüdenscheidt', client: 'Müller-Lüdenscheidt Beteiligungsverwaltungsgesellschaft mbH', number: '2026-0815', privileged: true })
    M.create({ title: 'Lease renewal Vienna office', client: 'Beta Retail AG' })
    M.setActive('app', a.id)
    console.log(JSON.stringify({ a: a.id }))
  `], { cwd: path.join(ROOT, 'sidecar'), env })
  const ids = JSON.parse(String(out).trim().split('\n').pop())
  const engine = spawn(process.execPath, ['src/server.js'], { cwd: path.join(ROOT, 'sidecar'), env, stdio: ['ignore', 'ignore', process.env.E2E_VERBOSE ? 'inherit' : 'ignore'] })
  let up = false
  for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${ENGINE_PORT}/health`)).ok } catch { /* starting */ } if (!up) await new Promise((r) => setTimeout(r, 100)) }
  if (!up) throw new Error('the engine did not start')

  const DIST = path.join(ROOT, 'desktop', 'client', 'dist')
  const web = http.createServer((req, res) => {
    if (req.url.startsWith('/__engine/')) {
      const headers = { 'content-type': req.headers['content-type'] || 'application/json', 'x-openlex-client': 'app' }
      const upReq = http.request({ host: '127.0.0.1', port: ENGINE_PORT, path: req.url.slice('/__engine'.length), method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
      upReq.on('error', () => { try { res.writeHead(502); res.end('{}') } catch { /* closed */ } })
      req.pipe(upReq); res.on('close', () => upReq.destroy())
      return
    }
    let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]))
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(f)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(f).pipe(res)
  })
  await new Promise((r) => web.listen(WEB_PORT, '127.0.0.1', r))
  const stop = () => { try { engine.kill() } catch { /* gone */ } model.close(); web.close(); try { fs.rmSync(DATA, { recursive: true, force: true }) } catch { /* busy */ } }
  return { DATA, ids, stop, seen }
}

/** Stand-in for the Electron preload: the engine through the proxy, matters, a few no-ops. */
export const BRIDGE = (activeId) => `
(() => {
  const base = '/__engine'
  const streams = new Map()
  const noop = async () => ({})
  let active = ${JSON.stringify(activeId)}
  const engine = {
    call: async (method, p, body) => {
      const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status))
      return j
    },
    stream: async (p, body, onEvent, id) => {
      const ac = new AbortController()
      if (id) streams.set(id, ac)
      try {
        const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal })
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
        for (;;) {
          const { done, value } = await reader.read(); if (done) break
          buf += dec.decode(value, { stream: true })
          let i; while ((i = buf.indexOf('\\n\\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); for (const line of chunk.split('\\n')) if (line.startsWith('data:')) { try { onEvent(JSON.parse(line.slice(5))) } catch {} } }
        }
        return { ok: true, stopped: false }
      } catch (e) { if (ac.signal.aborted) return { ok: true, stopped: true }; throw e } finally { streams.delete(id) }
    },
    stop: async (id) => { const ac = streams.get(id); if (ac) ac.abort(); return { ok: !!ac } },
  }
  const known = {
    isElectron: true,
    getIdentity: async () => ({ account_id: null, email: null, tier: 'community', entitlements: [], community: true, canActivate: true }),
    getAppInfo: async () => ({ version: '0.0.0-test', platform: 'test', arch: 'x64', qdrant: { reachable: false, totalChunks: 0 } }),
    getDependencyStatus: async () => ({}),
    engine,
    matters: {
      list: async () => { const r = await engine.call('GET', '/api/matters'); return { matters: r.matters || [], active } },
      setActive: async (id) => { active = id || null; return { ok: true } },
      create: async (m) => (await engine.call('POST', '/api/matters', m)).matter,
      update: async (id, patch) => engine.call('POST', '/api/matters/update', { id, patch }),
    },
    hub: { status: async () => ({ connected: false }), onEvent: () => {}, onStatus: () => {}, sendToWord: noop },
    notify: noop,
  }
  window.lexvault = new Proxy(known, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('on') ? () => {} : noop)) })
})()
`
