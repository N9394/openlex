/**
 * OpenLex desktop app — Electron main process.
 *
 * Runs without an account. A distribution build may add a signed license
 * (pasted token, Settings → License); without one the App boots in
 * community mode. This file:
 *  1. Reads + verifies the license (Ed25519), else community mode
 *  2. Resolves runtime paths (sidecars, models, server, client)
 *  3. Spawns Qdrant, the LLM proxy (and an embeddings service, when a
 *     distribution ships one) and waits for them
 *  4. Starts the OpenLex engine (sidecar/) as the backend; the old desktop
 *     server only with OPENLEX_LEGACY_SERVER=1 (main/legacy.js)
 *  5. Loads the SPA from disk (file://) into a window
 *  6. Tears it all down on quit
 *
 * In dev (LEXVAULT_DEV_BACKEND / LEXVAULT_DEV_FRONTEND env), it skips the
 * sidecar + backend spawn and just opens the existing localhost dev server,
 * so we can iterate on the Electron shell without fighting Qdrant binaries.
 */

const { app, BrowserWindow, dialog, ipcMain, shell, Notification } = require('electron')

// The product is called OpenLex now, but existing installs keep their
// settings, licence and models: the settings folder stays "LexVault"
// (with the app id com.lexvault.app). Must run before anything reads userData.
app.setPath('userData', require('path').join(app.getPath('appData'), 'LexVault'))
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Supervisor = require('../sidecars/supervisor')
const { detect: detectHardware } = require('./hardware-detect')
const { fetchModel } = require('./model-fetcher')
const { settleLocalModel, localModelSuggestion, downloadSuggestedModel } = require('./model-setup')
const { loadDistribution, serverOf, readToken } = require('./distribution')
const { syncPacks } = require('./pack-fetcher')

// Custom mini-updater that bypasses electron-updater's signed-publisher
// requirement. Until we ship a code-signing cert, electron-updater silently
// refuses to install unsigned updates on Windows. This module does the
// download + spawn-installer ourselves.
const Updater = require('./updater')
let updater = null

// Module-level state used by the Dependencies tab in Settings to surface
// boot-time progress that's otherwise invisible to the renderer.
let _modelFetchState = { state: 'unknown' }
let _bootHardware = null
let _bootModelPath = null

// Boot stage events (model download %, service startup) for any open window.
function emitBoot(stage, detail) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('lexvault:boot-stage', { stage, ...(detail || {}) }) } catch {}
  }
}

const isDev = !!process.env.LEXVAULT_DEV_BACKEND || !app.isPackaged
const DEV_BACKEND = process.env.LEXVAULT_DEV_BACKEND || null
const DEV_FRONTEND = process.env.LEXVAULT_DEV_FRONTEND || null

// Resource roots. In dev we read from the source tree; in a packaged build,
// resources are copied into electron-builder's `extraResources` location.
const RESOURCES_DIR = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..', 'resources')

const PATHS = {
  resources: RESOURCES_DIR,
  server: path.join(RESOURCES_DIR, 'server'),
  client: path.join(RESOURCES_DIR, 'client'),
  bin: path.join(RESOURCES_DIR, 'bin'),
  // OpenLex engine library (provider facade, data policy, keychain) shared
  // with the Word sidecar. Packaged: resources/engine; dev: the repo copy.
  engine: fs.existsSync(path.join(RESOURCES_DIR, 'engine', 'src', 'llm.js'))
    ? path.join(RESOURCES_DIR, 'engine', 'src')
    : path.resolve(__dirname, '..', '..', '..', 'sidecar', 'src'),
  // Models live under userData (large, downloaded), not resources (read-only bundle).
  models: path.join(app.getPath('userData'), 'models'),
  tiers: path.join(RESOURCES_DIR, 'hardware-tiers.json'),
  userData: app.getPath('userData'),
  license: path.join(app.getPath('userData'), 'license.json'),
  token: path.join(app.getPath('userData'), 'token.txt'),
  hardware: path.join(app.getPath('userData'), 'hardware.json'),
  hardwareOverride: path.join(app.getPath('userData'), 'hardware.override.json'),
  qdrantData: path.join(app.getPath('userData'), 'qdrant'),
  appDb: path.join(app.getPath('userData'), 'app.db'),
  packs: path.join(app.getPath('userData'), 'packs'),
  packsArchive: path.join(app.getPath('userData'), 'packs', 'archive'),
  packsState: path.join(app.getPath('userData'), 'packs.json'),
  notificationsPref: path.join(app.getPath('userData'), 'notifications.txt'),
}

// User pref for desktop notifications. Default ON. Persisted via IPC handler.
let _notificationsEnabled = true
try {
  if (require('fs').existsSync(PATHS.notificationsPref)) {
    _notificationsEnabled = require('fs').readFileSync(PATHS.notificationsPref, 'utf8').trim() !== '0'
  }
} catch {}

// Licence / update / download server: none in the open-source code. A
// distributor's settings (distribution.json) come from $OPENLEX_DISTRIBUTION,
// else <userData>/distribution.json, else the installer's resources (see
// main/distribution.js); LEXVAULT_LICENSE_SERVER overrides the server.
const DISTRIBUTION_FOUND = loadDistribution({
  userData: app.getPath('userData'),
  resourcesPath: RESOURCES_DIR,
  devDir: app.isPackaged ? null : path.join(__dirname, '..'),
})
const DISTRIBUTION = DISTRIBUTION_FOUND.config
// The engine and the embeddings service (child processes) read the same file.
if (DISTRIBUTION_FOUND.file && !process.env.OPENLEX_DISTRIBUTION) process.env.OPENLEX_DISTRIBUTION = DISTRIBUTION_FOUND.file
if (DISTRIBUTION_FOUND.file) console.log(`[distribution] ${DISTRIBUTION_FOUND.file} (${DISTRIBUTION_FOUND.from})`)
const LICENSE_SERVER = serverOf(DISTRIBUTION)

let supervisor = null
let mainWindow = null
let backendUrl = DEV_BACKEND || null // the old desktop server: null unless switched on (main/legacy.js)
let booted = false // the window may be reopened (macOS activate) once boot is done

// --- License -----------------------------------------------------------------

function readLicense() {
  if (!fs.existsSync(PATHS.license)) {
    if (isDev) return { dev: true, account_id: 'dev', email: 'dev@local', tier: 'solo', entitlements: [], language_pref: 'auto' }
    return null
  }
  try {
    const signed = JSON.parse(fs.readFileSync(PATHS.license, 'utf8'))
    if (!verifyLicense(signed)) {
      console.warn('[license] signature INVALID — refusing to use license')
      return null
    }
    if (signed.payload?.valid_until) {
      const validUntil = new Date(signed.payload.valid_until).getTime()
      const grace = (signed.payload.offline_grace_days || 0) * 24 * 3600 * 1000
      if (Date.now() > validUntil + grace) {
        console.warn('[license] expired beyond grace period')
        return null
      }
    }
    return signed.payload
  } catch (err) {
    console.error('[license] parse error:', err)
    return null
  }
}

