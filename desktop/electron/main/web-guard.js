'use strict'
/**
 * The app window never talks to the internet by itself.
 *
 * Documents, web pages and law sources can carry hidden instructions for the
 * AI ("prompt injection"). One goal of such an instruction is to make the AI
 * write an image or a link whose address carries client data, so that the
 * window loads it and the data leaves without anyone clicking. Three locks:
 *
 *   1. requests   every request the window makes goes to this computer
 *                 (file:, data:, blob:, 127.0.0.1 / localhost) or is
 *                 cancelled. The engine itself is reached over IPC.
 *   2. navigation the window stays on the app; a link to the web opens in
 *                 the lawyer's browser (shell.openExternal), never inside
 *                 the app, and only http(s) and mailto addresses at all.
 *   3. policy     the built page carries a Content-Security-Policy
 *                 (desktop/client/vite.config.ts) as a second line.
 *
 * Pure functions (no Electron), so the decisions are unit-tested;
 * install() wires them into a BrowserWindow.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const LOCAL_SCHEMES = new Set(['file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:', 'about:'])

function parse(url) {
  try { return new URL(String(url)) } catch { return null }
}

/** Is this address on this computer? */
function isLoopback(url) {
  const u = parse(url)
  return !!u && /^(https?|wss?):$/.test(u.protocol) && LOOPBACK.has(u.hostname.toLowerCase())
}

/** May the app window itself request this address (image, script, fetch)? */
function rendererRequestAllowed(url) {
  const u = parse(url)
  if (!u) return false
  if (LOCAL_SCHEMES.has(u.protocol)) return true
  return isLoopback(url)
}

/** May a click open this address in the lawyer's browser? http(s) and mailto only. */
function externalUrlAllowed(url) {
  const u = parse(url)
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:')
}

/**
 * May the window navigate to this address? Only to the app's own page
 * (the same file, or the dev server's origin).
 */
function navigationAllowed(url, appUrl) {
  const u = parse(url)
  const a = parse(appUrl)
  if (!u || !a) return false
  if (a.protocol === 'file:') return u.protocol === 'file:' && u.pathname === a.pathname
  return u.origin === a.origin
}

/**
 * Wire the locks into a window. `shell` is Electron's shell (openExternal).
 * Returns nothing; logs what it blocked (address host only, never the full
 * address: it may carry document text).
 */
function install(win, { shell, appUrl, log = console } = {}) {
  const wc = win.webContents
  const hostOf = (url) => parse(url)?.host || String(url).slice(0, 20)
  const openOutside = (url) => {
    if (externalUrlAllowed(url)) shell.openExternal(url).catch(() => {})
    else log.warn?.(`[web-guard] not opened (scheme): ${parse(url)?.protocol || '?'}`)
  }
  // 1. Requests from this window's pages only (the main process's own fetch
  //    for updates and downloads does not pass through here).
  wc.session.webRequest.onBeforeRequest((details, cb) => {
    if (details.webContentsId === undefined || details.webContentsId === null) return cb({})
    if (rendererRequestAllowed(details.url)) return cb({})
    log.warn?.(`[web-guard] blocked a request from the app window to ${hostOf(details.url)}`)
    cb({ cancel: true })
  })
  // 2. Navigation and new windows.
  wc.on('will-navigate', (e, url) => {
    if (navigationAllowed(url, appUrl())) return
    e.preventDefault()
    openOutside(url)
  })
  wc.on('will-redirect', (e, url) => {
    if (navigationAllowed(url, appUrl())) return
    e.preventDefault()
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
}

module.exports = { isLoopback, rendererRequestAllowed, externalUrlAllowed, navigationAllowed, install }
