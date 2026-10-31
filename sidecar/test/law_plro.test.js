"use strict"
/**
 * Poland and Romania law sources: Sejm ELI (statutes), SAOS (judgments),
 * legislatie.just.ro (the ministry's free SOAP service) and the opt-in
 * Romanian community data (a local copy, downloaded only after the size is
 * shown). One local fake server answers with responses recorded from the
 * real services (test/fixtures/law-sources/plro); the PDF is made here.
 * No live calls, no keys.
 *
 *   node --test test/law_plro.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_plro.test.js   # + one live look-up per free source
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-plro-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources', 'plro')
const fixture = (f) => fs.readFileSync(path.join(FIX, f))

/** A one-page PDF with these lines (Helvetica, plain ASCII). */
function makePdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = `BT /F1 11 Tf 14 TL 50 780 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
const U_PDF = makePdf(['(c)Kancelaria Sejmu s. 109/243', '2026-10-16', 'Art. 535. Przez umowe sprzedazy sprzedawca zobowiazuje sie przeniesc', 'na kupujacego wlasnosc rzeczy.', 'Par. 2. (uchylony)', 'Art. 536. Cene mozna okreslic przez wskazanie podstaw do jej ustalenia.'])
const ACT_HTML = '<html><body><h1>Ustawa z dnia 23 kwietnia 1964 r. Kodeks cywilny</h1><div><h3><b>Art.&nbsp;535.</b></h3><div>§ 1. Przez umowę sprzedaży sprzedawca zobowiązuje się przenieść na kupującego własność rzeczy.</div></div><div><h3><b>Art.&nbsp;538.</b></h3><div>Sprzedaż nieruchomości …</div></div></body></html>'

const seen = []
let down = new Set()
const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const p = u.pathname
    seen.push({ path: req.url, method: req.method, headers: req.headers, body })
    const src = p.split('/')[1]
    if (down.has(src)) { res.writeHead(503, { Connection: 'close' }); return res.end() }
    // Connection: close — Windows sometimes reuses a socket the test server already closed (ECONNRESET).
    const send = (type, data, status = 200) => { res.writeHead(status, { 'Content-Type': type, Connection: 'close' }); res.end(data) }
    const json = (o, status = 200) => send('application/json', typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o), status)
    // Sejm ELI
    if (p === '/sejm/acts/search') return json(fixture('sejm-search.json'))
    if (p === '/sejm/acts/DU/1964/93') return json(fixture('sejm-act.json'))
    if (p === '/sejm/acts/DU/1964/94') { const a = JSON.parse(fixture('sejm-act.json')); a.ELI = 'DU/1964/94'; a.pos = 94; a.displayAddress = 'Dz.U. 1964 nr 16 poz. 94'; a.texts = a.texts.filter((t) => t.type !== 'U'); return json(a) }
    if (p === '/sejm/acts/DU/1964/93/text/U/D19640093Lj.pdf') return send('application/pdf', U_PDF)
    if (p === '/sejm/acts/DU/1964/94/text.html') return send('text/html; charset=utf-8', ACT_HTML)
    if (p.startsWith('/sejm/')) return json({ message: 'not found' }, 404)
    // SAOS
    if (p === '/saos/search/judgments') return json(fixture('saos-search.json'))
    if (p === '/saos/judgments/553722' || p === '/saos/judgments/551289') return json(fixture('saos-judgment.json'))
    if (p.startsWith('/saos/')) return json({ error: 'not found' }, 404)
    // legislatie.just.ro SOAP
    if (p === '/rolegis/SOAP') {
      const action = String(req.headers.soapaction || '')
      if (/GetToken"$/.test(action)) return send('text/xml; charset=utf-8', fixture('rolegis-token.xml'))
      if (/Search"$/.test(action)) {
        if (!/<tokenKey>00000W2GJ2IPDQD/.test(body)) return send('text/xml', '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>token</faultstring></s:Fault></s:Body></s:Envelope>', 500)
        if (/<a:SearchNumar>31<\/a:SearchNumar>/.test(body) || /<a:SearchTitlu>timpului de muncă/.test(body)) return send('text/xml; charset=utf-8', fixture('rolegis-search.xml'))
        return send('text/xml; charset=utf-8', '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><SearchResponse xmlns="http://tempuri.org/"><SearchResult xmlns:a="http://schemas.datacontract.org/2004/07/FreeWebService" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"/></SearchResponse></s:Body></s:Envelope>')
      }
    }
    // GitHub (the Romanian community data)
    const origin = `http://127.0.0.1:${fake.address().port}`
    if (p === '/gh/releases') return json([{ tag_name: 'documents/2026-10-29', published_at: '2026-10-29T10:05:15Z', assets: [{ name: 'articles.parquet', size: 917576015, browser_download_url: `${origin}/dl/articles.parquet` }, { name: 'documents.parquet', size: fixture('documents.parquet').length, browser_download_url: `${origin}/dl/documents.parquet` }] }])
    if (p === '/dl/documents.parquet') return send('application/octet-stream', fixture('documents.parquet'))
    res.writeHead(404); res.end()
  })
})

