/**
 * Local-pack ingest for the Electron App.
 *
 * Called by the App's UI (or directly by the supervisor on first launch)
 * with the path to a downloaded `.lvpack` archive. Verifies signature,
 * unpacks, upserts into the local Qdrant collection with binary
 * quantization config so on-device retrieval stays fast and small.
 *
 * Server-side counterpart: data-packager/build_pack.py
 * Format spec:               DATA_PACKAGING.md
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const QDRANT_LOCAL_URL = process.env.LEXVAULT_LOCAL_QDRANT_URL || 'http://127.0.0.1:16333'
const COLLECTION = process.env.LEXVAULT_LOCAL_COLLECTION || 'legal_chunks_local'
const PUBLIC_KEY_PEM = process.env.LEXVAULT_PUBLIC_KEY_PEM || null

const VECTOR_DIM = 1024
const BINARY_BYTES = VECTOR_DIM / 8 // 128

// Qdrant point ids must be unsigned integers OR canonical UUIDs. Some packs
// (US, US-CA) store chunk_id as a long hex hash string — that's neither, so
// the upsert HTTP-400s. Normalize:
//   - integer / numeric string → unchanged
//   - 32-hex char → format as 8-4-4-4-12 UUID
//   - anything else → md5 → format as 8-4-4-4-12 UUID
// The original chunk_id is preserved separately in the payload, so search
// results still reference the upstream identifier.
function toQdrantId(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw
  if (typeof raw === 'string') {
    if (/^\d+$/.test(raw)) {
      const n = Number(raw)
      if (Number.isSafeInteger(n) && n >= 0) return n
    }
    // Already UUID-shaped (with or without dashes, 32 hex)
    const hexOnly = raw.replace(/-/g, '').toLowerCase()
    if (/^[0-9a-f]{32}$/.test(hexOnly)) {
      return `${hexOnly.slice(0,8)}-${hexOnly.slice(8,12)}-${hexOnly.slice(12,16)}-${hexOnly.slice(16,20)}-${hexOnly.slice(20)}`
    }
  }
  // Fallback: deterministic md5 of the stringified raw, formatted as UUID.
  const h = crypto.createHash('md5').update(String(raw)).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

// ── Pack verification ───────────────────────────────────────────────────────

function readManifest(unpackedDir) {
  const m = JSON.parse(fs.readFileSync(path.join(unpackedDir, 'manifest.json'), 'utf8'))
  if (m.format_version !== 1) throw new Error(`unsupported pack format ${m.format_version}`)
  if (m.vector_dim !== VECTOR_DIM) throw new Error(`unexpected vector dim ${m.vector_dim}`)
  return m
}

function sha256OfFile(p) {
  const h = crypto.createHash('sha256')
  const buf = fs.readFileSync(p)
  h.update(buf)
  return h.digest('hex')
}

function verifyFiles(manifest, unpackedDir) {
  for (const [name, info] of Object.entries(manifest.files)) {
    const p = path.join(unpackedDir, name)
    if (!fs.existsSync(p)) throw new Error(`missing ${name} from pack`)
    const stat = fs.statSync(p)
    if (stat.size !== info.size) throw new Error(`${name} size mismatch (${stat.size} vs ${info.size})`)
    const actual = sha256OfFile(p)
    if (actual !== info.sha256) throw new Error(`${name} checksum mismatch`)
  }
}

function verifySignature(manifest, unpackedDir) {
  if (!PUBLIC_KEY_PEM) {
    console.warn('[pack_ingest] no public key embedded — skipping signature verify (DEV ONLY)')
    return
  }
  const sigPath = path.join(unpackedDir, 'signature.ed25519')
  if (!fs.existsSync(sigPath)) throw new Error('missing signature.ed25519')
  const sig = fs.readFileSync(sigPath)
  const payload = Object.keys(manifest.files).sort()
    .map(name => `${name}\0${manifest.files[name].sha256}`)
    .join('\n')
  const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM)
  const ok = crypto.verify(null, Buffer.from(payload, 'utf8'), publicKey, sig)
  if (!ok) throw new Error('signature did NOT verify — refusing to ingest')
}

// ── Untar ──────────────────────────────────────────────────────────────────

function untar(packPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  // Native zstd may or may not be available; tar with --zstd if it is
  const r = spawnSync('tar', ['--zstd', '-xf', packPath, '-C', destDir], { stdio: 'pipe' })
  if (r.status === 0) return
  // Fallback: `zstd -d` to a temporary .tar, then tar. Arguments only —
  // never a shell, so a file name cannot run commands.
  const tmpTar = path.join(destDir, '.openlex-pack.tar')
  try {
    const z = spawnSync('zstd', ['-d', '-q', '-f', '-o', tmpTar, '--', packPath], { stdio: 'pipe' })
    if (z.status === 0 && spawnSync('tar', ['-xf', tmpTar, '-C', destDir], { stdio: 'pipe' }).status === 0) return
  } finally { try { fs.rmSync(tmpTar, { force: true }) } catch { /* gone */ } }
  throw new Error(`failed to extract ${packPath} (no zstd or tar in PATH?)`)
}

