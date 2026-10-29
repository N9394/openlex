"use strict"
/**
 * License watchdog — THE one outbound call in the sidecar.
 *
 * On boot and every 6h: GET LICENSE_URL with the session token → signed
 * Ed25519 license payload. Verified locally with the embedded public key.
 * Everything else runs offline. Expiry semantics match the launcher:
 * LICENSE_VALIDITY_DAYS=35 + OFFLINE_GRACE_MS=30d (grace counted from
 * expiry for already-downloaded content).
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const crypto = require('crypto')
const { LICENSE_URL, LICENSE_PUBLIC_KEY_PATH, LICENSE_CHECK_INTERVAL_MS, OFFLINE_GRACE_MS, USERDATA_DIRS, DATA_DIR } = require('./config')

const LICENSE_PATH = path.join(DATA_DIR, 'license.json')
const TOKEN_PATH = path.join(DATA_DIR, 'token')
fs.mkdirSync(path.dirname(LICENSE_PATH), { recursive: true })

function loadPublicKey() {
  if (LICENSE_PUBLIC_KEY_PATH && fs.existsSync(LICENSE_PUBLIC_KEY_PATH)) {
    return fs.readFileSync(LICENSE_PUBLIC_KEY_PATH, 'utf8')
  }
  // Shared dirs first (launcher/App store license.json there too), then local copy.
  for (const dir of USERDATA_DIRS) {
    for (const name of ['public_key.pem', 'license.json', 'session.json']) {
      const p = path.join(dir, name)
      if (fs.existsSync(p)) {
        if (name === 'public_key.pem') return fs.readFileSync(p, 'utf8')
        try {
          const s = JSON.parse(fs.readFileSync(p, 'utf8'))
          if (s.publicKeyPem) return s.publicKeyPem
        } catch { /* next */ }
      }
    }
  }
  return null
}

function loadToken() {
  if (fs.existsSync(TOKEN_PATH)) return fs.readFileSync(TOKEN_PATH, 'utf8').trim()
  for (const dir of USERDATA_DIRS) {
    // Desktop App: token.txt (pasted lv_live_ token); launcher: session.json.
    const txt = path.join(dir, 'token.txt')
    if (fs.existsSync(txt)) {
      const t = fs.readFileSync(txt, 'utf8').trim()
      if (t) return t
    }
    const p = path.join(dir, 'session.json')
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')).sessionToken || null } catch { }
    }
  }
  return null
}

/** Cached signed license: our own, else the desktop App's (same account). */
function readCachedLicense() {
  for (const p of [LICENSE_PATH, ...USERDATA_DIRS.map((d) => path.join(d, 'license.json'))]) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (data && data.payload) return data
    } catch { /* next */ }
  }
  return null
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true })
  fs.writeFileSync(TOKEN_PATH, String(token || '').trim(), { mode: 0o600 })
}

function verifySignature(signedLicense, publicKeyPem) {
  if (!publicKeyPem) {
    console.warn('[license] no public key embedded — signature NOT verified (dev mode)')
    return true
  }
  try {
    const key = crypto.createPublicKey(publicKeyPem)
    return crypto.verify(null, Buffer.from(JSON.stringify(signedLicense.payload)), key, Buffer.from(signedLicense.signature, 'base64'))
  } catch (err) {
    console.error('[license] verify failed:', err.message)
    return false
  }
}

function phoneHome(token) {
  return new Promise((resolve, reject) => {
    if (!LICENSE_URL) return reject(new Error('community build: no licence server configured'))
    const u = new URL(LICENSE_URL)
    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OpenLex-Engine' },
        timeout: 20000 },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)) } catch { reject(new Error('bad license response')) }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('license check timeout')))
    req.on('error', reject)
    req.end()
  })
}

class LicenseWatchdog {
  constructor() {
    this.state = { status: 'unknown', expiresAt: null, jurisdictions: [], tier: null, checkedAt: null, error: null }
    this._loaded = false
  }

  loadCached() {
    try {
      const data = readCachedLicense()
      if (!data) return
      if (!verifySignature(data, loadPublicKey())) return
      this._loaded = true
      Object.assign(this.state, {
        status: 'cached', expiresAt: data.payload?.expiresAt || null,
        jurisdictions: data.payload?.jurisdictions || [],
        tier: data.payload?.tier || null,
        checkedAt: new Date().toISOString(),
      })
    } catch { /* no cache yet */ }
  }

  async check() {
    if (!LICENSE_URL) {
      // Community build (no distribution.json): nothing to check, nothing locked.
      this.state = { ...this.state, status: 'community', error: null }
      return this.state
    }
    const token = loadToken()
    const key = loadPublicKey()
    if (!token) {
      this.state = { ...this.state, status: 'no_token', error: 'no login token — paste it in Settings to activate' }
      return this.state
    }
    try {
      const signed = await phoneHome(token)
      if (!verifySignature(signed, key)) throw new Error('license signature invalid')
      const payload = signed.payload || signed
      // Server field: valid_until. Watchdog historically read expiresAt —
      // accept both (undefined → Invalid Date → would wrongly report
      // "expired", so default the check to active when unset).
      const expiresAt = payload.expiresAt || payload.valid_until
      const graceOk = !expiresAt || new Date(expiresAt) > new Date(Date.now() - OFFLINE_GRACE_MS)
      // Server payload carries entitlements[] (jurisdiction objects); the
      // watchdog historically exposed a plain jurisdictions[] list.
      const entitlements = Array.isArray(payload.entitlements) ? payload.entitlements : []
      this.state = {
        status: graceOk ? 'active' : 'expired',
        expiresAt: expiresAt || null,
        jurisdictions: payload.jurisdictions || entitlements.map((e) => e.code),
        tier: payload.tier || null,
        checkedAt: new Date().toISOString(),
        error: null,
      }
      fs.writeFileSync(LICENSE_PATH, JSON.stringify(signed, null, 2), { mode: 0o600 })
    } catch (err) {
      // 401/403 from the license server = the token itself is rejected
      // (revoked, not under a paid subscription, or never issued).
      const rejected = /HTTP 40[13]/.test(err.message)
      this.state = {
        ...this.state,
        status: rejected ? 'invalid_token' : 'offline',
        error: err.message,
        checkedAt: new Date().toISOString(),
      }
    }
    return this.state
  }

  start() {
    this.loadCached()
    this.check()
    setInterval(() => this.check(), LICENSE_CHECK_INTERVAL_MS)
  }
}

module.exports = { LicenseWatchdog, loadToken, saveToken }
