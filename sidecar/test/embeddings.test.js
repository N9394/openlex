"use strict"
/**
 * Regression test for the bundled llama-server's /api prefix.
 *
 * The Windows/Linux plugin starts llama-server with --api-prefix /api, so
 * embeddings must use /api/v1/embeddings. Older Ollama-compatible services
 * still use /v1/embeddings; embeddings.js keeps that as a fallback.
 *
 * No model, network, or LLM is used.
 */

const assert = require('assert')
const http = require('http')
const os = require('os')
const path = require('path')
const fs = require('fs')

const QUERIES = ['Austrian liability law', 'Schadenersatz']
const DENSE = new Array(1024).fill(0.1)

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lexvault-embeddings-test-'))
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req.url)
    if (req.method === 'POST' && req.url === '/api/v1/embeddings') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        assert.deepStrictEqual(body.input, QUERIES)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: QUERIES.map(() => ({ embedding: DENSE })) }))
      })
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'File Not Found', type: 'not_found_error', code: 404 } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  // Make the App and ONNX paths fail immediately so this test exercises the
  // llama fallback without downloading assets or loading a model.
  process.env.LEXVAULT_DATA_DIR = tmp
  process.env.LEXVAULT_EMBEDDINGS_URL = 'http://127.0.0.1:1'
  process.env.LEXVAULT_LLM_URL = `http://127.0.0.1:${server.address().port}`

  const embeddings = require('../src/embeddings')
  const vectors = await embeddings.embedQueries(QUERIES)
  assert.strictEqual(embeddings.backendName(), 'llama')
  assert.strictEqual(vectors.length, QUERIES.length)
  assert.ok(vectors.every((v) => v.backend === 'llama' && v.dense.length === 1024))
  assert.deepStrictEqual(seen, ['/api/v1/embeddings'])

  server.close()
  console.log('embeddings.test.js — /api/v1/embeddings fallback passed')
})().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
