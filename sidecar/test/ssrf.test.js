"use strict"
/**
 * The web guard (web/guard.js): no request into this computer or the
 * office network — also not through IPv6 forms that hide an IPv4 address,
 * and not through a redirect from a public page.
 *
 *   node --test test/ssrf.test.js
 */

const test = require('node:test')
const assert = require('assert')
const guard = require('../src/web/guard')

test('private, loopback and hidden-IPv4 addresses are refused; public ones pass', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1',
    '::1', '::', '::ffff:7f00:1', '::ffff:127.0.0.1', '::7f00:1', '::ffff:c0a8:101', '64:ff9b::7f00:1', '2002:7f00:1::1', 'fd12::1', 'fe80::1', 'fe80::1%en0', 'fec0::1', 'ff02::1', 'not-an-ip', '1::2::3']) {
    assert.ok(guard.privateIp(ip), ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2a00:1450::1']) assert.ok(!guard.privateIp(ip), ip)
})

test('URLs that the URL parser rewrites into loopback forms are refused', async () => {
  for (const u of ['http://[::ffff:127.0.0.1]:18001/api/sessions', 'http://[::127.0.0.1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://[64:ff9b::a00:1]/', 'file:///etc/passwd', 'http://localhost./']) {
    await assert.rejects(() => guard.assertPublicUrl(u), Error, u)
  }
})

test('a redirect from a public page into the local network is refused; credentials do not follow to another site', async () => {
  const real = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers && init.headers.Authorization, redirect: init.redirect })
    if (String(url) === 'http://8.8.8.8/a') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1:18001/api/sessions' } })
    if (String(url) === 'http://8.8.8.8/b') return new Response('', { status: 301, headers: { location: 'http://1.1.1.1/c' } })
    if (String(url) === 'http://8.8.8.8/loop') return new Response('', { status: 302, headers: { location: '/loop' } })
    return new Response('ok', { status: 200 })
  }
  try {
    await assert.rejects(() => guard.safeFetch('http://8.8.8.8/a', {}), /private network|local/)
    assert.ok(!seen.some((s) => s.url.includes('127.0.0.1')), 'never connected to the local address')
    assert.ok(seen.every((s) => s.redirect === 'manual'))
    const r = await guard.safeFetch('http://8.8.8.8/b', { headers: { Authorization: 'Bearer secret' } })
    assert.strictEqual(await r.text(), 'ok')
    assert.strictEqual(seen.at(-1).url, 'http://1.1.1.1/c')
    assert.strictEqual(seen.at(-1).auth, undefined, 'Authorization dropped on a cross-site redirect')
    await assert.rejects(() => guard.safeFetch('http://8.8.8.8/loop', {}), /too many redirects/)
  } finally { globalThis.fetch = real }
})
