"use strict"
/**
 * Rule checks for the judge (judge_rules.js) and how the judge agent gets
 * them: numbers, dates and § references in a claim must appear in the
 * cited source; what is missing goes into the judge's context as possible
 * mismatches. The optional model hint is a pointer too. The judge always
 * runs.
 *
 *   node --test test/judge_rules.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-jrules-'))
process.env.LEXVAULT_DATA_DIR = DATA

// The judge is an LLM agent: a fake chat records what it was given.
const llm = require('../src/llm')
const sent = []
let reply = '{"ok": true, "problems": []}'
llm.chat = async (messages) => { sent.push(messages); if (reply instanceof Error) throw reply; return reply }

const rules = require('../src/judge_rules')
const judge = require('../src/judge')
const harness = require('../src/harness')
const gowa = require('../src/gowa')
const { scripted } = require('./fixtures/scripted_gowa')

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))
test.afterEach(() => { sent.length = 0; reply = '{"ok": true, "problems": []}'; harness.setUserSection('decide', null); gowa._setTestBackend(null) })

test('extract: dates in several languages and formats, references, numbers with either decimal mark', () => {
  const e = rules.extract('Frist 14 Tage ab 30. Oktober 2026 (§ 16 Abs. 2, Art. 6 DSGVO), Haftung bis EUR 100.000,50; due October 30, 2026; 30 octombrie 2026; 2026. október 30.; čl. 5; §§ 3 bis 7.')
  assert.deepStrictEqual([...new Set(e.dates.flatMap((d) => d.values))], ['2026-10-30'])
  assert.strictEqual(e.dates.length, 4)
  assert.deepStrictEqual(e.sections.flatMap((s) => s.values), ['§16', 'art6', 'art5', '§3', '§7'])
  assert.ok(e.numbers.some((n) => n.values.includes(100000.5)))
  assert.ok(e.numbers.some((n) => n.values.includes(14)))
  assert.deepStrictEqual(rules.numberValues('1,500').sort(), [1.5, 1500].sort())
  assert.deepStrictEqual(rules.numberValues('100 000'), [100000])
  assert.deepStrictEqual(rules.numberValues('1.000.000'), [1000000])
  // An ambiguous slash date counts both ways.
  assert.deepStrictEqual(rules.dates('on 05/10/2026')[0].values, ['2026-10-05', '2026-05-10'])
})

test('mismatches: a number, a date or a § the source does not contain is a possible mismatch', () => {
  const src = '§ 16. Die Haftung ist mit EUR 100.000 begrenzt. Die Frist beträgt 30 Tage und endet am 31. Dezember 2026.'
  assert.deepStrictEqual(rules.mismatches('The cap is EUR 100,000 under § 16; 30 days, ending 31.12.2026.', src), [])
  const m = rules.mismatches('The cap is EUR 200,000 under § 17; 60 days, ending 30.11.2026.', src)
  assert.deepStrictEqual(m.map((x) => [x.kind, x.value]), [['date', '30.11.2026'], ['section', '§ 17'], ['number', '200,000'], ['number', '60']])
  assert.match(m[0].message, /does not appear in the cited source/)
  // Single digits are too common to flag, unless they carry a unit; numbers from the question count as known.
  assert.deepStrictEqual(rules.mismatches('Both 2 parties sign.', src), [])
  assert.deepStrictEqual(rules.mismatches('The notice period is 6 Monate.', src).map((x) => x.value), ['6'])
  assert.deepStrictEqual(rules.mismatches('You asked about 45 days.', src, { ignore: ['What about 45 days?'] }), [])
  // No source: nothing to compare.
  assert.deepStrictEqual(rules.mismatches('EUR 5,000', []), [])
})

test('proposal changes: a number or date the rewrite brings in silently is flagged; one the summary names is not', () => {
  const clause = 'Der Mieter kann mit einer Frist von 3 Monaten kündigen. Kaution EUR 5.000.'
  assert.deepStrictEqual(rules.proposalChanges(clause, 'Der Mieter kann mit einer Frist von 3 Monaten kündigen. Kaution EUR 10.000.', 'Shortens nothing.').map((x) => x.value), ['10.000'])
  assert.deepStrictEqual(rules.proposalChanges(clause, 'Kaution EUR 10.000.', 'Raise the deposit to EUR 10,000.'), [])
})

test('checkAnswer: the judge agent always runs and gets the possible mismatches in its context', async () => {
  const r = await judge.checkAnswer({
    question: 'Wie lange ist die Kündigungsfrist?',
    answer: 'Nach § 1116 ABGB beträgt die Frist 6 Monate.',
    evidence: [{ tool: 'search_law', text: 'ABGB § 1116. Die Kündigungsfrist beträgt 14 Tage.' }],
  })
  assert.strictEqual(sent.length, 1, 'the judge ran')
  const ctx = sent[0][1].content
  assert.match(ctx, /POSSIBLE MISMATCHES \(automatic checks, may be wrong\)/)
  assert.match(ctx, /The number “6” does not appear in the cited source/)
  assert.ok(!/1116” does not appear/.test(ctx), 'the cited section is in the source')
  assert.match(sent[0][0].content, /pointers for what to check/)
  assert.deepStrictEqual(r.mismatches.map((m) => m.value), ['6'])
  assert.strictEqual(r.ok, true, 'the judge decides; a rule pointer alone is not a problem')
})

test('checkAnswer without the judge: the lawyer sees the pointers, worded as possible mismatches', async () => {
  reply = new Error('judge model offline')
  const r = await judge.checkAnswer({
    question: 'cap?',
    answer: 'The liability cap is EUR 250,000 under § 9.',
    evidence: [{ tool: 'document', text: '§ 9 Liability. The cap is EUR 100,000.' }],
  })
  assert.strictEqual(r.unavailable, true)
  assert.strictEqual(r.ok, false)
  assert.ok(r.notes.some((n) => /^Possible mismatch \(automatic check, please verify\): The number “250,000”/.test(n)))
})

test('claim-support hint (switch on): shown to the judge as a pointer, never a verdict, and the judge still runs', async () => {
  harness.setUserSection('decide', { tasks: { claim_support: true } })
  gowa._setTestBackend(scripted((state, q, options) => options.findIndex((o) => o.startsWith('not_supported'))))
  await judge.checkAnswer({ question: 'x', answer: 'The deposit is EUR 5,000 under § 4 of the lease.', evidence: [{ tool: 'document', text: '§ 4 Kaution EUR 5.000.' }] })
  assert.strictEqual(sent.length, 1, 'never skipped')
  assert.match(sent[0][1].content, /MODEL HINTS \(pointers, not verdicts\)/)
  assert.match(sent[0][1].content, /small model's guess: looks contradicted by the passage \(p 0\.\d+\) — a pointer, not a verdict/)
})

test('judgeSuggestions: possible mismatches ride on each suggestion; the judge still decides', async () => {
  reply = '[{"status":"verified","note":"ok"}]'
  const v = await judge.judgeSuggestions({ doc: { text: '' } }, [{
    summary: 'The clause caps liability at EUR 50,000.',
    proposed_text: 'Liability is capped at EUR 80,000.',
    clauseText: '§ 9 Liability. Liability is capped at EUR 100,000.',
    anchor: { text: '§ 9 Liability' },
  }], '')
  assert.deepStrictEqual(v, [{ status: 'verified', note: 'ok' }])
  const payload = JSON.parse(sent[0][1].content)
  const pm = payload.suggestions[0].possible_mismatches
  assert.ok(pm.some((x) => /“50,000” does not appear/.test(x)))
  assert.ok(pm.some((x) => /proposal introduces the number “80,000”/.test(x)))
  assert.match(sent[0][0].content, /AUTOMATIC POINTERS/)
  // Judge unavailable: kept (never silently dropped), pointers in the note.
  reply = new Error('offline')
  const v2 = await judge.judgeSuggestions({ doc: { text: '' } }, [{ summary: 'Cap EUR 50,000.', clauseText: 'Cap EUR 100,000.' }], '')
  assert.strictEqual(v2[0].status, 'verified')
  assert.match(v2[0].note, /unverified; possible mismatch: The number “50,000”/)
})
