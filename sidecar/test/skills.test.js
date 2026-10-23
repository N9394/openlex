"use strict"
/**
 * Skills (Phase 7.2): SKILL.md parsing, bundled + firm skills, "/name"
 * invocation, suggestions (keywords and decision model), the agent
 * running with a skill (prompt block + tool allow-list), and the
 * playbook builder (standards only with a verbatim quote).
 *
 *   node --test test/skills.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-skills-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

// Fake model: records every request; replies from a queue (or "[]").
const requests = []
const replies = []
const llm = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    requests.push(body)
    const content = replies.length ? replies.shift() : 'Done.'
    if (body.stream) { // the agent loop streams (OpenAI SSE format)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})
// Fake decision model (System One).
let deciderChoice = 'lease-review'
const kev = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    const opts = Object.keys(body.questions.skill.criteria)
    const probabilities = Object.fromEntries(opts.map((o) => [o, o === deciderChoice ? 0.9 : 0.1 / (opts.length - 1)]))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ answers: { skill: { type: 'choice', choice: deciderChoice, confidence: 0.85, probabilities } } }))
  })
})

let skills
test.before(async () => {
  await new Promise((r) => llm.listen(0, '127.0.0.1', r))
  await new Promise((r) => kev.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'gpt-test', nativeTools: false } })
  settings.update({ active: 'openai' })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  skills = require('../src/skills')
})
test.after(() => { llm.close(); kev.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('SKILL.md: parse, validate, render round-trip; bad files are reported, not fatal', () => {
  const src = '---\nname: my-skill\ntitle: Mine\ndescription: Does a thing.\ntriggers:\n  - first phrase\n  - zweite, mit komma\ntools: [search_law]\n---\nStep one.\n'
  const { meta, body } = skills.parse(src)
  const s = skills.validate(meta, body)
  assert.deepStrictEqual(s.triggers, ['first phrase', 'zweite, mit komma'])
  const again = skills.validate(...Object.values(skills.parse(skills.render(s))))
  assert.deepStrictEqual(again, s)
  assert.throws(() => skills.validate({ name: 'Bad Name', description: 'x' }, 'y'), /lowercase/)
  assert.throws(() => skills.validate({ name: 'ok-name' }, 'y'), /description/)
})

test('bundled starters load; a firm skill overrides by name; invalid firm files are listed with their error', () => {
  const bundled = skills.list()
  assert.ok(bundled.length >= 8 && bundled.every((s) => !s.error), bundled.filter((s) => s.error).map((s) => s.error).join('; '))
  for (const s of bundled) for (const t of s.tools) assert.ok(require('../src/tools').TOOLS[t], `${s.name} names unknown tool ${t}`)
  skills.save('---\nname: nda-review\ntitle: NDA review (firm)\ndescription: Our NDA standard.\n---\nUse the firm NDA v3.\n')
  const ws = require('../src/workspace')
  ws.writeFile('skills/broken.md', 'no frontmatter, no description')
  const s = skills.get('nda-review')
  assert.strictEqual(s.source, 'firm')
  assert.strictEqual(s.overrides, 'bundled')
  assert.match(skills.list().find((x) => x.name === 'broken').error, /description/)
  skills.remove('nda-review')
  assert.strictEqual(skills.get('nda-review').source, 'bundled')
  assert.throws(() => skills.remove('lease-review'), /bundled/)
})

test('"/name" invocation', () => {
  const inv = skills.parseInvocation('/lease-review  we act for the tenant')
  assert.strictEqual(inv.skill.name, 'lease-review')
  assert.strictEqual(inv.message, 'we act for the tenant')
  assert.strictEqual(skills.parseInvocation('/not-a-skill hi'), null)
  assert.strictEqual(skills.parseInvocation('a/b test'), null)
})

test('suggestion: keywords without a decider; the decider (System One choice) when configured', async () => {
  assert.strictEqual((await skills.suggest('Please review this NDA for the recipient')).name, 'nda-review')
  assert.strictEqual(await skills.suggest('what is the weather'), null)
  const decide = require('../src/decide')
  decide.saveConfig({ url: `http://127.0.0.1:${kev.address().port}`, model: 'kev-test' })
  const hit = await skills.suggest('Prüfe die Räumlichkeiten-Vereinbarung für den Mieter')
  assert.deepStrictEqual([hit.name, hit.via], ['lease-review', 'decider'])
  deciderChoice = 'none'
  assert.strictEqual(await skills.suggest('Please review this NDA'), null, 'the decider said none: no keyword second-guessing')
  decide.saveConfig(null)
})

test('agent with a skill: instructions in the system prompt, tools outside the allow-list are refused', async () => {
  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  const skill = skills.validate({ name: 'only-law', title: 'Only law', description: 'test', tools: ['search_law'] }, 'Always cite the statute first.')
  requests.length = 0
  replies.push(JSON.stringify({ reasoning: 'check RIS', tool: 'search_ris', args: { query: 'MRG' } }), 'Final answer.')
  const ctx = { doc: new Document('§ 1 Test clause.', 'doc-skill'), memory: null, session: null, summary: () => '' }
  const r = await runAction(ctx, 'What applies?', () => {}, { skill })
  const system = requests[0].messages.find((m) => m.role === 'system').content
  assert.match(system, /ACTIVE SKILL: Only law/)
  assert.match(system, /Always cite the statute first\./)
  const steer = requests.flatMap((q) => q.messages).find((m) => /not an available tool for this agent profile or skill/.test(m.content || ''))
  assert.ok(steer, 'search_ris was refused under the skill')
  assert.match(steer.content, /Available: search_law/)
  assert.match(r.text, /Final answer/)
})

test('playbook builder: standards kept only with a verbatim quote from the precedents; save to workspace', async () => {
  const wf = require('../src/workflows')
  const dir = path.join(DATA, 'precedents')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'firm-nda.txt'), 'Mutual NDA (firm standard)\n\n5. Term. The obligations end three (3) years after disclosure.\n\n9. Law. Austrian law applies; courts of Vienna.')
  replies.push(JSON.stringify([
    { id: 'term', question: 'How long do the obligations last?', standard: 'Three years after disclosure.', quote: 'The obligations end three (3) years after disclosure.', severity: 'high' },
    { id: 'law', question: 'Which law applies?', standard: 'Swiss law.', quote: 'Swiss law applies.', severity: 'medium' },
  ]))
  const d = await wf.draftPlaybook({ files: [path.join(dir, 'firm-nda.txt')], title: 'Firm NDA' })
  assert.strictEqual(d.playbook.checks.find((c) => c.id === 'term').standard, 'Three years after disclosure.')
  assert.strictEqual(d.playbook.checks.find((c) => c.id === 'law').standard, undefined, 'an invented standard is dropped, the question stays')
  assert.strictEqual(d.unproven, 1)
  const saved = wf.savePlaybook('Firm NDA', d.playbook)
  assert.strictEqual(saved.name, 'firm-nda')
  assert.strictEqual(wf.loadPlaybook('firm-nda').checks.length, 2)
})

test('skill builder: a plain-language request becomes a validated draft (not saved)', async () => {
  replies.push('Sure, here it is:\n```markdown\n---\nname: Whatever Model Says\ntitle: Supplier onboarding check\ndescription: Check a supplier contract against our onboarding rules.\ntriggers: [supplier onboarding, lieferantenvertrag]\noutput: text\n---\n1. Read the contract.\n2. Check payment terms are at least 60 days.\n```')
  const before = skills.list().length
  const d = await skills.draft({ request: 'Check supplier contracts for 60-day payment terms', name: 'supplier-onboarding' })
  assert.strictEqual(d.skill.name, 'supplier-onboarding', 'the requested name wins over the model\'s')
  assert.match(d.content, /^---\nname: supplier-onboarding\n/)
  assert.match(d.skill.body, /60 days/)
  assert.strictEqual(skills.list().length, before, 'drafts are never saved automatically')
  replies.push('I cannot help with that.')
  await assert.rejects(() => skills.draft({ request: 'x' }), /description|name/)
})
