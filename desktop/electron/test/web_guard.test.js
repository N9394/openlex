'use strict'
/**
 * The app window never reaches the internet by itself (main/web-guard.js):
 * remote requests from the page are cancelled, navigation stays on the app,
 * links open in the browser only for http(s)/mailto. No Electron needed.
 *
 *   node --test desktop/electron/test/web_guard.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const g = require('../main/web-guard')

test('the window may request only local addresses', () => {
  for (const u of ['file:///Applications/OpenLex.app/Contents/Resources/client/assets/index.js', 'data:image/png;base64,AAAA', 'blob:file:///1234', 'http://127.0.0.1:18000/api/x', 'http://localhost:5173/src/main.tsx', 'ws://localhost:5173/', 'devtools://devtools/bundled/x']) {
    assert.strictEqual(g.rendererRequestAllowed(u), true, u)
  }
  for (const u of ['https://attacker.example/pixel.gif?d=Alpine', 'http://attacker.example/', 'http://127.0.0.1.attacker.example/', 'https://localhost.attacker.example/', 'wss://attacker.example/', 'ftp://attacker.example/', 'not a url', '']) {
    assert.strictEqual(g.rendererRequestAllowed(u), false, u)
  }
})

test('only http(s) and mailto open in the browser', () => {
  for (const u of ['https://eur-lex.europa.eu/x', 'http://example.com', 'mailto:office@example.com']) assert.strictEqual(g.externalUrlAllowed(u), true, u)
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://share/x', 'ms-word:ofe|u|x', 'vscode://x', '']) assert.strictEqual(g.externalUrlAllowed(u), false, u)
})

test('navigation stays on the app page', () => {
  const app = 'file:///Applications/OpenLex.app/Contents/Resources/client/index.html'
  assert.strictEqual(g.navigationAllowed(`${app}#/research`, app), true)
  assert.strictEqual(g.navigationAllowed('file:///etc/passwd', app), false)
  assert.strictEqual(g.navigationAllowed('https://attacker.example/', app), false)
  assert.strictEqual(g.navigationAllowed('http://localhost:5173/settings', 'http://localhost:5173/'), true)
  assert.strictEqual(g.navigationAllowed('http://localhost:5174/', 'http://localhost:5173/'), false)
})

test('install: requests cancelled, links opened outside, no new windows, no webviews', () => {
  const handlers = {}
  let onBefore = null
  let openHandler = null
  const opened = []
  const win = { webContents: {
    session: { webRequest: { onBeforeRequest: (fn) => { onBefore = fn } } },
    on: (ev, fn) => { handlers[ev] = fn },
    setWindowOpenHandler: (fn) => { openHandler = fn },
  } }
  const shell = { openExternal: async (u) => { opened.push(u) } }
  g.install(win, { shell, appUrl: () => 'file:///app/index.html', log: { warn: () => {} } })
  const decide = (details) => { let r; onBefore(details, (x) => { r = x }); return r }
  assert.deepStrictEqual(decide({ url: 'https://attacker.example/x.gif?d=secret', webContentsId: 1 }), { cancel: true })
  assert.deepStrictEqual(decide({ url: 'file:///app/assets/index.js', webContentsId: 1 }), {})
  assert.deepStrictEqual(decide({ url: 'https://updates.example/latest.yml' }), {}, 'the main process\'s own requests are not the window\'s')
  let prevented = false
  handlers['will-navigate']({ preventDefault: () => { prevented = true } }, 'https://www.ris.bka.gv.at/')
  assert.ok(prevented)
  assert.deepStrictEqual(openHandler({ url: 'https://eur-lex.europa.eu/x' }), { action: 'deny' })
  assert.deepStrictEqual(openHandler({ url: 'file:///etc/passwd' }), { action: 'deny' })
  assert.deepStrictEqual(opened, ['https://www.ris.bka.gv.at/', 'https://eur-lex.europa.eu/x'])
  let wv = false
  handlers['will-attach-webview']({ preventDefault: () => { wv = true } })
  assert.ok(wv)
})

test('main.js wires the guard and checks addresses before shell.openExternal', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../main/main.js'), 'utf8')
  assert.match(src, /require\('\.\/web-guard'\)\.install\(mainWindow/)
  assert.match(src, /externalUrlAllowed\(url\)/)
  assert.ok(!/ipcMain\.handle\('lexvault:openExternal', \(_e, url\) => shell\.openExternal\(url\)\)/.test(src), 'no unchecked openExternal')
})