// ── Local Qdrant calls ─────────────────────────────────────────────────────

async function qdrant(method, urlPath, body = null) {
  const url = QDRANT_LOCAL_URL + urlPath
  // Native fetch defaults to ~5 min total + ~30s idle. During US/US-CA
  // pack ingest (467k / 284k chunks) Qdrant's HNSW indexer holds the
  // upsert thread for tens of seconds per batch, which trips the idle
  // timeout and surfaces in the UI as "Error: fetch failed". A 15-min
  // hard ceiling + retry-with-backoff is way more than enough.
  const init = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== null) init.body = JSON.stringify(body)
  // AbortController lets us extend the timeout beyond fetch's default.
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15 * 60 * 1000)
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal })
      clearTimeout(timer)
      const text = await res.text()
      let parsed; try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
      if (!res.ok) throw new Error(`qdrant ${method} ${urlPath} HTTP ${res.status}: ${text.slice(0, 200)}`)
      return parsed
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      // Retry only on transient network-like errors; 4xx/HTTP errors bubble.
      if (/HTTP \d+/.test(err.message)) throw err
      const wait = 2000 * Math.pow(2, attempt)
      console.warn(`[pack_ingest] qdrant ${method} ${urlPath} attempt ${attempt + 1}/3 failed (${err.message}); retrying in ${wait}ms`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr || new Error(`qdrant ${method} ${urlPath} failed after retries`)
}

async function ensureCollection() {
  // Probe via the qdrant() helper so we get a proper status check (not the
  // raw fetch from before, which silently swallowed network blips and could
  // race into a duplicate PUT → 409 "Collection already exists").
  try {
    await qdrant('GET', `/collections/${COLLECTION}`)
    return  // exists
  } catch (e) {
    // Only fall through to PUT if the probe said the collection is missing.
    // Any other error (network, auth, etc.) we re-raise so we don't blindly
    // try to create a collection that already exists.
    if (!/HTTP 404/.test(e.message)) {
      // Probe failed for some other reason — but the collection MIGHT exist.
      // Try PUT as a best effort; if it 409s, treat that as success too.
      try {
        await qdrant('PUT', `/collections/${COLLECTION}`, {
          vectors: { dense: { size: VECTOR_DIM, distance: 'Cosine' } },
          sparse_vectors: { sparse: {} },
          quantization_config: { binary: { always_ram: true } },
          optimizers_config: { default_segment_number: 4 },
        })
      } catch (e2) {
        if (!/HTTP 409/.test(e2.message) && !/already exists/i.test(e2.message)) throw e2
      }
      return
    }
  }
  // Collection doesn't exist — create it. Treat 409 as success in case of
  // a parallel ingest (rare but possible if syncPacks is invoked twice).
  try {
    await qdrant('PUT', `/collections/${COLLECTION}`, {
      vectors: { dense: { size: VECTOR_DIM, distance: 'Cosine', on_disk: true } },
      sparse_vectors: { sparse: {} },
      quantization_config: { binary: { always_ram: true } },
      optimizers_config: {
        default_segment_number: 4,
        // Default indexing_threshold is 20k vectors. Smaller packs (AT 66k
        // = 4 segments × 16k each — below threshold!) end up without HNSW
        // built, and quantized-only queries against unindexed segments can
        // miss valid matches. Force HNSW to build as soon as 1k vectors
        // land in a segment so search works immediately after ingest.
        indexing_threshold: 1000,
      },
    })
  } catch (e) {
    if (!/HTTP 409/.test(e.message) && !/already exists/i.test(e.message)) throw e
  }
  // Payload index for fast jurisdiction filtering. PUT is idempotent on
  // Qdrant's side, but wrap in try anyway in case the index already exists.
  try {
    await qdrant('PUT', `/collections/${COLLECTION}/index`, {
      field_name: 'jurisdiction',
      field_schema: 'keyword',
    })
  } catch (e) {
    if (!/HTTP 4\d\d/.test(e.message)) throw e
  }

  // PATCH optimizer config on every call — fixes collections that were
  // created with old defaults (indexing_threshold=20000 → AT/CY/CZ
  // segments stayed un-indexed → points/query returned nothing). Safe to
  // re-apply because Qdrant treats this as idempotent.
  try {
    await qdrant('PATCH', `/collections/${COLLECTION}`, {
      optimizers_config: {
        default_segment_number: 4,
        indexing_threshold: 1000,
      },
    })
  } catch (e) {
    console.warn(`[pack_ingest] optimizer PATCH failed (non-fatal): ${e.message}`)
  }
}

