"use strict"
/**
 * Firm library — the firm's own documents (precedents, templates, know-how,
 * past matters) indexed locally and searchable by the agent.
 *
 *   ~/.lexvault/library.json   { folders: [{ path, matterId }], files: { <path>: { hash, chunks, matterId } } }
 *   Qdrant collection firm_library (dense + sparse, same embedder as law search)
 *
 * - Everything stays on the machine: local embeddings, local Qdrant.
 * - A folder is firm-wide (matterId '') or belongs to one matter; a search
 *   inside a matter sees that matter's folders plus the firm-wide ones.
 * - Incremental: files are re-indexed only when their content hash changes;
 *   deleted files are removed from the index. Folders can be watched.
 * - Formats: .docx, .pdf (text layer; scanned PDFs are reported), .txt, .md.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DATA_DIR, QDRANT_BASE } = require('./config')
const { docxText } = require('./docx_text')
const { pdfText } = require('./pdf_text')

const STATE_PATH = path.join(DATA_DIR, 'library.json')
const COLLECTION = process.env.OPENLEX_LIBRARY_COLLECTION || 'firm_library'
const EXTS = new Set(['.docx', '.pdf', '.txt', '.md'])
const MAX_FILE_BYTES = 20 * 1024 * 1024
const CHUNK_CHARS = 1200
const CHUNK_OVERLAP = 150
const EMBED_BATCH = 16

let embedImpl = (texts) => require('./embeddings').embedQueries(texts)
let qdrantBase = QDRANT_BASE

/** Tests inject a deterministic embedder / Qdrant URL. */
function _configure({ embed, qdrant } = {}) {
  if (embed) embedImpl = embed
  if (qdrant) qdrantBase = qdrant
}

// ── state ────────────────────────────────────────────────────────────────
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return { folders: Array.isArray(s.folders) ? s.folders : [], files: s.files && typeof s.files === 'object' ? s.files : {} }
  } catch { return { folders: [], files: {} } }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  const tmp = `${STATE_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, STATE_PATH)
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(require('os').homedir(), p.slice(1)) : p
}

function addFolder(folder, matterId = '') {
  const abs = path.resolve(expandHome(String(folder || '').trim()))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`not a folder: ${abs}`)
  const s = readState()
  s.folders = s.folders.filter((f) => f.path !== abs)
  s.folders.push({ path: abs, matterId: matterId || '', addedAt: new Date().toISOString() })
  writeState(s)
  return abs
}

async function removeFolder(folder) {
  const abs = path.resolve(expandHome(folder))
  const s = readState()
  s.folders = s.folders.filter((f) => f.path !== abs)
  for (const file of Object.keys(s.files)) {
    if (file.startsWith(abs + path.sep)) {
      await deleteFilePoints(file)
      delete s.files[file]
    }
  }
  writeState(s)
}

// ── qdrant ───────────────────────────────────────────────────────────────
async function q(method, pathname, body) {
  const res = await fetch(qdrantBase + pathname, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`qdrant ${method} ${pathname} → HTTP ${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

async function ensureCollection(dim) {
  try { await q('GET', `/collections/${COLLECTION}`); return } catch (e) { if (!/HTTP 404/.test(e.message)) throw e }
  try {
    await q('PUT', `/collections/${COLLECTION}`, {
      vectors: { dense: { size: dim, distance: 'Cosine' } },
      sparse_vectors: { sparse: {} },
    })
  } catch (e) { if (!/HTTP 409|already exists/i.test(e.message)) throw e }
  for (const field of ['path', 'matterId']) {
    try { await q('PUT', `/collections/${COLLECTION}/index`, { field_name: field, field_schema: 'keyword' }) } catch { /* optional */ }
  }
}

async function deleteFilePoints(file) {
  try {
    await q('POST', `/collections/${COLLECTION}/points/delete?wait=true`, { filter: { must: [{ key: 'path', match: { value: file } }] } })
  } catch (e) { if (!/HTTP 404/.test(e.message)) throw e }
}

// ── parsing + chunking ───────────────────────────────────────────────────
async function fileText(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.docx') return docxText(file)
  if (ext === '.pdf') return pdfText(file)
  return fs.readFileSync(file, 'utf8')
}

/** Paragraph-aware chunks of ~CHUNK_CHARS with a small overlap. */
function chunkText(text) {
  const paras = text.split(/\n\s*\n|\n(?=\s*(?:§|Art\.|Article|Section|\d+\.)\s)/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > CHUNK_CHARS) {
      chunks.push(cur)
      cur = cur.slice(-CHUNK_OVERLAP) + '\n\n' + p
    } else {
      cur = cur ? cur + '\n\n' + p : p
    }
    while (cur.length > CHUNK_CHARS * 1.5) {
      chunks.push(cur.slice(0, CHUNK_CHARS))
      cur = cur.slice(CHUNK_CHARS - CHUNK_OVERLAP)
    }
  }
  if (cur.trim()) chunks.push(cur)
  return chunks
}

