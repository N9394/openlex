"use strict"
/**
 * Redaction check v2 (redaction_v2.js): candidates from patterns, lists,
 * heuristics and the pluggable sources; the decision model classifies each
 * distinct candidate in its context; version 1 stays the fallback.
 *
 *   node --test test/redaction_v2.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-redv2-'))
process.env.LEXVAULT_DATA_DIR = DATA

const { scripted } = require('./fixtures/scripted_gowa')
const gowa = require('../src/gowa')
const harness = require('../src/harness')
const v2 = require('../src/redaction_v2')
const check = require('../src/redaction_check')
const candidates = require('../src/pii_candidates')

const TEXT = 'Mietvertrag zwischen der Alpenbau GmbH, vertreten durch Johann Huber, und Jana Nováková, wohnhaft in Linz. ' +
  'Die Kaution beträgt EUR 5.000 und ist auf das Konto AT61 1904 3002 3457 3201 zu überweisen. Der Vertrag unterliegt dem ABGB. ' +
  'Bei Fragen wenden Sie sich an Mag. Petra Gruber, E-Mail petra.gruber@example.com. Gerichtsstand ist Wien.'

// The scripted model: what each marked candidate is.
const TRUTH = { 'Johann Huber': 'person', 'Jana Nováková': 'person', Huber: 'person', 'Petra Gruber': 'person', Alpenbau: 'organisation', 'Alpenbau GmbH': 'organisation', ABGB: 'not_personal', Wien: 'not_personal', Mietvertrag: 'not_personal', Kaution: 'not_personal' }
function rule(state, instructions, options) {
  const m = state.match(/⟦ (.+?) ⟧/)
  const answer = m && TRUTH[m[1]]
  return answer ? options.findIndex((o) => o.startsWith(answer)) : null // anything else: unsure
}

const on = () => harness.setUserSection('decide', { tasks: { redaction: true } })
const byText = (findings) => Object.fromEntries(findings.map((f) => [TEXT.slice(f.start, f.end), f]))

test.afterEach(() => { harness.setUserSection('decide', null); gowa._setTestBackend(null) })
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

test('honest status: basic without a model; GOWA only when switched on and a local model is ready', () => {
  assert.strictEqual(v2.detection(), 'basic')
  gowa._setTestBackend(scripted(rule))
  assert.strictEqual(v2.detection(), 'basic', 'installed but switched off')
  on()
  assert.strictEqual(v2.detection(), 'gowa')
})

test('candidate sources are pluggable (GLiNER is one of them)', async () => {
  assert.ok(candidates.list().some((s) => s.id === 'gliner'))
  candidates.register({ id: 'test-source', find: async (t) => [{ kind: 'PERSON', start: t.indexOf('Linz'), end: t.indexOf('Linz') + 4, confidence: 0.4 }] })
  try {
    const { found, used } = await candidates.find(TEXT)
    assert.ok(used.includes('test-source') && used.includes('names') && used.includes('ngrams'))
    assert.ok(!used.includes('gliner'), 'not installed: not used')
    assert.ok(found.some((f) => f.source === 'test-source'))
  } finally { candidates.unregister('test-source') }
})

test('two stages: the model ticks people and organisations, drops plain words, never overrules lists and fixed-shape patterns', async () => {
  on()
  const b = scripted(rule)
  gowa._setTestBackend(b)
  const { findings, stats } = await v2.findings(TEXT, { terms: [{ text: 'Linz', kind: 'ADDRESS' }] })
  const f = byText(findings)
  assert.strictEqual(f['Johann Huber'].kind, 'PERSON')
  assert.strictEqual(f['Johann Huber'].on, true)
  assert.strictEqual(f['Johann Huber'].decided.outcome, 'automate')
  assert.strictEqual(f['Jana Nováková'].on, true)
  assert.strictEqual(f['Petra Gruber'].on, true)
  assert.ok(f['Alpenbau GmbH'].on)
  // Lists and patterns: as in version 1, not asked.
  assert.strictEqual(f.Linz.source, 'term')
  assert.strictEqual(f.Linz.on, true)
  assert.ok(Object.values(f).some((x) => x.kind === 'IBAN' && x.on && !x.decided))
  assert.ok(Object.values(f).some((x) => x.kind === 'EMAIL' && x.on && !x.decided))
  // Confident "not personal data" on a bare capitalised word: dropped.
  assert.ok(!f.ABGB && !f.Wien && !f.Mietvertrag)
  assert.ok(stats.dropped >= 2)
  // Each distinct candidate asked once, with its own context window.
  const asked = b.calls.map((c) => c.state.match(/⟦ (.+?) ⟧/)?.[1])
  assert.strictEqual(new Set(asked).size, asked.length)
  assert.ok(b.calls.every((c) => c.state.length <= 2 * v2.WINDOW + 200))
  assert.deepStrictEqual(Object.keys(require('../src/decide_tasks').REDACTION_OPTIONS), ['person', 'organisation', 'address', 'id_number', 'other_personal', 'not_personal'])
  assert.ok(b.calls.every((c) => c.options.length === 6))
})

test('unsure: a new candidate is shown unticked for the lawyer; a version-1 finding keeps its tick', async () => {
  on()
  gowa._setTestBackend(scripted(() => null)) // the model is unsure about everything
  const { findings, stats } = await v2.findings(TEXT)
  const f = byText(findings)
  assert.strictEqual(f['Petra Gruber'].on, true, 'title heuristic (v1) keeps its tick')
  assert.strictEqual(f['Petra Gruber'].decided.outcome, 'escalate')
  const extra = findings.filter((x) => x.source === 'model')
  assert.ok(extra.length > 0)
  assert.ok(extra.every((x) => x.on === false), 'new candidates the model is unsure about are unticked')
  assert.strictEqual(stats.automated, 0)
})

test('long documents: one decision per distinct candidate across the check (cache), windows around each occurrence', async () => {
  on()
  const b = scripted(rule)
  gowa._setTestBackend(b)
  const long = `${TEXT}\n${'Allgemeiner Text ohne Namen. '.repeat(400)}\n${TEXT}`
  const cache = new Map()
  const r1 = await v2.findings(long, { cache })
  const n = b.calls.length
  await v2.findings(TEXT, { cache })
  assert.strictEqual(b.calls.length, n, 'nothing asked twice')
  assert.ok(r1.findings.filter((x) => long.slice(x.start, x.end) === 'Johann Huber').length === 2)
})

test('redaction check: version 2 when on, honest label in the window; version 1 when off or when the model fails', async () => {
  const items = [{ name: 'Lease', text: TEXT }, { name: 'Your question', text: 'Kann Huber kündigen?' }]
  let r = await check.prepare({ items })
  assert.strictEqual(r.engine, 'basic')
  assert.strictEqual(r.basic, true)
  assert.strictEqual(r.gowa, 'off')
  on()
  gowa._setTestBackend(scripted(rule))
  r = await check.prepare({ items })
  assert.strictEqual(r.engine, 'gowa')
  assert.strictEqual(r.gowa, 'used')
  assert.strictEqual(r.basic, false)
  assert.ok(r.items.every((it) => it.detection === 'gowa'), 'GOWA really went through every text')
  const view = check.view(r)
  assert.strictEqual(view.detection, 'with-model')
  assert.match(view.engineLabel, /OpenLex model \(GOWA\).*for your review/)
  assert.ok(!/verified|anonymi|detects all/i.test(view.engineLabel))
  // "Huber" in the question counts too (found in the lease).
  assert.ok(r.items[1].findings.some((f) => f.text === 'Huber' && f.on))
  check.cancel(r.id)
  // The model breaks: the check carries on with basic detection and says so.
  gowa._setTestBackend({ ...scripted(rule), run: async () => { throw new Error('model broke') } })
  r = await check.prepare({ items })
  assert.strictEqual(r.engine, 'basic')
  assert.strictEqual(r.gowa, 'failed')
  assert.strictEqual(r.basic, true)
  assert.strictEqual(r.partial, true)
  assert.ok(r.items[0].findings.some((f) => f.kind === 'IBAN'))
  check.cancel(r.id)
})
