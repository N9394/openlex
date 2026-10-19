"use strict"
/**
 * First-run downloads manager (SPEC §7.1 option A: small installer + the
 * plugin pulls its model, embeddings, and packs through the license server
 * on first run — same pattern as the Launcher).
 *
 * License-server endpoints (already implemented, verified 2026-08-07):
 *   GET /api/app/tiers                (public)  → model registry (filename,
 *                                                 size, sha256 per variant)
 *   GET /api/app/model/:variant       (token)   → GGUF / ONNX files
 *   GET /api/app/packs/:jur/:version  (token)   → signed .lvpack
 *   GET /api/jurisdictions            (public)  → current_pack_version
 *
 * Resume: Express sendFile honours Range, so a partially-downloaded file
 * continues from its byte offset. Every completed download is SHA-256
 * verified before it is renamed into place.
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { LICENSE_URL, DATA_DIR } = require('./config')
const { loadToken } = require('./license')

const MODELS_DIR = path.join(DATA_DIR, 'models')
const PACKS_DIR = path.join(DATA_DIR, 'packs')
const REGISTRY_PATH = path.join(DATA_DIR, 'tiers.json')

fs.mkdirSync(MODELS_DIR, { recursive: true })
fs.mkdirSync(PACKS_DIR, { recursive: true })

function licenseBase() {
  const u = new URL(LICENSE_URL)
  return `${u.protocol}//${u.host}`
}

function httpGet(urlStr, { token, range, onChunk, timeoutMs = 3600000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const headers = { 'User-Agent': 'LexVault-Word-Sidecar/0.1.0' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (range) headers.Range = `bytes=${range}-`
    const reqLib = u.protocol === 'http:' ? http : https
    const req = reqLib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'GET', headers, timeout: timeoutMs },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}: subscription check failed — log in (token) or renew your subscription`))
        }
        if (res.statusCode === 404) {
          res.resume()
          return reject(new Error('HTTP 404: not found (outdated version? refresh packs)'))
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} downloading ${u.pathname}`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        res.on('data', (c) => {
          received += c.length
          onChunk?.(c, { received, total, offset: received })
        })
        res.on('end', () => resolve({ total, received, status: res.statusCode }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('download timeout')))
    req.on('error', reject)
    req.end()
  })
}

async function fetchJson(urlStr, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const reqLib = u.protocol === 'http:' ? http : https
    const req = reqLib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {}, timeout: 20000 },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)) } catch { reject(new Error('bad JSON from ' + u.pathname)) }
          } else reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('registry timeout')))
    req.on('error', reject)
    req.end()
  })
}

function sha256OfFile(p) {
  // Streaming — readFileSync throws on files > 2 GiB (Lotus GGUF is 2.7 GB).
  const crypto = require('crypto')
  const hash = crypto.createHash('sha256')
  const data = fs.readFileSync(p) // small files only — see streamSha256 for big ones
  hash.update(data)
  return hash.digest('hex')
}

function streamSha256(p) {
  return new Promise((resolve, reject) => {
    const hash = require('crypto').createHash('sha256')
    const s = fs.createReadStream(p)
    s.on('data', (d) => hash.update(d))
    s.on('end', () => resolve(hash.digest('hex')))
    s.on('error', reject)
  })
}

// ── Tier registry (cached; etag short-circuit) ─────────────────────────────

async function fetchRegistry(force = false) {
  if (!force && fs.existsSync(REGISTRY_PATH)) {
    try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) } catch { /* refetch */ }
  }
  const reg = await fetchJson(licenseBase() + '/api/app/tiers')
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2))
  return reg
}

function modelInfo(variant) {
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    return reg.models?.[variant] || null
  } catch { return null }
}

// ── Downloads ──────────────────────────────────────────────────────────────

/**
 * Download a file from the license server to dest, resuming any existing
 * partial, streaming to onProgress, and verifying SHA-256 before rename.
 */
