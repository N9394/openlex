"use strict"
/**
 * GOWA (OpenLex's own decision model): input format, answer maths, model
 * management, the in-process runtime on a tiny fake ONNX model, and GOWA
 * as a decide.js backend.
 *
 *   node --test test/gowa.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-gowa-'))
process.env.LEXVAULT_DATA_DIR = DATA

const fake = require('./fixtures/fake_gowa')
const fmt = require('../src/gowa_format')
const gowa = require('../src/gowa')
const decide = require('../src/decide')
const policy = require('../src/policy')
const harness = require('../src/harness')

let ortOk = true
try { require('onnxruntime-node') } catch { ortOk = false }

test.after(() => { gowa.unload(); fs.rmSync(DATA, { recursive: true, force: true }) })

const M = fake.MARKERS

test('format: one sequence per question, option and decide positions point at the markers', () => {
  const q = decide.cleanQuestions({ a: { type: 'choice', instructions: 'which', criteria: ['person', 'other'] } }).a
  const s = fmt.buildSequence({ state: 'the contract', question: q, encode: fake.encode, markers: M, maxLen: 64 })
  assert.strictEqual(s.ids[0], M.cls)
  assert.strictEqual(s.ids[1], M.state)
  assert.strictEqual(s.ids[s.ids.length - 1], M.sep)
  assert.strictEqual(s.ids[s.decideIndex], M.decide)
  assert.deepStrictEqual(s.optionIndex.map((i) => s.ids[i]), [M.opt_close, M.opt_close])
  assert.deepStrictEqual(s.optionIndex.map((i) => s.ids[i - 1]), [fake.VOCAB.person, fake.VOCAB.other])
  assert.strictEqual(s.truncated, false)
})

test('format: a long state is cut to fit, the question never; an oversized question is refused', () => {
  const q = { type: 'noul', instructions: 'is this chosen ?' }
  const s = fmt.buildSequence({ state: 'law '.repeat(500), question: q, encode: fake.encode, markers: M, maxLen: 32 })
  assert.strictEqual(s.ids.length, 32)
  assert.strictEqual(s.truncated, true)
  assert.strictEqual(s.ids[s.decideIndex], M.decide)
  assert.throws(() => fmt.buildSequence({ state: 'x', question: { type: 'noul', instructions: 'law '.repeat(100) }, encode: fake.encode, markers: M, maxLen: 32 }), /too long/)
  // A question may carry its own state (many short texts in one call).
  const own = fmt.buildSequence({ state: 'ignored', question: { ...q, state: 'the contract' }, encode: fake.encode, markers: M, maxLen: 64 })
  assert.deepStrictEqual(own.ids.slice(2, 4), fake.encode('the contract'))
})

test('answers: noul, choice and score from logits with the temperature (Kev formulas)', () => {
  const noul = fmt.answerFrom({ type: 'noul' }, [2, 0], 1)
  assert.ok(Math.abs(noul.noul - 1 / (1 + Math.exp(-2))) < 1e-3)
  // A higher temperature makes the same scores less certain, never changes the winner.
  const hot = fmt.answerFrom({ type: 'noul' }, [2, 0], 4)
  assert.ok(hot.noul < noul.noul && hot.noul > 0.5)
  const ch = fmt.answerFrom({ type: 'choice', criteria: { a: null, b: null, c: null } }, [0, Math.log(8), 0], 1)
  assert.strictEqual(ch.choice, 'b')
  assert.ok(Math.abs(ch.probabilities.b - 0.8) < 1e-3)
  assert.ok(Math.abs(ch.confidence - (0.8 - 1 / 3) / (1 - 1 / 3)) < 1e-3)
  const sc = fmt.answerFrom({ type: 'score', criteria: ['low', 'medium', 'high'] }, [0, 0, Math.log(8)], 1)
  // p = [0.1, 0.1, 0.8] → mean 1.7; E|i − 2| = 0.3; confidence 1 − 0.3/2
  assert.ok(Math.abs(sc.score - 1.7) < 1e-3)
  assert.ok(Math.abs(sc.confidence - 0.85) < 1e-3)
  assert.deepStrictEqual(sc.legend, { 0: 'low', 1: 'medium', 2: 'high' })
})

test('batches are padded; missing options point at the decide token', () => {
  const a = { ids: [1, 3, 9, 6, 6, 7, 2], optionIndex: [3, 4], decideIndex: 5 }
  const b = { ids: [1, 3, 6, 7, 2], optionIndex: [2], decideIndex: 3 }
  const p = fmt.packBatch([a, b], 0)
  assert.strictEqual(p.L, 7)
  assert.strictEqual(p.K, 2)
  assert.deepStrictEqual(p.attention.slice(7), [1, 1, 1, 1, 1, 0, 0])
  assert.deepStrictEqual(p.optionIndex, [3, 4, 2, 3])
})

test('head config is checked', () => {
  assert.throws(() => gowa.validateConfig({ format: 'other' }), /format/)
  assert.throws(() => gowa.validateConfig({ ...fake.headConfig(), markers: { ...M, decide: 'x' } }), /markers.decide/)
  assert.throws(() => gowa.validateConfig({ ...fake.headConfig(), temperature: 0 }), /temperature/)
  assert.strictEqual(gowa.validateConfig(fake.headConfig()).max_length, 64)
})

test('built-in manifest: GOWA small v0 is "not yet available" and cannot be installed', async () => {
  const s = gowa.status()
  assert.strictEqual(s.name, 'GOWA small v0')
  assert.strictEqual(s.label, 'OpenLex model (GOWA)')
  assert.strictEqual(s.status, 'not-yet-available')
  assert.strictEqual(s.installed, false)
  assert.match(s.note, /not yet available/i)
  await assert.rejects(gowa.install(), (e) => e.code === 'NOT_AVAILABLE')
  assert.strictEqual(decide.backend(), null)
})

test('download: pinned SHA-256 per file; a changed file installs nothing; size shown; removable', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-gowa-src-'))
  fake.writeFakeModel(src)
  const files = gowa.REQUIRED.map((name) => { const b = fs.readFileSync(path.join(src, name)); return { name, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') } })
  let tamper = false
  const seen = []
  const srv = http.createServer((req, res) => {
    seen.push(req.url)
    const m = req.url.match(/^\/r\/([^/]+)\/(.+)$/)
    let body = fs.readFileSync(path.join(src, decodeURIComponent(m[2])))
    if (tamper && m[2] === 'model.onnx') body = Buffer.concat([body.subarray(0, body.length - 1), Buffer.from([0])])
    res.writeHead(200); res.end(body)
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    harness.setUserSection('decide', { gowa: { source: { url: `http://127.0.0.1:${srv.address().port}/r/{revision}/{file}`, revision: 'abc123', version: 'v0-test', files } } })
    let s = gowa.status()
    assert.strictEqual(s.status, 'available')
    assert.strictEqual(s.bytes, files.reduce((n, f) => n + f.bytes, 0))
    tamper = true
    await assert.rejects(gowa.install(), /checksum/)
    assert.strictEqual(gowa.status().installed, false)
    assert.ok(!fs.existsSync(path.join(gowa.dir(), 'model.onnx')))
    tamper = false
    s = await gowa.install()
    assert.strictEqual(s.status, 'installed')
    assert.ok(seen.every((u) => u.startsWith('/r/abc123/')))
    s = gowa.remove()
    assert.strictEqual(s.installed, false)
    // A source without SHA-256 per file offers nothing to install.
    harness.setUserSection('decide', { gowa: { source: { url: 'https://example.invalid/{file}', files: [{ name: 'model.onnx', bytes: 10 }] } } })
    assert.strictEqual(gowa.status().status, 'not-yet-available')
    // Only https (or this computer) may serve the files.
    harness.setUserSection('decide', { gowa: { source: { url: 'http://example.com/{file}', files } } })
    await assert.rejects(gowa.install(), /https/)
  } finally {
    srv.close()
    harness.setUserSection('decide', null)
    fs.rmSync(src, { recursive: true, force: true })
  }
})

test('runtime on a tiny fake ONNX model: answers, batching, idle unload', { skip: !ortOk && 'onnxruntime-node not available' }, async () => {
  fake.writeFakeModel(gowa.dir())
  harness.setUserSection('decide', { gowa: { batch: 2, threads: 1, idleMinutes: 0.002 } })
  try {
    assert.strictEqual(gowa.status().status, 'installed')
    const questions = decide.cleanQuestions({
      austrian: { type: 'noul', instructions: 'is austrian law chosen ?' },
      who: { type: 'choice', criteria: ['other', 'person', 'organisation'] },
      risk: { type: 'score', criteria: ['low', 'medium', 'high'] },
      a: { type: 'noul' }, b: { type: 'noul' },
    })
    const r = await gowa.systemOne({ state: 'the contract is governed by austrian law', questions })
    // The fake model scores an option by its last token id: yes (40) > no (10), person (30) > organisation (25) > other (14), high (13) > medium > low.
    assert.ok(r.answers.austrian.noul > 0.99)
    assert.strictEqual(r.answers.who.choice, 'person')
    assert.ok(r.answers.risk.score > 1)
    assert.strictEqual(Object.keys(r.answers).length, 5)
    assert.match(r.model, /^gowa-small-test$/)
    assert.strictEqual(r.temperature, 4)
    assert.strictEqual(gowa.status().loaded, true)
    await new Promise((res) => setTimeout(res, 400))
    assert.strictEqual(gowa.status().loaded, false, 'unloaded after the idle time')
  } finally {
    harness.setUserSection('decide', null)
    gowa.unload()
  }
})

test('decide.js: provider "gowa" is local, allowed under local-only, audited without content', { skip: !ortOk && 'onnxruntime-node not available' }, async () => {
  fake.writeFakeModel(gowa.dir())
  decide.saveConfig({ provider: 'gowa' })
  try {
    assert.deepStrictEqual(decide.loadConfig(), { provider: 'gowa', model: 'gowa-small' })
    const d = decide.descriptor()
    assert.strictEqual(d.local, true)
    assert.strictEqual(d.label, 'OpenLex model (GOWA)')
    policy.setRule(null, { mode: 'local-only' })
    const secret = 'The contract is governed by Austrian law. Client Huber'
    const r = await policy.withMatter(null, () => decide.systemOne({ state: secret, questions: { q: { type: 'noul', instructions: 'is austrian law chosen ?' } } }))
    assert.ok(r.answers.q.noul > 0.5)
    const s = decide.summarize(r.answers)
    assert.strictEqual(s.q.answer, true)
    const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
    assert.ok(!audit.includes('Huber'), 'no content in the audit log')
    const line = audit.trim().split('\n').map(JSON.parse).filter((e) => e.provider === 'decide').pop()
    assert.strictEqual(line.host, 'this computer')
    assert.strictEqual(line.local, true)
    assert.strictEqual(line.ok, true)
  } finally {
    decide.saveConfig(null)
    gowa.unload()
    fs.rmSync(gowa.dir(), { recursive: true, force: true })
  }
})

test('backends: a cloud endpoint never answers a local-only task; GOWA does when installed; privileged matters stay local', async () => {
  decide.saveConfig({ url: 'https://decide.example.com', model: 'jev-1' })
  try {
    assert.strictEqual(decide.backend().descriptor.host, 'decide.example.com')
    assert.strictEqual(decide.backend({ localOnly: true }), null)
    gowa._setTestBackend({ encode: fake.encode, config: fake.headConfig(), run: async (b) => new Array(b.B * b.K).fill(0) })
    assert.strictEqual(decide.backend({ localOnly: true }).use, 'gowa')
    // Privileged: even an allow-listed cloud decision service is refused.
    const matters = require('../src/matters')
    const m = matters.create({ title: 'Privileged matter', client: 'X', privileged: false })
    policy.setRule(m.id, { mode: 'allow-list', providers: ['decide'] })
    matters.update(m.id, { privileged: true })
    await assert.rejects(policy.withMatter(m.id, () => decide.systemOne({ state: 'x', questions: { q: { type: 'noul' } } })), (e) => e.code === 'POLICY_BLOCKED')
  } finally {
    gowa._setTestBackend(null)
    decide.saveConfig(null)
  }
})

test('honest status: no ONNX runtime → installed but not ready, a call fails and says so (lastRun)', async () => {
  const rtm = require('../src/onnx_runtime')
  fake.writeFakeModel(gowa.dir())
  rtm.setLoader((name) => { const e = new Error(`Cannot find module '${name}'`); e.code = 'MODULE_NOT_FOUND'; throw e })
  try {
    const s = gowa.status()
    assert.strictEqual(s.installed, true)
    assert.strictEqual(s.runtime.available, false)
    assert.strictEqual(s.runtime.reason, 'not-bundled')
    assert.strictEqual(gowa.ready(), false)
    assert.strictEqual(decide.backend({ localOnly: true }), null, 'no backend without a runtime')
    await assert.rejects(gowa.systemOne({ state: 'x', questions: { q: { type: 'noul' } } }), (e) => e.code === 'ONNX_UNAVAILABLE')
    assert.strictEqual(gowa.status().lastRun.ok, false)
  } finally {
    rtm.setLoader(null)
    gowa.unload()
    fs.rmSync(gowa.dir(), { recursive: true, force: true })
  }
  if (ortOk) {
    fake.writeFakeModel(gowa.dir())
    await gowa.systemOne({ state: 'the contract', questions: { q: { type: 'noul' } } })
    assert.strictEqual(gowa.status().lastRun.ok, true, 'it really ran')
    gowa.unload()
    fs.rmSync(gowa.dir(), { recursive: true, force: true })
  }
})
