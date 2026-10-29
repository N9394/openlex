"use strict"
/**
 * The model picker: EU presets, the strict OpenRouter preset, the free
 * connection test, the model label, the cloud notice (once per service)
 * and "Download a local model" (Ollama / llama.cpp detection and pull).
 *
 *   node --test test/model_picker.test.js
 *
 * Offline: a fake OpenAI-compatible server, a fake Ollama, fake programs
 * on a fake PATH, a temp data dir. No real keys, no model runs.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-picker-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENROUTER = 'sk-or-test'
process.env.OPENLEX_KEY_SCALEWAY = 'scw-test'

const seen = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    seen.push({ method: req.method, url: req.url, headers: req.headers, body })
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization === 'Bearer wrong') return json(401, { error: { message: 'invalid api key' } })
    if (req.url === '/v1/chat/completions') return json(200, { choices: [{ message: { content: 'ok' } }] })
    if (req.url === '/v1/models') return json(200, { data: [{ id: 'gpt-oss-120b' }, { id: 'mistral-small-3.2-24b-instruct-2506' }] })
    if (req.url === '/v1/key') return json(200, { data: { label: 'test' } })
    // Fake Ollama
    if (req.url === '/api/version') return json(200, { version: '0.12.0' })
    if (req.url === '/api/tags') return json(200, { models: [{ name: 'llama3.2:3b', size: 2 * 1024 ** 3 }, { name: 'qwen3:14b', size: 9.3 * 1024 ** 3 }] })
    if (req.url === '/api/delete' && req.method === 'DELETE') return json(200, {})
    if (req.url === '/api/pull') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      if (body.model === 'nope:1b') { res.end(`${JSON.stringify({ error: 'pull model manifest: file does not exist' })}\n`); return }
      res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`)
      res.write(`${JSON.stringify({ status: 'pulling abc', digest: 'sha256:abc', total: 1000, completed: 250 })}\n`)
      res.write(`${JSON.stringify({ status: 'pulling abc', digest: 'sha256:abc', total: 1000, completed: 1000 })}\n`)
      res.write(`${JSON.stringify({ status: 'verifying sha256 digest' })}\n`)
      res.end(`${JSON.stringify({ status: 'success' })}\n`)
      return
    }
    json(404, {})
  })
})

let base
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${fake.address().port}`
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) })

const { PROVIDERS, GROUPS } = require('../src/providers/catalog')
const settings = require('../src/providers/settings')
const openai = require('../src/providers/openai')
const describe = require('../src/providers/describe')
const notice = require('../src/cloud_notice')
const policy = require('../src/policy')
const llm = require('../src/llm')

test('EU presets: OpenAI-compatible base URLs from the providers\' docs, EU regions, recommended order', () => {
  const want = {
    scaleway: 'https://api.scaleway.ai/v1',
    ovhcloud: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    stackit: 'https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1',
    ionos: 'https://openai.inference.de-txl.ionos.com/v1',
    mistral: 'https://api.mistral.ai/v1',
  }
  for (const [id, url] of Object.entries(want)) {
    const p = PROVIDERS[id]
    assert.strictEqual(p.baseUrl, url, id)
    assert.strictEqual(p.kind, 'openai', id)
    assert.strictEqual(p.group, 'eu', id)
    assert.ok(/^eu/.test(p.region), `${id} has an EU region`)
    assert.ok(!p.usParent, `${id} has no US parent`)
    assert.ok(p.defaultModel && p.about.en && p.about.de && p.company.de, id)
  }
  // Catalog order = picker order: local, EU, firm cloud, OpenRouter, direct, other.
  const order = Object.values(PROVIDERS).map((p) => GROUPS.indexOf(p.group))
  assert.ok(order.every((g) => g >= 0), 'every provider has a known group')
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b))
  assert.deepStrictEqual(['azure', 'bedrock', 'vertex'].map((id) => PROVIDERS[id].group), ['firm-cloud', 'firm-cloud', 'firm-cloud'])
  assert.strictEqual(PROVIDERS['local-server'].local, true)
})

test('OpenRouter strict preset: ZDR, no data collection, EU hosts only, no fallbacks, never first-party', () => {
  const p = settings.resolve('openrouter')
  assert.strictEqual(p.plan, 'standard')
  assert.strictEqual(p.baseUrl, 'https://openrouter.ai/api/v1')
  assert.strictEqual(p.region, null, 'standard plan: the US gateway, no EU region')
  const body = openai.buildBody(p, [{ role: 'user', content: 'hi' }], { maxTokens: 10 }, false)
  assert.deepStrictEqual(body.provider, {
    zdr: true, data_collection: 'deny', allow_fallbacks: false,
    only: ['amazon-bedrock/eu-west-1', 'google-vertex/europe', 'google-vertex/eu', 'azure/eu', 'mistral/eu'],
  })
  assert.ok(!body.provider.only.some((h) => /^(anthropic|openai)(\/|$)/.test(h)))
  settings.update({ provider: 'openrouter', overrides: { euProviders: false } })
  const loose = openai.buildBody(settings.resolve('openrouter'), [{ role: 'user', content: 'hi' }], {}, false)
  assert.strictEqual(loose.provider.zdr, true)
  assert.strictEqual(loose.provider.allow_fallbacks, false)
  assert.deepStrictEqual(loose.provider.ignore, ['anthropic', 'openai'])
  settings.update({ provider: 'openrouter', overrides: { euProviders: true } })
  // Models Bedrock keeps for review are refused before anything is sent.
  for (const m of ['anthropic/claude-fable-5', 'anthropic/claude-fable-5.1']) {
    assert.throws(() => openai.buildBody({ ...p, model: m }, [{ role: 'user', content: 'x' }], {}, false), /zero data retention/)
  }
  assert.doesNotThrow(() => openai.buildBody({ ...p, model: 'anthropic/claude-fable-5.5' }, [{ role: 'user', content: 'x' }], {}, false))
  // Other OpenAI-compatible services get no provider block.
  assert.strictEqual(openai.buildBody(settings.resolve('scaleway'), [{ role: 'user', content: 'x' }], {}, false).provider, undefined)
})

test('OpenRouter Business plan: the EU gateway and an EU region; standard is blocked by an "EU only" rule', () => {
  assert.throws(() => settings.update({ provider: 'openrouter', overrides: { plan: 'gold' } }), /standard or business/)
  settings.update({ provider: 'openrouter', overrides: { plan: 'business' } })
  const b = settings.resolve('openrouter')
  assert.strictEqual(b.baseUrl, 'https://eu.openrouter.ai/api/v1')
  assert.strictEqual(b.region, 'eu')
  policy.setRule(null, { mode: 'allow-list', providers: ['openrouter'], regions: ['eu'] })
  assert.strictEqual(policy.check(b, null).allowed, true)
  settings.update({ provider: 'openrouter', overrides: { plan: 'standard', region: 'eu' } })
  const s = settings.resolve('openrouter')
  assert.strictEqual(s.region, null, 'a region setting cannot hide the US gateway')
  assert.strictEqual(policy.check(s, null).allowed, false)
  policy.setRule(null, { mode: 'local-only' })
})

test('the request OpenRouter receives carries the strict preset', async () => {
  settings.update({ provider: 'openrouter', overrides: { baseUrl: `${base}/v1`, model: 'anthropic/claude-sonnet-4.5' } })
  seen.length = 0
  await openai.complete(settings.resolve('openrouter'), 'sk-or-test', [{ role: 'user', content: 'hi' }], { maxTokens: 5 })
  const r = seen.find((x) => x.url === '/v1/chat/completions')
  assert.strictEqual(r.body.provider.zdr, true)
  assert.strictEqual(r.body.provider.data_collection, 'deny')
  assert.strictEqual(r.body.provider.allow_fallbacks, false)
  assert.strictEqual(r.headers.authorization, 'Bearer sk-or-test')
})

test('connection test sends no text: OpenRouter checks the key, others list their models — even under local-only', async () => {
  assert.strictEqual(policy.load().default.mode, 'local-only')
  seen.length = 0
  const or = await llm.testProvider('openrouter')
  assert.deepStrictEqual([or.ok, or.checked], [true, 'key'])
  settings.update({ provider: 'scaleway', overrides: { baseUrl: `${base}/v1` } })
  const sc = await llm.testProvider('scaleway')
  assert.strictEqual(sc.ok, true)
  assert.deepStrictEqual(sc.models, ['gpt-oss-120b', 'mistral-small-3.2-24b-instruct-2506'])
  assert.ok(!seen.some((x) => x.url.includes('chat/completions')), 'no model call')
  assert.deepStrictEqual(seen.map((x) => x.url), ['/v1/key', '/v1/models'])
  process.env.OPENLEX_KEY_SCALEWAY = 'wrong'
  await assert.rejects(() => llm.testProvider('scaleway'), /401/)
  process.env.OPENLEX_KEY_SCALEWAY = 'scw-test'
  await assert.rejects(() => llm.testProvider('ionos'), (err) => err.code === 'NO_KEY')
})

test('an AI program "on this computer" must be on this computer', () => {
  assert.throws(() => settings.update({ provider: 'local-server', overrides: { baseUrl: 'https://ai.example.com/v1' } }), /127\.0\.0\.1 or localhost/)
  settings.update({ provider: 'local-server', overrides: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'qwen3:8b' } })
  const p = settings.resolve('local-server')
  assert.strictEqual(p.local, true)
  assert.strictEqual(policy.check(p, null).allowed, true, 'local-only allows it')
  assert.strictEqual(require('../src/models').profileFor({ kind: 'local', model: p.model }).tools, 'json')
})

test('model label: which AI and where, in a few words (EN + DE)', () => {
  const L = (id, extra = {}) => describe.label({ ...settings.resolve(id), model: settings.resolve(id).model || settings.resolve(id).defaultModel, ...extra }, { localModel: 'qwen3:8b' })
  assert.deepStrictEqual([L('local').en, L('local').de], ['On this computer · Qwen3 8B', 'Auf diesem Computer · Qwen3 8B'])
  assert.strictEqual(L('bedrock').en, 'Claude · AWS Bedrock (EU)')
  assert.strictEqual(L('mistral').en, 'Mistral (EU)')
  assert.strictEqual(L('scaleway').en, 'GPT-OSS · Scaleway (EU)')
  assert.deepStrictEqual([L('openrouter').en, L('openrouter').de, L('openrouter').viaUs], ['Claude · OpenRouter (via the USA)', 'Claude · OpenRouter (über die USA)', true])
  assert.strictEqual(L('openrouter', { plan: 'business', region: 'eu' }).en, 'Claude · OpenRouter (EU)')
  assert.strictEqual(describe.prettyModel('lotus-2-reasoning-q4_k_m'), 'Lotus 2')
})

test('cloud notice: who gets the data, provider promises, CLOUD Act for US companies, BRAK, § 43e BRAO / § 9 RAO / GDPR; once per service', () => {
  assert.strictEqual(notice.notice(settings.resolve('local')), null)
  const or = notice.notice(settings.resolve('openrouter'))
  assert.match(or.de.summary, /OpenRouter, Inc\. \(New York, USA\)/)
  assert.match(or.de.summary, /OpenLex leistet keine Rechtsberatung/)
  assert.match(or.de.details.join(' '), /Zero-Data-Retention/)
  assert.match(or.de.details.join(' '), /nicht überprüfen kann/)
  assert.match(or.de.details.join(' '), /CLOUD Act/)
  assert.match(or.de.details.join(' '), /ohne Business-Plan/)
  assert.match(or.de.details.join(' '), /BRAK/)
  assert.ok(or.de.checks.some((c) => /§ 43e BRAO/.test(c)) && or.de.checks.some((c) => /§ 9 RAO/.test(c)) && or.de.checks.some((c) => /DSGVO/.test(c)))
  assert.match(or.en.usGateway, /pass through the US/)
  assert.match(or.en.summary, /not legal advice/)
  const sc = notice.notice(settings.resolve('scaleway'))
  assert.ok(!/CLOUD Act/.test(sc.de.details.join(' ')), 'no CLOUD Act line for an EU company')
  assert.strictEqual(sc.de.usGateway, null)
  assert.match(sc.de.summary, /Scaleway \(Frankreich\)/)
  assert.strictEqual(notice.seen('scaleway'), false)
  notice.acknowledge('scaleway')
  assert.strictEqual(notice.seen('scaleway'), true)
  assert.strictEqual(notice.seen('openrouter'), false, 'per service')
})

// ── the engine's routes, with fake programs on a fake PATH and a fake Ollama ──

function startEngine(env) {
  const port = 19000 + Math.floor(Math.random() * 800)
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, LEXVAULT_SIDECAR_PORT: String(port), LEXVAULT_LLM_URL: 'http://127.0.0.1:1', LEXVAULT_LLM_URL_STRICT: '1', LEXVAULT_QDRANT_URL: 'http://127.0.0.1:1', LEXVAULT_SIDECAR_CERT: '/nonexistent', LEXVAULT_SIDECAR_KEY: '/nonexistent', OPENLEX_MONITORS: '0', LEXVAULT_KEEPALIVE: '1', ...env },
    stdio: 'ignore',
  })
  return { child, port }
}

function call(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        if (/event-stream/.test(res.headers['content-type'] || '')) return resolve(raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))))
        try { resolve({ status: res.statusCode, ...JSON.parse(raw) }) } catch { resolve({ status: res.statusCode, raw }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function waitUp(port) {
  for (let i = 0; i < 100; i++) {
    try { const r = await call(port, 'GET', '/health'); if (r.status === 200) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('engine did not start')
}

test('engine: detection with fake programs, a pull with progress, the picker data and the notice routes', async (t) => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-bin-'))
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-picker-engine-'))
  t.after(() => { fs.rmSync(bin, { recursive: true, force: true }); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) })
  const exe = (name) => { const f = path.join(bin, process.platform === 'win32' ? `${name}.exe` : name); fs.writeFileSync(f, '#!/bin/sh\nexit 0\n'); fs.chmodSync(f, 0o755) }

  // 1. Nothing installed, nothing running: install steps, no pull.
  let eng = startEngine({ LEXVAULT_DATA_DIR: dataDir, OPENLEX_BIN_DIRS: bin, OLLAMA_HOST: '127.0.0.1:1', OPENLEX_RAM_GB: '16' })
  try {
    await waitUp(eng.port)
    const d = await call(eng.port, 'GET', '/api/local/detect')
    assert.deepStrictEqual([d.ollama.installed, d.ollama.running, d.llamacpp.installed], [false, false, false])
    assert.strictEqual(d.recommended.name, 'qwen3:8b', '16 GB → Qwen3 8B')
    assert.strictEqual(d.install.ollama, 'https://ollama.com/download')
    assert.strictEqual(d.install.brew, process.platform === 'darwin' ? 'brew install llama.cpp' : null)
    const failed = await call(eng.port, 'POST', '/api/local/pull', { model: 'qwen3:8b' })
    assert.strictEqual(failed.at(-1).type, 'error')
    assert.match(failed.at(-1).message, /Ollama is not running/)
  } finally { eng.child.kill() }

  // 2. Both programs installed, a (fake) Ollama running.
  exe('ollama'); exe('llama-server')
  eng = startEngine({ LEXVAULT_DATA_DIR: dataDir, OPENLEX_BIN_DIRS: bin, OLLAMA_HOST: base, OPENLEX_RAM_GB: '32' })
  try {
    await waitUp(eng.port)
    const d = await call(eng.port, 'GET', '/api/local/detect')
    assert.deepStrictEqual([d.ollama.installed, d.ollama.running, d.ollama.version, d.llamacpp.installed], [true, true, '0.12.0', true])
    assert.deepStrictEqual(d.ollama.models.map((m) => m.name), ['llama3.2:3b', 'qwen3:14b'])
    assert.strictEqual(d.recommended.name, 'qwen3:14b', '32 GB → Qwen3 14B')
    assert.match(d.llamacpp.command, /^llama-server -hf Qwen\/Qwen3-14B-GGUF:Q4_K_M/)

    const bad = await call(eng.port, 'POST', '/api/local/pull', { model: 'qwen3:8b; rm -rf /' })
    assert.match(bad.at(-1).message, /not a model name/)
    const gone = await call(eng.port, 'POST', '/api/local/pull', { model: 'nope:1b' })
    assert.match(gone.at(-1).message, /file does not exist/)

    const evs = await call(eng.port, 'POST', '/api/local/pull', { model: 'qwen3:14b' })
    const pct = evs.filter((e) => e.type === 'progress' && e.percent != null).map((e) => e.percent)
    assert.deepStrictEqual(pct, [25, 100, 100, 100])
    assert.deepStrictEqual(evs.at(-1), { type: 'done', model: 'qwen3:14b', active: 'local-server' })
    assert.ok(seen.some((x) => x.url === '/api/pull' && x.body.model === 'qwen3:14b' && x.body.stream === true))

    const pv = await call(eng.port, 'GET', '/api/providers')
    assert.strictEqual(pv.active, 'local-server')
    assert.deepStrictEqual(pv.groups, ['local', 'eu', 'firm-cloud', 'gateway', 'direct', 'other'])
    assert.deepStrictEqual(pv.display, { en: 'On this computer · Qwen3 14B', de: 'Auf diesem Computer · Qwen3 14B', local: true, viaUs: false })
    const ls = pv.providers.find((x) => x.id === 'local-server')
    assert.strictEqual(ls.baseUrl, `${base}/v1`)
    const or = pv.providers.find((x) => x.id === 'openrouter')
    assert.deepStrictEqual([or.group, or.plan, or.euProviders, or.noticeSeen, or.usParent], ['gateway', 'standard', true, false, true])
    assert.ok(or.about.de && or.company.en)

    const n = await call(eng.port, 'GET', '/api/providers/notice?provider=bedrock')
    assert.strictEqual(n.seen, false)
    assert.match(n.notice.de.summary, /Amazon Web Services/)
    assert.strictEqual((await call(eng.port, 'POST', '/api/providers/notice', { provider: 'bedrock' })).ok, true)
    assert.strictEqual((await call(eng.port, 'GET', '/api/providers/notice?provider=bedrock')).seen, true)
    assert.strictEqual((await call(eng.port, 'POST', '/api/providers/notice', { provider: 'nope' })).status, 400)
    assert.strictEqual((await call(eng.port, 'GET', '/api/providers/notice?provider=local')).notice, null)

    // Spending meter: nothing spent yet, no limit.
    const sp = await call(eng.port, 'GET', '/api/spend')
    assert.deepStrictEqual([sp.total, sp.cap, sp.level, sp.currency], [0, null, 'ok', 'EUR'])
    assert.strictEqual((await call(eng.port, 'POST', '/api/spend/cap', { cap: 50 })).cap, 50)
    assert.strictEqual((await call(eng.port, 'POST', '/api/spend/cap', { cap: -1 })).status, 400)
  } finally { eng.child.kill() }
})

// A stand-in llama-server (no model): answers --version and /api/tags with
// the file it was started with, so the switch can be checked without an LLM.
const FAKE_LLAMA = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('version: 0.1.0 (build 10500, commit fake)'); process.exit(0) }
const m = args[args.indexOf('-m') + 1]
const port = Number(args[args.indexOf('--port') + 1])
require('fs').writeFileSync(process.env.FAKE_LLAMA_MARKER, m)
require('http').createServer((req, res) => { res.writeHead(req.url === '/healthz' ? 404 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: require('path').basename(m) }] })) }).listen(port, '127.0.0.1')
setTimeout(() => process.exit(0), 30000)
`

const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })

test('engine: the models on this computer — list, switch (Ollama at once, a GGUF file restarts llama-server), remove', { skip: process.platform === 'win32' && 'the stand-in llama-server is a node script' }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-switch-'))
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-switch-bin-'))
  t.after(() => { for (const d of [dataDir, bin]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) })
  fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'models', 'Qwen3-8B-Q4_K_M.gguf'), Buffer.alloc(1024))
  fs.writeFileSync(path.join(dataDir, 'models', 'gemma-3-4b-it-Q4_K_M.gguf'), Buffer.alloc(2048))
  const llama = path.join(bin, 'llama-server')
  fs.writeFileSync(llama, FAKE_LLAMA)
  fs.chmodSync(llama, 0o755)
  const marker = path.join(bin, 'started-with')
  const llmPort = await freePort()
  const eng = startEngine({ LEXVAULT_DATA_DIR: dataDir, OPENLEX_BIN_DIRS: bin, OLLAMA_HOST: base, LEXVAULT_LLM_URL: `http://127.0.0.1:${llmPort}`, OPENLEX_LLAMA_SERVER: llama, FAKE_LLAMA_MARKER: marker })
  try {
    await waitUp(eng.port)
    let list = await call(eng.port, 'GET', '/api/local/models')
    assert.deepStrictEqual(list.models.map((m) => m.id), ['ollama:llama3.2:3b', 'ollama:qwen3:14b', 'gguf:gemma-3-4b-it-Q4_K_M.gguf', 'gguf:Qwen3-8B-Q4_K_M.gguf'])
    const small = list.models.find((m) => m.id === 'ollama:llama3.2:3b')
    assert.strictEqual(small.title, 'Llama3.2 3B')
    assert.match(small.goodFor.en, /Quick questions/)
    assert.match(list.models.find((m) => m.id === 'ollama:qwen3:14b').goodFor.de, /24 GB/)
    assert.ok(!list.models.some((m) => m.active))

    // Ollama: at once, no restart.
    let r = await call(eng.port, 'POST', '/api/local/use', { name: 'llama3.2' })
    assert.deepStrictEqual([r.ok, r.restarted, r.model.id], [true, false, 'ollama:llama3.2:3b'])
    assert.strictEqual((await call(eng.port, 'GET', '/api/providers')).display.en, 'On this computer · Llama3.2 3B')
    assert.match((await call(eng.port, 'POST', '/api/local/remove', { id: 'ollama:llama3.2:3b' })).error, /in use/)

    // A GGUF file: remembered, llama-server (the stand-in) started with it.
    r = await call(eng.port, 'POST', '/api/local/use', { id: 'gguf:Qwen3-8B-Q4_K_M.gguf' })
    assert.deepStrictEqual([r.ok, r.restarted, r.seconds], [true, true, 20], JSON.stringify(r))
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), path.join(dataDir, 'models', 'Qwen3-8B-Q4_K_M.gguf'))
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'local-model.json'), 'utf8')).file, path.join(dataDir, 'models', 'Qwen3-8B-Q4_K_M.gguf'))
    const pv = await call(eng.port, 'GET', '/api/providers')
    assert.strictEqual(pv.active, 'local')
    assert.strictEqual(pv.display.en, 'On this computer · Qwen3 8B')
    list = await call(eng.port, 'GET', '/api/local/models')
    assert.deepStrictEqual(list.models.filter((m) => m.active).map((m) => m.id), ['gguf:Qwen3-8B-Q4_K_M.gguf'])

    // Switch again: the running stand-in is stopped and restarted with the other file.
    r = await call(eng.port, 'POST', '/api/local/use', { id: 'gguf:gemma-3-4b-it-Q4_K_M.gguf' })
    assert.strictEqual(r.ok, true, JSON.stringify(r))
    assert.match(fs.readFileSync(marker, 'utf8'), /gemma-3-4b-it-Q4_K_M\.gguf$/)

    // Remove: never the one in use; the others free their space.
    assert.match((await call(eng.port, 'POST', '/api/local/remove', { id: 'gguf:gemma-3-4b-it-Q4_K_M.gguf' })).error, /in use/)
    assert.strictEqual((await call(eng.port, 'POST', '/api/local/remove', { id: 'gguf:Qwen3-8B-Q4_K_M.gguf' })).ok, true)
    assert.ok(!fs.existsSync(path.join(dataDir, 'models', 'Qwen3-8B-Q4_K_M.gguf')))
    assert.strictEqual((await call(eng.port, 'POST', '/api/local/remove', { id: 'ollama:llama3.2:3b' })).ok, true)
    assert.ok(seen.some((x) => x.method === 'DELETE' && x.url === '/api/delete' && x.body.model === 'llama3.2:3b'))
    assert.match((await call(eng.port, 'POST', '/api/local/use', { name: 'nothing-like-this' })).error, /no model called/)
  } finally { eng.child.kill() }
})
