"use strict"
/**
 * Phase 4 workflows: matter review + chronology, with verbatim-quote
 * verification.
 *
 *   node --test test/workflows.test.js
 *
 * A fake model returns one genuine finding/event and one with an invented
 * quote per document; only the genuine ones may survive into the report.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-wf-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n')
    let reply
    if (prompt.includes('CHECKLIST')) {
      reply = prompt.includes('lease.txt')
        ? '```json\n[{"check":"termination","answer":"Either party may terminate with three months notice.","quote":"Either party may terminate this lease with three (3) months\' written notice","location":"§ 7","risk":"high"},' +
          '{"check":"liability_cap","answer":"Liability is capped at EUR 1m.","quote":"liability shall not exceed EUR 1,000,000","location":"§ 9","risk":"high"}]\n```'
        : '[{"check":"governing_law","answer":"Austrian law, Vienna courts.","quote":"governed by Austrian law … courts of Vienna","location":"§ 12","risk":"medium"}]'
    } else {
      reply = prompt.includes('lease.txt')
        ? 'Here you go: [{"date":"2026-03-01","event":"Lease starts","quote":"The lease commences on 1 March 2026"},{"date":"2026-02-30","event":"Bogus date","quote":"The lease commences on 1 March 2026"},{"date":"2027-01-01","event":"Invented","quote":"rent increases on 1 January 2027"}]'
        : '{"events": [{"date":"2025-11-15","event":"Supply agreement signed","quote":"Signed in Vienna on 15 November 2025"},{"date":"2026-03-01","event":"Lease starts (mentioned)","quote":"the premises lease from 1 March 2026"},{"date":"2026-09-30","event":"Payment due","quote":"payable by 30 October 2026"}]}'
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  })
})

const docs = path.join(DATA, 'Acme docs')
let wf, ws
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
  ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'workspace'))
  fs.mkdirSync(docs)
  fs.writeFileSync(path.join(docs, 'lease.txt'), '§ 1 The lease commences on 1 March 2026.\n\n§ 7 Either party may terminate this lease with three (3) months’ written notice.\n\n§ 9 Each party is liable for its own acts.')
  fs.writeFileSync(path.join(docs, 'supply.md'), '# Supply agreement\n\nThis agreement is governed by Austrian law. Exclusive place of jurisdiction are the courts of Vienna.\n\nIt refers to the premises lease from 1 March 2026.\n\nThe fee is payable by 30 October 2026.\n\nSigned in Vienna on 15 November 2025.')
  const matters = require('../src/matters')
  const m = matters.create({ title: 'Acme', number: '2026-014' })
  require('../src/library').addFolder(docs, m.id)
  process.env.TEST_MATTER = m.id
  wf = require('../src/workflows')
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('quote verification: whitespace/typography tolerant, ellipsis-aware, rejects inventions', () => {
  const src = 'Either party may terminate this lease with three (3) months’ written notice.\nGoverned by Austrian law. Courts of Vienna.'
  assert.ok(wf.quoteInSource("Either party may terminate this lease with three (3) months' written   notice", src))
  assert.ok(wf.quoteInSource('governed by Austrian law … courts of Vienna', src))
  assert.ok(!wf.quoteInSource('courts of Vienna … governed by Austrian law', src), 'ellipsis parts must be in order')
  assert.ok(!wf.quoteInSource('liability shall not exceed EUR 1,000,000', src))
  assert.ok(!wf.quoteInSource('Vienna', src), 'too short to prove anything')
})

test('dates: partial ok, impossible rejected', () => {
  assert.deepStrictEqual(wf.parseDate('2026-03'), { sort: '2026-03-00', display: '2026-03' })
  assert.strictEqual(wf.parseDate('2026-13-01'), null)
  assert.strictEqual(wf.parseDate('2026-02-30'), null)
  assert.deepStrictEqual(wf.parseDate('2028-02-29').display, '2028-02-29')
  assert.strictEqual(wf.parseDate('1 March 2026'), null)
})

test('matter review keeps verified findings only and writes the report', async () => {
  const progress = []
  const r = await wf.runReview({ matterId: process.env.TEST_MATTER, onProgress: (p) => progress.push(p) })
  assert.strictEqual(r.stats.documents, 2)
  assert.deepStrictEqual(r.findings.map((f) => [f.document, f.check]).sort(), [['lease.txt', 'termination'], ['supply.md', 'governing_law']])
  assert.strictEqual(r.stats.unverified, 1, 'the invented liability-cap quote is dropped')
  assert.strictEqual(progress.length, 2)
  const md = fs.readFileSync(r.files[0], 'utf8')
  assert.match(r.files[0], /2026-014_Acme[\\/]review-\d{4}-\d{2}-\d{2}\.md$/)
  assert.match(md, /1 dropped \(quote not found/)
  assert.ok(!md.includes('EUR 1,000,000'))
  assert.match(fs.readFileSync(r.files[1], 'utf8'), /^document,check,risk,answer,quote,location\n/)
})

test('chronology: verified, sorted, impossible dates dropped', async () => {
  const r = await wf.runChronology({ matterId: process.env.TEST_MATTER })
  assert.deepStrictEqual(r.events.map((e) => [e.display, e.document]), [
    ['2025-11-15', 'supply.md'],
    ['2026-03-01', 'lease.txt'],
    ['2026-03-01', 'supply.md'],
    ['2026-10-30', 'supply.md'],
  ], 'wrapped {"events": [...]} is accepted; the misread month (09) is corrected from the quote (October)')
  assert.strictEqual(r.stats.unverified, 1, 'invented quote dropped')
  assert.strictEqual(r.stats.corrected, 2, 'impossible 2026-02-30 and misread 2026-09-30 both taken from their quotes')
  assert.match(fs.readFileSync(r.files[0], 'utf8'), /\| 2025-11-15 \| Supply agreement signed \|/)
})

test('privileged matter blocks a cloud model for the whole workflow', async () => {
  const matters = require('../src/matters')
  const priv = matters.create({ title: 'Investigation', privileged: true })
  require('../src/library').addFolder(docs, priv.id)
  const policy = require('../src/policy')
  const r = await policy.withMatter(priv.id, () => wf.runReview({ matterId: priv.id }))
  assert.strictEqual(r.findings.length, 0)
  assert.ok(r.stats.errors.every((e) => /data policy/.test(e)), 'each document reports the policy block')
})

test('bundled playbooks load; a firm playbook with the same name wins', () => {
  assert.ok(wf.bundledPlaybooks().includes('dpa-gdpr-art28'))
  for (const name of wf.bundledPlaybooks()) {
    const pb = wf.loadPlaybook(name)
    assert.ok(pb.checks.length >= 5, `${name} has checks`)
    assert.strictEqual(new Set(pb.checks.map((c) => c.id)).size, pb.checks.length, `${name}: unique ids`)
  }
  assert.strictEqual(wf.loadPlaybook('nda').title, 'NDA / confidentiality agreement')
  ws.writeFile('playbooks/nda.json', JSON.stringify({ title: 'Our NDA standard', checks: [{ id: 'term', question: 'How long?' }] }))
  assert.strictEqual(wf.loadPlaybook('nda').title, 'Our NDA standard')
  assert.throws(() => wf.loadPlaybook('does-not-exist'), /no playbook/)
})
