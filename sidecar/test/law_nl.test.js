"use strict"
/**
 * Dutch law sources: statutes from the Basiswettenbestand (bwb: SRU search +
 * the repository XML) and case law from data.rechtspraak.nl (rechtspraak:
 * by ECLI). Offline: one local fake server answers with responses recorded
 * from the real services (test/fixtures/law-sources/nl). No keys.
 *
 *   node --test test/law_nl.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_nl.test.js   # + one live look-up per source
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-nl-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources', 'nl')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

const seen = []
let down = new Set()
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  seen.push({ path: req.url, query: u.searchParams })
  const src = u.pathname.split('/')[1]
  if (down.has(src)) { res.writeHead(503); return res.end() }
  const xml = (s, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/xml; charset=utf-8' }); res.end(s) }
  if (u.pathname === '/bwbsru') {
    const q = u.searchParams.get('query') || ''
    if (/unsupportedindex/.test(q)) return xml(fixture('bwb-sru-diag.xml'))
    if (/dcterms\.identifier = BWBR0005289/.test(q)) return xml(fixture('bwb-sru-id.xml'))
    if (/dcterms\.identifier = /.test(q)) return xml('<?xml version="1.0"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.2</version><numberOfRecords>0</numberOfRecords><records/></searchRetrieveResponse>')
    return xml(fixture('bwb-sru-search.xml'))
  }
  if (u.pathname.startsWith('/bwbrepo/bwb/BWBR0005289/')) return xml(fixture('bwb-bw6-toestand.xml'))
  if (u.pathname === '/rs/uitspraken/content') {
    const id = u.searchParams.get('id')
    if (id !== 'ECLI:NL:HR:2019:1734') { res.writeHead(404); return res.end() }
    return xml(fixture(u.searchParams.get('return') === 'META' ? 'rechtspraak-hr-2019-1734-meta.xml' : 'rechtspraak-hr-2019-1734.xml'))
  }
  res.writeHead(404); res.end()
})

let ls, policy
const mem = new Map()
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, { OPENLEX_BWB_SRU: `${base}/bwbsru`, OPENLEX_BWB_REPO: `${base}/bwbrepo`, OPENLEX_RECHTSPRAAK_API: `${base}/rs` })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  policy = require('../src/policy')
  ls._setStore({ get: async (n) => mem.get(n) ?? null, set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { down = new Set(); policy.setRule(null, { mode: 'allow-list', providers: ['web'] }) })

test('both connectors have the one interface and are on by default (no key)', async () => {
  for (const id of ['bwb', 'rechtspraak']) {
    const c = ls.connector(id)
    for (const k of ['id', 'label', 'country', 'kind', 'description', 'licence', 'homepage', 'guide', 'sample']) assert.ok(typeof c[k] === 'string' && c[k], `${id}.${k}`)
    assert.ok(c.hosts.length && c.de.label && c.de.description && c.needsKey === false)
  }
  const st = await ls.status()
  assert.strictEqual(st.find((s) => s.id === 'bwb').status, 'Dutch law (BWB): connected, free')
  assert.strictEqual(st.find((s) => s.id === 'bwb').statusDe, 'Niederländisches Recht (BWB): verbunden, kostenlos')
  assert.strictEqual(st.find((s) => s.id === 'rechtspraak').status, 'Dutch case law (rechtspraak.nl): connected, free')
  policy.setRule(null, { mode: 'local-only' })
  assert.match((await ls.status()).find((s) => s.id === 'bwb').status, /free, but your client-data rule keeps OpenLex offline$/)
  const before = seen.length
  const r = await ls.search({ query: 'huurovereenkomst', jurisdiction: 'NL' })
  assert.strictEqual(seen.length, before, 'privileged / local-only: nothing leaves this computer')
  assert.match(r.skipped.find((s) => s.source === 'bwb').reason, /keeps OpenLex offline/)
})

test('BWB: title search (version in force today), the law before its amending acts, provenance', async () => {
  const r = await ls.search({ query: 'burgerlijk wetboek', jurisdiction: 'NL' })
  assert.ok(r.searched.includes('bwb'))
  const hits = r.results.filter((x) => x.source === 'bwb')
  assert.ok(hits.length >= 3)
  assert.ok(hits.every((h) => /^Burgerlijk Wetboek Boek \d/.test(h.title)), hits.map((h) => h.title).join(' | '))
  const b6 = hits.find((h) => h.ref === 'BWBR0005289')
  assert.strictEqual(b6.citation, 'Burgerlijk Wetboek Boek 6 (BWB, BWBR0005289)')
  assert.match(b6.url, /^https:\/\/wetten\.overheid\.nl\/BWBR0005289\/\d{4}-\d\d-\d\d$/)
  assert.match(b6.snippet, /version in force from \d{4}-\d\d-\d\d/)
  assert.strictEqual(b6.inForce, true)
  assert.match(b6.licence, /CC0/)
  assert.match(b6.retrieved, /^\d{4}-\d\d-\d\dT/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  const q = seen.filter((s) => s.path.startsWith('/bwbsru')).at(-1).query
  assert.strictEqual(q.get('x-connection'), 'BWB')
  assert.match(q.get('query'), /^overheidbwb\.titel all "burgerlijk wetboek" and overheidbwb\.geldigheidsdatum = "\d{4}-\d\d-\d\d"$/)
})

test('BWB: "6:162 BW" finds the book and the article; one article with its anchor', async () => {
  const r = await ls.search({ query: 'art. 6:162 BW', sources: ['bwb'] })
  assert.deepStrictEqual([r.results[0].ref, r.results[0].citation], ['BWBR0005289', 'art. 6:162 BW (BWB, BWBR0005289)'])
  assert.match(seen.filter((s) => s.path.startsWith('/bwbsru')).at(-1).query.get('query'), /^dcterms\.identifier = BWBR0005289 and /)
  const doc = await ls.get({ source: 'bwb', ref: 'BWBR0005289', article: '6:162' })
  assert.match(doc.text, /^Artikel 162\n1\. Hij die jegens een ander een onrechtmatige daad pleegt/)
  assert.match(doc.text, /\n3\. Een onrechtmatige daad kan aan de dader worden toegerekend/)
  assert.ok(!/Artikel 163|Artikel 161/.test(doc.text), 'only that article')
  assert.ok(!/jci1\.3|Stb\./.test(doc.text), 'no metadata')
  assert.strictEqual(doc.citation, 'art. 6:162 BW (BWB, BWBR0005289)')
  assert.match(doc.url, /#Boek6_Titeldeel3_Afdeling1_Artikel162$/)
  assert.strictEqual(doc.notice, 'Check the official version before relying on it.')
  assert.strictEqual((await ls.get({ source: 'bwb', ref: 'BWBR0005289', article: 'Artikel 163' })).citation, 'art. 6:163 BW (BWB, BWBR0005289)')
  await assert.rejects(ls.get({ source: 'bwb', ref: 'BWBR0005289', article: '999' }), (err) => /Artikel 999 was not found in Burgerlijk Wetboek Boek 6/.test(err.plain))
  await assert.rejects(ls.get({ source: 'bwb', ref: '../etc' }), (err) => /BWBR/.test(err.plain))
  await assert.rejects(ls.get({ source: 'bwb', ref: 'BWBR0000001' }), (err) => /has no such document/.test(err.plain))
  const whole = await ls.get({ source: 'bwb', ref: 'BWBR0005289' })
  assert.match(whole.text, /^Burgerlijk Wetboek Boek 6, Verbintenissenrecht\n/)
})

test('rechtspraak: by ECLI only (plain hint otherwise), full text with the summary first', async () => {
  let r = await ls.search({ query: 'slapend dienstverband', sources: ['rechtspraak'] })
  assert.deepStrictEqual(r.searched, [])
  assert.match(r.skipped[0].reason, /no search by words: give the ECLI/)
  r = await ls.search({ query: 'zie ECLI:NL:HR:2019:1734.', jurisdiction: 'NL' })
  assert.ok(r.searched.includes('rechtspraak'))
  const hit = r.results.find((x) => x.source === 'rechtspraak')
  assert.deepStrictEqual([hit.ref, hit.citation, hit.title, hit.date], ['ECLI:NL:HR:2019:1734', 'Hoge Raad 08-11-2019, ECLI:NL:HR:2019:1734', 'Hoge Raad, 08-11-2019, 19/01873', '2019-11-08'])
  assert.strictEqual(hit.url, 'https://uitspraken.rechtspraak.nl/details?id=ECLI%3ANL%3AHR%3A2019%3A1734')
  assert.match(hit.snippet, /^Civiel recht; Arbeidsrecht/)
  assert.match(hit.licence, /Public Domain Mark/)
  assert.strictEqual(seen.filter((s) => s.path.startsWith('/rs/')).at(-1).query.get('return'), 'META', 'search reads metadata only')
  assert.deepStrictEqual((await ls.search({ query: 'ECLI:NL:HR:2099:1', sources: ['rechtspraak'] })).results, [], 'an unknown ECLI is simply not found')
  const doc = await ls.get({ source: 'rechtspraak', ref: 'ECLI:NL:HR:2019:1734' })
  assert.match(doc.text, /^Inhoudsindicatie\nPrejudiciële vragen \(art\. 392 Rv\)/)
  assert.match(doc.text, /\nHOGE RAAD DER NEDERLANDEN\nCIVIELE KAMER\n/)
  assert.match(doc.text, /\n2 Beantwoording van de prejudiciële vragen\n/)
  assert.ok(!/<|rdf:|Vindplaatsen/.test(doc.text))
  assert.strictEqual(doc.citation, 'Hoge Raad 08-11-2019, ECLI:NL:HR:2019:1734')
  await assert.rejects(ls.get({ source: 'rechtspraak', ref: 'HR 8 november 2019' }), (err) => /give the ECLI/.test(err.plain))
  await assert.rejects(ls.get({ source: 'rechtspraak', ref: 'ECLI:NL:HR:2099:1' }), (err) => /has no such document/.test(err.plain))
})

test('a source down or no connection: one plain sentence, no crash', async () => {
  down = new Set(['bwbsru'])
  let r = await ls.search({ query: 'burgerlijk wetboek', sources: ['bwb'] })
  assert.strictEqual(r.skipped[0].reason, 'Dutch law (BWB) is not answering right now; try again later')
  down = new Set(['rs'])
  await assert.rejects(ls.get({ source: 'rechtspraak', ref: 'ECLI:NL:HR:2019:1734' }), (err) => err.plain === 'Dutch case law (rechtspraak.nl) is not answering right now; try again later')
  down = new Set()
  const saved = process.env.OPENLEX_BWB_SRU
  process.env.OPENLEX_BWB_SRU = 'http://127.0.0.1:9/sru'
  try {
    r = await ls.search({ query: 'burgerlijk wetboek', sources: ['bwb'] })
    assert.match(r.skipped[0].reason, /could not be reached \(no internet connection, or the service is down\)/)
  } finally { process.env.OPENLEX_BWB_SRU = saved }
})

test('BWB: an SRU diagnostic (a query the service cannot run) becomes one plain sentence', async () => {
  await assert.rejects(require('../src/connectors/bwb').search('unsupportedindex'), (err) => err.plain === 'Dutch law (BWB) could not run this search')
})

// ── optional live checks (free, no key) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET }, async () => {
  for (const k of ['OPENLEX_BWB_SRU', 'OPENLEX_BWB_REPO', 'OPENLEX_RECHTSPRAAK_API']) delete process.env[k]
  await fn()
})
live('BWB (SRU + repository)', async () => {
  const bwb = require('../src/connectors/bwb')
  const r = await bwb.search('6:162 BW')
  assert.strictEqual(r[0].ref, 'BWBR0005289')
  const d = await bwb.get('BWBR0005289', { article: '6:162' })
  assert.match(d.text, /onrechtmatige daad/)
})
live('rechtspraak.nl open data', async () => {
  const rs = require('../src/connectors/rechtspraak')
  const r = await rs.search('ECLI:NL:HR:2019:1734')
  assert.strictEqual(r[0].ref, 'ECLI:NL:HR:2019:1734')
})
