"use strict"
/**
 * Talking to the local OpenLex engine from a terminal: find it through
 * ~/.lexvault/run/sidecar.json, send JSON requests, read streamed (SSE)
 * events, and start it in the background when it isn't running.
 *
 * Shared by the `openlex` CLI (bin/openlex.js) and the terminal app (tui/).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const http = require('http')
const { spawn, execFile } = require('child_process')

const DATA_DIR = process.env.OPENLEX_DATA_DIR || process.env.LEXVAULT_DATA_DIR || path.join(os.homedir(), '.lexvault')
const REG = path.join(DATA_DIR, 'run', 'sidecar.json')
const LOG_DIR = path.join(DATA_DIR, 'logs')

function engine() {
  let reg
  try { reg = JSON.parse(fs.readFileSync(REG, 'utf8')) } catch {
    throw new Error('OpenLex engine is not running — open Word with the add-in, start the desktop app, or run `openlex serve`.')
  }
  try { process.kill(reg.pid, 0) } catch { throw new Error(`engine registry is stale (pid ${reg.pid} is gone) — start the engine again`) }
  const ca = reg.ca && fs.existsSync(reg.ca) ? fs.readFileSync(reg.ca) : undefined
  return { url: reg.url, ca, version: reg.version }
}

/**
 * One request to the engine. With onEvent the response is read as SSE and
 * every event is handed over as it arrives; `signal` aborts the request.
 */
function request(method, pathname, body, { onEvent, signal } = {}) {
  const { url, ca } = engine()
  const u = new URL(pathname, url)
  const lib = u.protocol === 'https:' ? https : http
  const data = body ? Buffer.from(JSON.stringify(body)) : null
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method,
      ca,
      signal,
      headers: { Accept: onEvent ? 'text/event-stream' : 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
    }, (res) => {
      res.setEncoding('utf8')
      if (onEvent) {
        let buf = ''
        res.on('data', (chunk) => {
          buf += chunk
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i).replace(/^data:\s*/gm, '')
            buf = buf.slice(i + 2)
            try { onEvent(JSON.parse(frame)) } catch { /* keep-alive / partial */ }
          }
        })
        res.on('end', () => resolve(null))
        res.on('error', (err) => (signal?.aborted ? resolve(null) : reject(err)))
        return
      }
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        let json = null
        try { json = raw ? JSON.parse(raw) : null } catch { /* not JSON */ }
        if (res.statusCode >= 400) return reject(Object.assign(new Error(json?.error || `HTTP ${res.statusCode}`), { status: res.statusCode }))
        resolve(json)
      })
    })
    req.on('error', (err) => {
      if (signal?.aborted) return resolve(null)
      reject(Object.assign(new Error(`cannot reach the engine at ${url}: ${err.message}`), { code: err.code }))
    })
    if (data) req.write(data)
    req.end()
  })
}

/** True when the registry points at a live engine that answers /health. */
async function engineUp() {
  try { engine() } catch { return false }
  try { await request('GET', '/health'); return true } catch { return false }
}

/**
 * Make sure an engine is running: if not, start `openlex serve` detached in
 * the background (output to logs/engine.log) and wait for it to come up.
 * Resolves { started } or throws after timeoutMs.
 */
async function ensureEngine({ timeoutMs = 20000, onWaiting } = {}) {
  if (await engineUp()) return { started: false }
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const log = fs.openSync(path.join(LOG_DIR, 'engine.log'), 'a')
  const child = spawn(process.execPath, [path.join(__dirname, 'openlex.js'), 'serve'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
    windowsHide: true,
  })
  child.unref()
  fs.closeSync(log)
  onWaiting?.()
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250))
    if (await engineUp()) return { started: true }
    if (child.exitCode !== null) break
  }
  throw new Error(`the engine did not start (details in ${path.join(LOG_DIR, 'engine.log')})`)
}

/** Ask the running engine to shut down (it removes its registry on exit). */
function stopEngine() {
  try { process.kill(JSON.parse(fs.readFileSync(REG, 'utf8')).pid, 'SIGTERM') } catch { /* already gone */ }
}

/** Open a file or folder with the system's default app. */
function openPath(target) {
  return new Promise((resolve, reject) => {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [target]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
        : ['xdg-open', [target]]
    execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()))
  })
}

module.exports = { DATA_DIR, REG, LOG_DIR, engine, request, engineUp, ensureEngine, stopEngine, openPath }
