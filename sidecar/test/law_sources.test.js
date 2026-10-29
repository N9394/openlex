"use strict"
/**
 * Law sources (connectors/): official sources and a paid gateway behind
 * one interface, with provenance, under the data policy and the
 * permissions broker. Offline: one local fake server answers for every
 * source with responses recorded from the real services
 * (test/fixtures/law-sources), a fake MCP gateway for Ansvar and a fake
 * OAuth server (metadata, client registration, device code, PKCE, refresh).
 * No live calls, no paid calls.
 *
 *   node --test test/law_sources.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_sources.test.js   # + one live search per free official source
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-law-'))
process.env.LEXVAULT_DATA_DIR = DATA
const FIX = path.join(__dirname, 'fixtures', 'law-sources')
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')

const seen = [] // { path, method, headers, body }
let down = new Set() // sources the fake answers with 503
let ansvarCap = false
const validTokens = new Set(['tok-123'])
const auth = { register: 'open', device: 'ok', approved: false, polls: 0, registrations: 0, refreshes: 0, rotate: 1, refreshOk: true, codes: new Map() }
const mem = new Map() // the keychain, for these tests
const SATURDAY = '2026-10-31T10:00:00Z'

const XHTML = '<html><body><p>Artikel 17</p><p>Recht auf Löschung</p><p>(1) Die betroffene Person hat das Recht …</p><p>Artikel 18</p><p>Einschränkung</p></body></html>'

function ansvar(req, res, body) {
  const msg = JSON.parse(body || '{}')
  if (!validTokens.has(String(req.headers.authorization || '').replace(/^Bearer /, ''))) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid_token"}') }
  const reply = (result, sse = false) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...result })
    if (sse) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sess-1' }); return res.end(`event: message\ndata: ${payload}\n\n`) }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' })
    return res.end(payload)
  }
  if (msg.method === 'initialize') return reply({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-ansvar', version: '1' } } })
  if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end() }
  if (req.headers['mcp-session-id'] !== 'sess-1') { res.writeHead(400); return res.end() }
  if (msg.method === 'tools/list') {
    return reply({ result: { tools: [
      { name: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, jurisdiction: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
      { name: 'get_provision', inputSchema: { type: 'object', properties: { provision_id: { type: 'string' } }, required: ['provision_id'] } },
    ] } }, true)
  }
  if (msg.method === 'tools/call' && ansvarCap) return reply({ error: { code: -32000, message: 'cap_exceeded: daily search quota reached' } })
  if (msg.method === 'tools/call' && msg.params.name === 'search') {
    return reply({ result: { content: [{ type: 'text', text: JSON.stringify({ results: [
      { id: 'fr-cc-1240', title: 'Code civil, article 1240', citation: 'Art. 1240 C. civ.', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041571', snippet: `Tout fait quelconque de l'homme … (${msg.params.arguments.query} / ${msg.params.arguments.jurisdiction})`, jurisdiction: 'FR' },
    ] }) }] } }, true)
  }
  if (msg.method === 'tools/call' && msg.params.name === 'get_provision') {
    return reply({ result: { content: [{ type: 'text', text: JSON.stringify({ title: 'Code civil, article 1240', citation: 'Art. 1240 C. civ.', url: 'https://www.legifrance.gouv.fr/x', text: `Tout fait quelconque de l'homme, qui cause à autrui un dommage, oblige celui par la faute duquel il est arrivé à le réparer. [${msg.params.arguments.provision_id}]` }) }] } })
  }
  return reply({ error: { code: -32601, message: 'unknown method' } })
}

const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const p = u.pathname
    seen.push({ path: req.url, method: req.method, headers: req.headers, body, t: Date.now() })
    const src = p.split('/')[1]
    if (down.has(src)) { res.writeHead(503); return res.end() }
    const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)) }
    const html = (s) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(s) }
    // RIS
    if (p === '/ris/Bundesrecht') return json(fixture('ris-search.json'))
    if (p.startsWith('/risdocs/')) return html(fixture('ris-doc.html'))
    // EUR-Lex (Cellar)
    if (p === '/eu/sparql') {
      const q = u.searchParams.get('query')
      const rows = q.includes('VALUES ?celex') ? [{ celex: '32016R0679', title: 'Verordnung (EU) 2016/679 (Datenschutz-Grundverordnung)', force: '1', date: '2016-04-27', cons: '02016R0679-20160504', consDate: '2016-05-04' }] : [{ celex: '32016R0679' }]
      return json({ results: { bindings: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { type: 'literal', value: v }]))) } })
    }
    if (p.startsWith('/eu/celex/')) return html(XHTML)
    // NeuRIS
    if (p === '/neuris/v1/legislation') return json(fixture('neuris-search.json'))
    if (p.startsWith('/neuris/v1/legislation/eli/') && p.endsWith('.html')) return html('<html><body><h1>Flächenerwerbsverordnung</h1><p>§ 9 Preis</p><p>Der Kaufpreis …</p><p>§ 10 Verkaufsangebot</p><p>Kaufbewerber nach § 3 Abs. 5 werden aufgefordert …</p><p>§ 11 Rücktritt</p><p>…</p></body></html>')
    if (p.startsWith('/neuris/v1/legislation/eli/')) {
      const id = p.replace('/neuris/v1/legislation/', '')
      return json({ name: 'Verordnung über den Erwerb land- und forstwirtschaftlicher Flächen', abbreviation: 'FlErwV', legislationIdentifier: id, encoding: [{ encodingFormat: 'text/html', contentUrl: `/v1/legislation/${id}/2021-08-17/regelungstext-1.html` }] })
    }
    // Slov-Lex (static edition)
    if (p === '/sk/static/SK/ZZ/1991/513/') return html(fixture('slovlex-history.html'))
    if (p === '/sk/static/SK/ZZ/1991/513/20260817.html') return html(fixture('slovlex-version.html'))
    if (p.startsWith('/sk/')) { res.writeHead(404); return res.end() }
    // e-Sbírka open data (CC0): the SPARQL endpoint, answered by what the query asks
    if (p === '/czopen/sparql') {
      const q = new URLSearchParams(body).get('query') || ''
      const rows = (list) => json({ head: { vars: [] }, results: { bindings: list.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { type: 'literal', value: v }]))) } })
      const V = 'https://opendata.eselpoint.gov.cz/esel-esb/eli/cz/sb/2012/89'
      const K = 'https://opendata.eselpoint.gov.cz/esel-esb/cis-esb-typ-znění/položka/'
      if (/s:má-znění \?v/.test(q)) return rows(q.includes(`<${V}>`) ? [{ v: `${V}/0000-00-00`, od: '2012-03-22', t: `${K}VYHLZNE` }, { v: `${V}/2014-01-01`, od: '2014-01-01', do: '2019-12-31', t: `${K}KONSOL` }, { v: `${V}/2020-01-01`, od: '2020-01-01', t: `${K}KONSOL` }] : [])
      if (/LIMIT 8$/.test(q)) return rows([{ ord: '5AC0', txt: '89' }, { ord: '5B40', txt: 'ZÁKON' }, { ord: '5BC0', txt: 'ze dne 3. února 2012' }, { ord: '5C20', txt: 'občanský zákoník' }, { ord: '5C60', txt: 'Parlament se usnesl na tomto zákoně České republiky:' }])
      if (/má-předka\+/.test(q)) return rows(q.includes('"§ 2"') && q.includes(`<${V}/2020-01-01>`) ? [{ ord: '6ADAD7AC', txt: '<var>(1)</var> Každé ustanovení soukromého práva lze vykládat jenom ve shodě s <a href="#">Listinou</a> …' }, { ord: '6ADAD7B4', txt: '<var>(2)</var> Zákonnému ustanovení nelze přikládat jiný význam …' }] : [])
      if (/bif:contains/.test(q)) return rows([
        { url: '/sb/2012/89/2020-01-01#par_9-odst_1', cit: '§ 9 odst. 1', txt: '<var>(1)</var> Občanský zákoník upravuje osobní stav osob.', od: '2020-01-01' },
        { url: '/sb/2012/89/2020-01-01#par_10', cit: '§ 10', txt: 'second hit in the same act', od: '2020-01-01' },
        { url: '/sb/1999/166/2026-01-01#par_53c-odst_6', cit: '§ 53c odst. 6', txt: '<var>(6)</var> Občanský zákoník se pro účely tohoto ustanovení použije.', od: '2026-01-01' },
      ])
      return rows([])
    }
    // e-Sbírka: the registered REST API (key in the header)
    if (src === 'czkey') {
      if (req.headers['esel-api-access-key'] !== 'dia-key') return json({ error: 'no key' }, 401)
      const rest = p.slice(src.length + 1)
      if (rest === '/rozsirena-vyhledavani' && req.method === 'POST') return json(fixture('esbirka-search.json'))
      if (rest === `/dokumenty-sbirky/${encodeURIComponent('/sb/2012/89')}`) return json(fixture('esbirka-act.json'))
      if (rest.startsWith(`/dokumenty-sbirky/${encodeURIComponent('/sb/2012/89/2026-01-01')}/fragmenty`)) return json(fixture('esbirka-fragments.json'))
      return json({ error: 'not found' }, 404)
    }
    // Ansvar: token endpoint + MCP gateway
    if (p === '/ansvar/token') {
      const f = new URLSearchParams(body)
      if (f.get('grant_type') === 'client_credentials' && f.get('client_id') === 'firm-agent' && f.get('client_secret') === 's3cret') return json({ access_token: 'tok-123', expires_in: 300 })
      return json({ error: 'invalid_client' }, 401)
    }
    if (p === '/ansvar/mcp') return ansvar(req, res, body)
    // Ansvar's sign-in server (Keycloak-like): metadata, registration, device code, PKCE, refresh
    const origin = `http://127.0.0.1:${fake.address().port}`
    const issuer = `${origin}/auth/realms/ansvar`
    if (p === '/.well-known/oauth-protected-resource/ansvar/mcp') return json({ resource: `${origin}/ansvar/mcp`, authorization_servers: [issuer], scopes_supported: ['mcp:tools'] })
    if (p === '/auth/realms/ansvar/.well-known/oauth-authorization-server') {
      return json({ issuer, authorization_endpoint: `${origin}/auth/authorize`, token_endpoint: `${origin}/auth/token`, device_authorization_endpoint: `${origin}/auth/device`, registration_endpoint: `${origin}/auth/register`, code_challenge_methods_supported: ['plain', 'S256'] })
    }
    if (p === '/auth/register') {
      auth.registrations++
      if (auth.register !== 'open') return json({ error: 'insufficient_scope', error_description: 'Policy \'Trusted Hosts\' rejected request' }, 403)
      const b = JSON.parse(body)
      auth.lastRegistration = b
      return json({ client_id: `openlex-${auth.registrations}`, client_name: b.client_name, redirect_uris: b.redirect_uris }, 201)
    }
    if (p === '/auth/device') {
      const f = new URLSearchParams(body)
      auth.lastDevice = Object.fromEntries(f)
      if (auth.device !== 'ok') return json({ error: 'unauthorized_client' }, 400)
      return json({ device_code: 'dev-1', user_code: 'WDJB-MJHT', verification_uri: 'https://auth.example/device', verification_uri_complete: 'https://auth.example/device?user_code=WDJB-MJHT', expires_in: 30, interval: 1 })
    }
    if (p === '/auth/authorize') {
      const q = u.searchParams
      const code = `code-${auth.codes.size + 1}`
      auth.codes.set(code, { challenge: q.get('code_challenge'), method: q.get('code_challenge_method'), redirect: q.get('redirect_uri'), client: q.get('client_id') })
      res.writeHead(302, { Location: `${q.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(q.get('state'))}` })
      return res.end()
    }
    if (p === '/auth/token') {
      const f = new URLSearchParams(body)
      const grant = f.get('grant_type')
      const issue = () => { const n = auth.rotate++; validTokens.add(`tok-oauth-${n}`); return json({ access_token: `tok-oauth-${n}`, refresh_token: `ref-${n}`, expires_in: 300, token_type: 'Bearer' }) }
      if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
        auth.polls++
        if (f.get('device_code') !== 'dev-1') return json({ error: 'invalid_grant' }, 400)
        if (!auth.approved) return json({ error: auth.polls === 1 ? 'slow_down' : 'authorization_pending' }, 400)
        return issue()
      }
      if (grant === 'authorization_code') {
        const c = auth.codes.get(f.get('code'))
        const s256 = require('crypto').createHash('sha256').update(String(f.get('code_verifier'))).digest('base64url')
        if (!c || c.method !== 'S256' || c.challenge !== s256 || c.redirect !== f.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400)
        return issue()
      }
      if (grant === 'refresh_token') {
        auth.refreshes++
        auth.lastRefresh = Object.fromEntries(f)
        if (!auth.refreshOk || !/^ref-\d+$/.test(f.get('refresh_token') || '')) return json({ error: 'invalid_grant' }, 400)
        return issue()
      }
    }
    res.writeHead(404); res.end()
  })
})

let ls, policy, tools, perms, explain, harness
const setPolicy = (providers) => policy.setRule(null, providers ? { mode: 'allow-list', providers } : { mode: 'local-only' })
const writeUserMap = (o) => { fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify(o)) }

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, {
    OPENLEX_RIS_API: `${base}/ris`, OPENLEX_RIS_DOCS: `${base}/risdocs`,
    OPENLEX_CELLAR_SPARQL: `${base}/eu/sparql`, OPENLEX_CELLAR_BASE: `${base}/eu/celex`,
    OPENLEX_NEURIS_API: `${base}/neuris`, OPENLEX_SLOVLEX_BASE: `${base}/sk`,
    OPENLEX_ESBIRKA_API: `${base}/czkey`, OPENLEX_ESBIRKA_SPARQL: `${base}/czopen/sparql`, OPENLEX_NO_BROWSER: '1', OPENLEX_RIS_GAP_MS: '0',
    OPENLEX_ANSVAR_URL: `${base}/ansvar/mcp`, OPENLEX_ANSVAR_TOKEN_URL: `${base}/ansvar/token`,
  })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  policy = require('../src/policy')
  tools = require('../src/tools')
  perms = require('../src/permissions')
  explain = require('../src/explain')
  harness = require('../src/harness')
  const secrets = require('../src/secrets')
  // RIS may only be asked 20:00–05:00 Vienna time, at weekends and on holidays: a Saturday.
  require('../src/web/ris')._setClock(() => new Date(SATURDAY))
  ls._setStore({ get: async (name) => (mem.has(name) ? mem.get(name) : secrets.envKey(name)), set: async (name, v) => { if (v == null || v === '') mem.delete(name); else mem.set(name, String(v)) } })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => {
  down = new Set(); ansvarCap = false; mem.clear()
  Object.assign(auth, { register: 'open', device: 'ok', approved: false, polls: 0, registrations: 0, refreshes: 0, refreshOk: true })
  delete process.env.OPENLEX_KEY_SOURCE_ANSVAR; delete process.env.OPENLEX_KEY_SOURCE_ESBIRKA
  require('../src/connectors/ansvar')._reset()
  try { fs.rmSync(path.join(DATA, 'openlex.json')) } catch { /* none */ }
})

