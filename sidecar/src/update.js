"use strict"
/**
 * Word plugin auto-updater (SPEC §7.3) — mirrors the App's updater.js but
 * the sidecar IS the checker (no Electron): the update poll rides the same
 * license watchdog tick (the plugin's one phone-home), the payload is a
 * code zip (sidecar/src + add-in) instead of a full installer, and
 * "installing" means swapping files and restarting ourselves.
 *
 *   GET /api/app/update/plugin-{mac,win}  (token) → JSON manifest
 *       { version, filename, sha256, size_bytes, notes }
 *   GET /api/app/update/plugin/{filename}  (token) → payload zip
 *
 * Trust: token-authed channel + sha256 of the payload (same chain of
 * custody as the App's updater — "we issued the artifact, the hash is the
 * signature"). Signed manifests come when code-signing ships.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { execFileSync } = require('child_process')
const { LICENSE_URL, DATA_DIR } = require('./config')
const { loadToken } = require('./license')
const { fetchJson, downloadFile } = require('./downloads')

// Version comes from the payload-shipped marker when present (the updater
// writes it on every apply); falls back to the installer's package.json so
// fresh installs report their build version. This keeps check() honest after
// updates: without it, package.json never changes and the updater offers the
// same version forever (re-apply loop).
const VERSION_MARKER = path.join(__dirname, '.version')
const PLUGIN_VERSION = (() => {
  try {
    if (fs.existsSync(VERSION_MARKER)) {
      const v = fs.readFileSync(VERSION_MARKER, 'utf8').trim()
      if (v) return v
    }
  } catch {}
  return require(path.join(__dirname, '..', 'package.json')).version
})()
const UPDATES_DIR = path.join(DATA_DIR, 'updates')
fs.mkdirSync(UPDATES_DIR, { recursive: true })

function licenseBase() {
  if (!LICENSE_URL) throw new Error('community build: no update server configured')
  const u = new URL(LICENSE_URL)
  return `${u.protocol}//${u.host}`
}

function platformKey() {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux' // unsupported for the plugin — manifest lookup will 400
}

function compareVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (x !== y) return x - y
  }
  return 0
}

function streamSha256(p) {
  return new Promise((resolve, reject) => {
    const hash = require('crypto').createHash('sha256')
    const s = fs.createReadStream(p)
    s.on('data', (d) => hash.update(d))
    s.on('end', () => resolve(hash.digest('hex')))
    s.on('error', reject)
  })
}

/** Extract a zip with bsdtar (ships with macOS and Windows 10+). */
async function extractZip(zipPath, destDir) {
  const tar = process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar'
  fs.mkdirSync(destDir, { recursive: true })
  execFileSync(tar, ['-xf', zipPath, '-C', destDir], { stdio: 'pipe' })
}

/**
 * Apply a downloaded payload: swap sidecar/src + add-in in place. The
 * payload zip contains top-level dirs `sidecar/` and `add-in/` mirroring
 * the install layout. Restart happens after swap via spawn + process.exit.
 */
