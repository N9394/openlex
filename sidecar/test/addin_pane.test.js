"use strict"
/**
 * The Word pane's logic (add-in/lib/*.js), tested without Word: activity,
 * data line, Based on, review state, errors, menu, permission cards, theme,
 * the single hint slot, analyse/overview shapes. A fake engine stream is
 * folded through the modules exactly as the pane does.
 *
 *   node --test test/addin_pane.test.js
 */

const test = require('node:test')
const assert = require('assert')
const path = require('path')

const LIB = path.join(__dirname, '..', '..', 'add-in', 'lib')
const lib = (n) => require(path.join(LIB, `${n}.js`))
const activity = lib('activity')
const dataline = lib('dataline')
const sources = lib('sources')
const review = lib('review')
const errors = lib('errors')
const menu = lib('menu')
const permission = lib('permission')
const theme = lib('theme')
const suggest = lib('suggest')
const matter = lib('matter')
const words = lib('words')
const record = lib('record')
const explain = require('../src/explain')

/** A fake engine answer to one question, as the SSE stream delivers it. */
function fakeChatStream() {
  const steps = [
    { type: 'step', text: 'tool: get_range_text', kind: 'tool', tool: 'get_range_text', detail: { clause: { index: 3, heading: '4. Liability' } } },
    { type: 'model', provider: 'anthropic', label: 'Anthropic', model: 'claude-x', local: false, region: 'eu-central-1', redacted: true },
    { type: 'step', text: 'tool: search_law', kind: 'tool', tool: 'search_law', detail: { jurisdiction: 'AT', query: 'Gewährleistung' } },
    { type: 'law', sources: [{ source_name: 'ABGB', section: '§ 933', snippet: 'Das Recht auf die Gewährleistung…', chunk_id: 'c1' }, { source_name: 'ABGB', section: '§ 933', chunk_id: 'c1' }] },
    { type: 'step', text: 'searching local law packs…', kind: 'law_search' },
    { type: 'step', text: 'tool: search_ris', kind: 'tool', tool: 'search_ris', detail: { query: 'Gewährleistung' } },
    { type: 'note', entity: 'Supplier', claim: 'liable without cap', section: 3 },
    { type: 'model', provider: 'anthropic', label: 'Anthropic', model: 'claude-x', local: false, region: 'eu-central-1', redacted: true },
    { type: 'step', text: 'writing…', kind: 'writing' },
    { type: 'text', text: 'The cap is not enforceable for gross negligence.' },
    { type: 'done' },
  ]
  // The engine adds `plain` / `online` at emit time.
  return steps.map((e) => explain.withPlain({ ...e }))
}

test('activity: ≤3 steps while working, current one marked; one line when done', () => {
  let t = 0
  let act = activity.start(t)
  const evs = fakeChatStream()
  const seen = []
  for (const ev of evs.slice(0, -1)) {
    act = activity.apply(act, ev, (t += 1000))
    const v = activity.view(act, { now: t, maxSteps: 3 })
    assert.ok(v.running)
    assert.ok(v.steps.length <= 3, 'never more than three steps on screen')
    assert.strictEqual(v.steps.filter((s) => s.current).length, 1, 'exactly one current step')
    seen.push(v.steps.find((s) => s.current).text)
  }
  assert.ok(seen.includes('Reading clause 4 (Liability)'))
  assert.ok(seen.includes('Searching Austrian law: “Gewährleistung”'))
  assert.ok(seen.includes('Writing the answer'))
  assert.ok(!seen.some((s) => /tool:|search_|law packs/.test(s)), 'no engine words, housekeeping skipped')
  act = activity.apply(act, evs[evs.length - 1], (t += 2000))
  const done = activity.view(act, { now: t })
  assert.strictEqual(done.running, false)
  assert.deepStrictEqual(done.steps, [])
  assert.match(done.summary, /^✓ Done in \d+ s · \d+ steps$/)
  assert.strictEqual(act.answerWords, 8)
  const all = activity.allSteps(act)
  assert.ok(all.every((s) => s.mark === '✓'))
})

