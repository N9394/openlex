/**
 * Custom auto-updater that bypasses electron-updater entirely.
 *
 * electron-updater on Windows requires the new installer to be code-signed
 * with a publisher matching the configured `publisherName`. Unsigned builds
 * fail this check silently — there is no way to opt out without monkey-
 * patching electron-updater internals. This module replaces it.
 *
 * Flow:
 *   1. Poll <license-server>/api/app/update/{win,mac,mac-x64}  → YAML manifest
 *   2. Parse `version` field, compare to current app version
 *   3. If newer: download the artifact in the manifest to userData/updates/
 *   4. Verify SHA512 against the manifest hash
 *   5. Show modal: "Update X.Y.Z ready — Restart?"
 *   6. On confirm: spawn installer detached, quit current app, Windows
 *      installer launches new app on completion (perMachine: false NSIS)
 *
 * No publisher / signature verification. Trust comes from the bearer-token
 * authenticated channel — we issued the artifact, signed yml is the chain
 * of custody. Once we ship a code-signing cert this whole module gets
 * deleted in favour of electron-updater.
 */

const { app, dialog, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { spawn } = require('child_process')

const POLL_INTERVAL_MS = 60 * 60 * 1000   // hourly after first 30s check
const FIRST_CHECK_DELAY_MS = 30 * 1000

function platformKey() {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac' : 'mac-x64'
  return 'linux'
}

function compareVersion(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (x !== y) return x - y
  }
  return 0
}

