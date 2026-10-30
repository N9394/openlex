"use strict"
/**
 * Panel (agents working together), custom agents made in the app, and the
 * second pass on answers — offline, with fake models:
 *   parallel answers keep the agents' order and the concurrency limit;
 *   a debate runs N rounds, each agent seeing the others' last round;
 *   the moderator's summary keeps only verifiable citations and quotes;
 *   Stop ends the panel and keeps what was said; the estimate before a
 *   cloud panel; the monthly limit stops it between rounds; an agent routed
 *   to the cloud does not see a privileged matter (and the lawyer is told);
 *   the judge is on by default, can be switched off, and a firm can lock it.
 *
 *   node --test test/panel.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-panel-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

// ── a fake model: answers by what it is asked (order-independent) ────────────
const requests = []
let inFlight = 0
let maxInFlight = 0
const delays = {} // agent title → ms
const queue = [] // scripted replies for the plain agent loop (judge test)
const JUDGE_OK = '{"ok": true, "problems": []}'
function replyFor(body) {
  const sys = body.messages.find((m) => m.role === 'system')?.content || ''
  const user = [...body.messages].reverse().find((m) => m.role === 'user')?.content || ''
  if (/You double-check a legal answer/.test(sys)) return JUDGE_OK
  if (/You moderate a panel/.test(sys)) {
    return JSON.stringify({
      agreement: [{ point: 'Damage occurred.', cites: ['S1'] }],
      disagreement: [{ point: 'Fault', positions: [{ agent: 'claimant-counsel', view: 'negligent' }, { agent: 'Defendant\'s counsel', view: 'not negligent' }], cites: ['S2', 'S99'] }],
      stronger: { agent: 'claimant-counsel', why: 'The claimant cites the statute.', cites: ['S1', 'S42'] },
      open: [{ question: 'Was the damage foreseeable?', why: 'Not argued.' }],
      quotes: [{ text: 'den Ersatz des Schadens zu fordern', source: 'S1' }, { text: 'the defendant admitted everything in writing', source: 'S1' }],
    })
  }
  const who = /You are ([^.]+)\. Your position/.exec(user)?.[1] || /as ([^:.)]+)[:.)]/.exec(user)?.[1] || ''
  const round = +(/round (\d+) of/.exec(user)?.[1] || 1)
  if (/Claimant/.test(who)) return `Round ${round}: the claimant is owed damages under § 1295 ABGB — „den Ersatz des Schadens zu fordern“.${round > 1 && /Defendant's counsel/.test(user) ? ' The defence misreads the statute.' : ''}`
  if (/Defendant/.test(who)) return `Round ${round}: no fault, so no claim (§ 1296 ABGB).${round > 1 && /Claimant's counsel/.test(user) ? ' The claimant ignores the burden of proof.' : ''}`
  if (/Devil/.test(who)) return 'Both sides overlook the limitation period.'
  if (/AT law/.test(who)) return 'Austrian law: § 879 ABGB applies.'
  if (/EU law/.test(who)) return 'EU law: Art 6 DSGVO applies.'
  if (/Third/.test(who)) return 'A third view (Art 101 AEUV).'
  if (queue.length) return queue.shift()
  return 'A plain answer.'
}
function fake(name) {
  return http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      const body = JSON.parse(raw)
      requests.push({ name, body })
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const user = [...body.messages].reverse().find((m) => m.role === 'user')?.content || ''
      const wait = Object.entries(delays).find(([k]) => user.includes(k))?.[1] || 20
      await new Promise((r) => setTimeout(r, wait))
      inFlight--
      const content = replyFor(body)
      if (res.destroyed) return
      if (body.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`) }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } }))
    })
  })
}
const cloud = fake('cloud')
const onprem = fake('onprem')

let panel, agents, policy, judge, harness, spend
const writeUser = (cfg) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify(cfg))
const firmFile = () => path.join(DATA, 'workspace', 'openlex.json')

test.before(async () => {
  for (const s of [cloud, onprem]) await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${cloud.address().port}/v1`, model: 'gpt-x', nativeTools: false } })
  settings.update({ provider: 'custom', overrides: { baseUrl: `http://127.0.0.1:${onprem.address().port}/v1`, model: 'firm-llm', local: true, nativeTools: false } })
  settings.update({ active: 'openai' })
  fs.mkdirSync(path.join(DATA, 'workspace'), { recursive: true })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  panel = require('../src/panel')
  agents = require('../src/agents')
  policy = require('../src/policy')
  judge = require('../src/judge')
  harness = require('../src/harness')
  spend = require('../src/spend')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { for (const s of [cloud, onprem]) s.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

const debaters = [{ name: 'claimant-counsel' }, { name: 'defendant-counsel' }]
const run = (o) => policy.withMatter(o.matterId || null, () => panel.run(o))

test('agents made in the app: templates, plain-word sources, where it runs, user and firm layer, lock', async () => {
  writeUser({})
  const tpl = agents.templates().map((t) => t.name)
  for (const n of ['claimant-counsel', 'defendant-counsel', 'devils-advocate', 'drafter', 'researcher', 'compliance-checker']) assert.ok(tpl.includes(n), n)
  const a = agents.save({ title: 'Tax desk', description: 'Austrian tax questions.', instructions: 'Answer Austrian tax questions with sources.', groups: ['law', 'austria'], model: 'custom', depth: 'fast' })
  assert.strictEqual(a.name, 'tax-desk')
  assert.deepStrictEqual(a.tools, ['search_law', 'get_law_section', 'search_ris'])
  assert.strictEqual(a.routes.write, 'custom', 'where it runs becomes its route')
  assert.strictEqual(a.depth, 'fast')
  assert.deepStrictEqual(agents.groupsOf(a.tools), ['law', 'austria'])
  assert.ok(harness.layers().user.data.agents['tax-desk'], 'saved in the user layer of openlex.json')
  // Edit with a new name: the old one goes.
  agents.save({ title: 'Tax desk AT', instructions: 'x y z', groups: ['law'] }, { rename: 'tax-desk' })
  assert.ok(!harness.layers().user.data.agents['tax-desk'] && harness.layers().user.data.agents['tax-desk-at'])
  assert.throws(() => agents.save({ title: '', instructions: 'x' }), /name/)
  assert.throws(() => agents.save({ title: 'Bad', instructions: 'x', model: 'nowhere' }), /unknown provider/)
  // Firm-wide, and the firm's lock.
  agents.save({ title: 'Firm drafter', instructions: 'Draft in the firm style.', groups: ['firm'] }, { scope: 'firm' })
  assert.ok(JSON.parse(fs.readFileSync(firmFile(), 'utf8')).agents['firm-drafter'])
  fs.writeFileSync(firmFile(), JSON.stringify({ ...JSON.parse(fs.readFileSync(firmFile(), 'utf8')), lock: ['agents'] }))
  assert.throws(() => agents.save({ title: 'Mine', instructions: 'x' }), /firm has fixed/)
  assert.ok(agents.list().some((x) => x.name === 'firm-drafter'))
  fs.rmSync(firmFile())
  agents.remove('tax-desk-at')
  // A template works in a panel without saving it first.
  assert.strictEqual(agents.resolve('devils-advocate').title, 'Devil\'s advocate')
  const r = await agents.handle('GET', '/api/agents', new URLSearchParams('lang=de'))
  assert.ok(r.json.groups.find((g) => g.id === 'eu').label.includes('EU-Recht'))
})

test('"Make an agent from this conversation": proposed from what the lawyer asked; nothing saved until confirmed', async () => {
  const { Session } = require('../src/session')
  new Session('conv-1').append('Check every NDA for a missing term and cite the law', 'ok', {})
  queue.push('{"title": "NDA checker", "description": "Checks NDAs.", "instructions": "You check NDAs for a missing term. Cite the law.", "groups": ["law", "documents", "nope"], "depth": "deep"}')
  const p = await agents.propose({ sessionId: 'conv-1' })
  assert.strictEqual(p.proposal.title, 'NDA checker')
  assert.deepStrictEqual(p.proposal.groups, ['law', 'documents'])
  assert.ok(!agents.list().some((a) => a.title === 'NDA checker'), 'only a proposal')
  queue.push('not json at all')
  const f = await agents.propose({ sessionId: 'conv-1' })
  assert.match(f.proposal.instructions, /Check every NDA/)
  await assert.rejects(agents.propose({ sessionId: 'empty' }), /no questions/)
})

test('parallel: answers in the agents\' order (not finishing order), at most N at once, each attributed', async () => {
  writeUser({ panel: { concurrency: 2 } })
  maxInFlight = 0
  delays['Researcher AT law'] = 250
  const events = []
  const r = await run({ mode: 'parallel', question: 'Is the clause valid?', agents: [{ name: 'researcher', label: 'Researcher AT law', side: 'AT law' }, { name: 'researcher', label: 'Researcher EU law', side: 'EU law' }, { name: 'devils-advocate', label: 'Third view', side: 'Third' }], onEvent: (e) => events.push(e) })
  delete delays['Researcher AT law']
  assert.deepStrictEqual(r.turns.map((t) => t.title), ['Researcher AT law', 'Researcher EU law', 'Third view'])
  assert.deepStrictEqual(r.members.map((m) => m.lane), ['researcher', 'researcher-2', 'devils-advocate'])
  assert.match(r.turns[0].text, /§ 879 ABGB/)
  assert.ok(maxInFlight <= 2, `at most 2 calls at once (saw ${maxInFlight})`)
  const finished = events.filter((e) => e.type === 'panel_turn').map((e) => e.lane)
  assert.notStrictEqual(finished[0], 'researcher', 'the slow one finished later')
  assert.ok(events.some((e) => e.type === 'panel_lane' && e.lane === 'researcher-2' && e.status === 'done'))
  const md = panel.toMarkdown(r)
  assert.match(md, /## Researcher AT law[\s\S]*## Researcher EU law/)
  assert.deepStrictEqual(r.turns.find((t) => t.lane === 'researcher').citations.map((c) => c.text), ['§ 879 ABGB'])
})

test('debate: N rounds, each agent sees the others\' last round; the moderator keeps only verifiable citations', async () => {
  writeUser({})
  const events = []
  const r = await run({ mode: 'debate', rounds: 2, question: 'Is the defendant liable?', agents: debaters, onEvent: (e) => events.push(e) })
  assert.deepStrictEqual(r.turns.map((t) => `${t.round}:${t.lane}`), ['1:claimant-counsel', '1:defendant-counsel', '2:claimant-counsel', '2:defendant-counsel'])
  assert.match(r.turns[2].text, /The defence misreads/, 'round 2 saw the other side')
  assert.match(r.turns[3].text, /burden of proof/)
  const round2 = requests.filter((q) => /round 2 of 2/.test(q.body.messages.at(-1).content))
  assert.ok(round2.length >= 2 && round2.every((q) => /What the others said in round 1/.test(q.body.messages.at(-1).content)))
  // Sources: what the agents named, numbered once.
  assert.deepStrictEqual(r.sources.map((s) => `${s.id} ${s.label}`), ['S1 § 1295 ABGB', 'S2 § 1296 ABGB'])
  const s = r.summary
  assert.deepStrictEqual(s.agreement[0].cites, ['S1'])
  assert.deepStrictEqual(s.disagreement[0].cites, ['S2'], 'an invented source is dropped')
  assert.deepStrictEqual(s.disagreement[0].positions.map((p) => p.lane), ['claimant-counsel', 'defendant-counsel'], 'agents by id or by name')
  assert.strictEqual(s.stronger.title, 'Claimant\'s counsel')
  assert.deepStrictEqual(s.stronger.cites, ['S1'])
  assert.deepStrictEqual(s.quotes.map((q) => q.text), ['den Ersatz des Schadens zu fordern'], 'a quote not found word for word is removed')
  assert.strictEqual(s.removed, 3)
  assert.strictEqual(s.open[0].question, 'Was the damage foreseeable?')
  assert.ok(events.some((e) => e.type === 'panel_summary'))
  assert.ok(events.filter((e) => e.type === 'panel_round').length === 2)
  // Stored, exported, saved with the matter and found by the app's search.
  assert.strictEqual(panel.get(r.id).summary.stronger.lane, 'claimant-counsel')
  const md = panel.toMarkdown(r)
  assert.match(md, /The stronger position[\s\S]*Claimant's counsel/)
  assert.match(md, /Where they disagree[\s\S]*\[S2\]/)
  assert.match(md, /Round 1 — Claimant's counsel/)
  for (const fmt of ['docx', 'pdf', 'md']) assert.ok(panel.exportPanel(r.id, fmt).bytes > 100, fmt)
  const saved = require('../src/saved').add({ kind: 'panel', title: r.question, content: md, source: { kind: 'panel', id: r.id } })
  assert.ok(require('../src/saved').exportItem(saved.id, 'pdf').name.endsWith('.pdf'))
  const groups = require('../src/find').find({ q: 'defendant liable' }).groups.map((g) => g.kind)
  assert.ok(groups.includes('panel') && groups.includes('saved'), groups.join())
})

test('checkSummary: unreadable moderator output falls back to the positions', () => {
  const s = panel.checkSummary('no json', { sources: [], members: [], turns: [] })
  assert.ok(s.fallback)
})

test('review chain: drafter → reviewer → drafter revises', async () => {
  queue.length = 0
  const r = await run({ mode: 'review', question: 'Draft a confidentiality clause', agents: [{ name: 'drafter' }, { name: 'reviewer' }] })
  assert.deepStrictEqual(r.turns.map((t) => `${t.lane}:${t.kind}`), ['drafter:draft', 'reviewer:review', 'drafter:revision'])
  const revise = requests.filter((q) => /Revise your draft/.test(q.body.messages.at(-1).content)).at(-1)
  assert.match(revise.body.messages.at(-1).content, /THE REVIEW \(Reviewer\)/)
  assert.strictEqual(r.final, r.turns[2].text)
  assert.ok(!r.summary, 'no moderator in a review')
})

test('Stop: ends every agent, keeps what was said, no further round, no summary', async () => {
  const ac = new AbortController()
  const r = await run({ mode: 'debate', rounds: 3, question: 'Stop me', agents: debaters, signal: ac.signal, onEvent: (e) => { if (e.type === 'panel_turn') ac.abort() } })
  assert.strictEqual(r.stopped, 'you')
  assert.ok(r.turns.length >= 1 && r.turns.every((t) => t.round === 1))
  assert.strictEqual(r.summary, null)
})

test('estimate before a cloud panel; nothing to confirm on this computer', () => {
  writeUser({})
  const e = policy.withMatter(null, () => panel.estimate({ mode: 'debate', rounds: 2, agents: debaters }))
  assert.strictEqual(e.calls, 2 * 2 * 3 + 1, 'agents × rounds × calls per turn + the moderator')
  assert.strictEqual(e.cloudCalls, e.calls)
  assert.ok(e.needsConfirm && e.eur > 0)
  assert.match(e.text, /about 13 AI calls, 13 of them to online AI: about €/)
  writeUser({ agents: { 'local-a': { title: 'Local A', instructions: 'a', model: 'custom' }, 'local-b': { title: 'Local B', instructions: 'b', model: 'custom' } }, routes: { roles: { judge: 'custom' } } })
  const l = policy.withMatter(null, () => panel.estimate({ mode: 'debate', rounds: 2, agents: ['local-a', 'local-b'] }))
  assert.strictEqual(l.cloudCalls, 0)
  assert.ok(!l.needsConfirm && l.eur === 0)
  assert.match(l.text, /all on this computer/)
  assert.throws(() => panel.estimate({ mode: 'debate', agents: ['local-a'] }), /at least two/)
  assert.throws(() => panel.estimate({ mode: 'review', agents: ['drafter', 'reviewer', 'researcher'] }), /two agents/)
  writeUser({})
})

test('the monthly limit stops the panel between rounds and keeps round 1', async () => {
  writeUser({ spending: { cap: 5 } })
  const before = spend.status().total
  const r = await run({ mode: 'debate', rounds: 2, question: 'Expensive', agents: debaters, onEvent: (e) => { if (e.type === 'panel_round' && e.round === 2) spend.record({ provider: 'openai', model: 'gpt-x', usage: { cost: 20 } }) } })
  assert.ok(spend.status().total > before)
  assert.strictEqual(r.stopped, 'cap')
  assert.deepStrictEqual(r.turns.map((t) => t.round), [1, 1])
  assert.ok(r.notes.some((n) => /limit for online AI/.test(n) && /what was said so far is kept/.test(n)))
  const e = panel.estimate({ mode: 'debate', agents: debaters })
  assert.ok(e.capReached && e.overCap)
  writeUser({})
})

test('data policy per agent: an agent set to an online AI does not see a privileged matter — and the lawyer is told', async () => {
  writeUser({ agents: { 'cloud-advocate': { title: 'Cloud advocate', instructions: 'Argue.', model: 'openai' }, 'home-advocate': { title: 'Home advocate', instructions: 'Argue.', model: 'custom' }, 'home-critic': { title: 'Home critic', instructions: 'Criticise.', model: 'custom' } }, routes: { roles: { judge: 'custom' } } })
  const m = require('../src/matters').create({ title: 'Secret case', privileged: true })
  const ms = panel.members(['cloud-advocate', 'home-advocate'], m.id)
  assert.ok(!ms[0].provider)
  assert.match(ms[0].note, /Cloud advocate is set to run on .*, but this matter is privileged and stays on this computer\. Cloud advocate does not see this matter and sits this panel out\./)
  assert.ok(ms[1].local && !ms[1].note)
  const before = requests.filter((q) => q.name === 'cloud').length
  const events = []
  const r = await run({ mode: 'debate', rounds: 1, question: 'Who wins?', matterId: m.id, agents: ['cloud-advocate', 'home-advocate', 'home-critic'], onEvent: (e) => events.push(e) })
  assert.strictEqual(requests.filter((q) => q.name === 'cloud').length, before, 'nothing went to the online AI')
  assert.ok(events.some((e) => e.type === 'panel_note' && e.lane === 'cloud-advocate'))
  assert.ok(r.members.find((x) => x.lane === 'cloud-advocate').skipped)
  assert.deepStrictEqual(r.turns.map((t) => t.lane), ['home-advocate', 'home-critic'])
  await assert.rejects(run({ mode: 'debate', question: 'x', matterId: m.id, agents: ['cloud-advocate', 'home-advocate'] }), /Not enough agents can work on this matter/)
  writeUser({})
})

test('the AI record: which agent used which AI (names only, never what was said)', async () => {
  const rec = require('../src/activity').start({ matterId: null, kind: 'panel', asked: '/team debate x' })
  await rec.run(() => agents.run(agents.resolve('claimant-counsel'), () => policy.withMatter(null, () => require('../src/llm').chat([{ role: 'user', content: 'hello' }], { role: 'write' }))))
  rec.finish({ extra: { panel: { mode: 'debate', rounds: 2, agents: [{ name: 'claimant-counsel', title: 'Claimant\'s counsel', services: [{ label: 'GPT (OpenAI)', calls: 3 }] }, { name: 'x', title: 'Cloud advocate', skipped: true }], moderator: { title: 'The judge (second pass)', services: [{ label: 'the AI on this computer', calls: 1 }] } } } })
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(audit.some((e) => e.agent === 'claimant-counsel' && e.rid === rec.rid))
  const entry = require('../src/record').list({}).entries.find((x) => x.id === rec.rid)
  assert.match(entry.title, /^Panel/)
  assert.ok(entry.lines.includes('Panel: a debate, 2 rounds'))
  assert.ok(entry.lines.includes('Agent Claimant\'s counsel: GPT (OpenAI) (3 calls)'))
  assert.ok(entry.lines.some((l) => /Cloud advocate: did not take part/.test(l)))
  assert.ok(!JSON.stringify(entry).includes('hello'))
})

test('judge: on by default, the lawyer switches it, the firm can lock it on; the turn says whether it ran', async () => {
  writeUser({})
  assert.deepStrictEqual(judge.settings(), { enabled: true, locked: false, origin: 'default' })
  const { runAction } = require('../src/agent')
  const { Document } = require('../src/doc')
  const doc = () => new Document('§ 1 Der Verkäufer haftet für Mängel binnen zwei Jahren.\n\n§ 2 Gerichtsstand Wien.', 'd-judge')
  const ask = async () => {
    const evs = []
    queue.push(JSON.stringify({ tool: 'get_range_text', args: { index: 0 } }), 'The seller is liable: „Der Verkäufer haftet für Mängel binnen fünf Jahren“.')
    await policy.withMatter(null, () => runAction({ doc: doc(), memory: null, session: null, summary: () => '' }, 'How long is the seller liable?', (e) => evs.push(e)))
    queue.length = 0
    return evs
  }
  let evs = await ask()
  const j = evs.find((e) => e.type === 'judge')
  assert.ok(j.ran && !j.ok, 'ran, and found a problem')
  assert.match(j.notes[0], /not found word for word/)
  assert.ok(evs.some((e) => e.type === 'step' && e.kind === 'judge_answer' && /second pass/.test(e.plain)))
  // Off: the turn says so; no extra call.
  judge.setEnabled(false)
  assert.strictEqual(harness.layers().user.data.judge.answers, false)
  const n = requests.length
  evs = await ask()
  assert.deepStrictEqual(evs.find((e) => e.type === 'judge'), { type: 'judge', ran: false, reason: 'off' })
  assert.ok(!requests.slice(n).some((q) => /You double-check a legal answer/.test(q.body.messages[0].content)))
  judge.setEnabled(true)
  assert.ok(judge.enabled() && !harness.layers().user.data.judge)
  // The firm locks it on: the lawyer's "off" is ignored and refused.
  writeUser({ judge: { answers: false } })
  fs.writeFileSync(firmFile(), JSON.stringify({ lock: ['judge'], judge: { answers: true } }))
  assert.deepStrictEqual(judge.settings(), { enabled: true, locked: true, origin: 'firm' })
  assert.throws(() => judge.setEnabled(false), (err) => err.code === 'LOCKED' && /Your firm has fixed this setting/.test(err.message))
  fs.rmSync(firmFile())
  writeUser({})
  // Nothing to check against: said, not pretended.
  queue.push('A short answer.')
  const evs2 = []
  await policy.withMatter(null, () => runAction({ doc: new Document('', 'd-empty'), memory: null, session: null, summary: () => '' }, 'Hi', (e) => evs2.push(e)))
  assert.deepStrictEqual(evs2.find((e) => e.type === 'judge'), { type: 'judge', ran: false, reason: 'no-sources' })
})

test('commands: /agent, /team, /judge in English and German, in the app and the terminal', () => {
  const c = require('../src/commands')
  for (const n of ['agent', 'team', 'judge']) {
    const x = c.find(n)
    assert.deepStrictEqual(x.surfaces.sort(), ['app', 'tui'], n)
    assert.ok(x.description.de && x.description.de !== x.description.en)
  }
  assert.match(c.find('team').description.en, /panel/)
  assert.match(c.find('judge').description.de, /zweiten Durchgang/)
})
