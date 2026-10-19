"use strict"
/**
 * Local hybrid search against the sidecar's Qdrant (:16333), collection
 * legal_chunks_local — the same index the App builds from .lvpack packs
 * (binary-quantized dense + BGE-M3 sparse). Mirrors production
 * enhancedSearch: dense + sparse → RRF → (Lotus rerank happens in the
 * agent loop).
 *
 * If Qdrant is unreachable we return { results: [], error } — never fake
 * data (product policy).
 */

const http = require('http')
const { QDRANT_BASE, QDRANT_COLLECTION } = require('./config')

const url = new URL(QDRANT_BASE)

function req(method, pathname, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const r = http.request(
      { host: url.hostname, port: url.port, method, path: pathname,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload ? Buffer.byteLength(payload) : 0 },
        timeout: timeoutMs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)) } catch { resolve(text) }
          } else {
            reject(new Error(`qdrant ${pathname} → HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          }
        })
      }
    )
    r.on('timeout', () => r.destroy(new Error('qdrant timeout')))
    r.on('error', reject)
    if (payload) r.write(payload)
    r.end()
  })
}

async function ping() {
  try { await req('GET', '/', null, 3000); return true } catch { return false }
}

function rrf(rankedLists, k = 60) {
  const scores = new Map()
  rankedLists.forEach((list) => {
    list.forEach((doc, i) => {
      const id = doc.id
      scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1))
    })
  })
  return [...scores.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * @param {{dense:number[], sparse:{indices:number[],values:number[]}}} query
 * @param {{jurisdiction?:string, limit?:number, filter?:object}} opts
 */
async function hybridSearch(query, opts = {}) {
  const limit = opts.limit || 10
  const filter = {}
  if (opts.jurisdiction) filter.must = [{ key: 'jurisdiction', match: { value: opts.jurisdiction } }]
  const body = { vector: { name: 'dense', vector: query.dense }, limit: limit * 2, with_payload: true, filter: filter || undefined }
  try {
    // Sparse leg only when the backend produced real sparse indices
    // (App/ONNX BGE-M3). Dense-only backends (llama.cpp) skip it — an empty
    // sparse vector 400s on Qdrant.
    const hasSparse = !!(query.sparse && Array.isArray(query.sparse.indices) && query.sparse.indices.length)
    const denseP = req('POST', `/collections/${QDRANT_COLLECTION}/points/search`, body)
    const sparseP = hasSparse
      ? req('POST', `/collections/${QDRANT_COLLECTION}/points/search`, {
          vector: { name: 'sparse', vector: query.sparse }, limit: limit * 2, with_payload: true, filter: filter || undefined,
        })
      : Promise.resolve({ result: [] })
    const [dense, sparse] = await Promise.all([denseP, sparseP])
    const ranked = rrf([dense.result || [], sparse.result || []])
    const byId = new Map()
    for (const r of dense.result || []) byId.set(r.id, r)
    for (const r of sparse.result || []) byId.set(r.id, r)
    return { results: ranked.slice(0, limit).map(([id]) => byId.get(id)) }
  } catch (err) {
    return { results: [], error: err.message }
  }
}

/**
 * Fetch full chunk payloads by id (for get_law_section / Judge context).
 */
async function getChunk(id) {
  try {
    const res = await req('POST', `/collections/${QDRANT_COLLECTION}/points`, { ids: [id], with_payload: true })
    return res.result?.[0]?.payload || null
  } catch (err) {
    return null
  }
}

module.exports = { ping, hybridSearch, getChunk }
