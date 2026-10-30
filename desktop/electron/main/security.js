/**
 * Renderer hardening for the desktop App.
 *
 * The window shows the App's own pages (file://…/client/index.html, or the
 * dev server). Model answers and documents are shown in it too, so a link
 * in an answer must never turn into an Electron window that carries the
 * preload bridge (window.lexvault → engine, matters, files), and the bridge
 * must answer only the App's own pages:
 *
 * - window.open / target=_blank: never a new App window; http(s) and
 *   mailto links open in the system browser.
 * - navigation away from the App's pages is cancelled (the link opens in
 *   the system browser instead); <webview> is never attached.
 * - shell.openExternal only for http(s) and mailto (no file:, smb:,
 *   custom app protocols that can start programs).
 * - every ipcMain.handle checks that the caller is the App's own top-level
 *   page; anything else is refused.
 * - permission requests (camera, microphone, geolocation, …) are refused,
 *   except writing to the clipboard and fullscreen.
 *
 * Pure helpers are exported for tests (node, no Electron needed).
 */
const path = require('path')
const { fileURLToPath } = require('url')

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

/** True for a web address that may be handed to the system browser / mail app. */
function isSafeExternalUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return false }
  if (!EXTERNAL_PROTOCOLS.has(u.protocol)) return false
  if (u.protocol === 'mailto:') return true
  return !!u.hostname && !u.username && !u.password
}

/** True for the App's own pages: a file inside the client folder, or the dev server's origin. */
function isAppUrl(raw, { clientDir, devFrontend } = {}) {
  let u
  try { u = new URL(String(raw)) } catch { return false }
  if (devFrontend) {
    try { if (u.origin === new URL(devFrontend).origin && u.origin !== 'null') return true } catch { /* bad dev URL */ }
  }
  if (u.protocol !== 'file:' || !clientDir) return false
  let p
  try { p = path.resolve(fileURLToPath(u)) } catch { return false }
  const root = path.resolve(clientDir)
  const norm = (x) => (process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() : x)
  return norm(p) === norm(root) || norm(p).startsWith(norm(root + path.sep))
}

/** True when an IPC call comes from the App's own top-level page. */
function isTrustedSender(event, opts) {
  const frame = event && event.senderFrame
  if (!frame) return false
  // Sub-frames (an iframe in an answer) never get the bridge's powers.
  if (frame.parent) return false
  return isAppUrl(frame.url, opts)
}

/**
 * Wrap ipcMain.handle so every channel registered afterwards refuses
 * callers that are not the App's own page. Call once, before registering.
 */
function guardIpc(ipcMain, opts, log = console) {
  if (ipcMain.__openlexGuarded) return
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, fn) => handle(channel, (event, ...args) => {
    if (!isTrustedSender(event, opts)) {
      log.warn(`[security] refused IPC ${channel} from ${event && event.senderFrame ? event.senderFrame.url : 'unknown sender'}`)
      throw new Error('not allowed')
    }
    return fn(event, ...args)
  })
  ipcMain.__openlexGuarded = true
}

/** Open a link in the system browser when it is safe; returns whether it did. */
function openExternalSafe(shell, url) {
  if (!isSafeExternalUrl(url)) return false
  shell.openExternal(String(url)).catch(() => {})
  return true
}

/** Apply the navigation rules to one webContents (every window, every frame). */
function hardenContents(contents, { shell, ...opts }) {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(shell, url)
    return { action: 'deny' }
  })
  const stay = (event, url) => {
    if (isAppUrl(url, opts)) return
    event.preventDefault()
    openExternalSafe(shell, url)
  }
  contents.on('will-navigate', stay)
  contents.on('will-redirect', stay)
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Refuse permission requests except the few the App uses. */
function hardenSession(session) {
  session.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
}

/** Install everything on the app: call once, before any window is created. */
function install({ app, ipcMain, shell, clientDir, devFrontend }) {
  const opts = { clientDir, devFrontend }
  guardIpc(ipcMain, opts)
  app.on('web-contents-created', (_e, contents) => hardenContents(contents, { shell, ...opts }))
  app.whenReady().then(() => hardenSession(require('electron').session.defaultSession)).catch(() => {})
}

module.exports = { isSafeExternalUrl, isAppUrl, isTrustedSender, guardIpc, hardenContents, hardenSession, openExternalSafe, install, ALLOWED_PERMISSIONS }
