#!/usr/bin/env node
/**
 * Smoke tests for the desktop app's packaging.
 *
 *   node scripts/smoke-packaged.js [--dist=dist] [--arch=x64|arm64] [--launch]
 *
 * Checks the unpacked app electron-builder left in dist/ (linux-unpacked,
 * win-unpacked or mac*\/OpenLex.app):
 *   1. the resources are there (UI, engine, Qdrant, llama-server) and the
 *      old desktop server is not;
 *   2. the bundled Qdrant runs on this machine (--version);
 *   3. the bundled engine starts with the packaged Electron's own Node
 *      (ELECTRON_RUN_AS_NODE, exactly as main/engine.js does) and answers
 *      GET /health;
 *   4. with --launch: the whole app starts (needs a display; on Linux CI run
 *      it under xvfb-run) and its engine and Qdrant answer.
 * Everything runs with a throwaway HOME and data folder, offline, no model.
 *
 * smokeEngine() is also used by prepare-resources.js on the staged engine.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const http = require('http')
const { spawn, execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PRODUCT = require('../package.json').productName || 'OpenLex'

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}

function get(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
  })
}

async function waitFor(fn, ms, isDead) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (isDead && isDead()) return null
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

function tmpHome(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `openlex-smoke-${label}-`))
  const env = {
    HOME: dir,
    USERPROFILE: dir,
    APPDATA: path.join(dir, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(dir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    LEXVAULT_DATA_DIR: path.join(dir, 'lexvault'),
    OPENLEX_MONITORS: '0',
  }
  for (const d of [env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.LEXVAULT_DATA_DIR]) fs.mkdirSync(d, { recursive: true })
  return { dir, env }
}

function tail(file, n = 40) {
  try { return fs.readFileSync(file, 'utf8').split('\n').slice(-n).join('\n') } catch { return '(no log)' }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGKILL')
  } catch { try { child.kill('SIGKILL') } catch { /* gone */ } }
}

/** Start the engine in engineDir with `execPath` (Node, or Electron as Node) and ask /health. */
async function smokeEngine({ engineDir, execPath = process.execPath, timeoutMs = 45000 }) {
  const entry = path.join(engineDir, 'src', 'server.js')
  if (!fs.existsSync(entry)) throw new Error(`engine missing at ${entry}`)
  const port = await freePort()
  const { dir, env } = tmpHome('engine')
  const log = path.join(dir, 'engine.log')
  const out = fs.openSync(log, 'a')
  const child = spawn(execPath, [entry], {
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      LEXVAULT_KEEPALIVE: '1',
      LEXVAULT_SIDECAR_PORT: String(port),
      LEXVAULT_ADDIN_ROOT: path.join(engineDir, 'add-in'),
      // Nothing to talk to: the smoke test must not depend on a model.
      LEXVAULT_LLM_URL: 'http://127.0.0.1:9',
      LEXVAULT_QDRANT_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', out, out],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  fs.closeSync(out)
  let exited = null
  child.on('exit', (code, sig) => { exited = { code, sig } })
  const res = await waitFor(async () => {
    const r = await get(`http://127.0.0.1:${port}/health`)
    return r && r.status === 200 ? r : null
  }, timeoutMs, () => exited)
  killTree(child)
  if (!res) {
    throw new Error(`engine did not answer /health on port ${port}${exited ? ` (exited ${exited.code ?? exited.sig})` : ''}. Log:\n${tail(log)}`)
  }
  const body = JSON.parse(res.body)
  if (!body.ok) throw new Error(`engine /health: ${res.body}`)
  console.log(`  engine ${body.sidecar} answered /health (${path.basename(execPath)}, port ${port})`)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Windows may hold the log briefly */ }
  return body
}

const HOST_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'

/** Where electron-builder put the unpacked app (macOS: one folder per arch). */
function findUnpacked(dist, arch = HOST_ARCH) {
  if (process.platform === 'darwin') {
    for (const d of arch === 'arm64' ? ['mac-arm64'] : ['mac', 'mac-x64']) {
      const app = path.join(dist, d, `${PRODUCT}.app`)
      if (fs.existsSync(app)) return { resources: path.join(app, 'Contents', 'Resources'), exe: path.join(app, 'Contents', 'MacOS', PRODUCT) }
    }
  } else if (process.platform === 'win32') {
    const d = path.join(dist, 'win-unpacked')
    if (fs.existsSync(d)) return { resources: path.join(d, 'resources'), exe: path.join(d, `${PRODUCT}.exe`) }
  } else {
    const d = path.join(dist, 'linux-unpacked')
    if (fs.existsSync(d)) return { resources: path.join(d, 'resources'), exe: path.join(d, 'openlex') }
  }
  return null
}

function platformId(arch = HOST_ARCH) {
  const p = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  return `${p}-${arch}`
}

function checkFiles(resources, arch) {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const id = platformId(arch)
  const must = ['app.asar', 'engine/src/server.js', 'engine/package.json', 'engine/node_modules', 'engine/add-in/taskpane.html',
    'engine/skills', 'engine/playbooks', 'client/index.html', `bin/qdrant-${id}${ext}`, `bin/llama-server-${id}${ext}`, 'hardware-tiers.json']
  for (const f of must) {
    if (!fs.existsSync(path.join(resources, f))) throw new Error(`missing in the packaged app: resources/${f}`)
  }
  for (const f of ['server', 'distribution.json', 'engine/distribution.json']) {
    if (fs.existsSync(path.join(resources, f))) throw new Error(`resources/${f} must not be in a community build`)
  }
  console.log(`  resources ok (${must.length} files/folders; no old server, no distribution settings)`)
  return { qdrant: path.join(resources, `bin/qdrant-${id}${ext}`) }
}

function checkQdrant(binary) {
  const out = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 30000, cwd: os.tmpdir() }).trim()
  console.log(`  ${out.split('\n')[0]} runs`)
}

