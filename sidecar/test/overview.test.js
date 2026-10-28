"use strict"
/**
 * Matter overview, recall and the matter memo (overview.js), plus the CLI
 * commands that show them (`openlex matters show`, `recall`, `matters
 * export`, `analyse`).
 *
 *   node --test test/overview.test.js
 *
 * Offline: fixtures for everything the engine stores about a matter, a fake
 * model for the optional recall summary and `openlex analyse`, and a small
 * in-process engine (same route handlers as server.js) for the CLI.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFile } = require('child_process')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-ov-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'
const NOW = new Date('2026-10-29T12:00:00Z')

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n')
    let reply = '[]'
    if (prompt.includes('recall what is already known')) reply = 'The client wants a liability cap of EUR 1m [1].'
    else if (prompt.includes('Analyse this document')) {
      reply = JSON.stringify({
        summary: { what: 'Short NDA.', parties: [], purpose: 'Confidentiality.' },
        risks: [{ title: 'No term limit', level: 'high', why: 'Confidentiality never ends.', fix: 'Limit it to five years.', quote: 'The obligations apply without time limit', location: '§ 4' }],
      })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  })
})

let ov, ws, wf, matters, policy, m, folder, engine
const analysisFixture = (over) => ({
  version: 1,
  kind: 'analysis',
  createdAt: '2026-10-20T10:00:00.000Z',
  matterId: null,
  document: { name: 'supply.docx', language: 'en', languageName: 'English' },
  summary: { what: 'Supply agreement for machine parts.', parties: [{ name: 'Acme GmbH', role: 'buyer' }], purpose: 'Monthly deliveries.' },
  keyTerms: [{ term: 'Price', value: 'EUR 10,000 per delivery', quote: 'The price is EUR 10,000 per delivery', location: { text: '§ 3' } }],
  deadlines: [
    { date: '2026-11-15', when: '15 November 2026', what: 'Notice of non-renewal', importance: 'high', quote: 'notice by 15 November 2026', location: { text: '§ 4' } },
    { date: '2026-01-10', when: '10 January 2026', what: 'Signing', importance: 'low', quote: 'signed on 10 January 2026', location: { text: '§ 14' } },
    { date: null, when: '30 days after invoice', what: 'Payment', importance: 'medium', quote: 'within 30 days after invoice', location: { text: '§ 3' } },
  ],
  obligations: [{ party: 'Supplier', duty: 'Deliver every month.', quote: 'The Supplier delivers monthly', location: { text: '§ 2' } }],
  risks: [
    { id: 'R1', title: 'Liability cap missing', level: 'high', why: 'The supplier’s liability is not capped.', fix: 'Add a cap at the annual contract value.', fixCheck: 'checked', quote: 'The Supplier is liable for all damages', location: { text: '§ 9' }, sources: [{ kind: 'law', title: 'ABGB', section: '§ 1295', snippet: 'Schadenersatz' }] },
    { id: 'R2', title: 'Exclusivity for ten years', level: 'medium', why: 'Long lock-in.', fix: 'Shorten to three years.', fixCheck: 'corrected', quote: 'exclusive supplier for ten years', location: { text: '§ 6' }, sources: [] },
    { id: 'R3', title: 'Automatic renewal', level: 'low', why: 'Renews unless cancelled.', fix: '', fixCheck: 'removed', quote: 'renews automatically', location: { text: '§ 4' }, sources: [] },
  ],
  clauses: [{ title: 'Force majeure', kind: 'missing', note: 'No force majeure clause.', quote: '', location: { text: '' } }],
  stats: { verified: 8, dropped: 1, high: 1, medium: 1, low: 1 },
  ...over,
})

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
  ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'workspace'))
  wf = require('../src/workflows')
  matters = require('../src/matters')
  ov = require('../src/overview')

  m = matters.create({ title: 'Acme supply', number: '2026-040', client: 'Acme GmbH' })
  folder = ws.matterFolder(wf.matterLabel(m.id))
  // Analyses: a current one and an old one with the same risk (recency).
  ws.writeFile(`${folder}/analysis-supply.json`, JSON.stringify(analysisFixture({ matterId: m.id })))
  ws.writeFile(`${folder}/analysis-old-draft.json`, JSON.stringify(analysisFixture({ matterId: m.id, createdAt: '2025-01-05T10:00:00.000Z', document: { name: 'old-draft.docx', language: 'en' }, deadlines: [], clauses: [], risks: [{ id: 'R1', title: 'Liability cap missing', level: 'high', why: 'Old draft.', fix: '', fixCheck: 'checked', quote: 'liable for all damages', location: { text: '§ 8' }, sources: [] }] })))
  // Latest review + chronology (older ones are ignored).
  ws.writeFile(`${folder}/review-2026-10-01.csv`, 'document,check,risk,answer,quote,location\n"x.docx","termination","high","An older review finding.","q","§ 1"')
  ws.writeFile(`${folder}/review-2026-10-21.csv`, 'document,check,risk,answer,quote,location\n"lease.txt","termination","high","Either party may terminate with three months notice.","Either party may terminate this lease","§ 7"\n"supply.docx","governing_law","low","Austrian law applies.","governed by Austrian law","§ 12"')
  ws.writeFile(`${folder}/chronology-2026-10-22.csv`, 'date,event,document,quote\n"2025-11-15","Supply agreement signed","supply.docx","Signed in Vienna on 15 November 2025"\n"2026-12-01","Price review","supply.docx","prices are reviewed on 1 December 2026"')
  // A checklist: overdue, upcoming, blocked, done.
  const lists = require('../src/lists')
  const l = lists.create({ matterId: m.id, title: 'Closing', items: [{ text: 'Board consent', due: '2026-10-25' }, { text: 'Escrow agreement', due: '2026-11-05' }, { text: 'Get the signed NDA', status: 'blocked' }, { text: 'Send draft to client' }] })
  lists.updateItem(l.id, l.items[3].id, { status: 'done' }, 'anna')
  // A plan with an approval, a decision and a waiting checkpoint.
  const plans = require('../src/plan')
  fs.mkdirSync(plans.PLAN_DIR, { recursive: true })
  fs.writeFileSync(path.join(plans.PLAN_DIR, 'p1.json'), JSON.stringify({
    id: 'p1', matterId: m.id, goal: 'Prepare the closing', status: 'waiting', approvedAt: '2026-10-23T09:00:00.000Z', updatedAt: '2026-10-24T11:00:00.000Z',
    steps: [
      { id: 's1', kind: 'checkpoint', title: 'Scope', args: { question: 'Proceed with the share deal?' }, status: 'done', decision: { decision: 'continue', note: 'client agreed', at: '2026-10-24T10:00:00.000Z' } },
      { id: 's2', kind: 'checkpoint', title: 'Cap', args: { question: 'Accept a liability cap of EUR 1m?' }, status: 'waiting' },
    ],
  }))
  // A grid answer, a note, a conversation, notes.md, a saved web page, the usage log.
  const grid = require('../src/grid')
  const g = grid.create({ matterId: m.id, title: 'Supply grid', columns: [{ label: 'Liability cap', prompt: 'Is liability capped?' }], documents: [path.join(DATA, 'supply.docx')] })
  grid.setCell(g.id, { document: 'supply.docx', column: g.columns[0].id, value: 'No cap' })
  matters.bindDoc(m.id, 'word-1', 'Supply.docx')
  new (require('../src/memory').DocMemory)('word-1').addFact('Client', 'wants a liability cap of EUR 1m', '9')
  new (require('../src/session').Session)('word-1').append('What does § 4 say about renewal?', 'It renews automatically for one year.')
  ws.writeFile(`${folder}/notes.md`, '# Notes\n\n- Call the client about the cap\n- Partner in charge: Dr. Berg\n')
  ws.writeFile(`${folder}/web/2026-10-26 MRG/provenance.json`, JSON.stringify({ url: 'https://www.ris.bka.gv.at/mrg', finalUrl: 'https://www.ris.bka.gv.at/mrg', title: 'MRG § 30', fetchedAt: '2026-10-26T08:00:00.000Z' }))
  policy.audit({ provider: 'openai', model: 'gpt-test', matter: m.id, call: 'chat', decision: 'allowed' })
  policy.audit({ provider: 'openai', model: 'gpt-test', matter: m.id, call: 'chat', decision: 'allowed' })
  policy.audit({ provider: 'web', model: 'data.bka.gv.at', matter: m.id, call: 'search_ris', decision: 'blocked', reason: 'not allowed' })
  policy.audit({ provider: 'openai', model: 'gpt-test', matter: 'm_other', call: 'chat', decision: 'allowed' })
})
test.after(() => { fake.close(); engine?.close(); require('../src/analysis').setLawSources({}); fs.rmSync(DATA, { recursive: true, force: true }) })

const titles = (card) => card.items.map((x) => x.title)

test('overview: readable cards from what is stored, each item with its origin and date', () => {
  const o = ov.overview(m.id, { now: NOW })
  assert.deepStrictEqual(o.cards.map((c) => c.title), ['Summary', 'Documents', 'Key findings and risks', 'Deadlines', 'Decisions and approvals', 'Open questions', 'Notes', 'Sources used', 'Recent activity'])
  const card = Object.fromEntries(o.cards.map((c) => [c.id, c]))
  for (const c of o.cards) for (const x of c.items) assert.ok(x.from && (x.from.label || x.from.kind), `${c.id}: "${x.title}" has an origin`)

  assert.match(titles(card.summary)[0], /^2026-040 · Acme supply — client: Acme GmbH$/)
  assert.ok(titles(card.summary).includes('Data rules: may use openai; no web access.'))
  assert.ok(titles(card.summary).includes('supply.docx: Supply agreement for machine parts.'))

  assert.deepStrictEqual(titles(card.documents), ['old-draft.docx', 'supply.docx', 'Supply.docx'])

  // Findings: high first; the latest review only; low review findings stay out of the overview.
  const f = card.findings.items
  assert.deepStrictEqual(f.map((x) => x.level), ['high', 'high', 'high', 'medium', 'low'])
  assert.ok(titles(card.findings).includes('lease.txt: Either party may terminate with three months notice.'))
  assert.ok(!titles(card.findings).some((t) => /older review|Austrian law applies/.test(t)))
  const cap = f.find((x) => x.title === 'Liability cap missing' && x.from.document === 'supply.docx')
  assert.strictEqual(cap.quote, 'The Supplier is liable for all damages')
  assert.strictEqual(cap.location, '§ 9')
  assert.strictEqual(cap.from.label, 'Analysis of supply.docx')
  assert.match(cap.from.file, /analysis-supply\.md$/)

  // Deadlines, next first: overdue open items, then upcoming dates, then periods; past dates left out.
  assert.deepStrictEqual(card.deadlines.items.map((x) => [x.date || null, x.title, !!x.overdue]), [
    ['2026-10-25', 'Board consent', true],
    ['2026-11-05', 'Escrow agreement', false],
    ['2026-11-15', 'Notice of non-renewal', false],
    ['2026-12-01', 'Price review', false],
    [null, 'Payment', false],
  ])

  assert.deepStrictEqual(titles(card.decisions).filter((t) => !t.startsWith('Done:')), ['Continued at: Proceed with the share deal?', 'Plan approved: Prepare the closing'])
  assert.ok(titles(card.decisions).includes('Done: Send draft to client'))
  assert.match(card.decisions.items.find((x) => x.title.startsWith('Done:')).detail, /anna/)

  const q = titles(card.questions)
  for (const want of ['Accept a liability cap of EUR 1m?', 'Get the signed NDA', 'Is there really no Force majeure clause?', 'How to handle: Automatic renewal?']) assert.ok(q.includes(want), want)

  assert.ok(titles(card.notes).includes('Client: wants a liability cap of EUR 1m'))
  assert.ok(titles(card.notes).includes('Call the client about the cap'))
  assert.ok(titles(card.sources).includes('ABGB § 1295'))
  assert.ok(titles(card.sources).includes('MRG § 30'))

  const act = card.activity.items
  assert.ok(act.some((x) => x.title === '2 requests to openai'))
  assert.ok(act.some((x) => x.title === 'Blocked by the data rules: 1 request to web (data.bka.gv.at)'))
  assert.ok(act.some((x) => x.title === 'Asked: What does § 4 say about renewal?'))
  const ats = act.map((x) => x.at)
  assert.deepStrictEqual(ats, [...ats].sort().reverse(), 'newest first')
  assert.ok(!JSON.stringify(o).includes('m_other'), 'only this matter')

  const text = ov.toText(o)
  assert.match(text, /KEY FINDINGS AND RISKS\n {2}• \[high\] /)
  assert.match(text, /\n {2}• \[high\] Liability cap missing \(§ 9\)\n/)
  assert.match(text, /from Analysis of supply\.docx · 20 Oct 2026\n/)
  assert.match(text, /\[overdue\] 25 Oct 2026 — Board consent/)
})

test('recall: keyword + recency ranking across everything stored, with origins', () => {
  const r = ov.recall(m.id, 'liability cap', { now: NOW })
  assert.ok(r.total >= 5)
  const fold = (h) => `${h.title} ${h.detail || ''} ${h.quote || ''}`.toLowerCase()
  for (const h of r.hits.slice(0, 4)) assert.ok(fold(h).includes('liability cap'), `top hits contain the phrase: ${h.title}`)
  const newer = r.hits.findIndex((h) => h.title === 'Liability cap missing' && h.from.document === 'supply.docx')
  const older = r.hits.findIndex((h) => h.title === 'Liability cap missing' && h.from.document === 'old-draft.docx')
  assert.ok(newer >= 0 && older > newer, 'the same finding from a newer analysis ranks first')
  const scores = r.hits.map((h) => h.score)
  assert.deepStrictEqual(scores, [...scores].sort((a, b) => b - a))
  // Details that the overview cards leave out are found too: grid answers, key terms, conversations.
  assert.ok(ov.recall(m.id, 'no cap', { now: NOW }).hits.some((h) => h.from.label === 'Grid "Supply grid"'))
  assert.strictEqual(ov.recall(m.id, 'price per delivery', { now: NOW }).hits[0].cardTitle, 'Details from the documents')
  assert.ok(ov.recall(m.id, 'renewal', { now: NOW }).hits.some((h) => h.cardTitle === 'Conversations'))
  assert.strictEqual(ov.recall(m.id, 'zebra crossing', { now: NOW }).total, 0)
  assert.throws(() => ov.recall(m.id, '  '), /what should OpenLex look for/)
})

test('recall summary: only when asked, from the hits only, under the data rules', async () => {
  const plain = await ov.handle('GET', '/api/matters/recall', new URLSearchParams({ id: m.id, q: 'liability cap' }))
  assert.strictEqual(plain.status, 200)
  assert.strictEqual(plain.json.summary, undefined, 'no model call unless requested')
  const r = await ov.handle('GET', '/api/matters/recall', new URLSearchParams({ id: m.id, q: 'liability cap', summary: '1', format: 'text' }))
  assert.strictEqual(r.json.summary, 'The client wants a liability cap of EUR 1m [1].')
  assert.match(r.json.summaryNote, /from the \d+ results below only/)
  assert.match(r.json.text, /^\d+ results for "liability cap" in Acme supply/)
  const priv = matters.create({ title: 'Secret', privileged: true })
  ws.writeFile(`${ws.matterFolder(wf.matterLabel(priv.id))}/notes.md`, '- the liability cap is confidential\n')
  const p = await ov.handle('GET', '/api/matters/recall', new URLSearchParams({ id: priv.id, q: 'liability cap', summary: '1' }))
  assert.strictEqual(p.json.hits.length, 1, 'the hits still come back')
  assert.match(p.json.summaryError, /data policy|local-only/)
  assert.strictEqual(p.json.summary, undefined)
})

test('export: matter memo as docx, pdf and md in the matter folder', async () => {
  for (const format of ['docx', 'pdf', 'md']) {
    const r = await ov.handle('POST', '/api/matters/overview/export', null, { id: m.id, format })
    assert.strictEqual(r.status, 200, JSON.stringify(r.json))
    assert.match(r.json.file, new RegExp(`2026-040_Acme_supply/matter-memo-\\d{4}-\\d{2}-\\d{2}\\.${format}$`))
    assert.ok(fs.statSync(r.json.file).size > 200)
  }
  const dir = ws.resolve(folder)
  const memo = (ext) => path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith('matter-memo-') && f.endsWith(ext)))
  const docx = require('../src/docx_text').docxText(memo('.docx'))
  assert.match(docx, /Key findings and risks/)
  assert.match(docx, /Liability cap missing/)
  assert.match(docx, /from Analysis of supply\.docx/)
  assert.strictEqual(fs.readFileSync(memo('.pdf')).subarray(0, 5).toString(), '%PDF-')
  const md = fs.readFileSync(memo('.md'), 'utf8')
  assert.match(md, /^# Matter memo — 2026-040 · Acme supply/)
  assert.match(md, /## Deadlines\n\n- \*\*\[overdue\] 25 Oct 2026 — Board consent\*\*/)
  assert.strictEqual((await ov.handle('POST', '/api/matters/overview/export', null, { id: m.id, format: 'xls' })).status, 400)
  assert.strictEqual((await ov.handle('GET', '/api/matters/overview', new URLSearchParams({ id: 'm_nope' }))).status, 404)
  assert.strictEqual(await ov.handle('GET', '/api/matters', new URLSearchParams()), null, 'other paths are left to the server')
})

