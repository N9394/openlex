#!/usr/bin/env node
/**
 * Stage the engine's ONNX runtime into resources/engine/node_modules, for
 * one target only. Used by prepare-resources.js after the engine's
 * production install (which leaves optional native modules out).
 *
 *   onnxruntime-node         the native runtime (CPU); only bin/napi-v6/<os>/<arch>
 *   onnxruntime-common       its JavaScript API
 *   @huggingface/tokenizers  the tokenizer (pure JavaScript, ~600 KB)
 *
 * The exact versions and their SHA-512 come from sidecar/package-lock.json:
 * each tarball is fetched from the registry, checked against the lockfile
 * integrity, and unpacked here (no npm install, no install scripts).
 *
 * Left out: other platforms' binaries, the install script and sources, and
 * on Windows the DirectML/DirectX files (DirectML.dll, dxcompiler.dll,
 * dxil.dll, ~38 MB): onnxruntime.dll loads DirectML only on demand
 * (delay-load) and the engine runs on the CPU. Windows: the Visual C++
 * runtime DLLs onnxruntime.dll needs are put next to it (app-local, from
 * the build machine's System32) so it loads without the VC++ redistributable.
 *
 * A target the runtime has no binary for (Intel Macs: onnxruntime-node
 * dropped them after 1.23, whose macOS build crashes on exit) gets no
 * runtime, and engine/onnx-runtime.json says why — the app then tells the
 * lawyer the name finder cannot run on this computer, and does not offer it.
 *
 * The CLI tarball (scripts/package-cli.sh) and Homebrew do not get any of
 * this: there the name finder says it needs the desktop app.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')

const PACKAGES = ['onnxruntime-node', 'onnxruntime-common', '@huggingface/tokenizers']
const WIN_DROP = ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll']
const WIN_VCRT = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
// Not needed at run time (install script, TypeScript sources, docs).
const DROP = {
  'onnxruntime-node': ['script', 'lib', 'README.md'],
  'onnxruntime-common': ['lib', 'README.md'],
  '@huggingface/tokenizers': ['types', 'README.md', 'dist/tokenizers.min.cjs', 'dist/tokenizers.min.mjs'],
}

/** The lockfile entry for a package: { version, resolved, integrity }. */
function lockEntry(lock, name) {
  const e = lock.packages?.[`node_modules/${name}`]
  if (!e?.version || !e.resolved || !/^sha512-/.test(e.integrity || '')) throw new Error(`${name}: no version/resolved/sha512 in sidecar/package-lock.json`)
  return e
}

function checkIntegrity(buf, integrity, name) {
  const got = `sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`
  if (got !== integrity) throw new Error(`${name}: tarball does not match the lockfile (${got} ≠ ${integrity})`)
}

/** Unpack an npm tarball (gzip'd ustar, with pax/GNU long names) into dest, dropping the leading "package/". */
function untgz(buf, dest) {
  const tar = zlib.gunzipSync(buf)
  let at = 0
  let longName = null
  const str = (o, n) => tar.toString('utf8', o, o + n).replace(/\0.*$/s, '')
  while (at + 512 <= tar.length) {
    const hdr = at
    const h = tar.subarray(hdr, hdr + 512)
    if (h.every((b) => b === 0)) break
    const size = parseInt(str(hdr + 124, 12).trim() || '0', 8)
    const type = String.fromCharCode(h[156] || 48)
    const body = tar.subarray(hdr + 512, hdr + 512 + size)
    at = hdr + 512 + Math.ceil(size / 512) * 512
    if (type === 'x' || type === 'g') { const m = body.toString('utf8').match(/\d+ path=([^\n]*)\n/); if (m && type === 'x') longName = m[1]; continue }
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/s, ''); continue }
    const prefix = str(hdr + 345, 155)
    let name = longName || (prefix ? `${prefix}/${str(hdr, 100)}` : str(hdr, 100))
    longName = null
    name = name.replace(/^[^/]+\//, '') // "package/…"
    if (!name || name.split('/').includes('..') || path.isAbsolute(name)) continue
    const out = path.join(dest, name)
    if (type === '5') { fs.mkdirSync(out, { recursive: true }); continue }
    if (type !== '0' && type !== '\0' && type !== '7') continue // no links in npm packages
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, body)
  }
}

async function fetchBuf(url) {
  let last
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) { last = err; await new Promise((r) => setTimeout(r, 1500 * (i + 1))) }
  }
  throw new Error(`download failed: ${url}: ${last?.message}`)
}

