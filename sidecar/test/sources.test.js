"use strict"
/**
 * Data sources: the firm's databases and subscriptions as searchable
 * sources (http / mcp / folder), under the data policy.
 *
 *   node --test test/sources.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/sources.test.js   # + live Open Legal Data preset
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-src-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_SOURCE_FIRM_KB = 'kb-secret-token'

const seen = []
const kb = http.createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization })
  const q = new URL(req.url, 'http://x').searchParams.get('q')
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: { hits: [
    { ref: 'KB-17', heading: 'Penalty clauses — firm position', body: `Our standard caps a penalty (${q}) at 10% of the contract value.`, meta: { updated: '2026-09-01' }, link: 'http://kb.local/17' },
    { ref: 'KB-3', heading: 'Older note', body: 'See KB-17.' },
  ] } }))
})

let sources, policy
const setSources = (s) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify({ sources: s }))
const kbSource = () => ({
  type: 'http', kind: 'firm', title: 'Firm KB', url: `http://127.0.0.1:${kb.address().port}/search?q={query}&j={jurisdiction}`,
  auth: { header: 'Authorization', prefix: 'Bearer ' }, results: 'data.hits',
  fields: { id: 'ref', title: 'heading', text: 'body', citation: '{ref} ({meta.updated})', url: 'link', date: 'meta.updated' },
})

test.before(async () => {
  await new Promise((r) => kb.listen(0, '127.0.0.1', r))
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  sources = require('../src/sources')
  policy = require('../src/policy')
})
test.after(() => { kb.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('validation catches bad definitions', () => {
  const p = sources.validate({ 'Bad Name': { type: 'http' }, ok1: { type: 'ftp' }, ok2: { type: 'http', url: 'https://x.example/search' }, ok3: { type: 'mcp', tool: 'search' }, ok4: { type: 'folder' }, ok5: { type: 'http', url: 'https://x/?q={query}', kind: 'gossip' } })
  assert.strictEqual(p.length, 8, p.join('\n'))
  assert.deepStrictEqual(sources.validate({ oldp: sources.PRESETS.oldp }), [])
})

test('field mapping: dotted paths, array indexes and templates', () => {
  const items = sources.mapItems({ results: [{ id: 1, court: 'LGK', decision_type: 'Urteil', date: '2018-10-22', slug: 'lg-koln-x', snippets: [{ text: 'Die <em>Vertragsstrafe</em> ist überhöht.' }] }] }, sources.PRESETS.oldp, 'oldp')
  assert.deepStrictEqual(items[0], { source: 'oldp', kind: 'caselaw', id: '1', title: 'LGK Urteil 2018-10-22', text: 'Die Vertragsstrafe ist überhöht.', citation: 'LGK 2018-10-22 (Urteil)', url: 'https://de.openlegaldata.io/case/lg-koln-x', date: '2018-10-22', jurisdiction: 'DE' })
})

test('a local http source: allowed under local-only, key from the keychain, results mapped with citations', async () => {
  setSources({ 'firm-kb': kbSource() })
  policy.setRule(null, { mode: 'local-only' })
  const r = await policy.withMatter(null, () => sources.search({ query: 'Vertragsstrafe', jurisdiction: 'AT' }))
  assert.deepStrictEqual(r.searched, ['firm-kb'])
  assert.strictEqual(r.results[0].citation, 'KB-17 (2026-09-01)')
  assert.match(r.results[0].text, /caps a penalty \(Vertragsstrafe\)/)
  assert.strictEqual(seen.at(-1).auth, 'Bearer kb-secret-token')
  assert.match(seen.at(-1).url, /q=Vertragsstrafe&j=AT/)
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  assert.ok(audit.includes('"provider":"source:firm-kb"') && !audit.includes('Vertragsstrafe'), 'audited without the query')
})

test('a remote source needs "source:<name>" in the matter policy; filters by kind and jurisdiction', async () => {
  setSources({ 'firm-kb': kbSource(), cases: { ...sources.PRESETS.oldp } })
  policy.setRule(null, { mode: 'local-only' })
  let r = await policy.withMatter(null, () => sources.search({ query: 'x' }))
  assert.deepStrictEqual(r.searched, ['firm-kb'])
  assert.match(r.skipped.find((s) => s.source === 'cases').reason, /allow "source:cases"/)
  r = await policy.withMatter(null, () => sources.search({ query: 'x', kind: 'firm' }))
  assert.deepStrictEqual([r.searched, r.skipped], [['firm-kb'], []], 'kind filter: the case-law source is not even considered')
  r = await policy.withMatter(null, () => sources.search({ query: 'x', jurisdiction: 'AT', sources: ['cases'] }))
  assert.deepStrictEqual(r.searched, [], 'DE-only source skipped for AT')
})

test('mcp sources map JSON tool output and fall back to plain text', async () => {
  const client = require('../src/mcp/client')
  const orig = client.callTool
  client.callTool = async (tool, args) => ({ output: tool.endsWith('json') ? JSON.stringify({ items: [{ t: `Kommentar zu ${args.q}`, cite: 'MüKo BGB § 343 Rn 5' }] }) : 'Plain answer from the DMS.' })
  setSources({ comm: { type: 'mcp', kind: 'commentary', tool: 'mcp__beck__json', args: { q: '{query}' }, results: 'items', fields: { title: 't', text: 't', citation: 'cite' } }, dms: { type: 'mcp', kind: 'firm', tool: 'mcp__dms__search' } })
  policy.setRule(null, { mode: 'allow-list', providers: ['source:comm', 'source:dms'] })
  const r = await policy.withMatter(null, () => sources.search({ query: 'Vertragsstrafe' }))
  client.callTool = orig
  assert.deepStrictEqual(r.results.map((x) => [x.source, x.citation || x.text]), [['comm', 'MüKo BGB § 343 Rn 5'], ['dms', 'Plain answer from the DMS.']])
})

test('the agent tool reports results and what was not searched', async () => {
  setSources({ 'firm-kb': kbSource(), cases: { ...sources.PRESETS.oldp } })
  policy.setRule(null, { mode: 'local-only' })
  const { dispatch } = require('../src/tools')
  const r = await policy.withMatter(null, () => dispatch({}, 'search_sources', { query: 'Vertragsstrafe' }))
  assert.match(r.output, /\(firm-kb · firm\) Penalty clauses — firm position — KB-17/)
  assert.match(r.output, /Not searched: cases: blocked by data policy/)
  assert.match(require('../src/catalog').getCatalogText(), /search_sources: .* — firm-kb \(firm\), cases \(caselaw, DE\)/)
})

test('add / remove presets in the user layer', () => {
  setSources({})
  sources.add('oldp')
  assert.ok(sources.list().some((s) => s.name === 'oldp' && s.kind === 'caselaw' && s.local === false))
  assert.throws(() => sources.add('nope'), /no preset/)
  sources.remove('oldp')
  assert.ok(!sources.list().some((s) => s.name === 'oldp'))
})

test('live: Open Legal Data preset', { skip: process.env.OPENLEX_TEST_NETWORK !== '1' }, async () => {
  setSources({ oldp: sources.PRESETS.oldp })
  policy.setRule(null, { mode: 'allow-list', providers: ['source:openlegaldata'] })
  const r = await policy.withMatter(null, () => sources.search({ query: 'Vertragsstrafe', limit: 3 }))
  assert.ok(r.results.length > 0, JSON.stringify(r.skipped))
  assert.match(r.results[0].url, /^https:\/\/de\.openlegaldata\.io\/case\//)
})
