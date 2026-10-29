/**
 * Desktop side of the OpenLex hub — the offline link to the Word plugin.
 *
 * Discovery and auth are files in the shared data dir (no network):
 *   ~/.lexvault/run/app.json      written here { pid, version, backend }
 *   ~/.lexvault/run/sidecar.json  written by the Word sidecar { url, pid, ca }
 *   ~/.lexvault/run/hub.token     shared secret (0600), created by whoever starts first
 *
 * When the sidecar is up we hold an SSE subscription to /api/hub/events and
 * reconnect automatically; when it isn't, status() says so and send() fails
 * with a clear message. Protocol: word-plugin sidecar src/hub.js.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')
const crypto = require('crypto')

const DATA_DIR = process.env.LEXVAULT_DATA_DIR || path.join(os.homedir(), '.lexvault')
const RUN_DIR = path.join(DATA_DIR, 'run')
const TOKEN_PATH = path.join(RUN_DIR, 'hub.token')
const APP_REG = path.join(RUN_DIR, 'app.json')
const SIDECAR_REG = path.join(RUN_DIR, 'sidecar.json')

function ensureToken() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 })
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
    if (/^[a-f0-9]{64}$/.test(t)) return t
  } catch { /* create */ }
  const t = crypto.randomBytes(32).toString('hex')
  try { fs.writeFileSync(TOKEN_PATH, t, { mode: 0o600, flag: 'wx' }) } catch { return fs.readFileSync(TOKEN_PATH, 'utf8').trim() }
  return t
}

function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function readSidecar() {
  try {
    const r = JSON.parse(fs.readFileSync(SIDECAR_REG, 'utf8'))
    return pidAlive(r.pid) && r.url ? r : null
  } catch { return null }
}

class HubClient {
  constructor({ version, backend, llmProxy, modelsDir, onEvent, onStatus }) {
    this.version = version
    this.backend = backend
    this.llmProxy = llmProxy || null
    // Where the App keeps its GGUF files: the engine lists them in the model picker.
    this.modelsDir = modelsDir || null
    this.onEvent = onEvent || (() => {})
    this.onStatus = onStatus || (() => {})
    this.connected = false
    this.sidecar = null
    this.req = null
    this.timer = null
    this.stopped = false
  }

  start() {
    ensureToken()
    fs.writeFileSync(APP_REG, JSON.stringify({
      pid: process.pid, version: this.version, backend: this.backend, llmProxy: this.llmProxy, ...(this.modelsDir ? { modelsDir: this.modelsDir } : {}), startedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 })
    this._tick()
    this.timer = setInterval(() => this._tick(), 5000)
    this.timer.unref?.()
  }

  stop() {
    this.stopped = true
    clearInterval(this.timer)
    try { this.req?.destroy() } catch { /* closed */ }
    try {
      const r = JSON.parse(fs.readFileSync(APP_REG, 'utf8'))
      if (r.pid === process.pid) fs.rmSync(APP_REG, { force: true })
    } catch { /* gone */ }
  }

  status() {
    return { connected: this.connected, sidecar: this.connected ? { url: this.sidecar.url, version: this.sidecar.version || null } : null }
  }

  _setConnected(on) {
    if (this.connected === on) return
    this.connected = on
    this.onStatus(this.status())
  }

  _request(method, pathname, body) {
    const sc = this.sidecar || readSidecar()
    if (!sc) return Promise.reject(new Error('Word plugin engine is not running — open the OpenLex pane in Word'))
    const u = new URL(pathname, sc.url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = body ? JSON.stringify(body) : null
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${ensureToken()}`,
        'X-OpenLex-Client': 'app',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      // Reading a long scanned PDF (OCR on this computer) or sizing a whole
      // folder takes longer than an ordinary call.
      timeout: /^\/api\/(document\/read|batch\/(estimate|start)|analysis\/export)\b/.test(pathname) ? 600000 : 10000,
    }
    // Trust the sidecar's own localhost cert (self-signed) — and only it.
    if (u.protocol === 'https:' && sc.ca) { try { opts.ca = fs.readFileSync(sc.ca) } catch { /* fall through to system CAs */ } }
    return new Promise((resolve, reject) => {
      const req = lib.request(u, opts, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try { json = JSON.parse(text) } catch { /* not json */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json)
          else reject(new Error(json?.error || `hub ${pathname} → HTTP ${res.statusCode}`))
        })
      })
      req.on('timeout', () => req.destroy(new Error('hub timeout')))
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }

  /** Any engine API call (JSON). */
  request(method, pathname, body) {
    return this._request(method, pathname, body)
  }

  /**
   * Engine SSE endpoint (POST) → onEvent per event; resolves when the stream
   * ends — or when `signal` aborts it (the engine then stops the run).
   */
  stream(pathname, body, onEvent, signal) {
    const sc = this.sidecar || readSidecar()
    if (!sc) return Promise.reject(new Error('OpenLex engine is not running'))
    const u = new URL(pathname, sc.url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body || {})
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${ensureToken()}`, 'X-OpenLex-Client': 'app' } }
    if (u.protocol === 'https:' && sc.ca) { try { opts.ca = fs.readFileSync(sc.ca) } catch { /* system CAs */ } }
    return new Promise((resolve, reject) => {
      const req = lib.request(u, opts, (res) => {
        res.setEncoding('utf8')
        let buf = ''
        res.on('data', (chunk) => {
          buf += chunk
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i).replace(/^data:\s*/, '')
            buf = buf.slice(i + 2)
            try { onEvent(JSON.parse(frame)) } catch { /* partial */ }
          }
        })
        res.on('end', resolve)
        res.on('close', resolve)
      })
      if (signal) {
        if (signal.aborted) { resolve(); return }
        signal.addEventListener('abort', () => { req.destroy(); resolve() }, { once: true })
      }
      req.on('error', (err) => (signal?.aborted ? resolve() : reject(err)))
      req.end(payload)
    })
  }

  send(type, data) {
    return this._request('POST', '/api/hub/events', { type, data })
  }

  info() {
    return this._request('GET', '/api/hub/info')
  }

  _tick() {
    if (this.stopped || this.req) return
    const sc = readSidecar()
    if (!sc) { this._setConnected(false); return }
    this.sidecar = sc
    const u = new URL('/api/hub/events', sc.url)
    const lib = u.protocol === 'https:' ? https : http
    const opts = { headers: { Authorization: `Bearer ${ensureToken()}`, 'X-OpenLex-Client': 'app', Accept: 'text/event-stream' } }
    if (u.protocol === 'https:' && sc.ca) { try { opts.ca = fs.readFileSync(sc.ca) } catch { /* system CAs */ } }
    const req = lib.get(u, opts, (res) => {
      if (res.statusCode !== 200) { res.resume(); this.req = null; this._setConnected(false); return }
      this._setConnected(true)
      res.setEncoding('utf8')
      let buf = ''
      res.on('data', (chunk) => {
        buf += chunk
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
          if (!data) continue
          try { this.onEvent(JSON.parse(data)) } catch (err) { console.warn('[hub] bad event:', err.message) }
        }
      })
      res.on('end', () => { this.req = null; this._setConnected(false) })
    })
    req.on('error', () => { this.req = null; this._setConnected(false) })
    this.req = req
  }
}

module.exports = { HubClient, ensureToken, readSidecar, DATA_DIR }
