"use strict"
/**
 * Document analysis workflow (analysis.js): verified findings, locations,
 * deadlines, risk ratings, targeted law search, the second check of fixes,
 * the document's language, and the three output files.
 *
 *   node --test test/analysis.test.js
 *
 * Offline: a fake OpenAI-compatible model answers with one invented quote
 * among genuine ones; law search is a fake that records its calls.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-an-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const LEASE = `LEASE AGREEMENT

This lease is made between Acme Properties GmbH (the Landlord) and Beta Consulting Ltd (the Tenant).

§ 1 Premises
The Landlord lets to the Tenant the office premises at Ringstrasse 1, Vienna.

§ 2 Term
The lease commences on 1 March 2027 and runs for five years.

§ 3 Rent
The monthly rent is EUR 4,500, payable in advance by the fifth working day of each month.

§ 7 Termination
The Landlord may terminate this lease at any time without cause by giving 14 days’ written notice.

§ 9 Liability
The Tenant shall be liable without limitation for all damage to the premises, including damage caused by third parties.

§ 12 Governing law
This lease is governed by Austrian law.

§ 13 Security
The Tenant must hand over a bank guarantee by 15 January 2027.`

const LEASE_REPLY = {
  summary: { what: 'Office lease for premises in Vienna.', parties: [{ name: 'Acme Properties GmbH', role: 'landlord' }, { name: 'Beta Consulting Ltd', role: 'tenant' }, { name: 'Gamma Invented AG', role: 'guarantor' }], purpose: 'Lease of office premises for five years.' },
  key_terms: [{ term: 'Rent', value: 'EUR 4,500 per month', quote: 'The monthly rent is EUR 4,500', location: '§ 3' }],
  dates: [
    { date: '', when: 'fifth working day of each month', what: 'Rent due', importance: 'medium', quote: 'payable in advance by the fifth working day of each month', location: '§ 3' },
    { date: '2027-03-10', when: '1 March 2027', what: 'Lease starts', importance: 'high', quote: 'The lease commences on 1 March 2027', location: '§ 2' },
    { date: '', when: '14 days', what: 'Landlord notice period', importance: 'high', quote: 'by giving 14 days\' written notice', location: '§ 7' },
    { date: '2027-01-15', when: '15 January 2027', what: 'Bank guarantee due', importance: 'high', quote: 'hand over a bank guarantee by 15 January 2027', location: '§ 13' },
  ],
  obligations: [
    { party: 'Tenant', duty: 'Pay the monthly rent in advance.', quote: 'The monthly rent is EUR 4,500, payable in advance', location: '§ 3' },
    { party: 'Landlord', duty: 'Let the office premises.', quote: 'The Landlord lets to the Tenant the office premises', location: '§ 1' },
  ],
  risks: [
    { title: 'Rent payable in advance', level: 'low', why: 'Cash-flow burden on the tenant.', fix: 'Agree payment in arrears.', law_query: '', quote: 'payable in advance by the fifth working day of each month', location: '§ 3' },
    { title: 'Penalty for late payment', level: 'high', why: 'Large penalty.', fix: 'Delete it.', law_query: 'Vertragsstrafe', quote: 'The Tenant pays a penalty of EUR 50,000 for late payment', location: '§ 4' },
    { title: 'Termination without cause', level: 'medium', why: 'The landlord can end the lease at short notice.', fix: 'Delete the right to terminate without cause.', law_query: 'Kündigung Mietvertrag MRG', quote: 'The Landlord may terminate this lease at any time without cause by giving 14 days’ written notice', location: '§ 7' },
    { title: 'Unlimited liability of the tenant', level: 'critical', why: 'The tenant carries all damage, even by third parties.', fix: 'Cap liability at one year’s rent and exclude damage caused by third parties.', law_query: 'Haftung Mieter Schadenersatz ABGB', quote: 'The Tenant shall be liable without limitation for all damage to the premises', location: '' },
  ],
  clauses: [
    { title: 'Governing law', kind: 'notable', note: 'Austrian law.', quote: 'This lease is governed by Austrian law', location: '§ 12' },
    { title: 'Rent indexation', kind: 'missing', note: 'No indexation clause.', quote: '', location: '' },
  ],
}

const MIETVERTRAG = `MIETVERTRAG

§ 1 Mietgegenstand
Der Vermieter vermietet dem Mieter die Wohnung in der Hauptstraße 5, Wien. Die Wohnung ist für den Mieter bestimmt und wird von ihm genutzt.

§ 5 Haftung
Der Mieter haftet unbeschränkt für alle Schäden an der Wohnung, die durch ihn oder Dritte entstehen.

§ 8 Kündigung
Die Kündigung ist bis zum 31.12.2027 schriftlich zu erklären.`

const DE_REPLY = {
  summary: { what: 'Mietvertrag über eine Wohnung in Wien.', parties: [], purpose: 'Vermietung einer Wohnung.' },
  dates: [{ date: '2027-12-31', when: '31.12.2027', what: 'Kündigungsfrist', importance: 'high', quote: 'Die Kündigung ist bis zum 31.12.2027 schriftlich zu erklären', location: '§ 8' }],
  risks: [{ title: 'Unbeschränkte Haftung', level: 'hoch', why: 'Der Mieter haftet auch für Dritte.', fix: 'Haftung auf Vorsatz und grobe Fahrlässigkeit beschränken.', law_query: 'Haftung Mieter ABGB', quote: 'Der Mieter haftet unbeschränkt für alle Schäden an der Wohnung', location: '§ 5' }],
}

const prompts = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const prompt = JSON.parse(raw).messages.map((m) => m.content).join('\n')
    prompts.push(prompt)
    let reply = '[]'
    if (prompt.includes('Analyse this document')) {
      if (prompt.includes('mietvertrag.txt')) reply = 'Hier ist das Ergebnis:\n```json\n' + JSON.stringify(DE_REPLY) + '\n```'
      else if (prompt.includes('long.txt')) reply = JSON.stringify({ risks: [] })
      else reply = '<think>reading</think>' + JSON.stringify(LEASE_REPLY)
    } else if (prompt.includes('CHECK THE SUGGESTED FIXES')) {
      // Judge: the fixes are listed high → medium → low.
      reply = prompt.includes('Unbeschränkte')
        ? '[{"i":0,"verdict":"ok"}]'
        : JSON.stringify([{ i: 0, verdict: 'ok', note: 'fine' }, { i: 1, verdict: 'revise', fix: 'Allow termination only for cause, with three months’ notice.', note: 'deleting it entirely is unrealistic' }, { i: 2, verdict: 'drop', note: 'payment in arrears is not a market position' }])
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  })
})

const docs = path.join(DATA, 'Lease docs')
const lawCalls = []
const webCalls = []
const sources = {
  local: async ({ query, jurisdiction, risk }) => { lawCalls.push({ query, jurisdiction, level: risk.level }); return [{ kind: 'law', title: 'ABGB', section: '§ 1295', snippet: 'Wer immer einen Schaden verschuldet …', ref: 'abgb-1295' }] },
  web: async ({ query, risk }) => { webCalls.push({ query, level: risk.level }); return [{ kind: 'ris', title: 'Mietrechtsgesetz', url: 'https://www.ris.bka.gv.at/x' }] },
}
let an, ws, matterId, policy
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
  ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'workspace'))
  fs.mkdirSync(docs)
  fs.writeFileSync(path.join(docs, 'lease.txt'), LEASE)
  fs.writeFileSync(path.join(docs, 'mietvertrag.txt'), MIETVERTRAG)
  const m = require('../src/matters').create({ title: 'Office lease', number: '2026-031' })
  matterId = m.id
  require('../src/library').addFolder(docs, m.id)
  an = require('../src/analysis')
})
test.after(() => { fake.close(); an.setLawSources({}); fs.rmSync(DATA, { recursive: true, force: true }) })

test('analysis: verified findings only, locations from the text, risks rated and sorted, law only for high/medium, fixes double-checked', async () => {
  const progress = []
  const r = await policy.withMatter(matterId, () => an.runAnalyse({ matterId, file: 'lease.txt', sources, onProgress: (p) => progress.push(p.step) }))
  const a = r.analyses[0]
  assert.strictEqual(a.document.language, 'en')
  assert.strictEqual(a.document.jurisdiction, 'AT', 'GmbH → Austrian law packs and RIS')

  // Quote verification: the invented penalty clause is dropped and counted.
  assert.strictEqual(a.stats.dropped, 1)
  assert.ok(!a.risks.some((x) => /penalty/i.test(x.title)))
  assert.deepStrictEqual(a.summary.parties.map((p) => p.name), ['Acme Properties GmbH', 'Beta Consulting Ltd'], 'a party that is not in the document is dropped')

  // Risk rating: "critical" → high; sorted high → medium → low; ids follow.
  assert.deepStrictEqual(a.risks.map((x) => [x.id, x.level, x.title]), [
    ['R1', 'high', 'Unlimited liability of the tenant'],
    ['R2', 'medium', 'Termination without cause'],
    ['R3', 'low', 'Rent payable in advance'],
  ])
  assert.strictEqual(a.risks[0].location.text, '§ 9 Liability', 'location computed from where the quote is, not from the model (it gave none)')
  assert.strictEqual(a.risks[1].location.text, '§ 7 Termination')

  // Law search: only the high and medium risk, with the model's statutory search words.
  assert.deepStrictEqual(lawCalls.map((c) => c.level), ['high', 'medium'])
  assert.strictEqual(lawCalls[0].query, 'Haftung Mieter Schadenersatz ABGB')
  assert.strictEqual(lawCalls[0].jurisdiction, 'AT')
  assert.deepStrictEqual(webCalls, [], 'web sources are off: the data rules do not allow web access')
  assert.strictEqual(a.risks[0].sources[0].title, 'ABGB')
  assert.deepStrictEqual(a.risks[2].sources, [], 'no law search for a low risk')
  assert.strictEqual(a.stats.lawSearches, 2)

  // Second check of the fixes: ok / revise / drop.
  assert.strictEqual(a.risks[0].fixCheck, 'checked')
  assert.strictEqual(a.risks[1].fixCheck, 'corrected')
  assert.match(a.risks[1].fix, /only for cause/)
  assert.strictEqual(a.risks[2].fixCheck, 'removed')
  assert.strictEqual(a.risks[2].fix, '')

  // Deadlines: dated first (next first), date taken from the quote, then periods by importance.
  assert.deepStrictEqual(a.deadlines.map((d) => [d.date, d.what]), [
    ['2027-01-15', 'Bank guarantee due'],
    ['2027-03-01', 'Lease starts'],
    [null, 'Landlord notice period'],
    [null, 'Rent due'],
  ], 'the misread 2027-03-10 is corrected from the quote')
  assert.strictEqual(a.deadlines[0].location.text, '§ 13 Security')

  assert.deepStrictEqual(a.obligations.map((o) => o.party), ['Landlord', 'Tenant'], 'in document order')
  assert.deepStrictEqual(a.clauses.map((c) => [c.kind, c.title]), [['notable', 'Governing law'], ['missing', 'Rent indexation']])
  assert.deepStrictEqual(progress.filter((s, i) => s !== progress[i - 1]), ['read', 'plan', 'analyse', 'verify', 'law', 'judge', 'write'])

  // Outputs in the matter folder.
  assert.strictEqual(r.files.length, 3)
  const md = fs.readFileSync(a.files.md, 'utf8')
  assert.match(a.files.md, /2026-031_Office_lease[\\/]analysis-lease\.md$/)
  assert.match(md, /### High risk — Unlimited liability of the tenant/)
  assert.match(md, /\*\*Where:\*\* § 9 Liability/)
  assert.match(md, /\*\*Law:\*\* ABGB § 1295/)
  assert.match(md, /corrected by a second pass/)
  assert.match(md, /No safe fix suggested/)
  assert.match(md, /\| 2027-01-15 \| Bank guarantee due/)
  assert.match(md, /Official online sources \(RIS, EUR-Lex\) were not searched/)
  assert.ok(!md.includes('50,000'), 'nothing from the dropped finding')
  const docx = require('../src/docx_text').docxText(a.files.docx)
  assert.match(docx, /Unlimited liability of the tenant/)
  assert.match(docx, /§ 9 Liability/)
  assert.match(docx, /ABGB § 1295/)
  const json = JSON.parse(fs.readFileSync(a.files.json, 'utf8'))
  assert.strictEqual(json.kind, 'analysis')
  assert.strictEqual(json.risks[0].location.pos, undefined, 'internal sort positions are not stored')
  assert.match(r.summary, /\[high\] Unlimited liability of the tenant \(§ 9 Liability\)/)
})

test('analysis follows the document language: German document → German prompts, German report', async () => {
  const before = prompts.length
  const r = await policy.withMatter(matterId, () => an.runAnalyse({ matterId, file: 'mietvertrag.txt', sources }))
  const a = r.analyses[0]
  assert.strictEqual(a.document.language, 'de')
  const sent = prompts.slice(before)
  assert.ok(sent.some((p) => p.includes('Write all your text in German')), 'the model is told to answer in German')
  assert.ok(sent.some((p) => p.includes('CHECK THE SUGGESTED FIXES') && p.includes('written in German')))
  assert.strictEqual(a.risks[0].level, 'high', '"hoch" is understood')
  assert.deepStrictEqual(a.deadlines.map((d) => d.date), ['2027-12-31'])
  const md = fs.readFileSync(a.files.md, 'utf8')
  assert.match(md, /^# Analyse: mietvertrag\.txt/)
  assert.match(md, /· Sprache: Deutsch ·/, 'the document language in the report\'s language, not "German"')
  assert.match(md, /## Risiken/)
  assert.match(md, /### Hohes Risiko — Unbeschränkte Haftung/)
  assert.match(md, /\*\*Fundstelle:\*\* § 5 Haftung/)
  assert.match(md, /## Fristen und Termine/)
})

test('web sources are searched only when the data rules allow web access', async () => {
  webCalls.length = 0
  const open = require('../src/matters').create({ title: 'Open matter' })
  require('../src/library').addFolder(docs, open.id)
  policy.setRule(open.id, { mode: 'allow-list', providers: ['openai', 'web'] })
  const r = await policy.withMatter(open.id, () => an.runAnalyse({ matterId: open.id, file: 'lease.txt', sources }))
  assert.deepStrictEqual(webCalls.map((c) => c.level), ['high', 'medium'])
  assert.ok(r.analyses[0].risks[0].sources.some((s) => s.kind === 'ris'))
  assert.ok(!fs.readFileSync(r.files[0], 'utf8').includes('were not searched'))
})

test('a privileged matter never reaches a cloud model', async () => {
  const priv = require('../src/matters').create({ title: 'Secret', privileged: true })
  require('../src/library').addFolder(docs, priv.id)
  await assert.rejects(policy.withMatter(priv.id, () => an.runAnalyse({ matterId: priv.id, file: 'lease.txt', sources })), /data policy|local-only/)
})

test('small context: the document is split into parts; one model call per part', async () => {
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', ctx: 4500 } })
  try {
    assert.strictEqual(an.partChars(matterId), 3000)
    fs.writeFileSync(path.join(docs, 'long.txt'), Array.from({ length: 30 }, (_, i) => `§ ${i + 1} Clause ${i + 1}. ${'The parties agree to the terms set out here. '.repeat(5)}`).join('\n\n'))
    const before = prompts.length
    const r = await policy.withMatter(matterId, () => an.runAnalyse({ matterId, file: path.join(docs, 'long.txt'), sources }))
    const parts = prompts.slice(before).filter((p) => p.includes('Analyse this document'))
    assert.ok(parts.length >= 3, `${parts.length} parts`)
    assert.strictEqual(r.analyses[0].stats.parts, parts.length)
    assert.match(parts[1], /\(part 2 of \d+\)/)
  } finally {
    settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', ctx: null } })
  }
})

test('the analyse_document tool and the /analyse skill run the same workflow on the open document', async () => {
  an.setLawSources(sources)
  const { Document } = require('../src/doc')
  const doc = new Document(LEASE, 'word-doc-1')
  require('../src/matters').bindDoc(matterId, 'word-doc-1', 'Lease (Word).docx')
  const r = await policy.withMatter(matterId, () => require('../src/tools').dispatch({ doc }, 'analyse_document', {}))
  assert.match(r.output, /Lease \(Word\)\.docx: Office lease/)
  assert.match(r.output, /analysis-Lease _Word_\.md/)
  const skill = require('../src/skills').get('analyse')
  assert.ok(skill.tools.includes('analyse_document'))
  assert.strictEqual(require('../src/skills').parseInvocation('/analyse focus on liability').skill.name, 'analyse')
  assert.strictEqual(require('../src/permissions').evaluate('analyse_document').decision, 'allow')
})

test('helpers: language detection, risk levels, JSON object from chatty replies, locations with pages', () => {
  assert.strictEqual(an.detectLanguage('Der Mieter haftet nicht für die Schäden, die durch den Vermieter entstehen.'), 'de')
  assert.strictEqual(an.detectLanguage('Le locataire est responsable des dommages causés par le bailleur.'), 'fr')
  assert.strictEqual(an.detectLanguage('The tenant shall be liable for any damage.'), 'en')
  assert.deepStrictEqual(['Critical', 'RED', 'amber', 'mittel', 'green', 'niedrig', '???'].map((x) => an.level(x)), ['high', 'high', 'medium', 'medium', 'low', 'low', 'medium'])
  assert.deepStrictEqual(an.firstObject('Sure! {"a": [1, {"b": "}"}]} trailing {"c": 2}'), { a: [1, { b: '}' }] })
  const text = '[Page 1]\nAGREEMENT\n\n4.2 Payment\nThe fee is due in 30 days.\n\n[Page 2]\nArticle 9\nNo liability for indirect damage.'
  assert.deepStrictEqual(an.locate(text, 'the fee is due in 30 days').section, '4.2 Payment')
  const loc = an.locate(text, 'No liability for indirect damage')
  assert.deepStrictEqual([loc.section, loc.page, loc.text], ['Article 9', 2, 'Article 9 · page 2'])
  assert.strictEqual(an.locate(text, 'not in the text at all'), null)
})