function fetchBuffer(url, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http
    const req = lib.get(url, { headers }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location, headers, onProgress).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${url}`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      const chunks = []
      let received = 0
      res.on('data', c => {
        chunks.push(c)
        received += c.length
        if (onProgress && total) onProgress(received, total)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', err => reject(new Error(`stream error: ${err.message || err.code || 'aborted'}`)))
      res.on('aborted', () => reject(new Error('connection aborted by server (download truncated)')))
    })
    req.on('error', reject)
    // Idle timeout — server has 5 minutes to send the next byte before we
    // give up. 350 MB on a slow line can take 5+ minutes total but each
    // packet still arrives within a few seconds, so idle should never trip.
    req.setTimeout(5 * 60_000, () => req.destroy(new Error('idle timeout (no data for 5 min)')))
  })
}

// Resumable download with auto-retry on abort/timeout. Streams to disk so
// the buffer doesn't have to fit in RAM, and uses Range requests on retry
// to skip already-downloaded bytes — useful for the App installer (350 MB)
// over flaky connections.
async function downloadResumable(url, headers, destPath, onProgress) {
  const fs = require('fs')
  const path = require('path')
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const partPath = destPath + '.part'
  const maxAttempts = 4

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0
    let total = 0
    try {
      await new Promise((resolve, reject) => {
        const lib = url.startsWith('https://') ? https : http
        const reqHeaders = { ...headers }
        if (startBytes > 0) reqHeaders['Range'] = `bytes=${startBytes}-`
        const req = lib.get(url, { headers: reqHeaders }, res => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return reject(new Error(`unexpected redirect to ${res.headers.location}`))
          }
          if (res.statusCode === 416) {
            // Range Not Satisfiable — file already complete on disk
            res.resume(); return resolve({ done: true })
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            return reject(new Error(`HTTP ${res.statusCode} ${url}`))
          }
          total = (parseInt(res.headers['content-length'] || '0', 10) || 0) + startBytes
          const sink = fs.createWriteStream(partPath, { flags: startBytes > 0 ? 'a' : 'w' })
          let got = startBytes
          res.on('data', c => {
            got += c.length
            if (onProgress && total) onProgress(got, total)
          })
          res.pipe(sink)
          sink.on('finish', () => sink.close(() => resolve({ done: false })))
          sink.on('error', reject)
          res.on('error', err => reject(new Error(`stream error: ${err.message || err.code || 'aborted'}`)))
          res.on('aborted', () => reject(new Error('aborted')))
        })
        req.on('error', reject)
        req.setTimeout(5 * 60_000, () => req.destroy(new Error('idle timeout')))
      })
      // Success — move part → final
      fs.renameSync(partPath, destPath)
      return
    } catch (err) {
      const isLast = attempt === maxAttempts
      console.warn(`[updater] download attempt ${attempt}/${maxAttempts} failed: ${err.message}${isLast ? '' : ' — retrying'}`)
      if (isLast) throw new Error(`download failed after ${maxAttempts} attempts: ${err.message}`)
      // Backoff: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
}

function parseYml(text) {
  // Tiny YAML subset — top-level scalars + a "files:" list of {url,sha512,size}.
  // Enough for the latest{,-mac,-linux}.yml shape electron-builder publishes.
  const out = { files: [] }
  const lines = text.split('\n')
  let inFiles = false
  let cur = null
  for (const raw of lines) {
    if (!raw.trim()) continue
    if (/^files\s*:/.test(raw)) { inFiles = true; continue }
    if (inFiles && /^\s*-\s/.test(raw)) {
      if (cur) out.files.push(cur)
      cur = {}
      const inline = raw.replace(/^\s*-\s+/, '')
      const m = inline.match(/^([a-zA-Z0-9_]+):\s*(.*)$/)
      if (m) cur[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      continue
    }
    if (inFiles && /^\s{2,}/.test(raw)) {
      const m = raw.trim().match(/^([a-zA-Z0-9_]+):\s*(.*)$/)
      if (m && cur) cur[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      continue
    }
    // Top-level key (no leading whitespace) — end the files block.
    inFiles = false
    if (cur) { out.files.push(cur); cur = null }
    const m = raw.match(/^([a-zA-Z0-9_]+):\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  if (cur) out.files.push(cur)
  return out
}

// Pick the artifact entry for the current platform+arch from the parsed
// manifest's files[]. If only one file is listed or no match is found,
// fall back to the top-level `path` so older yml shapes still work.
function pickArtifact(manifest) {
  const platform = process.platform     // 'darwin' | 'win32' | 'linux'
  const arch = process.arch              // 'arm64' | 'x64'
  const files = Array.isArray(manifest.files) ? manifest.files : []
  if (files.length === 0) {
    return manifest.path ? { url: manifest.path, sha512: manifest.sha512 } : null
  }
  // Heuristic match by url substring. electron-builder names artifacts like
  //   LexVault-0.1.43-arm64-mac.zip / LexVault-0.1.43-mac.zip / -Setup-... .exe / .AppImage
  const candidates = files.map(f => ({
    ...f,
    score: (() => {
      const u = (f.url || '').toLowerCase()
      let s = 0
      if (platform === 'darwin') {
        if (!u.endsWith('.zip')) return -1
        const hasArm = u.includes('arm64')
        if (arch === 'arm64' && hasArm) s += 10
        if (arch === 'x64' && !hasArm) s += 10
      } else if (platform === 'win32') {
        if (!u.endsWith('.exe')) return -1
        s += 10
      } else if (platform === 'linux') {
        if (!u.endsWith('.appimage')) return -1
        const hasArm = u.includes('arm64')
        if (arch === 'arm64' && hasArm) s += 10
        if (arch === 'x64' && !hasArm) s += 10
      }
      return s
    })(),
  }))
  const best = candidates.filter(c => c.score >= 0).sort((a, b) => b.score - a.score)[0]
  if (best) return { url: best.url, sha512: best.sha512 }
  // Last resort: top-level path. Better than failing — at least something
  // gets downloaded, and SHA512 verify will catch a real mismatch.
  return manifest.path ? { url: manifest.path, sha512: manifest.sha512 } : null
}

function sha512Base64(buf) {
  return crypto.createHash('sha512').update(buf).digest('base64')
}

class Updater {
  constructor({ feedBaseUrl, getToken, onEvent }) {
    this.feedBaseUrl = feedBaseUrl.replace(/\/$/, '')
    this.getToken = getToken
    this.onEvent = onEvent || (() => {})
    this.checking = false
    this.lastError = null
    this.timer = null
  }

  emit(payload) {
    try { this.onEvent(payload) } catch (err) { console.warn('[updater] onEvent threw:', err.message) }
  }

  start() {
    setTimeout(() => this.check().catch(e => console.warn('[updater]', e.message)), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => this.check().catch(e => console.warn('[updater]', e.message)), POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async check({ silent = true } = {}) {
    if (this.checking) return { state: 'busy' }
    this.checking = true
    this.emit({ kind: 'checking' })
    try {
      const token = this.getToken()
      if (!token) {
        this.emit({ kind: 'idle' })
        return { state: 'no-token' }
      }
      const platform = platformKey()
      const headers = { Authorization: 'Bearer ' + token, 'User-Agent': 'OpenLex-Updater/1' }

      const ymlBuf = await fetchBuffer(`${this.feedBaseUrl}/${platform}`, headers)
      const manifest = parseYml(ymlBuf.toString('utf8'))
      const remoteVersion = manifest.version
      const localVersion = app.getVersion()
      console.log(`[updater] local=${localVersion} remote=${remoteVersion} platform=${platform}`)
      if (!remoteVersion) throw new Error('manifest missing version field')
      if (compareVersion(remoteVersion, localVersion) <= 0) {
        this.emit({ kind: 'idle', localVersion, remoteVersion })
        return { state: 'up-to-date', localVersion, remoteVersion }
      }

      this.emit({ kind: 'available', localVersion, remoteVersion })

      const picked = pickArtifact(manifest)
      if (!picked || !picked.url) throw new Error('manifest has no artifact matching this platform/arch')
      const artifactName = picked.url
      const expectedSha = picked.sha512
      console.log(`[updater] downloading ${artifactName} (${expectedSha?.slice(0, 12)}...)`)

      const updatesDir = path.join(app.getPath('userData'), 'updates')
      fs.mkdirSync(updatesDir, { recursive: true })
      const artifactPath = path.join(updatesDir, artifactName)

      // Sweep stale installers from previous updates so userData/updates/
      // doesn't grow by ~350 MB each cycle. Keep the current artifact and
      // any in-flight .part files matching it.
      try {
        for (const f of fs.readdirSync(updatesDir)) {
          if (f === artifactName || f === artifactName + '.part') continue
          if (/\.(exe|zip|AppImage|dmg|blockmap|part)$/i.test(f)) {
            try { fs.unlinkSync(path.join(updatesDir, f)); console.log('[updater] swept stale ' + f) } catch {}
          }
        }
      } catch {}

      let lastEmitPct = -1
      await downloadResumable(`${this.feedBaseUrl}/${artifactName}`, headers, artifactPath, (got, total) => {
        const pct = Math.floor((got / total) * 100)
        // Throttle to whole percentage steps to avoid flooding IPC.
        if (pct !== lastEmitPct) {
          lastEmitPct = pct
          this.emit({ kind: 'downloading', remoteVersion, pct, received: got, total })
        }
      })

      if (expectedSha) {
        const buf = fs.readFileSync(artifactPath)
        const actual = sha512Base64(buf)
        if (actual !== expectedSha) {
          fs.unlinkSync(artifactPath)
          throw new Error(`SHA512 mismatch — got ${actual.slice(0, 16)}…, expected ${expectedSha.slice(0, 16)}…`)
        }
      }
      console.log('[updater] download verified, prompting user')
      this.emit({ kind: 'ready', remoteVersion, artifactPath })
      this.pendingArtifactPath = artifactPath
      this.pendingVersion = remoteVersion

      // Prompt — non-blocking. User can dismiss; next launch will re-check.
      const win = BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win || null, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `OpenLex ${remoteVersion} is ready`,
        detail: `An update is available (you have ${localVersion}). Restart to install — your downloaded statute packs and settings stay intact.`,
      })
      if (result.response !== 0) return { state: 'pending', artifactPath }

      this.installPending()
      return { state: 'installing' }
    } catch (err) {
      this.lastError = err.message
      console.warn('[updater] error:', err.message)
      this.emit({ kind: 'error', error: err.message })
      if (!silent) throw err
      return { state: 'error', error: err.message }
    } finally {
      this.checking = false
    }
  }

  // Called by the renderer's "Restart now" button on the in-app banner. Same
  // entry point as the dialog button — renderer doesn't need to know the
  // artifact path.
  installPending() {
    if (!this.pendingArtifactPath) return false
    this.emit({ kind: 'installing', remoteVersion: this.pendingVersion })
    this.spawnInstallerAndQuit(this.pendingArtifactPath)
    return true
  }

  spawnInstallerAndQuit(artifactPath) {
    if (process.platform === 'win32') {
      // electron-builder NSIS in oneClick mode (our default) already does
      // everything we need: it shows its own minimal progress UI, installs
      // to %LOCALAPPDATA%\Programs\LexVault, and auto-launches the freshly
      // installed LexVault.exe on finish.
      //
      // Previous version (0.1.52) shipped a .bat helper that wrapped this:
      // it polled tasklist for our PID, then ran installer /S, then started
      // the new exe. Two bugs in practice:
      //   (a) `windowsHide: true` on cmd.exe doesn't fully hide it on
      //       Win11 — a black terminal window appears that won't close
      //   (b) if the user X's the terminal, the install never starts; the
      //       app didn't quit in time, the user clicks "Restart" again,
      //       new bat fires, repeat loop.
      // Drop the helper. spawn the installer directly, detached, no /S so
      // NSIS shows its own UI and auto-launches the new build.
      const child = spawn(artifactPath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.unref()
      setTimeout(() => app.quit(), 500)
      return
    }
    if (process.platform === 'darwin') {
      // Mac: spawn a tiny launcher script that waits for us to exit, unzips
      // the new build over the running .app via ditto (preserves metadata,
      // extended attributes), and re-launches the new bundle. We just exit.
      this._spawnMacUpdater(artifactPath)
      setTimeout(() => app.quit(), 500)
      return
    }
    if (process.platform === 'linux') {
      // Linux: AppImage replace-in-place. The new AppImage is at the
      // downloads dir; replace the running one with it, mark executable,
      // re-exec. argv[0] (when packaged) is the AppImage path itself.
      this._spawnLinuxUpdater(artifactPath)
      setTimeout(() => app.quit(), 500)
      return
    }
    // Unknown platform — leave the file in updates/ and tell user to open it
    const { shell } = require('electron')
    shell.showItemInFolder(artifactPath)
    setTimeout(() => app.quit(), 500)
  }

  // Mac update strategy:
  //   1. Write a shell script that:
  //        - waits 2s for the running LexVault to exit
  //        - unzips the downloaded archive into a temp dir
  //        - `ditto` copies the new LexVault.app over the old one
  //        - removes quarantine xattrs (we just verified SHA512 ourselves)
  //        - relaunches the new LexVault.app
  //   2. Spawn that script detached, then quit.
  _spawnMacUpdater(zipPath) {
    const os = require('os')
    const appBundle = path.dirname(path.dirname(path.dirname(process.execPath)))
    // process.execPath under a packaged .app is /Path/To/LexVault.app/Contents/MacOS/LexVault
    // so .../MacOS/LexVault → ../Contents → ../LexVault.app
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexvault-update-'))
    const script = path.join(tmpDir, 'apply-update.sh')
    fs.writeFileSync(script, [
      '#!/bin/bash',
      'set -e',
      'echo "[updater] waiting for LexVault to exit"',
      'sleep 2',
      `cd "${tmpDir}"`,
      `/usr/bin/ditto -xk "${zipPath}" .`,
      'NEW_APP=$(find . -maxdepth 3 -name "*.app" -type d | head -1)',
      'if [ -z "$NEW_APP" ]; then echo "[updater] no .app in zip"; exit 1; fi',
      'echo "[updater] copying $NEW_APP over ' + appBundle + '"',
      `/usr/bin/ditto "$NEW_APP" "${appBundle}"`,
      `/usr/bin/xattr -dr com.apple.quarantine "${appBundle}" 2>/dev/null || true`,
      'echo "[updater] relaunching"',
      `/usr/bin/open "${appBundle}"`,
      'rm -rf "$0"/..',
    ].join('\n'), { mode: 0o755 })
    const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' })
    child.unref()
  }

  // Windows updater strategy:
  //   1. Write a tiny .bat that:
  //        - waits 2s for the running LexVault to exit (PID poll)
  //        - runs the NSIS installer with /S (silent — no install UI)
  //        - waits for the installer to finish
  //        - launches the freshly installed LexVault.exe
  //        - deletes itself
  //   2. Spawn that bat detached, then quit.
  //
  // Why a helper bat instead of spawning the installer directly: NSIS /S
  // mode skips the finish page that auto-launches the app, AND there's no
  // way from inside our quitting Electron process to wait for the new
  // install to land + then launch the new exe. The bat is the broker.
  _spawnWinUpdater(installerPath) {
    const os = require('os')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexvault-update-'))
    const script = path.join(tmpDir, 'apply-update.bat')

    // Where the NSIS installer puts the executable. We use perMachine:false
    // so the install dir is %LOCALAPPDATA%\Programs\LexVault\LexVault.exe.
    // electron-builder NSIS hardcodes this path when perMachine is false.
    const installedExe = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Programs', app.getName(), `${app.getName()}.exe`
    )

    const pid = process.pid
    // Batch script. CRLF line endings so cmd.exe is happy. Quotes around
    // paths handle spaces. `start "" "exe"` is the canonical way to launch
    // detached in cmd. `timeout /t N /nobreak >NUL` is the cmd sleep.
    const batLines = [
      '@echo off',
      'echo [updater] waiting for LexVault to exit (pid ' + pid + ')',
      ':waitloop',
      'tasklist /FI "PID eq ' + pid + '" 2>NUL | find /I "' + pid + '" >NUL',
      'if errorlevel 1 goto installerstart',
      'timeout /t 1 /nobreak >NUL',
      'goto waitloop',
      ':installerstart',
      'echo [updater] running installer',
      '"' + installerPath + '" /S',
      'echo [updater] launching new build',
      'timeout /t 2 /nobreak >NUL',
      'start "" "' + installedExe + '"',
      '(goto) 2>nul & del "%~f0"',
    ]
    fs.writeFileSync(script, batLines.join('\r\n') + '\r\n', { encoding: 'utf8' })

    // Spawn detached so it survives our quit. Use cmd.exe /c <script>; the
    // double-quotes around the script path are essential if tmpDir contains
    // a space.
    const child = spawn('cmd.exe', ['/c', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: false,
    })
    child.unref()
  }

  // Linux AppImage replace-in-place.
  _spawnLinuxUpdater(newAppImage) {
    const os = require('os')
    // process.env.APPIMAGE is set by AppImageLauncher when running inside
    // an AppImage. Fall back to argv[0] if missing.
    const runningAppImage = process.env.APPIMAGE || process.argv[0]
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexvault-update-'))
    const script = path.join(tmpDir, 'apply-update.sh')
    fs.writeFileSync(script, [
      '#!/bin/bash',
      'set -e',
      'sleep 2',
      `chmod +x "${newAppImage}"`,
      `cp -f "${newAppImage}" "${runningAppImage}"`,
      `chmod +x "${runningAppImage}"`,
      `nohup "${runningAppImage}" >/dev/null 2>&1 &`,
      'rm -rf "$0"/..',
    ].join('\n'), { mode: 0o755 })
    const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' })
    child.unref()
  }
}

module.exports = Updater
