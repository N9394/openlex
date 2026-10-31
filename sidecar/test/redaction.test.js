"use strict"
/**
 * Redaction check ("Schwärzen mit Prüfung"): the patterns with their check
 * digits, detection in DE/EN/CS/SK/PL/RO/HU, stable placeholders per
 * matter, restore in answers and exports, the gate before online AI, the
 * firm lock, the AI record (counts only) and the name finder (mocked: no
 * model is downloaded in tests).
 *
 *   node --test test/redaction.test.js
 *
 * Offline: fake OpenAI-compatible model, no keys, no downloads.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-redaction-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const { check: ck } = require('../src/pii_patterns')
const detect = require('../src/pii_detect')

// ── patterns ────────────────────────────────────────────────────────────

const CASES = {
  ibanOk: [['DE89 3704 0044 0532 0130 00', 'AT61 1904 3002 3457 3201'], ['DE89 3704 0044 0532 0130 01', 'AT61 1904 3002 3457 3202']],
  luhnOk: [['4111 1111 1111 1111', '5500 0000 0000 0004'], ['4111 1111 1111 1112', '0000 0000 0000 0000']],
  atSvnrOk: [['1239 120375'], ['1237 120375', '0239 120375']],
  deTaxIdOk: [['86095742719'], ['86095742718', '11111111111']],
  deSvnrOk: [['15070649C103'], ['15070649C104', '15071349C103']],
  ean13Ok: [['756.1234.5678.97'], ['756.1234.5678.98']],
  chUidOk: [['CHE-116.281.710'], ['CHE-116.281.711']],
  rcOk: [['785612/0008'], ['785612/0009', '781332/0008']],
  peselOk: [['44051401359'], ['44051401358', '44053501359']],
  nipOk: [['123-456-32-18', '5251234502'], ['123-456-32-19']],
  cnpOk: [['1800101221144'], ['1800101221145', '1801301221144']],
  cuiOk: [['18547290'], ['18547291']],
  tajOk: [['037 687 210'], ['037 687 211']],
  huTaxOk: [['8123456786'], ['8123456787', '7123456786']],
  icoOk: [['25596641'], ['25596642']],
  ssnOk: [['078-05-1120'], ['000-12-3456', '666-12-3456', '912-12-3456', '123-00-4567']],
  einOk: [['12-3456789'], ['07-3456789', '00-1234567']],
}

test('patterns: check digits accept valid and refuse invalid numbers', () => {
  for (const [fn, [good, bad]] of Object.entries(CASES)) {
    for (const v of good) assert.ok(ck[fn](v), `${fn} should accept ${v}`)
    for (const v of bad) assert.ok(!ck[fn](v), `${fn} should refuse ${v}`)
  }
  assert.ok(ck.phoneOk('+43 664 1234567'))
  assert.ok(ck.phoneOk('602 123 456'))
  assert.ok(!ck.phoneOk('12.500.000', 'EUR '))
  assert.ok(!ck.phoneOk('2026'))
})

const kinds = (text, opts) => detect.scan(text, opts).map((f) => `${f.kind}:${f.text}`)

test('patterns in context: numbers are found where they are, not everywhere', () => {
  const t = 'IBAN DE89 3704 0044 0532 0130 00, BIC: COBADEFFXXX, Karte 4111 1111 1111 1111. Kaufpreis EUR 12.500.000, § 1295 ABGB, BGBl. I Nr. 123/2020, im Jahr 2026.'
  assert.deepStrictEqual(kinds(t), ['IBAN:DE89 3704 0044 0532 0130 00', 'BIC:COBADEFFXXX', 'CARD:4111 1111 1111 1111'])
  // A BIC-like word without "BIC" before it, a 10-digit number without "rodné číslo", a 9-digit number without "TAJ".
  assert.deepStrictEqual(kinds('Firma SCHWEIZER und 7856120008 und 037 687 210.').filter((k) => !k.startsWith('PHONE')), [])
  assert.deepStrictEqual(kinds('geb. am 12.03.1975, Termin am 14.04.2026'), ['DATE:12.03.1975'])
  assert.deepStrictEqual(kinds('Reisepass Nr. P1234567 ausgestellt'), ['ID:P1234567'])
  assert.deepStrictEqual(kinds('FN 123456a, HRB 12345 B, CHE-116.281.710, J40/1234/2020, KRS 0000123456, IČO: 25596641'),
    ['REGNO:FN 123456a', 'REGNO:HRB 12345 B', 'REGNO:CHE-116.281.710', 'REGNO:J40/1234/2020', 'REGNO:0000123456', 'REGNO:25596641'])
  assert.deepStrictEqual(kinds('Az. 2 O 123/20 und sp. zn. 23 Cdo 1234/2020'), ['CASENO:2 O 123/20', 'CASENO:23 Cdo 1234/2020'])
  // A court number without the word before it is shown in the check, but not ticked.
  const low = detect.scan('OGH 1 Ob 123/20a', { all: true })
  assert.strictEqual(low[0].kind, 'CASENO')
  assert.strictEqual(low[0].on, false)
  assert.deepStrictEqual(kinds('OGH 1 Ob 123/20a'), [])
  // The list is data-driven: every entry has a country, a kind and both labels.
  for (const p of require('../src/pii_patterns').PATTERNS) assert.ok(p.id && p.country && p.kind && p.label.en && p.label.de && p.re.global, p.id)
})

const SAMPLES = {
  de: ['Kaufvertrag zwischen Herrn Mag. Johann Huber, geb. 12.03.1975, SVNR 1239 120375, wohnhaft Mariahilfer Straße 12/3/7, 1060 Wien, IBAN AT61 1904 3002 3457 3201, Tel. +43 664 1234567, johann.huber@example.at, und der Alpenbau Immobilien GmbH (FN 123456a), vertreten durch Dr. Eva Steiner. Steuer-ID 86095742719.',
    ['PERSON:Johann Huber', 'DATE:12.03.1975', 'ID:1239 120375', 'ADDRESS:Mariahilfer Straße 12/3/7, 1060 Wien', 'IBAN:AT61 1904 3002 3457 3201', 'PHONE:+43 664 1234567', 'EMAIL:johann.huber@example.at', 'ORG:Alpenbau Immobilien GmbH', 'REGNO:FN 123456a', 'PERSON:Eva Steiner', 'TAXID:86095742719']],
  en: ['Agreement between Mr. John Smith, SSN 078-05-1120, 1600 Pennsylvania Avenue, Washington, DC 20500, and Acme Widgets LLC, EIN 12-3456789.',
    ['PERSON:John Smith', 'ID:078-05-1120', 'ADDRESS:1600 Pennsylvania Avenue, Washington, DC 20500', 'ORG:Acme Widgets LLC', 'TAXID:12-3456789']],
  cs: ['Smlouvu uzavírají pan Jan Novák, r. č. 785612/0008, bytem Na Příkopě 15, 110 00 Praha 1, a Stavby Morava s.r.o., IČO: 25596641, tel. 602 123 456.',
    ['PERSON:Jan Novák', 'ID:785612/0008', 'ADDRESS:Na Příkopě 15, 110 00 Praha 1', 'ORG:Stavby Morava s.r.o.', 'REGNO:25596641', 'PHONE:602 123 456']],
  sk: ['Zmluvu uzatvárajú pán Peter Horváth, rodné číslo 785612/0008, bytom Hlavná 12, 811 01 Bratislava, a Tatra Invest a.s.',
    ['PERSON:Peter Horváth', 'ID:785612/0008', 'ADDRESS:Hlavná 12, 811 01 Bratislava', 'ORG:Tatra Invest a.s.']],
  pl: ['Umowa pomiędzy panią Anną Kowalską, PESEL 44051401359, ul. Marszałkowska 10, 00-590 Warszawa, a Budex sp. z o.o., NIP 123-456-32-18, KRS 0000123456.',
    ['PERSON:Anną Kowalską', 'ID:44051401359', 'ADDRESS:ul. Marszałkowska 10, 00-590 Warszawa', 'ORG:Budex sp. z o.o.', 'TAXID:123-456-32-18', 'REGNO:0000123456']],
  ro: ['Contract între domnul Ion Popescu, CNP 1800101221144, domiciliat în Str. Lipscani nr. 12, București, și Construct Plus SRL, CUI RO18547290, J40/1234/2020.',
    ['PERSON:Ion Popescu', 'ID:1800101221144', 'ADDRESS:Str. Lipscani nr. 12, București', 'ORG:Construct Plus SRL', 'TAXID:RO18547290', 'REGNO:J40/1234/2020']],
  hu: ['A szerződést a Duna Építő Kft. (1051 Budapest, Nádor utca 7.) köti, TAJ szám: 037 687 210, adóazonosító jel: 8123456786.',
    ['ORG:Duna Építő Kft.', 'ADDRESS:1051 Budapest, Nádor utca 7', 'ID:037 687 210', 'TAXID:8123456786']],
}

test('detection in DE, EN, CS, SK, PL, RO and HU sample texts', () => {
  for (const [lang, [text, want]] of Object.entries(SAMPLES)) assert.deepStrictEqual(kinds(text), want, lang)
  // Every finding says where it came from and how sure it is.
  const f = detect.scan(SAMPLES.de[0])
  assert.ok(f.every((x) => ['pattern', 'heuristic', 'term', 'model', 'firm'].includes(x.source) && x.confidence > 0 && x.confidence <= 1 && x.end > x.start))
  // Titles that are roles, not names, are not people.
  assert.deepStrictEqual(kinds('Frau Klägerin und Herr Vorsitzender'), [])
  // The lists win: a listed name inside an e-mail address does not break it.
  assert.deepStrictEqual(kinds('Write to eva@acme.at about Acme.', { terms: ['Acme'] }), ['EMAIL:eva@acme.at', 'PARTY:Acme'])
  // What the lawyer unticked stays as it is.
  assert.deepStrictEqual(kinds('Dr. Eva Steiner', { keep: ['Eva Steiner'] }), [])
})

// ── placeholders, restore, the gate ─────────────────────────────────────

const seen = []
let answer = null
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = JSON.parse(raw)
    const prompt = body.messages.map((m) => m.content).join('\n')
    seen.push(prompt)
    const phs = [...new Set(prompt.match(/\[\[[A-Z]+_\d+\]\]/g) || [])]
    let reply = answer ? answer(prompt, phs) : `Seen: ${phs.join(', ')}`
    if (prompt.includes('Analyse this document')) {
      reply = JSON.stringify({ summary: { type: 'Kaufvertrag', what: `Kauf zwischen ${phs[0]} und ${phs[1]}.`, parties: phs.slice(0, 2).map((n) => ({ name: n, role: 'party' })), purpose: 'Kauf', key_points: [`${phs[0]} zahlt`], governing_law: 'Austrian law' }, key_terms: [], dates: [], obligations: [], risks: [], clauses: [], glossary: [] })
    } else if (prompt.includes('CHECK THE SUGGESTED FIXES')) reply = '[]'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  })
})

let policy, matters, check, llm, matterId
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const settings = require('../src/providers/settings')
  settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
  settings.update({ active: 'openai' })
  policy = require('../src/policy')
  matters = require('../src/matters')
  check = require('../src/redaction_check')
  llm = require('../src/llm')
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  matterId = matters.create({ title: 'Huber ./. Alpenbau', client: 'Johann Huber' }).id
  policy.setRule(matterId, { mode: 'allow-list', providers: ['openai'] })
})
test.after(() => { fake.close(); require('../src/pii_ner').setRunner(null); fs.rmSync(DATA, { recursive: true, force: true }) })

const CONTRACT = 'KAUFVERTRAG\n\nzwischen Herrn Mag. Johann Huber, SVNR 1239 120375, Mariahilfer Straße 12, 1060 Wien (Käufer) und der Alpenbau Immobilien GmbH, FN 123456a, IBAN AT61 1904 3002 3457 3201 (Verkäuferin), vertreten durch Dr. Eva Steiner.\n\n§ 1 Kaufpreis\nDer Käufer Huber zahlt EUR 450.000. Ansprechpartner der Verkäuferin: Frau Petra Lang, petra.lang@alpenbau.example.'

test('placeholders are stable across documents and calls in a matter, and survive a restart', () => {
  const { Redactor, forMatter, forget } = require('../src/redact')
  const a = forMatter(matterId)
  const b = forMatter(matterId)
  const one = a.redact('Brief an Mag. Johann Huber wegen IBAN AT61 1904 3002 3457 3201.')
  const two = b.redact('Antwort von Johann Huber; Konto AT61 1904 3002 3457 3201.')
  const ph = one.match(/\[\[PARTY_\d+\]\]/)[0]
  assert.ok(two.includes(ph), 'same person, same placeholder in another document')
  assert.ok(one.includes('[[IBAN_1]]') && two.includes('[[IBAN_1]]'))
  // Kept on this computer, only for this user.
  const file = path.join(DATA, 'redaction', `${matterId}.json`)
  assert.ok(fs.existsSync(file))
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o077, 0)
  // Another matter has its own numbering; an old-style Redactor keeps its own.
  assert.match(new Redactor(['Johann Huber']).redact('Johann Huber'), /^\[\[PARTY_1\]\]$/)
  assert.strictEqual(a.restore(`${ph} zahlt auf [[IBAN_1]].`), 'Johann Huber zahlt auf AT61 1904 3002 3457 3201.')
  forget(matterId)
})

test('the gate: a checked request sends nothing before the check; local-only needs none', async () => {
  assert.deepStrictEqual(check.needed(matterId), { needed: true, locked: false })
  const g = check.gate(matterId, null)
  assert.ok(g.needed && g.block)
  const n = seen.length
  await assert.rejects(check.within(g, () => policy.withMatter(matterId, () => llm.chat([{ role: 'user', content: CONTRACT }]))), (e) => e.code === 'CHECK_NEEDED')
  assert.strictEqual(seen.length, n, 'nothing reached the online model')
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse)
  assert.ok(audit.some((e) => e.decision === 'blocked' && e.reason === 'redaction check not done'))

  // Only this computer: no check, the gate is open, the data line says so.
  const local = matters.create({ title: 'Local only' })
  assert.deepStrictEqual(check.needed(local.id), { needed: false, local: true })
  assert.strictEqual(check.gate(local.id, null).block, false)
  const priv = matters.create({ title: 'Privileged', privileged: true })
  assert.strictEqual(check.needed(priv.id).needed, false)
})

test('the check: findings grouped, untick, add, preview — then the answer and the export show real names', async () => {
  const at = await require('../src/attachments').add({ name: 'Kaufvertrag.txt', buffer: Buffer.from(CONTRACT), matterId })
  const r = await check.prepare({ matterId, items: [{ name: 'Your question', text: 'Wer ist Verkäuferin und was zahlt Huber?' }, { name: at.name, text: require('../src/attachments').text(at.id) }] })
  const v = check.view(r, { lang: 'de' })
  assert.strictEqual(v.basic, true, 'no name finder installed: basic detection')
  assert.deepStrictEqual(v.groups, ['people', 'orgs', 'addresses', 'ids', 'contact', 'other'])
  const by = (text) => v.entries.find((e) => e.text === text)
  for (const t of ['Johann Huber', 'Alpenbau Immobilien GmbH', 'Mariahilfer Straße 12, 1060 Wien', '1239 120375', 'AT61 1904 3002 3457 3201', 'petra.lang@alpenbau.example', 'Eva Steiner', 'Petra Lang']) assert.ok(by(t)?.on, t)
  assert.strictEqual(by('Johann Huber').group, 'people')
  assert.strictEqual(by('Johann Huber').sources[0], 'term', 'the client is on the matter list')
  assert.ok(by('Huber')?.count >= 2, JSON.stringify(v.entries.map((e) => [e.text, e.kind, e.count])) +  'the last name alone, in the question and the document')
  assert.strictEqual(by('1239 120375').label, 'Sozialversicherungsnummer (AT)')
  // The lawyer: Dr. Steiner is the other side's lawyer (need not be hidden), and "Käufer" should be hidden too.
  const res = check.confirm(r.id, { off: [by('Eva Steiner').key], add: [{ text: 'Käufer', kind: 'OTHER' }] })
  assert.strictEqual(res.changed, true)
  assert.ok(res.hidden.PERSON >= 1 && res.hidden.IBAN === 1)

  // The matter remembers: the next check is faster.
  const m = matters.get(matterId)
  assert.ok(m.redactTerms.includes('Petra Lang') && m.redactTerms.includes('Alpenbau Immobilien GmbH') && m.redactTerms.includes('Käufer'))
  assert.strictEqual(m.redactKinds[detect.norm('Petra Lang')], 'PERSON')
  assert.ok(m.redactKeep.includes('Eva Steiner'))
  const again = await check.prepare({ matterId, items: [{ name: 'Brief', text: 'Frau Petra Lang schreibt an Dr. Eva Steiner.' }] })
  const e2 = check.view(again).entries
  assert.strictEqual(e2.find((e) => e.text === 'Petra Lang').sources[0], 'term')
  assert.strictEqual(e2.find((e) => e.text === 'Eva Steiner').on, false, 'unticked last time, unticked now')
  check.cancel(again.id)

  // Send: the online model gets placeholders only; the answer has the real names.
  answer = (prompt, phs) => `Die Verkäuferin ist ${phs.find((p) => p.startsWith('[[ORG')) || phs[1]}; ${phs.find((p) => p.startsWith('[[PARTY')) || phs[0]} zahlt.`
  const g = check.gate(matterId, r.id)
  assert.ok(g.needed && !g.block)
  const before = seen.length
  const out = await check.within(g, () => policy.withMatter(matterId, () => llm.chat([{ role: 'user', content: `${CONTRACT}\n\nWer ist Verkäuferin und was zahlt Huber?` }])))
  const sent = seen.slice(before).join('\n')
  for (const t of ['Johann Huber', 'Alpenbau', 'Mariahilfer', '1239 120375', 'AT61', 'petra.lang', 'Petra Lang', 'Käufer']) assert.ok(!sent.includes(t), `${t} must not be sent: ${sent}`)
  assert.ok(sent.includes('Eva Steiner'), 'unticked: sent as it is')
  assert.strictEqual(out, 'Die Verkäuferin ist Alpenbau Immobilien GmbH; Johann Huber zahlt.')
  answer = null

  // The full analysis in the same checked request, then its export: real names.
  const an = await check.within(g, () => policy.withMatter(matterId, () => require('../src/analysis').runAnalyse({ matterId, attachments: [at.id] })))
  const a = an.analyses[0]
  assert.match(JSON.stringify(a.summary), /Johann Huber/)
  assert.doesNotMatch(JSON.stringify(a), /\[\[[A-Z]+_\d+\]\]/)
  for (const fmt of ['md', 'docx']) {
    const ex = require('../src/analysis').exportAnalysis(a.id, fmt)
    const text = fmt === 'md' ? Buffer.from(ex.data, 'base64').toString('utf8') : require('../src/docx_text').docxText(Buffer.from(ex.data, 'base64'))
    assert.match(text, /Johann Huber/, fmt)
    assert.doesNotMatch(text, /\[\[[A-Z]+_\d+\]\]/, fmt)
  }

  // The AI record: the check and every online call, counts only — never the content.
  const lines = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse)
  const rc = lines.find((e) => e.call === 'redaction-check' && e.decision === 'checked')
  assert.strictEqual(rc.changed, true)
  assert.strictEqual(rc.unticked, 1)
  assert.strictEqual(rc.added, 1)
  assert.strictEqual(rc.documents, 2)
  assert.strictEqual(rc.detection, 'basic')
  assert.ok(rc.hidden.IBAN === 1)
  const calls = lines.filter((e) => e.provider === 'openai' && e.ok && e.check)
  assert.ok(calls.length >= 2)
  assert.ok(calls.every((e) => e.check === 'checked-changed' && e.hidden && e.redacted > 0))
  const raw = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  for (const t of ['Huber', 'Alpenbau', 'Steiner', 'AT61', 'Käufer']) assert.ok(!raw.includes(t), `${t} in the AI record`)
})

test('batch runs: one check for all documents before the run starts', async () => {
  const batch = require('../src/batch')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-room-'))
  fs.writeFileSync(path.join(dir, 'a.txt'), CONTRACT)
  fs.writeFileSync(path.join(dir, 'b.txt'), CONTRACT.replace(/Huber/g, 'Maier'))
  let inside = null
  batch.setRunner(async () => { inside = policy.redactionContext(); return { analyses: [] } })
  const refused = await batch.handle('POST', '/api/batch/start', null, { folder: dir, matterId })
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json))
  assert.strictEqual(refused.json.code, 'CHECK_NEEDED')
  const r = await check.prepare({ matterId, items: [{ name: 'a.txt', text: CONTRACT }, { name: 'b.txt', text: CONTRACT.replace(/Huber/g, 'Maier') }] })
  check.confirm(r.id, {})
  const started = await batch.handle('POST', '/api/batch/start', null, { folder: dir, matterId, redactionCheck: r.id })
  assert.strictEqual(started.status, 200, JSON.stringify(started.json))
  const job = await batch.settle(started.json.batch.id)
  assert.strictEqual(job.state, 'done')
  assert.ok(inside?.gated && inside.review.status === 'confirmed', 'each document runs within the check')
  batch.setRunner(null)
})

test('settings: on by default, the lawyer can switch it off, the firm can lock it and add terms and patterns', async () => {
  assert.strictEqual(check.settings().check, true)
  check.setCheck(false)
  assert.deepStrictEqual(check.needed(matterId), { needed: false, off: true, locked: false })
  check.setCheck(true)
  // The firm's openlex.json: locked on, a firm-wide name and a client-number pattern.
  fs.mkdirSync(path.join(DATA, 'workspace'), { recursive: true })
  fs.writeFileSync(path.join(DATA, 'workspace', 'openlex.json'), JSON.stringify({ lock: ['redaction'], redaction: { check: true, terms: ['Kanzlei Muster'], patterns: [{ regex: 'KD-\\d{6}', kind: 'ID', label: 'Client number' }, { regex: '(' }] } }))
  assert.throws(() => check.setCheck(false), /firm/)
  assert.strictEqual(check.settings().locked, true)
  const { forMatter } = require('../src/redact')
  const out = forMatter(matterId).redact('Kanzlei Muster, Mandant KD-123456.')
  assert.match(out, /^\[\[PARTY_\d+\]\], Mandant \[\[ID_\d+\]\]\.$/)
  fs.rmSync(path.join(DATA, 'workspace', 'openlex.json'))
})

test('the name finder: its findings join the check (model mocked, nothing downloaded)', async () => {
  const ner = require('../src/pii_ner')
  assert.strictEqual(ner.installed(), false)
  assert.deepStrictEqual(ner.MODEL.files.map((f) => f.sha256.length), ner.MODEL.files.map(() => 64))
  assert.strictEqual(ner.MODEL.license, 'Apache-2.0')
  assert.ok(ner.status().sizeMB > 150 && ner.status().sizeMB < 250)
  const text = 'A szerződést Kovács Péter és Szabó Anna írták alá.'
  ner.setRunner(async (t) => ['Kovács Péter', 'Szabó Anna'].map((n) => ({ kind: 'PERSON', start: t.indexOf(n), end: t.indexOf(n) + n.length, confidence: 0.93 })))
  const r = await check.prepare({ matterId: null, items: [{ name: 'Levél', text }] })
  const v = check.view(r)
  assert.strictEqual(v.basic, false)
  assert.deepStrictEqual([v.detection, v.finder, v.items[0].detection], ['with-model', 'used', 'model'])
  assert.deepStrictEqual(v.entries.map((e) => [e.text, e.sources[0], e.on]), [['Kovács Péter', 'model', true], ['Szabó Anna', 'model', true]])
  ner.setRunner(null)
  check.cancel(r.id)
})
