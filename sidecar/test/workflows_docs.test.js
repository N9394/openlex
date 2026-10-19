"use strict"
/**
 * Phase 4 document workflows: contract translation (with deterministic
 * number / glossary / completeness checks) and version comparison.
 *
 *   node --test test/workflows_docs.test.js
 *
 * A fake model translates with one planted error (a changed amount) and
 * skips one paragraph on the first pass; the checks must catch both.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-wfd-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const EN = {
  'Werkvertrag': 'Contract for Work',
  '§ 1 Der Auftragnehmer erbringt die Leistung bis 30.10.2026.': '§ 1 The Contractor performs the work by 30 October 2026.',
  '§ 2 Die Vergütung beträgt EUR 1.250.000,00.': '§ 2 The fee is EUR 1,350,000.00.', // planted error
  '§ 3 Es gilt österreichisches Recht.': '§ 3 Austrian law applies.',
  '§ 4 Der Auftraggeber zahlt binnen 14 Tagen.': '§ 4 The client pays within 14 days.', // glossary wants "Principal"
}
let skippedOnce = false
const prompts = []

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n')
    prompts.push(prompt)
    let reply
    if (prompt.includes('Translate each paragraph')) {
      const items = []
      for (const [, i, text] of prompt.matchAll(/\[(\d+)\] (.+)/g)) {
        // First pass drops § 3 (models skip paragraphs) — the retry must fill it.
        if (text.startsWith('§ 3') && !skippedOnce) { skippedOnce = true; continue }
        items.push({ i: +i, t: EN[text.trim()] || `EN:${text}` })
      }
      reply = JSON.stringify(items)
    } else if (prompt.includes('compare two versions')) {
      reply = JSON.stringify([...prompt.matchAll(/\[(\d+)\] (CHANGED|ADDED|DELETED)/g)].map(([, i, kind]) => ({
        i: +i, materiality: kind === 'CHANGED' ? 'high' : 'low', summary: kind === 'CHANGED' ? 'Liability cap lowered, favours the supplier.' : 'Clause ' + kind.toLowerCase() + '.',
      })))
    } else reply = '[]'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  })
})

const docs = path.join(DATA, 'Matter docs')
let wfd, matterId
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
  const ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'workspace'))
  ws.writeFile('glossaries/firm.json', JSON.stringify({ en: { Auftraggeber: 'Principal', Auftragnehmer: 'Contractor' } }))
  fs.mkdirSync(docs)
  fs.writeFileSync(path.join(docs, 'werkvertrag.txt'), Object.keys(EN).join('\n\n'))
  fs.writeFileSync(path.join(docs, 'supply-v1.txt'), 'Supply agreement\n\n§ 1 Scope of supply as per Annex 1.\n\n§ 2 Liability is capped at EUR 1,000,000.\n\n§ 3 Old confidentiality clause.\n\n§ 4 Austrian law.')
  fs.writeFileSync(path.join(docs, 'supply-v2.txt'), 'Supply agreement\n\n§ 1 Scope of supply as per Annex 1.\n\n§ 2 Liability is capped at EUR 250,000.\n\n§ 4 Austrian law.\n\n§ 5 Disputes go to VIAC arbitration in Vienna.')
  const m = require('../src/matters').create({ title: 'Bau', number: '2026-020' })
  matterId = m.id
  require('../src/library').addFolder(docs, m.id)
  wfd = require('../src/workflows_docs')
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('numbers: separators and date formats may change, digits may not', () => {
  assert.ok(wfd.sameNumbers('EUR 1.250.000,00 am 30.10.2026 (§ 12 Abs 3)', 'EUR 1,250,000.00 on 30 October 2026 (Section 12 para 3)'))
  assert.ok(!wfd.sameNumbers('EUR 1.250.000,00', 'EUR 1,350,000.00'))
  assert.ok(!wfd.sameNumbers('bis 31.12.2026', 'until 31 December 2025'))
  assert.ok(wfd.sameNumbers('am 1. März 2026', 'le 1 mars 2026'))
})

test('translate: Word output, retry fills skipped paragraphs, wrong amount and glossary misses are flagged', async () => {
  const r = await require('../src/policy').withMatter(matterId, () => wfd.runTranslate({ matterId, file: 'werkvertrag.txt', target: 'en', glossary: 'firm' }))
  assert.strictEqual(r.stats.paragraphs, 5)
  assert.strictEqual(r.stats.translated, 5, 'the skipped paragraph was retried on its own')
  const issues = r.flags.map((f) => `${f.i}:${f.issue}`)
  assert.ok(issues.some((x) => x.startsWith('2:numbers differ')), 'changed amount is caught')
  assert.ok(issues.some((x) => x.startsWith('4:glossary not used: Auftraggeber → Principal')))
  assert.strictEqual(r.flags.length, 2, `no false alarms (date rewritten as "30 October 2026" is fine): ${issues}`)
  const [docx, review, md] = r.files
  assert.match(docx, /werkvertrag\.en\.docx$/)
  const text = require('../src/docx_text').docxText(docx)
  assert.match(text, /The Contractor performs the work by 30 October 2026/)
  assert.match(require('../src/docx_text').docxText(review), /numbers differ/)
  assert.match(fs.readFileSync(md, 'utf8'), /¶3: numbers differ/)
})

test('compare: deterministic paragraph + word diff, model only rates materiality', async () => {
  const r = await require('../src/policy').withMatter(matterId, () => wfd.runCompare({ matterId, fileA: 'supply-v1.txt', fileB: 'supply-v2.txt' }))
  const kinds = r.changes.map((c) => c.kind)
  assert.deepStrictEqual(kinds, ['changed', 'added'], 'the § 2 edit and the § 3 deletion pair up as one change; § 5 is new')
  assert.deepStrictEqual(r.changes[0].removed, ['§ 2 Liability is capped at EUR 1,000,000.', '§ 3 Old confidentiality clause.'])
  assert.strictEqual(r.changes[0].materiality, 'high')
  assert.strictEqual(r.stats.changes, 2)
  const words = wfd.wordRuns('Liability is capped at EUR 1,000,000.', 'Liability is capped at EUR 250,000.')
  assert.deepStrictEqual(words.filter((w) => w.kind !== 'same').map((w) => `${w.kind}:${w.text}`), ['del:1,000,000.', 'ins:250,000.'])
  const md = fs.readFileSync(r.files[1], 'utf8')
  assert.match(md, /\[-1,000,000\.[\s\S]*-\]\{\+250,000\./)
  assert.match(require('../src/docx_text').docxText(r.files[0]), /Liability cap lowered/)
})

test('compare works offline: without a model the diff is still produced', async () => {
  const r = await wfd.runCompare({ matterId, fileA: 'supply-v1.txt', fileB: 'supply-v2.txt', rate: false })
  assert.strictEqual(r.stats.changes, 2)
  assert.ok(r.changes.every((c) => !c.materiality))
})