function verifyLicense(signed) {
  const pubKeyPath = path.join(PATHS.resources, 'public_key.pem')
  if (!fs.existsSync(pubKeyPath)) {
    console.warn('[license] No embedded public key — skipping verification (dev only).')
    return true
  }
  try {
    const publicKey = crypto.createPublicKey(fs.readFileSync(pubKeyPath))
    const canonical = JSON.stringify(signed.payload)
    return crypto.verify(null, Buffer.from(canonical), publicKey, Buffer.from(signed.signature, 'base64'))
  } catch (err) {
    console.error('[license] verify error:', err)
    return false
  }
}

// --- Optional token activation ----------------------------------------------
//
// Three boot states:
//   1. Valid license.json on disk      → boot normally
//   2. token.txt but no license.json   → fetch license from server, write, boot
//   3. Neither                         → community mode (no account, no sign-in)
//
// A distribution's account page mints `lv_live_…` tokens. Pasting one in
// Settings → License calls /api/app/license for the signed envelope, writes
// license.json and relaunches. It is only needed for the distributor's model
// / pack downloads and updates; nothing in the App is gated on it.

// Licence-shaped identity for community mode. Pack sync, licence polling and
// token downloads are skipped; models are the user's own (API key, local
// GGUF, llama-server / Ollama).
const COMMUNITY_LICENSE = Object.freeze({ account_id: null, email: null, tier: 'community', entitlements: [], community: true })

const TOKEN_PATTERN = /^lv_live_[0-9a-f]{40}$/i

const { deviceFingerprint, deviceLabel } = require('./device-fingerprint')

async function fetchLicenseFromServer(token) {
  const url = new URL('/api/app/license', LICENSE_SERVER)
  const fetcher = url.protocol === 'https:' ? require('https') : require('http')
  // Device fingerprint + label go in headers — server binds the token to
  // this machine on first call, refuses if cap reached on subsequent first
  // calls from a different machine. Headers are ASCII-safe by construction.
  const devId = deviceFingerprint()
  const devLabel = deviceLabel()
  return new Promise((resolve, reject) => {
    const req = fetcher.get(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'X-LexVault-Device-Id': devId,
        'X-LexVault-Device-Label': devLabel,
      },
    }, res => {
      let chunks = ''
      res.on('data', c => chunks += c)
      res.on('end', () => {
        if (res.statusCode === 403) {
          // 403 can mean device_cap_reached (NEW device hit a full slot) OR
          // device_revoked (this machine was deauthorized from the user's
          // account). The caller surfaces them with different UI: cap →
          // "manage your devices", revoked → "this machine was unauthorized,
          // re-paste your token to reactivate."
          try {
            const body = JSON.parse(chunks)
            const err = new Error(body.message || body.error || 'license refused')
            err.code = body.error || 'license_forbidden'
            err.bound_devices = body.bound_devices || []
            return reject(err)
          } catch {
            return reject(new Error(`license-server 403: ${chunks.slice(0, 200)}`))
          }
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`license-server ${res.statusCode}: ${chunks.slice(0, 200)}`))
        }
        try { resolve(JSON.parse(chunks)) }
        catch (e) { reject(new Error(`malformed license response: ${e.message}`)) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15_000, () => { req.destroy(new Error('license-server timeout')) })
  })
}

async function activateToken(token) {
  if (!LICENSE_SERVER) return { ok: false, error: 'This build has no licence server; OpenLex works without an account.' }
  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, error: 'Invalid token format. Expected lv_live_ followed by 40 hex characters.' }
  }
  // Persist token first so retries don't have to paste again
  fs.writeFileSync(PATHS.token, token, { mode: 0o600 })
  try {
    const signed = await fetchLicenseFromServer(token)
    if (!signed || !signed.payload || !signed.signature) {
      return { ok: false, error: 'Server returned an unsigned license. Contact support.' }
    }
    fs.writeFileSync(PATHS.license, JSON.stringify(signed, null, 2), { mode: 0o600 })
    if (!verifyLicense(signed)) {
      return { ok: false, error: 'License signature invalid. The App binary may be tampered with.' }
    }
    return { ok: true, license: signed.payload }
  } catch (err) {
    // Device cap: pass the structured error through so the renderer can
    // show a "manage your devices" UI with the bound list. Also remove
    // the persisted token — it's not ours to keep until activation succeeds.
    if (err.code === 'device_cap_reached') {
      try { fs.unlinkSync(PATHS.token) } catch {}
      return {
        ok: false,
        error: err.message,
        code: 'device_cap_reached',
        bound_devices: err.bound_devices,
        manage_url: DISTRIBUTION.accountUrl || (LICENSE_SERVER ? LICENSE_SERVER + '/buy#devices' : null),
      }
    }
    return { ok: false, error: err.message || String(err) }
  }
}

async function obtainLicense() {
  // State 1 — valid license.json
  const fromDisk = readLicense()
  if (fromDisk) return fromDisk

  // State 2 — token but no/expired license: refresh from server
  if (fs.existsSync(PATHS.token)) {
    try {
      const token = fs.readFileSync(PATHS.token, 'utf8').trim()
      console.log('[boot] license missing/expired, refreshing from server with stored token')
      const signed = await fetchLicenseFromServer(token)
      fs.writeFileSync(PATHS.license, JSON.stringify(signed, null, 2), { mode: 0o600 })
      if (verifyLicense(signed)) return signed.payload
      console.warn('[boot] refreshed license has invalid signature')
    } catch (err) {
      console.warn('[boot] license refresh failed:', err.message)
      // Fall through to community mode; Settings → License can re-activate
    }
  }

  // State 3 — no license, no token: community mode, no sign-in
  console.log('[boot] no license — community mode')
  return COMMUNITY_LICENSE
}

// --- Hub: offline link with the Word plugin ----------------------------------
// See hub-client.js. Events from Word are forwarded to the renderer as
// 'lexvault:hub-event'; 'open-in-app' also brings the window forward.

let hub = null

function focusMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Engine API paths the renderer may use (via IPC, never directly).
const ENGINE_PATHS = /^\/api\/(status|providers(\/key|\/test|\/notice|\/retention)?|local\/(detect|pull|models|use|remove)|spend(\/cap)?|policy|matters(\/update|\/bind|\/policy)?|library(\/folders(\/remove)?|\/sync)?|mcp(\/servers(\/remove)?|\/reconnect)?|workflows\/(playbooks(\/draft)?|run|documents)|skills(\/get|\/suggest|\/draft|\/delete)?|plans(\/get|\/update|\/approve|\/decide|\/run)?|lists(\/get|\/sources|\/rename|\/delete|\/items(\/update|\/delete)?|\/seed|\/export)?|monitors(\/update|\/delete|\/check|\/alerts(\/read|\/file)?)?|agents|commands|record(\/export|\/verify)?|folder\/save|chat|sessions|session(\/clear)?|permissions(\/answer|\/rules)?|law\/section|activity|sources\/law|sources\/(enable|key)|clauses|grids(\/view|\/update|\/cell|\/delete|\/export|\/run)?|decide(\/config|\/key|\/test)?|web\/login|document\/(read|attachment)|analyse|analysis(\/export)?|config\/(local-memory|agent)|batch(\/estimate|\/start|\/stop|\/resume)?|batches|workspace\/reveal|saved(\/item|\/update|\/delete|\/export)?|investigation(\/export)?|investigate\/presets|diligence(\/export)?|drafts|draft(\/variables|\/fill|\/revise|\/suggest|\/check|\/edit|\/restore|\/export)?|find)(\?.*)?$/