// ── Vector unpacking ───────────────────────────────────────────────────────

function readBinaryVectorsAsFloats(buf, count) {
  // Each chunk has 128 bytes of packed bits → unpack to 1024 floats {-1, +1}.
  // Local Qdrant uses these as the dense input; binary quantization stays
  // implicit because we declared `quantization_config.binary` on the
  // collection. The on-disk float storage is what we still ship for the
  // rescore phase to use, but most of the index work is binary.
  const out = new Array(count)
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(VECTOR_DIM)
    for (let b = 0; b < BINARY_BYTES; b++) {
      const byte = buf[i * BINARY_BYTES + b]
      for (let bit = 0; bit < 8; bit++) {
        const isOne = (byte >> (7 - bit)) & 1
        v[b * 8 + bit] = isOne ? 1.0 : -1.0
      }
    }
    out[i] = v
  }
  return out
}

function readSparseVectors(buf, count) {
  const out = new Array(count)
  let off = 0
  for (let i = 0; i < count; i++) {
    if (off + 4 > buf.length) throw new Error('sparse stream truncated')
    const n = buf.readUInt32LE(off); off += 4
    const indices = []
    const values = []
    for (let j = 0; j < n; j++) {
      indices.push(buf.readUInt32LE(off)); off += 4
      values.push(buf.readFloatLE(off)); off += 4
    }
    out[i] = { indices, values }
  }
  return out
}

// ── Parquet reader ─────────────────────────────────────────────────────────
// Pure-JS read via hyparquet (no Python, no native deps). Supports the ZSTD
// compression that build_pack.py uses for chunks.parquet.

async function readParquetRows(parquetPath) {
  // hyparquet ships ESM; load via dynamic import so this CommonJS module
  // can stay CommonJS (rest of supervisor + main expects require()).
  const { parquetReadObjects } = await import('hyparquet')
  const { compressors } = await import('hyparquet-compressors')
  const buf = fs.readFileSync(parquetPath)
  // hyparquet expects an AsyncBuffer-shaped object: { byteLength, slice(start, end) }
  const file = {
    byteLength: buf.byteLength,
    slice: async (start, end) => buf.subarray(start, end ?? buf.byteLength).buffer.slice(
      buf.subarray(start, end ?? buf.byteLength).byteOffset,
      buf.subarray(start, end ?? buf.byteLength).byteOffset + buf.subarray(start, end ?? buf.byteLength).byteLength
    ),
  }
  const rows = await parquetReadObjects({ file, compressors })
  return rows
}

// ── Main ingest ────────────────────────────────────────────────────────────

