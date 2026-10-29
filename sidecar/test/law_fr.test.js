"use strict"
/**
 * France: Légifrance (codes and consolidated laws) and Judilibre (court
 * decisions), both through PISTE with one key of the lawyer's own
 * ("client_id:client_secret" → OAuth client credentials → bearer token).
 * Offline: a fake PISTE (token endpoint + both APIs) answers with
 * responses shaped like the published API descriptions
 * (test/fixtures/law-sources/fr). No live calls, no real keys.
 *
 *   node --test test/law_fr.test.js
 *   OPENLEX_TEST_NETWORK=1 OPENLEX_KEY_SOURCE_PISTE=id:secret node --test test/law_fr.test.js   # + live, with your own key
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const LIVE_KEY = process.env.OPENLEX_KEY_SOURCE_PISTE || null
delete process.env.OPENLEX_KEY_SOURCE_PISTE // the tests use their own fake key
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-fr-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const FIX = path.join(__dirname, 'fixtures', 'law-sources', 'fr')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

const seen = []
const valid = new Set()
const fake = { tokens: 0, subscribed: { lf: true, jl: true }, down: new Set() }
const mem = new Map()

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const p = u.pathname
    seen.push({ path: req.url, method: req.method, headers: req.headers, body })
    const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)) }
    const api = p.split('/')[1]
    if (fake.down.has(api)) return json({}, 503)
    if (p === '/piste/token') {
      const f = new URLSearchParams(body)
      if (f.get('grant_type') !== 'client_credentials' || f.get('client_id') !== 'app-1' || f.get('client_secret') !== 's3cret' || f.get('scope') !== 'openid') return json({ error: 'invalid_client' }, 400)
      const t = `pt-${++fake.tokens}`
      valid.add(t)
      return json({ access_token: t, token_type: 'Bearer', expires_in: 3600, scope: 'openid' })
    }
    if (api === 'lf' || api === 'jl') {
      if (!valid.has(String(req.headers.authorization || '').replace(/^Bearer /, ''))) return json({ error: 'invalid_token' }, 401)
      if (!fake.subscribed[api]) return json({ error: 'Forbidden' }, 403)
    }
    if (p === '/lf/search' && req.method === 'POST') {
      const b = JSON.parse(body)
      return json(fixture(b.fond === 'CODE_DATE' ? 'legifrance-search-code.json' : 'legifrance-search-loda.json'))
    }
    if (p === '/lf/consult/getArticle') {
      const { id } = JSON.parse(body)
      if (id === 'LEGIARTI000032041571') return json(fixture('legifrance-article.json'))
      if (id === 'LEGIARTI000006438819') return json(fixture('legifrance-article-old.json'))
      return json({ error: 'not found' }, 404)
    }
    if (p === '/lf/consult/getArticleWithIdAndNum') {
      const { id, num } = JSON.parse(body)
      if (id === 'LEGITEXT000006070721' && num === '1240') return json(fixture('legifrance-article.json'))
      return json({ executionTime: 3, article: null })
    }
    if (p === '/lf/consult/legiPart') return json(fixture('legifrance-text.json'))
    if (p === '/jl/search') return json(fixture('judilibre-search.json'))
    if (p === '/jl/decision') return u.searchParams.get('id') === '5fca7d162a251e6bf9c78514' ? json(fixture('judilibre-decision.json')) : json({ message: 'decision not found' }, 404)
    json({}, 404)
  })
})

let ls
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  Object.assign(process.env, { OPENLEX_PISTE_TOKEN_URL: `${base}/piste/token`, OPENLEX_LEGIFRANCE_API: `${base}/lf`, OPENLEX_JUDILIBRE_API: `${base}/jl` })
  ls = require('../src/connectors')
  ls._setStore({ get: async (n) => (mem.has(n) ? mem.get(n) : null), set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
  require('../src/policy').setRule(null, { mode: 'allow-list', providers: ['web'] })
})
test.after(() => { server.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => {
  mem.clear(); fake.down = new Set(); fake.subscribed = { lf: true, jl: true }
  require('../src/connectors/legifrance')._reset()
})

test('one PISTE key for both: needed, checked for its shape, shared through the keychain', async () => {
  let st = await ls.status()
  const lf = st.find((s) => s.id === 'legifrance')
  const jl = st.find((s) => s.id === 'judilibre')
  assert.strictEqual(lf.status, 'Légifrance: needs your free PISTE key: how to get it')
  assert.strictEqual(lf.statusDe, 'Légifrance (Frankreich): braucht Ihren kostenlosen PISTE-Schlüssel: so erhalten Sie ihn')
  assert.strictEqual(jl.status, 'Judilibre: needs your free PISTE key: how to get it')
  assert.deepStrictEqual([lf.country, lf.kind, jl.kind, lf.guide], ['FR', 'law', 'caselaw', 'https://github.com/N9394/openlex/blob/main/docs/SOURCES.md#piste'])
  assert.match(lf.keyHelp, /piste\.gouv\.fr.*id:secret/)
  const r = await ls.search({ query: 'dommage', jurisdiction: 'FR' })
  assert.ok(r.skipped.some((s) => s.source === 'legifrance' && /needs your free PISTE key \(how to get it: .*#piste\)/.test(s.reason)))
  await assert.rejects(ls.setKey('legifrance', 'just-a-token'), (err) => /client-id:client-secret/.test(err.plain))
  await ls.setKey('judilibre', 'app-1:s3cret')
  assert.strictEqual(mem.get('source-piste'), 'app-1:s3cret', 'kept once, under the shared name')
  st = await ls.status()
  assert.strictEqual(st.find((s) => s.id === 'legifrance').status, 'Légifrance: connected, free (with your key)')
  assert.strictEqual(st.find((s) => s.id === 'judilibre').statusDe, 'Judilibre (Frankreich): verbunden, kostenlos (mit Ihrem Schlüssel)')
})

test('FR search asks both, with provenance; one token for all calls; the secret only goes to the token endpoint', async () => {
  mem.set('source-piste', 'app-1:s3cret')
  const mark = seen.length
  const before = fake.tokens
  const r = await ls.search({ query: 'dommage réparer', jurisdiction: 'FR', limit: 3 })
  assert.deepStrictEqual(r.searched.sort(), ['judilibre', 'legifrance'])
  assert.ok(!r.searched.includes('ansvar'), 'official sources cover FR: no gateway')
  const art = r.results.find((x) => x.source === 'legifrance')
  assert.deepStrictEqual([art.ref, art.title, art.citation, art.url, art.date, art.inForce], ['LEGIARTI000032041571', 'Code civil, article 1240', 'Art. 1240 C. civ.', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041571', '2016-10-01', true])
  assert.match(art.snippet, /^Sous-titre II : La responsabilité extracontractuelle: Tout fait quelconque de l'homme, qui cause à autrui un dommage/)
  assert.ok(!/<mark>/.test(art.snippet))
  assert.match(art.licence, /Licence Ouverte 2\.0/)
  assert.match(art.retrieved, /^\d{4}-\d\d-\d\dT/)
  const dec = r.results.find((x) => x.source === 'judilibre')
  assert.deepStrictEqual([dec.citation, dec.url, dec.date], ['Cass. 3e civ., 20 déc. 2018, n° 17-18.194', 'https://www.courdecassation.fr/decision/5fca7d162a251e6bf9c78514', '2018-12-20'])
  assert.strictEqual(dec.title, 'Cour de cassation, troisième chambre civile, 2018-12-20, 17-18.194')
  assert.match(dec.snippet, /^rejet · Le titulaire d'une autorisation temporaire/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  // Légifrance: codes first (version in force today), then the laws to fill up.
  const calls = seen.slice(mark).filter((x) => x.path === '/lf/search').map((x) => JSON.parse(x.body))
  assert.deepStrictEqual(calls.map((b) => b.fond), ['CODE_DATE', 'LODA_DATE'])
  assert.strictEqual(calls[0].recherche.champs[0].criteres[0].valeur, 'dommage réparer')
  assert.strictEqual(calls[0].recherche.filtres[0].facette, 'DATE_VERSION')
  assert.strictEqual(calls[0].recherche.typePagination, 'ARTICLE')
  const loda = r.results.filter((x) => x.source === 'legifrance').find((x) => x.ref === 'LEGIARTI000006475070')
  assert.strictEqual(loda.citation, "Art. 1, Loi n° 85-677 du 5 juillet 1985 tendant à l'amélioration de la situation des victimes d'accidents de la circulation (Légifrance, LEGIARTI000006475070)")
  assert.strictEqual(loda.url, 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006475070')
  // Judilibre: the query and page size in the URL.
  const q = new URL(seen.slice(mark).find((x) => x.path.startsWith('/jl/search')).path, 'http://x').searchParams
  assert.deepStrictEqual([q.get('query'), q.get('page_size')], ['dommage réparer', '3'])
  assert.strictEqual(fake.tokens - before, 1, 'one token, cached')
  const api = seen.slice(mark).filter((x) => /^\/(lf|jl)\//.test(x.path))
  assert.ok(api.every((x) => /^Bearer pt-\d+$/.test(x.headers.authorization)))
  assert.ok(!api.some((x) => /s3cret/.test(JSON.stringify(x))), 'the secret only goes to the token endpoint')
})

test('Légifrance: an article by id, by code and number, a whole text; an old version says so', async () => {
  mem.set('source-piste', 'app-1:s3cret')
  let doc = await ls.get({ source: 'legifrance', ref: 'LEGIARTI000032041571' })
  assert.deepStrictEqual([doc.title, doc.citation, doc.url], ['Code civil, article 1240', 'Art. 1240 C. civ.', 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041571'])
  assert.match(doc.text, /^Article 1240\nTout fait quelconque de l'homme/)
  assert.strictEqual(doc.notice, 'Check the official version before relying on it.')
  doc = await ls.get({ source: 'legifrance', ref: 'Code civil', article: '1240' })
  assert.strictEqual(doc.citation, 'Art. 1240 C. civ.')
  doc = await ls.get({ source: 'legifrance', ref: 'LEGITEXT000006070721', article: 'art. 1240' })
  assert.strictEqual(doc.ref, 'LEGIARTI000032041571')
  const byNum = seen.filter((x) => x.path === '/lf/consult/getArticleWithIdAndNum').at(-1)
  assert.deepStrictEqual(JSON.parse(byNum.body), { id: 'LEGITEXT000006070721', num: '1240' })
  await assert.rejects(ls.get({ source: 'legifrance', ref: 'LEGITEXT000006070721', article: '99999' }), (err) => /article 99999 was not found/.test(err.plain))
  // A reference typed as a lawyer writes it goes straight to the article.
  const r = await ls.search({ query: 'art. 1240 C. civ.', sources: ['legifrance'] })
  assert.deepStrictEqual([r.results.length, r.results[0].citation], [1, 'Art. 1240 C. civ.'])
  const old = await ls.get({ source: 'legifrance', ref: 'LEGIARTI000006438819' })
  assert.strictEqual(old.citation, 'Art. 1382 C. civ.')
  assert.match(old.note, /^This version of the article is not in force \(Légifrance status: MODIFIE\); in force from 1800-01-01 to 2016-10-01\.$/)
  const text = await ls.get({ source: 'legifrance', ref: 'LEGITEXT000006068884' })
  assert.match(text.title, /^Loi n° 85-677 du 5 juillet 1985/)
  assert.match(text.text, /^Chapitre Ier : Indemnisation.*\nArticle 1\nLes dispositions du présent chapitre/)
  assert.match(text.text, /\nArticle 2\nLes victimes, y compris les conducteurs/)
  await assert.rejects(ls.get({ source: 'legifrance', ref: '../../etc/passwd' }), (err) => /give the identifier from a search result/.test(err.plain))
})

test('Judilibre: a decision in full or one part of it', async () => {
  mem.set('source-piste', 'app-1:s3cret')
  const d = await ls.get({ source: 'judilibre', ref: '5fca7d162a251e6bf9c78514' })
  assert.strictEqual(d.citation, 'Cass. 3e civ., 20 déc. 2018, n° 17-18.194')
  assert.match(d.text, /^CIV\. 3\r?\nCOUR DE CASSATION/)
  assert.match(d.licence, /L111-13 COJ/)
  const disp = await ls.get({ source: 'judilibre', ref: '5fca7d162a251e6bf9c78514', article: 'dispositif' })
  assert.match(disp.text, /^PAR CES MOTIFS, la Cour :\r?\nREJETTE le pourvoi ;$/)
  const why = await ls.get({ source: 'judilibre', ref: '5fca7d162a251e6bf9c78514', article: 'reasons' })
  assert.match(why.text, /^Mais attendu qu'ayant relevé/)
  await assert.rejects(ls.get({ source: 'judilibre', ref: '5fca7d162a251e6bf9c78514', article: 'moyens' }), (err) => /has no part "moyens"/.test(err.plain))
  await assert.rejects(ls.get({ source: 'judilibre', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), (err) => err.plain === 'Judilibre has no such document')
  await assert.rejects(ls.get({ source: 'judilibre', ref: 'x/../y' }), (err) => /give the identifier/.test(err.plain))
  const cit = require('../src/connectors/judilibre').citation('x', { jurisdiction: 'ca', location: 'ca_aix_en_provence', decision_date: '2024-03-01', number: '22/01234' })
  assert.strictEqual(cit, 'CA Aix-En-Provence, 1er mars 2024, n° 22/01234')
})

test('plain errors: wrong key, API not subscribed, token refused early, a service down, no connection', async () => {
  mem.set('source-piste', 'app-1:wrong')
  let r = await ls.search({ query: 'dommage', sources: ['legifrance'] })
  assert.match(r.skipped[0].reason, /^Légifrance did not accept the key \(check the client id and secret of your PISTE application\)$/)
  mem.set('source-piste', 'app-1:s3cret')
  fake.subscribed.jl = false
  r = await ls.search({ query: 'dommage', sources: ['judilibre'] })
  assert.strictEqual(r.skipped[0].reason, 'Judilibre did not accept the key: subscribe your PISTE application to the Judilibre API and accept its terms (CGU) on piste.gouv.fr')
  fake.subscribed.jl = true
  // The gateway forgets a token before its time: renewed once, quietly.
  valid.clear()
  const before = fake.tokens
  r = await ls.search({ query: 'dommage', sources: ['judilibre'] })
  assert.strictEqual(r.results.length, 2)
  assert.strictEqual(fake.tokens - before, 1)
  fake.down = new Set(['lf'])
  r = await ls.search({ query: 'dommage', jurisdiction: 'FR' })
  assert.strictEqual(r.skipped.find((s) => s.source === 'legifrance').reason, 'Légifrance is not answering right now; try again later')
  assert.ok(r.results.length && r.results.every((x) => x.source === 'judilibre'), 'the other one still answers')
  fake.down = new Set()
  const saved = process.env.OPENLEX_JUDILIBRE_API
  process.env.OPENLEX_JUDILIBRE_API = 'http://127.0.0.1:9'
  try {
    r = await ls.search({ query: 'dommage', sources: ['judilibre'] })
    assert.match(r.skipped[0].reason, /^Judilibre could not be reached \(no internet connection, or the service is down\)$/)
  } finally { process.env.OPENLEX_JUDILIBRE_API = saved }
})

test('local-only data rule: nothing is sent, not even for the token', async () => {
  mem.set('source-piste', 'app-1:s3cret')
  const policy = require('../src/policy')
  policy.setRule(null, { mode: 'local-only' })
  try {
    const mark = seen.length
    const r = await policy.withMatter(null, () => ls.search({ query: 'dommage', jurisdiction: 'FR' }))
    assert.strictEqual(seen.length, mark)
    assert.ok(r.skipped.every((s) => /keeps OpenLex offline/.test(s.reason)))
    assert.strictEqual((await ls.status()).find((s) => s.id === 'legifrance').status, 'Légifrance: key saved, but your client-data rule keeps OpenLex offline')
  } finally { policy.setRule(null, { mode: 'allow-list', providers: ['web'] }) }
})

// ── optional live checks: only with the lawyer's own PISTE key (free) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET || !LIVE_KEY ? 'needs OPENLEX_TEST_NETWORK=1 and OPENLEX_KEY_SOURCE_PISTE=id:secret' : false }, async () => {
  for (const k of ['OPENLEX_PISTE_TOKEN_URL', 'OPENLEX_LEGIFRANCE_API', 'OPENLEX_JUDILIBRE_API']) delete process.env[k]
  require('../src/connectors/legifrance')._reset()
  await fn()
})
live('Légifrance', async () => {
  const lf = require('../src/connectors/legifrance')
  const r = await lf.search('art. 1240 C. civ.', { limit: 2 }, { key: LIVE_KEY })
  assert.strictEqual(r[0].citation, 'Art. 1240 C. civ.')
})
live('Judilibre', async () => {
  const r = await require('../src/connectors/judilibre').search('clause abusive', { limit: 2 }, { key: LIVE_KEY })
  assert.ok(r.length && /^[a-f0-9]{24}$/.test(r[0].ref))
})
