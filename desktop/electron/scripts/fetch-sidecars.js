#!/usr/bin/env node
/**
 * Download platform-specific sidecar binaries into resources/bin/.
 *
 *   - Qdrant (single-binary release from github.com/qdrant/qdrant)
 *   - llama-server (prebuilt from github.com/ggml-org/llama.cpp/releases)
 *
 * Output naming matches supervisor.js's resolveBinary():
 *     {name}-{platform}-{arch}{ext}
 *
 * Where:
 *   platform = darwin | linux | win32
 *   arch     = arm64  | x64
 *
 * Idempotent: skips downloads when a target file already exists. Pass
 * --force to re-download.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
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

function log(msg) { console.log('[sidecars] ' + msg) }

function downloadFollowing(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, { headers: { 'User-Agent': 'lexvault-sidecar-fetch' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return get(res.headers.location)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        }
        const sink = fs.createWriteStream(dest)
        res.pipe(sink)
        sink.on('finish', () => sink.close(resolve))
        sink.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  })
}

async function fetchAndExtract(url, destBin, extractCmd) {
  if (fs.existsSync(destBin) && !FORCE) {
    log(`skip ${path.basename(destBin)} (exists)`)
    return
  }
  const tmpArchive = destBin + '.tar.gz'
  log(`download ${path.basename(destBin)} ← ${url.split('/').slice(-2).join('/')}`)
  await downloadFollowing(url, tmpArchive)
  log(`extract  ${path.basename(tmpArchive)}`)
  execSync(extractCmd.replace('{archive}', tmpArchive), { cwd: BIN, stdio: 'inherit' })
  fs.unlinkSync(tmpArchive)
  fs.chmodSync(destBin, 0o755)
}

function isWin(target) { return target.startsWith('win32') }

async function fetchQdrant(target, url) {
  const ext = isWin(target) ? '.exe' : ''
  const destBin = path.join(BIN, `qdrant-${target}${ext}`)
  if (fs.existsSync(destBin) && !FORCE) {
    log(`skip ${path.basename(destBin)} (exists)`)
    return
  }
  if (isWin(target)) {
    // Qdrant Windows release is a .zip with qdrant.exe at the root.
    const tmpArchive = destBin + '.zip'
    log(`download ${path.basename(destBin)} ← ${url.split('/').slice(-2).join('/')}`)
    await downloadFollowing(url, tmpArchive)
    const tmpDir = path.join(BIN, `_qdrant-${target}-extract`)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    execSync(`unzip -o -q "${tmpArchive}" -d "${tmpDir}"`, { stdio: 'inherit' })
    const exePath = findFile(tmpDir, 'qdrant.exe')
    if (!exePath) throw new Error(`qdrant.exe not found in ${tmpDir}`)
    fs.copyFileSync(exePath, destBin)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.unlinkSync(tmpArchive)
    return
  }
  // Mac / Linux: tar.gz with `qdrant` at the root
  await fetchAndExtract(url, destBin,
    `tar xzf {archive} && mv qdrant ${path.basename(destBin)}`)
}

async function fetchLlama(target, url) {
  const ext = isWin(target) ? '.exe' : ''
  const destBin = path.join(BIN, `llama-server-${target}${ext}`)
  if (fs.existsSync(destBin) && !FORCE) {
    log(`skip llama-server-${target} (exists)`)
    return
  }
  const archiveExt = isWin(target) ? '.zip' : '.tar.gz'
  const tmpArchive = destBin + archiveExt
  log(`download llama-server-${target}`)
  await downloadFollowing(url, tmpArchive)

  const tmpDir = path.join(BIN, `_llama-${target}-extract`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  if (isWin(target)) {
    execSync(`unzip -o -q "${tmpArchive}" -d "${tmpDir}"`, { stdio: 'inherit' })
  } else {
    execSync(`tar xzf "${tmpArchive}" -C "${tmpDir}"`, { stdio: 'inherit' })
  }

  const serverName = isWin(target) ? 'llama-server.exe' : 'llama-server'
  const serverPath = findFile(tmpDir, serverName)
  if (!serverPath) throw new Error(`${serverName} not found in ${tmpDir}`)
  fs.copyFileSync(serverPath, destBin)
  if (!isWin(target)) fs.chmodSync(destBin, 0o755)

  // Copy companion native libs/shaders into bin/llama-{target}-libs/.
  // Loaders find them via OS-specific env vars set in supervisor.js.
  const binDir = path.dirname(serverPath)
  const libsDir = path.join(BIN, `llama-${target}-libs`)
  fs.rmSync(libsDir, { recursive: true, force: true })
  fs.mkdirSync(libsDir, { recursive: true })
  for (const f of fs.readdirSync(binDir)) {
    const lc = f.toLowerCase()
    if (lc.endsWith('.dylib') || lc.endsWith('.metallib') || lc.endsWith('.so') || lc.endsWith('.dll')) {
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
  log(`download llama-server-cuda-${target}`)
  await downloadFollowing(url, tmpArchive)
  const tmpDir = path.join(BIN, `_llama-cuda-${target}-extract`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  execSync(`unzip -o -q "${tmpArchive}" -d "${tmpDir}"`, { stdio: 'inherit' })
  const serverPath = findFile(tmpDir, 'llama-server.exe')
  if (!serverPath) throw new Error(`llama-server.exe not found in CUDA archive ${tmpDir}`)
  fs.copyFileSync(serverPath, destBin)
  fs.rmSync(libsDir, { recursive: true, force: true })
  fs.mkdirSync(libsDir, { recursive: true })
  const binDir = path.dirname(serverPath)
  for (const f of fs.readdirSync(binDir)) {
    if (f.toLowerCase().endsWith('.dll')) {
      fs.copyFileSync(path.join(binDir, f), path.join(libsDir, f))
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.unlinkSync(tmpArchive)

  // Fetch matching cudart runtime DLLs and drop them into the same libs dir.
  // Without these the process exits immediately with "cudart64_12.dll not
  // found" — they're not bundled in the CUDA llama.cpp archive itself.
  const cudartTmp = path.join(BIN, `_cudart-${target}.zip`)
  log(`download cudart-${target}`)
  await downloadFollowing(cudartUrl, cudartTmp)
  const cudartDir = path.join(BIN, `_cudart-${target}-extract`)
  fs.rmSync(cudartDir, { recursive: true, force: true })
  fs.mkdirSync(cudartDir, { recursive: true })
  execSync(`unzip -o -q "${cudartTmp}" -d "${cudartDir}"`, { stdio: 'inherit' })
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

async function main() {
  // For local dev builds we only fetch the host-platform binary (fast iteration).
  // For full electron-builder runs targeting both arm64 + x64 Mac, set
  // FETCH_ALL_MAC=1 to fetch both Mac variants.
  const hostTarget = process.platform === 'darwin'
    ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    : process.platform === 'win32' ? 'win32-x64' : 'linux-x64'

  let targets = [hostTarget]
  if (process.env.FETCH_ALL_MAC === '1') targets = ['darwin-arm64', 'darwin-x64']
  if (process.env.FETCH_WIN === '1')     targets = [...new Set([...targets, 'win32-x64'])]
  if (process.env.FETCH_ALL === '1')     targets = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']

  for (const t of targets) {
    if (QDRANT_TARGETS[t])      await fetchQdrant(t, QDRANT_TARGETS[t])
    if (LLAMA_TARGETS[t])       await fetchLlama(t, LLAMA_TARGETS[t])
    if (LLAMA_CUDA_TARGETS[t])  await fetchLlamaCuda(t, LLAMA_CUDA_TARGETS[t], CUDART_TARGETS[t])
  }

  log('done')
}

main().catch(err => {
  console.error('[sidecars] fatal:', err.message)
  process.exit(1)
})
