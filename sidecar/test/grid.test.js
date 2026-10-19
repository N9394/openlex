"use strict"
/**
 * Review grid (Phase 7.1): rows = documents, columns = questions.
 *
 *   node --test test/grid.test.js
 *
 * A fake model answers from a fixed table. It invents one quote (must end
 * up "unverified"), gives one off-list choice (must be "invalid"), and the
 * dependent column must see its upstream answer and recompute when that
 * answer changes. Locked/edited cells must survive reruns.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-grid-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const DOCS = {
  'nda-acme.txt': 'Mutual NDA\n\n1. Term. This Agreement remains in force for 24 months from signature.\n\n2. Governing law. This Agreement is governed by the laws of Austria.\n\n3. Signed on 1 March 2026 in Vienna.',
  'nda-beta.txt': 'Confidentiality Agreement\n\nClause 4: The obligations survive for three (3) years.\n\nClause 9: German law applies; courts of Munich.',
}
let lawOverride = null
const prompts = []

function answer(doc, col, prompt) {
  const acme = doc.startsWith('nda-acme')
  switch (col) {
    case 'term': return acme ? { value: '24 months', quote: 'remains in force for 24 months from signature' } : { value: '3 years', quote: 'The obligations survive for three (3) years.' }
    case 'law': {
      if (acme) return { value: lawOverride || 'Austria', quote: 'governed by the laws of Austria' }
      return { value: 'Bavaria', quote: 'German law applies; courts of Munich.' } // not an option → invalid
    }
    case 'signed': return acme ? { value: '1 March 2026', quote: 'Signed on 1 March 2026 in Vienna.' } : null
    case 'arbitration': return acme ? { value: 'No', quote: 'This Agreement contains an arbitration clause.' } : null // invented quote
    case 'law_note': {
      const m = prompt.match(/- law: (.+)/)
      return acme ? { value: `Follows from ${m ? m[1] : '??'}`, quote: 'governed by the laws of Austria' } : null
    }
    default: return null
  }
}

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n')
    prompts.push(prompt)
    const doc = (prompt.match(/DOCUMENT: (\S+)/) || [])[1] || ''
    // Only the lines under COLUMNS: are questions; "ALREADY ESTABLISHED" lines are context.
    const asked = prompt.slice(prompt.indexOf('COLUMNS:'))
    const items = []
    for (const [, c] of asked.matchAll(/^- (\w+): /gm)) {
      const a = answer(doc, c, prompt)
      if (a) items.push({ column: c, ...a, location: '§ 1' })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(items) } }] }))
  })
})

const folder = path.join(DATA, 'NDAs')
let grid, matterId
const COLUMNS = [
  { id: 'term', label: 'Term', prompt: 'How long does the agreement last?' },
  { id: 'law', label: 'Governing law', prompt: 'Which country\'s law governs?', type: 'choice', options: ['Austria', 'Germany', 'Other'] },
  { id: 'signed', label: 'Signed', prompt: 'When was it signed?', type: 'date' },
  { id: 'arbitration', label: 'Arbitration', prompt: 'Is there an arbitration clause?', type: 'yesno' },
  { id: 'law_note', label: 'Law note', prompt: 'Explain the governing law answer.', dependsOn: ['law'] },
]

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  fs.mkdirSync(folder)
  for (const [n, t] of Object.entries(DOCS)) fs.writeFileSync(path.join(folder, n), t)
  const m = require('../src/matters').create({ title: 'NDA sweep', number: '2026-031' })
  matterId = m.id
  require('../src/library').addFolder(folder, m.id)
  grid = require('../src/grid')
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('columns: ids, types, dependency levels, cycles and bad references are rejected', () => {
  const cols = grid.cleanColumns(COLUMNS)
  assert.deepStrictEqual(grid.levels(cols).map((l) => l.map((c) => c.id)), [['term', 'law', 'signed', 'arbitration'], ['law_note']])
  assert.throws(() => grid.cleanColumns([{ id: 'a', prompt: 'x', dependsOn: ['b'] }, { id: 'b', prompt: 'y', dependsOn: ['a'] }]), /cycle/)
  assert.throws(() => grid.cleanColumns([{ id: 'a', prompt: 'x', dependsOn: ['zzz'] }]), /unknown column/)
  assert.throws(() => grid.cleanColumns([{ prompt: 'x', type: 'choice', options: ['only'] }]), /two options/)
  assert.strictEqual(grid.cleanColumns([{ label: 'Change of control?' }])[0].id, 'change_of_control')
})

test('typed answers', () => {
  const [, law, signed, arb] = grid.cleanColumns(COLUMNS)
  assert.deepStrictEqual(grid.typed(arb, 'Ja, Klausel 12'), { value: 'Yes' })
  assert.deepStrictEqual(grid.typed(law, 'austria'), { value: 'Austria' })
  assert.ok(grid.typed(law, 'France').invalid)
  assert.deepStrictEqual(grid.typed(signed, '30 October 2026'), { value: '2026-10-30' })
  assert.ok(grid.typed(signed, 'soon').invalid)
})

test('run: verified, unverified, invalid, not found; dependent column sees its input', async () => {
  const g = grid.create({ matterId, title: 'NDA sweep', columns: COLUMNS })
  assert.strictEqual(g.documents.length, 2, 'defaults to the matter folder documents')
  const events = []
  const { stats } = await require('../src/policy').withMatter(matterId, () => grid.run(g.id, { onProgress: (e) => events.push(e) }))
  const v = grid.view(g.id)
  const cell = (doc, col) => v.rows.find((r) => r.name === doc).cells[v.columns.findIndex((c) => c.id === col)]
  assert.strictEqual(cell('nda-acme.txt', 'term').status, 'ok')
  assert.strictEqual(cell('nda-acme.txt', 'signed').value, '2026-03-01')
  assert.strictEqual(cell('nda-acme.txt', 'arbitration').status, 'unverified', 'invented quote is never shown as fact')
  assert.strictEqual(cell('nda-beta.txt', 'law').status, 'invalid', 'off-list choice is flagged')
  assert.strictEqual(cell('nda-beta.txt', 'signed').status, 'not_found')
  assert.strictEqual(cell('nda-acme.txt', 'law_note').value, 'Follows from Austria')
  assert.strictEqual(stats.cells, 10)
  assert.ok(events.some((e) => e.step === 'document'))
})

test('rerun: only stale cells recompute; upstream change re-runs dependents; locked cells survive', async () => {
  const g = grid.list(matterId)[0]
  const before = prompts.length
  await grid.run(g.id) // everything fresh except the error-free cells → no calls
  assert.strictEqual(prompts.length, before, 'nothing stale, no model calls')

  grid.setCell(g.id, { document: 'nda-beta.txt', column: 'term', value: 'Three years (checked)' })
  lawOverride = 'Other'
  await grid.run(g.id, { columns: ['law'], force: true })
  const v = grid.view(g.id)
  const idx = (c) => v.columns.findIndex((x) => x.id === c)
  const acme = v.rows.find((r) => r.name === 'nda-acme.txt')
  const beta = v.rows.find((r) => r.name === 'nda-beta.txt')
  assert.strictEqual(acme.cells[idx('law')].value, 'Other')
  assert.strictEqual(acme.cells[idx('law_note')].value, 'Follows from Other', 'dependent recomputed from the new upstream answer')
  assert.strictEqual(beta.cells[idx('term')].value, 'Three years (checked)')
  assert.strictEqual(beta.cells[idx('term')].status, 'edited')

  await grid.run(g.id, { force: true })
  assert.strictEqual(grid.view(g.id).rows.find((r) => r.name === 'nda-beta.txt').cells[idx('term')].value, 'Three years (checked)', 'force never overwrites a locked cell')
})

test('export: xlsx (grid + sources sheet) and csv in the matter folder', async () => {
  const g = grid.list(matterId)[0]
  const { files } = grid.exportGrid(g.id)
  const [xlsx, csv] = files
  assert.match(xlsx, /2026-031 NDA sweep|2026-031_NDA_sweep/)
  const buf = fs.readFileSync(xlsx)
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'zip container')
  const { execFileSync } = require('child_process')
  let listing = ''
  try { listing = execFileSync('unzip', ['-l', xlsx], { encoding: 'utf8' }) } catch { /* no unzip */ }
  if (listing) {
    assert.match(listing, /xl\/worksheets\/sheet2\.xml/)
    const sheet = execFileSync('unzip', ['-p', xlsx, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })
    assert.match(sheet, /Governing law/)
    assert.match(sheet, /UNVERIFIED/)
  }
  const text = fs.readFileSync(csv, 'utf8')
  assert.match(text.split('\n')[0], /"Document","Term","Governing law"/)
  assert.match(text, /"Three years \(checked\) \[edited\]"/)
})

test('update: removing a column drops its cells; delete removes the grid', () => {
  const g = grid.list(matterId)[0]
  const full = grid.get(g.id)
  grid.update(g.id, { columns: full.columns.filter((c) => c.id !== 'arbitration') })
  assert.ok(!Object.keys(grid.get(g.id).cells).some((k) => k.endsWith('::arbitration')))
  grid.remove(g.id)
  assert.strictEqual(grid.list(matterId).length, 0)
})