/** A verified tarball, cached by its integrity (re-runs and the other arch's build skip the download). */
async function cachedTgz(name, e) {
  const dir = path.join(os.tmpdir(), 'openlex-onnx-cache')
  const file = path.join(dir, crypto.createHash('sha256').update(e.integrity).digest('hex') + '.tgz')
  try { const buf = fs.readFileSync(file); checkIntegrity(buf, e.integrity, name); return buf } catch { /* not cached (or broken) */ }
  const buf = await fetchBuf(e.resolved)
  checkIntegrity(buf, e.integrity, name)
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf) } catch { /* cache is optional */ }
  return buf
}

function dirBytes(p) {
  let n = 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? dirBytes(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size
  return n
}

/**
 * @param {object} o
 *   engineDir   resources/engine (with node_modules from the production install)
 *   lockFile    sidecar/package-lock.json
 *   target      { os: 'darwin'|'win32'|'linux', arch: 'arm64'|'x64' }
 *   fetchTgz    tests: (name, entry) → Buffer
 * @returns { version, bytes, binary }
 */
async function stageOnnx({ engineDir, lockFile, target, fetchTgz, vcrtDir, log = console.log }) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
  const nm = path.join(engineDir, 'node_modules')
  const get = fetchTgz || cachedTgz
  for (const name of PACKAGES) {
    const e = lockEntry(lock, name)
    const buf = await get(name, e)
    checkIntegrity(buf, e.integrity, name)
    const dest = path.join(nm, ...name.split('/'))
    fs.rmSync(dest, { recursive: true, force: true })
    untgz(buf, dest)
    for (const d of DROP[name] || []) fs.rmSync(path.join(dest, d), { recursive: true, force: true })
  }
  // One platform's binary only.
  const napi = path.join(nm, 'onnxruntime-node', 'bin', 'napi-v6')
  const keep = path.join(napi, target.os, target.arch)
  const marker = path.join(engineDir, 'onnx-runtime.json')
  fs.rmSync(marker, { force: true })
  if (!fs.existsSync(path.join(keep, 'onnxruntime_binding.node'))) {
    for (const name of PACKAGES) fs.rmSync(path.join(nm, ...name.split('/')), { recursive: true, force: true })
    const why = target.os === 'darwin' && target.arch === 'x64'
      ? 'The ONNX runtime is not available for Intel Macs.'
      : `The ONNX runtime is not available for ${target.os}-${target.arch}.`
    fs.writeFileSync(marker, JSON.stringify({ bundled: false, unsupported: why, version: lockEntry(lock, 'onnxruntime-node').version }, null, 2) + '\n')
    log(`  no onnxruntime-node ${lockEntry(lock, 'onnxruntime-node').version} binary for ${target.os}-${target.arch}: not bundled (${path.basename(marker)} says why)`)
    return { version: null, bytes: 0, binary: null, unsupported: why }
  }
  for (const o of fs.readdirSync(napi)) {
    if (o !== target.os) { fs.rmSync(path.join(napi, o), { recursive: true, force: true }); continue }
    for (const a of fs.readdirSync(path.join(napi, o))) if (a !== target.arch) fs.rmSync(path.join(napi, o, a), { recursive: true, force: true })
  }
  // macOS: the package carries libonnxruntime.1.dylib (what the binding
  // loads, @rpath) and a byte-identical versioned copy; keep one.
  if (target.os === 'darwin' && fs.existsSync(path.join(keep, 'libonnxruntime.1.dylib'))) {
    for (const f of fs.readdirSync(keep)) if (/^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(f)) fs.rmSync(path.join(keep, f))
  }
  if (target.os === 'win32') {
    for (const f of WIN_DROP) fs.rmSync(path.join(keep, f), { force: true })
    const src = vcrtDir || (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : null)
    const copied = []
    for (const f of WIN_VCRT) {
      const from = src && path.join(src, f)
      if (from && fs.existsSync(from)) { fs.copyFileSync(from, path.join(keep, f)); copied.push(f) }
    }
    if (copied.length < WIN_VCRT.length) log(`  note: Visual C++ runtime not bundled (${WIN_VCRT.filter((f) => !copied.includes(f)).join(', ')} not found${src ? ` in ${src}` : ': not building on Windows'}); the name finder then needs the VC++ redistributable`)
  }
  const bytes = PACKAGES.reduce((n, name) => n + dirBytes(path.join(nm, ...name.split('/'))), 0)
  const version = lockEntry(lock, 'onnxruntime-node').version
  log(`  onnxruntime-node ${version} (${target.os}-${target.arch}) + tokenizers ${lockEntry(lock, '@huggingface/tokenizers').version}: ${(bytes / 1e6).toFixed(1)} MB`)
  return { version, bytes, binary: path.join(keep, 'onnxruntime_binding.node') }
}

module.exports = { stageOnnx, untgz, PACKAGES, WIN_DROP, WIN_VCRT }
