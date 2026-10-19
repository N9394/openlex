/**
 * App runs the OpenLex engine when Word hasn't (one hub for both).
 *
 *   node --test desktop/electron/test/engine.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-engine-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.LEXVAULT_SIDECAR_PORT = String(18500 + Math.floor(Math.random() * 400))
process.env.LEXVAULT_SIDECAR_CERT = '/nonexistent'
process.env.LEXVAULT_SIDECAR_KEY = '/nonexistent'

const { ensureEngine, stopEngine } = require('../main/engine')
const { HubClient } = require('../main/hub-client')
test.after(() => { stopEngine(); fs.rmSync(DATA, { recursive: true, force: true }) })

const opts = {
  engineDir: path.join(ROOT, 'sidecar', 'src'),
  logPath: path.join(DATA, 'engine.log'),
  llmProxy: 'http://127.0.0.1:1',
  qdrantUrl: 'http://127.0.0.1:1',
}

test('starts the engine once, then reuses the running one', async () => {
  const first = await ensureEngine(opts)
  assert.strictEqual(first.owned, true, fs.existsSync(opts.logPath) ? fs.readFileSync(opts.logPath, 'utf8').slice(-800) : 'no log')
  assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+$/)
  const second = await ensureEngine(opts)
  assert.deepStrictEqual(second, { owned: false, url: first.url })
})

test('App reaches the engine API (providers, matters, workflows stream)', async () => {
  const app = new HubClient({ version: 't', backend: 'x' })
  const st = await app.request('GET', '/api/status')
  assert.strictEqual(st.model.provider, 'local')
  const m = await app.request('POST', '/api/matters', { title: 'From the App' })
  assert.strictEqual(m.matter.title, 'From the App')
  const events = []
  await app.stream('/api/workflows/run', { type: 'review', matterId: m.matter.id }, (ev) => events.push(ev))
  assert.strictEqual(events[events.length - 1].type, 'error', 'no model and no documents → a clear error, not a hang')
})
