#!/usr/bin/env node
/**
 * Stage everything electron-builder packages into resources/, before
 * `electron-builder` runs.
 *
 *   node scripts/prepare-resources.js [--mac|--win|--linux] [--arm64|--x64]
 *
 * Without flags: the host platform and architecture.
 *
 * Inputs (all from this repository):
 *   ../../sidecar          the OpenLex engine: the app's backend
 *   ../../add-in           the Word add-in files the engine serves
 *   ../client              the app's UI (Vite; built here when dist/ is missing)
 *   Qdrant + llama-server  official GitHub releases, sha256-pinned
 *                          (scripts/fetch-sidecars.js)
 *
 * Outputs:
 *   resources/engine/      engine src + playbooks + skills + production node_modules,
 *                          plus the ONNX runtime for this target only
 *                          (scripts/stage-onnx.js: onnxruntime-node + tokenizer,
 *                          for the redaction check's name finder)
 *   resources/client/      the built UI
 *   resources/bin/         qdrant-<os>-<arch>, llama-server-<os>-<arch> (+ libs)
 *
 * Optional, only when a build provides them:
 *   resources/bin/embeddings/   a separate BGE-M3 embeddings service (a
 *                               distribution's own; without it the engine
 *                               embeds on its own)
 *   resources/server/           the old desktop server, with
 *                               OPENLEX_BUNDLE_LEGACY_SERVER=1
 *                               (scripts/stage-legacy-server.js)
 *   resources/public_key.pem    licence verification key (certs/public_key.pem
 *                               or OPENLEX_PUBLIC_KEY_PATH)
 *   resources/distribution.json a distributor's licence/update server
 *                               (OPENLEX_DISTRIBUTION=<path>; never in the repo)
 *
 * No model weights are bundled, and nothing is obfuscated: the shipped
 * JavaScript is the JavaScript in this repository.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const REPO = path.resolve(ROOT, '..', '..')
const DESKTOP = path.resolve(ROOT, '..')
const CLIENT_SRC = path.join(DESKTOP, 'client')
const SIDECAR = path.join(REPO, 'sidecar')

const RES = path.join(ROOT, 'resources')
const RES_CLIENT = path.join(RES, 'client')
const RES_ENGINE = path.join(RES, 'engine')
const RES_SERVER = path.join(RES, 'server')
const RES_BIN = path.join(RES, 'bin')

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim())

/** What we package for: flags > PACKAGE_TARGETS/PACKAGE_ARCH env > host. */
function packageTarget(argv = process.argv, env = process.env) {
  const flag = (f) => argv.includes(f)
  let os = flag('--mac') ? 'darwin' : flag('--win') ? 'win32' : flag('--linux') ? 'linux' : null
  if (!os && env.PACKAGE_TARGETS) os = /win/.test(env.PACKAGE_TARGETS) ? 'win32' : /mac/.test(env.PACKAGE_TARGETS) ? 'darwin' : /linux/.test(env.PACKAGE_TARGETS) ? 'linux' : null
  if (!os) os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  let arch = flag('--arm64') ? 'arm64' : flag('--x64') ? 'x64' : (env.PACKAGE_ARCH || '').toLowerCase() || null
  if (!arch) arch = os === 'win32' ? 'x64' : process.arch === 'arm64' ? 'arm64' : 'x64'
  return { os, arch, id: `${os}-${arch}` }
}

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }) }
function rmRf(p) { fs.rmSync(p, { recursive: true, force: true }) }
function copyDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) {
    if (opts.optional) return false
    throw new Error(`missing source: ${src}`)
  }
  ensure(dst)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (opts.filter && !opts.filter(entry.name)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(s, d, opts)
    else fs.copyFileSync(s, d)
  }
  return true
}

function findFiles(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) findFiles(p, test, out)
    else if (test(e.name, p)) out.push(p)
  }
  return out
}

async function step(label, fn) {
  process.stdout.write(`▸ ${label} … `)
  const t = Date.now()
  try {
    const r = fn()
    if (r && typeof r.then === 'function') await r
    process.stdout.write(`done (${Date.now() - t}ms)\n`)
  } catch (err) {
    process.stdout.write('FAILED\n')
    throw err
  }
}

