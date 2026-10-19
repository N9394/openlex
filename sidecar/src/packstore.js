"use strict"
/**
 * Pack store — discovery + ingest + installed-state registry.
 *
 * Packs are the immutable shared DB. This module:
 *  1. scans shared userData dirs for *.lvpack
 *  2. ingests into the local Qdrant (legal_chunks_local) via the App's
 *     proven pack_ingest.js (signature + sha256 verify, binary quantization)
 *  3. records installed (jurisdiction, version, chunk_count) in a registry
 *     so the add-in can show what's live without re-scanning Qdrant
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { USERDATA_DIRS } = require('./config')
const { ingestPack: ingestIntoQdrant } = require('./pack_ingest')

const REGISTRY_PATH = path.join(os.homedir(), '.lexvault', 'pack-registry.json')

function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) } catch { return { installed: {} } }
}

function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2))
}

function scanPacks() {
  const packs = []
  const seen = new Set()
  for (const dir of USERDATA_DIRS) {
    const packsDir = path.join(dir, 'packs')
    if (!fs.existsSync(packsDir)) continue
    for (const f of fs.readdirSync(packsDir)) {
      if (!f.endsWith('.lvpack')) continue
      if (seen.has(f)) continue
      seen.add(f)
      const stat = fs.statSync(path.join(packsDir, f))
      const m = f.match(/^([a-z-]+)-(.+)\.lvpack$/i)
      packs.push({
        filename: f,
        jurisdiction: (m?.[1] || '?').toUpperCase(),
        version: m?.[2] || '?',
        size_bytes: stat.size,
        size_mb: Math.round(stat.size / 1024 / 1024),
        modified: stat.mtime.toISOString(),
        dir,
      })
    }
  }
  return packs
}

/**
 * Ingest a pack into the local Qdrant. Verifies signature/checksums first
 * (pack_ingest.js), then records the registry entry.
 */
async function ingest(filePath, opts = {}) {
  const result = await ingestIntoQdrant(filePath, {
    emit: opts.onProgress,
    archiveDir: opts.archiveDir, // keep the lvpack for resilience
    directoriesDir: opts.directoriesDir,
  })
  const reg = loadRegistry()
  reg.installed[result.jurisdiction] = { version: result.pack_version, chunk_count: result.chunk_count, ingested_at: new Date().toISOString() }
  saveRegistry(reg)
  return result
}

function installedJurisdictions() {
  const reg = loadRegistry()
  return Object.entries(reg.installed).map(([code, info]) => ({ code, ...info }))
}

/**
 * Remove an installed jurisdiction: drop its points from the local Qdrant
 * (payload filter on the indexed `jurisdiction` field), delete the .lvpack
 * file(s) and the citation directory, and clear the registry entry.
 *
 * @returns {Promise<{jurisdiction, points_deleted, files_deleted}>}
 */
async function removePack(jurisdiction, opts = {}) {
  const code = String(jurisdiction).toUpperCase()
  const reg = loadRegistry()
  if (!reg.installed[code]) throw new Error(`pack not installed: ${code}`)

  const { QDRANT_BASE, QDRANT_COLLECTION } = require('./config')
  const deleted = await new Promise((resolve, reject) => {
    const http = require('http')
    const u = new URL(QDRANT_BASE)
    const body = JSON.stringify({ filter: { must: [{ key: 'jurisdiction', match: { value: code } }] } })
    const req = http.request(
      { host: u.hostname, port: u.port || 80, method: 'POST', path: `/collections/${QDRANT_COLLECTION}/points/delete?wait=true`,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 120000 },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text).result || 0) } catch { resolve(0) }
          } else reject(new Error(`Qdrant delete HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('Qdrant delete timeout')))
    req.on('error', reject)
    req.end(body)
  })

  // Remove the .lvpack + citation directory for this jurisdiction.
  const filesDeleted = []
  for (const dir of USERDATA_DIRS) {
    const packsDir = path.join(dir, 'packs')
    if (!fs.existsSync(packsDir)) continue
    for (const f of fs.readdirSync(packsDir)) {
      if (!f.toLowerCase().startsWith(code.toLowerCase() + '-') && !f.toLowerCase().startsWith(code.toLowerCase() + '.')) continue
      if (!f.endsWith('.lvpack')) continue
      try { fs.unlinkSync(path.join(packsDir, f)); filesDeleted.push(f) } catch {}
    }
    // citation directory (pack_ingest writes <code>-directory.sqlite)
    const dirsDir = path.join(dir, 'packs', 'directories')
    if (fs.existsSync(dirsDir)) {
      const dirFile = path.join(dirsDir, `${code.toLowerCase()}-directory.sqlite`)
      try { if (fs.existsSync(dirFile)) { fs.unlinkSync(dirFile); filesDeleted.push(path.basename(dirFile)) } } catch {}
    }
  }

  delete reg.installed[code]
  saveRegistry(reg)
  console.log(`[packstore] removed ${code}: ${deleted} points, ${filesDeleted.join(', ') || 'no files'}`)
  return { jurisdiction: code, points_deleted: deleted, files_deleted: filesDeleted }
}

module.exports = { scanPacks, ingest, removePack, installedJurisdictions }