async function downloadFile(urlStr, dest, { token, expectedSha256, expectedSize, onProgress, what = 'file' }) {
  const partial = dest + '.partial'
  let offset = 0
  if (fs.existsSync(partial)) offset = fs.statSync(partial).size

  const emit = (received, total) => onProgress?.({
    kind: 'download-progress', what,
    received: offset + received,
    total: total ? offset + total : null,
    pct: total ? Math.round(((offset + received) / (offset + total)) * 100) : null,
  })

  const out = fs.createWriteStream(partial, { flags: offset > 0 ? 'a' : 'w' })
  try {
    await httpGet(urlStr, {
      token,
      range: offset > 0 ? offset : null,
      onChunk: (c, t) => {
        out.write(c)
        emit(t.received, t.total)
      },
    })
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())))
  } catch (err) {
    out.destroy()
    throw err
  }

  const actual = await streamSha256(partial)
  if (expectedSha256 && actual !== expectedSha256) {
    throw new Error(`${what} checksum mismatch (got ${actual.slice(0, 12)}…, expected ${expectedSha256.slice(0, 12)}…) — delete ${partial} and retry`)
  }
  fs.renameSync(partial, dest)
  onProgress?.({ kind: 'download-progress', what, received: fs.statSync(dest).size, total: fs.statSync(dest).size, pct: 100, done: true })
  return dest
}

/** Download a model variant (Lotus GGUF, bge-m3 onnx) from the registry. */
async function downloadModel(variant, opts = {}) {
  const token = opts.token || loadToken()
  if (!token) throw new Error('no login token — paste it in Settings first')
  const info = modelInfo(variant) || (await fetchRegistry(true)).models?.[variant]
  if (!info) throw new Error(`unknown model variant: ${variant}`)
  const dest = path.join(MODELS_DIR, info.filename)
  if (fs.existsSync(dest)) {
    if (info.sha256 && (await streamSha256(dest)) === info.sha256) {
      opts.onProgress?.({ kind: 'download-progress', what: variant, received: fs.statSync(dest).size, total: fs.statSync(dest).size, pct: 100, done: true, cached: true })
      return dest
    }
    fs.rmSync(dest) // corrupt/partial final file — redownload
  }
  return downloadFile(`${licenseBase()}/api/app/model/${variant}`, dest, {
    token,
    expectedSha256: info.sha256,
    expectedSize: info.size_bytes,
    onProgress: opts.onProgress,
    what: variant,
  })
}

/** Download a jurisdiction pack, then ingest it into the local Qdrant. */
async function downloadPack(jurisdiction, opts = {}) {
  const token = opts.token || loadToken()
  if (!token) throw new Error('no login token — paste it in Settings first')
  const version = opts.version || (await currentPackVersion(jurisdiction))
  if (!version) throw new Error(`no pack version known for ${jurisdiction}`)
  const dest = path.join(PACKS_DIR, `${jurisdiction.toLowerCase()}-${version}.lvpack`)
  if (fs.existsSync(dest)) {
    opts.onProgress?.({ kind: 'download-progress', what: jurisdiction, received: fs.statSync(dest).size, total: fs.statSync(dest).size, pct: 100, done: true, cached: true })
  } else {
    await downloadFile(`${licenseBase()}/api/app/packs/${jurisdiction.toLowerCase()}/${version}`, dest, {
      token, onProgress: opts.onProgress, what: jurisdiction,
    })
  }
  // Ingest (signature + sha256 verify inside pack_ingest.js) → registry.
  const { ingest } = require('./packstore')
  return ingest(dest, { archiveDir: PACKS_DIR })
}

async function currentPackVersion(jurisdiction) {
  const jurs = await fetchJson(licenseBase() + '/api/jurisdictions')
  const j = (jurs.jurisdictions || []).find((x) => x.code.toUpperCase() === String(jurisdiction).toUpperCase())
  return j?.current_pack_version || null
}

async function installedModels() {
  const out = []
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    for (const [variant, info] of Object.entries(reg.models || {})) {
      const p = path.join(MODELS_DIR, info.filename)
      const ok = fs.existsSync(p) && (!info.sha256 || (await streamSha256(p)) === info.sha256)
      out.push({ variant, filename: info.filename, installed: ok, size_bytes: info.size_bytes })
    }
  } catch { /* registry not fetched yet */ }
  return out
}

module.exports = { downloadModel, downloadPack, downloadFile, currentPackVersion, installedModels, fetchRegistry, fetchJson, modelInfo, licenseBase }