test('every connector has the one interface', () => {
  for (const c of ls.CONNECTORS) {
    for (const k of ['id', 'label', 'country', 'kind', 'description', 'licence', 'homepage']) assert.ok(typeof c[k] === 'string' && c[k], `${c.id}.${k}`)
    assert.ok(typeof c.needsKey === 'boolean' && Array.isArray(c.hosts) && c.hosts.length, c.id)
    for (const f of ['search', 'get', 'citation']) assert.strictEqual(typeof c[f], 'function', `${c.id}.${f}`)
  }
  assert.deepStrictEqual(ls.IDS, ['ris', 'eurlex', 'neuris', 'slovlex', 'esbirka', 'ansvar'])
})

test('status: one plain list; local-only keeps sources offline; the gateway asks for a key', async () => {
  setPolicy(null)
  let st = await ls.status()
  assert.match(st.find((s) => s.id === 'ris').status, /^RIS Austria: free, but your client-data rule keeps OpenLex offline$/)
  assert.strictEqual(st.find((s) => s.id === 'ansvar').status, 'Ansvar: sign in or paste your key: how to get it')
  assert.strictEqual(st.find((s) => s.id === 'esbirka').status, 'e-Sbírka Czechia: free, but your client-data rule keeps OpenLex offline')
  assert.deepStrictEqual([st.find((s) => s.id === 'esbirka').optionalKey, st.find((s) => s.id === 'esbirka').guide], [true, 'https://github.com/N9394/openlex/blob/main/docs/SOURCES.md#esbirka'])
  setPolicy(['web'])
  st = await ls.status()
  assert.strictEqual(st.find((s) => s.id === 'ris').status, 'RIS Austria: connected, free')
  assert.strictEqual(st.find((s) => s.id === 'neuris').status, 'German federal law (NeuRIS): connected, free (test phase, licence not yet published)')
  process.env.OPENLEX_KEY_SOURCE_ANSVAR = 'firm-agent:s3cret'
  st = await ls.status()
  assert.match(st.find((s) => s.id === 'ansvar').status, /key saved, but your client-data rule/, 'a gateway needs its own allow-list entry')
  setPolicy(['web', 'source:ansvar'])
  st = await ls.status()
  assert.strictEqual(st.find((s) => s.id === 'ansvar').status, 'Ansvar: connected with your key')
  for (const s of st) assert.ok(!/undefined|null|\[object/.test(s.status), s.status)
})

test('switch a source off and on (user layer); a firm lock wins', async () => {
  setPolicy(['web'])
  ls.setEnabled('slovlex', false)
  assert.deepStrictEqual(harness.layers().user.data.sources.slovlex, { type: 'connector', enabled: false })
  assert.strictEqual((await ls.status()).find((s) => s.id === 'slovlex').status, 'Slov-Lex Slovakia: off')
  const r = await ls.search({ query: '513/1991', jurisdiction: 'SK' })
  assert.deepStrictEqual(r.searched, [], 'a switched-off source is not contacted')
  ls.setEnabled('slovlex', true)
  assert.strictEqual(harness.layers().user.data.sources, undefined, 'switching back on leaves no trace')
  assert.deepStrictEqual(require('../src/sources').validate({ ris: { type: 'connector', enabled: false } }), [])
  assert.strictEqual(require('../src/sources').validate({ nope: { type: 'connector' } }).length, 1)
  assert.strictEqual(require('../src/sources').validate({ ris: { type: 'http', url: 'https://x/?q={query}' } }).length, 1, 'built-in names are reserved')
  // The firm turns one off and locks the section.
  const ws = path.join(DATA, 'workspace')
  fs.mkdirSync(ws, { recursive: true })
  fs.writeFileSync(path.join(ws, 'openlex.json'), JSON.stringify({ lock: ['sources'], sources: { neuris: { type: 'connector', enabled: false } } }))
  try {
    const st = (await ls.status()).find((s) => s.id === 'neuris')
    assert.strictEqual(st.status, 'German federal law (NeuRIS): off (your firm turned it off)')
    assert.ok(st.managedByFirm)
    assert.throws(() => ls.setEnabled('neuris', true), /Your firm manages the law sources/)
  } finally { fs.rmSync(path.join(ws, 'openlex.json')) }
})

test('data policy: local-only contacts nothing; the gateway needs "source:ansvar"; audited without the query', async () => {
  setPolicy(null)
  const before = seen.length
  const r = await policy.withMatter(null, () => ls.search({ query: 'Gewährleistung', jurisdiction: 'AT' }))
  assert.strictEqual(seen.length, before, 'nothing left this computer')
  assert.match(r.skipped[0].reason, /keeps OpenLex offline/)
  process.env.OPENLEX_KEY_SOURCE_ANSVAR = 'firm-agent:s3cret'
  setPolicy(['web'])
  const g = await policy.withMatter(null, () => ls.search({ query: 'responsabilité', jurisdiction: 'FR' }))
  assert.deepStrictEqual(g.searched, [])
  assert.match(g.skipped[0].reason, /does not allow Ansvar/)
  const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8')
  assert.ok(audit.includes('"provider":"source:ansvar"') && audit.includes('"decision":"blocked"'))
  assert.ok(!audit.includes('Gewährleistung') && !audit.includes('responsabilit'), 'never the query')
})

test('RIS Austria: search and one section, with provenance (source, URL, date, licence)', async () => {
  setPolicy(['web'])
  const r = await ls.search({ query: 'Gewährleistung', jurisdiction: 'AT' })
  assert.deepStrictEqual(r.searched, ['ris'])
  const hit = r.results[0]
  assert.strictEqual(hit.source, 'ris')
  assert.strictEqual(hit.citation, 'ABGB § 922 (RIS, NOR40018128)')
  assert.match(hit.url, /^https:\/\/(www\.)?ris\.bka\.gv\.at\/eli\//)
  assert.match(hit.licence, /CC BY 4\.0/)
  assert.match(hit.retrieved, /^\d{4}-\d\d-\d\dT/)
  const doc = await ls.get({ source: 'ris', ref: hit.ref })
  assert.strictEqual(doc.title, 'Allgemeines bürgerliches Gesetzbuch § 922')
  assert.match(doc.text, /^Gewährleistung\n§ 922\.\n\(1\)Wer einem anderen eine Sache gegen Entgelt überlässt/)
  assert.ok(!/Paragraph 922/.test(doc.text), 'screen-reader duplicates dropped')
  await assert.rejects(ls.get({ source: 'ris', ref: '../../etc' }), /document number/)
})

test('EUR-Lex through the same interface: reference search and one article', async () => {
  setPolicy(['web'])
  const r = await ls.search({ query: 'GDPR', sources: ['eurlex'], lang: 'de' })
  assert.strictEqual(r.results[0].ref, '32016R0679')
  assert.strictEqual(r.results[0].citation, 'CELEX 32016R0679 (EUR-Lex)')
  const a = await ls.get({ source: 'eurlex', ref: '32016R0679', article: '17', lang: 'de' })
  assert.match(a.text, /^Artikel 17\nRecht auf Löschung/)
  assert.strictEqual(a.citation, 'Article 17, CELEX 02016R0679-20160504 (EUR-Lex)')
  assert.match(a.licence, /2011\/833\/EU/)
})

test('NeuRIS (Germany): search with text matches, one § of a statute', async () => {
  setPolicy(['web'])
  const r = await ls.search({ query: 'Kaufvertrag', jurisdiction: 'DE' })
  assert.deepStrictEqual(r.searched, ['neuris'])
  const hit = r.results[0]
  assert.strictEqual(hit.ref, 'eli/bund/bgbl-1/1995/s2072/2021-08-10/1/deu')
  assert.match(hit.citation, /^FlErwV § 10 \(NeuRIS, eli\/bund\//)
  assert.match(hit.snippet, /Kaufvertrages/)
  assert.ok(!/<mark>/.test(hit.snippet))
  assert.strictEqual(hit.inForce, true)
  const q = new URL(seen.filter((s) => s.path.startsWith('/neuris/v1/legislation?')).at(-1).path, 'http://x').searchParams
  assert.strictEqual(q.get('searchTerm'), 'Kaufvertrag')
  const doc = await ls.get({ source: 'neuris', ref: hit.ref, article: '§ 10' })
  assert.match(doc.text, /^§ 10 Verkaufsangebot\nKaufbewerber/)
  assert.ok(!/§ 11/.test(doc.text))
  assert.match(doc.citation, /^FlErwV § 10 /)
})

test('Slov-Lex (Slovakia): by number or common name; free text explains itself; one §', async () => {
  setPolicy(['web'])
  let r = await ls.search({ query: 'Obchodný zákonník', jurisdiction: 'SK' })
  assert.strictEqual(r.results[0].title, 'Obchodný zákonník, č. 513/1991 Zb.')
  assert.strictEqual(r.results[0].citation, 'č. 513/1991 Zb. (Slov-Lex)')
  assert.match(r.results[0].snippet, /^version in force from 2026-08-17$/)
  r = await ls.search({ query: 'č. 513/1991 Zb.', sources: ['slovlex'] })
  assert.strictEqual(r.results[0].ref, '1991/513')
  r = await ls.search({ query: 'zmluva o dielo', jurisdiction: 'SK' })
  assert.deepStrictEqual(r.searched, [])
  assert.match(r.skipped[0].reason, /number of the law/)
  r = await ls.search({ query: '1/1990', sources: ['slovlex'] })
  assert.deepStrictEqual([r.results, r.skipped], [[], []], 'an unknown number is simply not found')
  const doc = await ls.get({ source: 'slovlex', ref: '513/1991', article: '2' })
  assert.match(doc.text, /^§ 2\nPodnikanie\n\(1\) Podnikaním sa rozumie/)
  assert.ok(!/§ 3/.test(doc.text.split('\n')[0]))
  assert.strictEqual(doc.citation, '§ 2 zákona č. 513/1991 Zb. (Slov-Lex)')
  assert.ok(!/kontakt|menu/.test(doc.text), 'page furniture left out')
})

test('e-Sbírka (Czechia): the state\'s open data without a key; the registered REST API with the lawyer\'s free key', async () => {
  setPolicy(['web'])
  const before = seen.length
  let r = await ls.search({ query: 'občanský zákoník', jurisdiction: 'CZ' })
  assert.deepStrictEqual(r.searched, ['esbirka'])
  assert.deepStrictEqual(r.results.map((x) => [x.ref, x.citation]), [['/sb/2012/89', '§ 9 odst. 1 zákona č. 89/2012 Sb. (e-Sbírka)'], ['/sb/1999/166', '§ 53c odst. 6 zákona č. 166/1999 Sb. (e-Sbírka)']], 'one hit per act')
  assert.strictEqual(r.results[0].url, 'https://e-sbirka.gov.cz/sb/2012/89/2020-01-01#par_9-odst_1')
  assert.match(r.results[0].snippet, /^in force, version from 2020-01-01 · \(1\) Občanský zákoník upravuje/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  const q = new URLSearchParams(seen.filter((x) => x.path === '/czopen/sparql').at(-1).body).get('query')
  assert.match(q, /bif:contains '"občanský" AND "zákoník"'/)
  assert.match(q, /KONSOL/)
  r = await ls.search({ query: 'č. 89/2012 Sb.', sources: ['esbirka'] })
  assert.deepStrictEqual([r.results[0].title, r.results[0].citation, r.results[0].url, r.results[0].inForce], ['Zákon č. 89/2012 Sb., občanský zákoník', 'č. 89/2012 Sb. (e-Sbírka)', 'https://e-sbirka.gov.cz/sb/2012/89/2020-01-01', true])
  let doc = await ls.get({ source: 'esbirka', ref: '89/2012', article: '§ 2' })
  assert.match(doc.text, /^§ 2\n\(1\) Každé ustanovení soukromého práva lze vykládat jenom ve shodě s Listinou …\n\(2\) Zákonnému/)
  assert.deepStrictEqual([doc.citation, doc.url, doc.title], ['§ 2 zákona č. 89/2012 Sb. (e-Sbírka)', 'https://e-sbirka.gov.cz/sb/2012/89/2020-01-01#par_2', 'Zákon č. 89/2012 Sb., občanský zákoník'])
  await assert.rejects(ls.get({ source: 'esbirka', ref: '89/2012', article: '9999' }), (err) => /§ 9999 was not found/.test(err.plain))
  assert.deepStrictEqual((await ls.search({ query: '1/1999', sources: ['esbirka'] })).results, [], 'an unknown number is simply not found')
  assert.ok(seen.slice(before).every((x) => x.path === '/czopen/sparql'), 'only the official open data, nothing else, no key')
  assert.strictEqual((await ls.status()).find((s) => s.id === 'esbirka').status, 'e-Sbírka Czechia: connected, free')
  // With the key: the registered REST API, key in the header.
  process.env.OPENLEX_KEY_SOURCE_ESBIRKA = 'dia-key'
  const mark = seen.length
  r = await ls.search({ query: 'občanský zákoník', jurisdiction: 'CZ' })
  assert.strictEqual(r.results[0].ref, '/sb/2012/89')
  assert.strictEqual(r.results[0].citation, 'č. 89/2012 Sb. (e-Sbírka)')
  const post = seen.filter((s) => s.path === '/czkey/rozsirena-vyhledavani').at(-1)
  assert.strictEqual(JSON.parse(post.body).fulltextVsechnaSlova, 'občanský zákoník')
  r = await ls.search({ query: '89/2012', sources: ['esbirka'] })
  assert.strictEqual(r.results[0].title, 'Zákon č. 89/2012 Sb., občanský zákoník')
  doc = await ls.get({ source: 'esbirka', ref: '89/2012', article: '2' })
  assert.match(doc.text, /^§ 2\n\(1\) Každé ustanovení soukromého práva/)
  assert.ok(!/§ 3/.test(doc.text))
  assert.strictEqual(doc.citation, '§ 2 zákona č. 89/2012 Sb. (e-Sbírka)')
  assert.strictEqual(doc.notice, 'Check the official version before relying on it.')
  assert.ok(seen.slice(mark).every((x) => x.path.startsWith('/czkey/') && x.headers['esel-api-access-key'] === 'dia-key'))
  assert.strictEqual((await ls.status()).find((s) => s.id === 'esbirka').status, 'e-Sbírka Czechia: connected, free (with your key)')
  // A wrong key: one plain sentence (no quiet fallback).
  process.env.OPENLEX_KEY_SOURCE_ESBIRKA = 'wrong'
  r = await ls.search({ query: '89/2012', sources: ['esbirka'] })
  assert.match(r.skipped[0].reason, /did not accept the key/)
})

test('RIS terms: live only 20:00–05:00 Vienna time, at weekends and on Austrian holidays', () => {
  const { liveAllowed, holidays } = require('../src/web/ris')
  const at = (s) => liveAllowed(new Date(s))
  // Thursday 29 October 2026 (Vienna = UTC+1 in winter time)
  assert.strictEqual(at('2026-10-29T09:00:00Z'), false, '10:00 on a working day')
  assert.strictEqual(at('2026-10-29T18:59:00Z'), false, '19:59')
  assert.strictEqual(at('2026-10-29T19:00:00Z'), true, '20:00')
  assert.strictEqual(at('2026-10-29T03:59:00Z'), true, '04:59')
  assert.strictEqual(at('2026-10-29T04:00:00Z'), false, '05:00')
  assert.strictEqual(at('2026-07-01T17:59:00Z'), false, '19:59 summer time (UTC+2)')
  assert.strictEqual(at('2026-07-01T18:00:00Z'), true, '20:00 summer time')
  assert.strictEqual(at('2026-10-31T11:00:00Z'), true, 'Saturday noon')
  assert.strictEqual(at('2026-11-01T11:00:00Z'), true, 'Sunday noon')
  assert.strictEqual(at('2026-10-26T11:00:00Z'), true, 'Nationalfeiertag')
  for (const d of ['2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04', '2027-03-29', '2026-12-08']) assert.ok(holidays(+d.slice(0, 4)).has(d), d)
  assert.ok(!holidays(2026).has('2026-04-03') && !holidays(2026).has('2026-12-24'), 'Good Friday and Christmas Eve are not public holidays')
})

test('RIS terms: one request at a time, two seconds apart (here: shortened)', async () => {
  setPolicy(['web'])
  process.env.OPENLEX_RIS_GAP_MS = '120'
  try {
    const mark = seen.length
    const ris = require('../src/web/ris')
    await Promise.all([ris.searchBundesrecht('Kauf'), ris.searchBundesrecht('Miete'), ris.searchBundesrecht('Pacht')])
    const t = seen.slice(mark).filter((x) => x.path.startsWith('/ris/')).map((x) => x.t)
    assert.strictEqual(t.length, 3)
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 110, `gap ${t[i] - t[i - 1]} ms`)
  } finally { process.env.OPENLEX_RIS_GAP_MS = '0' }
})

test('RIS outside the allowed hours: the local copy with its date, else a plain sentence; the night copy is opt-in', async () => {
  setPolicy(['web'])
  const ris = require('../src/web/ris')
  // Saturday: live, and kept as the local copy.
  let r = await ls.search({ query: 'Gewährleistung', jurisdiction: 'AT' })
  assert.ok(r.results.length && !r.notes)
  const ref = r.results[0].ref
  await ls.get({ source: 'ris', ref })
  // Thursday 10:00 Vienna: nothing goes to RIS.
  ris._setClock(() => new Date('2026-11-05T09:00:00Z'))
  try {
    const mark = seen.length
    r = await ls.search({ query: 'Gewährleistung', jurisdiction: 'AT' })
    assert.ok(r.results.length)
    assert.deepStrictEqual(r.notes, [{ source: 'ris', note: 'RIS only allows live lookups 20:00–05:00 and on weekends; using your local copy from 2026-10-31' }])
    const doc = await ls.get({ source: 'ris', ref })
    assert.strictEqual(doc.note, 'RIS only allows live lookups 20:00–05:00 and on weekends; using your local copy from 2026-10-31')
    const out = await tools.dispatch({}, 'search_law_sources', { query: 'Gewährleistung', jurisdiction: 'AT' })
    assert.match(out.output, /\nNote \(ris\): RIS only allows live lookups 20:00–05:00 and on weekends; using your local copy from 2026-10-31\n/)
    const g = await tools.dispatch({}, 'get_law_source', { source: 'ris', ref })
    assert.match(g.output, /\nNote: RIS only allows live lookups/)
    r = await ls.search({ query: 'Mietzins', jurisdiction: 'AT' })
    assert.deepStrictEqual(r.results, [])
    assert.strictEqual(r.skipped[0].reason, 'RIS only allows live lookups 20:00–05:00 and on weekends (Vienna time; also on Austrian public holidays), and there is no local copy of this yet. Turn on "Keep a local copy" for RIS Austria in /law to have it fetched tonight')
    const old = await tools.dispatch({}, 'search_ris', { query: 'Mietzins' })
    assert.match(old.output, /^RIS: not looked up\. RIS only allows live lookups/)
    assert.ok(!seen.slice(mark).some((x) => /^\/ris(docs)?\//.test(x.path)), 'nothing was sent to RIS during office hours')
    const st = (await ls.status()).find((s) => s.id === 'ris')
    assert.strictEqual(st.status, 'RIS Austria: connected, free (live look-ups only 20:00–05:00 and at weekends; your local copy now)')
    assert.strictEqual(st.nightCopy, false)
    // Opt in: what was asked during the day is fetched in the evening.
    ls.setNightCopy('ris', true)
    assert.strictEqual((await ls.status()).find((s) => s.id === 'ris').nightCopy, true)
    r = await ls.search({ query: 'Mietzins', jurisdiction: 'AT' })
    assert.match(r.skipped[0].reason, /no local copy of this yet; OpenLex fetches it tonight$/)
    assert.deepStrictEqual(ris.queue().map((x) => x.query), ['Mietzins'])
    assert.deepStrictEqual(await ris.nightly(), { fetched: 0 }, 'not during office hours')
    ris._setClock(() => new Date('2026-11-05T20:30:00Z')) // 21:30 Vienna
    const n = await ris.nightly()
    assert.strictEqual(n.fetched, 1)
    assert.deepStrictEqual(ris.queue(), [])
    ris._setClock(() => new Date('2026-11-06T09:00:00Z'))
    r = await ls.search({ query: 'Mietzins', jurisdiction: 'AT' })
    assert.ok(r.results.length)
    assert.match(r.notes[0].note, /using your local copy from 2026-11-05$/)
    ls.setNightCopy('ris', false)
  } finally { ris._setClock(() => new Date(SATURDAY)) }
})

test('Ansvar: paste-a-key gateway over MCP — service credential → token, search, full text, plain errors', async () => {
  setPolicy(['web', 'source:ansvar'])
  let r = await ls.search({ query: 'responsabilité délictuelle', sources: ['ansvar'] })
  assert.match(r.skipped[0].reason, /^Ansvar sign in or paste your key \(how to get it: .*#ansvar\)$/)
  process.env.OPENLEX_KEY_SOURCE_ANSVAR = 'firm-agent:s3cret'
  r = await ls.search({ query: 'responsabilité délictuelle', jurisdiction: 'FR' })
  assert.deepStrictEqual(r.searched, ['ansvar'], 'no official source for FR: the gateway is asked')
  const hit = r.results[0]
  assert.deepStrictEqual([hit.source, hit.ref, hit.citation, hit.jurisdiction], ['ansvar', 'fr-cc-1240', 'Art. 1240 C. civ.', 'FR'])
  assert.match(hit.snippet, /responsabilité délictuelle \/ FR/)
  assert.match(hit.licence, /no sharing or reselling/)
  const tok = seen.find((s) => s.path === '/ansvar/token')
  assert.match(tok.body, /grant_type=client_credentials/)
  const calls = seen.filter((s) => s.path === '/ansvar/mcp')
  assert.ok(calls.every((s) => s.headers.authorization === 'Bearer tok-123'))
  assert.ok(!calls.some((s) => /s3cret/.test(JSON.stringify(s))), 'the secret only goes to the token endpoint')
  const doc = await ls.get({ source: 'ansvar', ref: 'fr-cc-1240' })
  assert.match(doc.text, /oblige celui par la faute .* \[fr-cc-1240\]$/)
  assert.strictEqual(doc.citation, 'Art. 1240 C. civ.')
  // An official source is enough for AT: the gateway's quota is not used.
  r = await ls.search({ query: 'Gewährleistung', jurisdiction: 'AT' })
  assert.deepStrictEqual(r.searched, ['ris'])
  // Daily cap and a wrong key: one plain sentence each.
  ansvarCap = true
  r = await ls.search({ query: 'x', sources: ['ansvar'] })
  assert.match(r.skipped[0].reason, /used up for today/)
  ansvarCap = false
  process.env.OPENLEX_KEY_SOURCE_ANSVAR = 'firm-agent:wrong'
  require('../src/connectors/ansvar')._reset()
  r = await ls.search({ query: 'x', sources: ['ansvar'] })
  assert.match(r.skipped[0].reason, /did not accept the key/)
  // A pasted access token works as is.
  process.env.OPENLEX_KEY_SOURCE_ANSVAR = 'Bearer tok-123'
  r = await ls.search({ query: 'x', sources: ['ansvar'] })
  assert.strictEqual(r.results.length, 1)
})

test('key formats for Ansvar', () => {
  const { parseKey } = require('../src/connectors/ansvar')
  assert.deepStrictEqual(parseKey('id:sec'), { clientId: 'id', clientSecret: 'sec' })
  assert.deepStrictEqual(parseKey('{"client_id":"a","client_secret":"b"}'), { clientId: 'a', clientSecret: 'b' })
  assert.deepStrictEqual(parseKey('eyJhbGciOi.eyJzdWIi.sig'), { bearer: 'eyJhbGciOi.eyJzdWIi.sig' })
  assert.throws(() => parseKey('  '), /needs your key/)
})

const waitFor = async (fn, what) => {
  for (let i = 0; i < 300; i++) { const v = await fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 10)) }
  throw new Error(`timed out waiting for ${what}`)
}

test('Ansvar browser sign-in: discovery, registration, device code, tokens in the keychain, search', async () => {
  setPolicy(['web', 'source:ansvar'])
  const st0 = (await ls.status()).find((s) => s.id === 'ansvar')
  assert.strictEqual(st0.signIn, true)
  let s = await ls.signIn('ansvar', { open: false, pollMs: 15 })
  assert.deepStrictEqual([s.state, s.flow, s.userCode, s.url, s.pageUrl], ['pending', 'device', 'WDJB-MJHT', 'https://auth.example/device?user_code=WDJB-MJHT', 'https://auth.example/device'])
  assert.strictEqual(auth.registrations, 1)
  assert.deepStrictEqual([auth.lastRegistration.token_endpoint_auth_method, auth.lastRegistration.grant_types.includes('urn:ietf:params:oauth:grant-type:device_code')], ['none', true], 'a public client, no secret')
  assert.match(auth.lastDevice.scope, /mcp:tools/)
  assert.match(auth.lastDevice.resource, /\/ansvar\/mcp$/, 'resource indicator sent')
  assert.ok(JSON.parse(mem.get('source-ansvar-client')).client_id, 'the registration is kept for next time')
  await waitFor(() => auth.polls >= 2, 'polling')
  assert.strictEqual(ls.signInStatus('ansvar').state, 'pending')
  auth.approved = true
  await waitFor(() => ls.signInStatus('ansvar').state === 'done', 'sign-in')
  const cred = JSON.parse(mem.get('source-ansvar'))
  assert.strictEqual(cred.type, 'oauth')
  assert.ok(cred.access_token.startsWith('tok-oauth-') && cred.refresh_token.startsWith('ref-'))
  assert.strictEqual((await ls.status()).find((x) => x.id === 'ansvar').status, 'Ansvar: connected, signed in')
  let r = await ls.search({ query: 'responsabilité', jurisdiction: 'FR' })
  assert.strictEqual(r.results[0].ref, 'fr-cc-1240')
  assert.strictEqual(seen.filter((x) => x.path === '/ansvar/mcp').at(-1).headers.authorization, `Bearer ${cred.access_token}`)
  // The token runs out: renewed with the refresh token, and the new one is kept.
  mem.set('source-ansvar', JSON.stringify({ ...cred, expires_at: Date.now() - 1000 }))
  require('../src/connectors/ansvar')._reset()
  r = await ls.search({ query: 'responsabilité', jurisdiction: 'FR' })
  assert.strictEqual(r.results.length, 1)
  assert.strictEqual(auth.refreshes, 1)
  assert.deepStrictEqual([auth.lastRefresh.refresh_token, auth.lastRefresh.client_id], [cred.refresh_token, cred.client_id])
  const renewed = JSON.parse(mem.get('source-ansvar'))
  assert.notStrictEqual(renewed.access_token, cred.access_token)
  assert.notStrictEqual(renewed.refresh_token, cred.refresh_token, 'a rotated refresh token is saved')
  // The gateway refuses a token before its time: renewed once.
  validTokens.delete(renewed.access_token)
  require('../src/connectors/ansvar')._reset()
  r = await ls.search({ query: 'x', sources: ['ansvar'] })
  assert.strictEqual(r.results.length, 1)
  assert.strictEqual(auth.refreshes, 2)
  // The refresh token is no longer good: one plain sentence.
  auth.refreshOk = false
  mem.set('source-ansvar', JSON.stringify({ ...JSON.parse(mem.get('source-ansvar')), expires_at: 0 }))
  require('../src/connectors/ansvar')._reset()
  r = await ls.search({ query: 'x', sources: ['ansvar'] })
  assert.strictEqual(r.skipped[0].reason, 'Your Ansvar sign-in has run out: sign in again under Law sources (/law)')
  // Signing in again reuses OpenLex's registration.
  s = await ls.signIn('ansvar', { open: false, pollMs: 15 })
  assert.strictEqual(auth.registrations, 1)
  assert.strictEqual(ls.cancelSignIn('ansvar').state, 'pending')
  await waitFor(() => ls.signInStatus('ansvar').state === 'cancelled', 'cancel')
})

test('Ansvar browser sign-in: no device codes → browser redirect with PKCE; registration closed → "not available yet"', async () => {
  auth.device = 'refused'
  const s = await ls.signIn('ansvar', { open: false })
  assert.strictEqual(s.flow, 'browser')
  const u = new URL(s.url)
  assert.deepStrictEqual([u.pathname, u.searchParams.get('code_challenge_method'), u.searchParams.get('response_type')], ['/auth/authorize', 'S256', 'code'])
  assert.match(u.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.ok(!u.searchParams.has('code_verifier'))
  // A forged callback (wrong state) is ignored.
  const back = new URL(u.searchParams.get('redirect_uri'))
  await (await fetch(`${back.href}?code=code-x&state=forged`)).text()
  assert.strictEqual(ls.signInStatus('ansvar').state, 'pending')
  // The browser: Ansvar's page redirects back to this computer.
  const page = await fetch(s.url)
  assert.match(await page.text(), /Signed in/)
  await waitFor(() => ls.signInStatus('ansvar').state === 'done', 'sign-in')
  assert.strictEqual(JSON.parse(mem.get('source-ansvar')).type, 'oauth')
  // Registration closed: plain words, the service credential still works.
  mem.clear()
  require('../src/connectors/ansvar')._reset()
  auth.register = 'closed'
  await assert.rejects(ls.signIn('ansvar', { open: false }), (err) => err.plain === 'Ansvar\'s browser sign-in is not available for OpenLex yet. Use a service credential (paste your key) for now.')
})

test('sign-in addresses must be https (http only on this computer)', () => {
  const { safeUrl } = require('../src/connectors/oauth')
  assert.strictEqual(safeUrl('https://auth.ansvar.eu/x', 'A'), 'https://auth.ansvar.eu/x')
  assert.strictEqual(safeUrl('http://127.0.0.1:5/x', 'A'), 'http://127.0.0.1:5/x')
  assert.throws(() => safeUrl('http://auth.ansvar.eu/x', 'A'), /not secure/)
  assert.throws(() => safeUrl('javascript:alert(1)', 'A'), /not secure/)
})

test('offline or a source down: a plain sentence, the others still answer, no crash', async () => {
  setPolicy(['web'])
  down = new Set(['ris'])
  const r = await ls.search({ query: 'Gewährleistung', sources: ['ris', 'neuris'] })
  assert.deepStrictEqual(r.searched, ['ris', 'neuris'])
  assert.ok(r.results.length && r.results.every((x) => x.source === 'neuris'))
  assert.strictEqual(r.skipped[0].reason, 'RIS Austria is not answering right now; try again later')
  down = new Set(['neuris'])
  await assert.rejects(ls.get({ source: 'neuris', ref: 'eli/bund/bgbl-1/1995/s2072/2021-08-10/1/deu' }), (err) => err.plain === 'German federal law (NeuRIS) is not answering right now; try again later')
  // No network at all: a closed port.
  const saved = process.env.OPENLEX_NEURIS_API
  process.env.OPENLEX_NEURIS_API = 'http://127.0.0.1:9'
  try {
    const x = await ls.search({ query: 'Kaufvertrag', jurisdiction: 'DE' })
    assert.match(x.skipped[0].reason, /could not be reached \(no internet connection, or the service is down\)/)
  } finally { process.env.OPENLEX_NEURIS_API = saved }
})

test('agent tools: search_law_sources and get_law_source cite with provenance; permissions ask only for a gateway', async () => {
  setPolicy(['web'])
  const out = await tools.dispatch({}, 'search_law_sources', { query: 'Kaufvertrag', jurisdiction: 'DE' })
  assert.match(out.output, /^LAW SOURCES \(neuris\):\n\[1\] German federal law \(NeuRIS\) · ref eli\/bund\//)
  assert.match(out.output, /Cite as: FlErwV § 10 \(NeuRIS/)
  assert.match(out.output, /retrieved \d{4}-\d\d-\d\d; Statutes are official works/)
  assert.match(out.output, /\nCheck the official version before relying on it\.$/)
  assert.strictEqual(out.webSources[0].source, 'neuris')
  const g = await tools.dispatch({}, 'get_law_source', { source: 'slovlex', ref: '513/1991', article: '2' })
  assert.match(g.output, /^Slov-Lex Slovakia: Obchodný zákonník, č\. 513\/1991 Zb\. \(version from 2026-08-17\)\nCite as: § 2 zákona č\. 513\/1991 Zb\. \(Slov-Lex\)\nSource: .*\nCheck the official version before relying on it\.\n/)
  const bad = await tools.dispatch({}, 'get_law_source', { source: 'nowhere', ref: 'x' })
  assert.match(bad.output, /^LAW SOURCE ERROR: There is no law source called "nowhere"/)
  // Official sources: allowed like RIS; a paid gateway: asked first; deny wins.
  assert.strictEqual(perms.evaluate('search_law_sources', { query: 'x', jurisdiction: 'AT' }).decision, 'allow')
  assert.strictEqual(perms.evaluate('search_law_sources', { query: 'x', sources: ['ansvar'] }).decision, 'ask')
  assert.strictEqual(perms.evaluate('get_law_source', { source: 'ansvar', ref: 'x' }).decision, 'ask')
  assert.match(perms.summarize('search_law_sources', { query: 'Haftung', sources: ['ansvar'] }), /^Look up "Haftung" in Ansvar$/)
  writeUserMap({ permissions: { deny: ['search_law_sources:neuris'] } })
  assert.strictEqual(perms.evaluate('search_law_sources', { query: 'x', jurisdiction: 'DE' }).decision, 'deny')
  assert.strictEqual(perms.evaluate('search_law_sources', { query: 'x', jurisdiction: 'AT' }).decision, 'allow')
})

test('transparency: the step says which source is contacted online, in plain words', () => {
  const detail = require('../src/activity').toolDetail('search_law_sources', { query: 'Kaufvertrag', jurisdiction: 'DE' })
  const ev = explain.annotate({ kind: 'tool', tool: 'search_law_sources', detail })
  assert.strictEqual(ev.plain, 'Looking up the law in NeuRIS (Germany\'s federal law portal): “Kaufvertrag”')
  assert.deepStrictEqual([ev.online, ev.onlineTo], [true, 'NeuRIS (Germany\'s federal law portal)'])
  const g = explain.annotate({ kind: 'tool', tool: 'get_law_source', detail: require('../src/activity').toolDetail('get_law_source', { source: 'ansvar', ref: 'x' }) })
  assert.strictEqual(g.onlineTo, 'Ansvar (a law-research service you subscribe to)')
  const f = explain.annotate({ kind: 'tool_failed', tool: 'search_law_sources', detail: { sources: ['esbirka'] }, offline: true })
  assert.strictEqual(f.plain, 'Couldn\'t reach e-Sbírka (Czechia\'s Collection of Laws) (no connection); the answer goes on without it.')
  for (const e of [ev, g, f]) assert.ok(!/search_law|get_law|connector|mcp/i.test(e.plain), e.plain)
})

test('AI record: a law-source lookup shows under the source\'s name, once; a blocked one as blocked', async () => {
  setPolicy(['web'])
  await ls.search({ query: 'Kaufvertrag', jurisdiction: 'DE' })
  setPolicy(null)
  await ls.search({ query: 'Kaufvertrag', jurisdiction: 'DE' })
  const entries = require('../src/record').build(null)
  const looked = entries.flatMap((e) => e.lookups || []).filter((l) => /NeuRIS/.test(l.name))
  assert.ok(looked.length >= 1 && looked.every((l) => l.name === 'NeuRIS (Germany\'s federal law portal)'))
  assert.ok(entries.flatMap((e) => e.blocked || []).some((b) => /NeuRIS/.test(b.what)))
  assert.ok(!entries.some((e) => /firm's database “(ris|neuris|eurlex|slovlex|esbirka|ansvar)”/.test(JSON.stringify(e))), 'never shown as a firm database')
  assert.ok(!entries.some((e) => /Kaufvertrag/.test(JSON.stringify(e))), 'no search words in the record')
})

test('terminal /law: the engine\'s words, one list; Enter offers only what applies', async () => {
  setPolicy(['web'])
  const ui = await import('../tui/sources.mjs')
  const st = await ls.status()
  const items = ui.sourceItems(st)
  assert.deepStrictEqual(items.map((i) => i.label.replace(/^\S+ /, '')), st.map((s) => s.status))
  assert.ok(items.find((i) => i.value === 'ansvar').label.endsWith('Ansvar: sign in or paste your key: how to get it'))
  assert.strictEqual(items.find((i) => i.value === 'ansvar').hint, 'How to get it: https://github.com/N9394/openlex/blob/main/docs/SOURCES.md#ansvar')
  const ansvar = ui.sourceChoices(st.find((s) => s.id === 'ansvar')).map((c) => c.label)
  assert.deepStrictEqual(ansvar, ['Sign in with your browser', 'Paste a service credential', 'How to get it', 'Switch it off', 'Back to the list'])
  const cz = ui.sourceChoices(st.find((s) => s.id === 'esbirka'))
  assert.deepStrictEqual(cz.map((c) => c.label), ['Add your free key (optional)', 'How to get it', 'Switch it off', 'Back to the list'])
  assert.strictEqual(cz[1].hint, 'https://github.com/N9394/openlex/blob/main/docs/SOURCES.md#esbirka')
  const ris = ui.sourceChoices(st.find((s) => s.id === 'ris')).map((c) => c.label)
  assert.deepStrictEqual(ris, ['Keep a local copy (fetched at night)', 'Switch it off', 'Back to the list'])
  assert.deepStrictEqual(ui.sourceChoices({ ...st[0], managedByFirm: true }).map((c) => c.value), ['copy', 'back'], 'the local copy is the lawyer\'s own; switching is the firm\'s')
  assert.deepStrictEqual(ui.withWeb({ mode: 'local-only' }), { mode: 'allow-list', providers: ['web'] })
  assert.deepStrictEqual(ui.withWeb({ mode: 'allow-list', providers: ['anthropic'], redact: true }), { mode: 'allow-list', providers: ['anthropic', 'web'], redact: true })
})

test('terminal /law screen renders the engine\'s list in plain words', async () => {
  setPolicy(null)
  const ink = await import('ink-testing-library')
  const React = await import('react')
  const { LawSources } = await import('../tui/sources.mjs')
  const list = await ls.status()
  const api = { lawSources: async () => ({ sources: list }) }
  const r = ink.render(React.createElement(LawSources, { api }))
  try {
    let f = ''
    for (let i = 0; i < 500 && !/Ansvar: sign in or paste your key/.test(f); i++) { await new Promise((ok) => setTimeout(ok, 20)); f = (r.lastFrame() || '').replace(/\s+/g, ' ') }
    assert.match(f, /Where OpenLex looks up the law/)
    assert.match(f, /RIS Austria: free, but your client-data rule keeps OpenLex offline/)
    assert.match(f, /Ansvar: sign in or paste your key: how to get it/)
    assert.match(f, /e-Sbírka Czechia: free, but your client-data rule keeps OpenLex offline/)
    assert.match(f, /Allow online look-ups \(only search words leave this computer\)/)
    assert.match(f, /Only your search words are sent, never your documents/)
  } finally { r.unmount() }
})

// ── optional live checks (free official sources only; never a paid one) ──
const live = (name, fn) => test(`live: ${name}`, { skip: !NET }, async (t) => {
  for (const k of Object.keys(process.env)) if (/^OPENLEX_(RIS|CELLAR|NEURIS|SLOVLEX|ESBIRKA)_/.test(k)) delete process.env[k]
  setPolicy(['web'])
  await fn(t)
})
live('RIS Austria (only in the hours the RIS terms allow)', async (t) => {
  const ris = require('../src/web/ris')
  ris._setClock(null)
  try {
    if (!ris.liveAllowed()) return t.skip('RIS only allows live lookups 20:00–05:00 Vienna time, at weekends and on holidays')
    const r = await require('../src/connectors/ris').search('Gewährleistung', { limit: 3 })
    assert.ok(r.length && r[0].ref.startsWith('NOR'))
  } finally { ris._setClock(() => new Date(SATURDAY)) }
})
live('EUR-Lex', async () => {
  const r = await require('../src/connectors/eurlex').search('GDPR')
  assert.strictEqual(r[0].ref, '32016R0679')
})
live('NeuRIS', async () => {
  const r = await require('../src/connectors/neuris').search('Kaufvertrag', { limit: 2 })
  assert.ok(r.length && r[0].ref.startsWith('eli/bund/'))
})
live('Slov-Lex', async () => {
  const r = await require('../src/connectors/slovlex').search('513/1991')
  assert.strictEqual(r[0].ref, '1991/513')
})
live('e-Sbírka (open data, no key)', async () => {
  const r = await require('../src/connectors/esbirka').search('89/2012')
  assert.strictEqual(r[0].ref, '/sb/2012/89')
})
test('live: e-Sbírka REST (with OPENLEX_KEY_SOURCE_ESBIRKA)', { skip: !NET || !process.env.OPENLEX_KEY_SOURCE_ESBIRKA }, async () => {
  for (const k of Object.keys(process.env)) if (/^OPENLEX_ESBIRKA_/.test(k)) delete process.env[k]
  const r = await require('../src/connectors/esbirka').search('89/2012', {}, { key: process.env.OPENLEX_KEY_SOURCE_ESBIRKA })
  assert.strictEqual(r[0].ref, '/sb/2012/89')
})
