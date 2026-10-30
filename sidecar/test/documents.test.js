"use strict"
/**
 * Documents in the chat (part 1 of moving the old app features onto the
 * engine): reading every format into text (read.js), the one size rule
 * (limits.js), attachments through the permissions broker
 * (attachments.js), the large-document strategy by model (strategy.js),
 * the memory setting for the local AI (local_memory.js), prompt caching of
 * a document read in full (providers), the full analysis (shape, exports
 * Word/PDF/CSV) and big batches with estimate, stop and resume (batch.js).
 *
 *   node --test test/documents.test.js
 *
 * Offline: fake OpenAI-compatible model, fake law search, no keys.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const zlib = require('zlib')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-docs-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'
delete process.env.OPENLEX_MAX_FILE_MB

const CONTRACT = `SERVICE AGREEMENT

This agreement is made between Alpha Software GmbH (the Provider) and Beta Retail AG (the Client).

§ 1 Services
The Provider shall operate the Client's online shop platform.

§ 2 Fees
The Client pays a monthly fee of EUR 12,000 within 30 days of invoice.

§ 3 Term
The agreement starts on 1 February 2027 and runs for three years.

§ 4 Liability
The Provider's liability is excluded in all cases, including gross negligence.

§ 5 Governing law
This agreement is governed by Austrian law.`

const REPLY = {
  summary: { type: 'IT service agreement', what: 'Agreement to operate an online shop.', parties: [{ name: 'Alpha Software GmbH', role: 'provider' }, { name: 'Beta Retail AG', role: 'client' }], purpose: 'Operation of the shop platform for three years.', key_points: ['Monthly fee of EUR 12,000', 'Three-year term', 'Liability fully excluded'], governing_law: 'Austrian law' },
  key_terms: [{ term: 'Fee', value: 'EUR 12,000 per month', quote: 'monthly fee of EUR 12,000', location: '§ 2' }],
  dates: [{ date: '2027-02-01', when: '1 February 2027', what: 'Start', importance: 'high', quote: 'The agreement starts on 1 February 2027', location: '§ 3' }],
  obligations: [{ party: 'Client', duty: 'Pay the monthly fee within 30 days.', quote: 'The Client pays a monthly fee of EUR 12,000 within 30 days of invoice', location: '§ 2' }],
  risks: [{ title: 'Liability excluded even for gross negligence', level: 'high', why: 'Such an exclusion is likely void and leaves the client unprotected.', fix: 'Exclude liability only for slight negligence.', law_query: 'Haftungsausschluss grobe Fahrlässigkeit', quote: "The Provider's liability is excluded in all cases, including gross negligence", location: '§ 4' }],
  clauses: [
    { title: 'Governing law', kind: 'notable', category: 'disputes', note: 'Austrian law.', quote: 'This agreement is governed by Austrian law', location: '§ 5' },
    { title: 'Data protection', kind: 'missing', importance: 'critical', note: 'No data processing terms.', quote: '' },
  ],
  glossary: [{ term: 'gross negligence', explanation: 'A serious failure of care.' }, { term: 'force majeure', explanation: 'Not in this document.' }],
}

const seen = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    seen.push(body)
    const prompt = body.messages.map((m) => m.content).join('\n')
    let reply = '[]'
    if (prompt.includes('Analyse this document')) reply = JSON.stringify(REPLY)
    else if (prompt.includes('CHECK THE SUGGESTED FIXES')) reply = '[{"i":0,"verdict":"ok"}]'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  })
})

const sources = { local: async () => [{ kind: 'law', title: 'ABGB', section: '§ 1295', snippet: 'Schadenersatz' }], web: async () => [] }
let matterId, policy, settings
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  policy = require('../src/policy')
  policy.setRule(null, { mode: 'allow-list', providers: ['openai'] })
  // The redaction check has its own tests (redaction.test.js).
  require('../src/redaction_check').setCheck(false)
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  matterId = require('../src/matters').create({ title: 'Shop contract', number: '2026-77' }).id
  require('../src/analysis').setLawSources(sources)
})
test.after(() => { fake.close(); require('../src/analysis').setLawSources({}); fs.rmSync(DATA, { recursive: true, force: true }) })

// ── reading every format ────────────────────────────────────────────────
function emlWith(docx) {
  const b = 'XYZ'
  return Buffer.from([
    'From: =?utf-8?B?' + Buffer.from('Anwältin Müller').toString('base64') + '?= <a@example.com>',
    'To: client@example.com', 'Subject: Draft agreement', 'Date: Mon, 2 Nov 2026 10:00:00 +0100',
    'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${b}"`, '',
    `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    'Please find the draft attached. Gr=C3=BC=C3=9Fe', '',
    `--${b}`, 'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="draft.docx"', 'Content-Disposition: attachment; filename="draft.docx"', 'Content-Transfer-Encoding: base64', '',
    docx.toString('base64').replace(/(.{76})/g, '$1\n'), `--${b}--`, '',
  ].join('\r\n'), 'utf8')
}

test('reading: Word, PDF, Excel, e-mail with an attachment, HTML, RTF, text — and plain refusals', async () => {
  const { readDocument } = require('../src/read')
  const { docxBuffer } = require('../src/docx_write')
  const docx = docxBuffer([{ text: 'SERVICE AGREEMENT', style: 'Title' }, { text: '§ 4 Liability' }, { text: 'The Provider is liable for gross negligence.' }])
  const w = await readDocument({ buffer: docx, name: 'agreement.docx' })
  assert.strictEqual(w.kind, 'word')
  assert.match(w.text, /§ 4 Liability\nThe Provider is liable for gross negligence\./)
  assert.ok(w.tokens > 5 && w.pages === 1)

  const pdf = require('../src/pdf').renderPdf([{ title: 'Lease', rows: [['§ 1', 'The rent is EUR 900 per month.']] }])
  const p = await readDocument({ buffer: pdf, name: 'lease.pdf' }, { ocr: false })
  assert.strictEqual(p.kind, 'pdf')
  assert.match(p.text, /\[Page 1\]/)
  assert.match(p.text, /rent is EUR 900/)
  assert.strictEqual(p.pages, 1)
  assert.strictEqual(p.ocrPages, 0)

  const xlsx = require('../src/xlsx_write').xlsxBuffer([{ name: 'Deadlines', rows: [['Date', 'What'], ['2027-01-15', 'Bank guarantee'], [42, 'Amount']] }])
  const x = await readDocument({ buffer: xlsx, name: 'deadlines.xlsx' })
  assert.strictEqual(x.kind, 'excel')
  assert.match(x.text, /=== Sheet: Deadlines ===\nDate\tWhat\n2027-01-15\tBank guarantee\n42\tAmount/)

  const e = await readDocument({ buffer: emlWith(docx), name: 'mail.eml' })
  assert.strictEqual(e.kind, 'email')
  assert.match(e.text, /From: Anwältin Müller/)
  assert.match(e.text, /Subject: Draft agreement/)
  assert.match(e.text, /Grüße/)
  assert.deepStrictEqual(e.attachments, ['draft.docx'])
  assert.match(e.text, /=== Attachment: draft\.docx ===\nSERVICE AGREEMENT/)

  const h = await readDocument({ buffer: Buffer.from('<html><head><style>x{}</style></head><body><h1>Title</h1><p>A &amp; B</p></body></html>'), name: 'page.html' })
  assert.strictEqual(h.text, 'Title\nA & B')
  const r = await readDocument({ buffer: Buffer.from('{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}\\f0 Haftung f\\\'fcr Sch\\\'e4den\\par Zeile 2}'), name: 'old.rtf' })
  assert.match(r.text, /Haftung für Schäden\nZeile 2/)
  const t = await readDocument({ buffer: Buffer.from('﻿# Notes\nplain'), name: 'notes.md' })
  assert.strictEqual(t.text, '# Notes\nplain')

  await assert.rejects(readDocument({ buffer: Buffer.from('x'), name: 'old.doc' }), /save it as \.docx/)
  await assert.rejects(readDocument({ buffer: Buffer.from([0, 1, 2, 3]), name: 'blob.txt' }), /cannot be read/)
  await assert.rejects(readDocument({ buffer: Buffer.from('x'), name: 'photo.png' }), /cannot be read/)
})

test('one size rule: ~100 MB by default, configurable, one plain sentence above it', async () => {
  const limits = require('../src/limits')
  assert.strictEqual(limits.maxFileMB(), 100)
  assert.match(limits.tooLargeMessage('Data room.pdf', 140 * 1024 * 1024), /^Data room\.pdf is 140 MB; OpenLex reads files up to 100 MB\. Split it/)
  process.env.OPENLEX_MAX_FILE_MB = '0.001'
  try {
    await assert.rejects(require('../src/read').readDocument({ buffer: Buffer.alloc(5000, 'a'), name: 'big.txt' }), (e) => e.code === 'FILE_TOO_LARGE' && /up to 0\.001 MB/.test(e.message))
  } finally { delete process.env.OPENLEX_MAX_FILE_MB }
  require('../src/agent-config').save({ maxFileMB: 250 })
  assert.strictEqual(limits.maxFileMB(), 250)
  require('../src/agent-config').save({ maxFileMB: null })
  assert.strictEqual(limits.maxFileMB(), 100)
  // The old scattered limits are gone from the engine.
  for (const f of ['folder.js', 'library.js', 'web/browser.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    assert.ok(!/(10|20|50) \* 1024 \* 1024/.test(src), `${f} uses limits.js`)
  }
})

// ── attachments ─────────────────────────────────────────────────────────
test('attachments: read on this computer, kept by id, summary says how it will be read and where it may go; a firm deny rule blocks it', async () => {
  const at = require('../src/attachments')
  const a = await policy.withMatter(matterId, () => at.add({ name: 'contract.txt', buffer: Buffer.from(CONTRACT), matterId }))
  assert.match(a.id, /^att_[a-f0-9]{16}$/)
  assert.strictEqual(a.name, 'contract.txt')
  assert.ok(a.outline.includes('§ 4 Liability'))
  assert.strictEqual(a.strategy.kind, 'cloud')
  assert.strictEqual(a.strategy.mode, 'full')
  assert.match(a.strategy.text, /is read in full by/)
  assert.strictEqual(a.where.local, false)
  assert.match(a.where.text, /May be sent to OpenAI/)
  assert.strictEqual(at.text(a.id), CONTRACT)
  const c = at.combined([a.id, a.id])
  assert.match(c.text, /^=== contract\.txt ===\nSERVICE AGREEMENT/)
  assert.throws(() => at.text('../../etc/passwd'), /unknown attachment/)

  const perms = require('../src/permissions')
  perms.addRule('deny', 'read_attachment')
  try {
    await assert.rejects(at.add({ name: 'x.txt', buffer: Buffer.from('text'), matterId }), (e) => e.code === 'NOT_ALLOWED')
  } finally { perms.removeRule('read_attachment') }
  await assert.rejects(at.add({ name: 'empty.txt', buffer: Buffer.from('   '), matterId }), /no text found/)
})

// ── large documents: strategy by model ───────────────────────────────────
test('strategy: a cloud model reads the whole document when it fits (with headroom), else in big parts; the local model by its memory', () => {
  const st = require('../src/strategy')
  // Headroom rule (DeepSeek harness): min(80% of the window, window − output − min(64K, 25%)).
  assert.strictEqual(st.fitLimit(200000, 4000), 146000)
  assert.strictEqual(st.fitLimit(1048576, 4000), 838860)
  assert.strictEqual(st.fitLimit(32768, 4000), 20576)
  const cloud = { kind: 'cloud', ctx: 200000, provider: 'anthropic', label: 'Claude', region: 'eu' }
  const full = st.forModel({ tokens: 100000, t: cloud })
  assert.strictEqual(full.mode, 'full')
  assert.strictEqual(full.cache, true)
  assert.match(st.explain(full, { name: 'Data room index.pdf', pages: 300 }), /^Data room index\.pdf \(300 pages\) is read in full by Claude \(EU\)\. Follow-up questions reuse the provider's cache/)
  const big = st.forModel({ tokens: 400000, t: cloud })
  assert.strictEqual(big.mode, 'parts')
  assert.ok(big.partChars > 200000, `big parts for a big window (${big.partChars})`)
  assert.match(st.explain(big, { name: 'X', lang: 'de' }), /in großen Teilen/)

  const local = { kind: 'local', ctx: 16384, provider: 'local', label: 'this computer' }
  assert.strictEqual(st.forModel({ tokens: 9000, t: local }).mode, 'full', '~34,000 characters fit 16K (the chat rule)')
  const long = st.forModel({ tokens: 60000, t: local })
  assert.strictEqual(long.mode, 'parts')
  assert.strictEqual(long.cache, false)
  assert.strictEqual(long.partChars, 12000)
  assert.match(st.explain(long, { name: 'Lease' }), /Memory for the local AI/)
  assert.strictEqual(st.forModel({ tokens: 60000, t: { ...local, ctx: 262144 } }).mode, 'full', 'more memory: the whole document fits')
})

test('memory for the local AI: GB → context size (llama.cpp -c / num_ctx), automatic default unchanged, the engine budget and the server agree', () => {
  const lm = require('../src/local_memory')
  // 2.75 GB model + 0.3 GB + 32 KB per token.
  assert.strictEqual(lm.ctxForMemory(4.05, 2.75), 32768)
  assert.strictEqual(lm.ctxForMemory(5.05, 2.75), 65536)
  assert.strictEqual(lm.ctxForMemory(5.2, 2.75), 69632, 'rounded down to 4K steps')
  assert.strictEqual(lm.ctxForMemory(3.0, 2.75), 8192, 'never below 8K')
  assert.strictEqual(lm.memoryForCtx(65536, 2.75), 5.1)
  assert.ok(lm.pagesFor(65536) > lm.pagesFor(16384))

  const before = lm.describe()
  assert.strictEqual(before.automatic, true)
  assert.strictEqual(lm.chosenCtx(), null)
  assert.strictEqual(before.ctx, lm.autoCtx())
  assert.match(before.words.tradeoff, /slower to start|takes longer to start/)
  assert.ok(before.options.length >= 1 && before.options[0].ctx === 8192)

  const want = Math.min(lm.memoryForCtx(16384), before.max)
  const after = lm.set(want)
  assert.strictEqual(after.automatic, false)
  const ctx = lm.ctxForMemory(want)
  assert.strictEqual(lm.chosenCtx(), ctx)
  assert.strictEqual(require('../src/runtime').tierConfig().ctx, ctx, 'the engine\'s own llama-server starts with it')
  settings.update({ active: 'local' })
  try {
    assert.strictEqual(require('../src/agent-config').effectiveAgent().CTX_BUDGET_TOKENS, ctx, 'the engine budgets against it')
  } finally { settings.update({ active: 'openai' }) }
  assert.throws(() => lm.set(0.5), /at least/)
  const r = lm.handle('POST', '/api/config/local-memory', null, { auto: true })
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.json.automatic, true)
  assert.strictEqual(lm.handle('GET', '/api/config/local-memory', new URLSearchParams('lang=de')).json.words.title, 'Speicher für die lokale KI')
})

test('prompt caching: the document read in full is a cache breakpoint for Claude and Bedrock; other providers get it without the mark', () => {
  const { CACHE_MARK } = require('../src/providers/common')
  const msgs = [{ role: 'system', content: `Rules\n\nDOCUMENT:\n${'x'.repeat(5000)}${CACHE_MARK}CONVERSATION: earlier turns` }, { role: 'user', content: 'Question?' }]
  const a = require('../src/providers/anthropic').buildBody({ model: 'claude-sonnet-5-5' }, msgs, {}, false)
  assert.ok(Array.isArray(a.system))
  assert.deepStrictEqual(a.system[0].cache_control, { type: 'ephemeral' })
  assert.match(a.system[1].text, /^CONVERSATION/)
  assert.ok(!a.system[1].cache_control)
  const longDoc = [{ role: 'system', content: `${'y'.repeat(250000)}${CACHE_MARK}tail` }, { role: 'user', content: 'Q' }]
  assert.strictEqual(require('../src/providers/anthropic').buildBody({ model: 'claude-opus-5-5' }, longDoc, {}, false).system[0].cache_control.ttl, '1h', 'a long document keeps an hour')
  const b = require('../src/providers/bedrock').buildBody({ model: 'anthropic.claude' }, msgs, {})
  assert.deepStrictEqual(b.system[1], { cachePoint: { type: 'default' } })
  const o = require('../src/providers/openai').buildBody({ model: 'gpt-test' }, msgs, {}, false)
  assert.ok(!o.messages[0].content.includes('openlex:cache'))
  assert.match(o.messages[0].content, /x\nCONVERSATION/)
  // Without a mark nothing changes.
  assert.strictEqual(typeof require('../src/providers/anthropic').buildBody({ model: 'c' }, [{ role: 'system', content: 'short' }, { role: 'user', content: 'q' }], {}, false).system, 'string')
})

// ── the full analysis ───────────────────────────────────────────────────
let analysis
test('analysis of an attached document: everything the old Upload analysis showed, verified, with the strategy recorded', async () => {
  const at = require('../src/attachments')
  // Long enough to be worth caching (≥ 1,024 tokens).
  const att = await at.add({ name: 'shop-contract.txt', buffer: Buffer.from(`${CONTRACT}\n\n§ 6 General provisions\n${'Each party bears its own costs of this agreement. '.repeat(100)}`), matterId })
  const before = seen.length
  const steps = []
  const r = await policy.withMatter(matterId, () => require('../src/analysis').runAnalyse({ matterId, attachments: [att.id], onProgress: (e) => steps.push(require('../src/analysis').stepWords(e)) }))
  analysis = r.analyses[0]
  assert.match(analysis.id, /^an_/)
  assert.strictEqual(analysis.version, 2)
  assert.strictEqual(analysis.summary.type, 'IT service agreement')
  assert.deepStrictEqual(analysis.summary.keyPoints.length, 3)
  assert.strictEqual(analysis.summary.governingLaw, 'Austrian law')
  assert.deepStrictEqual(analysis.glossary.map((g) => g.term), ['gross negligence'], 'a term not in the document is dropped')
  assert.deepStrictEqual(analysis.overall, { score: 30, level: 'high', explanation: '1 high, 0 medium and 0 low risks, each backed by a verbatim quote.' })
  assert.ok(analysis.readability.avgSentenceWords > 0)
  assert.strictEqual(analysis.clauses.find((c) => c.kind === 'missing').importance, 'critical')
  assert.strictEqual(analysis.clauses.find((c) => c.kind === 'notable').category, 'disputes')
  assert.strictEqual(analysis.risks[0].location.text, '§ 4 Liability')
  assert.strictEqual(analysis.risks[0].sources[0].title, 'ABGB')
  assert.strictEqual(analysis.document.pages, 2)
  assert.strictEqual(analysis.stats.strategy.cache, true)
  assert.deepStrictEqual(analysis.stats.strategy.mode, 'full')
  assert.strictEqual(analysis.stats.strategy.kind, 'cloud')
  // Read in full by the cloud model: the document is the system prompt's (cacheable) prefix, sent without the mark.
  const call = seen.slice(before).find((b) => b.messages.some((m) => /Analyse this document/.test(m.content)))
  assert.match(call.messages[0].content, /DOCUMENT TEXT \(shop-contract\.txt\)/)
  assert.ok(!call.messages[0].content.includes('openlex:cache'))
  assert.match(call.messages[1].content, /the full text is in the system prompt above/)
  assert.ok(steps.some((s) => /reads the whole document/.test(s)), steps.join(' | '))
  assert.ok(steps.includes('Checking every finding against the document (word for word)'))
  // Stored by id for the chat card.
  assert.strictEqual(require('../src/analysis').get(analysis.id).summary.type, 'IT service agreement')
  assert.throws(() => require('../src/analysis').get('../x'), /unknown analysis/)
})

test('a document beyond the cloud window is read in big parts, each with the outline', async () => {
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', ctx: 9000 } })
  try {
    const text = Array.from({ length: 40 }, (_, i) => `§ ${i + 1} Clause ${i + 1}\n${'The parties agree to the terms set out here. '.repeat(8)}`).join('\n\n')
    const before = seen.length
    const r = await policy.withMatter(matterId, () => require('../src/analysis').runAnalyse({ matterId, text, name: 'long.txt' }))
    const parts = seen.slice(before).filter((b) => b.messages.some((m) => /Analyse this document/.test(m.content)))
    assert.ok(parts.length >= 2, `${parts.length} parts`)
    assert.strictEqual(r.analyses[0].stats.strategy.mode, 'parts')
    assert.match(parts[1].messages[1].content, /OUTLINE OF THE WHOLE DOCUMENT[\s\S]*§ 40 Clause 40/)
    assert.match(parts[1].messages[1].content, /\(part 2 of \d+\)/)
  } finally {
    settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test', ctx: null } })
  }
})

function zipEntries(buf) {
  const names = []
  for (let i = 0; i < buf.length - 4; i++) if (buf.readUInt32LE(i) === 0x02014b50) names.push(buf.toString('utf8', i + 46, i + 46 + buf.readUInt16LE(i + 28)))
  return names
}

test('exports: Word, PDF and CSV are valid files in the matter folder', () => {
  const an = require('../src/analysis')
  const w = an.exportAnalysis(analysis.id, 'docx')
  const wb = Buffer.from(w.data, 'base64')
  assert.strictEqual(wb.readUInt32LE(0), 0x04034b50, 'a zip')
  assert.ok(zipEntries(wb).includes('word/document.xml'))
  const xml = require('../src/docx_text').readZipEntry(wb, 'word/document.xml').toString('utf8')
  assert.match(xml, /Legal terms in plain words/)
  assert.match(xml, /Overall risk/)
  assert.ok(fs.existsSync(w.file) && /2026-77_Shop_contract[\\/]analysis-shop-contract\.docx$/.test(w.file))

  const p = an.exportAnalysis(analysis.id, 'pdf')
  const pb = Buffer.from(p.data, 'base64')
  assert.strictEqual(pb.subarray(0, 5).toString(), '%PDF-')
  assert.match(pb.subarray(-8).toString(), /%%EOF/)
  assert.strictEqual(p.mime, 'application/pdf')
  // The PDF reads back with the findings.
  return require('../src/pdf_text').pdfText(pb, { ocr: false }).then((t) => {
    assert.match(t, /Liability excluded even for gross negligence/)
    const c = an.exportAnalysis(analysis.id, 'csv')
    const csv = Buffer.from(c.data, 'base64').toString('utf8')
    assert.ok(csv.startsWith('﻿Type,Level,Title,Detail,Suggested fix,Fix check,Party,Date,Where,Quote,Law\r\n'))
    assert.match(csv, /\r\nRisk,high,Liability excluded even for gross negligence,/)
    assert.match(csv, /\r\nDeadline,high,Start,1 February 2027,,,,2027-02-01,§ 3 Term,/)
    assert.match(csv, /\r\nPossibly missing,critical,Data protection,/)
    assert.match(csv, /\r\nLegal term,,gross negligence,/)
    assert.throws(() => an.exportAnalysis(analysis.id, 'exe'), /format must be/)
    // A cell that starts like a formula is neutralised for Excel.
    const rows = an.rows({ ...analysis, keyTerms: [{ term: '=HYPERLINK("x")', value: 'v', quote: 'q', location: {} }], risks: [], deadlines: [], obligations: [], clauses: [], glossary: [] })
    assert.strictEqual(rows[1][2], '=HYPERLINK("x")')
    assert.match(an.toCsv({ ...analysis, keyTerms: [{ term: '=HYPERLINK("x")', value: 'v', quote: 'q', location: {} }], risks: [], deadlines: [], obligations: [], clauses: [], glossary: [] }), /,"'=HYPERLINK\(""x""\)",/)
  })
})

// ── big batches ─────────────────────────────────────────────────────────
test('batches: estimate before a cloud run (pages, tokens, service, cost), confirm, one by one in the background, stop and resume', async () => {
  const batch = require('../src/batch')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-dataroom-'))
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
  for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(dir, i === 4 ? 'sub' : '', `doc${i}.txt`), CONTRACT.repeat(i * 20))
  fs.writeFileSync(path.join(dir, 'photo.png'), 'x')
  fs.writeFileSync(path.join(dir, 'analysis-doc1.md'), 'an earlier report')

  // Claude prices are known; the fake OpenAI model has none.
  assert.deepStrictEqual(batch.priceFor('claude-sonnet-5-5'), { input: 2, output: 10, currency: 'USD' })
  assert.strictEqual(batch.priceFor('gpt-test'), null)
  const est = await batch.estimate({ folder: dir, matterId })
  assert.strictEqual(est.documents, 4)
  assert.ok(est.pages >= 4)
  assert.strictEqual(est.service.kind, 'cloud')
  assert.strictEqual(est.cost, null)
  assert.match(est.sentence, /^About \d+ pages in 4 documents, roughly [\d,]+ tokens to /)
  assert.match(est.sentence, /no price known/)

  // A small cloud run starts without asking; a big one needs the lawyer's yes.
  const order = []
  let release = null
  batch.setRunner(async (o) => {
    order.push(path.basename(o.file))
    if (order.length === 2) await new Promise((r) => { release = r })
    return { analyses: [{ id: `an_${'0'.repeat(15)}${order.length}`, stats: { high: 1, medium: 0, low: 0 } }] }
  })
  const big = batch.handle('POST', '/api/batch/start', null, { folder: dir, matterId })
  const orig = batch.CONFIRM_TOKENS
  assert.ok(est.tokens < orig, 'this run is small')
  const started = (await big).json.batch
  assert.strictEqual(started.counts.total, 4)
  while (!release) await new Promise((r) => setTimeout(r, 10))
  // Stop while the second document is being read: it goes back to waiting.
  const stopped = batch.stop(started.id)
  assert.strictEqual(stopped.state, 'stopped')
  release()
  const after = await batch.settle(started.id)
  assert.strictEqual(after.counts.done, 1)
  assert.strictEqual(after.state, 'stopped')
  // Resume: the rest, one by one, in order.
  batch.resume(started.id)
  const done = await batch.settle(started.id)
  assert.strictEqual(done.state, 'done')
  assert.strictEqual(done.counts.done, 4)
  assert.deepStrictEqual(order.slice(-3).sort(), ['doc2.txt', 'doc3.txt', 'doc4.txt'])
  assert.ok(done.files.every((f) => f.analysisId && f.risks.high === 1))
  assert.strictEqual(batch.list(matterId)[0].id, started.id)

  // Above the threshold: 409 with the estimate until confirmed.
  const many = Array.from({ length: 3 }, (_, i) => { const f = path.join(dir, `huge${i}.txt`); fs.writeFileSync(f, 'Clause. '.repeat(120000)); return f })
  const r = await batch.handle('POST', '/api/batch/start', null, { files: many, matterId })
  assert.strictEqual(r.status, 409)
  assert.strictEqual(r.json.confirm, true)
  assert.match(r.json.error, /^Please confirm first: About/)
  const ok = await batch.handle('POST', '/api/batch/start', null, { files: many, matterId, confirmed: true })
  assert.strictEqual(ok.status, 200)
  await batch.settle(ok.json.batch.id)
  // Documents attached in the app run the same way (by attachment id).
  const att = await require('../src/attachments').add({ name: 'one.txt', buffer: Buffer.from(CONTRACT), matterId })
  const seenAtt = []
  batch.setRunner(async (o) => { seenAtt.push(o.attachments); return { analyses: [{ id: 'an_00000000000000aa', stats: { high: 0, medium: 0, low: 1 } }] } })
  const ab = await batch.start({ attachments: [att.id], matterId })
  assert.strictEqual(ab.files[0].name, 'one.txt')
  const abDone = await batch.settle(ab.id)
  assert.strictEqual(abDone.counts.done, 1)
  assert.deepStrictEqual(seenAtt, [[att.id]])
  batch.setRunner(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('every conversation for the dashboard (GET /api/sessions?all=1)', () => {
  const session = require('../src/session')
  new session.Session('app:m1:x').append('About matter one', 'Answer', { matterId: 'm_one', client: 'app' })
  new session.Session('app:quick:y').append('A quick question', 'Answer', { client: 'tui' })
  const all = session.handle('GET', '/api/sessions', new URLSearchParams('all=1&limit=10')).json.sessions.map((x) => x.title)
  assert.ok(all.includes('About matter one') && all.includes('A quick question'), all.join(' | '))
  const quick = session.handle('GET', '/api/sessions', new URLSearchParams('limit=10')).json.sessions.map((x) => x.title)
  assert.ok(!quick.includes('About matter one'), 'without all: only conversations without a matter')
})

test('server: the routes exist and the app may call them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8')
  for (const r of ['/api/document/read', '/api/document/attachment', '/api/analyse', '/api/analysis', '/api/analysis/export', '/api/config/local-memory']) assert.ok(src.includes(`'${r}'`), r)
  assert.match(src, /require\('\.\/batch'\)\.handle/)
  assert.match(src, /body\.attachments/)
  assert.ok(zlib)
})