async function applyUpdate(artifactPath, onEvent) {
  const installRoot = path.resolve(__dirname, '..', '..')
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-update-'))
  onEvent?.({ kind: 'extracting' })
  await extractZip(artifactPath, stage)

  const newSidecar = path.join(stage, 'sidecar', 'src')
  const newAddin = path.join(stage, 'add-in')
  const hasSidecar = fs.existsSync(newSidecar)
  const hasAddin = fs.existsSync(newAddin)
  if (!hasSidecar && !hasAddin) throw new Error('payload zip has no sidecar/ or add-in/ — refusing to apply')

  // Backup current code (rollback on failure).
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-rollback-'))
  const backupSidecar = path.join(backup, 'sidecar-src')
  const backupAddin = path.join(backup, 'add-in')
  if (hasSidecar) {
    fs.cpSync(path.join(installRoot, 'sidecar', 'src'), backupSidecar, { recursive: true })
  }
  if (hasAddin) {
    fs.cpSync(path.join(installRoot, 'add-in'), backupAddin, { recursive: true })
  }

  try {
    onEvent?.({ kind: 'applying' })
    if (hasSidecar) {
      fs.rmSync(path.join(installRoot, 'sidecar', 'src'), { recursive: true, force: true })
      fs.cpSync(newSidecar, path.join(installRoot, 'sidecar', 'src'), { recursive: true })
    }
    if (hasAddin) {
      fs.rmSync(path.join(installRoot, 'add-in'), { recursive: true, force: true })
      fs.cpSync(newAddin, path.join(installRoot, 'add-in'), { recursive: true })
    }
  } catch (err) {
    // Roll back.
    if (hasSidecar && fs.existsSync(backupSidecar)) {
      fs.rmSync(path.join(installRoot, 'sidecar', 'src'), { recursive: true, force: true })
      fs.cpSync(backupSidecar, path.join(installRoot, 'sidecar', 'src'), { recursive: true })
    }
    if (hasAddin && fs.existsSync(backupAddin)) {
      fs.rmSync(path.join(installRoot, 'add-in'), { recursive: true, force: true })
      fs.cpSync(backupAddin, path.join(installRoot, 'add-in'), { recursive: true })
    }
    throw err
  }

    onEvent?.({ kind: 'applied', version: this.pendingVersion })
    try {
      const marker = path.join(installRoot, 'sidecar', 'src', '.version')
      fs.writeFileSync(marker, String(this.pendingVersion || '').trim() || PLUGIN_VERSION)
    } catch {} // marker is best-effort — package.json fallback still exists
  return backup
}

class Updater {
  constructor({ onEvent }) {
    this.onEvent = onEvent || (() => {})
    this.state = { status: 'idle', current: PLUGIN_VERSION, available: null, error: null }
    this.checking = false
    this.applying = false
    this.pendingArtifactPath = null
    this.pendingVersion = null
  }

  emit(payload) {
    try { this.onEvent(payload) } catch {}
  }

  getState() {
    return { ...this.state, artifactPath: this.pendingArtifactPath }
  }

  /**
   * Check for an update. Called on the same tick as the license watchdog.
   * Returns { status: 'up-to-date' | 'available' | 'no-token' | 'error' }.
   */
  async check({ silent = true } = {}) {
    if (this.checking) return { status: 'busy' }
    this.checking = true
    try {
      const token = loadToken()
      if (!token) {
        this.state = { ...this.state, status: 'idle', error: null }
        return { status: 'no-token' }
      }
      const platform = platformKey()
      const manifest = await fetchJson(`${licenseBase()}/api/app/update/plugin-${platform}`, token)
      const remote = manifest.version
      if (!remote) throw new Error('plugin update manifest missing version')
      if (compareVersion(remote, PLUGIN_VERSION) <= 0) {
        this.state = { status: 'up-to-date', current: PLUGIN_VERSION, available: null, error: null }
        return { status: 'up-to-date', current: PLUGIN_VERSION, remote }
      }

      this.state = { status: 'available', current: PLUGIN_VERSION, available: remote, error: null }
      this.emit({ kind: 'available', current: PLUGIN_VERSION, remote, notes: manifest.notes })
      console.log(`[updater] update available: ${PLUGIN_VERSION} → ${remote}`)
      return { status: 'available', current: PLUGIN_VERSION, remote }
    } catch (err) {
      this.state = { ...this.state, status: 'error', error: err.message }
      console.warn(`[updater] check failed: ${err.message}`)
      if (!silent) throw err
      return { status: 'error', error: err.message }
    } finally {
      this.checking = false
    }
  }

