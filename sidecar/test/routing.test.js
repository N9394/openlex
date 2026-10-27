"use strict"
/**
 * Harness config + routing map: which model handles which role.
 *
 *   node --test test/routing.test.js
 *
 * Two fake OpenAI-compatible endpoints stand in for two providers
 * ("openai" = cloud, "custom" = declared local). Checks: role routes,
 * rules, fallback on 5xx, policy skipping a blocked provider, no
 * mid-stream switching, firm locks, validation, explain, audit fields.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-route-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

function fakeModel(name) {
  const srv = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      srv.calls.push(body)
      if (srv.mode === 'fail') { res.writeHead(503); return res.end('overloaded') }
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${name} part 1. ` } }] })}\n\n`)
        if (srv.mode === 'die-mid-stream') return setTimeout(() => res.destroy(), 100) // after the first chunk arrived
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done.' } }] })}\n\ndata: [DONE]\n\n`)
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: `answer from ${name}` } }] }))
    })
  })
  srv.calls = []
  srv.mode = 'ok'
  return srv
}
const cloud = fakeModel('cloud')
const onprem = fakeModel('onprem')

let llm, harness, routing, policy
const writeUser = (cfg) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify(cfg))
const ask = (role, matterId = null) => policy.withMatter(matterId, () => llm.chat([{ role: 'user', content: 'hi' }], { role }))

test.before(async () => {
  await new Promise((r) => cloud.listen(0, '127.0.0.1', r))
  await new Promise((r) => onprem.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${cloud.address().port}/v1`, model: 'gpt-x', nativeTools: false } })
  settings.update({ provider: 'custom', overrides: { baseUrl: `http://127.0.0.1:${onprem.address().port}/v1`, model: 'firm-llm', local: true } })
  settings.update({ active: 'openai' })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  llm = require('../src/llm'); harness = require('../src/harness'); routing = require('../src/routing'); policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { cloud.close(); onprem.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('no routes configured: the active provider, as before', async () => {
  assert.strictEqual(await ask('judge'), 'answer from cloud')
})

test('role routes and model override per role', async () => {
  writeUser({ routes: { roles: { judge: 'custom', write: 'openai:gpt-big' } } })
  assert.strictEqual(await ask('judge'), 'answer from onprem')
  await ask('write')
  assert.strictEqual(cloud.calls.at(-1).model, 'gpt-big')
  assert.strictEqual(await ask('extract'), 'answer from cloud', 'unrouted roles use the active provider')
})

test('rules win over roles: privileged matters and big prompts', async () => {
  const m = require('../src/matters').create({ title: 'Secret', privileged: true })
  writeUser({ routes: { roles: { judge: 'openai' }, rules: [{ when: { privileged: true }, use: 'custom' }, { when: { role: 'extract', minChars: 5000 }, use: 'custom:firm-long' }] } })
  assert.strictEqual(await ask('judge', m.id), 'answer from onprem')
  await policy.withMatter(null, () => llm.chat([{ role: 'user', content: 'x'.repeat(6000) }], { role: 'extract' }))
  assert.strictEqual(onprem.calls.at(-1).model, 'firm-long')
})

test('fallback: a 503 moves on to the next candidate; the data policy skips blocked ones', async () => {
  writeUser({ routes: { roles: { summarize: 'openai' }, fallback: ['custom'] } })
  cloud.mode = 'fail'
  assert.strictEqual(await ask('summarize'), 'answer from onprem')
  cloud.mode = 'ok'
  policy.setRule(null, { mode: 'local-only' })
  const before = cloud.calls.length
  assert.strictEqual(await ask('summarize'), 'answer from onprem', 'cloud blocked by policy → declared-local fallback')
  assert.strictEqual(cloud.calls.length, before, 'nothing was sent to the blocked provider')
  writeUser({ routes: {} })
  await assert.rejects(() => ask('summarize'), (e) => e.code === 'POLICY_BLOCKED')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})

test('never switches model after text was streamed', async () => {
  writeUser({ routes: { roles: { write: 'openai' }, fallback: ['custom'] } })
  cloud.mode = 'die-mid-stream'
  const got = []
  const before = onprem.calls.length
  // The OpenAI-format adapter may surface a cut stream as an error or as a partial answer;
  // either way no second model may be asked once text reached the user.
  await policy.withMatter(null, () => llm.chatWithReasoning([{ role: 'user', content: 'draft' }], { phase: 'writing', onContent: (t) => got.push(t) })).catch(() => {})
  assert.ok(got.join('').includes('cloud part 1'))
  assert.strictEqual(onprem.calls.length, before, 'no second model after partial output')
  cloud.mode = 'ok'
})

test('firm layer: defaults, merge with the user, and locks', () => {
  const ws = require('../src/workspace')
  ws.writeFile('openlex.json', JSON.stringify({ routes: { roles: { judge: 'custom' } }, features: { browser: false } }))
  writeUser({ routes: { roles: { write: 'openai' } } })
  let cfg = harness.load()
  assert.deepStrictEqual(cfg.routes.roles, { judge: 'custom', write: 'openai' })
  assert.strictEqual(cfg.sources.routes, 'firm+user')
  assert.strictEqual(harness.feature('browser'), false)
  assert.strictEqual(harness.feature('monitors'), true)
  ws.writeFile('openlex.json', JSON.stringify({ lock: ['routes'], routes: { roles: { judge: 'custom' } } }))
  cfg = harness.load()
  assert.deepStrictEqual(cfg.routes.roles, { judge: 'custom' }, 'user routes ignored while the firm locks them')
  assert.throws(() => harness.setUserSection('routes', {}), /locked/)
  ws.writeFile('openlex.json', '{ not json')
  assert.match(harness.errors()[0], /openlex\.json/)
  assert.ok(harness.load().routes, 'a broken layer never breaks the engine')
  fs.unlinkSync(ws.resolve('openlex.json'))
})

test('validate, explain, audit', async () => {
  assert.deepStrictEqual(routing.validate({ roles: { judge: 'nope' }, rules: [{ when: { colour: 'red' }, use: 'local' }] }).length, 2)
  assert.deepStrictEqual(routing.validate({ roles: { judge: 'custom', write: 'anthropic:claude-x' }, fallback: ['local'] }), [])
  writeUser({ routes: { roles: { judge: 'anthropic' }, fallback: ['custom'] } })
  const judge = routing.explain().find((r) => r.role === 'judge')
  assert.deepStrictEqual(judge.candidates.map((c) => [c.provider, c.allowed]), [['anthropic', false], ['openai', true], ['custom', true]])
  assert.match(judge.candidates[0].blocked, /not on the allow-list/)
  await ask('judge')
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse)
  const last = audit.filter((a) => a.decision === 'allowed').at(-1)
  assert.deepStrictEqual([last.role, last.route], ['judge', 'active provider'])
})
