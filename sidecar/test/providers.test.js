"use strict"
/**
 * Provider layer + data policy (Phase 1: bring your own model / key).
 *
 *   node --test test/providers.test.js
 *
 * Runs against a fake OpenAI-compatible + Anthropic server on localhost —
 * no real keys, no network. Keys come from the OPENLEX_KEY_* env override.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-prov-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test-openai'
process.env.OPENLEX_KEY_ANTHROPIC = 'sk-test-anthropic'

const seen = []
let rejectTemperature = false

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    seen.push({ url: req.url, headers: req.headers, body })
    if (req.url.startsWith('/v1/chat/completions')) {
      if (rejectTemperature && body.temperature !== undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: "Unsupported value: 'temperature'" } }))
      }
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        for (const t of ['Hel', 'lo']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
        return res.end('data: [DONE]\n\n')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ choices: [{ message: { content: 'openai-ok' } }], usage: { total_tokens: 3 } }))
    }
    if (req.url === '/v1/messages') {
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Cla' } })}\n\n`)
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ude' } })}\n\n`)
        return res.end(`event: message_stop\ndata: {"type":"message_stop"}\n\n`)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ content: [{ type: 'text', text: 'anthropic-ok' }] }))
    }
    res.writeHead(404); res.end()
  })
})

let base
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${fake.address().port}`
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

const settings = require('../src/providers/settings')
const policy = require('../src/policy')
const llm = require('../src/llm')
const { normalizeMessages } = require('../src/providers/common')

function auditLines() {
  try { return fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse) } catch { return [] }
}

test('defaults: local provider, local-only policy', () => {
  assert.strictEqual(settings.load().active, 'local')
  assert.strictEqual(policy.load().default.mode, 'local-only')
})

test('local-only policy blocks a cloud provider before any request leaves', async () => {
  settings.update({ provider: 'openai', overrides: { baseUrl: `${base}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  const before = seen.length
  await assert.rejects(llm.chat([{ role: 'user', content: 'secret client facts' }]), (e) => e.code === 'POLICY_BLOCKED')
  assert.strictEqual(seen.length, before, 'no request may reach the provider')
  const last = auditLines().pop()
  assert.strictEqual(last.decision, 'blocked')
  assert.ok(!JSON.stringify(last).includes('secret client facts'), 'audit must not contain prompt content')
})

test('allow-list permits; OpenAI body is portable and authenticated', async () => {
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
  const out = await llm.chat([
    { role: 'system', content: 'You are a lawyer.' },
    { role: 'user', content: 'Q' },
    { role: 'tool', content: '{"hits":1}' },
    { role: 'system', content: 'Now write.' },
  ], { maxTokens: 50 })
  assert.strictEqual(out, 'openai-ok')
  const req = seen[seen.length - 1]
  assert.strictEqual(req.headers.authorization, 'Bearer sk-test-openai')
  assert.strictEqual(req.body.model, 'gpt-test')
  assert.strictEqual(req.body.max_completion_tokens, 50)
  for (const k of ['chat_template_kwargs', 'think', 'options', 'reasoning_control']) assert.ok(!(k in req.body), `${k} must not be sent`)
  assert.deepStrictEqual(req.body.messages.map((m) => m.role), ['system', 'user'])
  assert.ok(req.body.messages[1].content.includes('[Tool result]'))
  assert.ok(req.body.messages[1].content.includes('[System note]'))
  assert.strictEqual(auditLines().pop().ok, true)
})

test('streaming with reasoning callbacks + chatStream iterator', async () => {
  const pieces = []
  const r = await llm.chatWithReasoning([{ role: 'user', content: 'hi' }], { onContent: (t) => pieces.push(t) })
  assert.strictEqual(r.content, 'Hello')
  assert.deepStrictEqual(pieces, ['Hel', 'lo'])
  const chunks = []
  for await (const c of llm.chatStream([{ role: 'user', content: 'hi' }])) chunks.push(c)
  assert.strictEqual(chunks.join(''), 'Hello')
})

test('models that reject temperature get one retry without it', async () => {
  rejectTemperature = true
  try {
    assert.strictEqual(await llm.chat([{ role: 'user', content: 'x' }], { temperature: 0 }), 'openai-ok')
    assert.ok(!('temperature' in seen[seen.length - 1].body))
  } finally { rejectTemperature = false }
})

test('per-matter rule overrides the default', async () => {
  policy.setRule('matter-123', { mode: 'local-only' })
  await assert.rejects(policy.withMatter('matter-123', () => llm.chat([{ role: 'user', content: 'x' }])), (e) => e.code === 'POLICY_BLOCKED')
  assert.strictEqual(await policy.withMatter('matter-456', () => llm.chat([{ role: 'user', content: 'x' }])), 'openai-ok')
  assert.strictEqual(auditLines().pop().matter, 'matter-456')
})

test('Anthropic: system param, x-api-key, text deltas', async () => {
  policy.setRule(null, { mode: 'allow-list', providers: ['anthropic'] })
  settings.update({ provider: 'anthropic', overrides: { baseUrl: base, model: 'claude-test' } })
  settings.update({ active: 'anthropic' })
  assert.strictEqual(await llm.chat([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]), 'anthropic-ok')
  const req = seen[seen.length - 1]
  assert.strictEqual(req.headers['x-api-key'], 'sk-test-anthropic')
  assert.ok(req.headers['anthropic-version'])
  assert.strictEqual(req.body.system, 'S')
  assert.deepStrictEqual(req.body.messages, [{ role: 'user', content: 'U' }])
  const r = await llm.chatWithReasoning([{ role: 'user', content: 'hi' }])
  assert.strictEqual(r.content, 'Claude')
})

test('cloud budget uses the provider context window, not the RAM tier', () => {
  const { effectiveAgent } = require('../src/agent-config')
  assert.strictEqual(effectiveAgent().CTX_BUDGET_TOKENS, 200000)
  settings.update({ active: 'local' })
  assert.ok(effectiveAgent().CTX_BUDGET_TOKENS <= 98304)
})

test('hosted providers can never be declared local', () => {
  settings.update({ provider: 'openai', overrides: { local: true } })
  assert.strictEqual(settings.resolve('openai').local, false)
  settings.update({ provider: 'custom', overrides: { local: true, baseUrl: 'http://10.0.0.5:8000/v1' } })
  assert.strictEqual(settings.resolve('custom').local, true)
})

test('normalizeMessages: alternation, leading user, merged system', () => {
  const { system, turns } = normalizeMessages([
    { role: 'system', content: 'A' }, { role: 'system', content: 'B' },
    { role: 'assistant', content: 'x' }, { role: 'assistant', content: 'y' }, { role: 'user', content: 'z' },
  ])
  assert.strictEqual(system, 'A\n\nB')
  assert.deepStrictEqual(turns.map((t) => t.role), ['user', 'assistant', 'user'])
  assert.strictEqual(turns[1].content, 'x\n\ny')
})