  /**
   * Download + verify the available update. Returns artifact path.
   * Reuses downloads.downloadFile (resume via Range, sha256 gate, rename).
   */
   async download() {
     if (this.applying) throw new Error('update already in progress')
     const token = loadToken()
     if (!token) throw new Error('no token — cannot download update')
    const manifest = await fetchJson(`${licenseBase()}/api/app/update/plugin-${platformKey()}`, token)
    const artifactName = manifest.filename
    if (!artifactName || !/\.zip$/.test(artifactName)) throw new Error('manifest has no valid payload filename')

    const artifactPath = path.join(UPDATES_DIR, artifactName)
    // Sweep old payloads so the updates dir doesn't grow unbounded.
    for (const f of fs.readdirSync(UPDATES_DIR)) {
      if (f === artifactName || f === artifactName + '.partial') continue
      if (f.endsWith('.zip')) { try { fs.unlinkSync(path.join(UPDATES_DIR, f)) } catch {} }
    }

    if (fs.existsSync(artifactPath)) {
      // Already downloaded — verify; redownload on mismatch.
      const actual = await streamSha256(artifactPath)
      if (!manifest.sha256 || actual === manifest.sha256) {
        this.pendingArtifactPath = artifactPath
        this.pendingVersion = manifest.version
        return artifactPath
      }
      fs.rmSync(artifactPath, { force: true })
    }

    const { downloadFile } = require('./downloads')
    let lastPct = -1
    await downloadFile(`${licenseBase()}/api/app/update/plugin/${artifactName}`, artifactPath, {
      token,
      expectedSha256: manifest.sha256,
      onProgress: (e) => {
        const pct = e.pct
        if (pct !== lastPct) { lastPct = pct; this.emit({ kind: 'downloading', pct, received: e.received, total: e.total }) }
      },
    })

    this.pendingArtifactPath = artifactPath
    this.pendingVersion = manifest.version
    return artifactPath
  }

  /**
   * Apply the downloaded update and restart the sidecar. Returns the
   * rollback dir so the caller can keep or clean it.
   */
  async apply() {
    if (this.applying) throw new Error('update already in progress')
    if (!this.pendingArtifactPath) throw new Error('no downloaded update to apply')
    this.applying = true
    try {
      // applyUpdate is a module-level function reading this.pendingVersion —
      // bind the Updater instance (dropping the bind broke the marker write).
      const backup = await applyUpdate.bind(this)(this.pendingArtifactPath, this.emit)
      this.state = { status: 'applied', current: this.pendingVersion, available: null, error: null }
      this.emit({ kind: 'applied', version: this.pendingVersion })
      return backup
    } finally {
      this.applying = false
    }
  }

  /** Restart the sidecar process (re-exec same script). */
  restart() {
    const args = process.argv.slice(1)
    // On macOS the sidecar runs as a `launchctl submit` job (started by the
    // Word watchdog); launchd restarts such jobs when the process exits.
    // Remove the job first so OUR detached child is the only survivor —
    // otherwise launchd spawns a duplicate that races it for :18001.
    if (process.platform === 'darwin') {
      try { execFileSync('/bin/launchctl', ['remove', 'com.lexvault.word-sidecar-runner'], { stdio: 'ignore' }) } catch { /* not a submit job */ }
    }
    const installRoot = path.resolve(__dirname, '..', '..')
    if (process.platform === 'win32') {
      // Windows: restart through start-sidecar.vbs — it sets the cwd and
      // wraps node in a retry loop (crash at login/update → auto-restart),
      // and it's detached so the updater's exit can't take it down. A bare
      // detached spawn (stdio 'ignore') left the sidecar dead after the
      // 0.1.44 self-update on the box (2026-08-16) with zero diagnostics.
      const vbs = path.join(installRoot, 'start-sidecar.vbs')
      if (fs.existsSync(vbs)) {
        const w = spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore' })
        w.unref()
        setTimeout(() => process.exit(0), 1500)
        return
      }
    }
    // Fallback (non-Windows / missing VBS): detached re-exec with the child's
    // output captured to a log on Windows so a crash is never silent again.
    const stdio = process.platform === 'win32'
      ? ['ignore', fs.openSync(path.join(installRoot, 'sidecar-restart.log'), 'a'), fs.openSync(path.join(installRoot, 'sidecar-restart.log'), 'a')]
      : 'ignore'
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio,
      env: { ...process.env, LEXVAULT_UPDATED: '1' },
    })
    child.unref()
    // Give the child time to bind :18001 before we release it; exiting
    // immediately races the child's listen() (EADDRINUSE → dead sidecar).
    setTimeout(() => process.exit(0), 1500)
  }
}

module.exports = { Updater, PLUGIN_VERSION, streamSha256, extractZip }
