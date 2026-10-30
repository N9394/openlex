#!/usr/bin/env node
/**
 * Download platform-specific sidecar binaries into resources/bin/.
 *
 *   - Qdrant (single-binary release from github.com/qdrant/qdrant)
 *   - llama-server (prebuilt from github.com/ggml-org/llama.cpp/releases)
 *   - optional, Windows: the CUDA build of llama-server + CUDA runtime
 *     (OPENLEX_BUNDLE_CUDA=1; ~600 MB, so not in the public installers —
 *     NVIDIA cards use the Vulkan build instead)
 *
 * Every archive comes from the project's own GitHub release and is checked
 * against the sha256 pinned below before it is unpacked.
 *
 * Output naming matches supervisor.js's resolveBinary():
 *     {name}-{platform}-{arch}{ext}
 *
 *   node scripts/fetch-sidecars.js [--target=darwin-arm64 ...] [--force]
 *
 * Without --target: the host platform. Idempotent: skips binaries that are
 * already there (--force re-downloads).
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const BIN = path.join(ROOT, 'resources', 'bin')
fs.mkdirSync(BIN, { recursive: true })

const FORCE = process.argv.includes('--force')

// Pin versions for reproducible builds. Bump deliberately.
const QDRANT_VERSION = 'v1.17.1'
const LLAMA_BUILD = 'b9030'

const QDRANT_TARGETS = {
  'darwin-arm64': `https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-aarch64-apple-darwin.tar.gz`,
  'darwin-x64':   `https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-apple-darwin.tar.gz`,
  'linux-x64':    `https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-musl.tar.gz`,
  'linux-arm64':  `https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-aarch64-unknown-linux-musl.tar.gz`,
  'win32-x64':    `https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-pc-windows-msvc.zip`,
}

// llama.cpp Windows: Vulkan build covers AMD + Intel iGPU + NVIDIA fallback.
// CPU-only is the deepest fallback. On Windows-x64 we ALSO ship a CUDA build —
// supervisor.js prefers it on NVIDIA hardware where it's ~2-3x faster than
// Vulkan on the same card (proper cuBLAS kernels + tensor-core ops).
const LLAMA_TARGETS = {
  'darwin-arm64': `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`,
  'darwin-x64':   `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-macos-x64.tar.gz`,
  'win32-x64':    `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`,
  'linux-x64':    `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`,
  'linux-arm64':  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-arm64.tar.gz`,
}

// Optional NVIDIA-specific build. supervisor.js picks this when
// hardware.json.detected.gpu.type === 'cuda'. Falls back to LLAMA_TARGETS if
// the CUDA exe fails to spawn (driver mismatch etc.). Windows-only — Linux
// users with NVIDIA still go through Vulkan in MVP.
// Use CUDA 12.4 over 13.1 — 12.4 requires NVIDIA driver ≥ 551.78 (released
// Feb 2024) vs 13.1 needing ≥ 580 (Aug 2025). 12.4 catches more end-user
// systems still on lagging driver releases at zero performance cost.
const LLAMA_CUDA_TARGETS = {
  'win32-x64': `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`,
}
// CUDA runtime DLLs (cudart64_12.dll, cublas64_12.dll, cublasLt64_12.dll).
// Distributed separately from the llama.cpp archive so users on older drivers
// can swap to a matching cuda toolkit. We bundle them next to the libs dir.
const CUDART_TARGETS = {
  'win32-x64': `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/cudart-llama-bin-win-cuda-12.4-x64.zip`,
}

// sha256 of every archive above (GitHub's asset digests for these tags).
// Bump together with QDRANT_VERSION / LLAMA_BUILD.
const SHA256 = {
  [`qdrant-${QDRANT_VERSION}-darwin-arm64`]: 'adf795d7c2ac9d93677517fd58b119e9bb5bc8fc5143ac9b581a6f8264def8da',
  [`qdrant-${QDRANT_VERSION}-darwin-x64`]:   'd7308c504afa58eb4aa2bd0c655252c324aea04891ac079b6b8764b33fa7dc15',
  [`qdrant-${QDRANT_VERSION}-linux-x64`]:    '4028d5e753de53bda82fa487df25353f668e785c3dfff66dfa636e2203a82b3a',
  [`qdrant-${QDRANT_VERSION}-linux-arm64`]:  '9347a4db839f53fe123cc775bd87e4dd02f6c2750783bea02ea4fcae9c923164',
  [`qdrant-${QDRANT_VERSION}-win32-x64`]:    'fe28df5993a9f9830b1e7290e2e341becf3c91366941b73b4322a05e4f91585c',
  [`llama-${LLAMA_BUILD}-darwin-arm64`]:     '9b5e7dc81dcc455e90644fbafb3c3b2162d35b98a6f5eec5a2f501e4f89f3591',
  [`llama-${LLAMA_BUILD}-darwin-x64`]:       '659c525ee24a7cc0cdebad936c47c27e93496717dd022c165867f7f3f912cb42',
  [`llama-${LLAMA_BUILD}-linux-x64`]:        '172e6b0cf7a170fab7605d98ef8dbfdb877fa84b181c5010a20eb8c98055f6d8',
  [`llama-${LLAMA_BUILD}-linux-arm64`]:      '9fb3c077f2e00afa8f081a59905132586f90a1e09c8af0ca62234bfc4354f104',
  [`llama-${LLAMA_BUILD}-win32-x64`]:        'bc0e9387044c5420202ef282227b21833e246ef879024c611eb2957f818fcbc2',
  [`llama-cuda-${LLAMA_BUILD}-win32-x64`]:   '39717ba38e28a0b193e6809857a03dd8e1eb006c3ba00f0876b1f241cebb47ea',
  [`cudart-${LLAMA_BUILD}-win32-x64`]:       '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6',
}

function log(msg) { console.log('[sidecars] ' + msg) }

function downloadFollowing(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, { headers: { 'User-Agent': 'openlex-sidecar-fetch' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return get(new URL(res.headers.location, u).toString())
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        }
        const sink = fs.createWriteStream(dest)
        res.pipe(sink)
        sink.on('finish', () => sink.close(resolve))
        sink.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  })
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

/** Download `url` to `dest` and check it against the pinned sha256 `key`. */
async function downloadVerified(url, dest, key) {
  const want = SHA256[key]
  if (!want) throw new Error(`no pinned sha256 for ${key} — add it to SHA256 in fetch-sidecars.js`)
  log(`download ${key} ← ${url.split('/').slice(-2).join('/')}`)
  await downloadFollowing(url, dest)
  const got = await sha256File(dest)
  if (got !== want) {
    fs.rmSync(dest, { force: true })
    throw new Error(`sha256 mismatch for ${key}: got ${got}, expected ${want}`)
  }
  log(`  sha256 ok ${got}`)
}

