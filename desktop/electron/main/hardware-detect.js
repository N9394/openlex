/**
 * Hardware detection for the App.
 *
 * Runs on every boot (cheap — a few syscalls + one optional `nvidia-smi` invoke).
 * Picks a platform tier from hardware-tiers.json and writes hardware.json
 * under userData.
 *
 * Tiers (v3 — one per platform, no hardware splits):
 *   apple   — Apple Silicon, full Metal offload
 *   windows — Windows x64, GPU auto-probed (CUDA → Vulkan → CPU)
 *   linux   — Linux x64, GPU auto-probed (CUDA → Vulkan → CPU)
 *
 * Context window is derived from system RAM (8-16 GB → 16K, 16-32 GB → 32K,
 * 32+ GB → 64K). The plugin's Analysis depth preset (8/16/32K) can override.
 *
 * Sub-minimum hardware is filtered at purchase, not handled here.
 *
 * The detected tier is just a starting point — the user can override via
 * userData/hardware.override.json. We always honor the override if present.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

// execFileSync's `timeout` option sends SIGTERM, which Windows processes can
// ignore — we've seen PowerShell + Get-CimInstance hang for 5+ minutes when
// the WMI repo is corrupted. spawnSync with `killSignal: 'SIGKILL'` actually
// terminates the child. Returns stdout on success, throws on timeout/failure.
function runWithHardTimeout(file, args, timeoutMs) {
  const r = spawnSync(file, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  if (r.error) throw r.error
  if (r.signal) throw new Error(`${file} killed (${r.signal}) after ${timeoutMs}ms`)
  if (r.status !== 0) throw new Error(`${file} exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`)
  return r.stdout
}

function detectGpu() {
  // 1. NVIDIA discrete via nvidia-smi. The driver installer doesn't always
  //    put nvidia-smi.exe on PATH (depends on installer version + whether the
  //    user did a custom install), so try the canonical fallback locations on
  //    Windows before giving up. Without this, an RTX 4060 box with no PATH
  //    entry falls through to the PowerShell CIM probe — which is what hung
  //    one user's first-launch for 5+ minutes.
  const nvidiaCandidates = ['nvidia-smi']
  if (process.platform === 'win32') {
    const sysroot = process.env.SystemRoot || 'C:\\Windows'
    const pf64 = process.env['ProgramFiles'] || 'C:\\Program Files'
    nvidiaCandidates.push(
      path.join(sysroot, 'System32', 'nvidia-smi.exe'),
      path.join(pf64, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    )
  }
  for (const bin of nvidiaCandidates) {
    try {
      const out = runWithHardTimeout(bin,
        ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], 3000)
      const lines = out.trim().split('\n').filter(Boolean)
      if (lines.length > 0) {
        const gpus = lines.map(l => {
          const [name, vram] = l.split(',').map(s => s.trim())
          return { name, vramGB: Math.round(parseInt(vram, 10) / 1024) }
        }).filter(g => Number.isFinite(g.vramGB))
        gpus.sort((a, b) => b.vramGB - a.vramGB)
        if (gpus[0]) return { type: 'cuda', ...gpus[0] }
      }
    } catch {
      // not found at this path — try the next candidate
    }
  }

  // 2. Apple Silicon — Metal is implicit on darwin/arm64
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { type: 'metal', name: 'Apple Silicon GPU' }
  }

  // 3. AMD / Intel discrete or iGPU on Windows. We try multiple data sources
  //    in order — different machines fail differently:
  //      a) PowerShell Get-CimInstance Win32_VideoController (cleanest)
  //      b) wmic path win32_videocontroller (works when CIM is broken)
  //      c) Registry under HKLM\SYSTEM\CurrentControlSet\Control\Class\
  //         {4d36e968-e325-11ce-bfc1-08002be10318} — DirectX device class
  //    The first source that yields a recognizable GPU name wins. We expose
  //    the raw output of every step in detected.gpu.diag so a Settings →
  //    Dependencies screenshot is enough to debug detection failures.
  if (process.platform === 'win32') {
    const diag = { sources: [], errors: [] }
    const candidates = []

    // PowerShell launched via cmd.exe with nested quotes is unreliable —
    // cmd's quote eating + powershell's command-line parser disagree on
    // how to escape "Get-CimInstance ...". The script comes through as
    // plain text and PowerShell echoes it back instead of running it.
    // Fix: invoke powershell.exe DIRECTLY with -EncodedCommand (base64
    // UTF-16LE), which sidesteps all shell quoting.
    function runPs(script) {
      const buf = Buffer.from(script, 'utf16le')
      const b64 = buf.toString('base64')
      // 8 s ceiling per PowerShell invoke — even a broken WMI repo will get
      // killed cleanly here. We try three different probes; total wall-clock
      // cap on Windows detection is ~24 s.
      return runWithHardTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-OutputFormat', 'Text', '-EncodedCommand', b64,
      ], 8000)
    }

    // (a) PowerShell + CIM
    try {
      const raw = runPs(`Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor,PNPDeviceID | ConvertTo-Json -Compress -Depth 3`)
      diag.sources.push({ via: 'powershell-cim', raw: (raw || '').slice(0, 1000) })
      let arr = JSON.parse(raw || 'null')
      if (arr && !Array.isArray(arr)) arr = [arr]
      for (const g of arr || []) {
        candidates.push({
          name: g.Name || g.VideoProcessor || 'Unknown GPU',
          vramGB: Math.round((g.AdapterRAM || 0) / 1024 / 1024 / 1024),
          driverVersion: g.DriverVersion || '',
          via: 'powershell-cim',
          pnpId: g.PNPDeviceID || '',
        })
      }
    } catch (err) {
      diag.errors.push(`powershell-cim: ${err.message}`)
    }

    // (b) Get-PnpDevice — present on every Windows 10/11, no WMI dependency
    if (candidates.length === 0) {
      try {
        const raw = runPs(`Get-PnpDevice -PresentOnly -Class Display -Status OK | Select-Object FriendlyName,InstanceId | ConvertTo-Json -Compress -Depth 3`)
        diag.sources.push({ via: 'pnp', raw: (raw || '').slice(0, 1000) })
        let arr = JSON.parse(raw || 'null')
        if (arr && !Array.isArray(arr)) arr = [arr]
        for (const e of arr || []) {
          if (!e?.FriendlyName) continue
          candidates.push({
            name: e.FriendlyName, vramGB: 0, driverVersion: '',
            via: 'pnp', pnpId: e.InstanceId || '',
          })
        }
      } catch (err) {
        diag.errors.push(`pnp: ${err.message}`)
      }
    }

    // (c) Registry under the {4d36e968-...} display class — works even
    // when WMI / PnP enumeration is broken. Last resort.
    if (candidates.length === 0) {
      try {
        const raw = runPs(`Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue | Select-Object DriverDesc,DriverVersion } | Where-Object { $_.DriverDesc } | ConvertTo-Json -Compress -Depth 3`)
        diag.sources.push({ via: 'registry', raw: (raw || '').slice(0, 1000) })
        let arr = JSON.parse(raw || 'null')
        if (arr && !Array.isArray(arr)) arr = [arr]
        for (const e of arr || []) {
          if (!e?.DriverDesc) continue
          candidates.push({
            name: e.DriverDesc, vramGB: 0, driverVersion: e.DriverVersion || '',
            via: 'registry', pnpId: '',
          })
        }
      } catch (err) {
        diag.errors.push(`registry: ${err.message}`)
      }
    }

    // Filter out non-GPU adapters (RDP, mirror drivers, virtual) and
    // duplicates that have the same name across sources.
    const seen = new Set()
    const gpus = candidates.filter(g => {
      const n = (g.name || '').toLowerCase()
      if (!n || seen.has(n)) return false
      seen.add(n)
      if (/microsoft basic display|remote display|mirror|teamviewer|parsec|virtual|displaylink|idd hyperv/.test(n)) return false
      return true
    })

    // Score by recognized GPU vendor — discrete > iGPU > unknown.
    gpus.sort((a, b) => {
      const score = g => {
        const n = g.name.toLowerCase()
        if (/geforce|rtx|gtx|quadro|nvidia/.test(n)) return 30
        if (/radeon|rx ?\d|navi|rdna|amd/.test(n)) return 20
        if (/arc /.test(n)) return 15
        if (/iris|uhd|intel/.test(n)) return 5
        return 0
      }
      const sa = score(a), sb = score(b)
      if (sa !== sb) return sb - sa
      return (b.vramGB || 0) - (a.vramGB || 0)
    })

    if (gpus[0]) {
      const name = gpus[0].name.toLowerCase()
      const isNvidia = /nvidia|geforce|quadro|rtx|gtx/.test(name)
      const isAmd    = /amd|radeon|rx ?\d|navi|rdna/.test(name)
      const isIntel  = /intel|iris|arc|uhd/.test(name)
      const type = isNvidia ? 'cuda' : isAmd ? 'amd-vulkan' : isIntel ? 'intel-vulkan' : 'vulkan'
      return { type, ...gpus[0], diag, allCandidates: gpus }
    }
    // Even when nothing matched, surface diag so we can debug from a screenshot.
    return { type: 'unknown', name: 'no GPU detected', vramGB: 0, diag, allCandidates: gpus }
  }

  // 4. Linux: try lspci + heuristics
  if (process.platform === 'linux') {
    try {
      const out = runWithHardTimeout('lspci', ['-mm'], 2000)
      const vgaLines = out.split('\n').filter(l => /VGA|3D controller/i.test(l))
      const isAmd   = vgaLines.some(l => /amd|advanced micro devices|radeon/i.test(l))
      const isIntel = vgaLines.some(l => /intel/i.test(l))
      if (isAmd)   return { type: 'amd-vulkan',   name: 'AMD GPU (lspci)',   vramGB: 0 }
      if (isIntel) return { type: 'intel-vulkan', name: 'Intel GPU (lspci)', vramGB: 0 }
    } catch {}
  }

  return null
}

function pickTier({ gpu }) {
  // One tier per platform (v3). GPU type only selects the backend path —
  // CUDA vs Vulkan vs Metal vs CPU — handled downstream by n_gpu_layers
  // detection. Sub-minimum hardware is filtered at purchase, not here.
  if (process.platform === 'darwin') return 'apple'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

/**
 * Context window from system RAM (8-16 GB baseline):
 *   8-16 GB → 16K · 16-32 GB → 32K · 32+ GB → 64K
 */