/** Start the whole app; its engine and Qdrant must answer. */
async function smokeLaunch({ exe, timeoutMs = 120000 }) {
  const port = await freePort()
  const { dir, env } = tmpHome('app')
  const log = path.join(dir, 'app.log')
  const out = fs.openSync(log, 'a')
  const args = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []
  const child = spawn(exe, args, {
    env: { ...process.env, ...env, LEXVAULT_SIDECAR_PORT: String(port), ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', out, out],
    detached: process.platform !== 'win32',
  })
  fs.closeSync(out)
  let exited = null
  child.on('exit', (code, sig) => { exited = { code, sig } })
  const ok = await waitFor(async () => {
    const e = await get(`http://127.0.0.1:${port}/health`)
    const q = await get('http://127.0.0.1:16333/healthz')
    return e && e.status === 200 && q && q.status === 200 ? { e, q } : null
  }, timeoutMs, () => exited)
  killTree(child)
  if (!ok) throw new Error(`the app did not come up (engine :${port}/health and Qdrant :16333/healthz)${exited ? `; it exited (${exited.code ?? exited.sig})` : ''}. Log:\n${tail(log, 80)}`)
  console.log(`  app started: engine ${JSON.parse(ok.e.body).sidecar} on :${port}, Qdrant on :16333`)
}

async function main() {
  const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null }
  const dist = path.resolve(ROOT, arg('dist') || 'dist')
  const arch = arg('arch') || HOST_ARCH
  const app = findUnpacked(dist, arch)
  if (!app) throw new Error(`no unpacked app for ${platformId(arch)} in ${dist}`)
  console.log(`Smoke test: ${app.exe}`)
  if (!fs.existsSync(app.exe)) throw new Error(`no executable at ${app.exe}`)
  const { qdrant } = checkFiles(app.resources, arch)
  if (arch !== HOST_ARCH) {
    // A cross-built app (macOS x64 on an Apple Silicon runner): files only.
    console.log(`  (built for ${arch} on ${HOST_ARCH}: not started here)`)
    console.log('PASS (files only)')
    return
  }
  checkQdrant(qdrant)
  await smokeEngine({ engineDir: path.join(app.resources, 'engine'), execPath: app.exe })
  if (process.argv.includes('--launch')) await smokeLaunch({ exe: app.exe })
  console.log('PASS')
}

if (require.main === module) {
  main().then(() => process.exit(0), (err) => { console.error(`FAIL: ${err.message}`); process.exit(1) })
}

module.exports = { smokeEngine, findUnpacked }
