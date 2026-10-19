"use strict"
/**
 * BGE-M3 embeddings — fallback chain, all local:
 *
 *   1. App embeddings service  :11435 (full-version client, onnxruntime)
 *      surface (mirrors production embeddings_service.py):
 *        GET  /                → health { status: ready|loading|cold }
 *        POST /api/hybrid      → { dense, sparse:{indices,values} }
 *        POST /api/dense       → { embedding }
 *   2. in-process ONNX BGE-M3 (onnx_bge.js: bge-m3-int8.onnx, dense +
 *      sparse heads, onnxruntime-node) — the plugin-only path
 *   3. local llama.cpp /api/v1/embeddings or Ollama /v1/embeddings
 *      (dense only; sparse degraded)
 *
 * The LLM writes the search queries; this module only encodes them.
 */

const http = require('http')
const config = require('./config')

const APP_EMBEDDINGS_URL = process.env.LEXVAULT_EMBEDDINGS_URL || 'http://127.0.0.1:11435'
const LLM_BASE = config.LLM_BASE
const LLM_EMBED_MODEL = process.env.LEXVAULT_EMBED_MODEL || 'bge-m3' // model name on llama.cpp/Ollama

function httpJson(method, base, pathname, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(base)
    const payload = body ? JSON.stringify(body) : null
    const req = http.request(
      { host: u.hostname, port: u.port || 80, method, path: pathname,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload ? Buffer.byteLength(payload) : 0 },
        timeout: timeoutMs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)) } catch { reject(new Error('bad JSON from ' + base + pathname)) }
          } else reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// ── Backend 1: App embeddings service (:11435) ─────────────────────────────
// One text per call (the App service accepts { text }), batched in parallel.
// Health probe is GET / (answers instantly, never loads the model).
async function appHealth() {
  try {
    const h = await httpJson('GET', APP_EMBEDDINGS_URL, '/', null, 3000)
    return { ok: true, status: h.status, service: h.service }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function appEmbed(queries) {
  const results = await Promise.all(queries.map((text) =>
    httpJson('POST', APP_EMBEDDINGS_URL, '/api/hybrid', { text }, 60000)))
  return results.map((v) => ({
    dense: v.dense,
    sparse: v.sparse && v.sparse.indices ? { indices: v.sparse.indices, values: v.sparse.values } : { indices: [], values: [] },
    backend: 'app',
  }))
}

// ── Backend 2: llama.cpp / Ollama dense embedding ──────────────────────────
// llama-server is shipped with --api-prefix /api, while Ollama and older
// llama.cpp builds expose the OpenAI endpoint at /v1/embeddings. Try the
// prefixed route first, then retain compatibility with the older surface.
const LLAMA_EMBED_PATHS = ['/api/v1/embeddings', '/v1/embeddings']

async function llamaEmbed(queries) {
  let lastErr = null
  for (const pathname of LLAMA_EMBED_PATHS) {
    try {
      const res = await httpJson('POST', LLM_BASE, pathname, { model: LLM_EMBED_MODEL, input: queries }, 60000)
      const items = res.data || []
      if (!Array.isArray(items) || items.length !== queries.length) {
        throw new Error(`embedding count mismatch from ${pathname}`)
      }
      return items.map((it) => ({ dense: it.embedding || it.embed || [], sparse: { indices: [], values: [] }, backend: 'llama' }))
    } catch (err) {
      lastErr = err
      console.warn(`[embeddings] llama endpoint ${pathname} failed: ${err.message}`)
    }
  }
  throw lastErr || new Error('llama embedding endpoint unavailable')
}

// ── Backend 3: in-process ONNX BGE-M3 (dense + sparse heads) ──────────────
async function onnxEmbed(queries) {
  const onnx = require('./onnx_bge')
  return onnx.embed(queries)
}

let preferred = null // 'app' | 'onnx' | 'llama' — pinned once detected

async function embedQueries(queries) {
  const order = preferred
    ? [preferred, 'app', 'onnx', 'llama'].filter((b, i, a) => a.indexOf(b) === i)
    : ['app', 'onnx', 'llama']
  let lastErr = null
  for (const backend of order) {
    try {
      const fn = backend === 'app' ? appEmbed : backend === 'onnx' ? onnxEmbed : llamaEmbed
      const vectors = await fn(queries)
      if (vectors.length !== queries.length) throw new Error('embedding count mismatch')
      preferred = backend
      return vectors
    } catch (err) {
      lastErr = err
      console.warn(`[embeddings] backend ${backend} failed: ${err.message}`)
    }
  }
  throw lastErr || new Error('no embeddings backend available')
}

function backendName() { return preferred || 'unknown' }

module.exports = { embedQueries, backendName, appHealth }
