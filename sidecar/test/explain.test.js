"use strict"
/**
 * Plain language in the engine (src/explain.js): every `step` event gets a
 * `plain` sentence and `online` where something leaves the computer —
 * never a tool name, JSON, a model id or the raw event text.
 *
 *   node --test test/explain.test.js
 */

const test = require('node:test')
const assert = require('assert')
const x = require('../src/explain')

const JARGON = /search_law|get_range_text|tool:|mcp__|json|\{|\}|claude-|gpt-4|llama|qwen/i

test('tool steps: one sentence each, with the law, the clause and the search words', () => {
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'search_law', detail: { jurisdiction: 'AT', query: 'Gewährleistung Frist' } }).plain, 'Searching Austrian law: “Gewährleistung Frist”')
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'get_range_text', detail: { clause: { index: 3, heading: '4. Liability' } } }).plain, 'Reading clause 4 (Liability)')
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'get_range_text', detail: { clause: { index: 3, heading: '' } } }).plain, 'Reading part 4 of the document')
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'search_firm_library' }).plain, 'Looking through your firm\'s precedents')
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'write_file', detail: { file: 'obligations.csv' } }).plain, 'Saving “obligations.csv” in your files folder')
})

test('online: set only when something leaves this computer, with who received it', () => {
  const ris = x.annotate({ type: 'step', kind: 'tool', tool: 'search_ris', detail: { query: 'MRG § 1' } })
  assert.strictEqual(ris.online, true)
  assert.match(ris.onlineTo, /^RIS/)
  assert.strictEqual(ris.plain, 'Checking RIS, Austria\'s official law database: “MRG § 1”')
  const web = x.annotate({ type: 'step', kind: 'tool', tool: 'web_fetch', detail: { host: 'www.ris.bka.gv.at' } })
  assert.deepStrictEqual([web.online, web.onlineTo], [true, 'www.ris.bka.gv.at'])
  const mcp = x.annotate({ type: 'step', kind: 'tool', tool: 'mcp__imanage__search' })
  assert.deepStrictEqual([mcp.plain, mcp.online], ['Using your connector “imanage”', true])
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'search_law' }).online, undefined)
})

test('every kind the engine sends has a sentence; failures say what it means for the answer', () => {
  const kinds = ['writing', 'retry', 'judge', 'timeout', 'rethink', 'delegate', 'model_unavailable', 'clause', 'law_search', 'dropped']
  for (const kind of kinds) {
    const a = x.annotate({ type: 'step', kind, text: `internal ${kind}` })
    assert.ok(a.plain && !JARGON.test(a.plain) && !a.plain.includes('internal'), `${kind}: ${a.plain}`)
  }
  assert.strictEqual(x.annotate({ type: 'step', kind: 'judged', verified: 2, total: 3 }).plain, 'Checked the suggestions: 2 of 3 hold up')
  assert.strictEqual(x.annotate({ type: 'step', kind: 'law_search' }).quiet, true)
  assert.strictEqual(x.annotate({ type: 'step', kind: 'dropped' }).quiet, true)
  const failed = x.annotate({ type: 'step', kind: 'tool_failed', tool: 'search_ris', detail: {} })
  assert.strictEqual(failed.failed, true)
  assert.match(failed.plain, /Couldn't reach RIS.*copy of the law on this computer/)
  assert.match(x.annotate({ type: 'step', kind: 'blocked', tool: 'web_fetch', detail: { host: 'example.org' } }).plain, /^Not done — your firm's rules don't allow it: opening a web page: example\.org$/)
  assert.match(x.annotate({ type: 'step', kind: 'declined', tool: 'write_file', detail: { file: 'a.csv' } }).plain, /^Not done — you said no: saving “a\.csv”/)
})

test('contract review: "Reviewing clause 4 (Liability) — 4 of 18"', () => {
  const a = x.annotate({ type: 'step', kind: 'clause', position: 3, total: 18, detail: { clause: { index: 3, heading: '4. Liability' } } })
  assert.strictEqual(a.plain, 'Reviewing clause 4 (Liability) — 4 of 18')
})

test('unknown or old events: a general sentence, never the raw text', () => {
  assert.strictEqual(x.annotate({ type: 'step', kind: 'brand_new_kind', text: 'tool_picker: {"x":1}' }).plain, 'Working on your question')
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'some_future_tool', detail: { secret: 'x' } }).plain, 'Working on your question')
  assert.strictEqual(x.annotate({ type: 'step', text: 'something odd happened: get_range_text' }).plain, 'Working on your question')
  // Older engines only sent text ("tool: search_law"): still understood.
  assert.strictEqual(x.annotate({ type: 'step', text: 'tool: search_law' }).plain, 'Searching the law')
  assert.strictEqual(x.annotate({ type: 'step', text: 'judge: 1/2 verified' }).plain, 'Checked the suggestions: 1 of 2 hold up')
  assert.strictEqual(x.annotate({ type: 'step', text: 'analyzing § Haftung…' }).plain, 'Working on your question')
  assert.strictEqual(x.annotate({ type: 'step', text: 'verifying pack signature…' }).plain, 'Checking the law collection is genuine')
  // A broken detail never throws.
  assert.strictEqual(x.annotate({ type: 'step', kind: 'tool', tool: 'search_law', detail: null }).plain, 'Searching the law')
})

