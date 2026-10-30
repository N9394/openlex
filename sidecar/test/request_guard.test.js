"use strict"
/**
 * Which requests the engine answers (request_guard.js): only those
 * addressed to this machine's loopback on the engine's port (no DNS
 * rebinding), without a foreign Origin and not marked cross-site by the
 * browser. Local programs and the panes keep working.
 *
 *   node --test test/request_guard.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const guard = require('../src/request_guard')
const PORT = 18001
const req = (headers) => ({ headers })
const verdict = (headers, trusted = new Set()) => guard.check(req(headers), { port: PORT, trusted })

test('local programs (no Origin, loopback Host) and the panes (same origin) are answered', () => {
  for (const h of [
    { host: '127.0.0.1:18001' },
    { host: 'localhost:18001' },
    { host: '[::1]:18001' },
    { host: 'LOCALHOST:18001', 'x-openlex-client': 'tui' },
    { host: 'localhost:18001', origin: 'https://localhost:18001', 'sec-fetch-site': 'same-origin' },
    { host: '127.0.0.1:18001', origin: 'http://127.0.0.1:18001' },
    { host: 'localhost:18001', 'sec-fetch-site': 'same-origin' },
    { host: 'localhost:18001', 'sec-fetch-site': 'none' },
  ]) assert.deepStrictEqual(verdict(h), { ok: true }, JSON.stringify(h))
})

test('DNS rebinding: a request addressed to another name or port is refused', () => {
  for (const host of ['evil.example:18001', 'evil.example', '127.0.0.1.nip.io:18001', 'localhost.evil.example:18001', '127.0.0.1:18002', '0.0.0.0:18001', '', 'localhost:18001:1', '[::ffff:7f00:1]:18001']) {
    const v = verdict({ host, 'sec-fetch-site': 'same-origin' })
    assert.strictEqual(v.ok, false, host)
    assert.strictEqual(v.status, 421, host)
  }
  assert.strictEqual(verdict({}).ok, false, 'no Host header at all')
})

test('a foreign Origin is refused, also null and other schemes', () => {
  for (const origin of ['https://evil.example', 'http://localhost:3000', 'null', 'file://', 'chrome-extension://abc', 'https://localhost:18002', 'http://evil.example:18001']) {
    const v = verdict({ host: 'localhost:18001', origin })
    assert.strictEqual(v.ok, false, origin)
    assert.strictEqual(v.status, 403, origin)
  }
})

test('cross-site browser requests without an Origin (img, script, form GET) are refused', () => {
  for (const site of ['cross-site', 'same-site', 'CROSS-SITE']) {
    const v = verdict({ host: '127.0.0.1:18001', 'sec-fetch-site': site, 'sec-fetch-mode': 'no-cors' })
    assert.strictEqual(v.ok, false, site)
    assert.strictEqual(v.status, 403)
  }
})

test('origins the firm trusts explicitly (a desktop dev server) are answered', () => {
  const trusted = new Set(['http://localhost:5173'])
  assert.deepStrictEqual(verdict({ host: '127.0.0.1:18001', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site' }, trusted), { ok: true })
  assert.strictEqual(verdict({ host: '127.0.0.1:18001', origin: 'http://localhost:5174', 'sec-fetch-site': 'same-site' }, trusted).ok, false)
  assert.deepStrictEqual([...guard.trustedOrigins({ OPENLEX_TRUSTED_ORIGINS: ' http://a:1 ,,app://openlex' })], ['http://a:1', 'app://openlex'])
})

test('a Host without a port only fits an engine on 80/443', () => {
  assert.strictEqual(guard.hostOk(req({ host: 'localhost' }), 18001), false)
  assert.strictEqual(guard.hostOk(req({ host: 'localhost' }), 443), true)
})

// ── the running engine ────────────────────────────────────────────────────

function call(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => resolve({ status: res.statusCode, raw, headers: res.headers }))
    })
    r.on('error', reject)
    r.end()
  })
}

test('the engine refuses rebinding and cross-site requests on every route, and answers local ones', async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-guard-'))
  const port = 19800 + Math.floor(Math.random() * 150)
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, LEXVAULT_DATA_DIR: DATA, OPENLEX_DATA_DIR: DATA, LEXVAULT_SIDECAR_PORT: String(port), LEXVAULT_LLM_URL: 'http://127.0.0.1:1', LEXVAULT_QDRANT_URL: 'http://127.0.0.1:1', LEXVAULT_SIDECAR_CERT: '/nonexistent', LEXVAULT_SIDECAR_KEY: '/nonexistent', OPENLEX_MONITORS: '0', LEXVAULT_KEEPALIVE: '1', OPENLEX_TRUSTED_ORIGINS: '' },
    stdio: 'ignore',
  })
  try {
    let up = false
    for (let i = 0; i < 150 && !up; i++) {
      try { up = (await call(port, '/health')).status === 200 } catch { /* starting */ }
      if (!up) await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(up, 'engine started')
    assert.strictEqual((await call(port, '/api/sessions')).status, 200, 'a local program is answered')
    assert.strictEqual((await call(port, '/api/sessions', { Host: `localhost:${port}`, Origin: `https://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin' })).status, 200, 'the pane is answered')
    const rebound = await call(port, '/api/sessions', { Host: `attacker.example:${port}`, 'Sec-Fetch-Site': 'same-origin' })
    assert.strictEqual(rebound.status, 421)
    assert.doesNotMatch(rebound.raw, /sessions/)
    assert.strictEqual((await call(port, '/api/hub/info', { Host: `attacker.example:${port}`, 'Sec-Fetch-Site': 'same-origin' })).status, 421, 'the hub cannot be reached by a rebinding page posing as the pane')
    assert.strictEqual((await call(port, '/taskpane.html', { Host: `attacker.example:${port}` })).status, 421)
    const framed = await call(port, '/taskpane.html', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'iframe' })
    assert.strictEqual(framed.status, 200, 'Office on the web frames the pane')
    assert.match(framed.headers['content-security-policy'] || '', /frame-ancestors 'self' https:\/\/\*\.office\.com/)
    assert.strictEqual((await call(port, '/api/sessions', { Origin: 'https://attacker.example' })).status, 403)
    const img = await call(port, '/api/sessions', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors' })
    assert.strictEqual(img.status, 403)
    assert.strictEqual(img.headers['access-control-allow-origin'], undefined)
  } finally {
    child.kill()
    await new Promise((r) => setTimeout(r, 200))
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})

test('the pane\'s own files may be framed by Office on the web (cross-site GET), the API never', () => {
  const isStatic = (r) => r.url.startsWith('/taskpane')
  const ask = (h, url = '/taskpane.html', method = 'GET') => guard.check({ headers: h, url, method }, { port: PORT, trusted: new Set(), isStatic })
  assert.deepStrictEqual(ask({ host: 'localhost:18001', 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' }), { ok: true })
  assert.strictEqual(ask({ host: 'localhost:18001', 'sec-fetch-site': 'cross-site' }, '/api/sessions').ok, false)
  assert.strictEqual(ask({ host: 'localhost:18001', 'sec-fetch-site': 'cross-site' }, '/taskpane.html', 'POST').ok, false)
  assert.strictEqual(ask({ host: 'evil.example:18001', 'sec-fetch-site': 'cross-site' }).ok, false, 'Host still checked')
})
