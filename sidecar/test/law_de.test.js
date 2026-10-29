"use strict"
/**
 * German law sources: Open Legal Data (case law, community source), NeuRIS
 * (federal statutes and federal court decisions) and gesetze-im-internet.de
 * (federal laws: online per question, or a local copy for the offline
 * mode). One local fake server answers with responses recorded from the
 * real services (test/fixtures/law-sources/de) and tiny zip files built
 * here. No live calls, no keys.
 *
 *   node --test test/law_de.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_de.test.js   # + one live look-up per source
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const zlib = require('zlib')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-de-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

// ── a tiny zip writer (one deflated file), for the gesetze-im-internet.de fakes ──
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function zip(name, text) {
  const data = Buffer.from(text, 'utf8')
  const comp = zlib.deflateRawSync(data)
  const n = Buffer.from(name)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42)
  const body = Buffer.concat([local, n, comp])
  const cd = Buffer.concat([central, n])
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, cd, end])
}
const norm = (inner) => `<norm builddate="20261028" doknr="X">${inner}</norm>`
const lawXml = (abk, title, sections) => `<?xml version="1.0" encoding="UTF-8" ?><dokumente>${norm(`<metadaten><jurabk>${abk}</jurabk><amtabk>${abk}</amtabk><ausfertigung-datum>1896-08-18</ausfertigung-datum><langue>${title}</langue><standangabe checked="ja"><standtyp>Neuf</standtyp><standkommentar>Neugefasst durch Bek. v. 2.1.2002 I 42</standkommentar></standangabe><standangabe checked="ja"><standtyp>Stand</standtyp><standkommentar>Zuletzt geändert durch Art. 1 G v. 1.10.2026 I Nr. 300</standkommentar></standangabe></metadaten><textdaten><text format="XML"><Content><P><noindex>Hinweis</noindex></P></Content></text></textdaten>`)}${norm('<metadaten><jurabk>X</jurabk><gliederungseinheit><gliederungskennzahl>010</gliederungskennzahl><gliederungsbez>Buch 2</gliederungsbez><gliederungstitel>Recht der Schuldverhältnisse</gliederungstitel></gliederungseinheit></metadaten><textdaten><text format="XML"/></textdaten>')}${sections.map(([num, head, text]) => norm(`<metadaten><jurabk>${abk}</jurabk><enbez>${num}</enbez><titel format="parat">${head}</titel></metadaten><textdaten><text format="XML"><Content>${text.map((p) => `<P>${p}</P>`).join('')}</Content></text></textdaten>`)).join('')}</dokumente>`
const ZIPS = {
  bgb: zip('BJNR001950896.xml', lawXml('BGB', 'Bürgerliches Gesetzbuch', [
    ['§ 433', 'Vertragstypische Pflichten beim Kaufvertrag', ['(1) Durch den Kaufvertrag wird der Verkäufer einer Sache verpflichtet, dem Käufer die Sache zu übergeben und das Eigentum an der Sache zu verschaffen.', '(2) Der Käufer ist verpflichtet, dem Verkäufer den vereinbarten Kaufpreis zu zahlen.']],
    ['§ 434', 'Sachmangel', ['(1) Die Sache ist frei von Sachmängeln, wenn sie bei Gefahrübergang den subjektiven Anforderungen … entspricht.']],
  ])),
  uwg_2004: zip('BJNR141400004.xml', lawXml('UWG', 'Gesetz gegen den unlauteren Wettbewerb', [['§ 3', 'Verbot unlauterer geschäftlicher Handlungen', ['(1) Unlautere geschäftliche Handlungen sind unzulässig.']]])),
}
const TOC = `<?xml version="1.0" encoding="UTF-8" ?><items>
<item>
<title>Bürgerliches Gesetzbuch</title>
<link>http://www.gesetze-im-internet.de/bgb/xml.zip</link>
</item>
<item>
<title>Gesetz gegen den unlauteren Wettbewerb</title>
<link>http://www.gesetze-im-internet.de/uwg_2004/xml.zip</link>
</item>
<item>
<title>Gesetz über die Ausprägung einer 1-DM-Goldmünze und die Errichtung der Stiftung &quot;Geld und Währung&quot;</title>
<link>http://www.gesetze-im-internet.de/1-dm-goldm_nzg/xml.zip</link>
</item>
</items>`

const seen = []
let down = new Set()
const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const p = u.pathname
    seen.push({ path: req.url, method: req.method, headers: req.headers })
    const src = p.split('/')[1]
    if (down.has(src)) { res.writeHead(503); return res.end() }
    const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)) }
    // Open Legal Data
    if (src === 'oldp') {
      const auth = req.headers.authorization
      if (auth && auth !== 'Token good-token-0123456789abcdef') return json({ detail: 'Invalid token.' }, 401)
      if (p === '/oldp/api/cases/search/') return json(fixture('de/oldp-search.json'))
      if (p === '/oldp/api/cases/426410/') return json(fixture('de/oldp-case.json'))
      return json({ detail: 'Not found.' }, 404)
    }
    // NeuRIS
    if (p === '/neuris/v1/legislation') return json(fixture('neuris-search.json'))
    if (p === '/neuris/v1/rechtsprechung') return json(fixture('de/neuris-caselaw-search.json'))
    if (p === '/neuris/v1/rechtsprechung/KORE303362011') return json(fixture('de/neuris-decision.json'))
    if (p.startsWith('/neuris/')) return json({}, 404)
    // gesetze-im-internet.de
    if (p === '/gii/gii-toc.xml') { res.writeHead(200, { 'Content-Type': 'text/xml' }); return res.end(TOC) }
    const m = p.match(/^\/gii\/([^/]+)\/xml\.zip$/)
    if (m && ZIPS[m[1]]) {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': ZIPS[m[1]].length })
      return res.end(req.method === 'HEAD' ? undefined : ZIPS[m[1]])
    }
    res.writeHead(404); res.end()
  })
})

const mem = new Map()
let ls, gii
const setPolicy = (providers) => require('../src/policy').setRule(null, providers ? { mode: 'allow-list', providers } : { mode: 'local-only' })

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, { OPENLEX_OLDP_API: `${base}/oldp`, OPENLEX_NEURIS_API: `${base}/neuris`, OPENLEX_GII_BASE: `${base}/gii` })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  gii = require('../src/connectors/gii')
  ls._setStore({ get: async (n) => mem.get(n) ?? null, set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
})
test.after(() => { fake.close(); gii._reset(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { down = new Set(); mem.clear() })

test('the three German sources have the one interface and German words for /law', () => {
  for (const id of ['openlegaldata', 'neuris', 'gii']) {
    const c = ls.connector(id)
    for (const k of ['id', 'label', 'country', 'kind', 'description', 'licence', 'homepage', 'sample']) assert.ok(typeof c[k] === 'string' && c[k], `${id}.${k}`)
    assert.ok(c.de?.label && c.de?.description, `${id}.de`)
    assert.deepStrictEqual(c.jurisdictions, ['DE'])
  }
  assert.deepStrictEqual([ls.connector('openlegaldata').kind, ls.connector('neuris').kind, ls.connector('gii').kind], ['caselaw', 'law+caselaw', 'law'])
  assert.ok(ls.connector('openlegaldata').community && !ls.connector('neuris').community && !ls.connector('gii').community)
})

test('status: plain words in English and German; Open Legal Data says it is a community source', async () => {
  setPolicy(['web'])
  const st = await ls.status()
  const o = st.find((s) => s.id === 'openlegaldata')
  assert.strictEqual(o.status, 'Open Legal Data (German case law): connected, free (community source)')
  assert.strictEqual(o.statusDe, 'Open Legal Data (deutsche Rechtsprechung): verbunden, kostenlos (Community-Quelle)')
  assert.strictEqual(o.optionalKey, true)
  assert.strictEqual(st.find((s) => s.id === 'gii').status, 'German federal laws (gesetze-im-internet.de): connected, free')
  assert.strictEqual(st.find((s) => s.id === 'gii').statusDe, 'Bundesgesetze (gesetze-im-internet.de): verbunden, kostenlos')
  assert.strictEqual(st.find((s) => s.id === 'neuris').statusDe, 'Bundesrecht Deutschland (NeuRIS): verbunden, kostenlos (Testphase, Lizenz noch nicht veröffentlicht)')
  setPolicy(null)
  assert.match((await ls.status()).find((s) => s.id === 'openlegaldata').status, /free, but your client-data rule keeps OpenLex offline$/)
})

test('Open Legal Data: full-text search with snippets, one decision in full, with provenance', async () => {
  setPolicy(['web'])
  const r = await ls.search({ query: 'Kaufvertrag Mangel', sources: ['openlegaldata'] })
  assert.deepStrictEqual(r.searched, ['openlegaldata'])
  const hit = r.results[0]
  assert.deepStrictEqual([hit.source, hit.ref, hit.title], ['openlegaldata', '426410', 'OLGTH, Urteil, 30.10.2014'])
  assert.strictEqual(hit.citation, 'OLGTH, Urteil vom 30.10.2014 (Open Legal Data, 426410)')
  assert.strictEqual(hit.url, 'https://de.openlegaldata.io/case/olgth-2014-10-30-1-u-86212')
  assert.match(hit.snippet, /Mangel bei Abschluss des Kaufvertrages/)
  assert.ok(!/<em>/.test(hit.snippet))
  assert.match(hit.licence, /§ 5 UrhG/)
  assert.match(hit.retrieved, /^\d{4}-\d\d-\d\dT/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  const q = new URL(seen.filter((s) => s.path.startsWith('/oldp/api/cases/search/')).at(-1).path, 'http://x').searchParams
  assert.strictEqual(q.get('text'), 'Kaufvertrag Mangel')
  const doc = await ls.get({ source: 'openlegaldata', ref: hit.ref })
  assert.match(doc.title, /^Thüringer Oberlandesgericht Urteil vom 30\.10\.2014 – 1 U 862\/12$/)
  assert.match(doc.citation, /^Thüringer Oberlandesgericht, Urteil vom 30\.10\.2014 – 1 U 862\/12.*\(Open Legal Data, 426410\)$/)
  assert.ok(doc.text.length > 500 && !/<p>|&#/.test(doc.text))
  assert.strictEqual(doc.note, undefined, 'this decision names no court page (source_url is empty in the record)')
  assert.strictEqual(doc.notice, 'Check the official version before relying on it.')
  await assert.rejects(ls.get({ source: 'openlegaldata', ref: '../x' }), (err) => /number from a search result/.test(err.plain))
})

test('Open Legal Data: the optional token goes in the header; a wrong one is said plainly', async () => {
  setPolicy(['web'])
  await assert.rejects(ls.setKey('openlegaldata', 'short'), (err) => /does not look like an API token/.test(err.plain))
  await ls.setKey('openlegaldata', 'good-token-0123456789abcdef')
  let r = await ls.search({ query: 'Kaufvertrag', sources: ['openlegaldata'] })
  assert.strictEqual(r.results.length, 2)
  assert.strictEqual(seen.filter((s) => s.path.startsWith('/oldp/')).at(-1).headers.authorization, 'Token good-token-0123456789abcdef')
  assert.strictEqual((await ls.status()).find((s) => s.id === 'openlegaldata').status, 'Open Legal Data (German case law): connected, free (with your key) (community source)')
  mem.set('source-openlegaldata', 'wrong-token-0123456789abcdef')
  r = await ls.search({ query: 'Kaufvertrag', sources: ['openlegaldata'] })
  assert.match(r.skipped[0].reason, /did not accept the key/)
})

test('NeuRIS: statutes first, then federal court decisions; a decision in full', async () => {
  setPolicy(['web'])
  const r = await ls.search({ query: 'Kaufvertrag', sources: ['neuris'], limit: 4 })
  assert.deepStrictEqual(r.results.map((x) => x.ref), ['eli/bund/bgbl-1/1995/s2072/2021-08-10/1/deu', r.results[1].ref, 'KORE303962012', 'KORE303362011'])
  assert.ok(r.results[1].ref.startsWith('eli/bund/'))
  const dec = r.results[3]
  assert.strictEqual(dec.citation, 'BGH, Urteil vom 13.04.2011 – VIII ZR 220/10 (NeuRIS, KORE303362011)')
  assert.strictEqual(dec.url, 'https://testphase.rechtsinformationen.bund.de/gerichtsentscheidungen/KORE303362011')
  assert.strictEqual(dec.title, 'BGH, Urteil vom 13. April 2011 - VIII ZR 220/10 (Kaufvertrag: Erfüllungsort der Nacherfüllung)')
  assert.match(dec.snippet, /^Die in Frankreich wohnhaften Kläger erwarben mit Kaufvertrag/)
  assert.ok(!/<mark>/.test(dec.snippet))
  const doc = await ls.get({ source: 'neuris', ref: 'KORE303362011' })
  assert.match(doc.text, /^Leitsatz\n1\. Der Erfüllungsort der Nacherfüllung/)
  assert.match(doc.text, /\n\nTenor\nDie Revision der Kläger/)
  assert.match(doc.text, /\n\nEntscheidungsgründe\nDie Revision hat keinen Erfolg/)
  assert.strictEqual(doc.citation, 'BGH, Urteil vom 13.04.2011 – VIII ZR 220/10 (NeuRIS, KORE303362011)')
  assert.match(doc.licence, /and so are court decisions/)
  // Case law not answering: the statutes still come back.
  down = new Set()
  const neuris = require('../src/connectors/neuris')
  const only = await neuris.search('Kaufvertrag', { limit: 3, kind: 'law' })
  assert.ok(only.every((x) => x.ref.startsWith('eli/')))
  const cases = await neuris.search('Kaufvertrag', { limit: 3, kind: 'caselaw' })
  assert.ok(cases.every((x) => /^KORE/.test(x.ref)))
})

test('gesetze-im-internet.de online: a law by abbreviation, one §, title words; the list is kept for a day', async () => {
  setPolicy(['web'])
  const mark = seen.length
  let r = await ls.search({ query: '§ 433 BGB', sources: ['gii'] })
  assert.strictEqual(r.results[0].ref, 'bgb § 433')
  assert.strictEqual(r.results[0].citation, '§ 433 BGB (gesetze-im-internet.de)')
  assert.strictEqual(r.results[0].url, 'https://www.gesetze-im-internet.de/bgb/__433.html')
  r = await ls.search({ query: 'unlauteren Wettbewerb', sources: ['gii'] })
  assert.deepStrictEqual([r.results[0].ref, r.results[0].title], ['uwg_2004', 'Gesetz gegen den unlauteren Wettbewerb'])
  r = await ls.search({ query: 'UWG', sources: ['gii'] })
  assert.strictEqual(r.results[0].ref, 'uwg_2004', 'an abbreviation finds the law with a year in its address')
  assert.strictEqual(seen.slice(mark).filter((s) => s.path === '/gii/gii-toc.xml').length, 1, 'the list is fetched once and kept')
  let doc = await ls.get({ source: 'gii', ref: 'bgb § 433' })
  assert.match(doc.text, /^§ 433 Vertragstypische Pflichten beim Kaufvertrag\n\(1\) Durch den Kaufvertrag/)
  assert.ok(!/§ 434/.test(doc.text))
  assert.deepStrictEqual([doc.citation, doc.url, doc.title], ['§ 433 BGB (gesetze-im-internet.de)', 'https://www.gesetze-im-internet.de/bgb/__433.html', 'BGB – Bürgerliches Gesetzbuch'])
  assert.strictEqual(doc.note, 'Zuletzt geändert durch Art. 1 G v. 1.10.2026 I Nr. 300')
  doc = await ls.get({ source: 'gii', ref: '§ 434 BGB' })
  assert.match(doc.text, /^§ 434 Sachmangel/)
  doc = await ls.get({ source: 'gii', ref: 'BGB' })
  assert.match(doc.text, /^Buch 2 Recht der Schuldverhältnisse\n\n§ 433/)
  await assert.rejects(ls.get({ source: 'gii', ref: 'bgb', article: '9999' }), (err) => err.plain === 'gesetze-im-internet.de: § 9999 was not found in BGB')
  await assert.rejects(ls.get({ source: 'gii', ref: '../../etc' }), (err) => /abbreviation/.test(err.plain))
})

test('gesetze-im-internet.de offline mode: size first, yes, progress, then search and read without going online; removable', async () => {
  setPolicy(['web'])
  const plan = await ls.downloadPlan('gii', 'all')
  assert.strictEqual(plan.part, 'all')
  assert.ok(plan.estimate && plan.bytes > 0)
  assert.match(plan.size, /^about \d/)
  assert.match(plan.label, /3 laws and regulations/)
  assert.match(plan.from, /gesetze-im-internet\.de/)
  await assert.rejects(ls.download('gii', 'all'), (err) => /confirm/i.test(err.plain))
  ls.download('gii', 'all', { confirm: true })
  let st
  for (let i = 0; i < 300; i++) { st = ls.downloadStatus('gii', 'all'); if (st && st.state !== 'running') break; await new Promise((ok) => setTimeout(ok, 10)) }
  assert.strictEqual(st.state, 'done', JSON.stringify(st))
  assert.deepStrictEqual([st.done, st.total], [3, 3], 'one law could not be fetched (no zip), the others are kept')
  const items = (await ls.status()).find((s) => s.id === 'gii').local.items
  assert.strictEqual(items.length, 1)
  assert.ok(items[0].bytes > 0 && /^\d{4}-/.test(items[0].updated) && items[0].stale === false)
  assert.match((await ls.status()).find((s) => s.id === 'gii').status, /connected, free \(your local copy from \d{4}-\d\d-\d\d\)$/)
  // No network, and even a local-only data rule: the local copy answers.
  setPolicy(null)
  const mark = seen.length
  const r = await ls.search({ query: 'Kaufpreis zahlen', sources: ['gii'] })
  assert.strictEqual(r.results[0].ref, 'bgb § 433')
  assert.match(r.results[0].snippet, /Kaufpreis/)
  assert.match(r.notes[0].note, /^from your local copy of gesetze-im-internet\.de \(\d{4}-\d\d-\d\d\)$/)
  const doc = await ls.get({ source: 'gii', ref: '§ 434 BGB' })
  assert.match(doc.text, /^§ 434 Sachmangel/)
  assert.match(doc.note, /^from your local copy/)
  assert.strictEqual(seen.length, mark, 'nothing went online')
  // Remove it: back to online.
  setPolicy(['web'])
  await ls.removeDownload('gii', 'all')
  assert.deepStrictEqual((await ls.status()).find((s) => s.id === 'gii').local.items, [])
  assert.ok(!fs.existsSync(path.join(DATA, 'law-data', 'gii', 'all')))
})

test('a source down or no connection: one plain sentence, no crash', async () => {
  setPolicy(['web'])
  down = new Set(['oldp'])
  let r = await ls.search({ query: 'Kaufvertrag', sources: ['openlegaldata'] })
  assert.strictEqual(r.skipped[0].reason, 'Open Legal Data is not answering right now; try again later')
  const saved = process.env.OPENLEX_OLDP_API
  process.env.OPENLEX_OLDP_API = 'http://127.0.0.1:9'
  try {
    r = await ls.search({ query: 'Kaufvertrag', sources: ['openlegaldata'] })
    assert.match(r.skipped[0].reason, /could not be reached \(no internet connection, or the service is down\)/)
  } finally { process.env.OPENLEX_OLDP_API = saved }
  down = new Set(['gii'])
  await assert.rejects(ls.get({ source: 'gii', ref: 'stgb' }), (err) => err.plain === 'gesetze-im-internet.de is not answering right now; try again later')
})

// ── optional live checks (free, no key) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET }, async () => {
  for (const k of ['OPENLEX_OLDP_API', 'OPENLEX_NEURIS_API', 'OPENLEX_GII_BASE']) delete process.env[k]
  await fn()
})
live('Open Legal Data', async () => {
  const r = await require('../src/connectors/openlegaldata').search('Kaufvertrag Mangel', { limit: 2 })
  assert.ok(r.length && /^\d+$/.test(r[0].ref))
})
live('NeuRIS case law', async () => {
  const r = await require('../src/connectors/neuris').search('Kaufvertrag', { limit: 2, kind: 'caselaw' })
  assert.ok(r.length && /^[A-Z]{4}/.test(r[0].ref))
})
live('gesetze-im-internet.de', async () => {
  const d = await require('../src/connectors/gii').get('§ 433 BGB')
  assert.match(d.text, /^§ 433 Vertragstypische Pflichten beim Kaufvertrag/)
})
