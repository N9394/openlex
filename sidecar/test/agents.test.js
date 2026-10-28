"use strict"
/**
 * Agent profiles: built-ins, openlex.json profiles, "@name", routes per
 * profile, depth budgets, tool allow-lists combined with skills, matter
 * defaults.
 *
 *   node --test test/agents.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-agents-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const requests = []
const replies = []
function fake(name) {
  return http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      requests.push({ name, body })
      const content = replies.length ? replies.shift() : `answer from ${name}`
      if (body.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`) }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
}
const cloud = fake('cloud')
const onprem = fake('onprem')

let agents, policy
const writeUser = (cfg) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify(cfg))

test.before(async () => {
  for (const s of [cloud, onprem]) await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${cloud.address().port}/v1`, model: 'gpt-x', nativeTools: false } })
  settings.update({ provider: 'custom', overrides: { baseUrl: `http://127.0.0.1:${onprem.address().port}/v1`, model: 'firm-llm', local: true, nativeTools: false } })
  settings.update({ active: 'openai' })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  agents = require('../src/agents')
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { for (const s of [cloud, onprem]) s.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('built-ins, config profiles, overrides and invalid entries', () => {
  writeUser({ agents: { 'tax-desk': { title: 'Tax desk', instructions: 'Answer for Austrian tax law only.', tools: ['search_law', 'get_law_section'], depth: 'deep' }, drafter: { routes: { write: 'custom' } }, 'Bad Name': {} } })
  const all = agents.list()
  for (const n of ['associate', 'researcher', 'reviewer', 'drafter', 'tax-desk']) assert.ok(all.find((a) => a.name === n && !a.error), n)
  const drafter = agents.get('drafter')
  assert.strictEqual(drafter.source, 'built-in+config')
  assert.deepStrictEqual(drafter.routes, { write: 'custom' })
  assert.match(drafter.instructions, /firm's own wording/, 'config overrides only the given fields')
  assert.ok(all.find((a) => a.name === 'Bad Name').error)
  assert.deepStrictEqual(agents.validate({ x1: { depth: 'insane', tools: ['nope'], routes: { write: 'mystery' } } }).length, 3)
})

test('"@name" invocation and combination with a skill', () => {
  const inv = agents.parseInvocation('@researcher /research-memo is a 2-year non-compete valid?')
  assert.strictEqual(inv.agent.name, 'researcher')
  assert.strictEqual(require('../src/skills').parseInvocation(inv.message).skill.name, 'research-memo')
  assert.strictEqual(agents.parseInvocation('@nobody hi'), null)
  assert.strictEqual(agents.parseInvocation('email me @ noon'), null)
})

test('no-"@" invocation for keyboards where @ is hard to type: "as researcher: …"', () => {
  const inv = agents.parseInvocation('As Researcher: is a 2-year non-compete valid?')
  assert.strictEqual(inv.agent.name, 'researcher')
  assert.strictEqual(inv.message, 'is a 2-year non-compete valid?')
  assert.strictEqual(agents.parseInvocation('as the reviewer: check clause 4').agent.name, 'reviewer')
  assert.strictEqual(agents.parseInvocation('als drafter: Klausel 7 neu').agent.name, 'drafter')
  assert.strictEqual(agents.parseInvocation('@Drafter fix §7').agent.name, 'drafter')
  // Ordinary sentences are left alone.
  assert.strictEqual(agents.parseInvocation('as discussed: the cap is too low'), null)
  assert.strictEqual(agents.parseInvocation('as soon as possible please'), null)
  // The same matcher against a list from GET /api/agents (the terminal app).
  const listed = [{ name: 'tax-desk', title: 'Tax desk' }, { name: 'broken', error: 'x' }]
  assert.strictEqual(agents.matchInvocation('as tax desk: VAT on this?', listed).agent.name, 'tax-desk')
  assert.strictEqual(agents.matchInvocation('@broken hi', listed), null)
})

test('profile routes come before role routes; rules and the policy still come first', async () => {
  writeUser({ routes: { roles: { write: 'openai' } }, agents: { drafter: { routes: { write: 'custom' } } } })
  const llm = require('../src/llm')
  const ask = () => policy.withMatter(null, () => llm.chat([{ role: 'user', content: 'x' }], { role: 'write' }))
  assert.strictEqual(await ask(), 'answer from cloud')
  assert.strictEqual(await agents.run(agents.get('drafter'), ask), 'answer from onprem')
  writeUser({ routes: { rules: [{ when: { role: 'write' }, use: 'openai' }] }, agents: { drafter: { routes: { write: 'custom' } } } })
  assert.strictEqual(await agents.run(agents.get('drafter'), ask), 'answer from cloud', 'a firm rule beats the profile')
  const r = require('../src/routing').explain({ agent: 'drafter' }).find((x) => x.role === 'write')
  assert.deepStrictEqual(r.candidates.map((c) => c.reason), ['rule 1', 'agent drafter'])
})

test('depth budget follows the profile', () => {
  const { effectiveAgent } = require('../src/agent-config')
  const base = effectiveAgent().DEPTH
  assert.strictEqual(agents.run(agents.get('researcher'), () => effectiveAgent()).DEPTH, 'deep')
  assert.strictEqual(effectiveAgent().DEPTH, base)
})

test('tool allow-lists: profile ∩ skill; the agent loop enforces them and carries the instructions', async () => {
  writeUser({})
  const skill = require('../src/skills').validate({ name: 'law-only', description: 't', tools: ['search_law', 'search_ris'] }, 'Cite first.')
  const set = agents.allowedTools(agents.get('researcher'), skill)
  assert.ok(set.has('search_law') && set.has('search_ris') && !set.has('web_fetch'))
  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  requests.length = 0
  replies.push(JSON.stringify({ reasoning: 'r', tool: 'write_file', args: { path: 'x.md', content: 'y' } }), 'Done.')
  const reviewer = { ...agents.get('reviewer'), tools: ['search_law'] }
  await policy.withMatter(null, () => agents.run(reviewer, () => runAction({ doc: new Document('§ 1 Test.', 'd-ag'), memory: null, session: null, summary: () => '' }, 'Review', () => {}, { agent: reviewer })))
  const system = requests[0].body.messages.find((m) => m.role === 'system').content
  assert.match(system, /AGENT PROFILE: Reviewer/)
  assert.ok(requests.some((q) => q.body.messages.some((m) => /write_file" is not an available tool for this agent profile or skill/.test(m.content || ''))))
})

test('matter default profile', () => {
  const matters = require('../src/matters')
  const m = matters.create({ title: 'Tax case' })
  assert.throws(() => matters.update(m.id, { agent: 'ghost' }), /no agent profile/)
  matters.update(m.id, { agent: 'researcher' })
  assert.strictEqual(matters.get(m.id).agent, 'researcher')
})
