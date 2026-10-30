"use strict"
/**
 * The tools that moved from the old desktop server into the chat (part 2):
 * saved items (the old Vault), /investigate (the old Investigate page),
 * /diligence (the old M&A pages), /draft (the old Workshop), the app's
 * search (find.js) and the shared exports (report.js) — all on the batch
 * machinery where many documents are read.
 *
 *   node --test test/tools.test.js
 *
 * Offline: a fake OpenAI-compatible model answers by prompt, fake law
 * search, no keys.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-tools-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const LEASE = `OFFICE LEASE

Between Alpha Immobilien GmbH (the Landlord) and Beta Consulting AG (the Tenant).

§ 1 Premises
The Landlord lets the office on the 3rd floor of Ringstraße 1, 1010 Vienna.

§ 2 Rent
The rent is EUR 4,000 per month, payable in advance.

§ 3 Term and termination
The lease runs for five years. The Tenant may not terminate before the end of the term. The Landlord may terminate with three months' notice.

§ 4 Liability
The Tenant is liable for all damage to the premises, whatever the cause.

§ 5 Change of control
If control of the Tenant changes, the Landlord may terminate the lease with immediate effect.`

const SUPPLY = `SUPPLY AGREEMENT

Between Gamma Parts GmbH (the Supplier) and Beta Consulting AG (the Buyer).

§ 1 Supply
The Supplier delivers spare parts within 14 days of an order.

§ 2 Liability
The Supplier's liability is capped at EUR 50,000 per year.

§ 3 Termination
Either party may terminate with six months' notice.`

// What the fake model says, by prompt.
function reply(prompt) {
  if (prompt.includes('Select the sections that are relevant')) return JSON.stringify({ selected: [0, 1], reasoning: 'The liability and termination parts.' })
  if (prompt.includes('Find everything in this text that answers the question')) {
    if (prompt.includes('OFFICE LEASE') || prompt.includes('Ringstraße')) {
      return JSON.stringify({ relevant: true, summary: 'The tenant carries unlimited liability; the landlord can terminate early.', findings: [
        { title: 'Unlimited tenant liability', kind: 'risk', level: 'high', party: 'Tenant', detail: 'The tenant pays for any damage, even without fault.', law_query: 'Haftung Mieter Verschulden', quote: 'The Tenant is liable for all damage to the premises, whatever the cause', location: '§ 4' },
        { title: 'Landlord may terminate early', kind: 'right', level: 'medium', party: 'Landlord', detail: 'Three months notice for the landlord only.', quote: "The Landlord may terminate with three months' notice", location: '§ 3' },
        { title: 'Invented clause', kind: 'risk', level: 'high', detail: 'not in the text', quote: 'The Tenant must pay a penalty of EUR 1 million', location: '§ 9' },
      ] })
    }
    return JSON.stringify({ relevant: true, summary: 'Liability is capped.', findings: [
      { title: 'Liability cap', kind: 'risk', level: 'medium', party: 'Supplier', detail: 'Capped at EUR 50,000 a year.', quote: "The Supplier's liability is capped at EUR 50,000 per year", location: '§ 2' },
    ] })
  }
  if (prompt.includes('Answer the question across the documents')) {
    return JSON.stringify({ answer: 'The lease puts unlimited liability on the tenant; the supply agreement caps liability.', common: [{ point: 'Both deal with liability.', refs: ['1:F1', '2:F1'] }], conflicts: [{ topic: 'Liability', detail: 'Unlimited in the lease, capped in the supply agreement.', refs: ['1:F1', '2:F1'] }, { topic: 'Insurance', detail: 'The lease requires insurance of EUR 5 million.', refs: [] }], gaps: [], favourable: 'The supply agreement is more favourable for Beta.' })
  }
  if (prompt.includes('STATEMENTS TO CHECK')) return JSON.stringify([{ i: 0, verdict: 'supported' }, { i: 1, verdict: 'supported' }, { i: 2, verdict: 'unsupported', note: 'No finding mentions insurance.' }])
  if (prompt.includes('You fill a review table')) {
    const out = []
    if (prompt.includes('OFFICE LEASE')) {
      out.push({ column: 'doc_type', value: 'real estate', quote: 'OFFICE LEASE', location: '' })
      out.push({ column: 'change_of_control', value: 'Yes', quote: 'If control of the Tenant changes, the Landlord may terminate the lease with immediate effect', location: '§ 5' })
      out.push({ column: 'parties', value: 'Alpha Immobilien GmbH (Landlord), Beta Consulting AG (Tenant)', quote: 'Between Alpha Immobilien GmbH (the Landlord) and Beta Consulting AG (the Tenant)', location: '' })
    } else if (prompt.includes('SUPPLY AGREEMENT')) {
      out.push({ column: 'doc_type', value: 'commercial contract', quote: 'SUPPLY AGREEMENT', location: '' })
      out.push({ column: 'change_of_control', value: 'No', quote: 'Either party may terminate with six months', location: '§ 3' })
    }
    return JSON.stringify(out)
  }
  if (prompt.includes('List the red flags for the transaction')) {
    if (prompt.includes('OFFICE LEASE')) return JSON.stringify({ summary: 'Office lease of the target.', flags: [{ title: 'No early exit for the tenant', tier: 'standard', category: 'legal', why: 'Fixed five-year term.', action: 'Price it in.', quote: 'The Tenant may not terminate before the end of the term', location: '§ 3' }] })
    return JSON.stringify({ summary: 'A supply agreement.', flags: [{ title: 'Liability cap too low', tier: 'price_affecting', category: 'financial', why: 'Losses above EUR 50,000 stay with the buyer.', action: 'Indemnity.', quote: "The Supplier's liability is capped at EUR 50,000 per year", location: '§ 2' }, { title: 'Hidden guarantee', tier: 'deal_breaker', category: 'legal', why: 'invented', action: '', quote: 'Gamma guarantees all debts of Beta', location: '' }] })
  }
  if (prompt.includes('You summarise a due-diligence review')) return JSON.stringify({ summary: 'Two contracts; the lease has a change-of-control termination right.', priorities: ['Get the landlord\'s waiver', 'Negotiate the supplier cap'], readiness: 'conditional' })
  if (prompt.includes('WHAT TO DRAFT')) return '# NON-DISCLOSURE AGREEMENT\n\nBetween [PARTY A] and [PARTY B].\n\n## 1 Confidential information\nEach party keeps the other party\'s information confidential.\n\n## 2 Term\nThis agreement runs for two years.'
  if (prompt.includes('turn a filled-in legal document into a reusable template')) return JSON.stringify([{ name: 'Landlord', type: 'company', value: 'Alpha Immobilien GmbH' }, { name: 'Rent', type: 'amount', value: 'EUR 4,000' }, { name: 'Ghost', type: 'name', value: 'Not In The Text Ltd' }])
  if (prompt.includes('INSTRUCTION: make it three years')) return 'This agreement runs for three years.'
  if (prompt.includes('Suggest 3 to 5 specific improvements')) return JSON.stringify(['Add a return-or-destroy clause', 'Name the governing law'])
  if (prompt.includes('Write one search query')) return JSON.stringify({ query: 'Vertraulichkeit Dauer' })
  if (prompt.includes('Is the clause consistent with the law found')) return JSON.stringify({ status: 'supported', explanation: 'Nothing in the law shown limits the term.' })
  if (prompt.includes('Would this clause be void')) return JSON.stringify({ unlawful: false, severity: 'none', note: 'Fine.' })
  return '[]'
}

const seen = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    const prompt = body.messages.map((m) => m.content).join('\n')
    seen.push(prompt)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply(prompt) } }] }))
  })
})

const lawCalls = []
const sources = { local: async (q) => { lawCalls.push(q.query); return [{ kind: 'law', title: 'ABGB', section: '§ 1111', snippet: 'Haftung des Bestandnehmers' }] }, web: async () => [] }
let matterId
let dir
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['openai'] })
  // These runs are about the tools; the redaction check has its own tests (redaction.test.js).
  require('../src/redaction_check').setCheck(false)
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  matterId = require('../src/matters').create({ title: 'Beta acquisition', number: '2026-88' }).id
  require('../src/analysis').setLawSources(sources)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-room-'))
  fs.writeFileSync(path.join(dir, 'lease.txt'), LEASE)
  fs.writeFileSync(path.join(dir, 'supply.txt'), SUPPLY)
})
test.after(() => { fake.close(); require('../src/analysis').setLawSources({}); fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }) })

const isDocx = (b64) => Buffer.from(b64, 'base64').slice(0, 2).toString() === 'PK'
const isPdf = (b64) => Buffer.from(b64, 'base64').slice(0, 5).toString() === '%PDF-'

// ── saved items (the old Vault) ──────────────────────────────────────────
test('saved items: per matter, every kind the old Vault refused, tags, search, edit, delete, exports', async () => {
  const saved = require('../src/saved')
  const a = saved.add({ matterId, kind: 'answer', title: 'Notice periods', content: '## Answer\n\nThree months for the landlord.\n\n## Based on\n\n1. § 3 of the lease', tags: 'lease, #deadlines', source: { kind: 'session', id: 'app:x', sessionId: 'app:x' } })
  assert.match(a.id, /^sv_[a-f0-9]{12}$/)
  assert.deepStrictEqual(a.tags, ['lease', 'deadlines'])
  const n = saved.add({ matterId, kind: 'note', content: 'Call the landlord about the waiver.' })
  assert.strictEqual(n.title, 'Call the landlord about the waiver.', 'a title from the first line')
  const att = await require('../src/attachments').add({ name: 'lease.txt', buffer: Buffer.from(LEASE), matterId })
  const d = saved.add({ matterId, attachment: att.id })
  assert.strictEqual(d.kind, 'document')
  assert.match(d.content, /OFFICE LEASE/)
  assert.throws(() => saved.add({ matterId, kind: 'poem', content: 'x' }), /kind must be one of/)
  assert.throws(() => saved.add({ matterId, kind: 'note', content: '  ' }), /nothing to save/)
  // The same result saved twice is one item.
  const r1 = saved.add({ matterId, kind: 'investigation', title: 'Inv', content: 'x', source: { kind: 'investigation', id: 'inv_0000000000000001' } })
  const r2 = saved.add({ matterId, kind: 'investigation', title: 'Inv', content: 'x', source: { kind: 'investigation', id: 'inv_0000000000000001' } })
  assert.strictEqual(r1.id, r2.id)

  assert.strictEqual(saved.list({ matterId }).length, 4)
  assert.strictEqual(saved.list({ matterId: null }).length, 0, 'items belong to their matter')
  assert.deepStrictEqual(saved.list({ matterId, q: 'landlord waiver' }).map((x) => x.id), [n.id])
  assert.deepStrictEqual(saved.list({ matterId, kind: 'document' }).map((x) => x.id), [d.id])
  saved.update(n.id, { favorite: true, title: 'Waiver', tags: ['todo'] })
  assert.strictEqual(saved.list({ matterId })[0].id, n.id, 'favourites first')
  assert.strictEqual(saved.search('waiver')[0].id, n.id)

  const w = saved.exportItem(a.id, 'docx')
  assert.ok(isDocx(w.data) && fs.existsSync(w.file) && /2026-88_Beta_acquisition[\\/]saved-Notice-periods\.docx$/.test(w.file), w.file)
  assert.ok(isPdf(saved.exportItem(a.id, 'pdf').data))
  assert.match(Buffer.from(saved.exportItem(a.id, 'md').data, 'base64').toString(), /^# Notice periods/)
  const csv = Buffer.from(saved.exportList({ matterId, format: 'csv' }).data, 'base64').toString()
  assert.match(csv, /^﻿Kind,Title,Tags,Saved,Text/)
  assert.ok(csv.includes('Waiver'))

  const h = saved.handle('GET', '/api/saved', new URLSearchParams(`matterId=${matterId}&q=notice periods`))
  assert.strictEqual(h.status, 200)
  assert.strictEqual(h.json.items[0].id, a.id)
  assert.strictEqual(saved.handle('POST', '/api/saved/delete', null, { id: a.id }).status, 200)
  assert.strictEqual(saved.handle('POST', '/api/saved/delete', null, { id: a.id }).status, 400)
  assert.strictEqual(saved.handle('GET', '/api/other', null), null)
})

// ── /investigate ─────────────────────────────────────────────────────────
test('investigate: per document on the batch machinery, quotes checked, law looked up, compared, and the check removes what the quotes do not support', async () => {
  const batch = require('../src/batch')
  const inv = require('../src/investigate')
  assert.deepStrictEqual(inv.questionFor('haftung', 'de'), { question: inv.PRESETS.liability.de, preset: 'liability' })
  const est = await batch.estimate({ folder: dir, matterId, kind: 'investigate' })
  assert.strictEqual(est.documents, 2)
  await assert.rejects(batch.start({ folder: dir, matterId, kind: 'investigate', options: {} }), /Ask a question/)

  const r = await batch.handle('POST', '/api/batch/start', null, { folder: dir, matterId, kind: 'investigate', options: { question: 'liability' }, sessionId: 'app:inv:1', message: '/investigate liability' })
  assert.strictEqual(r.status, 200, JSON.stringify(r.json))
  const job = await batch.settle(r.json.batch.id)
  assert.strictEqual(job.state, 'done', job.note)
  assert.strictEqual(job.result.kind, 'investigation')
  assert.strictEqual(job.options.question, inv.PRESETS.liability.en, 'a preset word becomes its question')
  const x = inv.get(job.result.id)
  assert.strictEqual(x.documents.length, 2)
  const lease = x.documents.find((d) => d.name === 'lease.txt')
  assert.deepStrictEqual(lease.findings.map((f) => f.title), ['Unlimited tenant liability', 'Landlord may terminate early'])
  assert.strictEqual(lease.stats.dropped, 1, 'the invented clause is dropped')
  assert.strictEqual(lease.findings[0].location.text, '§ 4 Liability')
  assert.strictEqual(lease.findings[0].sources[0].title, 'ABGB')
  assert.ok(lawCalls.includes('Haftung Mieter Verschulden'))
  assert.match(x.comparison.answer, /unlimited liability/)
  assert.deepStrictEqual(x.comparison.conflicts.map((c) => c.topic), ['Liability'], 'the unsupported statement is removed')
  assert.deepStrictEqual(x.comparison.conflicts[0].documents, ['lease.txt', 'supply.txt'])
  assert.strictEqual(x.removed.length, 1)
  assert.match(x.removed[0].note, /insurance/)
  assert.strictEqual(x.stats.removed, 1)

  // Exports and the conversation.
  for (const f of ['docx', 'pdf', 'csv', 'md']) {
    const e = inv.handle('POST', '/api/investigation/export', null, { id: x.id, format: f })
    assert.strictEqual(e.status, 200, f)
    if (f === 'docx') assert.ok(isDocx(e.json.data))
    if (f === 'pdf') assert.ok(isPdf(e.json.data))
    if (f === 'csv') assert.match(Buffer.from(e.json.data, 'base64').toString(), /lease\.txt,risk,high,Unlimited tenant liability/)
    if (f === 'md') assert.match(Buffer.from(e.json.data, 'base64').toString(), /Removed by the check/)
  }
  const conv = require('../src/session').read('app:inv:1')
  assert.deepStrictEqual(conv.messages[1].results, [{ kind: 'batch', id: job.id, name: 'investigate' }])
  assert.strictEqual(inv.handle('GET', '/api/investigation', new URLSearchParams(`id=${x.id}`)).json.investigation.id, x.id)
})

test('investigate: a long document is scanned first — only the sections that matter are read', async () => {
  const batch = require('../src/batch')
  const settings = require('../src/providers/settings')
  // A small model window: the document is longer than one part.
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', ctx: 4096 } })
  const filler = Array.from({ length: 40 }, (_, i) => `§ ${i + 10} Boilerplate ${i}\nThis clause is about notices and general matters number ${i}. `.repeat(4)).join('\n\n')
  const f = path.join(dir, 'long', 'long-lease.txt')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, `${LEASE}\n\n${filler}`)
  const before = seen.length
  const job = await batch.settle((await batch.start({ files: [f], matterId, kind: 'investigate', options: { question: 'Who is liable?' } })).id)
  assert.strictEqual(job.state, 'done', job.note)
  const scan = seen.slice(before).find((p) => p.includes('Select the sections that are relevant'))
  assert.ok(scan, 'the outline was scanned')
  const reads = seen.slice(before).filter((p) => p.includes('Find everything in this text'))
  assert.ok(reads.every((p) => !p.includes('Boilerplate 30')), 'unselected sections are not read')
  const d = require('../src/investigate').get(job.result.id).documents[0]
  assert.ok(d.scan && d.stats.selected === 2 && d.stats.sections > 10, JSON.stringify(d.stats))
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', ctx: null } })
  fs.rmSync(path.dirname(f), { recursive: true, force: true })
})

// ── /diligence ───────────────────────────────────────────────────────────
test('diligence: data room → review grid per document, quoted red flags in tiers, change of control always flagged, what is missing, exports', async () => {
  const batch = require('../src/batch')
  const dd = require('../src/diligence')
  assert.deepStrictEqual(dd.optionsFor('seller asset'), { perspective: 'seller', dealType: 'asset_purchase' })
  const att = await require('../src/attachments').add({ name: 'supply.txt', buffer: Buffer.from(SUPPLY), matterId })
  const job0 = await batch.start({ files: [path.join(dir, 'lease.txt')], attachments: [att.id], matterId, kind: 'diligence', options: dd.optionsFor('buyer share') })
  const job = await batch.settle(job0.id)
  assert.strictEqual(job.state, 'done', job.note)
  const x = dd.get(job.result.id)
  assert.strictEqual(x.documents.length, 2)
  const lease = x.documents.find((d) => d.name === 'lease.txt')
  const supply = x.documents.find((d) => d.name === 'supply.txt')
  assert.strictEqual(lease.docType, 'real estate')
  assert.strictEqual(lease.row.change_of_control.value, 'Yes')
  assert.ok(lease.flags.some((f) => f.title === 'Change-of-control clause' && f.tier === 'price_affecting' && f.from === 'grid'), 'change of control from the grid')
  assert.deepStrictEqual(supply.flags.map((f) => f.title), ['Liability cap too low'], 'the invented deal breaker is dropped')
  assert.strictEqual(x.byTier.deal_breaker, 0)
  assert.strictEqual(x.byTier.price_affecting, 2)
  assert.ok(x.missing.includes('financial statement') && !x.missing.includes('real estate'))
  assert.strictEqual(x.overview.readiness, 'conditional')
  // The grid is a normal review grid (the Grid page shows it), with attachment names.
  const g = require('../src/grid').view(x.gridId)
  assert.deepStrictEqual(g.rows.map((r) => r.name).sort(), ['lease.txt', 'supply.txt'])
  for (const f of ['xlsx', 'csv', 'docx', 'pdf']) {
    const e = dd.handle('POST', '/api/diligence/export', null, { id: x.id, format: f })
    assert.strictEqual(e.status, 200, f)
    const buf = Buffer.from(e.json.data, 'base64')
    if (f === 'xlsx' || f === 'docx') assert.strictEqual(buf.slice(0, 2).toString(), 'PK')
    if (f === 'xlsx') assert.ok(buf.includes(Buffer.from('xl/worksheets/sheet3.xml')), 'red flags, grid and sources')
    if (f === 'csv') assert.match(buf.toString(), /Price-affecting,financial,supply\.txt,Liability cap too low/)
    if (f === 'pdf') assert.ok(isPdf(e.json.data))
  }
  assert.match(dd.brief(x), /2 red flags|3 red flags/)
})

// ── /draft (the old Workshop) ────────────────────────────────────────────
test('draft: written from instructions, a document becomes a draft, fill-ins, revise a passage, suggestions, a law check, versions, exports', async () => {
  const draft = require('../src/draft')
  const d = await draft.create({ matterId, instruction: 'a mutual NDA, Austrian law', sessionId: 'app:draft:1' })
  assert.match(draft.current(d), /^# NON-DISCLOSURE AGREEMENT/)
  assert.strictEqual(d.title, 'NON-DISCLOSURE AGREEMENT')
  assert.strictEqual(require('../src/session').read('app:draft:1').messages[1].results[0].kind, 'draft')
  await assert.rejects(draft.create({ matterId }), /Say what to draft/)

  const r = await draft.revise(d.id, { instruction: 'make it three years', section: 'This agreement runs for two years.' })
  assert.strictEqual(r.after, 'This agreement runs for three years.')
  assert.match(draft.current(r.draft), /three years/)
  assert.strictEqual(r.draft.versions.length, 2)
  await assert.rejects(draft.revise(d.id, { instruction: 'x', section: 'not in the draft at all' }), /not in the current version/)
  const back = draft.restore(d.id, { n: 1 })
  assert.match(draft.current(back), /two years/)
  assert.strictEqual(back.versions.length, 3)

  assert.deepStrictEqual((await draft.suggest(d.id, {})).suggestions, ['Add a return-or-destroy clause', 'Name the governing law'])
  const c = await draft.check(d.id, { section: 'This agreement runs for two years.', jurisdiction: 'AT' })
  assert.strictEqual(c.check.status, 'supported')
  assert.strictEqual(c.check.query, 'Vertraulichkeit Dauer')
  assert.strictEqual(c.check.sources[0].title, 'ABGB')
  assert.strictEqual(c.check.judge.unlawful, false)

  // A document attached without instructions becomes the draft: fill-ins found and replaced.
  const att = await require('../src/attachments').add({ name: 'lease.txt', buffer: Buffer.from(LEASE), matterId })
  const t = await draft.create({ matterId, attachments: [att.id] })
  assert.strictEqual(t.title, 'lease')
  const v = await draft.variables(t.id)
  const values = v.variables.map((x) => x.value)
  assert.ok(values.includes('Alpha Immobilien GmbH') && values.includes('EUR 4,000'))
  assert.ok(!values.includes('Not In The Text Ltd'), 'values not in the text are dropped')
  const filled = draft.fill(t.id, { values: { 'Alpha Immobilien GmbH': '[LANDLORD]', 'EUR 4,000': 'EUR [RENT]' } })
  assert.match(draft.current(filled), /Between \[LANDLORD\] \(the Landlord\)/)
  assert.match(draft.current(filled), /The rent is EUR \[RENT\] per month/)
  assert.match(filled.versions[1].note, /2 fill-ins replaced/)
  assert.throws(() => draft.fill(t.id, { values: {} }), /nothing to fill in/)

  for (const f of ['docx', 'pdf', 'md']) {
    const e = await draft.handle('POST', '/api/draft/export', null, { id: d.id, format: f })
    assert.strictEqual(e.status, 200, f)
    if (f === 'docx') { assert.ok(isDocx(e.json.data)); assert.match(e.json.name, /^draft-NON-DISCLOSURE-AGREEMENT\.docx$/) }
    if (f === 'pdf') assert.ok(isPdf(e.json.data))
  }
  const docx = draft.toDocx(d).toString('latin1')
  assert.ok(docx.length > 500)
  assert.strictEqual((await draft.handle('GET', '/api/drafts', new URLSearchParams(`matterId=${matterId}`))).json.drafts.length, 2)
})

// ── the app's search ─────────────────────────────────────────────────────
test('search: matters, conversations, saved items, drafts, documents and commands in one call', () => {
  const find = require('../src/find')
  new (require('../src/session').Session)('app:find:1').append('Who pays the landlord rent?', 'Beta does.', { matterId, client: 'app' })
  require('../src/saved').add({ matterId, kind: 'clause', title: 'Rent escalation clause', content: 'The rent rises with the CPI.' })
  const r = find.handle('GET', '/api/find', new URLSearchParams(`q=rent&matterId=${matterId}`)).json
  const kinds = r.groups.map((g) => g.kind)
  for (const k of ['conversation', 'saved']) assert.ok(kinds.includes(k), `${k} in ${kinds}`)
  assert.strictEqual(r.groups.find((g) => g.kind === 'conversation').items[0].target.sessionId, 'app_find_1')
  const m = find.find({ q: 'beta acquisition' }).groups.find((g) => g.kind === 'matter')
  assert.strictEqual(m.items[0].id, matterId)
  const cmd = find.find({ q: 'diligence', lang: 'de' }).groups.find((g) => g.kind === 'command')
  assert.match(cmd.items[0].detail, /Datenraum/)
  const dr = find.find({ q: 'disclosure' }).groups.find((g) => g.kind === 'draft')
  assert.ok(dr && dr.items.length >= 1)
  assert.deepStrictEqual(find.find({ q: '' }).groups, [])
})

test('server and app: the routes exist and the app may call them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8')
  for (const m of ['./find', './saved', './investigate', './diligence', './draft']) assert.ok(src.includes(`require('${m}')`), m)
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'electron', 'main', 'main.js'), 'utf8')
  const allowed = new RegExp(main.match(/const ENGINE_PATHS = \/(.+)\/\r?\n/)[1])
  for (const p of ['/api/saved?matterId=m_1', '/api/saved', '/api/saved/update', '/api/saved/delete', '/api/saved/export', '/api/investigation?id=inv_1', '/api/investigation/export', '/api/investigate/presets', '/api/diligence?id=dd_1', '/api/diligence/export', '/api/draft', '/api/draft?id=dr_1', '/api/drafts?matterId=m_1', '/api/draft/revise', '/api/draft/variables', '/api/draft/fill', '/api/draft/suggest', '/api/draft/check', '/api/draft/edit', '/api/draft/restore', '/api/draft/export', '/api/find?q=x']) assert.ok(allowed.test(p), `the app may call ${p}`)
  const hub = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'electron', 'main', 'hub-client.js'), 'utf8')
  assert.match(hub, /draft/, 'model calls for drafts get a long timeout')
})
