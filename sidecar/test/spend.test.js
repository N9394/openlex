"use strict"
/**
 * Spending meter + monthly limit for online AI (spend.js).
 *
 *   node --test test/spend.test.js
 *
 * Fake usage data and a fake OpenAI-compatible server; no real keys.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-spend-'))
const FIRM = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-spend-firm-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_SCALEWAY = 'scw-test'

const seen = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    seen.push({ url: req.url, body: raw ? JSON.parse(raw) : {} })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'answer' } }], usage: { prompt_tokens: 1000000, completion_tokens: 100000 } }))
  })
})
let base
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${fake.address().port}`
})
test.after(() => { fake.close(); for (const d of [DATA, FIRM]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) })

const spend = require('../src/spend')
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≈ ${b}`)

test('prices: dated estimates, first match wins, unknown models at a safe high default', () => {
  const p = spend.priceFor('anthropic', 'claude-sonnet-5-5')
  assert.deepStrictEqual([p.in, p.out, p.currency, p.known], [2, 10, 'USD', true])
  assert.ok(p.asOf)
  assert.strictEqual(spend.priceFor('ovhcloud', 'gpt-oss-120b').in, 0.08)
  assert.strictEqual(spend.priceFor('scaleway', 'gpt-oss-120b').in, 0.15, 'provider-specific entries only for that provider')
  const u = spend.priceFor('custom', 'mystery-model')
  assert.strictEqual(u.known, false)
  assert.ok(u.in >= 3)
  assert.deepStrictEqual(spend.tokens({ input_tokens: 5, output_tokens: 7 }), { in: 5, out: 7 })
  assert.deepStrictEqual(spend.tokens({ inputTokens: 1, outputTokens: 2 }), { in: 1, out: 2 })
  assert.strictEqual(spend.tokens(null), null)
})

test('meter: per model and per matter; reported cost wins; no counts → estimated from text; local is free', () => {
  // 1M in + 0.1M out on Claude Sonnet 5.5: $2 + $1 = $3 → €2.58 at 0.86
  close(spend.record({ provider: 'anthropic', model: 'claude-sonnet-5-5', matterId: 'm1', usage: { input_tokens: 1e6, output_tokens: 1e5 } }), 2.58)
  // OpenRouter reports the cost itself (US dollars)
  close(spend.record({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', matterId: 'm2', usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.5 } }), 0.43)
  // No usage: 4 characters a token
  spend.record({ provider: 'mistral', model: 'mistral-large-latest', matterId: 'm1', inChars: 4000, outChars: 400 })
  assert.strictEqual(spend.record({ provider: 'local-server', model: 'qwen3:8b', local: true, usage: { prompt_tokens: 1e9 } }), 0)
  const st = spend.status()
  assert.strictEqual(st.currency, 'EUR')
  assert.strictEqual(st.byModel.length, 3)
  const mis = st.byModel.find((x) => x.provider === 'mistral')
  assert.deepStrictEqual([mis.inTokens, mis.outTokens, mis.estimatedTokens], [1000, 100, true])
  assert.strictEqual(st.byModel.find((x) => x.provider === 'openrouter').reported, true)
  close(st.byMatter.find((x) => x.matterId === 'm1').cost, 2.58 + mis.cost)
  assert.strictEqual(st.cap, null)
  assert.strictEqual(st.level, 'ok')
  assert.match(st.estimates.note, /ESTIMATES/)
})

test('monthly limit: notice at 80 %, stop at 100 % before anything is sent', async () => {
  const before = spend.status().total
  let st = spend.setCap(before / 0.85)
  assert.strictEqual(st.level, 'warn')
  st = spend.setCap(before + 0.01)
  assert.strictEqual(st.level, 'warn')
  assert.doesNotThrow(() => spend.check({ id: 'scaleway', local: false }))
  st = spend.setCap(Math.max(0.01, before - 0.5))
  assert.strictEqual(st.level, 'stop')
  assert.throws(() => spend.check({ id: 'scaleway', local: false }), (e) => e.code === 'SPEND_CAP' && /limit for online AI/.test(e.message) && /\/model local/.test(e.message))
  assert.doesNotThrow(() => spend.check({ id: 'local', local: true }), 'the AI on this computer is never stopped')

  const settings = require('../src/providers/settings')
  const policy = require('../src/policy')
  settings.update({ provider: 'scaleway', overrides: { baseUrl: `${base}/v1` } })
  settings.update({ active: 'scaleway' })
  policy.setRule(null, { mode: 'allow-list', providers: ['scaleway'] })
  seen.length = 0
  await assert.rejects(() => require('../src/llm').chat([{ role: 'user', content: 'hi' }]), (e) => e.code === 'SPEND_CAP')
  assert.strictEqual(seen.length, 0, 'nothing sent')

  assert.throws(() => spend.setCap(-5), /more than 0/)
  st = spend.setCap(null)
  assert.strictEqual(st.cap, null)
  seen.length = 0
  await require('../src/llm').chat([{ role: 'user', content: 'hi' }])
  assert.strictEqual(seen.length, 1)
  const row = spend.status().byModel.find((x) => x.provider === 'scaleway')
  assert.deepStrictEqual([row.inTokens, row.outTokens, row.estimatedTokens], [1e6, 1e5, false], 'usage from the response')
  policy.setRule(null, { mode: 'local-only' })
  settings.update({ active: 'local' })
})

test('the firm sets and locks the limit in its openlex.json', () => {
  require('../src/workspace').setBase(FIRM)
  fs.writeFileSync(path.join(FIRM, 'openlex.json'), JSON.stringify({ spending: { cap: 20, warnAt: 0.5 }, lock: ['spending'] }))
  const st = spend.status()
  assert.deepStrictEqual([st.cap, st.warnAt, st.locked], [20, 0.5, true])
  assert.throws(() => spend.setCap(100), /locked/)
})

test('openlex.json → "prices" (firm layer) comes before prices.json and the built-in list', () => {
  const harness = require('../src/harness')
  require('../src/workspace').setBase(FIRM)
  fs.writeFileSync(path.join(FIRM, 'openlex.json'), JSON.stringify({
    prices: { 'claude-sonnet-5': { input: 1, output: 4, currency: 'EUR' }, 'firm-model': { in: 0.5, out: 1 }, 'bad(': { input: 1, output: 1 }, usdToEur: 0.9 },
  }))
  assert.ok(harness.SECTIONS.includes('prices'))
  assert.ok(harness.load().prices['firm-model'], 'the section survives load()')
  const p = spend.priceFor('anthropic', 'claude-sonnet-5-5')
  assert.deepStrictEqual([p.in, p.out, p.currency, p.known, p.usdToEur], [1, 4, 'EUR', true, 0.9])
  const f = spend.priceFor('custom', 'firm-model-2')
  assert.deepStrictEqual([f.in, f.out, f.currency, f.known], [0.5, 1, 'USD', true])
  assert.strictEqual(spend.priceFor('custom', 'mystery-model').known, false, 'a bad pattern is skipped, the rest still works')
  assert.strictEqual(spend.status().estimates.custom, true)
  // the batch estimate reads the same map
  assert.deepStrictEqual(require('../src/batch').priceFor('firm-model'), { input: 0.5, output: 1, currency: 'USD' })
  fs.writeFileSync(path.join(FIRM, 'openlex.json'), JSON.stringify({}))
  assert.strictEqual(spend.priceFor('anthropic', 'claude-sonnet-5-5').in, 2)
})
