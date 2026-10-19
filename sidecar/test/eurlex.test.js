"use strict"
/**
 * EUR-Lex adapter (Phase 5): EU law from the Publications Office's Cellar.
 *
 *   node --test test/eurlex.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/eurlex.test.js   # + live Cellar, live download
 *
 * Offline: a fake SPARQL endpoint + Cellar on localhost.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-eurlex-'))
process.env.LEXVAULT_DATA_DIR = DATA

const XHTML = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>
<p class="title-article-norm">Artikel 16</p><p>Recht auf Berichtigung</p><p>Die betroffene Person hat das Recht &#8222;unverz&#252;glich&#8220; …</p>
<p class="title-article-norm">Artikel 17</p><p>Recht auf L&ouml;schung</p><table><tr><td>(1)</td><td>Die betroffene Person hat das Recht, zu verlangen, dass sie betreffende Daten gel&#246;scht werden.</td></tr></table>
<p class="title-article-norm">Artikel 18</p><p>Recht auf Einschr&#228;nkung</p></body></html>`

const queries = []
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/sparql') {
    const q = u.searchParams.get('query')
    queries.push(q)
    const rows = q.includes('VALUES ?celex')
      ? [
          { celex: '32016R0679', title: 'Verordnung (EU) 2016/679 (Datenschutz-Grundverordnung)', force: '1', date: '2016-04-27', cons: '02016R0679-20160504', consDate: '2016-05-04' },
          { celex: '32016R0679', title: 'Verordnung (EU) 2016/679 (Datenschutz-Grundverordnung)', force: '1', date: '2016-04-27', cons: '02016R0679-20160501', consDate: '2016-05-01' },
          { celex: '31995L0046', title: 'Richtlinie 95/46/EG', force: '0', date: '1995-10-24' },
        ].filter((r) => q.includes(`"${r.celex}"`))
      : [{ celex: '31995L0046' }, { celex: '32016R0679' }]
    res.writeHead(200, { 'Content-Type': 'application/sparql-results+json' })
    return res.end(JSON.stringify({ results: { bindings: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { type: 'literal', value: v }]))) } }))
  }
  if (u.pathname.startsWith('/celex/')) {
    queries.push(`GET ${u.pathname} ${req.headers['accept-language']}`)
    res.writeHead(200, { 'Content-Type': 'application/xhtml+xml' })
    return res.end(XHTML)
  }
  res.writeHead(404); res.end()
})

let eurlex, tools
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  process.env.OPENLEX_CELLAR_SPARQL = `${base}/sparql`
  process.env.OPENLEX_CELLAR_BASE = `${base}/celex`
  eurlex = require('../src/web/eurlex')
  tools = require('../src/tools')
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('references and common names map to CELEX numbers', () => {
  assert.deepStrictEqual(eurlex.parseReference('DSGVO'), ['32016R0679'])
  assert.deepStrictEqual(eurlex.parseReference('Regulation (EC) No 593/2008'), ['32008R0593'], 'old style: number/year')
  assert.deepStrictEqual(eurlex.parseReference('Richtlinie (EU) 2019/1937'), ['32019L1937'], 'new style: year/number')
  assert.deepStrictEqual(eurlex.parseReference('2016/679'), ['32016R0679', '32016L0679', '32016D0679'], 'no type → all candidates')
  assert.deepStrictEqual(eurlex.parseReference('CELEX 32012R1215'), ['32012R1215'])
  assert.strictEqual(eurlex.parseReference('late payment in commercial transactions'), null)
})

test('search: in force first, newest consolidated version, language-specific title', async () => {
  const r = await eurlex.search('GDPR', { lang: 'de' })
  assert.strictEqual(r.mode, 'reference')
  assert.strictEqual(r.results[0].celex, '32016R0679')
  assert.strictEqual(r.results[0].consolidated.celex, '02016R0679-20160504', 'latest of several consolidations')
  assert.match(r.results[0].url, /legal-content\/DE\/TXT\/\?uri=CELEX:02016R0679-20160504$/)
  assert.ok(queries.some((q) => q.includes('language/DEU')))
  const t = await eurlex.search('Schutz personenbezogener Daten', { lang: 'de' })
  assert.strictEqual(t.mode, 'title')
  assert.deepStrictEqual(t.results.map((x) => [x.celex, x.inForce]), [['32016R0679', true], ['31995L0046', false]])
})

test('text: consolidated version, entities decoded, one article cut out', async () => {
  const r = await eurlex.text('32016R0679', { lang: 'de', article: '17' })
  assert.strictEqual(r.celex, '02016R0679-20160504')
  assert.ok(queries.some((q) => q === 'GET /celex/02016R0679-20160504 deu'), 'Accept-Language uses the Cellar code')
  assert.match(r.text, /^Artikel 17\nRecht auf Löschung\n\(1\) Die betroffene Person hat das Recht/)
  assert.ok(!/Artikel 18|Berichtigung/.test(r.text), 'only the requested article')
  await assert.rejects(eurlex.text('32016R0679', { lang: 'de', article: '99' }), /Article 99 not found/)
  await assert.rejects(eurlex.text('x; rm -rf'), /not a CELEX/)
})

test('agent tools: blocked without web access, results with sources when allowed', async () => {
  const policy = require('../src/policy')
  policy.setRule(null, { mode: 'local-only' })
  const blocked = await tools.dispatch({ doc: { jurisdiction: () => 'AT' } }, 'search_eurlex', { query: 'GDPR' })
  assert.match(blocked.output, /BLOCKED by data policy/)
  policy.setRule(null, { mode: 'allow-list', providers: ['web'] })
  const r = await tools.dispatch({ doc: { jurisdiction: () => 'AT' } }, 'search_eurlex', { query: 'GDPR' })
  assert.match(r.output, /CELEX 32016R0679 — Verordnung \(EU\) 2016\/679/)
  assert.strictEqual(r.webSources[0].inForce, true)
  const a = await tools.dispatch({ doc: { jurisdiction: () => 'AT' } }, 'get_eu_law', { celex: '32016R0679', article: '17' })
  assert.match(a.output, /Article 17 \(de, https:\/\/eur-lex/)
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  assert.ok(audit.includes('"model":"publications.europa.eu"') && !audit.includes('Löschung'), 'audit holds the host, never content')
})

test('live: GDPR article 17 in German from the real Cellar', { skip: !NET }, async () => {
  delete require.cache[require.resolve('../src/web/eurlex')]
  delete process.env.OPENLEX_CELLAR_SPARQL
  delete process.env.OPENLEX_CELLAR_BASE
  const live = require('../src/web/eurlex')
  const s = await live.search('DSGVO', { lang: 'de' })
  assert.strictEqual(s.results[0].celex, '32016R0679')
  assert.strictEqual(s.results[0].inForce, true)
  const a = await live.text('32016R0679', { lang: 'de', article: '17' })
  assert.match(a.text, /^Artikel 17\nRecht auf Löschung/)
})

test('live: download a public PDF into the matter with provenance', { skip: !NET }, async () => {
  const ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'ws'))
  const browser = require('../src/web/browser')
  try {
    const r = await browser.downloadToMatter('https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40216891/NOR40216891.pdf', 'Test matter')
    assert.strictEqual(r.contentType, 'application/pdf')
    assert.match(fs.readFileSync(r.path).subarray(0, 5).toString(), /%PDF-/)
    assert.strictEqual(JSON.parse(fs.readFileSync(`${r.path}.provenance.json`, 'utf8')).sha256, r.sha256)
  } finally { await browser.close() }
})
