"use strict"
/**
 * Model runtime supervisor — llama.cpp (llama-server) for the Lotus GGUF.
 *
 * Same pattern as the App's supervisor: if a llama.cpp/Ollama already
 * answers on LLM_BASE (full-version App running), attach to it. Otherwise
 * spawn the bundled llama-server with the downloaded model:
 *
 *   llama-server -m <Lotus GGUF> --host 127.0.0.1 --port 11434 \
 *                --api-prefix /api --ctx-size <tier ctx> -ngl <layers>
 *
 * llama-server serves both the OpenAI-compatible /v1/chat/completions (used
 * by llm.js) and the Ollama-style /api/tags under --api-prefix (used by
 * ping()). No network interface is bound — 127.0.0.1 only.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { LLM_BASE, LLM_MODEL, USERDATA_DIRS, DATA_DIR, TIER, DEPTH_PRESETS, ramCtxFor } = require('./config')
const { AGENT } = require('./config')
const { modelInfo } = require('./downloads')
const { agentBudget } = require('./agent-config')

const MODELS_DIR = path.join(DATA_DIR, 'models')

let proc = null
let started = false

/**
 * Effective spawn config (v3): platform tier from the shared registry +
 * RAM-derived ctx, overridden by the analysis-depth preset (8/16/32K).
 * Returns { ctx, n_gpu_layers, cache_type_k, cache_type_v, depth }.
 */
function tierConfig() {
  const ramGB = os.totalmem() / 1024 / 1024 / 1024
  const ramCtx = ramCtxFor(ramGB)
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tiers.json'), 'utf8'))
    const tier = reg.tiers?.[TIER] || Object.values(reg.tiers || {})[0]
    if (tier) {
      // Effective ctx = min(depth preset, RAM tier) — agent-config.js
      // applies the SAME cap to the client budget, so server num_ctx
      // always covers the client's working budget.
      const budget = agentBudget()
      const depthCtx = DEPTH_PRESETS[budget.depth]?.ctx
      return {
        ctx: Math.min(depthCtx || ramCtx, ramCtx),
        n_gpu_layers: typeof tier.n_gpu_layers === 'number' ? tier.n_gpu_layers : (process.platform === 'darwin' ? 999 : 0),
        cache_type_k: tier.cache_type_k || 'iq4_nl',
        cache_type_v: tier.cache_type_v || 'q4_0',
        depth: budget.depth,
      }
    }
  } catch { /* registry not fetched yet — defaults below */ }
  return { ctx: ramCtx, n_gpu_layers: process.platform === 'darwin' ? 999 : 0, cache_type_k: 'iq4_nl', cache_type_v: 'q4_0', depth: 'balanced' }
}

/**
 * llama-server build number (b10353+ → --reasoning-budget is safe).
 * Parsed once from `llama-server --version`; cached. On failure return a
 * large number so we DON'T pass the flag when unsure (broken flag on
 * b10333 cut every long reply; Lotus 2 self-closes thinking anyway).
 */
let cachedBuild = null
function serverBuild() {
  if (cachedBuild !== null) return cachedBuild
  const bin = findLlamaServer()
  cachedBuild = 999999
  if (!bin) return cachedBuild
  try {
    // --version prints to stderr on macOS/Windows builds, and the binary
    // needs its companion dylibs on DYLD_LIBRARY_PATH to even exec.
    const r = require('child_process').spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, ...llamaEnv(bin) } })
    const out = (r.stdout || '') + (r.stderr || '')
    // llama.cpp prints e.g. "version: 0.1.0-dev (build 10400, commit …)".
    // The naive /version:\s*(\d+)/ grabs the "0" of "0.1.0-dev" → build 0 →
    // the AMD-safe flag block (KV quant + flash-attn) was silently skipped
    // and fp16 KV on the 8GB RDNA1 card hard-hung the box (2026-09-06).
    // Prefer the parenthesised build number, fall back to the old shape.
    const m = out.match(/\bbuild\s*(\d+)/i) || out.match(/version:\s*(\d+)/i)
    if (m) cachedBuild = parseInt(m[1], 10)
  } catch { /* keep 999999 */ }
  console.log(`[llama] server build b${cachedBuild} — reasoning-budget ${cachedBuild >= 10353 ? 'ON' : 'OFF (b10333 bug cuts content mid-JSON)'}`)
  return cachedBuild
}

