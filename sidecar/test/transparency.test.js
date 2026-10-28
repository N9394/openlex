"use strict"
/**
 * What the engine tells a front end so a lawyer always knows what is going
 * on: one `model` event per AI call (which service, local or cloud,
 * region, names hidden — never content), plain details on `step` events,
 * and the per-matter activity log behind GET /api/activity.
 *
 *   node --test test/transparency.test.js
 *
 * Offline: the local model is replaced by a stub; nothing is sent anywhere.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-transparency-'))
process.env.LEXVAULT_DATA_DIR = DATA

const policy = require('../src/policy')
const activity = require('../src/activity')

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

test('observeModels: every model call inside the request is reported, also through withMatter', async () => {
  const seen = []
  await policy.observeModels((m) => seen.push(m), () => policy.withMatter('m_1', async () => {
    assert.strictEqual(policy.currentMatter(), 'm_1')
    policy.reportModel({ provider: 'local', local: true })
    await policy.withMatter('m_2', async () => { policy.reportModel({ provider: 'anthropic', local: false, region: 'eu-central-1', redacted: true }) })
  }))
  assert.deepStrictEqual(seen.map((m) => m.provider), ['local', 'anthropic'])
  // Outside an observed request: nothing happens, nothing throws.
  policy.reportModel({ provider: 'local' })
  await policy.withMatter('m_3', async () => { policy.reportModel({ provider: 'local' }) })
  assert.strictEqual(seen.length, 2)
  // A broken observer never breaks the call.
  await policy.observeModels(() => { throw new Error('boom') }, async () => { policy.reportModel({ provider: 'local' }) })
})

test('llm: a call on this computer emits one model event with no content', async () => {
  const local = require('../src/providers/local')
  const orig = local.chat
  local.chat = async () => 'stub answer'
  try {
    const llm = require('../src/llm')
    const seen = []
    const out = await policy.observeModels((m) => seen.push(m), () => llm.chat([{ role: 'user', content: 'Secret client text' }], { phase: 'planning' }))
    assert.strictEqual(out, 'stub answer')
    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].provider, 'local')
    assert.strictEqual(seen[0].local, true)
    assert.strictEqual(seen[0].redacted, false)
    assert.strictEqual(seen[0].role, 'plan')
    assert.ok(!JSON.stringify(seen).includes('Secret'), 'metadata only')
  } finally { local.chat = orig }
})

test('toolDetail: search words, jurisdiction, clause, web host, file name — never content, URLs with queries or commands', () => {
  assert.deepStrictEqual(activity.toolDetail('search_law', { query: 'Gewährleistung Frist', jurisdiction: 'AT' }), { query: 'Gewährleistung Frist', jurisdiction: 'AT' })
  assert.deepStrictEqual(activity.toolDetail('web_fetch', { url: 'https://eur-lex.europa.eu/search?client=Alpine' }), { host: 'eur-lex.europa.eu' })
  assert.deepStrictEqual(activity.toolDetail('get_range_text', { index: 3 }, { index: 3, heading: '4. Liability', text: 'the clause text' }), { clause: { index: 3, heading: '4. Liability' } })
  assert.deepStrictEqual(activity.toolDetail('write_file', { path: 'Alpine/obligations.csv', content: 'party,obligation' }), { file: 'obligations.csv' })
  assert.deepStrictEqual(activity.toolDetail('run_bash', { command: 'cat secrets.txt' }), {})
  assert.deepStrictEqual(activity.toolDetail('propose_suggestions', { suggestions: [{ proposed_text: 'x' }] }), {})
})

test('activity: a request is recorded (asked, looked at, law, where data went, result) and listed newest first', () => {
  const rec = activity.start({ matterId: 'm_1', kind: 'question', asked: 'Is the cap valid?', client: 'tui', files: ['/x/SPA draft 3.docx'] })
  rec.see({ type: 'model', provider: 'anthropic', label: 'Anthropic', model: 'claude-x', local: false, region: 'eu-central-1', redacted: true })
  rec.see({ type: 'step', text: 'tool: search_law', kind: 'tool', tool: 'search_law', detail: { query: 'Haftung', jurisdiction: 'AT' } })
  rec.see({ type: 'step', text: 'tool: search_law', kind: 'tool', tool: 'search_law', detail: { query: 'Haftung', jurisdiction: 'AT' } })
  rec.see({ type: 'law', sources: [{ source_name: 'ABGB', section: '§ 1295', snippet: 'long law text' }] })
  rec.see({ type: 'model', provider: 'anthropic', label: 'Anthropic', model: 'claude-x', local: false, region: 'eu-central-1', redacted: true })
  rec.see({ type: 'text', text: 'The answer text is never stored.' })
  rec.see({ type: 'suggestion', suggestion: { summary: 's' } })
  const r = rec.finish({})
  assert.strictEqual(r.result, 'done')
  assert.deepStrictEqual(r.files, ['SPA draft 3.docx'])
  assert.deepStrictEqual(r.looked, [{ tool: 'search_law', detail: { query: 'Haftung', jurisdiction: 'AT' } }])
  assert.deepStrictEqual(r.sources, ['ABGB § 1295'])
  assert.deepStrictEqual(r.data, [{ provider: 'anthropic', label: 'Anthropic', model: 'claude-x', local: false, region: 'eu-central-1', redacted: true, calls: 2 }])
  assert.strictEqual(r.suggestions, 1)
  const stopped = activity.start({ matterId: 'm_1', kind: 'review', asked: 'spa' })
  stopped.see({ type: 'progress', step: 'document', index: 1, total: 3, name: 'Lease 1.docx' })
  stopped.finish({ aborted: true })
  const failed = activity.start({ matterId: 'm_1' })
  failed.finish({ error: 'ECONNREFUSED' })
  const list = activity.list('m_1')
  assert.deepStrictEqual(list.map((x) => x.result), ['failed', 'stopped', 'done'])
  assert.deepStrictEqual(list[1].looked, [{ document: 'Lease 1.docx' }])
  assert.ok(!fs.readFileSync(path.join(activity.DIR, 'm_1.jsonl'), 'utf8').includes('never stored'), 'no answer text in the log')
  assert.deepStrictEqual(activity.list('nothing-here'), [])
})