let ls, policy
const setPolicy = (providers) => policy.setRule(null, providers ? { mode: 'allow-list', providers } : { mode: 'local-only' })
const mem = new Map()

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, { OPENLEX_SEJM_API: `${base}/sejm`, OPENLEX_SAOS_API: `${base}/saos`, OPENLEX_ROLEGIS_API: `${base}/rolegis/SOAP`, OPENLEX_RODATA_API: `${base}/gh` })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  policy = require('../src/policy')
  await ls._setStore({ get: async (n) => mem.get(n) ?? null, set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { down = new Set(); require('../src/connectors/rolegis')._reset(); require('../src/connectors/sejm')._clearCache() })

test('the four sources have the one interface and say what they are', async () => {
  for (const id of ['sejm', 'saos', 'rolegis', 'rodata']) {
    const c = ls.connector(id)
    for (const k of ['id', 'label', 'country', 'kind', 'description', 'licence', 'homepage', 'guide', 'sample']) assert.ok(typeof c[k] === 'string' && c[k], `${id}.${k}`)
    assert.ok(c.hosts.length && c.de.label && c.de.description, id)
  }
  setPolicy(['web'])
  const st = Object.fromEntries((await ls.status()).map((s) => [s.id, s]))
  assert.strictEqual(st.sejm.status, 'Sejm ELI (Poland): connected, free')
  assert.strictEqual(st.sejm.statusDe, 'Sejm ELI (Polen): verbunden, kostenlos')
  assert.strictEqual(st.saos.status, 'SAOS (Polish court judgments): connected, free (community source)')
  assert.strictEqual(st.rolegis.status, 'legislatie.just.ro (Romania): connected, free')
  assert.strictEqual(st.rodata.status, 'Romanian law (community data, no licence file): off', 'opt-in: off until switched on')
  assert.deepStrictEqual([st.sejm.country, st.saos.kind, st.rolegis.country, st.rodata.optIn, st.rodata.community], ['PL', 'caselaw', 'RO', true, true])
})

test('Sejm ELI: a title search leads to the act itself (consolidated), amending acts later; journal references', async () => {
  setPolicy(['web'])
  let r = await ls.search({ query: 'kodeks cywilny', jurisdiction: 'PL', kind: 'law' })
  assert.deepStrictEqual(r.searched, ['sejm'])
  const first = r.results[0]
  assert.deepStrictEqual([first.ref, first.title, first.citation, first.source], ['DU/1964/93', 'Kodeks cywilny', 'Dz.U. 1964 poz. 93 (Sejm ELI)', 'sejm'])
  assert.match(first.snippet, /consolidated text announced in Dz\.U\. 2026 poz\. 795/)
  assert.match(first.licence, /art\. 4 of the Polish Copyright Act/)
  assert.match(first.retrieved, /^\d{4}-\d\d-\d\dT/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  assert.ok(r.results.findIndex((x) => /o zmianie/.test(x.title)) > r.results.findIndex((x) => x.ref === 'DU/1964/93'))
  assert.strictEqual(new Set(r.results.map((x) => x.ref)).size, r.results.length, 'one result per act')
  const q = new URL(seen.filter((s) => s.path.startsWith('/sejm/acts/search')).at(-1).path, 'http://x').searchParams
  assert.strictEqual(q.get('title'), 'kodeks cywilny')
  r = await ls.search({ query: 'Dz. U. 1964 Nr 16 poz. 93', sources: ['sejm'] })
  assert.deepStrictEqual([r.results[0].ref, r.results[0].citation, r.results[0].inForce], ['DU/1964/93', 'Dz.U. 1964 nr 16 poz. 93 (Sejm ELI)', true])
  assert.strictEqual(r.results[0].url, 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19640160093')
  assert.deepStrictEqual((await ls.search({ query: 'Dz.U. 1999 poz. 1', sources: ['sejm'] })).results, [], 'an unknown act is simply not found')
  const { parseRef } = require('../src/connectors/sejm')
  assert.deepStrictEqual(['DU/2024/1061', 'Dz.U. z 2024 r. poz. 1061', 'M.P. 2023 poz. 5', 'zmowa'].map(parseRef), ['DU/2024/1061', 'DU/2024/1061', 'MP/2023/5', null])
})

test('Sejm ELI: one article from the consolidated PDF; the published HTML when there is none', async () => {
  setPolicy(['web'])
  let doc = await ls.get({ source: 'sejm', ref: 'DU/1964/93', article: 'Art. 535' })
  assert.match(doc.text, /^Art\. 535\. Przez umowe sprzedazy/)
  assert.ok(!/Art\. 536/.test(doc.text) && !/Kancelaria/.test(doc.text), 'one article, no page furniture')
  assert.deepStrictEqual([doc.citation, doc.url], ['art. 535 Dz.U. 1964 nr 16 poz. 93 (Sejm ELI)', `${process.env.OPENLEX_SEJM_API}/acts/DU/1964/93/text/U/D19640093Lj.pdf`])
  assert.match(doc.note, /Unofficial consolidated text \(tekst ujednolicony\)/)
  assert.strictEqual(doc.notice, 'Check the official version before relying on it.')
  doc = await ls.get({ source: 'sejm', ref: 'Dz.U. 1964 nr 16 poz. 94', article: '535' })
  assert.match(doc.text, /^Art\. 535\.\n§ 1\. Przez umowę sprzedaży/)
  assert.match(doc.note, /as published/)
  await assert.rejects(ls.get({ source: 'sejm', ref: 'DU/1964/93', article: '9999' }), (err) => /Art\. 9999 was not found/.test(err.plain))
  await assert.rejects(ls.get({ source: 'sejm', ref: '../etc' }), (err) => /give the act/.test(err.plain))
})

test('SAOS: newest judgments first, by case number, the full judgment with its court; community source', async () => {
  setPolicy(['web'])
  let r = await ls.search({ query: 'rękojmia za wady', jurisdiction: 'PL', kind: 'caselaw' })
  assert.deepStrictEqual(r.searched, ['saos'])
  const hit = r.results[0]
  assert.match(hit.title, /^Sąd Okręgowy w Łodzi, \d\d\.\d\d\.\d{4}, [IVX]+ \w+ \d+\/\d+ \(\w+\)$/)
  assert.match(hit.citation, /^Sąd Okręgowy w Łodzi, \d\d\.\d\d\.\d{4}, .* \(SAOS \d+\)$/)
  assert.strictEqual(hit.url, `https://www.saos.org.pl/judgments/${hit.ref}`)
  assert.ok(!/<em>/.test(hit.snippet))
  let q = new URL(seen.filter((s) => s.path.startsWith('/saos/search')).at(-1).path, 'http://x').searchParams
  assert.deepStrictEqual([q.get('all'), q.get('sortingField'), q.get('sortingDirection')], ['rękojmia za wady', 'JUDGMENT_DATE', 'DESC'])
  await ls.search({ query: 'I ACa 756/12', sources: ['saos'] })
  q = new URL(seen.filter((s) => s.path.startsWith('/saos/search')).at(-1).path, 'http://x').searchParams
  assert.strictEqual(q.get('caseNumber'), 'I ACa 756/12')
  const doc = await ls.get({ source: 'saos', ref: '551289' })
  assert.match(doc.text, /^Sąd Okręgowy w Łodzi, 25\.08\.2026, VIII U 3041\/24 \(uzasadnienie\)\n/)
  assert.match(doc.text, /Legal bases: art\. 627 kc/)
  assert.match(doc.text, /UZASADNIENIE/)
  assert.ok(!/<span|<p>/.test(doc.text))
  assert.match(doc.note, /court's own publication: https:\/\//)
  assert.match(doc.licence, /states no licence/)
  await assert.rejects(ls.get({ source: 'saos', ref: 'x1' }), (err) => /number of a judgment/.test(err.plain))
})

test('legislatie.just.ro: GetToken then Search, by number and year; one article; the token is reused', async () => {
  setPolicy(['web'])
  const mark = seen.length
  let r = await ls.search({ query: 'Legea nr. 31/1991', jurisdiction: 'RO' })
  assert.deepStrictEqual(r.searched, ['rolegis'])
  const law = r.results.find((x) => x.ref === '1480/31/1991')
  assert.ok(law, 'the law is among the hits')
  assert.match(law.title, /^LEGE nr\. 31 din 22 martie 1991 privind stabilirea duratei timpului de muncă/)
  assert.ok(!/EMITENT/.test(law.title))
  assert.deepStrictEqual([law.citation, law.url, law.date], ['Legea nr. 31/1991 (legislatie.just.ro 1480)', 'http://legislatie.just.ro/Public/DetaliiDocument/1480', '1991-05-26'])
  assert.match(law.snippet, /^Articolul 1/)
  const hg = r.results.find((x) => x.ref === '17166/31/1991')
  assert.match(hg.snippet, /not published the text/)
  const calls = seen.slice(mark).filter((s) => s.path === '/rolegis/SOAP')
  assert.deepStrictEqual(calls.map((c) => c.headers.soapaction), ['"http://tempuri.org/IFreeWebService/GetToken"', '"http://tempuri.org/IFreeWebService/Search"'])
  assert.match(calls[1].body, /<a:SearchAn>1991<\/a:SearchAn><a:SearchNumar>31<\/a:SearchNumar>/)
  require('../src/connectors/rolegis')._reset() // a new session: opening by reference searches again
  const doc = await ls.get({ source: 'rolegis', ref: '1480/31/1991', article: '2' })
  assert.match(doc.text, /^Articolul 2 \(1\) Stabilirea categoriilor de personal/)
  assert.ok(!/Articolul 3|Articolul 1 /.test(doc.text))
  assert.strictEqual(doc.citation, 'art. 2 din Legea nr. 31/1991 (legislatie.just.ro 1480)')
  assert.match(doc.note, /forma consolidată/)
  await ls.search({ query: 'timpului de muncă', sources: ['rolegis'] })
  assert.strictEqual(seen.slice(mark).filter((s) => /GetToken/.test(s.headers.soapaction || '')).length, 2, 'one token per session, reused for the next search')
  await assert.rejects(ls.get({ source: 'rolegis', ref: '17166/31/1991' }), (err) => /not published the text/.test(err.plain))
  await assert.rejects(ls.get({ source: 'rolegis', ref: '999/31/1991' }), (err) => /has no such document/.test(err.plain))
  assert.deepStrictEqual((await ls.search({ query: 'zzzz', sources: ['rolegis'] })).results, [])
})

test('Romanian community data: opt-in, size first, download only after yes, then searched on this computer', async () => {
  setPolicy(['web'])
  const c = ls.connector('rodata')
  let r = await ls.search({ query: 'codul muncii', jurisdiction: 'RO' })
  assert.ok(!r.searched.includes('rodata'), 'off by default')
  ls.setEnabled('rodata', true)
  let st = (await ls.status()).find((s) => s.id === 'rodata')
  assert.strictEqual(st.status, 'Romanian law (community data, no licence file): community data, no licence file: download it first (opt-in) (community source)')
  r = await ls.search({ query: 'codul muncii', jurisdiction: 'RO' })
  assert.ok(!r.searched.includes('rodata'), 'nothing to search before the download')
  const plan = await ls.downloadPlan('rodata', 'documents')
  assert.strictEqual(plan.bytes, fixture('documents.parquet').length)
  assert.match(plan.label, /community data of 2026-10-29 \(no licence file\)/)
  assert.match(plan.licence, /No licence file/)
  assert.ok(!seen.some((s) => s.path.startsWith('/dl/')), 'the plan downloads nothing')
  await assert.rejects(ls.download('rodata', 'documents'), (err) => err.code === 'confirm')
  let job = await ls.download('rodata', 'documents', { confirm: true })
  for (let i = 0; i < 300 && job.state === 'running'; i++) { await new Promise((ok) => setTimeout(ok, 20)); job = ls.downloadStatus('rodata', 'documents') }
  assert.strictEqual(job.state, 'done', job.error)
  assert.deepStrictEqual([job.done, job.total], [3, 3], 'progress counts the acts indexed')
  st = (await ls.status()).find((s) => s.id === 'rodata')
  assert.strictEqual(st.state, 'ready')
  assert.match(st.status, /community source\), your copy of 2026-10-29$/)
  assert.deepStrictEqual(st.local.items.map((x) => [x.part, x.updated, x.stale]), [['documents', '2026-10-29', st.local.items[0].stale]])
  // Searched locally: works even when the data rule keeps OpenLex offline.
  setPolicy(null)
  const before = seen.length
  r = await ls.search({ query: 'codul muncii raporturilor', sources: ['rodata'] })
  assert.strictEqual(seen.length, before, 'nothing left this computer')
  assert.deepStrictEqual([r.results[0].ref, r.results[0].citation, r.results[0].url], ['41627', 'Legea 53/2003 (community data, legislatie.just.ro 41627)', 'https://legislatie.just.ro/Public/DetaliiDocument/41627'])
  assert.match(r.notes[0].note, /local copy of the community data of 2026-10-29 \(no licence file\)/)
  const doc = await ls.get({ source: 'rodata', ref: '41627', article: '2' })
  assert.match(doc.text, /^Articolul 2\nDispozițiile cuprinse în prezentul cod/)
  assert.ok(!/Articolul 3/.test(doc.text))
  assert.strictEqual(doc.citation, 'art. 2 din Legea 53/2003 (community data, legislatie.just.ro 41627)')
  const old = await ls.get({ source: 'rodata', ref: '1', article: '2' })
  assert.match(old.text, /^Art\. 2\nLegea dispune numai pentru viitor\.$/)
  await assert.rejects(ls.get({ source: 'rodata', ref: '777' }), (err) => /no such document in your copy/.test(err.plain))
  // Removed from /law: gone from this computer.
  setPolicy(['web'])
  await ls.removeDownload('rodata', 'documents')
  assert.ok(!fs.existsSync(require('../src/connectors/localdata').dirOf('rodata', 'documents')))
  assert.strictEqual((await ls.status()).find((s) => s.id === 'rodata').state, 'needs_setup')
  assert.strictEqual(typeof c.local.plan, 'function')
  ls.setEnabled('rodata', false)
})

test('offline, a source down, or the data rule: a plain sentence, no crash', async () => {
  setPolicy(null)
  let r = await ls.search({ query: 'kodeks cywilny', jurisdiction: 'PL' })
  assert.deepStrictEqual(r.searched, [])
  assert.match(r.skipped[0].reason, /keeps OpenLex offline/)
  setPolicy(['web'])
  down = new Set(['saos'])
  r = await ls.search({ query: 'rękojmia', jurisdiction: 'PL' })
  assert.ok(r.results.length && r.results.every((x) => x.source === 'sejm'))
  assert.strictEqual(r.skipped.find((s) => s.source === 'saos').reason, 'SAOS (Polish court judgments) is not answering right now; try again later')
  down = new Set(['rolegis'])
  r = await ls.search({ query: '31/1991', sources: ['rolegis'] })
  assert.strictEqual(r.skipped[0].reason, 'legislatie.just.ro (Romania) is not answering right now; try again later')
  down = new Set()
  const saved = process.env.OPENLEX_SEJM_API
  process.env.OPENLEX_SEJM_API = 'http://127.0.0.1:9'
  try {
    r = await ls.search({ query: 'kodeks cywilny', sources: ['sejm'] })
    assert.match(r.skipped[0].reason, /could not be reached \(no internet connection, or the service is down\)/)
  } finally { process.env.OPENLEX_SEJM_API = saved }
})

// ── optional live checks (free, no key) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET }, async () => {
  for (const k of ['OPENLEX_SEJM_API', 'OPENLEX_SAOS_API', 'OPENLEX_ROLEGIS_API', 'OPENLEX_RODATA_API']) delete process.env[k]
  await fn()
})
live('Sejm ELI', async () => {
  const r = await require('../src/connectors/sejm').search('kodeks cywilny', { limit: 3 })
  assert.strictEqual(r[0].ref, 'DU/1964/93')
  const d = await require('../src/connectors/sejm').get('DU/1964/93', { article: '535' })
  assert.match(d.text, /^Art\. 535\. Przez umowę sprzedaży/)
})
live('SAOS', async () => {
  const r = await require('../src/connectors/saos').search('rękojmia za wady', { limit: 2 })
  assert.ok(r.length && /^\d+$/.test(r[0].ref))
})
live('legislatie.just.ro (SOAP)', async () => {
  const r = await require('../src/connectors/rolegis').search('31/1991', { limit: 3 })
  assert.ok(r.some((x) => x.ref === '1480/31/1991'))
})
live('Romanian community data (release listing only, nothing downloaded)', async () => {
  const p = await require('../src/connectors/rodata').local.plan()
  assert.ok(p.bytes > 100e6 && /\/documents\.parquet$/.test(p.from))
})
