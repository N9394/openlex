"use strict"
/**
 * Planner with plan approval (Phase 7.3).
 *
 *   node --test test/plan.test.js
 *
 * A fake model proposes a plan with two unusable steps (must be dropped
 * with a note), the run must stop at the checkpoint until the lawyer
 * decides, steps after a failed one are skipped, and every run ends in a
 * report in the matter folder.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-plan-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

let planReply = '[]'
const seen = []
const llm = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    const prompt = body.messages.map((m) => m.content).join('\n')
    let content = '[]'
    if (prompt.includes('GOAL:')) { content = planReply; seen.push('plan') }
    else if (prompt.includes('extract a chronology')) { content = JSON.stringify([{ date: '2026-03-01', event: 'Signed', quote: 'Signed on 1 March 2026' }]); seen.push('chronology') }
    else if (prompt.includes('fill a review table')) { content = JSON.stringify([{ column: 'term', value: '24 months', quote: 'in force for 24 months' }]); seen.push('grid') }
    else { content = 'Austrian law applies; see the contract.'; seen.push('agent') }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})

const folder = path.join(DATA, 'Deal docs')
let plan, matterId
test.before(async () => {
  await new Promise((r) => llm.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'gpt-test', nativeTools: false } })
  settings.update({ active: 'openai' })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, 'nda-acme.txt'), 'NDA\n\n1. This Agreement remains in force for 24 months.\n\n2. Signed on 1 March 2026 in Vienna.')
  fs.writeFileSync(path.join(folder, 'nda-acme-v2.txt'), 'NDA\n\n1. This Agreement remains in force for 36 months.\n\n2. Signed on 1 March 2026 in Vienna.')
  const m = require('../src/matters').create({ title: 'Acme DD', number: '2026-040' })
  matterId = m.id
  require('../src/library').addFolder(folder, m.id)
  plan = require('../src/plan')
})
test.after(() => { llm.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

const withMatter = (fn) => require('../src/policy').withMatter(matterId, fn)

test('propose: unusable steps are dropped with a note; steps after a checkpoint wait for it', async () => {
  planReply = JSON.stringify([
    { id: 's1', kind: 'chronology', title: 'Timeline' },
    { id: 's2', kind: 'grid', title: 'Key terms', args: { title: 'Key terms', columns: [{ id: 'term', label: 'Term', prompt: 'How long?' }] } },
    { id: 's3', kind: 'checkpoint', title: 'Scope', args: { question: 'Go on with the research?' } },
    { id: 's4', kind: 'research', title: 'Law', args: { question: 'Which law governs NDAs like this?' } },
    { id: 's5', kind: 'send_email', title: 'Email the client' },
    { id: 's6', kind: 'translate', title: 'Translate', args: { file: 'does-not-exist.docx', target: 'de' } },
  ])
  const p = await withMatter(() => plan.propose({ goal: 'Due diligence on the Acme NDAs', matterId }))
  assert.deepStrictEqual(p.steps.map((s) => s.id), ['s1', 's2', 's3', 's4'])
  assert.ok(p.notes.some((n) => /unknown kind "send_email"/.test(n)))
  assert.ok(p.notes.some((n) => /translate.*document/.test(n)))
  assert.deepStrictEqual(p.steps.find((s) => s.id === 's4').dependsOn, ['s3'])
  assert.strictEqual(p.status, 'proposed')
  await assert.rejects(() => plan.run(p.id), /approve/)
})

test('run: work runs, the checkpoint pauses the plan, the lawyer continues, the report records it', async () => {
  const p0 = plan.list(matterId)[0]
  plan.approve(p0.id)
  const events = []
  let p = await withMatter(() => plan.run(p0.id, { onProgress: (e) => events.push(e) }))
  assert.strictEqual(p.status, 'waiting')
  assert.deepStrictEqual(p.steps.map((s) => s.status), ['done', 'done', 'waiting', 'pending'])
  assert.ok(!seen.includes('agent'), 'nothing after the checkpoint ran before the decision')
  assert.ok(events.some((e) => e.status === 'waiting' && /Go on/.test(e.question)))
  assert.throws(() => plan.decide(p0.id, { stepId: 's1', decision: 'continue' }), /no checkpoint/)

  plan.decide(p0.id, { stepId: 's3', decision: 'continue', note: 'focus on Austrian law' })
  p = await withMatter(() => plan.run(p0.id))
  assert.strictEqual(p.status, 'done')
  assert.strictEqual(p.steps.find((s) => s.id === 's4').status, 'done')
  const report = fs.readFileSync(p.report, 'utf8')
  assert.match(report, /Lawyer's decision: continue — focus on Austrian law/)
  assert.match(report, /verified cells/)
  assert.match(report, /2 dated events from 2 documents/)
  assert.strictEqual(report.match(/focus on Austrian law/g).length, 1, "the decision is reported once")
})

test('stop at a checkpoint skips the rest; a failed step skips its dependents', async () => {
  planReply = JSON.stringify([
    { id: 'a', kind: 'compare', title: 'Compare', args: { fileA: 'nda-acme.txt', fileB: 'nda-acme-v2.txt' } },
    { id: 'b', kind: 'research', title: 'Depends on compare', args: { question: 'What changed legally?' }, dependsOn: ['a'] },
    { id: 'c', kind: 'checkpoint', title: 'Decide', args: { question: 'Continue?' } },
    { id: 'd', kind: 'chronology', title: 'After' },
  ])
  const p = await withMatter(() => plan.propose({ goal: 'Compare and decide', matterId }))
  plan.approve(p.id)
  fs.renameSync(path.join(folder, 'nda-acme-v2.txt'), path.join(DATA, 'moved.txt')) // compare will fail
  const r = await withMatter(() => plan.run(p.id))
  assert.strictEqual(r.steps.find((s) => s.id === 'a').status, 'failed')
  assert.strictEqual(r.steps.find((s) => s.id === 'b').status, 'skipped')
  assert.strictEqual(r.status, 'waiting')
  const stopped = plan.decide(p.id, { stepId: 'c', decision: 'stop' })
  assert.strictEqual(stopped.status, 'stopped')
  assert.strictEqual(stopped.steps.find((s) => s.id === 'd').status, 'skipped')
  assert.ok(fs.existsSync(stopped.report))
})

test('lawyer edits are re-validated', () => {
  const p = plan.list(matterId).find((x) => x.status === 'done')
  assert.throws(() => plan.update(p.id, { steps: [] }), /edit it before running/)
  const { steps, notes } = plan.cleanSteps([{ kind: 'research', args: {} }, { kind: 'skill', args: { skill: 'nda-review', file: 'nda-acme.txt' } }], { documents: [path.join(folder, 'nda-acme.txt')] })
  assert.strictEqual(steps.length, 1)
  assert.strictEqual(steps[0].args.file, path.join(folder, 'nda-acme.txt'), 'document names resolve to the matter file')
  assert.match(notes[0], /needs a question/)
})