/** Unpack a .zip or .tar.gz into dir (Windows: the system's bsdtar reads both). */
function extract(archive, dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  if (process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    execSync(`"${tar}" -xf "${archive}" -C "${dir}"`, { stdio: 'inherit' })
  } else if (archive.endsWith('.zip')) {
    execSync(`unzip -o -q "${archive}" -d "${dir}"`, { stdio: 'inherit' })
  } else {
    execSync(`tar xzf "${archive}" -C "${dir}"`, { stdio: 'inherit' })
  }
}

function isWin(target) { return target.startsWith('win32') }
function archiveExt(url) { return url.endsWith('.zip') ? '.zip' : '.tar.gz' }

async function fetchQdrant(target, url) {
  const ext = isWin(target) ? '.exe' : ''
  const destBin = path.join(BIN, `qdrant-${target}${ext}`)
  if (fs.existsSync(destBin) && !FORCE) {
    log(`skip ${path.basename(destBin)} (exists)`)
    return
  }
  const tmpArchive = destBin + archiveExt(url)
  await downloadVerified(url, tmpArchive, `qdrant-${QDRANT_VERSION}-${target}`)
  const tmpDir = path.join(BIN, `_qdrant-${target}-extract`)
  extract(tmpArchive, tmpDir)
  const found = findFile(tmpDir, isWin(target) ? 'qdrant.exe' : 'qdrant')
  if (!found) throw new Error(`qdrant binary not found in ${url}`)
  fs.copyFileSync(found, destBin)
  if (!isWin(target)) fs.chmodSync(destBin, 0o755)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.unlinkSync(tmpArchive)
}

async function fetchLlama(target, url) {
  const ext = isWin(target) ? '.exe' : ''
  const destBin = path.join(BIN, `llama-server-${target}${ext}`)
  if (fs.existsSync(destBin) && !FORCE) {
    log(`skip llama-server-${target} (exists)`)
    return
  }
  const tmpArchive = destBin + archiveExt(url)
  await downloadVerified(url, tmpArchive, `llama-${LLAMA_BUILD}-${target}`)
  const tmpDir = path.join(BIN, `_llama-${target}-extract`)
  extract(tmpArchive, tmpDir)

  const serverName = isWin(target) ? 'llama-server.exe' : 'llama-server'
  const serverPath = findFile(tmpDir, serverName)
  if (!serverPath) throw new Error(`${serverName} not found in ${tmpDir}`)
  fs.copyFileSync(serverPath, destBin)
  if (!isWin(target)) fs.chmodSync(destBin, 0o755)

  // Copy companion native libs/shaders into bin/llama-{target}-libs/.
  // Loaders find them via OS-specific env vars set in supervisor.js.
  // Symlinked .so/.dylib versions (libfoo.so -> libfoo.so.0) are copied as
  // files: copyFileSync follows the link.
  const binDir = path.dirname(serverPath)
  const libsDir = path.join(BIN, `llama-${target}-libs`)
  fs.rmSync(libsDir, { recursive: true, force: true })
  fs.mkdirSync(libsDir, { recursive: true })
  for (const f of fs.readdirSync(binDir)) {
    const lc = f.toLowerCase()
    if (/\.(dylib|metallib|dll)$/.test(lc) || /\.so(\.\d+)*$/.test(lc)) {
      fs.copyFileSync(path.join(binDir, f), path.join(libsDir, f))
    }
  }
  const metalSrc = path.join(binDir, 'ggml-metal.metal')
  if (fs.existsSync(metalSrc)) fs.copyFileSync(metalSrc, path.join(libsDir, 'ggml-metal.metal'))

  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.unlinkSync(tmpArchive)
  log(`  → ${path.basename(destBin)}, libs in ${path.basename(libsDir)}/`)
}

