"use strict"
/**
 * Phase 5 web access: guard (public hosts only), data-policy gate, RIS
 * adapter, browser read + save with provenance.
 *
 *   node --test test/web.test.js
 *   OPENLEX_TEST_NETWORK=1 node --test test/web.test.js   # + live RIS and browser
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-web-'))
process.env.LEXVAULT_DATA_DIR = DATA
const NET = process.env.OPENLEX_TEST_NETWORK === '1'

const guard = require('../src/web/guard')
const policy = require('../src/policy')
test.after(async () => { await require('../src/web/browser').close(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('private and loopback addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.1.1', '100.100.100.100', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.ok(guard.privateIp(ip), ip)
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.ok(!guard.privateIp(ip), ip)
})

test('only public http(s) URLs pass', async () => {
  for (const bad of ['file:///etc/passwd', 'http://localhost:18001/api/policy', 'http://127.0.0.1:6333', 'http://[::1]/', 'http://10.0.0.5/', 'http://sidecar.local/', 'javascript:alert(1)', 'not a url']) {
    await assert.rejects(guard.assertPublicUrl(bad), undefined, bad)
  }
  const u = await guard.assertPublicUrl('https://93.184.216.34/x')
  assert.strictEqual(u.hostname, '93.184.216.34')
})

test('web access follows the data policy and is audited by host only', () => {
  assert.match(guard.checkWeb('www.ris.bka.gv.at', 'web_fetch'), /BLOCKED by data policy/)
  policy.setRule(null, { mode: 'allow-list', providers: ['web'] })
  assert.strictEqual(guard.checkWeb('www.ris.bka.gv.at', 'web_fetch'), null)
  policy.setRule('m_priv', { mode: 'local-only' })
  assert.match(policy.withMatter('m_priv', () => guard.checkWeb('example.com', 'web_fetch')), /BLOCKED/)
  const lines = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepStrictEqual(lines.map((l) => [l.provider, l.model, l.decision]), [
    ['web', 'www.ris.bka.gv.at', 'blocked'], ['web', 'www.ris.bka.gv.at', 'allowed'], ['web', 'example.com', 'blocked'],
  ])
})

test('agent tools refuse local URLs before any policy or network step', async () => {
  const { dispatch } = require('../src/tools')
  const r = await dispatch({}, 'web_fetch', { url: 'http://127.0.0.1:18001/api/workspace' })
  assert.match(r.output, /ERROR: refusing private network address/)
})

test('RIS live search returns in-force metadata', { skip: !NET || !require('../src/web/ris').liveAllowed() }, async () => { // RIS terms: only 20:00–05:00 Vienna time, weekends, holidays
  const r = await require('../src/web/ris').searchBundesrecht('Verjährung Schadenersatz', { limit: 5 })
  assert.ok(r.total > 0)
  const x = r.results[0]
  assert.ok(x.title && x.url && /ris\.bka\.gv\.at/.test(x.url))
  assert.strictEqual(typeof x.inForce, 'boolean')
})

test('browser reads a page and saves it with provenance', { skip: !NET }, async () => {
  const ws = require('../src/workspace')
  ws.setBase(path.join(DATA, 'ws'))
  const browser = require('../src/web/browser')
  const page = await browser.fetchPage('https://example.com/')
  assert.match(page.title, /Example Domain/)
  assert.match(page.text, /documentation examples/i)
  const saved = await browser.saveToMatter('https://example.com/', 'Acme')
  assert.strictEqual(saved.files.length, 3)
  const prov = JSON.parse(fs.readFileSync(saved.files[2], 'utf8'))
  assert.match(prov.sha256.text, /^[a-f0-9]{64}$/)
  const crypto = require('crypto')
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(saved.files[1])).digest('hex'), prov.sha256.screenshot)
})