const pointId = (file, i) => {
  const h = crypto.createHash('sha1').update(`${file}#${i}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function walk(dir, out = []) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue // hidden + Word lock files
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

async function indexFile(file, matterId) {
  const text = await fileText(file)
  // Clause library: deterministic, no model — kept in step with the index.
  try { require('./clauses').updateFile(file, text, matterId) } catch (err) { console.warn('[library] clauses:', err.message) }
  const chunks = chunkText(text)
  await deleteFilePoints(file)
  if (!chunks.length) return 0
  const title = path.basename(file)
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH)
    const vecs = await embedImpl(batch)
    if (i === 0) await ensureCollection(vecs[0].dense.length)
    const points = batch.map((c, j) => {
      const v = vecs[j]
      const vector = { dense: v.dense }
      if (v.sparse?.indices?.length) vector.sparse = v.sparse
      return { id: pointId(file, i + j), vector, payload: { path: file, title, chunk_index: i + j, text: c, matterId: matterId || '' } }
    })
    await q('PUT', `/collections/${COLLECTION}/points?wait=true`, { points })
  }
  return chunks.length
}

/**
 * Bring the index in line with the folders: new/changed files indexed,
 * deleted files removed. Returns counts; per-file errors don't stop the run.
 */
async function sync({ onProgress } = {}) {
  const s = readState()
  const seen = new Set()
  const stats = { indexed: 0, unchanged: 0, removed: 0, chunks: 0, errors: [] }
  for (const folder of s.folders) {
    for (const file of walk(folder.path)) {
      seen.add(file)
      try {
        const st = fs.statSync(file)
        if (st.size > MAX_FILE_BYTES) { stats.errors.push(`${file}: larger than 20 MB, skipped`); continue }
        const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
        const prev = s.files[file]
        if (prev && prev.hash === hash && prev.matterId === folder.matterId) { stats.unchanged++; continue }
        const n = await indexFile(file, folder.matterId)
        s.files[file] = { hash, chunks: n, matterId: folder.matterId, indexedAt: new Date().toISOString() }
        stats.indexed++
        stats.chunks += n
        onProgress?.({ file, chunks: n })
        writeState(s) // checkpoint: a crash mid-sync doesn't redo finished files
      } catch (err) {
        stats.errors.push(`${path.basename(file)}: ${err.message}`)
      }
    }
  }
  for (const file of Object.keys(s.files)) {
    if (!seen.has(file)) {
      try { await deleteFilePoints(file) } catch (err) { stats.errors.push(`${path.basename(file)}: ${err.message}`); continue }
      require('./clauses').removeFile(file)
      delete s.files[file]
      stats.removed++
    }
  }
  writeState(s)
  return stats
}

/** Hybrid search, scoped to a matter's folders + firm-wide folders. */
async function search(query, { matterId = null, limit = 6 } = {}) {
  const [v] = await embedImpl([query])
  const filter = { must: [{ key: 'matterId', match: { any: matterId ? ['', matterId] : [''] } }] }
  const legs = [q('POST', `/collections/${COLLECTION}/points/search`, { vector: { name: 'dense', vector: v.dense }, limit: limit * 2, with_payload: true, filter })]
  if (v.sparse?.indices?.length) {
    legs.push(q('POST', `/collections/${COLLECTION}/points/search`, { vector: { name: 'sparse', vector: v.sparse }, limit: limit * 2, with_payload: true, filter }))
  }
  let lists
  try { lists = (await Promise.all(legs)).map((r) => r.result || []) } catch (e) {
    if (/HTTP 404/.test(e.message)) return [] // nothing indexed yet
    throw e
  }
  const score = new Map()
  const byId = new Map()
  for (const list of lists) {
    list.forEach((r, rank) => {
      score.set(r.id, (score.get(r.id) || 0) + 1 / (60 + rank + 1))
      byId.set(r.id, r)
    })
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => {
    const p = byId.get(id).payload
    return { path: p.path, title: p.title, chunk: p.chunk_index, text: p.text, matterId: p.matterId || null }
  })
}

function status() {
  const s = readState()
  const files = Object.values(s.files)
  return {
    folders: s.folders,
    files: files.length,
    chunks: files.reduce((n, f) => n + (f.chunks || 0), 0),
    formats: [...EXTS],
  }
}

// ── watching ─────────────────────────────────────────────────────────────
const watchers = new Map()
function watchAll({ debounceMs = 3000, onSync } = {}) {
  for (const w of watchers.values()) w.close()
  watchers.clear()
  let timer = null
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(() => sync().then((r) => onSync?.(r)).catch((err) => console.warn('[library] sync failed:', err.message)), debounceMs)
  }
  for (const f of readState().folders) {
    try { watchers.set(f.path, fs.watch(f.path, { recursive: true }, kick)) } catch (err) {
      console.warn(`[library] cannot watch ${f.path}: ${err.message}`)
    }
  }
}

module.exports = { addFolder, removeFolder, sync, search, status, watchAll, chunkText, _configure, STATE_PATH, COLLECTION }