async function fetchLlamaCuda(target, url, cudartUrl) {
  // Windows-only path. The CUDA binary lives next to its own libs dir so the
  // Vulkan libs (which include their own ggml-vulkan.dll etc.) never get
  // confused with the CUDA ones — the DLL loader picks the first matching
  // name on PATH and we don't want cross-runtime contamination.
  if (!isWin(target)) return
  const destBin = path.join(BIN, `llama-server-cuda-${target}.exe`)
  const libsDir = path.join(BIN, `llama-cuda-${target}-libs`)
  if (fs.existsSync(destBin) && fs.existsSync(libsDir) && !FORCE) {
    log(`skip llama-server-cuda-${target} (exists)`)
    return
  }
  const tmpArchive = destBin + '.zip'
  await downloadVerified(url, tmpArchive, `llama-cuda-${LLAMA_BUILD}-${target}`)
  const tmpDir = path.join(BIN, `_llama-cuda-${target}-extract`)
  extract(tmpArchive, tmpDir)
  const serverPath = findFile(tmpDir, 'llama-server.exe')
  if (!serverPath) throw new Error(`llama-server.exe not found in CUDA archive ${tmpDir}`)
  fs.copyFileSync(serverPath, destBin)
  fs.rmSync(libsDir, { recursive: true, force: true })
  fs.mkdirSync(libsDir, { recursive: true })
  const binDir = path.dirname(serverPath)
  for (const f of fs.readdirSync(binDir)) {
    if (f.toLowerCase().endsWith('.dll')) fs.copyFileSync(path.join(binDir, f), path.join(libsDir, f))
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.unlinkSync(tmpArchive)

  // Matching cudart runtime DLLs into the same libs dir. Without these the
  // process exits immediately with "cudart64_12.dll not found".
  const cudartTmp = path.join(BIN, `_cudart-${target}.zip`)
  await downloadVerified(cudartUrl, cudartTmp, `cudart-${LLAMA_BUILD}-${target}`)
  const cudartDir = path.join(BIN, `_cudart-${target}-extract`)
  extract(cudartTmp, cudartDir)
  let cudartCount = 0
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) { walk(p); continue }
      if (f.name.toLowerCase().endsWith('.dll')) {
        fs.copyFileSync(p, path.join(libsDir, f.name))
        cudartCount++
      }
    }
  }
  walk(cudartDir)
  fs.rmSync(cudartDir, { recursive: true, force: true })
  fs.unlinkSync(cudartTmp)
  log(`  → ${path.basename(destBin)}, ${cudartCount} cudart DLLs in ${path.basename(libsDir)}/`)
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(p, name)
      if (found) return found
    } else if (entry.name === name) {
      return p
    }
  }
  return null
}

function hostTarget() {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  return `${platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
}

async function main() {
  let targets = process.argv.filter((a) => a.startsWith('--target=')).map((a) => a.slice('--target='.length))
  if (!targets.length) targets = [hostTarget()]
  const cuda = /^(1|true|yes|on)$/i.test(process.env.OPENLEX_BUNDLE_CUDA || '')

  for (const t of targets) {
    if (!QDRANT_TARGETS[t]) throw new Error(`unknown target ${t} (known: ${Object.keys(QDRANT_TARGETS).join(', ')})`)
    await fetchQdrant(t, QDRANT_TARGETS[t])
    if (LLAMA_TARGETS[t]) await fetchLlama(t, LLAMA_TARGETS[t])
    if (cuda && LLAMA_CUDA_TARGETS[t]) await fetchLlamaCuda(t, LLAMA_CUDA_TARGETS[t], CUDART_TARGETS[t])
  }

  log('done')
}

if (require.main === module) {
  main().catch(err => {
    console.error('[sidecars] fatal:', err.message)
    process.exit(1)
  })
}

module.exports = { SHA256, QDRANT_TARGETS, LLAMA_TARGETS, QDRANT_VERSION, LLAMA_BUILD }