test('withPlain: adds to step (and agent progress) events only, keeps everything else, never overwrites', () => {
  const step = { type: 'step', text: 'tool: search_law', kind: 'tool', tool: 'search_law', detail: { jurisdiction: 'DE' } }
  assert.strictEqual(x.withPlain(step), step)
  assert.strictEqual(step.plain, 'Searching German law')
  assert.strictEqual(step.text, 'tool: search_law', 'backwards compatible: text and kind stay')
  const progress = x.withPlain({ type: 'progress', kind: 'tool', tool: 'search_eurlex', detail: {} })
  assert.strictEqual(progress.online, true)
  const docProgress = x.withPlain({ type: 'progress', index: 1, total: 3, name: 'a.pdf' })
  assert.strictEqual(docProgress.plain, undefined)
  const text = x.withPlain({ type: 'text', text: 'hello' })
  assert.deepStrictEqual(text, { type: 'text', text: 'hello' })
  const already = x.withPlain({ type: 'step', kind: 'writing', plain: 'Custom sentence' })
  assert.strictEqual(already.plain, 'Custom sentence')
  assert.strictEqual(x.withPlain(null), null)
})

test('service names never show a model id; the data line counts calls', () => {
  assert.strictEqual(x.serviceName({ provider: 'anthropic', model: 'claude-sonnet-4-5', region: 'eu-central-1' }), 'Claude (Anthropic, EU)')
  assert.strictEqual(x.serviceName({ provider: 'mistral', model: 'mistral-large-latest', region: 'eu' }), 'Mistral (EU)')
  assert.strictEqual(x.serviceName({ provider: 'local', local: true, model: 'lotus-4b' }), 'the AI on this computer')
  let models = []
  models = x.addModel(models, { provider: 'anthropic', model: 'claude-x', region: 'eu-central-1', redacted: true })
  models = x.addModel(models, { provider: 'anthropic', model: 'claude-x', region: 'eu-central-1', redacted: true })
  assert.strictEqual(x.dataLine(models, []).text, 'Sent to: Claude (Anthropic, EU) — names and numbers hidden (pseudonymised) · 2 times')
  assert.deepStrictEqual(x.dataLine([], []), { text: 'Stayed on this computer', left: false })
  assert.strictEqual(x.dataLine([{ local: true, calls: 3 }], ['RIS (Austria\'s federal law database)']).left, true)
})

test('friendly errors and the suggestion check line', () => {
  assert.match(x.friendly('Blocked by data policy: anthropic'), /client-data rule/)
  assert.match(x.errorSentence('ECONNREFUSED', { partial: true }), /what was written so far is kept/)
  assert.strictEqual(x.checkLine({ basis: { source: 'ABGB', section: '§ 933' }, verdict: { status: 'verified' } }).text, 'checked against ABGB § 933 ✓')
  assert.strictEqual(x.checkLine({ verdict: { status: 'verified', note: 'judge unavailable' } }).text, 'could not be verified — review carefully')
  assert.strictEqual(x.checkLine({}).ok, false)
  assert.strictEqual(x.duration(65000), '1 min 5 s')
})