function findLlamaServer() {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const candidates = []
  for (const dir of USERDATA_DIRS) candidates.push(path.join(dir, 'bin', exe))
  // Dev layout: <repo>/sidecar/bin/llama-server
  candidates.push(path.join(__dirname, '..', 'bin', exe))
  // Installed layout: <app root>/bin/llama-server (pkg/NSIS put bin/ next
  // to sidecar/, not inside it)
  candidates.push(path.join(__dirname, '..', '..', 'bin', exe))
  candidates.push(path.join(MODELS_DIR, '..', 'bin', exe))
  // CLI installs (Homebrew, tarball): an explicit path, then llama.cpp on PATH
  // (e.g. `brew install llama.cpp`).
  if (process.env.OPENLEX_LLAMA_SERVER) candidates.unshift(process.env.OPENLEX_LLAMA_SERVER)
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(dir, exe))
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c } catch { }
  }
  return null
}

/**
 * Dynamic-library resolution for the spawned llama-server. On Windows the
 * companion DLLs live in bin/llama-win32-x64-libs/ and the loader needs
 * them on PATH; on macOS the dylibs live in bin/llama-<platform>-<arch>-libs/
 * and need DYLD_LIBRARY_PATH (same handling as the App supervisor).
 */
function llamaEnv(binPath) {
  const env = { ...process.env }
  // Windows AMD belt-and-braces (item 2, 2026-08-16): if the Vulkan ICD
  // is NOT registered in HKLM\SOFTWARE\Khronos\Vulkan\Drivers (broken
  // driver installs, SDK-loader quirks — the box's case), point the llama
  // child at the DriverStore's amd-vulkan64.json via VK_DRIVER_FILES.
  // No admin needed; the CPU fallback remains the graceful default.
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = require('child_process')
      const registered = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Khronos\\Vulkan\\Drivers'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).toString()
      if (!/\.[jJ][sS][oO][nN]/i.test(registered)) {
        const icd = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          "(Get-ChildItem 'C:\\Windows\\System32\\DriverStore\\FileRepository' -Recurse -Filter amd-vulkan64.json -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)"],
          { encoding: 'utf8', timeout: 15000, windowsHide: true }).toString().trim()
        if (icd && icd.toLowerCase().endsWith('.json')) {
          env.VK_DRIVER_FILES = icd
          console.log('[llama] AMD Vulkan ICD not registered — using VK_DRIVER_FILES:', icd)
        }
      }
    } catch { /* no DriverStore ICD found — CPU fallback */ }
  }
  if (process.platform === 'win32') {
    const libsDir = path.join(path.dirname(binPath), 'llama-win32-x64-libs')
    if (fs.existsSync(libsDir)) {
      env.PATH = libsDir + ';' + (env.PATH || env.Path || '')
      env.LEXVAULT_LLAMA_LIBS_DIR = libsDir
    }
  } else if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const libsDir = path.join(path.dirname(binPath), `llama-darwin-${arch}-libs`)
    if (fs.existsSync(libsDir)) {
      env.DYLD_LIBRARY_PATH = libsDir + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '')
      env.LEXVAULT_LLAMA_LIBS_DIR = libsDir
    }
  }
  return env
}

function resolveModelPath() {
  const info = modelInfo(LLM_MODEL)
  const p = info ? path.join(MODELS_DIR, info.filename) : path.join(MODELS_DIR, `${LLM_MODEL}.gguf`)
  return fs.existsSync(p) ? p : null
}

