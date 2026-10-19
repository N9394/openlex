"use strict"
/**
 * App-attach detection (B3): the sidecar must reuse the full-version App's
 * services instead of spawning its own llama-server / embeddings.
 *
 *   node test/attach.test.js
 *
 * Spins a fake "App supervisor" on :11434 that mimics the real one
 * (supervisor.js): /healthz answers instantly, /api/tags answers with a
 * fake model list, everything else passes through to a real llama-server
 * on :11534. Asserts:
 *   - ensureLlama attaches (owned=false) WITHOUT spawning our own server
 *   - llm.ping() goes through the cheap /api/tags path (no lazy spawn)
 *   - chat works through the proxy passthrough to the real llama-server
 *   - embeddings attach probe detects the fake :11435 service
 *   - with NO app running, ensureLlama spawns its own llama-server (owned)
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const MODEL = path.join(os.homedir(), '.lexvault', 'models', 'lotus-ai-q4km.gguf')
const EMB_PORT = parseInt(process.env.LEXVAULT_EMBEDDINGS_PORT || '0', 10) || 11435
const PROXY_PORT = 12734 // arbitrary, free port for the fake App proxy
const APP_INTERNAL_PORT = PROXY_PORT + 100

// Point the sidecar modules at the fake App services BEFORE they load.
process.env.LEXVAULT_EMBEDDINGS_URL = `http://127.0.0.1:${EMB_PORT}`
process.env.LEXVAULT_LLM_URL = `http://127.0.0.1:${PROXY_PORT}`

let llamaChild = null
function spawnLlama() {
  llamaChild = spawn('./bin/llama-server',
    ['-m', MODEL, '--host', '127.0.0.1', '--port', String(APP_INTERNAL_PORT),
     '--api-prefix', '/api', '--ctx-size', '8192', '-ngl', '999', '--threads', '4'],
    { stdio: 'ignore' })
}

// Fake App LLM proxy: /healthz + /api/tags answered locally (no model
// load), everything else passed through to the internal llama-server.
function appProxy() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/healthz/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, llmRunning: !!llamaChild, idleMs: 240000 }))
    }
    if (req.method === 'GET' && (req.url === '/api/tags' || req.url === '/api/tags/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ models: [{ name: 'local', model: 'local' }, { name: 'local-fast', model: 'local' }] }))
    }
    if (!llamaChild) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'llm spawn: model loading' }))
    }
    const proxy = http.request({ host: '127.0.0.1', port: APP_INTERNAL_PORT, method: req.method, path: req.url },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res) })
    proxy.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })) })
    req.pipe(proxy)
  })
}

// Fake App embeddings service: health JSON only (matches server.js shape).
function embeddingsService() {
  return http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ service: 'lexvault-embeddings', status: 'ready', sparse: 'enabled' }))
    }
    res.writeHead(404); res.end()
  })
}

function countLlamaServers() {
  try {
    const out = require('child_process').execSync(`ps aux | grep '[l]lama-server' | grep -c .`, { encoding: 'utf8' }).trim()
    return parseInt(out, 10) || 0
  } catch { return 0 }
}

;(async () => {
  if (!fs.existsSync(MODEL)) {
    console.log('SKIP — Lotus GGUF not installed')
    return process.exit(0)
  }

  console.log('\nattach.test.js — App-attach detection for llama + embeddings')
  const before = countLlamaServers()

  const embServer = embeddingsService()
  await new Promise((r) => embServer.listen(EMB_PORT, '127.0.0.1', r))

  const proxy = appProxy()
  await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r))
  console.log(`  … fake App proxy on :${PROXY_PORT}, fake embeddings on :${EMB_PORT}`)

  // 1. Attach: no spawn, owned=false, App proxy detected via /healthz
  const runtime = require('../src/runtime')
  const s1 = await runtime.ensureLlama()
  assert.strictEqual(s1.ok, true, `attach: ${s1.reason}`)
  assert.strictEqual(s1.owned, false, 'attached, not spawned')
  assert.ok(s1.reason.includes("App's LLM proxy"), `reason mentions App proxy: ${s1.reason}`)
  assert.strictEqual(countLlamaServers(), before, 'NO own llama-server spawned')
  console.log('  ok  attach to App LLM proxy without spawning:', s1.reason)

  // 2. ping through cheap /api/tags — no lazy spawn of our own llama
  const llm = require('../src/llm')
  const ping = await llm.ping()
  assert.strictEqual(ping.ok, true)
  assert.strictEqual(countLlamaServers(), before, 'ping did not spawn anything')
  console.log('  ok  ping via /api/tags (no spawn):', ping.models.join(', '))

  // 3. Real chat through the proxy passthrough (llama-server on :11534)
  spawnLlama() // the "App" model comes up lazily, like the real supervisor
  await new Promise((r) => setTimeout(r, 12000))
  const out = await llm.chat([
    { role: 'system', content: 'Answer in one short sentence.' },
    { role: 'user', content: 'Reply with exactly: PROXYOK' },
  ], { maxTokens: 32 })
  assert.ok(out.trim().length > 0, 'completion through App proxy')
  console.log('  ok  chat through App proxy →', JSON.stringify(out.trim().slice(0, 50)))

  // 4. Embeddings attach probe
  const embeddings = require('../src/embeddings')
  const h = await embeddings.appHealth()
  assert.strictEqual(h.ok, true)
  assert.strictEqual(h.status, 'ready')
  console.log('  ok  embeddings attach probe:', h.status, h.service)

  // 5. Teardown proxy → standalone mode spawns its own llama-server
  await new Promise((r) => proxy.close(r))
  await new Promise((r) => setTimeout(r, 500))
  const runtime2 = require('../src/runtime') // same module, re-probes
  const s2 = await runtime2.ensureLlama()
  assert.strictEqual(s2.ok, true)
  assert.strictEqual(s2.owned, true, 'no App → we spawn')
  console.log('  ok  no App → own spawn:', s2.reason)
  runtime2.stop()

  embServer.close()
  if (llamaChild) llamaChild.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1500))
  assert.strictEqual(countLlamaServers(), before, 'everything reaped')
  console.log('\nall attach checks passed')
})().catch((err) => {
  console.error('FAIL:', err.message)
  try { require('../src/runtime').stop() } catch {}
  process.exit(1)
})