async function ingestPack(packPath, opts = {}) {
  if (!fs.existsSync(packPath)) throw new Error(`no pack at ${packPath}`)
  const callerWorkDir = !!opts.workDir
  const workDir = opts.workDir || fs.mkdtempSync(path.join(require('os').tmpdir(), 'lvpack-'))
  try {
  console.log(`[pack_ingest] extracting ${packPath} → ${workDir}`)
  untar(packPath, workDir)

  const manifest = readManifest(workDir)
  console.log(`[pack_ingest] manifest: ${manifest.jurisdiction} v${manifest.pack_version} (${manifest.chunk_count} chunks)`)
  verifyFiles(manifest, workDir)
  verifySignature(manifest, workDir)

  await ensureCollection()

  const expected = manifest.chunk_count
  const densePath = path.join(workDir, 'dense.bin')
  const sparsePath = path.join(workDir, 'sparse.bin')
  const denseStat = fs.statSync(densePath)
  if (denseStat.size !== expected * BINARY_BYTES) {
    throw new Error(`dense.bin size mismatch (got ${denseStat.size}, expected ${expected * BINARY_BYTES})`)
  }

  // Pack ingest used to slurp dense.bin (170MB) → expand into a 5.4GB
  // Float32Array[], slurp sparse.bin (~800MB) as JS objects, slurp the
  // parquet rows (~2-4GB), THEN start upserting. On Win/Mac with 8-16GB
  // RAM the user's machine froze. Now we stream: pre-scan sparse.bin once
  // to record per-row byte offsets, then for each upsert batch read just
  // that batch's slice of dense.bin (≈16KB) + sparse.bin (≈variable but
  // KB-scale) and expand to floats transiently. Parquet rows still load
  // at once but we null out each row after upserting to release the
  // ~2KB content string for GC.
  console.log(`[pack_ingest] scanning sparse.bin offsets…`)
  const sparseOffsets = new Float64Array(expected + 1) // 64-bit safe for any pack size
  {
    const fd = fs.openSync(sparsePath, 'r')
    const header = Buffer.alloc(4)
    let off = 0
    try {
      for (let i = 0; i < expected; i++) {
        sparseOffsets[i] = off
        const r = fs.readSync(fd, header, 0, 4, off)
        if (r !== 4) throw new Error(`sparse.bin truncated at row ${i}`)
        const n = header.readUInt32LE(0)
        off += 4 + n * 8
      }
      sparseOffsets[expected] = off
      const sparseStat = fs.fstatSync(fd)
      if (off !== sparseStat.size) {
        console.warn(`[pack_ingest] sparse.bin tail mismatch: scanned ${off}, file ${sparseStat.size}`)
      }
    } finally { fs.closeSync(fd) }
  }

  const rows = await readParquetRows(path.join(workDir, 'chunks.parquet'))
  if (rows.length !== expected) {
    throw new Error(`parquet rows ${rows.length} != manifest count ${expected}`)
  }

  // Smaller batches + per-batch yield. Two goals:
  //   1. Cap transient JS heap (Float32Array per chunk × 64 = ~256KB hot).
  //   2. Spread Qdrant write pressure so the disk I/O bandwidth isn't pegged
  //      at 100% during ingest — user's machine stays responsive for browsing
  //      while RO etc. ingests in the background.
  const BATCH = 64
  const denseFd = fs.openSync(densePath, 'r')
  const sparseFd = fs.openSync(sparsePath, 'r')
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let inserted = 0
  try {
    for (let i = 0; i < expected; i += BATCH) {
      const end = Math.min(i + BATCH, expected)
      const n = end - i

      // Read this batch's dense slice (n × 128 bytes)
      const denseSlice = Buffer.alloc(n * BINARY_BYTES)
      fs.readSync(denseFd, denseSlice, 0, denseSlice.length, i * BINARY_BYTES)

      // Read this batch's sparse slice using the pre-scanned offset table
      const sparseStart = sparseOffsets[i]
      const sparseEnd = sparseOffsets[end]
      const sparseLen = sparseEnd - sparseStart
      const sparseSlice = Buffer.alloc(sparseLen)
      if (sparseLen > 0) {
        fs.readSync(sparseFd, sparseSlice, 0, sparseLen, sparseStart)
      }

      const points = new Array(n)
      let sparseCursor = 0
      for (let j = 0; j < n; j++) {
        const row = rows[i + j]
        const vec = new Float32Array(VECTOR_DIM)
        for (let b = 0; b < BINARY_BYTES; b++) {
          const byte = denseSlice[j * BINARY_BYTES + b]
          for (let bit = 0; bit < 8; bit++) {
            vec[b * 8 + bit] = ((byte >> (7 - bit)) & 1) ? 1.0 : -1.0
          }
        }
        const sparseN = sparseSlice.readUInt32LE(sparseCursor); sparseCursor += 4
        const indices = new Array(sparseN)
        const values = new Array(sparseN)
        for (let k = 0; k < sparseN; k++) {
          indices[k] = sparseSlice.readUInt32LE(sparseCursor); sparseCursor += 4
          values[k] = sparseSlice.readFloatLE(sparseCursor); sparseCursor += 4
        }
        points[j] = {
          id: toQdrantId(row.chunk_id),
          vector: { dense: Array.from(vec), sparse: { indices, values } },
          payload: {
            chunk_id: row.chunk_id,
            content: row.content,
            source_name: row.source_name,
            source_type: row.source_type,
            jurisdiction: row.jurisdiction,
            pack_version: manifest.pack_version,
          },
        }
        rows[i + j] = null // drop row reference so GC can reclaim content string
      }

      await qdrant('PUT', `/collections/${COLLECTION}/points?wait=false`, { points })
      inserted += n

      // Yield 25ms after EVERY batch (not every 10th). Two effects: (a) the
      // event loop runs so the renderer + heartbeat pings stay responsive,
      // (b) Qdrant gets a brief breather between writes so the optimizer can
      // flush segments to disk without queuing up multi-GB of dirty pages.
      // Adds ~30s to a 1.3M-chunk ingest, removes the 100% disk pin entirely.
      await sleep(25)

      if (inserted % (BATCH * 20) === 0 || inserted === expected) {
        console.log(`[pack_ingest]   upserted ${inserted}/${expected}`)
        opts.emit?.({
          kind: 'pack-ingest-progress',
          code: manifest.jurisdiction,
          version: manifest.pack_version,
          inserted,
          total: expected,
        })
      }
    }
  } finally {
    fs.closeSync(denseFd)
    fs.closeSync(sparseFd)
  }

  // (We don't call any explicit "wait for indexing" endpoint — Qdrant has
  // no such top-level RPC. Older code posted to /collections/X/index?wait=true
  // which Qdrant returns 404 for. The upsert above already used wait=false;
  // points become queryable within ~1 s of optimizer settle.  If we ever need
  // a hard barrier, switch the upsert query param to wait=true.)

  // Move the original .lvpack into a stable location (resilience: rebuild
  // local Qdrant from disk without re-downloading).
  const archiveDir = opts.archiveDir
  if (archiveDir) {
    fs.mkdirSync(archiveDir, { recursive: true })
    const target = path.join(archiveDir, path.basename(packPath))
    fs.copyFileSync(packPath, target)
  }

  // Citation directory (Layer 3): copy the SQLite file to a stable path
  // so the App's citation-verification code can open it lazily. Per-
  // jurisdiction file at userData/packs/directories/<code>-directory.sqlite.
  // Older packs (< 2026-05-11) didn't ship this — code that consumes it
  // must tolerate the file being missing.
  const dirSrc = path.join(workDir, 'directory.sqlite')
  if (fs.existsSync(dirSrc)) {
    const dirDestDir = opts.directoriesDir
      || path.join(path.dirname(opts.archiveDir || workDir), 'directories')
    fs.mkdirSync(dirDestDir, { recursive: true })
    const dirDest = path.join(dirDestDir, `${manifest.jurisdiction.toLowerCase()}-directory.sqlite`)
    fs.copyFileSync(dirSrc, dirDest)
    console.log(`[pack_ingest] citation directory → ${dirDest} (${(fs.statSync(dirDest).size / 1024 / 1024).toFixed(1)} MB)`)
  }

  return {
    jurisdiction: manifest.jurisdiction,
    pack_version: manifest.pack_version,
    chunk_count: expected,
  }
  } finally {
    // Reclaim the ~3GB of extracted parquet/binary files in /tmp so we don't
    // accumulate one tempdir per ingested jurisdiction. Caller-supplied
    // workDirs are NOT removed (caller owns the lifecycle).
    if (!callerWorkDir) {
      try { fs.rmSync(workDir, { recursive: true, force: true }) }
      catch (e) { console.warn(`[pack_ingest] tempdir cleanup failed: ${e.message}`) }
    }
  }
}

async function deleteJurisdiction(code) {
  await qdrant('POST', `/collections/${COLLECTION}/points/delete`, {
    filter: { must: [{ key: 'jurisdiction', match: { value: code } }] },
  })
}

// Delta cleanup: after ingesting a newer pack_version, remove any leftover
// points from the prior version. Same-id upserts naturally overwrite, but
// chunks that existed only in the old pack would orphan otherwise.
async function dropStaleVersions(code, keepVersion) {
  const res = await qdrant('POST', `/collections/${COLLECTION}/points/delete`, {
    filter: {
      must: [{ key: 'jurisdiction', match: { value: code } }],
      must_not: [{ key: 'pack_version', match: { value: keepVersion } }],
    },
    wait: true,
  })
  return res?.result?.operation_id ? 1 : 0
}

module.exports = { ingestPack, deleteJurisdiction, dropStaleVersions }

// NOTE: This file is shared with the Electron App (product/electron/sidecars/
// pack_ingest.js). Keep both in sync when changing ingest behavior.
