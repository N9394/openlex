/**
 * Renderer hardening (main/security.js): links in answers never become App
 * windows with the preload bridge, navigation stays on the App's pages,
 * openExternal only for http(s)/mailto, and IPC answers only the App's page.
 *
 *   node --test desktop/electron/test/security.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { pathToFileURL } = require('url')

const sec = require('../main/security')

const CLIENT = path.resolve(__dirname, 'fixture-client')
const opts = { clientDir: CLIENT, devFrontend: null }
const appUrl = pathToFileURL(path.join(CLIENT, 'index.html')).href + '?backend=x'

test('only http(s) and mailto go to the system; file, custom protocols and javascript never', () => {
  for (const u of ['https://eur-lex.europa.eu/x', 'http://example.com', 'mailto:a@b.example']) assert.ok(sec.isSafeExternalUrl(u), u)
  for (const u of ['file:///etc/passwd', 'smb://server/share', 'javascript:alert(1)', 'ms-msdt:/id', 'vscode://x', 'data:text/html,x', 'https://user:pw@example.com', 'not a url', '', null, 'https://']) {
    assert.ok(!sec.isSafeExternalUrl(u), String(u))
  }
})

test('the App\'s pages: files in the client folder or the dev server — nothing else', () => {
  assert.ok(sec.isAppUrl(appUrl, opts))
  assert.ok(sec.isAppUrl(pathToFileURL(path.join(CLIENT, 'assets', 'a.js')).href, opts))
  assert.ok(!sec.isAppUrl(pathToFileURL(path.join(CLIENT + '-evil', 'index.html')).href, opts), 'sibling folder with the same prefix')
  assert.ok(!sec.isAppUrl(pathToFileURL(path.resolve('/tmp/evil.html')).href, opts))
  assert.ok(!sec.isAppUrl('https://evil.example/index.html', opts))
  assert.ok(!sec.isAppUrl('about:blank', opts))
  const dev = { clientDir: CLIENT, devFrontend: 'http://localhost:5173' }
  assert.ok(sec.isAppUrl('http://localhost:5173/research?x=1', dev))
  assert.ok(!sec.isAppUrl('http://localhost:5174/', dev))
  assert.ok(!sec.isAppUrl('http://localhost:5173.evil.example/', dev))
})

function fakeIpc() {
  const handlers = new Map()
  return { handlers, handle(ch, fn) { handlers.set(ch, fn) } }
}
const frame = (url, parent = null) => ({ senderFrame: { url, parent } })

test('every IPC handler refuses callers that are not the App\'s own top-level page', async () => {
  const ipc = fakeIpc()
  const quiet = { warn() {} }
  sec.guardIpc(ipc, opts, quiet)
  sec.guardIpc(ipc, opts, quiet) // twice is harmless
  ipc.handle('lexvault:engine', (_e, x) => `ok ${x}`)
  const h = ipc.handlers.get('lexvault:engine')
  assert.strictEqual(await h(frame(appUrl), 1), 'ok 1')
  for (const ev of [frame('https://evil.example/'), frame(appUrl, { url: appUrl }), frame(pathToFileURL('/tmp/x.html').href), {}, null]) {
    assert.throws(() => h(ev, 1), /not allowed/)
  }
})

test('links never open App windows; safe ones go to the system browser; navigation away is cancelled', () => {
  const opened = []
  const shell = { openExternal: (u) => { opened.push(u); return Promise.resolve() } }
  const wc = new EventEmitter()
  wc.setWindowOpenHandler = (fn) => { wc.openHandler = fn }
  sec.hardenContents(wc, { shell, ...opts })
  assert.deepStrictEqual(wc.openHandler({ url: 'https://evil.example/' }), { action: 'deny' })
  assert.deepStrictEqual(wc.openHandler({ url: 'file:///Applications/Calculator.app' }), { action: 'deny' })
  assert.deepStrictEqual(opened, ['https://evil.example/'])
  let prevented = 0
  const ev = () => ({ preventDefault: () => { prevented++ } })
  wc.emit('will-navigate', ev(), 'https://evil.example/phish')
  wc.emit('will-redirect', ev(), 'smb://server/x')
  wc.emit('will-navigate', ev(), appUrl)
  wc.emit('will-attach-webview', ev())
  assert.strictEqual(prevented, 3)
  assert.deepStrictEqual(opened, ['https://evil.example/', 'https://evil.example/phish'])
})

test('permission requests are refused except clipboard writes and fullscreen', () => {
  let req, chk
  sec.hardenSession({ setPermissionRequestHandler: (f) => { req = f }, setPermissionCheckHandler: (f) => { chk = f } })
  const ask = (p) => { let r; req(null, p, (v) => { r = v }); return r }
  for (const p of ['media', 'geolocation', 'notifications', 'openExternal', 'hid', 'serial']) { assert.strictEqual(ask(p), false, p); assert.strictEqual(chk(null, p), false, p) }
  assert.strictEqual(ask('clipboard-sanitized-write'), true)
})

test('main.js installs the hardening and the window is sandboxed', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8')
  assert.match(src, /security\.install\(/)
  assert.ok(src.indexOf('security.install(') < src.indexOf("ipcMain.handle('"), 'installed before the first IPC handler')
  assert.match(src, /sandbox: true/)
  assert.match(src, /contextIsolation: true/)
  assert.match(src, /nodeIntegration: false/)
  assert.doesNotMatch(src, /shell\.openExternal\(url\)\)/, 'no unchecked openExternal')
})

test('the updater talks https only and keeps the licence token on the feed host', () => {
  const U = require('../main/updater')
  for (const u of ['https://updates.example/api/app/update/mac', 'http://127.0.0.1:9/x', 'http://localhost:9/x']) assert.ok(U.transportOk(u), u)
  for (const u of ['http://updates.example/x', 'ftp://x/y', 'file:///tmp/x.zip', 'nonsense']) assert.ok(!U.transportOk(u), u)
  const h = { Authorization: 'Bearer lv_live_x', 'User-Agent': 'u' }
  assert.strictEqual(U.headersFor('https://feed.example/a.zip', h, 'https://feed.example/api').Authorization, 'Bearer lv_live_x')
  assert.strictEqual(U.headersFor('https://cdn.example/a.zip', h, 'https://feed.example/api').Authorization, undefined)
  assert.strictEqual(U.headersFor('https://cdn.example/a.zip', h, 'https://feed.example/api')['User-Agent'], 'u')
})
