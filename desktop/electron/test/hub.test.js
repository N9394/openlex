/**
 * App ↔ Word plugin link, end to end without Electron.
 *
 *   node --test desktop/electron/test/hub.test.js
 *
 * Starts the real Word sidecar (temp data dir), connects the App's
 * HubClient, and checks: discovery + token auth, app → Word insert-text
 * (with replay to a late subscriber), Word → app open-in-app, and the App's
 * LLM proxy routing through the shared engine to a (fake) cloud provider
 * under the shared data policy.
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-hub-'))
const PORT = 18000 + Math.floor(Math.random() * 500) + 300
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

let sidecar
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(100) }
  throw new Error('timeout')
}

test.before(async () => {
  sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'src', 'server.js')], {
    env: { ...process.env, LEXVAULT_SIDECAR_PORT: String(PORT), LEXVAULT_LLM_URL: 'http://127.0.0.1:1', LEXVAULT_SIDECAR_CERT: '/nonexistent', LEXVAULT_SIDECAR_KEY: '/nonexistent', LEXVAULT_KEEPALIVE: '1' },
    stdio: 'ignore',
  })
  await until(() => fs.existsSync(path.join(DATA, 'run', 'sidecar.json')))
})
test.after(() => { sidecar?.kill(); fs.rmSync(DATA, { recursive: true, force: true }) })

const { HubClient, readSidecar } = require('../main/hub-client')

function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, headers }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }))
    }).on('error', reject)
  })
}

test('sidecar registers itself; hub refuses requests without the token', async () => {
  const reg = readSidecar()
  assert.strictEqual(reg.url, `http://127.0.0.1:${PORT}`)
  assert.strictEqual((await get('/api/hub/info')).status, 401)
  assert.strictEqual((await get('/api/hub/info', { Authorization: 'Bearer ' + 'f'.repeat(64) })).status, 401)
  const mode = fs.statSync(path.join(DATA, 'run', 'hub.token')).mode & 0o777
  if (process.platform !== 'win32') assert.strictEqual(mode, 0o600) // no POSIX modes on Windows (profile ACL)
})

test('app connects, sends text to Word, receives open-in-app', async () => {
  const events = []
  const app = new HubClient({ version: '9.9.9', backend: 'http://127.0.0.1:18000', onEvent: (e) => events.push(e) })
  app.start()
  try {
    await until(() => app.status().connected)
    const info = await app.info()
    assert.strictEqual(info.peers.app.running, true, 'sidecar sees the app via app.json')
    assert.strictEqual(info.provider.id, 'local')

    // App → Word: a pane that subscribes later still gets the handoff.
    const sent = await app.send('insert-text', { text: '§ 1295 ABGB: Schadenersatz …', source: 'Research' })
    const pane = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/hub/events', headers: { 'Sec-Fetch-Site': 'same-origin' } }, (res) => {
        let buf = ''
        res.on('data', (d) => {
          buf += d
          if (buf.includes('insert-text')) { req.destroy(); resolve(buf) }
        })
      })
    })
    assert.ok(pane.includes(sent.event.id))
    assert.ok(pane.includes('1295 ABGB'))

    // Word → App
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ type: 'open-in-app', data: { view: 'research', query: 'Verjährung Schadenersatz' } })
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/hub/events', method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve) })
      req.on('error', reject); req.end(body)
    })
    const ev = await until(() => events.find((e) => e.type === 'open-in-app'))
    assert.strictEqual(ev.from, 'word')
    assert.strictEqual(ev.data.query, 'Verjährung Schadenersatz')
    assert.ok(!events.some((e) => e.type === 'insert-text'), 'sender must not get its own event back')

    // Unknown event types are rejected
    await assert.rejects(app.send('delete-everything', {}), /unknown hub event/)
  } finally { app.stop() }
  assert.ok(!fs.existsSync(path.join(DATA, 'run', 'app.json')), 'app.json removed on stop')
})

test('App LLM proxy routes through the shared engine + policy for cloud providers', async () => {
  // Fake OpenAI-compatible provider
  const seen = []
  const fake = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c }); req.on('end', () => {
      seen.push(JSON.parse(raw))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Ja, ' } }] })}\n\n`)
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'drei Jahre.' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  try {
    const engineDir = path.join(ROOT, 'sidecar', 'src')
    const settings = require(path.join(engineDir, 'providers', 'settings.js'))
    const policy = require(path.join(engineDir, 'policy.js'))
    settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
    settings.update({ active: 'openai' })

    const Supervisor = require('../sidecars/supervisor')
    const sup = Object.create(Supervisor.prototype)
    sup.paths = { engine: engineDir }
    sup._ensureLLMRunning = () => { throw new Error('local llama must not be touched for a cloud provider') }

    const proxy = http.createServer((req, res) => sup._handleOllamaChat(req, res).catch((e) => { res.writeHead(500); res.end(e.message) }))
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
    const call = (headers = {}) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.address().port, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
        const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }))
      })
      req.on('error', reject)
      req.end(JSON.stringify({ model: 'local', messages: [{ role: 'user', content: 'Verjährung?' }], stream: true, options: { num_predict: 300 } }))
    })
    try {
      // Shared default policy is local-only → blocked before any request leaves.
      const blocked = await call()
      assert.strictEqual(blocked.status, 403)
      assert.match(blocked.body, /data policy/)
      assert.strictEqual(seen.length, 0)

      // Allow it (as the Word pane would) → the App streams Ollama NDJSON from the cloud provider.
      policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
      const ok = await call({ 'X-OpenLex-Matter': 'M-42' })
      assert.strictEqual(ok.status, 200)
      const lines = ok.body.trim().split('\n').map(JSON.parse)
      assert.strictEqual(lines.filter((l) => !l.done).map((l) => l.message.content).join(''), 'Ja, drei Jahre.')
      assert.strictEqual(lines[lines.length - 1].done, true)
      assert.strictEqual(seen[0].max_completion_tokens, 300)
      const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse)
      assert.strictEqual(audit[audit.length - 1].matter, 'M-42')

      // The App's active matter (picked in its sidebar) governs calls without
      // a header: a privileged matter stays local even though the default
      // policy allows the cloud provider.
      const matters = require(path.join(engineDir, 'matters.js'))
      const priv = matters.create({ title: 'Internal investigation', privileged: true })
      matters.setActive('app', priv.id)
      const before = seen.length
      const privCall = await call()
      assert.strictEqual(privCall.status, 403)
      assert.strictEqual(seen.length, before, 'privileged matter data never reached the provider')
      matters.setActive('app', null)
      assert.strictEqual((await call()).status, 200)
    } finally { proxy.close() }
  } finally { fake.close() }
})

test('App chat on the engine: streamed answer through the hub, kept in the matter conversation; Stop ends the run', async () => {
  // Fake OpenAI-compatible model: "slow" questions stream slowly (time to press Stop).
  const fake = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c }); req.on('end', () => {
      const body = JSON.parse(raw)
      const slow = /slow/i.test(JSON.stringify(body.messages))
      const words = (slow ? 'This answer takes a long time to write. '.repeat(5) : 'A two-year non-compete is enforceable only if reasonable.').split(/(?<= )/)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      let i = 0
      const t = setInterval(() => {
        if (res.destroyed) return clearInterval(t)
        if (i >= words.length) { clearInterval(t); return res.end('data: [DONE]\n\n') }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`)
      }, slow ? 100 : 5)
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  try {
    const engineDir = path.join(ROOT, 'sidecar', 'src')
    const settings = require(path.join(engineDir, 'providers', 'settings.js'))
    const policy = require(path.join(engineDir, 'policy.js'))
    settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', nativeTools: false } })
    settings.update({ active: 'openai' })
    policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
    // This is about streaming through the hub; the redaction check has its own tests (sidecar/test/redaction.test.js).
    require(path.join(engineDir, 'redaction_check.js')).setCheck(false)
    const m = require(path.join(engineDir, 'matters.js')).create({ title: 'Alpine share deal' })

    const app = new HubClient({ version: '9.9.9', backend: 'http://127.0.0.1:18000', onEvent: () => {} })
    const events = []
    const r = await app.stream('/api/chat', { message: 'Is a two-year non-compete enforceable?', docId: `app:${m.id}`, sessionId: `app:${m.id}:1`, matterId: m.id, interactive: true }, (ev) => events.push(ev))
    assert.strictEqual(r, undefined)
    assert.match(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), /enforceable only if reasonable/)
    assert.ok(events.some((e) => e.type === 'model' && e.provider === 'openai'), 'the window learns where the data went')

    // The conversation every window lists for the matter: kept as the App's.
    const list = await app.request('GET', `/api/sessions?matterId=${m.id}`)
    assert.strictEqual(list.sessions[0].id, `app_${m.id}_1`)
    assert.deepStrictEqual(list.sessions[0].clients, ['app'])
    const conv = await app.request('GET', `/api/session?id=${encodeURIComponent(list.sessions[0].id)}`)
    assert.deepStrictEqual(conv.messages.map((x) => x.role), ['user', 'assistant'])
    assert.strictEqual(conv.messages[1].data[0].provider, 'openai')

    // Stop: the request is closed, the stream resolves, the engine keeps the turn as stopped.
    const ac = new AbortController()
    const seen = []
    const t0 = Date.now()
    await app.stream('/api/chat', { message: 'A slow question', docId: `app:${m.id}`, sessionId: `app:${m.id}:2`, matterId: m.id, interactive: true }, (ev) => { seen.push(ev); if (ev.type === 'model') ac.abort() }, ac.signal)
    assert.ok(Date.now() - t0 < 4000, 'Stop returns at once')
    assert.ok(!seen.some((e) => e.type === 'done' && !e.stopped), 'no finished answer after Stop')
    const stopped = await until(async () => (await app.request('GET', `/api/session?id=app_${m.id}_2`)).messages[1], 20000)
    assert.strictEqual(stopped.stopped, true)
    assert.ok(stopped.content.length < 400, 'only what the window had shown is kept')
  } finally { fake.close() }
})