async function probe() {
  // 1. App LLM proxy — the full-version client's supervisor answers
  //    GET /healthz WITHOUT loading the model (its /api/v1/models would
  //    lazy-spawn 6 GB of weights just for our health check). Detect it
  //    first so the plugin reuses the App's llama-server and never runs
  //    a second one on the same port.
  try {
    const res = await fetch(LLM_BASE + '/healthz', { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const hz = await res.json().catch(() => ({}))
      return { ok: true, appProxy: true, llmRunning: !!hz.llmRunning, models: ['app-proxy'] }
    }
  } catch { /* not the App proxy */ }

  // 2. Direct llama.cpp / Ollama surface. Path varies by build:
  //    b10333+ → /api/v1/models, older → /api/tags, /api/models.
  //    Order matters: /api/tags first — through the App proxy it is
  //    answered cheaply without loading the model, whereas /api/v1/models
  //    passes through and lazy-spawns llama-server.
  for (const tagsPath of ['/api/tags', '/api/v1/models', '/api/models']) {
    try {
      const res = await fetch(LLM_BASE + tagsPath, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const tags = await res.json()
        return { ok: true, appProxy: false, models: (tags.models || []).map((m) => m.name || m.model || m.id) }
      }
    } catch { /* try next */ }
  }
  return { ok: false, appProxy: false, models: [] }
}

/**
 * Detect an AMD GPU on Windows (RDNA1 5700 XT et al.) — needs the safe
 * llama spawn flags. wmic is REMOVED on newer Win11 builds (fails with
 * CommandNotFoundException), so fall back to PowerShell CIM.
 */
function detectAmdGpu() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process')
    const check = (stdout) => resolve(/(amd|radeon|rx\s*\d)/i.test(String(stdout || '')))
    execFile('wmic', ['path', 'win32_VideoController', 'get', 'name'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (!err && stdout) return check(stdout)
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
        { timeout: 8000, windowsHide: true }, (err2, stdout2) => {
          if (err2) return resolve(false)
          check(stdout2)
        })
    })
  })
}

/**
 * Windows: trigger the box-standard GPU llama (scheduled task "llama-server"
 * running as SYSTEM — the only context where Vulkan initializes on the box).
 * On-demand: nothing runs at boot; the sidecar fires the task when a chat
 * needs a backend and attaches to its port (LLM_BASE). Returns true when a
 * server answers after the trigger.
 */
function triggerScheduledLlama() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false)
    const { execFile } = require('child_process')
    execFile('schtasks', ['/query', '/tn', 'llama-server'], { timeout: 5000, windowsHide: true }, (errQ) => {
      if (errQ) return resolve(false) // no such task — own spawn path
      // A hard GPU hang can leave the task stuck in "running" (schtasks
      // result 267014) — /run is then silently ignored and the sidecar
      // falls back to its own spawn. /end clears the stale instance first
      // (harmless when nothing is running).
      execFile('schtasks', ['/end', '/tn', 'llama-server'], { timeout: 5000, windowsHide: true }, () => {
        setTimeout(() => {
          execFile('schtasks', ['/run', '/tn', 'llama-server'], { timeout: 8000, windowsHide: true }, () => {
            // Poll LLM_BASE (the scheduled llama's port via LEXVAULT_LLM_URL)
            // until it answers — model load on Vulkan takes ~20-40s.
            const started = Date.now()
            const tick = async () => {
              if (Date.now() - started > 60000) return resolve(false)
              try {
                const r = await fetch(LLM_BASE + '/api/v1/models', { signal: AbortSignal.timeout(4000) })
                if (r.ok) return resolve(true)
              } catch { /* not up yet */ }
              setTimeout(tick, 4000)
            }
            tick()
          })
        }, 1500) // let /end release the instance before /run
      })
    })
  })
}

