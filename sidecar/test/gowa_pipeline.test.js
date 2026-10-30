"use strict"
/**
 * The training pipeline (models/gowa/) as far as the engine depends on it:
 *   - the engine's format (gowa_format.js) and the trainer's twin
 *     (models/gowa/gowa/format.py) give identical ids and answers
 *     (cases written by models/gowa/tests/make_twin_cases.py)
 *   - the licence register (models/gowa/datasets.yaml) is valid: required
 *     fields, nothing non-commercial or unclear included, client data never
 *
 *   node --test test/gowa_pipeline.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const fmt = require('../src/gowa_format')

const GOWA_DIR = path.join(__dirname, '..', '..', 'models', 'gowa')

test('format twin: JS and Python build the same sequences and read the same answers', () => {
  const { markers, vocab, cases } = JSON.parse(fs.readFileSync(path.join(GOWA_DIR, 'tests', 'twin_cases.json'), 'utf8'))
  const encode = (t) => (String(t).toLowerCase().match(/\S+/g) || []).map((w) => vocab[w])
  for (const c of cases) {
    const s = fmt.buildSequence({ state: c.state, question: c.question, encode, markers, maxLen: c.max_len })
    assert.deepStrictEqual(s.ids, c.ids, JSON.stringify(c.question))
    assert.deepStrictEqual(s.optionIndex, c.option_index)
    assert.strictEqual(s.decideIndex, c.decide_index)
    assert.strictEqual(s.truncated, c.truncated)
    assert.deepStrictEqual(fmt.answerFrom(c.question, c.logits, c.temperature), c.answer)
  }
})

// ── the licence register ────────────────────────────────────────────────
// The same strict YAML subset and rules as models/gowa/gowa/register.py.
function parseRegister(text) {
  const entries = []
  let cur = null
  let inList = false
  const value = (raw) => {
    const v = raw.trim()
    if (v.startsWith('[') && v.endsWith(']')) { const inner = v.slice(1, -1).trim(); return inner ? inner.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [] }
    if (v.length >= 2 && v[0] === v[v.length - 1] && `'"`.includes(v[0])) return v.slice(1, -1)
    return v
  }
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return
    if (line.trimEnd() === 'datasets:') { inList = true; return }
    if (!inList) throw new Error(`line ${i + 1}: expected "datasets:" first`)
    let m = line.match(/^ {2}- (\w+):\s?(.*)$/)
    if (m) { cur = { [m[1]]: value(m[2]) }; entries.push(cur); return }
    m = line.match(/^ {4}(\w+):\s?(.*)$/)
    if (m && cur) { if (m[1] in cur) throw new Error(`line ${i + 1}: ${m[1]} twice`); cur[m[1]] = value(m[2]); return }
    throw new Error(`line ${i + 1}: not understood: ${line.trim().slice(0, 60)}`)
  })
  return entries
}

const REQUIRED = ['id', 'name', 'kind', 'source', 'licence', 'commercial', 'include', 'tasks', 'reason']
const TASKS = ['redaction', 'injection', 'claim_support', 'clause_type', 'relevance', 'routing', 'in_force', 'general']
function problems(entries) {
  const out = []
  const seen = new Set()
  for (const e of entries) {
    const who = e.id || '?'
    for (const k of REQUIRED) if (e[k] === undefined || e[k] === '') out.push(`${who}: missing ${k}`)
    if (seen.has(who)) out.push(`${who}: listed twice`)
    seen.add(who)
    if (!['dataset', 'corpus', 'model', 'labeler', 'never'].includes(e.kind)) out.push(`${who}: bad kind`)
    if (!['yes', 'no', 'unclear'].includes(e.commercial)) out.push(`${who}: bad commercial`)
    if (!['yes', 'no'].includes(e.include)) out.push(`${who}: bad include`)
    if (!Array.isArray(e.tasks) || e.tasks.some((t) => !TASKS.includes(t))) out.push(`${who}: bad tasks`)
    if (e.include === 'yes') {
      if (/\bNC\b|non-?commercial/i.test(e.licence)) out.push(`${who}: NC included`)
      if (e.kind === 'never') out.push(`${who}: never-kind included`)
      if (e.commercial === 'no') out.push(`${who}: non-commercial included`)
      if (e.commercial === 'unclear' && !('subsets' in e)) out.push(`${who}: unclear without cleared subsets`)
      if (/\b(unknown|unclear)\b/i.test(e.licence) && !('subsets' in e)) out.push(`${who}: unknown licence included`)
    }
  }
  return out
}

test('licence register: valid, seeded from the research, nothing unclear or non-commercial included', () => {
  const entries = parseRegister(fs.readFileSync(path.join(GOWA_DIR, 'datasets.yaml'), 'utf8'))
  assert.deepStrictEqual(problems(entries), [])
  const by = Object.fromEntries(entries.map((e) => [e.id, e]))
  for (const id of ['cuad', 'lexglue', 'multi_eurlex', 'mmbert-small']) assert.strictEqual(by[id].include, 'yes', id)
  for (const id of ['contract_nli', 'ai4privacy', 'legalbench', 'kev_decision_v7', 'client_documents']) assert.strictEqual(by[id].include, 'no', id)
  assert.deepStrictEqual(by.lextreme.subsets, [], 'LEXTREME only per cleared task')
  assert.strictEqual(by.client_documents.kind, 'never')
})

test('licence register rules catch the mistakes they are for', () => {
  const ok = { id: 'x', name: 'x', kind: 'dataset', source: 's', licence: 'CC-BY-4.0', commercial: 'yes', include: 'yes', tasks: [], reason: 'r' }
  assert.deepStrictEqual(problems([ok]), [])
  assert.match(problems([{ ...ok, licence: 'CC-BY-NC-4.0' }])[0], /NC/)
  assert.match(problems([{ ...ok, commercial: 'unclear' }])[0], /unclear/)
  assert.match(problems([{ ...ok, kind: 'never' }])[0], /never/)
  assert.match(problems([{ ...ok, licence: 'unknown' }])[0], /unknown/)
  assert.match(problems([{ ...ok, tasks: ['dancing'] }])[0], /tasks/)
  assert.ok(problems([ok, ok]).some((p) => /twice/.test(p)))
  assert.throws(() => parseRegister('datasets:\n  - id: a\n    id: b\n'), /twice/)
})

test('seed examples: every line is a valid example from an included source', () => {
  const entries = Object.fromEntries(parseRegister(fs.readFileSync(path.join(GOWA_DIR, 'datasets.yaml'), 'utf8')).map((e) => [e.id, e]))
  const dir = path.join(GOWA_DIR, 'seed')
  let n = 0
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      const ex = JSON.parse(line)
      assert.strictEqual(entries[ex.source]?.include, 'yes', `${f}: ${ex.source}`)
      assert.ok(TASKS.includes(ex.task))
      if (ex.type === 'choice') assert.ok(Object.keys(ex.criteria).includes(ex.answer), `${f}: ${ex.answer}`)
      if (ex.type === 'noul') assert.strictEqual(typeof ex.answer, 'boolean')
      n++
    }
  }
  assert.ok(n >= 30)
})
