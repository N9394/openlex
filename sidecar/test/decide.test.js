"use strict"
/**
 * Decision models (Phase 9): System One API client (Kev / Jev compatible).
 *
 *   node --test test/decide.test.js
 *
 * A fake Kev server checks the request shape and the bearer key; the data
 * policy must let a local endpoint through and stop a cloud one unless it
 * is allow-listed (and in an approved region when the policy has regions).
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-decide-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_DECIDE = 'kev-local-key'

const seen = []
const kev = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    seen.push({ url: req.url, auth: req.headers.authorization, body })
    const answers = {}
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') answers[id] = { type: 'noul', noul: /Austrian/.test(body.state) ? 0.94 : 0.08 }
      if (q.type === 'choice') { const o = Object.keys(q.criteria); answers[id] = { type: 'choice', choice: o[0], confidence: 0.6, probabilities: Object.fromEntries(o.map((k, i) => [k, i ? 0.2 / (o.length - 1) : 0.8])) } }
      if (q.type === 'score') answers[id] = { type: 'score', score: 1.8, confidence: 0.7, legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities: { 0: 0.05, 1: 0.1, 2: 0.85 } }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ model: body.model, answers, latency_ms: 12 }))
  })
})

let decide, policy
test.before(async () => {
  await new Promise((r) => kev.listen(0, '127.0.0.1', r))
  decide = require('../src/decide')
  policy = require('../src/policy')
})
test.after(() => { kev.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('config: local http allowed, remote must be https; local detection', () => {
  assert.throws(() => decide.saveConfig({ url: 'http://api.example.com' }), /https/)
  assert.throws(() => decide.saveConfig({ url: 'ftp://x' }), /http/)
  for (const h of ['127.0.0.1', 'localhost', '192.168.1.20', '10.0.0.4', '100.64.0.7', 'box.local', '::1']) assert.ok(decide.isLocalHost(h), h)
  for (const h of ['api.typesafe.ai', '8.8.8.8', '172.32.0.1']) assert.ok(!decide.isLocalHost(h), h)
})

test('questions are validated before anything is sent', () => {
  assert.throws(() => decide.cleanQuestions({ a: { type: 'maybe' } }), /type must be/)
  assert.throws(() => decide.cleanQuestions({ a: { type: 'choice' } }), /criteria/)
  assert.throws(() => decide.cleanQuestions({ a: { type: 'score', criteria: [] } }), /levels/)
  assert.deepStrictEqual(decide.cleanQuestions({ a: { type: 'choice', criteria: ['AT', 'DE'] } }).a.criteria, { AT: null, DE: null })
})

test('local Kev endpoint: allowed under local-only, bearer key sent, answers summarized', async () => {
  decide.saveConfig({ url: `http://127.0.0.1:${kev.address().port}/`, model: 'kev-4b' })
  assert.strictEqual(decide.descriptor().local, true)
  const r = await policy.withMatter(null, () => decide.systemOne({
    state: 'This Agreement is governed by Austrian law.',
    questions: {
      austrian: { type: 'noul', instructions: 'Is Austrian law chosen?' },
      forum: { type: 'choice', instructions: 'Which forum?', criteria: { vienna: 'Courts of Vienna', viac: 'VIAC arbitration', other: null } },
      risk: { type: 'score', instructions: 'How risky for the client?', criteria: ['low', 'medium', 'high'] },
    },
  }))
  assert.strictEqual(seen[0].url, '/v1/systemone')
  assert.strictEqual(seen[0].auth, 'Bearer kev-local-key')
  assert.strictEqual(seen[0].body.model, 'kev-4b')
  const s = decide.summarize(r.answers)
  assert.strictEqual(s.austrian.answer, true)
  assert.ok(Math.abs(s.austrian.p - 0.94) < 1e-9)
  assert.strictEqual(s.forum.answer, 'vienna')
  assert.strictEqual(s.risk.level, 'high')
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse).filter((e) => e.provider === 'decide')
  assert.strictEqual(audit.at(-1).decision, 'allowed')
  assert.ok(!JSON.stringify(audit).includes('Austrian law'), 'audit holds metadata only, never the text')
})

test('cloud endpoint (Jev-style): blocked by default, allowed only when listed and in an approved region', async () => {
  decide.saveConfig({ url: 'https://api.typesafe.example', model: 'jev-latest' })
  const ask = () => policy.withMatter(null, () => decide.systemOne({ state: 'x', questions: { a: { type: 'noul' } } }))
  await assert.rejects(ask, (e) => e.code === 'POLICY_BLOCKED' && /local-only/.test(e.message))
  policy.setRule(null, { mode: 'allow-list', providers: ['decide'], regions: ['eu'] })
  await assert.rejects(ask, /no pinned region/)
  decide.saveConfig({ url: 'https://api.typesafe.example', model: 'jev-latest', region: 'us-east' })
  await assert.rejects(ask, /outside the approved regions/)
  assert.strictEqual(seen.length, 1, 'nothing left the machine')
  decide.saveConfig(null)
  await assert.rejects(ask, /No decision model configured/)
})
