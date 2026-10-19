"use strict"
/**
 * API key storage in the OS credential store — never in plain-text config.
 *
 *   macOS   — login Keychain via `security -i` (key fed on stdin, never argv)
 *   Windows — DPAPI (CurrentUser) via PowerShell, blob in DATA_DIR/secrets
 *   Linux   — libsecret via `secret-tool` (key on stdin)
 *
 * Env override wins everywhere: OPENLEX_KEY_<PROVIDER> (e.g.
 * OPENLEX_KEY_ANTHROPIC) — for CI, containers and managed deployments.
 * Keys are cached in memory after first read; never logged, never sent to
 * the pane (the pane only learns hasKey: true/false).
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { DATA_DIR } = require('./config')

const SERVICE = 'openlex'
const cache = new Map()

function envKey(id) {
  return process.env[`OPENLEX_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || null
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${String(stderr || err.message).trim().slice(0, 200)}`))
      resolve(String(stdout))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

// `security -i` reads commands from stdin; quote for its shell-like parser.
const macQuote = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`

function winBlobPath(id) {
  return path.join(DATA_DIR, 'secrets', `${id}.dpapi`)
}

function validId(id) {
  if (!/^[a-z0-9_-]{1,40}$/.test(id)) throw new Error(`invalid provider id: ${id}`)
}

// Multi-line or non-ASCII credentials (a Vertex service-account JSON) are
// stored base64-wrapped: every store here is a single-line text field.
const WRAP = 'b64:'
const wrap = (k) => (/[^\x20-\x7e]/.test(k) ? WRAP + Buffer.from(k, 'utf8').toString('base64') : k)
const unwrap = (k) => (k && k.startsWith(WRAP) ? Buffer.from(k.slice(WRAP.length), 'base64').toString('utf8') : k)

async function setKey(id, key) {
  validId(id)
  if (typeof key !== 'string' || !key.trim() || key.length > 16384) {
    throw new Error('invalid API key')
  }
  key = key.trim()
  const plain = key
  key = wrap(key)
  if (process.platform === 'darwin') {
    await run('/usr/bin/security', ['-i'],
      `add-generic-password -U -s ${macQuote(SERVICE)} -a ${macQuote(id)} -w ${macQuote(key)}\n`)
  } else if (process.platform === 'win32') {
    const ps = '$k = [Console]::In.ReadLine(); ConvertTo-SecureString $k -AsPlainText -Force | ConvertFrom-SecureString'
    const blob = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], key + '\n')
    fs.mkdirSync(path.dirname(winBlobPath(id)), { recursive: true })
    fs.writeFileSync(winBlobPath(id), blob.trim(), { mode: 0o600 })
  } else {
    await run('secret-tool', ['store', `--label=OpenLex ${id}`, 'service', SERVICE, 'account', id], key)
  }
  cache.set(id, plain)
}

async function getKey(id) {
  validId(id)
  const env = envKey(id)
  if (env) return env
  if (cache.has(id)) return cache.get(id)
  let key = null
  try {
    if (process.platform === 'darwin') {
      key = (await run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', id, '-w'])).trim()
    } else if (process.platform === 'win32') {
      if (!fs.existsSync(winBlobPath(id))) return null
      const ps = '$b = [Console]::In.ReadLine(); $s = ConvertTo-SecureString $b; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))'
      key = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], fs.readFileSync(winBlobPath(id), 'utf8') + '\n')).trim()
    } else {
      key = (await run('secret-tool', ['lookup', 'service', SERVICE, 'account', id])).trim()
    }
  } catch {
    key = null // not found / no credential store
  }
  key = unwrap(key)
  if (key) cache.set(id, key)
  return key || null
}

async function deleteKey(id) {
  validId(id)
  cache.delete(id)
  try {
    if (process.platform === 'darwin') await run('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', id])
    else if (process.platform === 'win32') fs.rmSync(winBlobPath(id), { force: true })
    else await run('secret-tool', ['clear', 'service', SERVICE, 'account', id])
  } catch { /* already gone */ }
}

async function hasKey(id) {
  return !!(await getKey(id))
}

module.exports = { setKey, getKey, deleteKey, hasKey, envKey, _wrap: wrap, _unwrap: unwrap }