function ctxFromRam(totalRamGB) {
  if (totalRamGB >= 32) return 65536
  if (totalRamGB >= 16) return 32768
  return 16384
}

/**
 * @param {object} args
 * @param {string} args.hardwareJson path to userData/hardware.json
 * @param {string} args.overrideJson path to userData/hardware.override.json
 * @param {string} args.tiersJson path to hardware-tiers.json
 * @returns {{tier: string, model: string, ctx: number, n_gpu_layers: number, threads_pct: number, detected: object}}
 */
// 2026-05-31: Windows WMI / Get-CimInstance is known to hang for minutes
// when the WMI repository is in a bad state, and execFileSync's `timeout`
// option on Windows sends SIGTERM which the child can ignore. The result
// was App "stuck on detecting-hardware" forever on some Windows machines.
// Fix: honor the override file BEFORE running detection, and reuse a recent
// cached hardware.json instead of re-probing on every boot.
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000  // 1 week

function buildResult(tier, registry, detected) {
  const tierCfg = registry.tiers[tier]
  if (!tierCfg) throw new Error(`tier ${tier} not in registry`)
  const modelMeta = registry.models[tierCfg.model]
  if (!modelMeta) throw new Error(`model ${tierCfg.model} referenced by tier ${tier} but missing in registry.models`)
  const totalRamGB = detected?.totalRamGB || Math.round(os.totalmem() / 1024 / 1024 / 1024)
  // Context from RAM (v3); a tier with an explicit ctx wins over the default.
  const ctx = tierCfg.ctx || ctxFromRam(totalRamGB)
  // GPU layers: tier default (999 = all), else auto by platform.
  const n_gpu_layers = typeof tierCfg.n_gpu_layers === 'number' ? tierCfg.n_gpu_layers
    : (detected?.gpu?.type && detected.gpu.type !== 'cpu' && detected.gpu.type !== 'unknown' ? 999 : 0)
  return {
    tier,
    model: tierCfg.model,
    model_filename: modelMeta.filename,
    model_sha256: modelMeta.sha256,
    model_size_bytes: modelMeta.size_bytes,
    ctx,
    n_gpu_layers,
    threads_pct: tierCfg.threads_pct,
    cache_type_k: tierCfg.cache_type_k,
    cache_type_v: tierCfg.cache_type_v,
    detected,
  }
}

