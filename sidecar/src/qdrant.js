"use strict"
/**
 * Qdrant supervisor-lite — the plugin's standalone law index.
 *
 * If the App is already running (full-version client), its Qdrant on
 * :16333 is reused (probe first). Otherwise the sidecar spawns its own
 * qdrant binary — from the launcher's userData/bin, a bundled binary, or
 * PATH — with a storage dir under ~/.lexvault. Same port, same collection
 * conventions as the App.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { QDRANT_BASE, USERDATA_DIRS } = require('./config')

const STORAGE_DIR = path.join(os.homedir(), '.lexvault', 'qdrant')
const CONFIG_PATH = path.join(STORAGE_DIR, 'qdrant.yaml')

let proc = null
let started = false

function writeConfig() {
  const port = new URL(QDRANT_BASE).port || 16333
  fs.mkdirSync(STORAGE_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, `storage:
  storage_path: ${STORAGE_DIR}/data
  snapshots_path: ${STORAGE_DIR}/snapshots
service:
  host: 127.0.0.1
  http_port: ${port}
  enable_cors: false
`)
}

function findBinary() {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const ext = process.platform === 'win32' ? '.exe' : ''
  const candidates = []
  for (const dir of USERDATA_DIRS) {
    candidates.push(path.join(dir, 'bin', `qdrant-${platform}-${arch}${ext}`))
    candidates.push(path.join(dir, 'bin', `qdrant${ext}`))
  }
  // Dev layout: <repo>/sidecar/bin/qdrant
  candidates.push(path.join(__dirname, '..', 'bin', `qdrant-${platform}-${arch}${ext}`))
  candidates.push(path.join(__dirname, '..', 'bin', `qdrant${ext}`))
  // Installed layout: <app root>/bin/qdrant-<platform>-<arch>
  candidates.push(path.join(__dirname, '..', '..', 'bin', `qdrant-${platform}-${arch}${ext}`))
  candidates.push(path.join(__dirname, '..', '..', 'bin', `qdrant${ext}`))
  candidates.push(`qdrant${ext}`) // PATH
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
    } catch { /* keep looking */ }
  }
  // Last resort: rely on PATH
  return process.platform === 'win32' ? 'qdrant.exe' : 'qdrant'
}

/**
 * Ensure a live Qdrant on QDRANT_BASE. Returns { ok, reason, owned } —
 * owned=true when the sidecar spawned it, false when it attached to an
 * existing instance (the App's).
 */
async function ensureQdrant() {
  // Attach probe first — the App may already be running one.
  try {
    const res = await fetch(QDRANT_BASE + '/readyz', { signal: AbortSignal.timeout(2500) })
    if (res.ok) return { ok: true, owned: false, reason: 'attached to existing Qdrant' }
  } catch { /* none running */ }

  if (started && proc) return { ok: true, owned: true, reason: 'already spawned' }

  writeConfig()
  const bin = findBinary()
  const args = ['--config-path', CONFIG_PATH]
  proc = spawn(bin, args, { stdio: 'ignore', windowsHide: true })
  proc.on('error', (err) => {
    console.error('[qdrant] spawn failed:', err.message)
    proc = null
    started = false
  })
  proc.on('exit', (code) => {
    if (started) console.warn(`[qdrant] exited early with code ${code}`)
    started = false
    proc = null
  })
  started = true

  // Wait for readiness (up to ~20s).
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(QDRANT_BASE + '/readyz', { signal: AbortSignal.timeout(2000) })
      if (res.ok) return { ok: true, owned: true, reason: 'spawned local Qdrant' }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { ok: false, owned: true, reason: 'qdrant started but not ready within 20s' }
}

function isOwned() { return started }

function stop() {
  if (proc) { try { proc.kill('SIGTERM') } catch {} }
}

module.exports = { ensureQdrant, isOwned, stop, STORAGE_DIR }