async function startEngine() {
  const { ensureEngine } = require('./engine')
  const { PORTS } = require('../sidecars/supervisor')
  const r = await ensureEngine({
    engineDir: PATHS.engine,
    logPath: path.join(PATHS.userData, 'engine.log'),
    llmProxy: `http://127.0.0.1:${PORTS.llm}`,
    qdrantUrl: `http://127.0.0.1:${PORTS.qdrant}`,
  })
  if (r.error) console.warn('[engine]', r.error)
  return r
}

function startHub() {
  if (hub) return
  const { HubClient } = require('./hub-client')
  hub = new HubClient({
    version: app.getVersion(),
    backend: backendUrl,
    // The Word sidecar shares this llama proxy instead of loading a second model.
    llmProxy: `http://127.0.0.1:${require('../sidecars/supervisor').PORTS.llm}`,
    modelsDir: path.join(PATHS.models, 'llm'),
    onEvent: (ev) => {
      if (ev.type === 'open-in-app') focusMain()
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lexvault:hub-event', ev)
    },
    onStatus: (st) => {
      console.log(`[hub] Word plugin ${st.connected ? 'connected' : 'not connected'}`)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lexvault:hub-status', st)
    },
  })
  hub.start()
  // Share the license public key with the Word sidecar (it searches the
  // App's userData; the bundled copy lives in read-only resources).
  try {
    const src = path.join(PATHS.resources, 'public_key.pem')
    const dst = path.join(PATHS.userData, 'public_key.pem')
    if (fs.existsSync(src) && (!fs.existsSync(dst) || fs.readFileSync(src, 'utf8') !== fs.readFileSync(dst, 'utf8'))) fs.copyFileSync(src, dst)
  } catch (err) { console.warn('[hub] public key share failed:', err.message) }
  ipcMain.handle('lexvault:hubStatus', () => hub.status())

  // Engine API for the renderer's OpenLex pages (same endpoints as the Word
  // pane). JSON calls + SSE streams, restricted to ENGINE_PATHS.
  ipcMain.handle('lexvault:engine', async (_e, { method = 'GET', path: p, body } = {}) => {
    if (!ENGINE_PATHS.test(String(p))) throw new Error(`engine path not allowed: ${p}`)
    return hub.request(method, p, body)
  })
  // Streams the renderer may stop (Stop in the chat): closing the request
  // makes the engine stop the run and keep what it has.
  const streams = new Map()
  ipcMain.handle('lexvault:engineStream', async (e, { path: p, body, streamId } = {}) => {
    if (!ENGINE_PATHS.test(String(p))) throw new Error(`engine path not allowed: ${p}`)
    const ac = new AbortController()
    if (streamId) streams.set(String(streamId), ac)
    try {
      await hub.stream(p, body, (ev) => { if (!e.sender.isDestroyed()) e.sender.send('lexvault:engine-stream', { streamId, ev }) }, ac.signal)
    } finally { if (streamId) streams.delete(String(streamId)) }
    return { ok: true, stopped: ac.signal.aborted }
  })
  ipcMain.handle('lexvault:engineStop', (_e, { streamId } = {}) => {
    const ac = streams.get(String(streamId))
    if (ac) ac.abort()
    return { ok: !!ac }
  })

  // Matters live in the shared OpenLex engine (~/.lexvault/matters.json),
  // the same store the Word plugin uses. The App's active matter decides
  // the data policy for its LLM calls (supervisor _handleViaEngine).
  const engineMatters = () => require(path.join(PATHS.engine, 'matters.js'))
  const notifyWord = () => { if (hub?.connected) hub.send('matter-changed', {}).catch(() => {}) }
  ipcMain.handle('lexvault:matters', (_e, { op, ...args } = {}) => {
    const m = engineMatters()
    switch (op) {
      case 'list': return { matters: m.list({ includeClosed: !!args.all }), active: m.active('app')?.id || null }
      case 'create': { const r = m.create(args); m.setActive('app', r.id); notifyWord(); return r }
      case 'update': { const r = m.update(args.id, args.patch || {}); notifyWord(); return r }
      case 'setActive': m.setActive('app', args.id || null); return { ok: true }
      default: throw new Error(`unknown matters op: ${op}`)
    }
  })
  ipcMain.handle('lexvault:hubSend', async (_e, { type, data } = {}) => {
    // The renderer may only send handoff events, never settings changes.
    if (!['insert-text', 'open-in-app'].includes(type)) throw new Error(`hub event not allowed from renderer: ${type}`)
    const r = await hub.send(type, data || {})
    return { ok: true, id: r?.event?.id || null }
  })
}

// --- Window ------------------------------------------------------------------

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0a07',
    title: 'OpenLex',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : {
      color: '#0f0a07',
      symbolColor: '#d4a574',
      height: 32,
    },
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // The window never reaches the internet by itself and never navigates
  // away from the app (prompt injection: web-guard.js).
  const indexPath = path.join(PATHS.client, 'index.html')
  const appUrl = DEV_FRONTEND || require('url').pathToFileURL(indexPath).href
  require('./web-guard').install(mainWindow, { shell, appUrl: () => appUrl })

  if (DEV_FRONTEND) {
    await mainWindow.loadURL(DEV_FRONTEND + (backendUrl ? `?${require('./legacy').windowSearch(backendUrl)}` : ''))
  } else {
    await mainWindow.loadFile(indexPath, backendUrl ? { search: require('./legacy').windowSearch(backendUrl) } : {})
  }

  if (process.env.LEXVAULT_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'right' })

  // Surface any renderer load failure / runtime error in the main-process log
  // (also tail-able from supervisor.getBackendErrTail in the failure dialog).
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load code=${code} url=${url}: ${desc}`)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const tag = level === 3 ? 'ERROR' : level === 2 ? 'WARN' : 'log'
    console.log(`[renderer:${tag}] ${source}:${line}  ${message}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] render-process-gone:', details)
  })
}

// --- IPC bridge for the renderer --------------------------------------------

