"use strict"
/**
 * Legalize (legalize-dev) and the shared parts behind it: the hosted API
 * with the lawyer's key (a local fake), a local copy from a tiny fake git
 * repository (clone, full-text index, the text on a past date, git pull),
 * the size before any download, the "Work fully offline" switch, the
 * countries without an open source (HU, CY, ZA), the German words in /law
 * and the agent tools that set sources up. No live calls, no real keys.
 *
 *   node --test test/law_legalize.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/law_legalize.test.js   # + GitHub freshness and a real shallow clone of a small repo
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync } = require('child_process')

const NET = process.env.OPENLEX_TEST_NETWORK === '1'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-legalize-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_PACE_SCALE = '0'
const GITROOT = path.join(DATA, 'remote')
const hasGit = (() => { try { execFileSync('git', ['--version']); return true } catch { return false } })()

const seen = []
const KEY = 'leg_testkey_1234567890'
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  seen.push({ path: req.url, headers: req.headers })
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (u.pathname === '/gh/orgs/legalize-dev/repos') return json([{ name: 'legalize-at', pushed_at: '2026-10-29T17:01:45Z', size: 394167 }, { name: 'legalize-ch', pushed_at: '2026-06-23T18:32:04Z', size: 185263 }, { name: 'legalize-pipeline', pushed_at: '2026-10-23T13:42:03Z', size: 1 }])
  if (u.pathname.startsWith('/gh/repos/legalize-dev/legalize-')) return json({ size: 1000, pushed_at: '2026-10-29T17:01:45Z' })
  if (u.pathname.startsWith('/api/')) {
    if (req.headers.authorization !== `Bearer ${KEY}`) return json({ error: 'invalid_api_key' }, 401)
    if (u.pathname === '/api/v1/at/laws') return json({ country: 'at', total: 1, page: 1, per_page: 5, results: [{ id: 'AT-10001622', title: 'Allgemeines bürgerliches Gesetzbuch', short_title: 'ABGB', country: 'at', law_type: 'bundesgesetz', status: 'in_force', text_state: 'current', last_updated: '2026-10-01', title_snippet: '<b>ABGB</b>' }] })
    if (u.pathname === '/api/v1/ch/laws') return json({ country: 'ch', total: 1, page: 1, per_page: 5, results: [{ id: 'CH-210', title: 'Schweizerisches Zivilgesetzbuch', short_title: 'ZGB', status: 'in_force', text_state: 'current' }] })
    if (u.pathname === '/api/v1/at/laws/AT-10001622') return json({ id: 'AT-10001622', title: 'Allgemeines bürgerliches Gesetzbuch', short_title: 'ABGB', source: 'https://ris.bka.gv.at/eli/jgs/1811/946/P922/NOR40018128', content_md: '# ABGB\n\n§ 921.\n\nRücktritt.\n\n§ 922.\n\n(1) Wer einem anderen eine Sache gegen Entgelt überlässt, leistet Gewähr.\n\n§ 923.\n\nAndere Fälle.' })
    if (u.pathname === '/api/v1/at/laws/AT-10001622/at') return json({ law_id: 'AT-10001622', date: u.searchParams.get('date'), sha: '3b9aea8d5abc', version_date: '2019-12-31', citation: 'x', citation_url: 'https://legalize.dev/at/AT-10001622', content_md: '§ 922.\n\n(1) Alte Fassung.', source_url: 'https://ris.bka.gv.at/x' })
    if (u.pathname === '/api/v1/at/laws/AT-404') return json({ detail: 'not found' }, 404)
  }
  res.writeHead(404); res.end()
})

/** A tiny legalize-like repo with two dated versions of one law. */
function makeRepo(cc) {
  const dir = path.join(GITROOT, `legalize-${cc}`)
  fs.mkdirSync(path.join(dir, cc), { recursive: true })
  const g = (args, env = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.org', ...env } })
  g(['init', '-q', '-b', 'main'])
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'LEGALIZE — Österreich\n\nLEGISLATIVE CONTENT (DATA)\nCC BY 4.0 (Creative Commons Namensnennung 4.0 International)\n')
  fs.writeFileSync(path.join(dir, 'README.md'), '# legalize-at\n\n## Quellenangabe\n\n> Quelle: RIS – Rechtsinformationssystem des Bundes, Bundeskanzleramt der Republik Österreich (https://www.ris.bka.gv.at/). Lizenziert unter CC BY 4.0.\n')
  const law = (text, upd) => `---\ntitle: "Allgemeines bürgerliches Gesetzbuch"\nidentifier: "AT-10001622"\nshort_title: "ABGB"\nstatus: "in_force"\nlast_updated: "${upd}"\nsource: "https://ris.bka.gv.at/eli/jgs/1811/946"\n---\n# Allgemeines bürgerliches Gesetzbuch\n\n§ 921.\n\nRücktritt vom Vertrag.\n\n§ 922.\n\n${text}\n\n§ 923.\n\nAndere Fälle.\n`
  fs.writeFileSync(path.join(dir, cc, 'AT-10001622.md'), law('(1) Wer einem anderen eine Sache gegen Entgelt überlässt, leistet Gewähr (alte Fassung).', '2001-01-01'))
  fs.writeFileSync(path.join(dir, cc, 'AT-10002333.md'), '---\ntitle: "Konsumentenschutzgesetz"\nshort_title: "KSchG"\nstatus: "in_force"\n---\n# KSchG\n\n§ 1.\n\nVerbrauchergeschäfte und Rücktrittsrecht.\n')
  g(['add', '.']); g(['commit', '-q', '-m', 'first'], { GIT_AUTHOR_DATE: '2001-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2001-01-01T12:00:00Z' })
  fs.writeFileSync(path.join(dir, cc, 'AT-10001622.md'), law('(1) Wer einem anderen eine Sache gegen Entgelt überlässt, leistet Gewähr, dass sie dem Vertrag entspricht.', '2022-01-01'))
  g(['commit', '-q', '-am', 'GewRÄG'], { GIT_AUTHOR_DATE: '2022-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2022-01-01T12:00:00Z' })
  return { dir, g }
}