test('activity: an older engine without `plain` shows a general sentence, never raw text', () => {
  let act = activity.start(0)
  act = activity.apply(act, { type: 'step', text: 'tool: get_tool_schemas {"x":1}' }, 1)
  const v = activity.view(act, { now: 2 })
  assert.strictEqual(v.steps[v.steps.length - 1].text, activity.GENERIC)
})

test('activity: permission wait, stop and errors', () => {
  let act = activity.start(0)
  act = activity.apply(act, { type: 'permission', summary: 'Save obligations.csv in Acme/' }, 1)
  assert.match(activity.view(act, { now: 2 }).steps.at(-1).text, /^Waiting for your answer: Save obligations\.csv/)
  act = activity.apply(act, { type: 'permission_result', decision: 'deny' }, 3)
  assert.strictEqual(act.steps.at(-1).status, 'failed')
  assert.match(act.steps.at(-1).text, /^Not allowed: /)
  act = activity.apply(act, { type: 'text', text: 'one two three' }, 4)
  act = activity.apply(act, { type: 'suggestion' }, 5)
  act = activity.stop(act, 6)
  assert.match(activity.view(act).summary, /^⏹ Stopped after/)
  assert.strictEqual(activity.stopSentence(act), 'Stopped by you. Kept: the answer so far (3 words), 1 proposed change. Nothing more is sent or saved.')
  let bad = activity.apply(activity.start(0), { type: 'error', message: 'x' }, 10)
  assert.match(activity.view(bad).summary, /^! Ended early/)
  bad = activity.apply(activity.start(0), { type: 'error', message: 'x', recoverable: true }, 10)
  assert.strictEqual(activity.view(bad, { now: 11 }).running, true, 'one failed clause does not end the run')
})

