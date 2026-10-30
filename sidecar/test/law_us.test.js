"use strict"
/**
 * US law sources: eCFR (federal regulations, no key), GovInfo (US Code,
 * public laws, federal court opinions; the lawyer's free api.data.gov key)
 * and CourtListener (US case law; the lawyer's free token). Offline: one
 * local fake server answers with responses recorded from the real services
 * (test/fixtures/law-sources/us; the CourtListener answers follow its
 * published v4 schema, since a live call needs a token). No paid calls, no
 * real keys.
 *
 *   node --test test/law_us.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_us.test.js   # + live eCFR, GovInfo with DEMO_KEY
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-us-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources', 'us')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

const GOV_KEY = 'a'.repeat(40)
const CL_TOKEN = '0123456789abcdef0123456789abcdef01234567'
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
    if (down.has(src)) { res.writeHead(503); return res.end() }
    const send = (type, s, status = 200) => { res.writeHead(status, { 'Content-Type': type }); res.end(s) }
    const json = (s, status = 200) => send('application/json', typeof s === 'string' ? s : JSON.stringify(s), status)
    // eCFR
    if (p === '/ecfr/api/search/v1/results') return json(u.searchParams.get('query') === 'nothing at all' ? { results: [], meta: { total_count: 0 } } : fixture('ecfr-search.json'))
    if (p === '/ecfr/api/versioner/v1/titles.json') return json(fixture('ecfr-titles.json'))
    if (p.startsWith('/ecfr/api/versioner/v1/full/')) {
      if (u.searchParams.get('section') === '1701.2') return send('application/xml', fixture('ecfr-section.xml'))
      if (u.searchParams.get('part') === '1701') return send('application/xml', fixture('ecfr-part.xml'))
      return json({ error: 'not found' }, 404)
    }
    // GovInfo (key in the header)
    if (src === 'gov') {
      if (req.headers['x-api-key'] !== GOV_KEY) return json({ error: { code: 'API_KEY_INVALID' } }, 403)
      const rest = p.slice(4)
      if (rest === '/search' && req.method === 'POST') return json(fixture('govinfo-search.json'))
      if (rest === '/packages/USCODE-2024-title15/granules/USCODE-2024-title15-chap2B-sec78a/summary') return json(fixture('govinfo-uscode-summary.json'))
      if (rest === '/packages/USCODE-2024-title15/granules/USCODE-2024-title15-chap2B-sec78a/htm') return send('text/html', fixture('govinfo-uscode.htm'))
      if (rest === '/packages/USCOURTS-wyd-2_22-cv-00028/granules/USCOURTS-wyd-2_22-cv-00028-0/summary') return json(fixture('govinfo-uscourts-summary.json'))
      if (rest === '/packages/USCOURTS-wyd-2_22-cv-00028/granules/USCOURTS-wyd-2_22-cv-00028-0/pdf') return send('application/pdf', 'not really a pdf')
      return json({ error: 'not found' }, 404)
    }
    // CourtListener (token in the header)
    if (src === 'cl') {
      if (req.headers.authorization !== `Token ${CL_TOKEN}`) return json({ detail: 'Invalid token.' }, 401)
      const rest = p.slice(3)
      if (rest === '/api/rest/v4/search/') return json(fixture('courtlistener-search.json'))
      if (rest === '/api/rest/v4/clusters/107252/') return json(fixture('courtlistener-cluster.json'))
      if (rest === '/api/rest/v4/opinions/107252/') return json(fixture('courtlistener-opinion.json'))
      return json({ detail: 'Not found.' }, 404)
    }
    res.writeHead(404); res.end()
  })
})

const mem = new Map()
let ls, policy

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, { OPENLEX_ECFR_API: `${base}/ecfr`, OPENLEX_GOVINFO_API: `${base}/gov`, OPENLEX_COURTLISTENER_API: `${base}/cl` })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  policy = require('../src/policy')
  ls._setStore({ get: async (n) => mem.get(n) ?? null, set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => {
  down = new Set(); mem.clear()
  policy.setRule(null, { mode: 'allow-list', providers: ['web'] })
  require('../src/connectors/ecfr')._reset()
})

test('the three US connectors have the one interface and German words', () => {
  for (const id of ['ecfr', 'govinfo', 'courtlistener']) {
    const c = ls.connector(id)
    for (const k of ['id', 'label', 'country', 'kind', 'description', 'licence', 'homepage', 'guide', 'sample']) assert.ok(typeof c[k] === 'string' && c[k], `${id}.${k}`)
    assert.strictEqual(c.country, 'US')
    assert.deepStrictEqual(c.jurisdictions, ['US'])
    assert.ok(c.de.label && c.de.description, id)
    for (const f of ['search', 'get', 'citation']) assert.strictEqual(typeof c[f], 'function')
  }
  assert.strictEqual(ls.connector('courtlistener').community, true)
})

test('eCFR: search with provenance, a section, a part sliced to one §, point in time', async () => {
  const r = await ls.search({ query: 'disclosure of information', sources: ['ecfr'] })
  assert.deepStrictEqual(r.searched, ['ecfr'])
  const hit = r.results[0]
  assert.deepStrictEqual([hit.source, hit.ref, hit.citation, hit.url], ['ecfr', '45/1701.2', '45 CFR 1701.2 (eCFR)', 'https://www.ecfr.gov/current/title-45/section-1701.2'])
  assert.match(hit.title, /^45 CFR 1701\.2 – Disclosure of records and informational materials\.$/)
  assert.ok(!/<strong>/.test(hit.snippet + hit.title))
  assert.strictEqual(hit.inForce, true)
  assert.match(hit.licence, /public domain/)
  assert.match(hit.retrieved, /^\d{4}-\d\d-\d\dT/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  const doc = await ls.get({ source: 'ecfr', ref: hit.ref })
  assert.match(doc.text, /^§ 1701\.2 Disclosure of records and informational materials\.\n\(a\) With the exception/)
  assert.strictEqual(doc.citation, '45 CFR 1701.2 (eCFR)')
  assert.match(doc.note, /up to date as of 2026-10-28/)
  assert.ok(seen.some((s) => s.path.includes('/full/2026-10-28/title-45.xml?section=1701.2')), 'the date eCFR is up to date for')
  const part = await ls.get({ source: 'ecfr', ref: '45 CFR Part 1701', article: '1701.2' })
  assert.match(part.text, /^§ 1701\.2 Disclosure/)
  assert.ok(!/§ 1701\.3 /.test(part.text.split('\n')[0]))
  assert.strictEqual(part.citation, '45 CFR 1701.2 (eCFR)')
  const then = await ls.get({ source: 'ecfr', ref: '45/1701.2', date: '2020-01-01' })
  assert.strictEqual(then.url, 'https://www.ecfr.gov/on/2020-01-01/title-45/section-1701.2')
  assert.ok(seen.some((s) => s.path.includes('/full/2020-01-01/title-45.xml')))
  await assert.rejects(ls.get({ source: 'ecfr', ref: '../etc' }), /give the section/)
  await assert.rejects(ls.get({ source: 'ecfr', ref: '45/9999.99' }), (e) => e.plain === 'eCFR (US federal regulations) has no such document' || /has no such document/.test(e.plain))
  assert.deepStrictEqual((await ls.search({ query: 'nothing at all', sources: ['ecfr'] })).results, [])
})

test('eCFR is asked for US questions; a US search names its sources; status in English and German', async () => {
  const r = await ls.search({ query: 'disclosure of information', jurisdiction: 'US' })
  assert.ok(r.searched.includes('ecfr'))
  assert.ok(r.skipped.some((s) => s.source === 'govinfo' && /needs your free key from api\.data\.gov \(how to get it: .*#govinfo\)/.test(s.reason)))
  assert.ok(r.skipped.some((s) => s.source === 'courtlistener' && /CourtListener token/.test(s.reason)))
  const st = await ls.status()
  const e = st.find((s) => s.id === 'ecfr')
  assert.strictEqual(e.status, 'eCFR (US federal regulations): connected, free')
  assert.strictEqual(e.statusDe, 'eCFR (US-Bundesverordnungen): verbunden, kostenlos')
  assert.strictEqual(st.find((s) => s.id === 'govinfo').status, 'GovInfo (US Code, laws, federal courts): needs your free key from api.data.gov: how to get it')
  assert.strictEqual(st.find((s) => s.id === 'govinfo').statusDe, 'GovInfo (US Code, Gesetze, Bundesgerichte): braucht Ihren kostenlosen Schlüssel von api.data.gov: so erhalten Sie ihn')
  assert.strictEqual(st.find((s) => s.id === 'courtlistener').status, 'CourtListener (US case law): needs your free CourtListener token: how to get it')
  policy.setRule(null, { mode: 'local-only' })
  const before = seen.length
  const off = await ls.search({ query: 'x', sources: ['ecfr'] })
  assert.strictEqual(seen.length, before, 'nothing left this computer')
  assert.match(off.skipped[0].reason, /keeps OpenLex offline/)
})

test('GovInfo: the key goes in the header only; US Code section text; a court opinion falls back to the docket text', async () => {
  await assert.rejects(ls.setKey('govinfo', 'short'), /does not look like an api\.data\.gov key/)
  await ls.setKey('govinfo', GOV_KEY)
  assert.strictEqual(mem.get('source-govinfo'), GOV_KEY)
  const r = await ls.search({ query: 'securities fraud', sources: ['govinfo'] })
  const q = JSON.parse(seen.filter((s) => s.path === '/gov/search').at(-1).body)
  assert.strictEqual(q.query, '(collection:USCODE OR collection:PLAW OR collection:USCOURTS) AND (securities fraud)')
  assert.ok(seen.filter((s) => s.path.startsWith('/gov/')).every((s) => !s.path.includes(GOV_KEY)), 'never in the URL')
  const [code, court] = r.results
  assert.deepStrictEqual([code.ref, code.citation, code.url], ['USCODE-2024-title15/USCODE-2024-title15-chap2B-sec78a', '15 U.S.C. § 78a (GovInfo)', 'https://www.govinfo.gov/app/details/USCODE-2024-title15/USCODE-2024-title15-chap2B-sec78a'])
  assert.match(code.title, /^United States Code: Short title$/)
  assert.match(court.citation, /^Crothers et al v\. Teton County .*, 2023-01-27 \(GovInfo, USCOURTS-wyd-2_22-cv-00028\)$/)
  const doc = await ls.get({ source: 'govinfo', ref: code.ref })
  assert.match(doc.text, /§78a\. Short title\nThis chapter may be cited as the "Securities Exchange Act of 1934\."/)
  assert.ok(!/documentid/.test(doc.text), 'comments left out')
  assert.strictEqual(doc.citation, '15 U.S.C. § 78a (GovInfo)')
  assert.match(doc.licence, /public domain/)
  const op = await ls.get({ source: 'govinfo', ref: court.ref })
  assert.match(op.text, /DISMISSED with prejudice/)
  assert.match(op.note, /only published as a PDF/)
  assert.strictEqual((await ls.status()).find((s) => s.id === 'govinfo').status, 'GovInfo (US Code, laws, federal courts): connected, free (with your key)')
  // A wrong key: one plain sentence.
  mem.set('source-govinfo', 'b'.repeat(40))
  const bad = await ls.search({ query: 'x', sources: ['govinfo'] })
  assert.match(bad.skipped[0].reason, /did not accept the key/)
})

test('CourtListener: token in the header; search, the opinion text, a citation like a lawyer writes it', async () => {
  await assert.rejects(ls.setKey('courtlistener', 'nope'), /does not look like a CourtListener token/)
  await ls.setKey('courtlistener', CL_TOKEN)
  const r = await ls.search({ query: 'self-incrimination', sources: ['courtlistener'] })
  const hit = r.results[0]
  assert.deepStrictEqual([hit.ref, hit.title, hit.citation, hit.url, hit.date], ['107252', 'Miranda v. Arizona', 'Miranda v. Arizona, 384 U.S. 436 (SCOTUS 1966) (CourtListener 107252)', 'https://www.courtlistener.com/opinion/107252/miranda-v-arizona/', '1966-06-13'])
  assert.match(hit.snippet, /^Supreme Court of the United States · No\. 759 · The prosecution may not use/)
  assert.strictEqual(new URL(seen.filter((s) => s.path.startsWith('/cl/api/rest/v4/search/')).at(-1).path, 'http://x').searchParams.get('type'), 'o')
  const doc = await ls.get({ source: 'courtlistener', ref: '107252' })
  assert.match(doc.text, /^MR\. CHIEF JUSTICE WARREN delivered the opinion of the Court\.\nThe cases before us/)
  assert.strictEqual(doc.citation, 'Miranda v. Arizona, 384 U.S. 436 (1966) (CourtListener 107252)')
  assert.match(doc.licence, /Free Law Project/)
  assert.strictEqual((await ls.status()).find((s) => s.id === 'courtlistener').status, 'CourtListener (US case law): connected, free (with your key) (community source)')
  await assert.rejects(ls.get({ source: 'courtlistener', ref: 'abc' }), /case number/)
  mem.set('source-courtlistener', 'f'.repeat(40))
  assert.match((await ls.search({ query: 'x', sources: ['courtlistener'] })).skipped[0].reason, /did not accept the key/)
})

test('down or offline: one plain sentence each, no crash', async () => {
  down = new Set(['ecfr'])
  const r = await ls.search({ query: 'x', sources: ['ecfr'] })
  assert.match(r.skipped[0].reason, /is not answering right now; try again later$/)
  const saved = process.env.OPENLEX_ECFR_API
  process.env.OPENLEX_ECFR_API = 'http://127.0.0.1:9'
  try {
    const x = await ls.search({ query: 'x', sources: ['ecfr'] })
    assert.match(x.skipped[0].reason, /could not be reached \(no internet connection, or the service is down\)/)
  } finally { process.env.OPENLEX_ECFR_API = saved }
})

test('pace: one request at a time, apart (CourtListener 12 s, here shortened)', async () => {
  const { paced } = require('../src/connectors/pace')
  process.env.OPENLEX_PACE_SCALE = '0.01'
  try {
    const t = []
    await Promise.all([1, 2, 3].map(() => paced('courtlistener-test', 12000, async () => { t.push(Date.now()) })))
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 100, `gap ${t[i] - t[i - 1]} ms`)
  } finally { process.env.OPENLEX_PACE_SCALE = '0' }
})

// ── optional live checks (free; no paid calls; GovInfo with api.data.gov's public DEMO_KEY) ──
const live = (name, fn, skip = false) => test(`live: ${name}`, { skip: !NET || skip }, async () => {
  for (const k of ['OPENLEX_ECFR_API', 'OPENLEX_GOVINFO_API', 'OPENLEX_COURTLISTENER_API']) delete process.env[k]
  require('../src/connectors/ecfr')._reset()
  await fn()
})
live('eCFR', async () => {
  const c = require('../src/connectors/ecfr')
  const r = await c.search('disclosure of information', { limit: 2 })
  assert.ok(r.length && /^\d+\//.test(r[0].ref))
  const d = await c.get('45/1701.2')
  assert.match(d.text, /^§ 1701\.2 /)
})
live('GovInfo (DEMO_KEY)', async () => {
  const r = await require('../src/connectors/govinfo').search('securities fraud', { limit: 2 }, { key: process.env.OPENLEX_KEY_SOURCE_GOVINFO || 'DEMO_KEY' })
  assert.ok(r.length && r[0].ref)
})
live('CourtListener (with OPENLEX_KEY_SOURCE_COURTLISTENER)', async () => {
  const r = await require('../src/connectors/courtlistener').search('qualified immunity', { limit: 2 }, { key: process.env.OPENLEX_KEY_SOURCE_COURTLISTENER })
  assert.ok(r.length && /^\d+$/.test(r[0].ref))
}, !process.env.OPENLEX_KEY_SOURCE_COURTLISTENER)