let ls, policy, tools, perms
const mem = new Map()
const setPolicy = (providers) => policy.setRule(null, providers ? { mode: 'allow-list', providers } : { mode: 'local-only' })
const wait = async (fn, what) => { for (let i = 0; i < 500; i++) { const v = await fn(); if (v) return v; await new Promise((ok) => setTimeout(ok, 10)) } throw new Error(`timed out: ${what}`) }

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.address().port}`
  Object.assign(process.env, { OPENLEX_LEGALIZE_API: base, OPENLEX_LEGALIZE_GITHUB: `${base}/gh`, OPENLEX_LEGALIZE_GIT: GITROOT })
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  ls = require('../src/connectors')
  policy = require('../src/policy')
  tools = require('../src/tools')
  perms = require('../src/permissions')
  ls._setStore({ get: async (n) => (mem.has(n) ? mem.get(n) : null), set: async (n, v) => { if (v == null || v === '') mem.delete(n); else mem.set(n, String(v)) } })
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })
test.beforeEach(() => { mem.clear(); setPolicy(['web']) })

test('online by default: without a key or a copy, Legalize waits quietly and says what to do', async () => {
  const st = (await ls.status()).find((s) => s.id === 'legalize')
  assert.strictEqual(st.state, 'needs_setup')
  assert.strictEqual(st.status, 'Legalize (laws of many countries): free: paste your free key, or keep countries on this computer for offline work (community source)')
  assert.match(st.statusDe, /^Legalize \(Gesetze vieler Länder\): kostenlos: Ihren kostenlosen Schlüssel einfügen/)
  const r = await ls.search({ query: 'Gewährleistung', jurisdiction: 'AT' })
  assert.ok(!r.searched.includes('legalize'), 'not asked, and no noise')
  const named = await ls.search({ query: 'Gewährleistung', sources: ['legalize'] })
  assert.match(named.skipped[0].reason, /paste your free key/)
  await assert.rejects(ls.setKey('legalize', 'x y'), /does not look like a Legalize key/)
})

test('hosted API with the lawyer\'s key: search, a section, the text on a past date, plain errors', async () => {
  await ls.setKey('legalize', KEY)
  assert.strictEqual(mem.get('source-legalize'), KEY, 'in the keychain')
  const r = await ls.search({ query: 'ABGB', sources: ['legalize'], jurisdiction: 'AT' })
  const hit = r.results[0]
  assert.deepStrictEqual([hit.ref, hit.citation, hit.source, hit.jurisdiction], ['at:AT-10001622', 'ABGB (Legalize AT-10001622)', 'legalize', 'AT'])
  assert.match(hit.licence, /official source's terms/)
  assert.strictEqual(r.notice, 'Check the official version before relying on it.')
  assert.strictEqual(seen.filter((s) => s.path.startsWith('/api/')).at(-1).headers.authorization, `Bearer ${KEY}`)
  const doc = await ls.get({ source: 'legalize', ref: 'at:AT-10001622', article: '§ 922' })
  assert.match(doc.text, /^§ 922\.\n\n\(1\) Wer einem anderen/)
  assert.ok(!/§ 923/.test(doc.text))
  assert.strictEqual(doc.citation, 'ABGB § 922 (Legalize AT-10001622)')
  assert.strictEqual(doc.url, 'https://ris.bka.gv.at/eli/jgs/1811/946/P922/NOR40018128')
  const old = await ls.get({ source: 'legalize', ref: 'at:AT-10001622', date: '2020-01-01' })
  assert.match(old.text, /Alte Fassung/)
  assert.strictEqual(old.version, '2019-12-31 (git 3b9aea8d5)')
  await assert.rejects(ls.get({ source: 'legalize', ref: 'at:AT-404' }), (e) => e.plain === 'Legalize has no such document')
  await assert.rejects(ls.get({ source: 'legalize', ref: '../etc' }), /reference from a search result/)
  await ls.setKey('legalize', 'leg_wrongkey_000000')
  const bad = await ls.search({ query: 'x', sources: ['legalize'], jurisdiction: 'AT' })
  assert.match(bad.skipped[0].reason, /did not accept the key/)
})

test('freshness from GitHub: "last updated", and a stale country (> 60 days) is flagged', async () => {
  const lz = require('../src/connectors/legalize')
  const fresh = await lz.freshen({ force: true })
  assert.deepStrictEqual(fresh.AT, { updated: '2026-10-29', sizeKb: 394167 })
  const parts = await lz.local.parts()
  assert.strictEqual(parts.find((p) => p.part === 'CH').stale, true)
  assert.strictEqual(parts.find((p) => p.part === 'AT').stale, false)
  await ls.setKey('legalize', KEY)
  const r = await ls.search({ query: 'ZGB', sources: ['legalize'], jurisdiction: 'CH' })
  assert.match(r.notes[0].note, /Switzerland laws in Legalize were last updated 2026-06-23, more than 60 days ago/)
})

test('a local copy (offline): size first, download only after yes, progress, search, a past date, git pull, remove', { skip: !hasGit && 'git is not installed' }, async () => {
  const repo = makeRepo('at')
  // 1. Size first; nothing downloaded.
  const plan = await ls.downloadPlan('legalize', 'AT')
  assert.deepStrictEqual([plan.part, plan.estimate, plan.from], ['AT', true, 'https://github.com/legalize-dev/legalize-at'])
  assert.match(plan.size, /^about \d/)
  assert.ok(!fs.existsSync(path.join(DATA, 'law-data', 'legalize', 'at', 'repo')))
  await assert.rejects(ls.download('legalize', 'AT'), /confirm/)
  // 2. Yes: with the full history, for past dates.
  ls.download('legalize', 'AT', { confirm: true, history: true })
  const job = await wait(() => { const j = ls.downloadStatus('legalize', 'AT'); return j && j.state !== 'running' && j }, 'clone')
  assert.strictEqual(job.state, 'done', job.error)
  // 3. Searched on this computer: nothing goes online, even with web off.
  setPolicy(null)
  const before = seen.length
  const r = await ls.search({ query: 'Gewähr Entgelt', jurisdiction: 'AT', sources: ['legalize'] })
  assert.strictEqual(seen.length, before, 'nothing left this computer')
  assert.strictEqual(r.results[0].ref, 'at:AT-10001622')
  assert.match(r.results[0].snippet, /Entgelt/)
  const doc = await ls.get({ source: 'legalize', ref: 'at:AT-10001622', article: '922' })
  assert.match(doc.text, /^§ 922\.\n\n\(1\) .*dem Vertrag entspricht\.$/)
  const old = await ls.get({ source: 'legalize', ref: 'at:AT-10001622', date: '2010-06-01' })
  assert.match(old.text, /alte Fassung/)
  assert.match(old.version, /^2001-01-01 \(git [0-9a-f]{9}\)$/)
  // 4. Status: what is on this computer, last updated, the licence read from the repo.
  setPolicy(['web'])
  const st = (await ls.status()).find((s) => s.id === 'legalize')
  assert.strictEqual(st.state, 'ready')
  assert.match(st.status, /\(on this computer: AT last updated 2022-01-01, over 60 days old\)$/)
  assert.match(st.statusDe, /\(auf diesem Computer: AT Stand 2022-01-01, über 60 Tage alt\)$/)
  const item = st.local.items[0]
  assert.deepStrictEqual([item.part, item.history, item.licence, item.laws], ['AT', true, 'CC BY 4.0 (Creative Commons Namensnennung 4.0 International)', 2])
  assert.match(item.attribution, /^Quelle: RIS/)
  assert.ok(item.bytes > 0)
  assert.match((await ls.search({ query: 'Gewähr', jurisdiction: 'AT', sources: ['legalize'] })).notes[0].note, /more than 60 days ago/)
  // 5. git pull: a new reform arrives, the index follows.
  fs.writeFileSync(path.join(repo.dir, 'at', 'AT-10002333.md'), '---\ntitle: "Konsumentenschutzgesetz"\nshort_title: "KSchG"\nstatus: "in_force"\n---\n# KSchG\n\n§ 1.\n\nVerbrauchergeschäfte und Widerrufsbelehrung neu.\n')
  repo.g(['commit', '-q', '-am', 'KSchG-Novelle'])
  assert.strictEqual(await require('../src/connectors/legalize').refresh({ force: true }), 1)
  assert.strictEqual((await ls.search({ query: 'Widerrufsbelehrung', jurisdiction: 'AT', sources: ['legalize'] })).results[0].ref, 'at:AT-10002333')
  // 6. Remove from this computer.
  await ls.removeDownload('legalize', 'AT')
  assert.ok(!fs.existsSync(path.join(DATA, 'law-data', 'legalize', 'at')))
  assert.strictEqual((await ls.status()).find((s) => s.id === 'legalize').state, 'needs_setup')
})

test('"Work fully offline": the plan names every download with its size; on only after yes; then nothing goes online', { skip: !hasGit && 'git is not installed' }, async () => {
  if (!fs.existsSync(path.join(GITROOT, 'legalize-at'))) makeRepo('at')
  const plan = await ls.offline({ countries: ['AT'], plan: true })
  assert.strictEqual(plan.on, false)
  const lz = plan.downloads.find((d) => d.source === 'legalize')
  assert.deepStrictEqual([lz.part, lz.label], ['AT', 'Legalize (laws of many countries): Austria'])
  assert.match(plan.total.size, /^about /)
  await assert.rejects(ls.setOffline(true, { countries: ['AT'] }), /confirm/)
  const on = await ls.setOffline(true, { countries: ['AT'], confirm: true })
  assert.strictEqual(on.on, true)
  await wait(() => ls.downloadStatus('legalize', 'AT')?.state === 'done', 'offline download')
  const before = seen.length
  const r = await ls.search({ query: 'Gewähr', jurisdiction: 'AT' })
  assert.deepStrictEqual(r.searched, ['legalize'], 'only what is on this computer')
  assert.ok(r.skipped.some((s) => s.source === 'ris' && /you work fully offline/.test(s.reason)))
  assert.strictEqual(seen.length, before)
  await assert.rejects(ls.get({ source: 'neuris', ref: 'eli/bund/x' }), /you work fully offline/)
  assert.strictEqual((await ls.setOffline(false)).on, false)
  await ls.removeDownload('legalize', 'AT')
})

test('HU, CY, ZA: no automated source; /law offers pages to read in the browser', async () => {
  const st = await ls.status()
  for (const id of ['hu', 'cy', 'za']) {
    const m = st.find((s) => s.id === id)
    assert.strictEqual(m.state, 'manual')
    assert.match(m.status, /: No open source allows automated access here; OpenLex can open pages for you to read \(browser\)$/)
    assert.match(m.statusDe, /Keine offene Quelle erlaubt hier automatischen Zugriff/)
    assert.ok(m.pages.length && m.pages.every((p) => /^https:\/\//.test(p.url)))
    assert.match(m.guide, /#no-automated-access$/)
  }
  const r = await ls.search({ query: 'szerződés', jurisdiction: 'HU' })
  assert.deepStrictEqual(r.searched, [], 'nothing is contacted')
})

test('every status line has German words; nothing undefined', async () => {
  for (const s of await ls.status()) {
    assert.ok(s.statusDe && !/undefined|null|\[object/.test(s.status + s.statusDe), `${s.id}: ${s.status} / ${s.statusDe}`)
    assert.ok(s.country, s.id)
  }
})

test('agent tools: the AI sees what is connected, switches a source on after "Allow", asks for a key in a secure field', async () => {
  let out = await tools.dispatch({}, 'law_sources_status', { jurisdiction: 'AT' })
  assert.match(out.output, /^LAW SOURCES for AT \(\d+ ready\):\n/)
  assert.match(out.output, /- ris \[AT, law\]: RIS Austria: connected, free/)
  assert.match(out.output, /- legalize \[INT, law, community\]: Legalize/)
  out = await tools.dispatch({}, 'law_sources_status', { jurisdiction: 'HU' })
  assert.match(out.output, /- hu \[HU, manual\]: Hungary: No open source allows automated access here.* — pages: https:\/\/njt\.hu/)
  // Switching on is asked; the key field is not (the lawyer types the key there).
  assert.strictEqual(perms.evaluate('enable_law_source', { source: 'eurlex' }).decision, 'ask')
  assert.strictEqual(perms.evaluate('law_sources_status', {}).decision, 'allow')
  assert.strictEqual(perms.evaluate('request_law_source_key', { source: 'legalize' }).decision, 'allow')
  assert.strictEqual(perms.summarize('enable_law_source', { source: 'eurlex' }), 'Switch on the law source EUR-Lex')
  ls.setEnabled('eurlex', false)
  out = await tools.dispatch({}, 'enable_law_source', { source: 'eurlex' })
  assert.strictEqual(out.output, 'Switched on: EUR-Lex: connected, free')
  out = await tools.dispatch({}, 'request_law_source_key', { source: 'legalize' })
  assert.deepStrictEqual([out.keyRequest.source, out.keyRequest.label, /legalize\.dev\/api/.test(out.keyRequest.keyHelp)], ['legalize', 'Legalize (laws of many countries)', true])
  assert.match(out.output, /never|do not ask for it in the chat/)
  assert.ok(!JSON.stringify(out).includes(KEY))
  out = await tools.dispatch({}, 'request_law_source_key', { source: 'ris' })
  assert.strictEqual(out.output, 'RIS Austria needs no key.')
  const ev = require('../src/explain').annotate({ kind: 'tool', tool: 'request_law_source_key', detail: require('../src/activity').toolDetail('request_law_source_key', { source: 'legalize' }) })
  assert.strictEqual(ev.plain, 'Asking you for a free key for Legalize (laws of many countries, a community project) (in a secure field)')
})

test('the agent\'s own web tools keep to the source terms: NJT, CyLaw, lawlibrary.org.za, SAFLII never; RIS only in its window', async () => {
  const guard = require('../src/web/guard')
  for (const u of ['https://njt.hu/jogszabaly/2013-5-00-00', 'https://www.cylaw.org/nomoi/', 'https://lawlibrary.org.za/akn/za/act/1996/108', 'https://www.saflii.org/za/cases/']) await assert.rejects(guard.assertPublicUrl(u), /Not opened by OpenLex: .*own browser/, u)
  const ris = require('../src/web/ris')
  ris._setClock(() => new Date('2026-11-05T09:00:00Z')) // Thursday 10:00 Vienna
  try {
    await assert.rejects(guard.assertPublicUrl('https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40018128/NOR40018128.html'), /RIS only allows automated access 20:00–05:00/)
    ris._setClock(() => new Date('2026-11-05T20:30:00Z'))
    assert.strictEqual(require('../src/connectors').hostRule('www.ris.bka.gv.at'), null, 'in the window: allowed')
  } finally { ris._setClock(null) }
  const out = await tools.dispatch({}, 'web_fetch', { url: 'https://njt.hu/x' })
  assert.match(out.output, /^ERROR: Not opened by OpenLex: the terms of Hungary's national law database/)
})

test('download API refuses without the yes, and when the client-data rule keeps OpenLex offline', async () => {
  setPolicy(null)
  await assert.rejects(ls.downloadPlan('legalize', 'AT'), /keeps OpenLex offline/)
  setPolicy(['web'])
  await assert.rejects(ls.downloadPlan('ris'), /has nothing to download/)
})

test('live: GitHub freshness and a shallow clone of a small repository', { skip: !NET || !hasGit }, async () => {
  for (const k of ['OPENLEX_LEGALIZE_GITHUB', 'OPENLEX_LEGALIZE_GIT', 'OPENLEX_LEGALIZE_API']) delete process.env[k]
  const lz = require('../src/connectors/legalize')
  const fresh = await lz.freshen({ force: true })
  assert.match(fresh.AT.updated, /^\d{4}-\d\d-\d\d$/)
  const plan = await ls.downloadPlan('legalize', 'RO')
  assert.ok(plan.bytes > 0)
  ls.download('legalize', 'RO', { confirm: true })
  const job = await wait(async () => { const j = ls.downloadStatus('legalize', 'RO'); if (j && j.state !== 'running') return j; await new Promise((ok) => setTimeout(ok, 500)); return null }, 'live clone')
  assert.strictEqual(job.state, 'done', job.error)
  const items = await lz.local.items()
  assert.ok(items.find((i) => i.part === 'RO').laws > 10)
  await ls.removeDownload('legalize', 'RO')
})