// ── CLI ──────────────────────────────────────────────────────────────────
// A small engine with the same handlers server.js uses for these routes.
function startEngine() {
  const an = require('../src/analysis')
  an.setLawSources({ local: async () => [], web: async () => [] })
  engine = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      const url = new URL(req.url, 'http://localhost')
      const body = raw ? JSON.parse(raw) : {}
      const r = await ov.handle(req.method, url.pathname, url.searchParams, body)
      if (r) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r.json)) }
      if (url.pathname === '/api/workflows/run' && body.type === 'analyse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`)
        try {
          const out = await policy.withMatter(body.matterId, () => an.runAnalyse({ matterId: body.matterId, files: body.files, onProgress: (ev) => send({ type: 'progress', ...ev }) }))
          send({ type: 'done', files: out.files, stats: out.stats, count: out.count, summary: out.summary })
        } catch (err) { send({ type: 'error', message: err.message }) }
        return res.end()
      }
      res.writeHead(404); res.end('{}')
    })
  })
  return new Promise((resolve) => engine.listen(0, '127.0.0.1', () => {
    fs.mkdirSync(path.join(DATA, 'run'), { recursive: true })
    fs.writeFileSync(path.join(DATA, 'run', 'sidecar.json'), JSON.stringify({ url: `http://127.0.0.1:${engine.address().port}`, pid: process.pid, version: 'test' }))
    resolve()
  }))
}

