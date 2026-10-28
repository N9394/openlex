"use strict"
/**
 * Hooks: firm rules at the harness's decision points.
 *
 *   node --test test/hooks.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-hooks-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const calls = { cloud: 0, onprem: 0 }
const replies = []
function fake(name) {
  return http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      calls[name]++
      const content = replies.length ? replies.shift() : `answer from ${name}`
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
}
const cloud = fake('cloud')
const onprem = fake('onprem')
const kev = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => { const b = JSON.parse(raw); res.end(JSON.stringify({ answers: { q: { type: 'noul', noul: /tax/i.test(b.state) ? 0.88 : 0.05 } } })) })
})

let hooks, policy
const setHooks = (h) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify({ hooks: h, routes: { fallback: ['custom'] } }))
const script = (body) => { const f = path.join(DATA, `hook-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(f, body); return `"${process.execPath}" "${f}"` }

test.before(async () => {
  for (const s of [cloud, onprem, kev]) await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${cloud.address().port}/v1`, model: 'gpt-x', nativeTools: false } })
  settings.update({ provider: 'custom', overrides: { baseUrl: `http://127.0.0.1:${onprem.address().port}/v1`, model: 'firm-llm', local: true, nativeTools: false } })
  settings.update({ active: 'openai' })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  hooks = require('../src/hooks')
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai', 'web'] })
})
test.after(() => { for (const s of [cloud, onprem, kev]) s.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('validate', () => {
  const p = hooks.validate({ before_lunch: [], before_tool: [{ action: 'nuke' }, { type: 'command' }, { match: { regex: '(' } }] })
  assert.strictEqual(p.length, 4, p.join('\n'))
  assert.deepStrictEqual(hooks.validate({ before_answer: [{ match: { regex: '(?i)guarantee' }, action: 'warn', message: 'x' }] }), [])
})

test('rules: deny, warn, flag, glob hosts, case-insensitive regex; first deny wins', async () => {
  setHooks({
    before_answer: [
      { match: { notRegex: '§|Art\\.', minChars: 20 }, action: 'warn', message: 'No citation.' },
      { match: { regex: '(?i)GUARANTEED' }, action: 'deny', reason: 'No guarantees.' },
    ],
    before_web: [{ match: { host: ['*.gossip.example'] }, action: 'deny', reason: 'Not a source.' }],
  })
  let r = await hooks.run('before_answer', { text: 'The cap is valid under the general rules of contract law.' })
  assert.deepStrictEqual([r.decision, r.warnings], ['allow', ['No citation.']])
  r = await hooks.run('before_answer', { text: 'Success is guaranteed, see § 879 ABGB.' })
  assert.deepStrictEqual([r.decision, r.reason], ['deny', 'No guarantees.'])
  assert.strictEqual((await hooks.run('before_web', { host: 'news.gossip.example' })).decision, 'deny')
  assert.strictEqual((await hooks.run('before_web', { host: 'gossip.example.org' })).decision, 'allow')
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  assert.ok(audit.includes('"provider":"hook"') && !audit.includes('guaranteed'), 'hook decisions audited without content')
})

test('commands: JSON decision on stdout, exit 2 = deny, timeout fails open unless onError deny', async () => {
  const flagger = script(`let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const e=JSON.parse(s);console.log(JSON.stringify(e.text.includes('indemnif')?{decision:'flag',message:'Indemnity: partner sign-off'}:{decision:'allow'}))})`)
  const denier = script(`process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('Matter closed for edits');process.exit(2)})`)
  const sleeper = script('setTimeout(()=>{}, 5000)')
  setHooks({ on_suggestion: [{ type: 'command', command: flagger }], before_tool: [{ type: 'command', command: denier, match: { tool: 'write_file' } }], after_workflow: [{ type: 'command', command: sleeper, timeoutMs: 200 }], before_model: [{ type: 'command', command: sleeper, timeoutMs: 200, onError: 'deny' }] })
  assert.deepStrictEqual((await hooks.run('on_suggestion', { text: 'The Seller shall indemnify the Buyer.' })).flags, ['Indemnity: partner sign-off'])
  const d = await hooks.run('before_tool', { tool: 'write_file' })
  assert.deepStrictEqual([d.decision, d.reason], ['deny', 'Matter closed for edits'])
  assert.strictEqual((await hooks.run('before_tool', { tool: 'search_law' })).decision, 'allow', 'match scopes the command')
  assert.strictEqual((await hooks.run('after_workflow', { workflow: 'review' })).decision, 'allow', 'timeout fails open by default')
  const closed = await hooks.run('before_model', { role: 'write' })
  assert.strictEqual(closed.decision, 'deny')
  assert.match(closed.reason, /timed out/)
})

test('decide hooks ask the decision model; skipped when none is configured', async () => {
  setHooks({ before_answer: [{ type: 'decide', question: 'Does this give tax advice?', threshold: 0.7, action: 'warn', message: 'Tax advice: route to the tax team.' }] })
  assert.deepStrictEqual((await hooks.run('before_answer', { text: 'You can deduct the tax on…' })).warnings, [])
  require('../src/decide').saveConfig({ url: `http://127.0.0.1:${kev.address().port}` })
  assert.deepStrictEqual((await hooks.run('before_answer', { text: 'You can deduct the tax on…' })).warnings, ['Tax advice: route to the tax team.'])
  assert.deepStrictEqual((await hooks.run('before_answer', { text: 'The lease ends in 2030.' })).warnings, [])
  require('../src/decide').saveConfig(null)
})

test('before_model deny skips that model and the route falls through', async () => {
  setHooks({ before_model: [{ match: { local: false, role: 'write' }, action: 'deny', reason: 'Drafting stays on the firm model.' }] })
  const llm = require('../src/llm')
  const before = { ...calls }
  assert.strictEqual(await policy.withMatter(null, () => llm.chat([{ role: 'user', content: 'x' }], { role: 'write' })), 'answer from onprem')
  assert.strictEqual(calls.cloud, before.cloud, 'the cloud model was never called')
  assert.strictEqual(await policy.withMatter(null, () => llm.chat([{ role: 'user', content: 'x' }], { role: 'judge' })), 'answer from cloud', 'other roles unaffected')
})

test('before_tool deny inside the agent loop; before_web deny in the web guard', async () => {
  setHooks({ before_tool: [{ match: { tool: 'search_ris' }, action: 'deny', reason: 'Use the firm database.' }], before_web: [{ match: { host: ['data.bka.gv.at'] }, action: 'deny', reason: 'RIS disabled.' }] })
  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  replies.push(JSON.stringify({ reasoning: 'check RIS', tool: 'search_ris', args: { query: 'MRG' } }), 'Final.')
  const before = calls.cloud
  const steps = []
  const events = []
  await policy.withMatter(null, () => runAction({ doc: new Document('§ 1 Test.', 'd-hook'), memory: null, session: null, summary: () => '' }, 'What applies?', (e) => { if (e.type === 'step') { steps.push(e.text); events.push(e) } }))
  assert.ok(steps.includes('blocked: search_ris'))
  // Every step carries a plain sentence for the lawyer (explain.js), set at emit time.
  assert.ok(events.every((e) => typeof e.plain === 'string' && e.plain.length > 0))
  assert.match(events.find((e) => e.kind === 'blocked').plain, /^Not done — your firm's rules don't allow it: checking RIS, Austria's official law database/)
  assert.ok(calls.cloud > before)
  assert.strictEqual(await require('../src/web/guard').webHook('data.bka.gv.at', 'search_ris'), 'BLOCKED by firm rule: RIS disabled.')
})

test('a tool that throws does not end the agent run', async () => {
  setHooks({})
  const tools = require('../src/tools')
  const orig = tools.TOOLS.search_law
  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  replies.push(JSON.stringify({ reasoning: 'law', tool: 'search_law', args: { query: 'Vertragsstrafe', jurisdiction: 'AT' } }), 'Answer without the law search.')
  const ctx = { doc: new Document('§ 1 Test.', 'd-throw'), memory: null, session: null, summary: () => '', embeddings: { embedQueries: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434') } }, search: {} }
  const r = await policy.withMatter(null, () => runAction(ctx, 'Is a penalty enforceable?', () => {}))
  assert.match(r.text, /Answer without the law search/)
  assert.ok(orig)
})
