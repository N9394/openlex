/**
 * Pack download + ingest orchestrator.
 *
 * Walks the user's license entitlements and, for each entitled jurisdiction
 * whose pack hasn't been ingested locally, downloads the .lvpack from the
 * license-server and ingests it into the local Qdrant.
 *
 * State file: <userData>/packs.json
 *   { packs: { AT: { version: "2026-04-01", ingested_at: ISO, chunk_count } } }
 *
 * The fetcher is non-blocking from the renderer's perspective — first launch
 * shows a status panel, but the App window opens before packs finish (so the
 * user can see Settings, etc.).
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { URL } = require('url')

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) return { packs: {} }
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) }
  catch { return { packs: {} } }
}

function writeState(stateFile, state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
}

function downloadPack({ server, token, jurisdiction, version, dest, onProgress }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const partPath = dest + '.part'
  let downloaded = 0
  if (fs.existsSync(partPath)) downloaded = fs.statSync(partPath).size
  if (fs.existsSync(dest)) return Promise.resolve({ skipped: true })

  const url = new URL(`/api/app/packs/${jurisdiction}/${version}`, server)
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const opts = {
      headers: { 'Authorization': `Bearer ${token}` },
    }
    if (downloaded > 0) opts.headers['Range'] = `bytes=${downloaded}-`
    // Helper: on any failure that could have left a corrupt .part on disk
    // (disk-full, mid-stream socket error, server-returned-200-but-we-asked-for-Range)
    // remove the partial so the next sync starts cleanly. Without this the
    // next run Range-appends and produces an unrecoverable corrupt file.
    const failWithCleanup = (err) => {
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch {}
      reject(err)
    }
    lib.get(url.toString(), opts, res => {
      if (res.statusCode === 416) { res.resume(); return resolve({ skipped: true }) }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume()
        return failWithCleanup(new Error(`HTTP ${res.statusCode} for ${jurisdiction}/${version}`))
      }
      // If we asked for a Range but the server returned 200 (full body), our
      // existing .part is now stale — discard and restart, otherwise the
      // appended bytes overlap the head of the new body.
      if (downloaded > 0 && res.statusCode === 200) {
        try { fs.unlinkSync(partPath) } catch {}
        downloaded = 0
      }
      const total = (parseInt(res.headers['content-length'], 10) || 0) + downloaded
      const sink = fs.createWriteStream(partPath, { flags: downloaded > 0 ? 'a' : 'w' })
      res.on('data', c => { downloaded += c.length; if (onProgress) onProgress({ downloaded, total }) })
      res.pipe(sink)
      sink.on('finish', () => sink.close(() => {
        fs.renameSync(partPath, dest)
        resolve({ skipped: false })
      }))
      sink.on('error', failWithCleanup)
      res.on('error', failWithCleanup)
    }).on('error', failWithCleanup)
  })
}

/**
 * @param {object} args
 * @param {object} args.license       license.payload
 * @param {string} args.token         lv_live_… bearer token
 * @param {string} args.server        license-server base URL
 * @param {string} args.packsDir      <userData>/packs/   — where .lvpack files land
 * @param {string} args.archiveDir    <userData>/packs/archive/ — for future re-ingest
 * @param {string} args.stateFile     <userData>/packs.json
 * @param {string} args.publicKeyPem  Ed25519 public key for verify (or null in dev)
 * @param {Function} args.emit        (event) => …  status events for renderer
 */