test('data line: symbol + words for each case', () => {
  assert.deepStrictEqual(pick(dataline.line([], [])), { symbol: '✓', text: 'Stayed on this computer', left: false })
  assert.strictEqual(dataline.line([], [], { running: true }).text, 'Nothing has left this computer so far')
  let act = activity.start(0)
  for (const ev of fakeChatStream()) act = activity.apply(act, ev, 1)
  const l = dataline.line(act.models, act.online)
  assert.strictEqual(l.symbol, '!')
  assert.strictEqual(l.text, 'Sent to Claude (Anthropic, EU) — names and numbers hidden (pseudonymised) · 2 times · Looked up online: RIS')
  assert.match(l.title, /Only search words or web addresses went to: RIS \(Austria/)
  let checked = dataline.addModel([], { provider: 'mistral', region: 'eu', redacted: true, checked: true, detection: 'basic' })
  assert.match(dataline.line(checked, []).text, /checked by you \(basic detection\) · once$/)
  checked = dataline.addModel([], { provider: 'mistral', region: 'eu', redacted: true, checked: true, detection: 'with-model' })
  assert.match(dataline.line(checked, []).text, /checked by you \(with name finder\) · once$/)
  const onlyWeb = dataline.line([{ local: true, calls: 1, key: 'local' }], ['RIS (Austria\'s federal law database)'])
  assert.deepStrictEqual(pick(onlyWeb), { symbol: '!', text: 'Looked up online: RIS', left: true })
  assert.deepStrictEqual(dataline.aiLabel({ model: { local: true, name: 'lotus' } }), { text: 'AI: this computer', local: true })
  assert.strictEqual(dataline.aiLabel({ model: { local: false, provider: 'mistral', name: 'mistral-large' } }).text, 'AI: Mistral')
  // The engine's label (the same words as the desktop app), with the ▾ that opens /model.
  assert.deepStrictEqual(dataline.aiLabel({ model: { local: false, display: { en: 'Claude · AWS Bedrock (EU)', de: 'Claude · AWS Bedrock (EU)', local: false } } }), { text: 'Claude · AWS Bedrock (EU) ▾', local: false })
  function pick(x) { return { symbol: x.symbol, text: x.text, left: x.left } }
})

test('Based on: numbered law sections, document passages and notes; duplicates folded', () => {
  let act = activity.start(0)
  for (const ev of fakeChatStream()) act = activity.apply(act, ev, 1)
  const items = sources.basedOn(act)
  assert.deepStrictEqual(items.map((i) => [i.n, i.kind, i.label]), [
    [1, 'law', 'ABGB § 933'],
    [2, 'doc', 'Your document: clause 4 (Liability)'],
    [3, 'note', 'Noted (part 3): Supplier — liable without cap'],
  ])
  assert.strictEqual(items[0].chunk_id, 'c1')
  assert.deepStrictEqual(items[1].clause, { index: 3, heading: '4. Liability' })
})

test('suggestion check line and Word comment text', () => {
  const ok = { summary: 'Cap liability', basis: { source: 'ABGB', section: '§ 933' }, verdict: { status: 'verified' } }
  assert.deepStrictEqual(sources.checkLine(ok), { ok: true, mark: '✓', text: 'checked against ABGB § 933 ✓' })
  assert.deepStrictEqual(sources.checkLine({}), { ok: false, mark: '!', text: 'could not be verified — review carefully' })
  assert.strictEqual(sources.commentText(ok), 'OpenLex: Cap liability\nLegal basis: ABGB § 933\nchecked against ABGB § 933 ✓')
  assert.match(sources.commentText({ summary: 'x', citationWarning: '§ 99 not found' }), /Not verified — review carefully \(§ 99 not found\)/)
})

test('review: "Clause 4 of 18", findings, summary line, decisions, export', () => {
  let t = 0
  let rv = review.start({ side: 'supplier', playbook: '', focus: [] }, t)
  assert.strictEqual(review.progressLine(rv, t), 'Reading the contract')
  const clause = (position, heading) => ({ type: 'step', kind: 'clause', position, total: 18, detail: { clause: { index: position, heading } } })
  rv = review.apply(rv, clause(0, '1. Parties'), (t += 10000))
  rv = review.apply(rv, { type: 'suggestion', suggestion: { id: 's1', summary: 'Unlimited liability', severity: 'high', basis: { source: 'ABGB', section: '§ 1293' }, verdict: { status: 'verified' }, proposed_text: 'Liability is capped at the annual fees paid.', anchor: { text: 'The Supplier is liable' }, clause: { index: 0, heading: '1. Parties' } } }, t)
  rv = review.apply(rv, clause(3, '4. Liability'), (t += 30000))
  assert.match(review.progressLine(rv, t), /^Clause 4 of 18 · clause 4 \(Liability\) · about \d+ minutes left$/)
  rv = review.apply(rv, { type: 'suggestion', suggestion: { id: 's2', summary: 'Short notice', severity: 'medium' } }, t)
  rv = review.apply(rv, { type: 'suggestion', suggestion: { id: 's3', summary: 'Typo', severity: 'low' } }, t)
  rv = review.apply(rv, { type: 'suggestion', suggestion: { id: 's4', summary: 'No cap on penalties', severity: 'high' } }, t)
  rv = review.apply(rv, { type: 'error', message: 'section 5: boom', recoverable: true, clause: { index: 5, heading: '6. Fees' } }, t)
  rv = review.apply(rv, { type: 'done', comments: 4, total: 18 }, (t += 1000))
  assert.strictEqual(review.summaryLine(rv), '2 high risks, 1 medium, 1 low')
  assert.deepStrictEqual(rv.problems, ['Clause 6 (Fees) could not be reviewed.'])
  assert.match(review.endLine(rv), /^Reviewed 18 clauses in/)
  rv = review.setPlaced(rv, 's1', 'tracked+comment')
  rv = review.setPlaced(rv, 's2', 'failed', review.anchorProblem(new Error('anchored text no longer present (document edited?)')))
  assert.strictEqual(review.counts(rv).notPlaced, 1)
  assert.match(rv.findings[1].problem, /were not found in the document/)
  rv = review.decide(rv, 's1', 'accepted')
  rv = review.decide(rv, 's3', 'rejected')
  assert.strictEqual(review.decisionLine(rv), '1 accepted · 1 rejected · 2 to decide')
  assert.deepStrictEqual(review.ordered(rv).map((f) => f.id), ['s1', 's4', 's2', 's3'])
  const payload = review.exportPayload(rv, 'Review — Supply')
  assert.strictEqual(payload.side, 'Supplier / seller')
  assert.deepStrictEqual(payload.findings[0], { clause: 'clause 1 (Parties)', summary: 'Unlimited liability', severity: 'high', status: 'accepted', basis: 'ABGB § 1293', checked: 'checked against ABGB § 1293 ✓', proposed: 'Liability is capped at the annual fees paid.' })
  // And the engine accepts exactly that shape.
  assert.strictEqual(require('../src/review').cleanFindings(payload.findings)[0].status, 'accepted')
})

test('review: stop keeps what was found and says so', () => {
  let rv = review.start({}, 0)
  rv = review.apply(rv, { type: 'step', kind: 'clause', position: 5, total: 18 }, 1)
  rv = review.stop(rv, 2)
  assert.strictEqual(review.endLine(rv), 'Stopped by you after 5 clauses of 18. Everything found so far is kept in the document.')
  assert.strictEqual(review.summaryLine(review.start({}, 0)), 'No risks found')
  assert.match(review.anchorProblem('Tracked changes are not available in this document (Compatibility Mode?)'), /Compatibility Mode/)
  assert.match(review.anchorProblem('Suggestion has no anchor text'), /did not say which words/)
})

test('errors: three parts, details kept apart, nothing technical in the first three', () => {
  const cases = [
    ['TypeError: Failed to fetch', /not running on this computer/],
    ['Blocked by data policy: anthropic not on the allow-list', /client-data rule/],
    ['401 invalid x-api-key', /did not accept your key/],
    ['anchored text no longer present (document edited?)', /edited in the meantime/],
    ['Tracked changes are not available in this document (Compatibility Mode?)', /Compatibility Mode/],
    ['local engine unavailable: no model', /No AI is ready/],
  ]
  for (const [raw, why] of cases) {
    const x = errors.explain(new Error(raw), 'answer')
    assert.strictEqual(x.what, 'OpenLex could not finish the answer')
    assert.match(x.why, why)
    assert.ok(x.todo.length > 10)
    assert.strictEqual(x.details, raw)
    assert.ok(!/\b(401|fetch|anchor|ECONN)\b/i.test(x.why + x.todo), `${raw}: no jargon in why/todo`)
  }
  const unknown = errors.explain('SQLITE_BUSY: database is locked', 'review')
  assert.strictEqual(unknown.what, 'The review could not go on')
  assert.match(unknown.todo, /copy the details/)
})

test('menu: search in plain words; firm feature switches and missing endpoints hide entries', () => {
  const ids = (q, o) => menu.search(q, o).map((e) => e.id)
  assert.ok(ids('').includes('review'))
  assert.ok(!ids('').includes('analyse'), 'hidden until the engine offers it')
  assert.ok(!ids('').includes('overview'))
  assert.ok(ids('', { available: { analyse: true, overview: true } }).includes('overview'))
  assert.strictEqual(ids('translat')[0], 'translate')
  assert.strictEqual(ids('timeline')[0], 'chronology', 'keywords match too')
  assert.strictEqual(ids('which ai')[0], 'settingsAI')
  assert.deepStrictEqual(ids('zzzz'), [])
  assert.ok(!ids('translate', { features: { translate: false } }).includes('translate'))
  assert.ok(ids('', { features: { translate: false } }).includes('review'))
  // No jargon in what the lawyer reads.
  for (const e of menu.ENTRIES) assert.ok(!/\b(provider|workspace|skill|agent profile|mcp|model)\b/i.test(`${e.label} ${e.hint}`), e.id)
  const g = menu.grouped(menu.search(''))
  assert.deepStrictEqual(g.map((x) => x.group), ['This document', 'This matter', 'Settings'])
  assert.strictEqual(menu.move(0, -1, 5), 4)
  assert.strictEqual(menu.move(4, 1, 5), 0)
  assert.strictEqual(menu.move(0, 1, 0), -1)
})

test('permission card: one question with the verb; Allow once is the default; Always never is', () => {
  const evt = { id: 'p1', tool: 'write_file', title: 'OpenLex wants to save a file', summary: 'Save obligations.csv in Acme/', detail: { path: 'Acme/obligations.csv', content: 'party,…' }, risk: 'writes a file', choices: ['once', 'always_matter', 'always', 'deny'], always: 'write_file' }
  assert.strictEqual(permission.question(evt), 'May OpenLex save obligations.csv in Acme/?')
  const b = permission.buttons(evt)
  assert.deepStrictEqual(b.map((x) => x.label), ['Allow once', 'Don\'t allow', 'Always for this matter', 'Always'])
  assert.deepStrictEqual(b.filter((x) => x.isDefault).map((x) => x.choice), ['once'])
  assert.ok(!b.find((x) => x.choice === 'always').isDefault)
  assert.deepStrictEqual(permission.details(evt), [{ label: 'File', value: 'Acme/obligations.csv' }])
  assert.strictEqual(permission.riskLine(evt), 'It would save a file in your files folder. Nothing happens until you choose.')
  assert.strictEqual(permission.outcome('always_matter', 'write_file:Acme/**'), 'Allowed from now on for this matter (rule saved: write_file:Acme/**).')
  assert.strictEqual(permission.settled({ by: 'timeout' }), 'No answer in time, so not allowed.')
  assert.strictEqual(permission.question({ title: 'OpenLex wants to run a command' }), 'May OpenLex run a command?')
  assert.deepStrictEqual(permission.buttons({}).map((x) => x.choice), ['once', 'deny'])
})

test('theme follows Word, unless picked', () => {
  assert.strictEqual(theme.fromOffice({ bodyBackgroundColor: '#1E1E1E' }), 'dark')
  assert.strictEqual(theme.fromOffice({ bodyBackgroundColor: '#FFFFFF' }), 'light')
  assert.strictEqual(theme.fromOffice({ isDarkTheme: true, bodyBackgroundColor: '#FFFFFF' }), 'dark')
  assert.strictEqual(theme.fromOffice(null), null)
  assert.strictEqual(theme.resolve('auto', { bodyBackgroundColor: '#262626' }, false), 'dark')
  assert.strictEqual(theme.resolve('auto', null, true), 'dark')
  assert.strictEqual(theme.resolve('light', { bodyBackgroundColor: '#000000' }, true), 'light')
})

test('hint slot: one at a time, higher priority wins, dismissed stays away', () => {
  let s = suggest.create()
  s = suggest.offer(s, { id: 'skill:nda', priority: 1, text: 'Your firm has instructions' })
  s = suggest.offer(s, { id: 'monitor:1', priority: 0, text: 'update' })
  assert.strictEqual(s.current.id, 'skill:nda', 'a lower priority does not replace')
  s = suggest.offer(s, { id: 'selection:abc', priority: 2, text: 'With the selected text:' })
  assert.strictEqual(s.current.id, 'selection:abc')
  s = suggest.withdraw(s, 'other')
  assert.strictEqual(s.current.id, 'selection:abc')
  s = suggest.dismiss(s)
  assert.strictEqual(s.current, null)
  s = suggest.offer(s, { id: 'selection:abc', priority: 2 })
  assert.strictEqual(s.current, null, 'dismissed in this session')
  s = suggest.offer(s, { id: 'skill:nda', priority: 1 })
  assert.strictEqual(s.current.id, 'skill:nda')
  assert.strictEqual(suggest.withdraw(s).current, null)
})

test('analyse / overview hooks: route probe and shapes', () => {
  assert.strictEqual(matter.routeExists(404, { error: 'not found', path: '/api/matters/overview' }), false)
  assert.strictEqual(matter.routeExists(404, 'not json'), false)
  assert.strictEqual(matter.routeExists(404, { error: 'matter not found' }), true)
  assert.strictEqual(matter.routeExists(400, { error: 'id is required' }), true)
  assert.strictEqual(matter.routeExists(200, {}), true)
  assert.strictEqual(matter.routeExists(0, null), false)
  const a = matter.analysis({ summary: 'A supply agreement.', analyses: [{ file: 'a.docx', risks: [
    { severity: 'low', why: 'Typo', location: { text: '§ 2' } },
    { severity: 'high', why: 'Unlimited liability', fix: 'Liability is capped at the annual fees paid.', quote: 'The Supplier is liable for all damages', law: { source: 'ABGB', section: '§ 1293' } },
  ], deadlines: [{ date: '2026-12-31', text: 'termination notice' }], obligations: ['Pay within 30 days'], parties: [{ name: 'Acme', role: 'supplier' }] }] })
  assert.deepStrictEqual(a.risks.map((r) => r.severity), ['high', 'low'])
  assert.strictEqual(matter.analysisLine(a), '1 high risk, 1 low · 1 deadline · 1 party')
  const sug = matter.riskSuggestion(a.risks[0], 0)
  assert.deepStrictEqual([sug.anchor.text, sug.proposed_text, sug.basis.source], ['The Supplier is liable for all damages', 'Liability is capped at the annual fees paid.', 'ABGB § 1293'])
  assert.strictEqual(matter.riskSuggestion(a.risks[1], 1), null, 'no fix, no apply')
  const cards = matter.overview({ summary: 'Supply dispute.', deadlines: [{ text: 'Reply to claim', at: '2026-11-02', from: { kind: 'doc', file: 'claim.pdf', location: { text: 'p. 2' } } }], notes: [], openQuestions: ['Who signed?'] })
  assert.deepStrictEqual(cards.map((c) => c.key), ['summary', 'deadlines', 'openQuestions'])
  assert.strictEqual(matter.fromLine(cards[1].items[0].from), 'claim.pdf, p. 2')
})

test('words: durations, clause names, service names', () => {
  assert.strictEqual(words.duration(8000), '8 s')
  assert.strictEqual(words.duration(12 * 60000), '12 min')
  assert.strictEqual(words.clauseName({ heading: '§ 7 Haftung' }), 'clause 7 (Haftung)')
  assert.strictEqual(words.clauseName({ index: 2 }), 'part 3 of the document')
  assert.strictEqual(words.serviceName({ provider: 'openai', model: 'gpt-4.1' }), 'GPT (OpenAI)')
  assert.strictEqual(words.plural(1, 'party', 'parties'), '1 party')
})

test('AI record view: menu entries once the engine has it, query and export from the filters, the summary line, rows that do not rely on colour', () => {
  const ids = (q, o) => menu.search(q, o).map((e) => e.id)
  assert.ok(!ids('').includes('record'), 'hidden until the engine offers it')
  const on = { available: { record: true } }
  assert.deepStrictEqual(ids('ai record', on).slice(0, 2), ['record', 'recordAll'])
  assert.strictEqual(ids('audit', on)[0], 'record', 'found by "audit" too')
  assert.strictEqual(ids('dpo', on)[0], 'record')
  assert.ok(!ids('', { ...on, features: { record: false } }).includes('record'))
  assert.strictEqual(menu.ENTRIES.find((e) => e.id === 'record').label, 'AI record for this matter')
  assert.strictEqual(menu.ENTRIES.find((e) => e.id === 'recordAll').label, 'AI record — all matters')

  assert.strictEqual(record.query({ matterId: 'm_1', from: '2026-10-01', to: '2026-10-29', left: true }), '?matterId=m_1&from=2026-10-01&to=2026-10-29&left=1&limit=100')
  assert.strictEqual(record.query({ from: 'garbage' }, 200), '?limit=200')
  assert.strictEqual(record.rangeProblem({ from: '2026-10-29', to: '2026-10-01' }), 'The first date is after the second one.')
  assert.strictEqual(record.rangeProblem({ from: '2026-10-01' }), '')
  assert.deepStrictEqual(record.exportBody({ matterId: 'm_1', left: true, from: '' }, 'csv'), { format: 'csv', matterId: 'm_1', left: true })
  assert.deepStrictEqual(record.exportBody({}, 'exe'), { format: 'pdf' })

  const r = {
    summary: { text: '12 requests · 3 sent to Claude (Anthropic, EU), names and numbers hidden · 2 online lookups · 1 permission denied' },
    verify: { ok: true, text: 'Record intact: all 3 logs checked, no line changed, removed or moved.', fingerprint: '3f2a 9c1d' },
    entries: [
      { id: 'r1', at: '2026-10-29T13:02:00.000Z', title: 'Question: “Is the cap valid?”', window: 'Word', matter: 'Alpine share deal', left: true, outcome: 'done', lines: ['AI: Claude (Anthropic, EU) — sent outside this computer, names and numbers hidden (pseudonymised) · 3 calls'] },
      { id: 'r2', at: '2026-10-29T12:02:00.000Z', title: 'Checklist review: “spa”', window: 'Terminal app', left: false, outcome: 'done', lines: [] },
      { id: 'r3', at: '2026-10-29T11:02:00.000Z', title: 'Question: “Translate”', left: false, outcome: 'failed', lines: [] },
    ],
  }
  assert.strictEqual(record.summaryLine(r), '12 requests · 3 sent to Claude (Anthropic, EU), names and numbers hidden · 2 online lookups · 1 permission denied · record intact ✓')
  assert.match(record.summaryLine({ ...r, verify: { ok: false } }), /record changed ✗$/)
  assert.strictEqual(record.summaryLine(null), 'Nothing recorded yet')
  const rows = r.entries.map(record.row)
  assert.deepStrictEqual(rows.map((x) => x.symbol), ['!', '✓', '✗'])
  assert.deepStrictEqual(rows.map((x) => x.mark), ['Something left this computer.', 'Stayed on this computer.', 'Did not finish.'])
  assert.match(rows[0].sub, /^29 Oct 2026 \d{2}:02 · Word · Alpine share deal$/)
  assert.deepStrictEqual(rows[0].lines, r.entries[0].lines)
  assert.deepStrictEqual(record.verifyLine({ ok: false, text: 'Record changed: line 7.', fingerprint: 'ab12' }), { ok: false, text: '✗ Record changed: line 7. Fingerprint: ab12' })
  assert.strictEqual(record.title({ matterId: 'm_1' }, 'Alpine'), 'AI record: Alpine')
  assert.strictEqual(record.title({}), 'AI record — all matters')

  // The pane's HTML: one view with a way back, nothing permanent but the link on the "Your data" line.
  const html = require('fs').readFileSync(path.join(LIB, '..', 'taskpane.html'), 'utf8')
  assert.match(html, /<section id="view-record" class="view" hidden[^>]*>\s*<div class="view-head"><button class="btn btn-ghost back"/)
  assert.match(html, /id="dlRecord" hidden>see the AI record</)
  for (const id of ['recFrom', 'recTo', 'recLeft', 'recPdf', 'recCsv', 'recVerify']) assert.ok(html.includes(`id="${id}"`), id)
  assert.ok(html.indexOf('lib/record.js') > html.indexOf('lib/words.js'))
})

test('overview: the engine sends cards as a list (id, title, items, link)', () => {
  const cards = matter.overview({ matter: { id: 'm1' }, cards: [
    { id: 'summary', title: 'Summary', items: [{ title: 'Office lease, Vienna', from: { kind: 'analysis', file: 'lease.docx' }, at: '2026-10-29' }], more: 0 },
    { id: 'deadlines', title: 'Deadlines', items: [], more: 0, empty: 'No deadlines found yet.' },
    { id: 'activity', title: 'Recent activity', items: [{ title: 'Question: liability cap' }], more: 2, link: { label: 'Open the AI record', action: 'record' } },
  ] })
  assert.deepStrictEqual(cards.map((c) => c.key), ['summary', 'activity'], 'empty cards are dropped')
  assert.strictEqual(cards[0].items[0].text, 'Office lease, Vienna')
  assert.strictEqual(cards[0].items[0].from.file, 'lease.docx')
  assert.strictEqual(cards[1].link.action, 'record')
  assert.strictEqual(cards[1].more, 2)
})
