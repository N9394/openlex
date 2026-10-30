"use strict"
/**
 * Swiss law sources: Fedlex (federal statutes, SPARQL + the official
 * filestore) and opencaselaw.ch (court decisions, CC0, MCP). Offline: one
 * local fake server answers with responses recorded from the real services
 * (test/fixtures/law-sources/ch). No live calls, no keys.
 *
 *   node --test test/law_ch.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_ch.test.js   # + one live look-up per source
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-ch-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources', 'ch')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

const seen = []
let down = new Set()
const EMPTY = JSON.stringify({ head: { vars: [] }, results: { bindings: [] } })

function mcp(req, res, body) {
  const msg = JSON.parse(body || '{}')
  const reply = (o) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...o })}\n\n`) }
  if (msg.method === 'initialize') return reply({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'swiss-caselaw', version: '1' } } })
  if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end() }
  if (msg.method === 'tools/list') return reply({ result: JSON.parse(fixture('ocl-tools.json')) })
  if (msg.method === 'tools/call') {
    const { name, arguments: a } = msg.params
    if (name === 'search_decisions') return reply({ result: { ...JSON.parse(fixture('ocl-search.json')), isError: false } })
    if (name === 'get_decision') return a.decision_id === 'bge_115 II 83' ? reply({ result: { ...JSON.parse(fixture('ocl-get.json')), isError: false } }) : reply({ result: { content: [{ type: 'text', text: 'Decision not found' }], isError: true } })
    if (name === 'get_erwaegung') return a.e_number === '2' ? reply({ result: { ...JSON.parse(fixture('ocl-erwaegung.json')), isError: false } }) : reply({ result: { content: [{ type: 'text', text: 'No such Erwägung' }], isError: true } })
  }
  return reply({ error: { code: -32601, message: 'unknown method' } })
}

const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname
    seen.push({ path: p, method: req.method, headers: req.headers, body })
    const src = p.split('/')[1]
    if (down.has(src)) { res.writeHead(503); return res.end() }
    const json = (s) => { res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' }); res.end(s) }
    if (p === '/ocl/mcp') return mcp(req, res, body)
    if (p === '/fedlex/sparql') {
      const q = new URLSearchParams(body).get('query') || ''
      if (/dateApplicability/.test(q)) return json(q.includes('<https://fedlex.data.admin.ch/eli/cc/27/317_321_377>') ? fixture('fedlex-version.json') : EMPTY)
      if (/STR\(\?sr\) = "220"/.test(q) || q.includes('?cc = <https://fedlex.data.admin.ch/eli/cc/27/317_321_377>') || /CONTAINS\(LCASE\(STR\(\?t\)\), "obligationenrecht"\)/.test(q)) return json(fixture('fedlex-act.json'))
      return json(EMPTY)
    }
    if (p.startsWith('/fedlexfiles/fedlex.data.admin.ch/eli/cc/27/317_321_377/20261001/de/html/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fixture('fedlex-or.html')) }
    res.writeHead(404); res.end()
  })
})

let ls, policy
const mem = new Map()

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, { OPENLEX_OPENCASELAW_URL: `${base}/ocl/mcp`, OPENLEX_FEDLEX_SPARQL: `${base}/fedlex/sparql`, OPENLEX_FEDLEX_FILES: `${base}/fedlexfiles` })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  policy = require('../src/policy')
  ls._setStore({ get: async (n) => mem.get(n) || null, set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => {
  down = new Set()
  require('../src/connectors/opencaselaw')._reset()
  policy.setRule(null, { mode: 'allow-list', providers: ['web'] })
})

test('both are registered with the one interface, Swiss, no key', () => {
  for (const id of ['fedlex', 'opencaselaw']) {
    const c = ls.connector(id)
    assert.deepStrictEqual([c.country, c.jurisdictions, c.needsKey], ['CH', ['CH'], false], id)
    for (const f of ['search', 'get', 'citation']) assert.strictEqual(typeof c[f], 'function')
    assert.ok(c.de.label && c.de.description && c.sample && c.hosts.length)
  }
  assert.strictEqual(ls.connector('fedlex').kind, 'law')
  assert.deepStrictEqual([ls.connector('opencaselaw').kind, ls.connector('opencaselaw').community], ['caselaw', true])
})

test('Fedlex: search by SR number and by title words; provenance and notice', async () => {
  let r = await ls.search({ query: 'SR 220', sources: ['fedlex'] })
  const hit = r.results[0]
  assert.deepStrictEqual([hit.source, hit.ref, hit.citation, hit.url, hit.inForce, hit.date], ['fedlex', '27/317_321_377', 'OR (SR 220, Fedlex)', 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de', true, '1912-01-01'])
  assert.match(hit.title, /^Bundesgesetz vom 30\. März 1911 .*Obligationenrecht\) \(OR\)$/)
  assert.strictEqual(hit.snippet, 'SR 220 · in force')
  assert.match(hit.licence, /Art\. 5 URG/)
  assert.match(hit.retrieved, /^\d{4}-\d\d-\d\dT/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  r = await ls.search({ query: 'Obligationenrecht', sources: ['fedlex'] })
  assert.strictEqual(r.results[0].ref, '27/317_321_377')
  const q = new URLSearchParams(seen.filter((s) => s.path === '/fedlex/sparql').at(-1).body).get('query')
  assert.match(q, /CONTAINS\(LCASE\(STR\(\?t\)\), "obligationenrecht"\)/)
  assert.match(q, /language\/DEU>/)
  assert.deepStrictEqual((await ls.search({ query: 'SR 999.999', sources: ['fedlex'] })).results, [], 'an unknown number is simply not found')
})

test('Fedlex: one article of the consolidated text in force, footnote markers dropped; plain errors', async () => {
  const doc = await ls.get({ source: 'fedlex', ref: '220', article: 'Art. 41' })
  assert.match(doc.text, /^Art\. 41\n1 Wer einem andern widerrechtlich Schaden zufügt/)
  assert.ok(!/Art\. 42/.test(doc.text))
  assert.deepStrictEqual([doc.citation, doc.url, doc.version], ['Art. 41 OR (SR 220, Fedlex)', 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de#art_41', '2026-10-01'])
  assert.strictEqual(doc.notice, 'Check the official version before relying on it.')
  const a = await ls.get({ source: 'fedlex', ref: '27/317_321_377', article: '40a' })
  assert.match(a.text, /^Art\. 40a\n1 Die nachfolgenden Bestimmungen/)
  assert.match(a.text, /\na\. der Anbieter .*\nb\. die Leistung des Kunden 100 Franken übersteigt\.\n2 /)
  assert.ok(!/übersteigt\.\d/.test(a.text) && !/\d\d\s*$/.test(a.text.split('\n')[0]), 'no footnote numbers')
  assert.strictEqual(a.citation, 'Art. 40a OR (SR 220, Fedlex)')
  const full = await ls.get({ source: 'fedlex', ref: 'SR 220' })
  assert.match(full.text, /Art\. 41\n/)
  await assert.rejects(ls.get({ source: 'fedlex', ref: '220', article: '9999' }), (err) => /Art\. 9999 was not found in OR/.test(err.plain))
  await assert.rejects(ls.get({ source: 'fedlex', ref: '../../etc' }), (err) => /give the SR number/.test(err.plain))
  await assert.rejects(ls.get({ source: 'fedlex', ref: '999.999' }), (err) => err.plain === 'Fedlex Switzerland has no such document')
})

test('opencaselaw.ch: MCP search with structured results; a decision and one consideration', async () => {
  const r = await ls.search({ query: 'Mietzinserhöhung Kündigung', sources: ['opencaselaw'] })
  assert.deepStrictEqual(r.searched, ['opencaselaw'])
  const hit = r.results[0]
  assert.deepStrictEqual([hit.source, hit.ref, hit.citation, hit.date, hit.jurisdiction], ['opencaselaw', 'bge_115 II 83', 'BGE 115 II 83 (opencaselaw.ch)', '1989-01-11', 'CH'])
  assert.match(hit.url, /^https:\/\/search\.bger\.ch\//, 'the court\'s own publication')
  assert.match(hit.snippet, /^Art\. 18 Abs\. 3 BMM\. Nichtigkeit einer Kündigung/)
  assert.match(hit.licence, /^CC0/)
  assert.match(r.results[1].title, /^ZH Mietgericht, MJ210065-L, 2022-08-22: /)
  const call = seen.filter((s) => s.path === '/ocl/mcp').map((s) => JSON.parse(s.body)).find((m) => m.method === 'tools/call')
  assert.deepStrictEqual(call.params, { name: 'search_decisions', arguments: { query: 'Mietzinserhöhung Kündigung', limit: 5, fields: 'full' } })
  const doc = await ls.get({ source: 'opencaselaw', ref: hit.ref })
  assert.match(doc.text, /^Urteilskopf\n115 II 83/)
  assert.deepStrictEqual([doc.citation, doc.title], ['BGE 115 II 83 (opencaselaw.ch)', 'Bundesgericht (BGE), 115 II 83, 1989-01-11'])
  const e = await ls.get({ source: 'opencaselaw', ref: hit.ref, article: 'E. 2' })
  assert.match(e.text, /^E\. 2\nAux termes de l'art\. 18 al\. 3 AMSL, une résiliation/)
  assert.strictEqual(e.citation, 'BGE 115 II 83, E. 2 (opencaselaw.ch)')
  await assert.rejects(ls.get({ source: 'opencaselaw', ref: hit.ref, article: 'E. 99' }), (err) => /has no such document/.test(err.plain))
  await assert.rejects(ls.get({ source: 'opencaselaw', ref: 'nope' }), (err) => /has no such document/.test(err.plain))
})

test('jurisdiction CH asks both; down or offline: one plain sentence, the other still answers', async () => {
  let r = await ls.search({ query: 'Obligationenrecht', jurisdiction: 'CH' })
  assert.ok(r.searched.includes('fedlex') && r.searched.includes('opencaselaw'), r.searched.join())
  r = await ls.search({ query: 'Obligationenrecht', jurisdiction: 'CH', kind: 'caselaw' })
  assert.ok(!r.searched.includes('fedlex') && r.searched.includes('opencaselaw'))
  down = new Set(['ocl'])
  r = await ls.search({ query: 'Obligationenrecht', sources: ['fedlex', 'opencaselaw'] })
  assert.ok(r.results.length && r.results.every((x) => x.source === 'fedlex'))
  assert.strictEqual(r.skipped.find((s) => s.source === 'opencaselaw').reason, 'opencaselaw.ch is not answering right now; try again later')
  down = new Set(['fedlex'])
  await assert.rejects(ls.get({ source: 'fedlex', ref: '220' }), (err) => err.plain === 'Fedlex Switzerland is not answering right now; try again later')
  const saved = process.env.OPENLEX_FEDLEX_SPARQL
  process.env.OPENLEX_FEDLEX_SPARQL = 'http://127.0.0.1:9/sparql'
  try {
    r = await ls.search({ query: '220', sources: ['fedlex'] })
    assert.match(r.skipped[0].reason, /could not be reached \(no internet connection, or the service is down\)/)
  } finally { process.env.OPENLEX_FEDLEX_SPARQL = saved }
})

test('data policy: local-only contacts neither; status words in English and German', async () => {
  policy.setRule(null, { mode: 'local-only' })
  const before = seen.length
  const r = await policy.withMatter(null, () => ls.search({ query: 'Mietrecht', jurisdiction: 'CH' }))
  assert.strictEqual(seen.length, before, 'nothing left this computer')
  assert.ok(r.skipped.every((s) => /keeps OpenLex offline/.test(s.reason)))
  let st = (await ls.status()).find((s) => s.id === 'opencaselaw')
  assert.strictEqual(st.status, 'opencaselaw.ch: free, but your client-data rule keeps OpenLex offline')
  policy.setRule(null, { mode: 'allow-list', providers: ['web'] })
  st = (await ls.status()).find((s) => s.id === 'opencaselaw')
  assert.strictEqual(st.status, 'opencaselaw.ch: connected, free (community source)')
  assert.strictEqual(st.statusDe, 'opencaselaw.ch: verbunden, kostenlos (Community-Quelle)')
  const f = (await ls.status()).find((s) => s.id === 'fedlex')
  assert.deepStrictEqual([f.status, f.statusDe], ['Fedlex Switzerland: connected, free', 'Fedlex Schweiz: verbunden, kostenlos'])
})

test('reference parsing', () => {
  const { parseSr, articleId } = require('../src/connectors/fedlex')
  assert.deepStrictEqual(['220', 'SR 210', 'SR-Nr. 0.101', 'Art. 41 OR', 'SR 235.1 DSG'].map(parseSr), ['220', '210', '0.101', null, '235.1'])
  assert.deepStrictEqual(['Art. 41', '40a', 'art. 40 a', 'Artikel 6', 'x'].map(articleId), ['art_41', 'art_40_a', 'art_40_a', 'art_6', null])
  const { eNumber } = require('../src/connectors/opencaselaw')
  assert.deepStrictEqual(['E. 2', 'consid. 5.2.2', 'Erwägung 3', '4', 'foo'].map(eNumber), ['2', '5.2.2', '3', '4', null])
})

// ── optional live checks (free, no key) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET }, async () => {
  for (const k of ['OPENLEX_OPENCASELAW_URL', 'OPENLEX_FEDLEX_SPARQL', 'OPENLEX_FEDLEX_FILES']) delete process.env[k]
  await fn()
})
live('Fedlex', async () => {
  const f = require('../src/connectors/fedlex')
  const r = await f.search('SR 220', { limit: 2 })
  assert.strictEqual(r[0].ref, '27/317_321_377')
  const d = await f.get('220', { article: 'Art. 41' })
  assert.match(d.text, /^Art\. 41\n1 Wer einem andern widerrechtlich Schaden/)
})
live('opencaselaw.ch', async () => {
  const o = require('../src/connectors/opencaselaw')
  o._reset()
  const r = await o.search('Mietzinserhöhung Kündigung', { limit: 2 })
  assert.ok(r.length && r[0].ref && r[0].citation)
})
