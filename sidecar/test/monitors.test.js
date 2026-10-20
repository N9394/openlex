"use strict"
/**
 * Monitors (Phase 7.4): watch official sources for new law.
 *
 *   node --test test/monitors.test.js
 *
 * No network: source fetchers are stubbed (EUR-Lex / RIS) or fetch is
 * stubbed (RSS / page, on a TEST-NET address so the public-URL guard still
 * runs). Checks: data policy gate, first-check baseline, seen-item dedupe,
 * topic filter, decision-model relevance, page change diff, alert filing.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-mon-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_MONITORS = '0'

let mon, policy
const realFetch = globalThis.fetch
const pages = new Map() // url → body
test.before(() => {
  mon = require('../src/monitors')
  policy = require('../src/policy')
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  globalThis.fetch = async (url, opts) => {
    const body = pages.get(String(url))
    if (body === undefined) return realFetch(url, opts)
    return new Response(body, { status: 200 })
  }
})
test.after(() => { globalThis.fetch = realFetch; fs.rmSync(DATA, { recursive: true, force: true }) })

const today = new Date().toISOString().slice(0, 10)

test('validation', () => {
  assert.throws(() => mon.create({ source: { type: 'twitter' } }), /source.type/)
  assert.throws(() => mon.create({ source: { type: 'eurlex' } }), /needs a query/)
  assert.throws(() => mon.create({ source: { type: 'rss', url: 'ftp://x' } }), /http/)
  const m = mon.create({ title: 'AI Act', source: { type: 'eurlex', query: 'artificial intelligence' }, everyHours: 0 })
  assert.strictEqual(m.everyHours, 1, 'at most hourly')
  mon.remove(m.id)
})

test('data policy: local-only blocks the check before anything is fetched', async () => {
  let called = false
  const orig = mon.fetchers.eurlex
  mon.fetchers.eurlex = async () => { called = true; return [] }
  const m = mon.create({ source: { type: 'eurlex', query: 'data' } })
  const r = await mon.check(m.id)
  assert.match(r.error, /blocked by data policy/)
  assert.strictEqual(called, false)
  mon.fetchers.eurlex = orig
  mon.remove(m.id)
})

test('eurlex: older items ignored, seen items never alerted twice, topics filter', async () => {
  policy.setRule(null, { mode: 'allow-list', providers: ['web'] })
  const items = [
    { id: 'celex:32026R0001', title: 'Regulation on data spaces for health', url: 'u1', date: today, text: '' },
    { id: 'celex:32026R0002', title: 'Regulation on fishing quotas', url: 'u2', date: today, text: '' },
    { id: 'celex:32020R0003', title: 'Old regulation on health data', url: 'u3', date: '2020-01-01', text: '' },
  ]
  const orig = mon.fetchers.eurlex
  mon.fetchers.eurlex = async () => items
  const m = mon.create({ title: 'Health data', source: { type: 'eurlex', query: 'data' }, topics: ['health'] })
  let r = await mon.check(m.id)
  assert.deepStrictEqual(r.alerts.map((a) => a.title), ['Regulation on data spaces for health'])
  r = await mon.check(m.id)
  assert.strictEqual(r.alerts.length, 0, 'already seen')
  items.push({ id: 'celex:32026R0009', title: 'Implementing act on health records', url: 'u9', date: today, text: '' })
  r = await mon.check(m.id)
  assert.deepStrictEqual(r.alerts.map((a) => a.title), ['Implementing act on health records'])
  mon.fetchers.eurlex = orig
})

test('relevance by the decision model when configured', async () => {
  const kev = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const b = JSON.parse(raw)
      res.end(JSON.stringify({ answers: { rel: { type: 'noul', noul: /employee/i.test(b.state) ? 0.91 : 0.04 } } }))
    })
  })
  await new Promise((r) => kev.listen(0, '127.0.0.1', r))
  require('../src/decide').saveConfig({ url: `http://127.0.0.1:${kev.address().port}` })
  const orig = mon.fetchers.ris
  mon.fetchers.ris = async () => [
    { id: 'ris:A', title: 'BGBl. I Nr. 90/2026 Änderung des Arbeitsverfassungsgesetzes (employee representation)', url: 'r1', date: today },
    { id: 'ris:B', title: 'BGBl. II Nr. 300/2026 Verordnung über Weinbau', url: 'r2', date: today },
  ]
  const m = mon.create({ title: 'Labour law', source: { type: 'ris', query: 'Arbeit' }, topics: ['labour and employment law'] })
  const r = await mon.check(m.id)
  assert.deepStrictEqual(r.alerts.map((a) => [a.url, a.relevance]), [['r1', 0.91]], 'no keyword overlap needed: the decider judged relevance')
  mon.fetchers.ris = orig
  require('../src/decide').saveConfig(null)
  kev.close()
})

test('rss feed parsing (RSS 2.0 and Atom)', async () => {
  const rss = '<rss><channel><item><title><![CDATA[Court ruling &amp; costs]]></title><link>https://court.example/1</link><guid>g1</guid><pubDate>Mon, 19 Oct 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;New ruling on costs&lt;/p&gt;</description></item></channel></rss>'
  const atom = '<feed><entry><title>Gazette 42</title><link href="https://gazette.example/42"/><id>urn:42</id><updated>2026-10-18T10:00:00Z</updated><summary>Amendment</summary></entry></feed>'
  assert.deepStrictEqual(mon.parseFeed(rss)[0], { id: 'rss:g1', title: 'Court ruling & costs', url: 'https://court.example/1', date: '2026-10-19', text: 'New ruling on costs' })
  assert.deepStrictEqual(mon.parseFeed(atom).map((x) => [x.id, x.url, x.date]), [['rss:urn:42', 'https://gazette.example/42', '2026-10-18']])
})

test('page monitor: the first check is the baseline, a change alerts with the new sentences', async () => {
  const url = 'http://203.0.113.7/notices'
  pages.set(url, '<html><body><p>Fees are set at EUR 100.</p><p>Office hours are 9 to 5.</p></body></html>')
  const m = mon.create({ title: 'Court fees page', source: { type: 'page', url } })
  assert.strictEqual((await mon.check(m.id)).alerts.length, 0)
  assert.strictEqual((await mon.check(m.id)).alerts.length, 0, 'unchanged')
  pages.set(url, '<html><body><p>Fees are set at EUR 150 from 1 January 2027.</p><p>Office hours are 9 to 5.</p></body></html>')
  const r = await mon.check(m.id)
  assert.strictEqual(r.alerts.length, 1)
  assert.match(r.alerts[0].text, /EUR 150 from 1 January 2027/)
  // Private addresses are refused by the web guard, even for a page monitor.
  const bad = mon.create({ title: 'internal', source: { type: 'page', url: 'http://192.168.1.10/' } })
  assert.match((await mon.check(bad.id)).error, /private network/)
})

test('due checks respect the interval; alerts can be read and filed into the matter', async () => {
  const before = mon.list().find((x) => x.title === 'Health data')
  const results = await mon.checkDue(Date.now())
  assert.ok(!results.some((r) => r.id === before.id), 'checked minutes ago, not due')
  const all = mon.alerts()
  assert.ok(all.length >= 4)
  const file = mon.fileAlert(all[0].id)
  assert.match(fs.readFileSync(file, 'utf8'), /Source: /)
  assert.strictEqual(mon.markRead('all'), 0)
  assert.strictEqual(mon.alerts({ unread: true }).length, 0)
})