function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, '..', 'bin', 'openlex.js'), ...args], { env: { ...process.env, LEXVAULT_DATA_DIR: DATA, OPENLEX_DATA_DIR: DATA }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }))
  })
}

test('CLI: matters show, recall, matters export, analyse', async () => {
  await startEngine()
  const show = await cli('matters', 'show', m.id)
  assert.strictEqual(show.code, 0, show.stderr)
  assert.match(show.stdout, /^2026-040 · Acme supply — client: Acme GmbH/)
  assert.match(show.stdout, /DEADLINES\n {2}• \[overdue\] 25 Oct 2026 — Board consent/)
  assert.match(show.stdout, /OPEN QUESTIONS/)

  const recall = await cli('recall', 'liability', 'cap', '--matter', m.id)
  assert.strictEqual(recall.code, 0, recall.stderr)
  assert.match(recall.stdout, /results for "liability cap" in Acme supply/)
  assert.match(recall.stdout, /• \[high\] Liability cap missing \(§ 9\)/)

  const exp = await cli('matters', 'export', m.id, '--format', 'md')
  assert.strictEqual(exp.code, 0, exp.stderr)
  assert.ok(fs.existsSync(exp.stdout.trim()), exp.stdout)

  const nda = path.join(DATA, 'nda.txt')
  fs.writeFileSync(nda, 'NON-DISCLOSURE AGREEMENT\n\n§ 4 Term\nThe obligations apply without time limit.')
  const run = await cli('analyse', nda, '--matter', m.id)
  assert.strictEqual(run.code, 0, run.stderr)
  assert.match(run.stdout, /nda\.txt: Short NDA\./)
  assert.match(run.stdout, /- \[high\] No term limit \(§ 4 Term\)/)
  assert.match(run.stdout, /analysis-nda\.docx/)
  assert.match((await cli('analyse')).stderr, /usage: openlex analyse/)
})