function registerIpc(license) {
  ipcMain.handle('lexvault:identity', () => {
    let activation_token = ''
    try {
      if (fs.existsSync(PATHS.token)) activation_token = fs.readFileSync(PATHS.token, 'utf8').trim()
    } catch {}
    return {
      account_id: license.account_id,
      email: license.email,
      tier: license.tier,
      language_pref: license.language_pref || 'auto',
      entitlements: (license.entitlements || []).map(e => e.code).filter(Boolean),
      activation_token,
      community: !!license.community,
      // Token activation is offered only when the build has a licence server.
      canActivate: !!LICENSE_SERVER,
      backendUrl,
      isDev,
    }
  })
  // Only web and mail addresses open outside the app (never file: or app schemes).
  ipcMain.handle('lexvault:openExternal', (_e, url) => {
    if (!require('./web-guard').externalUrlAllowed(url)) throw new Error('only http(s) and mailto addresses can be opened')
    return shell.openExternal(String(url))
  })
  ipcMain.handle('lexvault:reloadEntitlements', async () => readLicense() || COMMUNITY_LICENSE)

  // Opt-in activation from Settings → License. On success the App relaunches
  // so the licence (downloads, pack sync, updates) applies from boot.
  ipcMain.handle('lexvault:activateToken', async (_e, token) => {
    const result = await activateToken(String(token || '').trim())
    if (result.ok) setTimeout(() => { app.relaunch(); app.quit() }, 1500)
    return result
  })

  // Desktop notification helpers. Notifications fire only when (a) the user
  // hasn't disabled them in Settings AND (b) the LexVault window is NOT
  // currently focused — no point pinging while they're already looking at
  // the result. Click on a notification refocuses the window.
  // Native save-file via Electron's dialog. The renderer's
  // `URL.createObjectURL + a.click()` pattern silently fails on
  // contextIsolation=true Electron — no save dialog appears, no file
  // lands. This IPC: renderer hands over the bytes + a suggested
  // filename, main shows showSaveDialog, writes the bytes, returns
  // the path saved (or null if user cancelled).
  ipcMain.handle('lexvault:saveFile', async (_e, { suggestedName, bytes }) => {
    try {
      const { dialog } = require('electron')
      const fname = String(suggestedName || 'openlex-export')
      const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : 'bin'
      const filterMap = {
        docx: { name: 'Word Document', extensions: ['docx'] },
        pdf:  { name: 'PDF Document',  extensions: ['pdf'] },
        csv:  { name: 'CSV',           extensions: ['csv'] },
        md:   { name: 'Markdown',      extensions: ['md'] },
        txt:  { name: 'Text',          extensions: ['txt'] },
        json: { name: 'JSON',          extensions: ['json'] },
      }
      const filters = filterMap[ext] ? [filterMap[ext], { name: 'All', extensions: ['*'] }]
                                     : [{ name: 'All', extensions: ['*'] }]
      const res = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
        defaultPath: path.join(app.getPath('downloads'), fname),
        filters,
      })
      if (res.canceled || !res.filePath) return { ok: false, cancelled: true }
      // bytes arrives as ArrayBuffer over IPC — convert to Buffer
      const buf = Buffer.from(bytes)
      fs.writeFileSync(res.filePath, buf)
      return { ok: true, path: res.filePath }
    } catch (err) {
      console.warn('[saveFile] failed:', err.message)
      return { ok: false, error: err.message }
    }
  })

  // Clipboard via Electron's clipboard module — works regardless of
  // secure-context state or contextIsolation. The Research / Investigate /
  // Workshop pages use navigator.clipboard.writeText first; if that throws
  // they fall back to this. Returns true on success.
  ipcMain.handle('lexvault:copyText', (_e, text) => {
    try {
      const { clipboard } = require('electron')
      clipboard.writeText(String(text || ''))
      return true
    } catch (err) {
      console.warn('[clipboard] writeText failed:', err.message)
      return false
    }
  })

  ipcMain.handle('lexvault:notify', (_e, { title, body, urgency }) => {
    if (_notificationsEnabled === false) return { sent: false, reason: 'disabled' }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
      return { sent: false, reason: 'window-focused' }
    }
    if (!Notification.isSupported()) return { sent: false, reason: 'unsupported' }
    try {
      const n = new Notification({
        title: title || 'OpenLex',
        body: body || '',
        urgency: urgency || 'normal',
        silent: false,
      })
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      })
      n.show()
      return { sent: true }
    } catch (err) {
      return { sent: false, reason: err.message }
    }
  })
  ipcMain.handle('lexvault:setNotificationsEnabled', (_e, on) => {
    _notificationsEnabled = !!on
    try { fs.writeFileSync(PATHS.notificationsPref, _notificationsEnabled ? '1' : '0') } catch {}
    return _notificationsEnabled
  })
  ipcMain.handle('lexvault:getNotificationsEnabled', () => _notificationsEnabled)

  // Main-process helper for firing OS notifications from background events
  // (updater + pack-fetcher). Same gate as the renderer-facing handler:
  // disabled by user, window already focused, or unsupported → silent no-op.
  function _fireSystemNotification(title, body) {
    if (_notificationsEnabled === false) return
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return
    if (!Notification.isSupported()) return
    try {
      const n = new Notification({ title: title || 'OpenLex', body: body || '', silent: false })
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show(); mainWindow.focus()
        }
      })
      n.show()
    } catch {}
  }
  global._lexvaultFireSystemNotification = _fireSystemNotification

  // Recent llama-server output (stderr + stdout). Used by the Dependencies
  // tab to surface real errors when spawn fails — e.g. missing vulkan-1.dll
  // on Windows, no DXGI on a virtualized VM, OOM on a small GPU.
  ipcMain.handle('lexvault:llmState', () => {
    if (!supervisor || typeof supervisor.getLLMState !== 'function') return null
    return supervisor.getLLMState()
  })

  // Test the LLM end-to-end: send a tiny inference. Returns timing +
  // generated text or the actual error. Saves the user from "it just hangs."
  ipcMain.handle('lexvault:testLLM', async () => {
    const t0 = Date.now()
    try {
      const res = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          messages: [{ role: 'user', content: 'Say "hi" and nothing else.' }],
          options: { temperature: 0, num_predict: 8 },
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      })
      const elapsed = Date.now() - t0
      const text = await res.text()
      if (!res.ok) return { ok: false, status: res.status, elapsed, error: text.slice(0, 1000) }
      // Body is NDJSON — last line has the full response we want.
      const lines = text.trim().split('\n')
      const messages = []
      for (const line of lines) {
        try { const j = JSON.parse(line); if (j.message?.content) messages.push(j.message.content) } catch {}
      }
      return { ok: true, elapsed, response: messages.join(''), state: supervisor?.getLLMState?.() }
    } catch (err) {
      return { ok: false, elapsed: Date.now() - t0, error: err.message, state: supervisor?.getLLMState?.() }
    }
  })

  // End-to-end retrieval smoke test. The "could not find verified sources"
  // bug has multiple possible causes (embeddings sidecar dead, Qdrant
  // empty, jurisdiction filter mismatched, reranker dropping everything).
  // This walks the pipeline stage-by-stage and reports the actual response
  // from each so we can pinpoint the failure without guessing.
  ipcMain.handle('lexvault:testRetrieval', async (_e, opts = {}) => {
    const jurisdiction = opts.jurisdiction || 'AT'
    const query = opts.query || 'Verjährung'
    const result = { jurisdiction, query, stages: [] }
    const stage = (name, data) => { result.stages.push({ name, ...data }) }

    // 1. Qdrant point count for this jurisdiction.
    try {
      const t0 = Date.now()
      const r = await fetch(`http://127.0.0.1:16333/collections/legal_chunks_local/points/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { must: [{ key: 'jurisdiction', match: { value: jurisdiction } }] },
          exact: true,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const j = await r.json()
      stage('qdrant_count', {
        ok: r.ok,
        status: r.status,
        elapsed_ms: Date.now() - t0,
        count: j?.result?.count ?? null,
        body: r.ok ? null : JSON.stringify(j).slice(0, 400),
      })
      if (!r.ok || (j?.result?.count ?? 0) === 0) {
        result.diagnosis = `No chunks in local Qdrant for jurisdiction ${jurisdiction}. Pack ingest may have failed despite state file. Try Retry button on the pack.`
        return result
      }
    } catch (err) { stage('qdrant_count', { ok: false, error: err.message }); return result }

    // 2. Embeddings sidecar dense.
    let dense = null
    try {
      const t0 = Date.now()
      const r = await fetch('http://127.0.0.1:11435/api/dense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query }),
        signal: AbortSignal.timeout(30_000),
      })
      const j = await r.json()
      dense = j?.embedding
      stage('embed_dense', {
        ok: r.ok && Array.isArray(dense),
        status: r.status,
        elapsed_ms: Date.now() - t0,
        dim: Array.isArray(dense) ? dense.length : null,
        body: !r.ok || !Array.isArray(dense) ? JSON.stringify(j).slice(0, 400) : null,
      })
      if (!r.ok || !Array.isArray(dense)) {
        result.diagnosis = 'Embeddings sidecar dense endpoint failed — search cannot run without a query vector.'
        return result
      }
    } catch (err) { stage('embed_dense', { ok: false, error: err.message }); return result }

    // 3. Qdrant points/query — does the same shape the backend does.
    try {
      const t0 = Date.now()
      const r = await fetch(`http://127.0.0.1:16333/collections/legal_chunks_local/points/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: dense,
          using: 'dense',
          filter: { must: [{ key: 'jurisdiction', match: { value: jurisdiction } }] },
          limit: 5,
          with_payload: true,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const j = await r.json()
      const points = j?.result?.points || []
      stage('qdrant_query', {
        ok: r.ok && points.length > 0,
        status: r.status,
        elapsed_ms: Date.now() - t0,
        result_count: points.length,
        first_score: points[0]?.score,
        first_source: points[0]?.payload?.source_name,
        body: !r.ok ? JSON.stringify(j).slice(0, 400) : null,
      })
      if (!r.ok) result.diagnosis = `Qdrant points/query returned HTTP ${r.status}.`
      else if (points.length === 0) result.diagnosis = `Qdrant returned 0 results despite ${jurisdiction} having chunks. Likely vector-name mismatch ("dense"/"sparse") or HNSW not built yet.`
      else result.diagnosis = `Pipeline OK — top match: "${(points[0]?.payload?.source_name || '').slice(0, 80)}" (score ${(points[0]?.score || 0).toFixed(3)})`
    } catch (err) { stage('qdrant_query', { ok: false, error: err.message }) }

    return result
  })

  // Read raw hardware.json — exposes detected.gpu.diag so the user can
  // see exactly what each GPU detection source returned. Used by the
  // Dependencies tab "GPU detection" expandable.
  ipcMain.handle('lexvault:hardwareDetail', () => {
    try {
      if (!fs.existsSync(PATHS.hardware)) return null
      return JSON.parse(fs.readFileSync(PATHS.hardware, 'utf8'))
    } catch { return null }
  })

  // User override: write hardware.override.json. Picked up on next launch by
  // detectHardware. Caller passes one of: 'auto', 'nvidia', 'amd', 'intel',
  // 'apple', 'cpu'. 'auto' deletes the override.
  ipcMain.handle('lexvault:setTierOverride', (_e, tier) => {
    if (tier === 'auto' || !tier) {
      if (fs.existsSync(PATHS.hardwareOverride)) fs.unlinkSync(PATHS.hardwareOverride)
      return { ok: true, override: null }
    }
    const valid = ['nvidia', 'amd', 'intel', 'apple', 'cpu']
    if (!valid.includes(tier)) throw new Error('invalid tier ' + tier)
    fs.writeFileSync(PATHS.hardwareOverride, JSON.stringify({ tier }, null, 2))
    return { ok: true, override: tier, restartRequired: true }
  })

  // A local model the distribution recommends (distribution.json
  // "localModel"): offered on the setup page's "On this computer" card,
  // downloaded only on the lawyer's click, with progress. Never at start,
  // and a failed download never stops the App (main/model-setup.js).
  const suggestion = () => localModelSuggestion({
    distribution: DISTRIBUTION,
    licensed: !license.community && !!LICENSE_SERVER,
    token: readToken(PATHS.userData),
    server: LICENSE_SERVER,
    hw: _bootHardware,
    modelDir: path.join(PATHS.models, 'llm'),
  })
  ipcMain.handle('lexvault:localModelSuggestion', () => {
    const s = suggestion()
    if (!s) return null
    const { path: _p, ...pub } = s
    return { ...pub, download: _modelFetchState.state === 'downloading' && _modelFetchState.filename === s.filename ? _modelFetchState : null }
  })
  let _modelDownload = null
  const downloadSuggested = () => {
    if (_modelDownload) return _modelDownload
    const s = suggestion()
    if (!s) return Promise.resolve({ ok: false, error: 'This build recommends no model to download.' })
    const modelDir = path.join(PATHS.models, 'llm')
    _modelFetchState = { state: 'downloading', filename: s.filename, downloaded: 0, total: s.sizeBytes, pct: 0 }
    let lastPct = -1
    _modelDownload = downloadSuggestedModel({
      suggestion: s,
      server: LICENSE_SERVER,
      token: readToken(PATHS.userData),
      modelDir,
      fetchModel,
      onProgress: ({ downloaded, total }) => {
        const pct = total ? Math.floor(downloaded / total * 100) : null
        _modelFetchState = { state: 'downloading', filename: s.filename, downloaded, total, pct }
        if (pct !== lastPct) {
          lastPct = pct
          for (const w of BrowserWindow.getAllWindows()) {
            try { w.webContents.send('lexvault:model-download', { filename: s.filename, downloaded, total, pct }) } catch {}
          }
        }
      },
    }).then((r) => {
      if (r.ok) {
        _bootModelPath = r.path
        _modelFetchState = { state: 'done', filename: s.filename, pct: 100 }
        console.log(`[model] downloaded ${s.filename}`)
      } else {
        _modelFetchState = { state: 'failed', filename: s.filename, error: r.error }
        console.warn(`[model] download of ${s.filename} failed: ${r.error}`)
      }
      return r
    }).finally(() => { _modelDownload = null })
    return _modelDownload
  }
  ipcMain.handle('lexvault:downloadSuggestedModel', () => downloadSuggested())
  // Settings → Dependencies "Download again": the same download, checked
  // against the full SHA-256; the old file is replaced only once the new
  // one is complete and verified.
  ipcMain.handle('lexvault:refetchModel', async () => {
    const r = await downloadSuggested()
    if (!r.ok) throw new Error(r.error)
    return r
  })

  // Manually trigger download + ingest of a single jurisdiction pack.
  // Used by the Dependencies tab "Download" button per entitled jur.
  ipcMain.handle('lexvault:downloadPack', async (_e, code) => {
    const token = fs.existsSync(PATHS.token) ? fs.readFileSync(PATHS.token, 'utf8').trim() : null
    if (!token || !LICENSE_SERVER) throw new Error(LICENSE_SERVER ? 'Pack downloads need an activation token (Settings → License).' : 'This OpenLex build has no download server. Add law packs locally.')
    const pubKeyPath = path.join(PATHS.resources, 'public_key.pem')
    const publicKeyPem = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : null
    return syncPacks({
      license,
      token,
      server: LICENSE_SERVER,
      packsDir: PATHS.packs,
      archiveDir: PATHS.packsArchive,
      stateFile: PATHS.packsState,
      publicKeyPem,
      onlyCode: code,
      emit: evt => {
        console.log('[pack-download]', evt.kind, evt.code || '', evt.pct ?? '')
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lexvault:pack-event', evt)
        }
        if (evt.kind === 'pack-ingest-done') {
          global._lexvaultFireSystemNotification?.(
            `OpenLex — ${evt.code} pack ready`,
            `${(evt.chunk_count || 0).toLocaleString()} legal sections indexed.`)
        } else if (evt.kind === 'pack-error') {
          global._lexvaultFireSystemNotification?.(
            `OpenLex — ${evt.code} pack failed`,
            evt.error || 'Unknown error during pack download.')
        }
      },
    })
  })

  // App + data inventory shown in Settings. App version is what
  // electron-builder stamped into package.json. Qdrant stats come from the
  // local Qdrant sidecar — points_count is the total chunk count, sliced by
  // jurisdiction via scroll if the panel asks for it.
  // Snapshot of every component the App relies on. Polled by Settings →
  // Dependencies. Each subsystem reports its own probes so failures stay
  // localized (one dead sidecar shouldn't 500 the whole status call).
  ipcMain.handle('lexvault:dependencyStatus', async () => {
    const out = {
      app: { version: app.getVersion(), platform: process.platform, arch: process.arch },
      hardware: _bootHardware ? {
        tier: _bootHardware.tier, model: _bootHardware.model,
        modelFilename: _bootHardware.model_filename, modelSizeBytes: _bootHardware.model_size_bytes,
        ctx: _bootHardware.ctx, gpuLayers: _bootHardware.n_gpu_layers,
      } : null,
      model: { ..._modelFetchState, path: _bootModelPath, suggestion: suggestion()?.filename || null },
      embeddings: { reachable: false },
      qdrant: { reachable: false, collectionExists: false, totalChunks: 0 },
      llm: { reachable: false, llmRunning: false },
      backend: { reachable: false, status: null },
      packs: { entitled: [], downloaded: [] },
    }
    // Model file size on disk (in case download is partial or done)
    try {
      if (_bootModelPath) {
        const part = _bootModelPath + '.part'
        if (fs.existsSync(_bootModelPath)) {
          out.model.actualBytes = fs.statSync(_bootModelPath).size
          out.model.installed = true
        } else if (fs.existsSync(part)) {
          out.model.actualBytes = fs.statSync(part).size
          out.model.installed = false
        } else {
          out.model.actualBytes = 0
          out.model.installed = false
        }
      }
    } catch {}

    const probe = (url) => fetch(url, { signal: AbortSignal.timeout(2000) }).then(r => r).catch(() => null)

    const [emb, q, llm, backend] = await Promise.all([
      probe('http://127.0.0.1:11435/'),
      probe('http://127.0.0.1:16333/'),
      probe('http://127.0.0.1:11434/healthz'),
      backendUrl ? probe('http://127.0.0.1:18000/health') : Promise.resolve(null),
    ])
    out.embeddings.reachable = !!(emb && emb.ok)
    out.qdrant.reachable = !!(q && q.ok)
    out.llm.reachable = !!(llm && llm.ok)
    if (out.llm.reachable) {
      try { const j = await llm.json(); out.llm.llmRunning = !!j.llmRunning; out.llm.lastUsedAt = j.lastUsedAt; out.llm.idleMs = j.idleMs } catch {}
    }
    out.backend.off = !backendUrl
    out.backend.reachable = !!backend
    if (backend) {
      out.backend.status = backend.status
      try { out.backend.body = await backend.json() } catch {}
    }
    if (out.qdrant.reachable) {
      const coll = await probe('http://127.0.0.1:16333/collections/legal_chunks_local')
      if (coll && coll.ok) {
        out.qdrant.collectionExists = true
        try { const body = await coll.json(); out.qdrant.totalChunks = body?.result?.points_count || 0 } catch {}
      }
    }
    // Pack inventory: entitled jurisdictions from the license, downloaded
    // from packs.json (written by pack-fetcher after successful ingest).
    try {
      out.packs.entitled = (license?.entitlements || []).map(e => e.code).filter(Boolean)
      if (fs.existsSync(PATHS.packsState)) {
        const st = JSON.parse(fs.readFileSync(PATHS.packsState, 'utf8'))
        out.packs.downloaded = Object.keys(st.packs || {})
        out.packs.installed_meta = st.packs || {}
      }
    } catch {}
    return out
  })

  ipcMain.handle('lexvault:appInfo', async () => {
    const info = {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      qdrant: { reachable: false, collectionExists: false, totalChunks: 0, perJurisdiction: {} },
    }
    try {
      const qdrantUrl = 'http://127.0.0.1:16333'
      const collection = process.env.LEXVAULT_QDRANT_COLLECTION || 'legal_chunks_local'
      // Hit Qdrant root first — distinguishes "Qdrant down" from "collection
      // not yet created" (the normal state on a fresh install with no packs).
      const root = await fetch(qdrantUrl + '/').catch(() => null)
      info.qdrant.reachable = !!(root && root.ok)
      if (info.qdrant.reachable) {
        const collRes = await fetch(`${qdrantUrl}/collections/${collection}`).catch(() => null)
        if (collRes && collRes.ok) {
          const body = await collRes.json().catch(() => null)
          info.qdrant.collectionExists = true
          info.qdrant.totalChunks = body?.result?.points_count || 0
        } else if (collRes && collRes.status === 404) {
          info.qdrant.collectionExists = false
          info.qdrant.totalChunks = 0
        }
      }
    } catch (err) {
      info.qdrant.error = err.message
    }
    return info
  })
}

