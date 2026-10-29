"use strict"
/**
 * UK law sources: legislation.gov.uk (ukleg) and Find Case Law (ukcaselaw),
 * through the shared engine (connectors/index.js). Offline: one local fake
 * server answers with responses recorded from the real services
 * (test/fixtures/law-sources/uk, trimmed). No live calls, no keys.
 *
 *   node --test test/law_uk.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_uk.test.js   # + one live look-up per source
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-uk-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources', 'uk')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

const seen = []
let down = new Set()
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const p = u.pathname
  seen.push({ path: req.url, headers: req.headers, t: Date.now() })
  const src = p.split('/')[1]
  if (down.has(src)) { res.writeHead(503); return res.end() }
  const send = (body, type) => { res.writeHead(200, { 'Content-Type': type }); res.end(body) }
  const xml = (f) => send(fixture(f), 'application/atom+xml; charset=utf-8')
  const html = (f) => send(fixture(f), 'text/html; charset=utf-8')
  if (p === '/leg/all/data.feed') return xml(u.searchParams.has('title') ? 'leg-title.xml' : 'leg-text.xml')
  if (p === '/leg/ukpga/2018/data.feed' && u.searchParams.get('number') === '12') return xml('leg-number.xml')
  if (p === '/leg/ukpga/1996/18/section/94/data.htm') return html('leg-section.htm')
  if (p === '/leg/ukpga/1996/18/section/94/2020-01-01/data.htm') return html('leg-section-2020.htm')
  if (p === '/leg/ukpga/1996/18/contents/data.htm') return html('leg-contents.htm')
  if (p === '/fcl/atom.xml') return xml('fcl-search.xml')
  if (p === '/fcl/uksc/2024/12/data.xml') return send(fixture('fcl-judgment.xml'), 'application/xml')
  res.writeHead(404, { 'Content-Type': 'text/html' })
  res.end('<html><body>Not found</body></html>')
})

let ls
const mem = new Map()

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  process.env.OPENLEX_UKLEG_API = `${base}/leg`
  process.env.OPENLEX_UKCASELAW_API = `${base}/fcl`
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  ls._setStore({ get: async (n) => mem.get(n) ?? null, set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['web'] })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { down = new Set() })

test('both UK connectors have the one interface and are in the list', async () => {
  for (const id of ['ukleg', 'ukcaselaw']) {
    const c = ls.connector(id)
    for (const k of ['id', 'label', 'country', 'kind', 'description', 'licence', 'homepage', 'guide', 'sample']) assert.ok(typeof c[k] === 'string' && c[k], `${id}.${k}`)
    assert.deepStrictEqual([c.country, c.jurisdictions, c.needsKey], ['UK', ['UK', 'GB'], false])
    assert.ok(c.de.label && c.de.description)
  }
  assert.strictEqual(ls.connector('ukcaselaw').kind, 'caselaw')
  const st = await ls.status()
  const leg = st.find((s) => s.id === 'ukleg')
  const fcl = st.find((s) => s.id === 'ukcaselaw')
  assert.strictEqual(leg.status, 'legislation.gov.uk: connected, free')
  assert.strictEqual(leg.statusDe, 'legislation.gov.uk (Vereinigtes Königreich): verbunden, kostenlos')
  assert.strictEqual(fcl.status, 'Find Case Law (UK): connected, free')
  assert.match(fcl.licence, /Open Justice Licence.*computational analysis/)
  assert.match(fcl.description, /per-question look-ups only/)
  assert.strictEqual(leg.guide, 'https://github.com/N9394/openlex/blob/main/docs/SOURCES.md#ukleg')
})

test('legislation.gov.uk: title search, UK Acts before retained EU law, with provenance', async () => {
  const r = await ls.search({ query: 'employment rights', sources: ['ukleg'], limit: 4 })
  assert.deepStrictEqual(r.searched, ['ukleg'])
  assert.deepStrictEqual(r.results.slice(0, 3).map((x) => x.ref), ['ukpga/2025/36', 'ukpga/1998/8', 'ukpga/1996/18'], 'UK Acts first')
  assert.ok(r.results.slice(3).every((x) => x.ref.startsWith('eu')), 'then EU law')
  const era = r.results[2]
  assert.strictEqual(era.title, 'Employment Rights Act 1996')
  assert.strictEqual(era.citation, 'Employment Rights Act 1996 (legislation.gov.uk, ukpga/1996/18)')
  assert.strictEqual(era.url, 'https://www.legislation.gov.uk/ukpga/1996/18')
  assert.match(era.snippet, /^made 1996-05-22 · revised text as at \d{4}-\d\d-\d\d · An Act to consolidate/)
  assert.deepStrictEqual([era.source, era.jurisdiction, era.date], ['ukleg', 'UK', '1996-05-22'])
  assert.match(era.licence, /Open Government Licence v3\.0/)
  assert.match(era.retrieved, /^\d{4}-\d\d-\d\dT/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  const q = new URL(seen.filter((s) => s.path.startsWith('/leg/all/data.feed')).at(-1).path, 'http://x').searchParams
  assert.strictEqual(q.get('title'), 'employment rights')
  assert.match(seen.at(-1).headers['user-agent'], /^OpenLex \(\+https:\/\/github\.com\/N9394\/openlex\)$/, 'says who it is')
})

test('legislation.gov.uk: too few title hits are topped up from the full text', async () => {
  const mark = seen.length
  const r = await ls.search({ query: 'employment rights', sources: ['ukleg'], limit: 8 })
  assert.strictEqual(r.results.length, 8)
  assert.ok(seen.slice(mark).some((s) => /[?&]text=employment\+rights/.test(s.path)))
  assert.strictEqual(new Set(r.results.map((x) => x.ref)).size, 8, 'no duplicates')
})

test('legislation.gov.uk: by number ("2018 c. 12", "ukpga/2018/12"); found by jurisdiction UK and GB', async () => {
  for (const query of ['2018 c. 12', 'ukpga/2018/12']) {
    const r = await ls.search({ query, sources: ['ukleg'] })
    assert.deepStrictEqual(r.results.map((x) => [x.ref, x.title]), [['ukpga/2018/12', 'Data Protection Act 2018']], query)
    assert.ok(!('type' in r.results[0]))
  }
  for (const jurisdiction of ['UK', 'GB']) {
    const r = await ls.search({ query: '2018 c. 12', jurisdiction })
    assert.ok(r.searched.includes('ukleg') && r.searched.includes('ukcaselaw'), jurisdiction)
  }
})

test('legislation.gov.uk: one section, without the annotations; point in time; the contents', async () => {
  const d = await ls.get({ source: 'ukleg', ref: 'ukpga/1996/18', article: 's. 94' })
  assert.match(d.text, /^94 The right\.\n\(1\)An employee has the right not to be unfairly dismissed by his employer\./)
  assert.ok(!/Modifications etc|E\+W\+S|S\.I\. 1998\/218/.test(d.text), 'annotations and extent marks left out')
  assert.deepStrictEqual([d.title, d.citation, d.url], ['Employment Rights Act 1996, s. 94', 'Employment Rights Act 1996, s. 94 (legislation.gov.uk, ukpga/1996/18)', 'https://www.legislation.gov.uk/ukpga/1996/18/section/94'])
  assert.match(d.note, /up to date with all changes known to be in force on or before/)
  assert.ok(!/Revised legislation carried/.test(d.note))
  assert.strictEqual(d.notice, 'Check the official version before relying on it.')
  assert.strictEqual(d.source, 'ukleg')
  const old = await ls.get({ source: 'ukleg', ref: 'http://www.legislation.gov.uk/id/ukpga/1996/18', article: '94', date: '2020-01-01' })
  assert.strictEqual(old.url, 'https://www.legislation.gov.uk/ukpga/1996/18/section/94/2020-01-01')
  assert.strictEqual(old.note, 'As it read on 2020-01-01 (point in time).')
  assert.match(old.text, /^94 The right\./)
  const inRef = await ls.get({ source: 'ukleg', ref: 'ukpga/1996/18/section/94' })
  assert.strictEqual(inRef.title, 'Employment Rights Act 1996, s. 94')
  const toc = await ls.get({ source: 'ukleg', ref: 'ukpga/1996/18' })
  assert.match(toc.text, /Part I Employment particulars/)
  assert.match(toc.note, /^This is the table of contents: ask for one section\./)
  assert.strictEqual(toc.url, 'https://www.legislation.gov.uk/ukpga/1996/18/contents')
})

test('legislation.gov.uk: plain errors', async () => {
  await assert.rejects(ls.get({ source: 'ukleg', ref: 'ukpga/1996/18', article: '9999' }), (e) => e.plain === 'legislation.gov.uk: s. 9999 was not found in ukpga/1996/18')
  await assert.rejects(ls.get({ source: 'ukleg', ref: 'not a law' }), /give the item from a search result/)
  await assert.rejects(ls.get({ source: 'ukleg', ref: 'ukpga/1996/18', article: '94', date: '1.1.2020' }), /YYYY-MM-DD/)
  await assert.rejects(ls.get({ source: 'ukleg', ref: 'ukpga/1996/18', article: '§§ x' }), /give the section as a number/)
  down = new Set(['leg'])
  const r = await ls.search({ query: 'employment rights', sources: ['ukleg', 'ukcaselaw'] })
  assert.deepStrictEqual(r.skipped, [{ source: 'ukleg', reason: 'legislation.gov.uk is not answering right now; try again later' }])
  assert.ok(r.results.length && r.results.every((x) => x.source === 'ukcaselaw'), 'the other source still answers')
  const saved = process.env.OPENLEX_UKLEG_API
  process.env.OPENLEX_UKLEG_API = 'http://127.0.0.1:9'
  try {
    const x = await ls.search({ query: 'employment', sources: ['ukleg'] })
    assert.match(x.skipped[0].reason, /^legislation\.gov\.uk could not be reached \(no internet connection, or the service is down\)$/)
  } finally { process.env.OPENLEX_UKLEG_API = saved }
})

test('legislation.gov.uk keeps its pace: one request at a time, 200 ms apart', async () => {
  process.env.OPENLEX_PACE_SCALE = '1'
  try {
    const mark = seen.length
    const c = require('../src/connectors/ukleg')
    await Promise.all([c.search('2018 c. 12'), c.search('2018 c. 12'), c.search('2018 c. 12')])
    const t = seen.slice(mark).map((s) => s.t)
    assert.strictEqual(t.length, 3)
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 190, `gap ${t[i] - t[i - 1]} ms`)
  } finally { process.env.OPENLEX_PACE_SCALE = '0' }
})

test('legislation.gov.uk: references and sections are read the lawyer\'s way', () => {
  const c = require('../src/connectors/ukleg')
  assert.strictEqual(c.parseRef('S.I. 2018/1234'), 'uksi/2018/1234')
  assert.strictEqual(c.parseRef('SSI 2020/5'), 'ssi/2020/5')
  assert.strictEqual(c.parseRef('https://www.legislation.gov.uk/asp/2010/13/section/2'), 'asp/2010/13')
  assert.strictEqual(c.parseRef('unfair dismissal'), null)
  assert.deepStrictEqual(c.partOf('reg. 3', 'uksi'), { kind: 'regulation', num: '3' })
  assert.deepStrictEqual(c.partOf('3', 'eur'), { kind: 'article', num: '3' })
  assert.deepStrictEqual(c.partOf('Sch 1', 'ukpga'), { kind: 'schedule', num: '1' })
  assert.deepStrictEqual(c.partOf('47b', 'ukpga'), { kind: 'section', num: '47B' })
})

test('Find Case Law: search by relevance, with court, date, neutral citation and provenance', async () => {
  const r = await ls.search({ query: 'action short of dismissal', sources: ['ukcaselaw'], limit: 3 })
  assert.deepStrictEqual(r.results.map((x) => x.ref), ['uksc/2024/12', 'ewca/civ/2022/379', 'ewca/civ/2018/418'])
  const top = r.results[0]
  assert.strictEqual(top.title, 'Secretary of State for Business and Trade v Mercer [2024] UKSC 12')
  assert.strictEqual(top.citation, 'Secretary of State for Business and Trade v Mercer [2024] UKSC 12 (Find Case Law)')
  assert.strictEqual(top.url, 'https://caselaw.nationalarchives.gov.uk/uksc/2024/12')
  assert.strictEqual(top.snippet, 'United Kingdom Supreme Court · judgment of 2024-04-17')
  assert.deepStrictEqual([top.source, top.date, top.jurisdiction], ['ukcaselaw', '2024-04-17', 'UK'])
  assert.match(top.licence, /Open Justice Licence/)
  const q = new URL(seen.filter((s) => s.path.startsWith('/fcl/atom.xml')).at(-1).path, 'http://x').searchParams
  assert.deepStrictEqual([q.get('query'), q.get('order'), q.get('per_page')], ['action short of dismissal', 'relevance', '3'])
  const k = await ls.search({ query: 'strike', jurisdiction: 'UK', kind: 'caselaw' })
  assert.deepStrictEqual(k.searched, ['ukcaselaw'], 'kind: caselaw leaves the statutes out')
})

test('Find Case Law: a neutral citation opens the judgment; one paragraph; plain errors', async () => {
  const r = await ls.search({ query: '[2024] UKSC 12', sources: ['ukcaselaw'] })
  assert.deepStrictEqual(r.results.map((x) => [x.ref, x.snippet]), [['uksc/2024/12', 'The Supreme Court · judgment of 2024-04-17']])
  assert.ok(!seen.slice(-1)[0].path.startsWith('/fcl/atom.xml'), 'no search needed for a citation')
  const p = await ls.get({ source: 'ukcaselaw', ref: '[2024] UKSC 12', article: '[23]' })
  assert.match(p.text, /^23\. By section 4\(6\) of the HRA, a declaration of incompatibility does not affect/)
  assert.ok(!/^24\./m.test(p.text), 'only paragraph 23')
  assert.strictEqual(p.citation, 'Secretary of State for Business and Trade v Mercer [2024] UKSC 12, [23] (Find Case Law)')
  assert.strictEqual(p.notice, 'Check the official version before relying on it.')
  const all = await ls.get({ source: 'ukcaselaw', ref: 'uksc/2024/12' })
  assert.match(all.text, /^Easter Term\n\[2024\] UKSC 12\nOn appeal from: \[2022\] EWCA Civ 379/)
  assert.match(all.text, /\n1\. Employees who are dismissed for taking part in lawful strike action/)
  assert.ok(!/font-family|FRBR|tna-enrichment/.test(all.text), 'no metadata or styles')
  await assert.rejects(ls.get({ source: 'ukcaselaw', ref: 'uksc/2024/12', article: '999' }), (e) => e.plain === 'Find Case Law (UK): paragraph 999 was not found in [2024] UKSC 12')
  await assert.rejects(ls.get({ source: 'ukcaselaw', ref: '[2099] UKSC 99' }), (e) => e.plain === 'Find Case Law (UK) has no such document')
  await assert.rejects(ls.get({ source: 'ukcaselaw', ref: 'Mercer' }), /give the neutral citation/)
  const none = await ls.search({ query: '[2099] UKSC 99', sources: ['ukcaselaw'] })
  assert.deepStrictEqual(none.skipped, [], 'an unknown citation falls back to a search')
  down = new Set(['fcl'])
  const d = await ls.search({ query: 'strike', sources: ['ukcaselaw'] })
  assert.strictEqual(d.skipped[0].reason, 'Find Case Law (UK) is not answering right now; try again later')
})

test('Find Case Law: neutral citations become document addresses', () => {
  const { parseRef } = require('../src/connectors/ukcaselaw')
  assert.strictEqual(parseRef('[2022] EWCA Civ 379'), 'ewca/civ/2022/379')
  assert.strictEqual(parseRef('[2026] EWHC 2767 (Comm)'), 'ewhc/comm/2026/2767')
  assert.strictEqual(parseRef('[2023] UKUT 12 (IAC)'), 'ukut/iac/2023/12')
  assert.strictEqual(parseRef('https://caselaw.nationalarchives.gov.uk/ewhc/kb/2024/1/data.xml'), 'ewhc/kb/2024/1')
  assert.strictEqual(parseRef('d-38a95589-7fd3-4526-a9ea-bd3bb0ccc9c9'), 'd-38a95589-7fd3-4526-a9ea-bd3bb0ccc9c9')
  assert.strictEqual(parseRef('../../etc/passwd'), null)
})

test('local-only data rule: nothing goes to the UK sources', async () => {
  const policy = require('../src/policy')
  policy.setRule(null, { mode: 'local-only' })
  try {
    const mark = seen.length
    const r = await policy.withMatter(null, () => ls.search({ query: 'employment', jurisdiction: 'UK' }))
    assert.strictEqual(seen.length, mark)
    assert.ok(r.skipped.every((s) => /keeps OpenLex offline/.test(s.reason)))
    assert.strictEqual((await ls.status()).find((s) => s.id === 'ukleg').status, 'legislation.gov.uk: free, but your client-data rule keeps OpenLex offline')
  } finally { policy.setRule(null, { mode: 'allow-list', providers: ['web'] }) }
})

// ── optional live checks (free official services, no key) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET }, async () => {
  const saved = [process.env.OPENLEX_UKLEG_API, process.env.OPENLEX_UKCASELAW_API, process.env.OPENLEX_PACE_SCALE]
  delete process.env.OPENLEX_UKLEG_API; delete process.env.OPENLEX_UKCASELAW_API; process.env.OPENLEX_PACE_SCALE = '1'
  try { await fn() } finally { [process.env.OPENLEX_UKLEG_API, process.env.OPENLEX_UKCASELAW_API, process.env.OPENLEX_PACE_SCALE] = saved }
})
live('legislation.gov.uk', async () => {
  const c = require('../src/connectors/ukleg')
  const r = await c.search('Employment Rights Act', { limit: 5 })
  assert.ok(r.some((x) => x.ref === 'ukpga/1996/18'))
  const d = await c.get('ukpga/1996/18', { article: '94' })
  assert.match(d.text, /^94 The right\./)
})
live('Find Case Law', async () => {
  const c = require('../src/connectors/ukcaselaw')
  const r = await c.search('[2024] UKSC 12')
  assert.strictEqual(r[0].ref, 'uksc/2024/12')
})