/**
 * Ensure a model backend is available. Attaches to an existing one when
 * present (the App's), otherwise spawns llama-server with the downloaded
 * Lotus GGUF. Returns { ok, owned, reason, modelPath }.
 */
async function ensureLlama() {
  const probeRes = await probe()
  if (probeRes.ok) {
    if (probeRes.appProxy) {
      // Full-version App is running: reuse its llama-server. The proxy
      // lazily loads the model on first request (idle-unload after 4 min),
      // so this is zero-cost — never spawn a second llama-server.
      const state = probeRes.llmRunning ? 'model loaded' : 'model idle (lazy-loads on first request)'
      return { ok: true, owned: false, reason: `attached to App's LLM proxy (${state})` }
    }
    const hasOurs = probeRes.models.some((m) => m.toLowerCase().includes(LLM_MODEL.toLowerCase()) || m.toLowerCase().includes('lotus'))
    if (hasOurs) return { ok: true, owned: false, reason: 'attached to local model service (Lotus available)' }
    return { ok: true, owned: false, reason: 'attached to local model service (model: ' + (probeRes.models[0] || '?') + ')' }
  }

  if (started && proc) {
    // The server may have died since startup (crash) while the exit event
    // is still pending — trusting the stale handle made every LLM call
    // fail with ECONNREFUSED until the sidecar restarted. Verify once
    // before treating it as alive.
    await new Promise((r) => setTimeout(r, 1200))
    const re = await probe()
    if (re.ok) return { ok: true, owned: true, reason: 'already spawned' }
    started = false
    try { proc.kill() } catch {}
    proc = null
    // fall through to a fresh spawn
  }

  // On-demand GPU: the box-standard scheduled llama (SYSTEM task, Vulkan)
  // is cold at boot — fire it before spawning our own CPU-only process.
  const triggered = await triggerScheduledLlama()
  if (triggered) {
    return { ok: true, owned: false, reason: 'attached to scheduled GPU llama (SYSTEM task, Vulkan)' }
  }

  const modelPath = resolveModelPath()
  if (!modelPath) {
    return { ok: false, owned: false, reason: `model not installed — run setup to download ${LLM_MODEL} (Settings → Download model)` }
  }

  const bin = findLlamaServer()
  if (!bin) {
    return { ok: false, owned: false, reason: 'llama-server binary missing — reinstall the plugin' }
  }

  // Tier-driven spawn from the shared registry (hardware-tiers.json), the
  // same source the App supervisor and license server read:
  //   - ctx:   depth preset (8/16/32K) or RAM-derived (16K on 8-16 GB)
  //   - KV:    asymmetric iq4_nl-K / q4_0-V (1.0 B/elem). K feeds softmax
  //            (3-bit precision floor per NexusQuant research); V is
  //            linearly combined, compresses nearly free. TBQ3/TBQ4
  //            (TurboQuant) types are NOT in mainline llama.cpp
  //            (PR #21089 closed unmerged) — iq4_nl is the closest
  //            supported 4-bit type for K.
  //   - ngl:   platform GPU layers (Metal 999 on Apple Silicon)
  const tier = tierConfig()
  const ctxSize = tier.ctx || 8192
  const gpuLayers = tier.n_gpu_layers ?? (process.platform === 'darwin' ? 999 : 0)
  const cacheK = tier.cache_type_k || 'iq4_nl'
  const cacheV = tier.cache_type_v || 'q4_0'
  const port = new URL(LLM_BASE).port || '11434'
  // AMD RDNA1 (e.g. the 5700 XT test box) — Vulkan backend compatibility:
  // - b10353: works without flash-attn, hangs WITH flash-attn (KV quant + batch OK)
  // - b10400–b10785: works WITH flash-attn + KV quant + batch (tested b10400)
  // - b10786+: Vulkan regression crashes the build itself — CPU only (ngl 0)
  // KV quant (-ctk/-ctv) is gated independently of flash-attn: it is the
  // flag that keeps fp16 KV (≈2.5 GB at 8K ctx) off an 8 GB card. Dropping
  // it on the fallback spawn hard-hung the box 2026-09-06 (the version
  // regex parsed "0.1.0-dev (build 10400…)" as build=0 → safe block skipped).
  // An UNKNOWN build (999999) counts as modern for KV, but flash-attn stays
  // OFF on AMD (the crashy flag) — worst case is slower, not hung.
  const amdGpu = process.platform === 'win32' ? await detectAmdGpu() : false
  const build = serverBuild()
  const flashOk = !amdGpu || (build >= 10400 && build < 10786)
  const kvOk = !amdGpu || build === 999999 || (build !== 999999 && build >= 10353)
  const cpuOnly = amdGpu && build !== 999999 && build >= 10786
  const ngl = amdGpu ? (cpuOnly ? 0 : Math.min(gpuLayers, 32)) : gpuLayers
  // Single slot: llama-server b10333+ defaults to 4 parallel slots,
  // which splits --ctx-size into 4K (or 2K on the box's 8K) per
  // generation — long write calls truncated mid-JSON at the slot
  // boundary ("writing… (truncated — retrying)" loops). The sidecar is
  // single-client, so one slot = the full context for every call.
  const args = ['-m', modelPath, '--host', '127.0.0.1', '--port', port,
    '--api-prefix', '/api', '--ctx-size', String(ctxSize),
    '-ngl', String(ngl),
    '--parallel', '1',
    '--threads', String(Math.max(2, Math.round((require('os').cpus().length || 4) * 0.75)))]
  if (kvOk) args.push('-ctk', cacheK, '-ctv', cacheV)
  if (flashOk) args.push('--flash-attn', 'on', '-b', '16384', '-ub', '2048')
  // --reasoning-budget is only safe on b10353+ (injects the end-of-thought
  // tag at N tokens). On b10333 the flag TERMINATES the generation
  // mid-content with finish=stop — every long JSON reply came back cut
  // ("JSON.parse FAIL" at the last brace). Lotus 2 closes </think> on its
  // own anyway; the client guard in llm.js bounds runaway thinking.
  if (build >= 10353) {
    args.push('--reasoning-budget', String(require('./models').forLocal(LLM_MODEL).thinkingBudget || AGENT.THINKING_BUDGET || 400))
  }
  const flags = [amdGpu ? (cpuOnly ? 'amd-cpu-only' : 'amd') : 'non-amd']
  if (kvOk) flags.push('kvcache=' + cacheK + '/' + cacheV)
  if (flashOk) flags.push('flash-attn', 'batch=16384')
  console.log(`[llama] spawn tier=${TIER} ctx=${ctxSize} ngl=${ngl} build=${build} [${flags.join(', ')}]`)

  proc = spawn(bin, args, { stdio: 'ignore', env: llamaEnv(bin), windowsHide: true })
  proc.on('error', (err) => {
    console.error('[llama] spawn failed:', err.message)
    proc = null
    started = false
  })
  proc.on('exit', (code) => {
    if (started) console.warn(`[llama] exited early with code ${code}`)
    started = false
    proc = null
  })
  started = true

  // Wait for readiness (model load on CPU can take 30s+).
  for (let i = 0; i < 120; i++) {
    const r = await probe()
    if (r.ok) return { ok: true, owned: true, reason: 'spawned llama-server with ' + LLM_MODEL }
    await new Promise((res) => setTimeout(res, 500))
  }
  return { ok: false, owned: true, reason: 'llama-server started but model not ready within 60s' }
}

function isOwned() { return started }

function stop() {
  if (proc) {
    started = false // intentional stop — don't warn on exit
    try { proc.kill('SIGTERM') } catch {}
  }
}

module.exports = { ensureLlama, isOwned, stop, resolveModelPath, serverBuild }