// --- Boot --------------------------------------------------------------------

async function boot() {
  // Boot-time housekeeping: sweep stale installers from userData/updates/.
  // Pre-0.1.30 builds accumulated every downloaded installer here (~350 MB
  // each). The updater itself sweeps before its next download but that
  // doesn't help users who already have a pileup — do it on every boot too.
  try {
    const updatesDir = path.join(app.getPath('userData'), 'updates')
    if (fs.existsSync(updatesDir)) {
      let freed = 0
      for (const f of fs.readdirSync(updatesDir)) {
        if (/\.(exe|zip|AppImage|dmg|blockmap|part)$/i.test(f)) {
          try {
            const full = path.join(updatesDir, f)
            freed += fs.statSync(full).size
            fs.unlinkSync(full)
          } catch {}
        }
      }
      if (freed > 0) console.log(`[boot] swept ${(freed / 1e9).toFixed(2)} GB of stale update artifacts`)
    }
  } catch (err) { console.warn('[boot] update sweep failed:', err.message) }

  // Sweep stale pack archives. pack-fetcher copies each downloaded
  // .lvpack into userData/packs/archive/ so we can re-ingest without
  // re-downloading. When a new version of the same jurisdiction lands,
  // the OLD version's archive is dead weight (~50-700 MB each). Keep
  // only the most recent .lvpack per jurisdiction.
  try {
    const archiveDir = path.join(app.getPath('userData'), 'packs', 'archive')
    if (fs.existsSync(archiveDir)) {
      const byJur = {}
      for (const f of fs.readdirSync(archiveDir)) {
        const m = /^([a-z-]+)-(\d{4}-\d{2}-\d{2})\.lvpack$/.exec(f)
        if (!m) continue
        const [, jur, ver] = m
        ;(byJur[jur] = byJur[jur] || []).push({ ver, full: path.join(archiveDir, f) })
      }
      let freed = 0
      for (const jur of Object.keys(byJur)) {
        // Sort version desc; delete all but the newest
        byJur[jur].sort((a, b) => b.ver.localeCompare(a.ver))
        for (const stale of byJur[jur].slice(1)) {
          try {
            freed += fs.statSync(stale.full).size
            fs.unlinkSync(stale.full)
            console.log(`[boot] swept stale pack archive ${path.basename(stale.full)}`)
          } catch {}
        }
      }
      if (freed > 0) console.log(`[boot] swept ${(freed / 1e6).toFixed(0)} MB of stale pack archives`)
    }
  } catch (err) { console.warn('[boot] pack archive sweep failed:', err.message) }

  const license = await obtainLicense()
  registerIpc(license)
  // Licence-server traffic (model download, pack sync, revalidation) only
  // with a real licence and a server; community mode never phones home.
  const licensed = !license.community && !!LICENSE_SERVER

  // Custom mini-updater. Polls the license-server feed with the user's bearer
  // token, downloads + SHA512-verifies the artifact, prompts to restart.
  // Bypasses electron-updater's publisher-signature gate (we have no cert).
  // Community builds have no update feed.
  if (app.isPackaged && LICENSE_SERVER && fs.existsSync(PATHS.token)) {
    const feedBaseUrl = LICENSE_SERVER + '/api/app/update'
    updater = new Updater({
      feedBaseUrl,
      getToken: () => {
        try { return fs.readFileSync(PATHS.token, 'utf8').trim() } catch { return null }
      },
      onEvent: (payload) => {
        // Forward to all renderer windows so the in-app update banner can
        // mirror the lifecycle (checking → downloading X% → ready → installing).
        for (const w of BrowserWindow.getAllWindows()) {
          try { w.webContents.send('lexvault:update-event', payload) } catch {}
        }
        if (payload.kind === 'available') {
          global._lexvaultFireSystemNotification?.(
            'OpenLex update available',
            `Version ${payload.remoteVersion} — downloading now.`)
        } else if (payload.kind === 'ready') {
          global._lexvaultFireSystemNotification?.(
            'OpenLex update ready',
            `Version ${payload.remoteVersion} is ready to install.`)
        }
      },
    })
    updater.start()

    ipcMain.handle('lexvault:checkForUpdate', () => updater.check({ silent: true }))
    ipcMain.handle('lexvault:installPendingUpdate', () => updater.installPending())
  }

  if (isDev && DEV_BACKEND) {
    console.log(`[boot] dev mode — using backend at ${DEV_BACKEND}, frontend at ${DEV_FRONTEND}`)
    backendUrl = DEV_BACKEND
    booted = true
    await createWindow()
    await startEngine()
    startHub()
    return
  }

  // Boot, licensed or not:
  //   1. Detect hardware → write hardware.json (only sizes the local model)
  //   2. Use a local model if one is there — never download one here, never
  //      delete one, never stop because there is none: the first-start setup
  //      page lets the lawyer choose (a local model, their own key, help),
  //      and a distribution's recommended model is offered there (on click).
  //   3. Spawn sidecars + engine, wait for ready, then open window
  try {
    emitBoot('detecting-hardware')
    _bootHardware = detectHardware({
      hardwareJson: PATHS.hardware,
      overrideJson: PATHS.hardwareOverride,
      tiersJson: PATHS.tiers,
    })
    console.log(`[boot] tier=${_bootHardware.tier} model=${_bootHardware.model}`)
    emitBoot('hardware-ready', { tier: _bootHardware.tier, gpu: _bootHardware.detected?.gpu?.name })
  } catch (err) {
    // Only the local model needs it; cloud keys and Ollama work without.
    console.warn('[boot] hardware detection failed (the local model may not start):', err.message)
  }
  const modelDir = path.join(PATHS.models, 'llm')
  const settled = settleLocalModel({ modelDir, hw: _bootHardware })
  _bootModelPath = settled.modelPath
  _modelFetchState = settled.state
  console.log(`[boot] ${licensed ? 'licensed' : 'community'} mode — local model: ${_bootModelPath || `none yet (the setup page offers one; or an API key / Ollama, or a .gguf in ${modelDir})`}`)
  emitBoot('model-ready')

  // The old desktop server stays off unless OPENLEX_LEGACY_SERVER=1 (main/legacy.js).
  supervisor = new Supervisor({ paths: PATHS, license, modelPath: _bootModelPath, legacyBackend: require('./legacy').legacyServerWanted() })
  try {
    emitBoot('starting-services')
    await supervisor.start((evt) => {
      console.log('[supervisor]', evt)
      emitBoot('service-stage', evt)
    })
    backendUrl = supervisor.backendUrl
    console.log(backendUrl ? `[boot] all sidecars + the old desktop server up (${backendUrl})` : '[boot] all sidecars up (the old desktop server is off)')
    booted = true
    emitBoot('ready')
    // Brief pause so the user sees the "Ready" state, then transition to main window
    await new Promise(r => setTimeout(r, 600))
    await createWindow()
    await startEngine()
    startHub()
  } catch (err) {
    console.error('[boot] sidecar startup failed:', err)
    // Self-heal: before reporting the failure, try our custom updater.
    // Rescues users from bad releases (like the Windows DLL-PATH bug that
    // blocked 0.1.1) without requiring them to manually reinstall.
    if (app.isPackaged && LICENSE_SERVER && fs.existsSync(PATHS.token)) {
      try {
        const selfHealUpdater = new Updater({
          feedBaseUrl: LICENSE_SERVER ? LICENSE_SERVER + '/api/app/update' : null,
          getToken: () => { try { return fs.readFileSync(PATHS.token, 'utf8').trim() } catch { return null } },
        })
        // Synchronous prompt path: show "checking" first, then awaitable check.
        dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          defaultId: 0,
          message: 'OpenLex — checking for an update',
          detail: 'A startup error occurred. Looking for a fresh build…',
        }).catch(() => {})
        const result = await Promise.race([
          selfHealUpdater.check({ silent: false }),
          new Promise(resolve => setTimeout(() => resolve({ state: 'timeout' }), 90_000)),
        ])
        if (result?.state === 'installing') return
        console.log('[boot] no update available or update flow declined; reporting original error', result)
      } catch (updateErr) {
        console.warn('[boot] self-heal update failed:', updateErr.message)
      }
    }
    // Build an actionable error message. "Timeout waiting for /healthz" on
    // its own is useless — the user can't act on it. Translate to a concrete
    // diagnosis when we can (port in use / binary missing / AV-quarantined /
    // storage write fail / process crashed).
    let actionable = ''
    if (/qdrant|16333/i.test(err.message) && supervisor?.diagnoseQdrant) {
      try {
        const d = await supervisor.diagnoseQdrant()
        const reasons = []
        if (!d.exists) {
          reasons.push(`• The Qdrant binary is missing at:\n    ${d.binary}\n  This usually means the install is incomplete. Reinstall from the link below.`)
        } else if (d.exit && d.exit.code !== null) {
          reasons.push(`• The Qdrant process started and then exited with code ${d.exit.code}${d.exit.signal ? ` (signal ${d.exit.signal})` : ''}.`)
          if (process.platform === 'win32' && (d.exit.code === 1 || d.exit.code === 3221225794)) {
            reasons.push(`• On Windows this often means antivirus / SmartScreen quarantined the binary.\n  Add an exception for:\n    ${d.binary}\n  and the folder ${path.dirname(d.binary)}, then relaunch.`)
          }
        } else if (d.portInUse && d.processAlive === false) {
          reasons.push(`• Port 16333 is being held by another program (not OpenLex).\n  This can be another OpenLex running in the background, or an unrelated tool.\n  Close the other program or restart your machine and try again.`)
        } else if (d.portInUse && d.processAlive === true) {
          reasons.push(`• Qdrant is running but didn't answer /healthz in 30 seconds.\n  This usually means your machine is under heavy load. Wait 30 seconds and relaunch.`)
        } else if (!d.storageWritable) {
          reasons.push(`• OpenLex can't write to its data folder:\n    ${supervisor.paths?.qdrantData}\n  Error: ${d.storageError}\n  This usually means the folder is on a read-only volume or your user account doesn't have write permission.`)
        } else {
          reasons.push(`• Qdrant did not start. Last log lines:\n${(d.logTail || []).slice(-8).map(l => '    ' + l).join('\n') || '    (no output captured)'}`)
        }
        actionable = '\n\nWhat went wrong:\n' + reasons.join('\n\n') + '\n'
      } catch (diagErr) {
        actionable = `\n\n(Diagnostic probe failed: ${diagErr.message})\n`
      }
    }
    const tail = supervisor?.getBackendErrTail?.() || ''
    dialog.showErrorBox('OpenLex — startup failed',
      `Could not start local services.${actionable}\n` +
      (actionable ? '' : `${err.message}\n\n`) +
      (tail && !actionable ? `Last backend log lines:\n${tail}\n\n` : '') +
      `If this keeps happening, reinstall OpenLex${DISTRIBUTION.downloadUrl ? ` from ${DISTRIBUTION.downloadUrl}` : ''} — your subscription, license, and downloaded models will all survive a reinstall.`)
    app.quit()
    return
  }

  // Background pack sync — Qdrant is up, the window is open. We download
  // and ingest entitled jurisdiction packs without blocking the UI. Status
  // events forward to the renderer over an IPC channel so a Settings panel
  // can surface progress.
  if (!licensed) {
    console.log('[boot] community mode — no pack sync, no licence polling')
    return
  }
  ;(async () => {
    try {
      const token = fs.existsSync(PATHS.token) ? fs.readFileSync(PATHS.token, 'utf8').trim() : null
      if (!token) {
        console.warn('[pack-sync] no token on disk — skipping pack sync')
        return
      }
      const pubKeyPath = path.join(PATHS.resources, 'public_key.pem')
      const publicKeyPem = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : null
      console.log(`[pack-sync] starting (entitlements: ${(license.entitlements || []).map(e => e.code).join(', ') || 'none'})`)
      await syncPacks({
        license,
        token,
        server: LICENSE_SERVER,
        packsDir: PATHS.packs,
        archiveDir: PATHS.packsArchive,
        stateFile: PATHS.packsState,
        publicKeyPem,
        emit: evt => {
          // Console + best-effort renderer broadcast
          console.log('[pack-sync]', evt.kind, evt.code || '', evt.pct ?? '')
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('lexvault:pack-event', evt)
          }
        },
      })
    } catch (err) {
      console.error('[pack-sync] fatal:', err)
    }
  })()

  // Recurring delta check. The license-server bumps current_pack_version
  // when a fresh monthly pack is published; the App pings every 6 hours so
  // newly-published versions land within a working day without nagging the
  // server. syncPacks is no-op when versions match (skipped count).
  const PACK_RECHECK_MS = 6 * 60 * 60 * 1000
  setInterval(async () => {
    try {
      const token = fs.existsSync(PATHS.token) ? fs.readFileSync(PATHS.token, 'utf8').trim() : null
      if (!token) return
      const pubKeyPath = path.join(PATHS.resources, 'public_key.pem')
      const publicKeyPem = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : null
      const fresh = readLicense() || license
      await syncPacks({
        license: fresh,
        token,
        server: LICENSE_SERVER,
        packsDir: PATHS.packs,
        archiveDir: PATHS.packsArchive,
        stateFile: PATHS.packsState,
        publicKeyPem,
        emit: evt => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('lexvault:pack-event', evt)
          }
          if (evt.kind === 'pack-ingest-done') {
            global._lexvaultFireSystemNotification?.(
              `OpenLex — ${evt.code} updated`,
              `Refreshed to ${evt.version} (${(evt.chunk_count || 0).toLocaleString()} sections).`)
          }
        },
      })
    } catch (err) {
      console.warn('[pack-sync recurring] failed:', err.message)
    }
  }, PACK_RECHECK_MS)

  // License revalidation — hourly. Without this, a "deauthorize this device"
  // click on the user's account page only takes effect after the local
  // license.json expires (35 valid + 30 grace = up to 65 days). The poll
  // calls /api/app/license; on 403 device_revoked the device tombstone is
  // hit and the App must stop. Network failures are silent — the App keeps
  // running on its current license until the next successful poll.
  const LICENSE_REVALIDATE_MS = 60 * 60 * 1000
  let revokedDialogShown = false
  setInterval(async () => {
    try {
      const token = fs.existsSync(PATHS.token) ? fs.readFileSync(PATHS.token, 'utf8').trim() : null
      if (!token) return
      const fresh = await fetchLicenseFromServer(token)
      if (fresh?.payload && fresh?.signature) {
        try { fs.writeFileSync(PATHS.license, JSON.stringify(fresh), { mode: 0o600 }) } catch {}
      }
    } catch (err) {
      if (err.code === 'device_revoked') {
        if (revokedDialogShown) return
        revokedDialogShown = true
        try { fs.unlinkSync(PATHS.license) } catch {}
        try { fs.unlinkSync(PATHS.token) } catch {}
        dialog.showErrorBox('OpenLex — access revoked',
          'This machine was deauthorized from your account. ' +
          'OpenLex will close now and start in community mode next time; ' +
          'paste your activation token in Settings → License to reactivate.')
        app.quit()
      } else if (err.code === 'device_cap_reached') {
        // A different device claimed our slot. Same outcome.
        if (revokedDialogShown) return
        revokedDialogShown = true
        try { fs.unlinkSync(PATHS.license) } catch {}
        dialog.showErrorBox('OpenLex — slot taken',
          'Another machine activated your token while this App was running. ' +
          'The App will close. Re-activate here to take the slot back ' +
          '(this will deauthorize the other machine).')
        app.quit()
      }
      // Network errors etc: log and keep running on the cached license.
      else console.warn('[license-revalidate]', err.message)
    }
  }, LICENSE_REVALIDATE_MS)
}

// Single-instance lock — second launch focuses the existing window instead
// of spawning another supervisor (which would EADDRINUSE on every port and
// crash with a cryptic "Timeout waiting for /healthz").
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show(); mainWindow.focus()
    }
  })
  app.whenReady().then(boot)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && booted) createWindow()
})

app.on('before-quit', async () => {
  if (hub) hub.stop()
  require('./engine').stopEngine()
  if (supervisor) {
    try { await supervisor.stop() } catch (err) { console.error('[supervisor] stop err:', err) }
  }
})