async function fetchCurrentVersions(server) {
  // Public endpoint — no token. Used to look up current_pack_version when
  // the user's license was issued before that field was populated.
  return new Promise((resolve, reject) => {
    const url = new URL('/api/jurisdictions', server)
    const lib = url.protocol === 'https:' ? https : http
    lib.get(url.toString(), { headers: { 'User-Agent': 'OpenLex-PackFetcher/1' } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const map = {}
          for (const j of body.jurisdictions || []) {
            if (j.code && j.current_pack_version) map[j.code] = j.current_pack_version
          }
          resolve(map)
        } catch (e) { reject(e) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// Single-flight lock — three call sites (first-launch sync, 6h recurring timer,
// IPC "download this pack" button) all hit syncPacks. Without this, the timer
// could fire while a startup ingest is still running and we'd have two ingests
// hammering the same local Qdrant + the same userdata dir. Memory pressure was
// already a problem with one in flight, two would freeze the machine outright.
let _syncInFlight = null
async function syncPacks(args) {
  if (_syncInFlight) {
    args.emit?.({ kind: 'sync-busy' })
    return _syncInFlight
  }
  _syncInFlight = _syncPacksImpl(args).finally(() => { _syncInFlight = null })
  return _syncInFlight
}

async function _syncPacksImpl({ license, token, server, packsDir, archiveDir, stateFile, publicKeyPem, emit = () => {}, onlyCode = null }) {
  const state = readState(stateFile)
  let entitlements = (license.entitlements || []).filter(e => e.type === 'jurisdiction' && e.code)

  if (onlyCode) entitlements = entitlements.filter(e => e.code === onlyCode)

  if (entitlements.length === 0) {
    emit({ kind: 'no-entitlements' })
    return { synced: 0, skipped: 0 }
  }

  // Resolve current_pack_version for any entitlement that doesn't already
  // have a version pinned in the license. Lets us re-issue packs without
  // forcing every user to re-activate.
  const needVersion = entitlements.some(e => !e.version)
  if (needVersion) {
    try {
      const versions = await fetchCurrentVersions(server)
      entitlements = entitlements.map(e => e.version ? e : { ...e, version: versions[e.code] || null })
    } catch (err) {
      console.warn('[pack-fetcher] could not look up current versions:', err.message)
    }
  }
  entitlements = entitlements.filter(e => e.version)

  // Lazy-load the pack ingester so we only require it when needed
  process.env.LEXVAULT_PUBLIC_KEY_PEM = publicKeyPem || ''
  const { ingestPack } = require('../sidecars/pack_ingest')

  let synced = 0, skipped = 0, failed = 0
  for (const ent of entitlements) {
    const code = ent.code
    const version = ent.version
    const cur = state.packs[code]
    if (cur && cur.version === version) {
      emit({ kind: 'pack-up-to-date', code, version })
      skipped++
      continue
    }

    emit({ kind: 'pack-download-start', code, version })
    const dest = path.join(packsDir, `${code.toLowerCase()}-${version}.lvpack`)

    let lastPct = -1
    try {
      await downloadPack({
        server, token, jurisdiction: code, version, dest,
        onProgress: ({ downloaded, total }) => {
          if (!total) return
          const pct = Math.round(downloaded / total * 100)
          if (pct !== lastPct && pct % 5 === 0) {
            emit({ kind: 'pack-download-progress', code, version, pct })
            lastPct = pct
          }
        },
      })
      emit({ kind: 'pack-download-done', code, version })

      emit({ kind: 'pack-ingest-start', code, version })
      // Forward sub-progress events so the renderer can show a progress bar
      // during the ingest instead of a frozen "ingesting…" status (the
      // ingest takes minutes for large jurisdictions like RO).
      const result = await ingestPack(dest, { archiveDir, emit })
      emit({ kind: 'pack-ingest-done', code, version, chunk_count: result.chunk_count })

      const previousVersion = cur?.version || null
      state.packs[code] = {
        version: result.pack_version,
        ingested_at: new Date().toISOString(),
        chunk_count: result.chunk_count,
      }
      writeState(stateFile, state)
      synced++

      // Reap superseded artifacts: stale Qdrant points + the old .lvpack
      // archive. Done after writeState so a crash here doesn't strand state.
      if (previousVersion && previousVersion !== result.pack_version) {
        try {
          const { dropStaleVersions } = require('../sidecars/pack_ingest')
          if (typeof dropStaleVersions === 'function') {
            const deleted = await dropStaleVersions(code, result.pack_version)
            console.log(`[pack-fetcher] ${code}: dropped ${deleted} stale-version points`)
          }
        } catch (e) { console.warn(`[pack-fetcher] ${code} stale-points sweep failed: ${e.message}`) }
        for (const dir of [packsDir, archiveDir]) {
          try {
            for (const f of fs.readdirSync(dir)) {
              if (f.startsWith(`${code.toLowerCase()}-`) && f.endsWith('.lvpack') && !f.includes(result.pack_version)) {
                fs.unlinkSync(path.join(dir, f))
                console.log(`[pack-fetcher] removed superseded ${f}`)
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error(`[pack-fetcher] ${code} failed:`, err.message)
      // Any failure with a .lvpack already on disk means we're stuck: the
      // file exists, so downloadPack's existence-check short-circuits the
      // re-download forever. Previously we only rm'd on a tight regex of
      // verify-failure messages; but users hit other failure modes (qdrant
      // write errors, JSON parse, disk-full mid-write, OOM kill mid-ingest)
      // where the .lvpack sticks around through every sync pass + every
      // relaunch. The .lvpack is disposable — cost of re-download is small
      // vs permanent stuck state. So: if the file exists at error time,
      // delete it and retry ONCE within this same sync pass.
      let willRetry = false
      try {
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest)
          willRetry = true
          console.log(`[pack-fetcher] removed ${dest} after error — retrying once in this sync pass`)
        }
      } catch (rmErr) {
        console.warn(`[pack-fetcher] could not remove pack after error: ${rmErr.message}`)
      }

      if (willRetry) {
        emit({ kind: 'pack-retry', code, version, error: err.message })
        try {
          await downloadPack({
            server, token, jurisdiction: code, version, dest,
            onProgress: ({ downloaded, total }) => {
              if (!total) return
              const pct = Math.round(downloaded / total * 100)
              if (pct % 10 === 0) emit({ kind: 'pack-download-progress', code, version, pct })
            },
          })
          emit({ kind: 'pack-download-done', code, version })
          emit({ kind: 'pack-ingest-start', code, version })
          const result = await ingestPack(dest, { archiveDir, emit })
          emit({ kind: 'pack-ingest-done', code, version, chunk_count: result.chunk_count })
          state.packs[code] = {
            version: result.pack_version,
            ingested_at: new Date().toISOString(),
            chunk_count: result.chunk_count,
          }
          writeState(stateFile, state)
          synced++
          continue
        } catch (retryErr) {
          console.error(`[pack-fetcher] ${code} retry also failed:`, retryErr.message)
          // Leave the retry's .lvpack on disk only if it exists and the
          // retry's error is clearly a network-level (transient) issue;
          // otherwise nuke it too so the next syncPacks pass starts clean.
          if (!/HTTP 50\d|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang/i.test(retryErr.message)) {
            try { if (fs.existsSync(dest)) fs.unlinkSync(dest) } catch {}
          }
          emit({ kind: 'pack-error', code, version, error: retryErr.message })
          failed++
          continue
        }
      }
      emit({ kind: 'pack-error', code, version, error: err.message })
      failed++
    }
  }

  emit({ kind: 'sync-complete', synced, skipped, failed })
  return { synced, skipped, failed }
}

module.exports = { syncPacks, readState }