function detect({ hardwareJson, overrideJson, tiersJson }) {
  const registry = JSON.parse(fs.readFileSync(tiersJson, 'utf8'))

  // ── Fast path 1 — explicit override. Read FIRST so a user with broken
  //    WMI on Windows can escape the hang by writing
  //    `%APPDATA%\LexVault\hardware.override.json` with {"tier":"cpu"}.
  let overrideTier = null
  if (fs.existsSync(overrideJson)) {
    try {
      const override = JSON.parse(fs.readFileSync(overrideJson, 'utf8'))
      if (override.tier && registry.tiers[override.tier]) overrideTier = override.tier
    } catch (err) {
      console.warn('[hw-detect] ignoring malformed override.json:', err.message)
    }
  }
  if (overrideTier) {
    const detected = {
      platform: process.platform, arch: process.arch,
      totalRamGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      cores: os.cpus().length,
      gpu: { type: 'override', name: `forced ${overrideTier} tier`, vramGB: 0 },
      detectedAt: new Date().toISOString(),
      overriddenFrom: 'detect-skipped',
    }
    const result = buildResult(overrideTier, registry, detected)
    try { fs.writeFileSync(hardwareJson, JSON.stringify(result, null, 2)) } catch {}
    console.log(`[hw-detect] override → tier=${overrideTier}, detection skipped`)
    return result
  }

  // ── Fast path 2 — recent successful detection. No need to re-probe.
  if (fs.existsSync(hardwareJson)) {
    try {
      const cached = JSON.parse(fs.readFileSync(hardwareJson, 'utf8'))
      const detectedAt = cached.detected?.detectedAt
      if (detectedAt) {
        const age = Date.now() - new Date(detectedAt).getTime()
        if (age >= 0 && age < CACHE_TTL_MS && registry.tiers[cached.tier]) {
          console.log(`[hw-detect] using cached hardware.json (${Math.round(age/3600000)}h old, tier=${cached.tier})`)
          return cached
        }
      }
    } catch (err) {
      console.warn('[hw-detect] cache read failed, will re-detect:', err.message)
    }
  }

  // ── Slow path — actually probe the hardware.
  const totalRamGB = Math.round(os.totalmem() / 1024 / 1024 / 1024)
  const cores = os.cpus().length
  let gpu = null
  try {
    gpu = detectGpu()
  } catch (err) {
    console.warn('[hw-detect] detectGpu threw, falling back to CPU tier:', err.message)
  }
  const detected = {
    platform: process.platform, arch: process.arch,
    totalRamGB, cores, gpu,
    detectedAt: new Date().toISOString(),
  }
  const tier = pickTier({ gpu })
  const result = buildResult(tier, registry, detected)
  fs.writeFileSync(hardwareJson, JSON.stringify(result, null, 2))
  return result
}

module.exports = { detect, pickTier, detectGpu }