async function main() {
  const target = packageTarget()
  console.log(`Packaging for ${target.id}`)

  await step('clean resources', () => {
    rmRf(RES_SERVER); rmRf(RES_CLIENT); rmRf(RES_ENGINE)
    rmRf(path.join(RES, 'distribution.json')); rmRf(path.join(RES, 'public_key.pem'))
    ensure(RES); ensure(RES_BIN)
  })

  // 1. The UI.
  await step('build client (vite)', () => {
    if (on(process.env.OPENLEX_REBUILD_CLIENT)) rmRf(path.join(CLIENT_SRC, 'dist'))
    if (fs.existsSync(path.join(CLIENT_SRC, 'dist', 'index.html'))) return
    if (!fs.existsSync(path.join(CLIENT_SRC, 'node_modules'))) {
      execSync('npm ci --no-audit --no-fund', { cwd: CLIENT_SRC, stdio: 'inherit' })
    }
    execSync('npm run build', { cwd: CLIENT_SRC, stdio: 'inherit' })
  })
  await step('stage client', () => {
    copyDir(path.join(CLIENT_SRC, 'dist'), RES_CLIENT)
  })

  // 2. The OpenLex engine: the app's backend (main/engine.js starts it with
  // Electron's own Node). Same files as the CLI tarball — production
  // dependencies, no optional native modules, no install scripts — plus the
  // ONNX runtime for this one platform (next step).
  await step('stage engine', () => {
    copyDir(path.join(SIDECAR, 'src'), path.join(RES_ENGINE, 'src'))
    copyDir(path.join(SIDECAR, 'playbooks'), path.join(RES_ENGINE, 'playbooks'))
    copyDir(path.join(SIDECAR, 'skills'), path.join(RES_ENGINE, 'skills'))
    copyDir(path.join(SIDECAR, 'bin'), path.join(RES_ENGINE, 'bin'), { filter: (n) => n.endsWith('.js') })
    for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(SIDECAR, f), path.join(RES_ENGINE, f))
    copyDir(path.join(REPO, 'add-in'), path.join(RES_ENGINE, 'add-in'), { filter: (n) => n !== 'node_modules' })
    execSync('npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error', { cwd: RES_ENGINE, stdio: 'inherit' })
    rmRf(path.join(RES_ENGINE, 'node_modules', '.bin'))
    const native = findFiles(path.join(RES_ENGINE, 'node_modules'), (n) => n.endsWith('.node'))
    if (native.length) throw new Error(`native module in the engine's node_modules (it runs on Electron's Node, every platform):\n  ${native.join('\n  ')}`)
  })

  // 2b. The ONNX runtime (name finder; later the decision model), for this
  // target only: N-API, so Electron's Node loads it. The CLI tarball has none.
  await step('stage ONNX runtime', () => require('./stage-onnx').stageOnnx({ engineDir: RES_ENGINE, lockFile: path.join(SIDECAR, 'package-lock.json'), target }))

  // A distributor's build: their distribution.json (licence/update server)
  // comes from a private path, never from the repository.
  await step('distribution settings', () => {
    if (!process.env.OPENLEX_DISTRIBUTION) { console.log('  (none: community build, no licence or update server)'); return }
    fs.copyFileSync(process.env.OPENLEX_DISTRIBUTION, path.join(RES_ENGINE, 'distribution.json'))
    fs.copyFileSync(process.env.OPENLEX_DISTRIBUTION, path.join(RES, 'distribution.json'))
  })

  // 3. The old desktop server: only on request (public builds leave it out).
  if (on(process.env.OPENLEX_BUNDLE_LEGACY_SERVER)) {
    await require('./stage-legacy-server').stageLegacyServer({ RES, target, step, copyDir })
  } else {
    console.log('  (old desktop server not bundled; OPENLEX_BUNDLE_LEGACY_SERVER=1 adds it)')
  }

  // 4. Licence verification key (distribution builds only).
  await step('stage public key', () => {
    const key = process.env.OPENLEX_PUBLIC_KEY_PATH || path.join(REPO, 'certs', 'public_key.pem')
    if (fs.existsSync(key)) fs.copyFileSync(key, path.join(RES, 'public_key.pem'))
    else console.log('  (no public_key.pem: community build, no licence check)')
  })

  // 5. Qdrant + llama-server for this target (sha256-pinned downloads).
  await step('fetch sidecars', () => {
    execSync(`node scripts/fetch-sidecars.js --target=${target.id}`, { cwd: ROOT, stdio: 'inherit' })
  })

  // 5b. Drop other platforms' binaries left from earlier builds on this disk.
  await step('prune other platforms\' binaries', () => {
    for (const f of fs.readdirSync(RES_BIN, { withFileTypes: true })) {
      if (f.name === 'embeddings' || f.name === 'README.txt') continue
      if (!f.name.includes(target.id) || f.name.startsWith('_')) {
        rmRf(path.join(RES_BIN, f.name))
        console.log(`  pruned: ${f.name}`)
      }
    }
  })

  // 6. Optional embeddings service (a distribution's own, not in this
  // repository). Without it the supervisor skips it and the engine embeds
  // on its own.
  await step('embeddings service (optional)', () => {
    const embDir = path.join(RES_BIN, 'embeddings')
    if (!fs.existsSync(path.join(embDir, 'package.json'))) {
      rmRf(embDir)
      console.log('  (not bundled: the engine embeds on its own)')
      return
    }
    rmRf(path.join(embDir, 'node_modules'))
    execSync('npm install --omit=dev --omit=optional --no-audit --no-fund', { cwd: embDir, stdio: 'inherit' })
    rmRf(path.join(embDir, 'node_modules', 'onnxruntime-web'))
    const napi = path.join(embDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3')
    for (const os of ['win32', 'darwin', 'linux']) if (os !== target.os) rmRf(path.join(napi, os))
    // sharp (pulled in by @huggingface/transformers) needs its per-platform
    // binary, an optional dependency; install the target's explicitly.
    const sharp = {
      'win32-x64': ['@img/sharp-win32-x64'],
      'darwin-arm64': ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64'],
      'darwin-x64': ['@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64'],
      'linux-x64': ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64'],
    }[target.id]
    if (sharp) {
      try {
        execSync(`npm install --no-save --no-audit --no-fund --force --os=${target.os} --cpu=${target.arch} ${sharp.join(' ')}`, { cwd: embDir, stdio: 'inherit' })
      } catch (err) { console.warn(`  sharp for ${target.id} failed: ${err.message.slice(0, 200)}`) }
    }
  })

  // 7. Smoke test: start the staged engine the way the app does, ask /health.
  await step('smoke-test staged engine', async () => {
    if (on(process.env.SKIP_ENGINE_SMOKE)) { console.log('  (skipped via SKIP_ENGINE_SMOKE=1)'); return }
    await require('./smoke-packaged').smokeEngine({ engineDir: RES_ENGINE })
    // The ONNX runtime runs a one-node model (only where this machine can run the target's binary).
    const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64'
    if (fs.existsSync(path.join(RES_ENGINE, 'onnx-runtime.json'))) console.log('  (no ONNX runtime for this platform)')
    else if (target.os === process.platform && target.arch === hostArch) await require('./smoke-packaged').smokeOnnx({ engineDir: RES_ENGINE })
    else console.log(`  (ONNX runtime for ${target.id} not run on ${process.platform}-${hostArch})`)
  })

  await step('placeholders', () => {
    fs.writeFileSync(path.join(RES_BIN, 'README.txt'),
      'Native binaries (Qdrant, llama-server). No model files are bundled: use your own API key,\na llama-server / Ollama endpoint, or put a .gguf file in the app\'s models/llm folder.\n')
  })

  console.log('\n✓ resources staged at', RES)
}

if (require.main === module) {
  main().catch((err) => { console.error(err.stack || err.message); process.exit(1) })
}

module.exports = { packageTarget }
