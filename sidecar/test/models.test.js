"use strict"
/**
 * Model profiles: lookup by model name, map overrides and new profiles,
 * validation, and what a profile changes on the wire (temperature, tool
 * protocol, output cap, context budget, extra instructions). Offline: a
 * fake OpenAI-compatible server stands in for the hosted model.
 *
 *   node --test test/models.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-models-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const requests = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    requests.push(body)
    if (body.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`) }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
  })
})

let models, settings, policy
const writeUser = (cfg) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify(cfg))
const useModel = (model) => settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model } })

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  settings = require('../src/providers/settings')
  useModel('gpt-x')
  settings.update({ active: 'openai' })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  models = require('../src/models')
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('built-in lookup by model name and provider kind', () => {
  const pick = (kind, model) => models.profileFor({ kind, model })
  assert.strictEqual(pick('local', 'lotus-2-reasoning-q4_k_m').thinking, 'native')
  assert.strictEqual(pick('local', 'lotus-ai-q4km').thinking, 'inline')
  assert.strictEqual(pick('local', 'Qwen3.5-2B-Q4_K_M').name, 'qwen3-local')
  assert.strictEqual(pick('local', 'granite-4.1-3b').name, 'generic-local')
  assert.strictEqual(pick('openai', 'gpt-5.1').temperature, null)
  assert.strictEqual(pick('openai', 'o3-mini').name, 'openai-reasoning')
  assert.strictEqual(pick('anthropic', 'claude-sonnet-5-5').tools, 'native')
  assert.strictEqual(pick('openai', 'deepseek/deepseek-r1').tools, 'json')
  assert.strictEqual(pick('openai', 'mistral-large-latest').name, 'generic-hosted')
  assert.strictEqual(pick('openai', 'lotus-2').name, 'generic-hosted', 'local profiles never apply to hosted providers')
  assert.strictEqual(pick('local', undefined).model, require('../src/config').LLM_MODEL_NAME, 'local without a name uses the configured GGUF')
})

test('the map changes built-ins field by field and adds profiles before them', () => {
  writeUser({ models: { 'lotus-2': { thinkingBudget: 200 }, 'firm-gateway': { kind: 'hosted', match: ['^firm/'], tools: 'json', ctx: 16000, instructions: 'Answer in German.' } } })
  const l2 = models.profileFor({ kind: 'local', model: 'lotus-2-reasoning' })
  assert.strictEqual(l2.thinkingBudget, 200)
  assert.strictEqual(l2.thinking, 'native', 'unchanged fields keep the built-in value')
  assert.strictEqual(l2.origin, 'built-in+map')
  const fg = models.profileFor({ kind: 'openai', model: 'firm/claude-proxy' })
  assert.strictEqual(fg.name, 'firm-gateway', 'map profiles are tried before built-ins (claude would match)')
  writeUser({ models: { lotus: { thinking: 'loud' } } })
  assert.strictEqual(models.profileFor({ kind: 'local', model: 'lotus-ai' }).thinking, 'inline', 'an invalid change is ignored')
})

test('validation', () => {
  assert.deepStrictEqual(models.validate({ claude: { temperature: 0.2 } }), [])
  const p = models.validate({ x: { match: ['('], thinking: 'loud', tools: 'xml', ctx: -1, temperature: 5, kind: 'cloud' }, y: { tools: 'json' } })
  assert.strictEqual(p.length, 7, p.join('\n'))
  assert.ok(p.some((e) => /y: a new profile needs a "match" list/.test(e)))
  assert.deepStrictEqual(models.validate([]), ['models: must be an object of named profiles'])
})

test('on the wire: temperature, tool protocol, output cap', async () => {
  writeUser({})
  const llm = require('../src/llm')
  const call = (opts) => policy.withMatter(null, () => llm.chat([{ role: 'system', content: 's' }, { role: 'user', content: 'x' }], opts))

  useModel('gpt-5.1')
  requests.length = 0
  await call({ phase: 'planning', maxTokens: 900 })
  assert.ok(!('temperature' in requests[0]), 'gpt-5 profile: no temperature sent')
  assert.ok(requests[0].tools?.length, 'native tools by default')

  writeUser({ models: { 'openai-reasoning': { tools: 'json', maxOutput: 300 } } })
  requests.length = 0
  await call({ phase: 'planning', maxTokens: 900 })
  assert.ok(!requests[0].tools, 'tools: json → no native tool definitions')
  assert.strictEqual(requests[0].max_completion_tokens ?? requests[0].max_tokens, 300)

  writeUser({})
  useModel('mistral-large-latest')
  requests.length = 0
  await call({ temperature: 0.3 })
  assert.strictEqual(requests[0].temperature, 0.3)
})

test('context budget and model notes follow the planning model', async () => {
  writeUser({ models: { 'firm-gateway': { kind: 'hosted', match: ['^firm/'], ctx: 16000, instructions: 'Always answer in German.' } } })
  useModel('firm/llm-1')
  assert.strictEqual(require('../src/agent-config').effectiveAgent().CTX_BUDGET_TOKENS, 16000)
  const roles = models.explain()
  assert.ok(roles.every((r) => r.profile === 'firm-gateway'))

  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  requests.length = 0
  await policy.withMatter(null, () => runAction({ doc: new Document('§ 1 Test.', 'd-m'), memory: null, session: null, summary: () => '' }, 'Summarise', () => {}, {}))
  const system = requests[0].messages.find((m) => m.role === 'system').content
  assert.match(system, /MODEL NOTES\nAlways answer in German\./)
})
