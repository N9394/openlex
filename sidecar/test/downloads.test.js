"use strict"
/**
 * Download-manager verification (A1): resume, sha256, progress, 401 gate.
 *
 * Runs downloads.js against a local mock license server (HTTP, ephemeral
 * port, honoring Range). Uses a throwaway LEXVAULT_DATA_DIR so nothing
 * touches the real ~/.lexvault.
 *
 *   node test/downloads.test.js
 */

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

// ── mock license server ────────────────────────────────────────────────────
const PAYLOAD = Buffer.concat([
  crypto.randomBytes(1024 * 1024),
  Buffer.from('lexvault-test-pack-payload', 'utf8'),
  crypto.randomBytes(1024 * 1024),
])
const PAYLOAD_SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex')
const GOOD_TOKEN = 'test-token-123'

const seenRanges = []
const seenAuths = []

const TIERS = {
  schema_version: 2,
  tiers: { 'test-tier': { model: 'test-model' } },
  models: {
    'test-model': {
      filename: 'test-model.gguf', size_bytes: PAYLOAD.length, sha256: PAYLOAD_SHA,
    },
  },
}

function mockServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    if (u.pathname === '/api/app/tiers') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(TIERS))
    }
    if (u.pathname === '/api/jurisdictions') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ jurisdictions: [{ code: 'AT', current_pack_version: '2026-05-11' }] }))
    }
    if (u.pathname.startsWith('/api/app/model/') || u.pathname.startsWith('/api/app/packs/')) {
      seenAuths.push(req.headers.authorization || null)
      if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'invalid token' }))
      }
      const range = req.headers.range || null
      seenRanges.push(range)
      const start = range ? parseInt(range.replace('bytes=', '').split('-')[0], 10) : 0
      if (start >= PAYLOAD.length) { res.writeHead(416); return res.end() }
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Length': PAYLOAD.length - start,
        'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
      })
      return res.end(PAYLOAD.subarray(start))
    }
    res.writeHead(404); res.end('nope')
  })
}

// ── tiny test runner ───────────────────────────────────────────────────────
let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`) }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err.message}`) }
}

// ── main ───────────────────────────────────────────────────────────────────
;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lexvault-dl-test-'))
  const server = mockServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  process.env.LEXVAULT_DATA_DIR = tmp
  process.env.LEXVAULT_LICENSE_URL = `http://127.0.0.1:${port}/api/app/license`

  const downloads = require('../src/downloads')
  const { saveToken, loadToken } = require('../src/license')

  console.log('\ndownloads.test.js — mock server on :' + port)
  console.log('data dir:', tmp)

  await test('registry fetch + cache to disk', async () => {
    const reg = await downloads.fetchRegistry()
    assert.strictEqual(reg.models['test-model'].sha256, PAYLOAD_SHA)
    const cached = JSON.parse(fs.readFileSync(path.join(tmp, 'tiers.json'), 'utf8'))
    assert.strictEqual(cached.models['test-model'].filename, 'test-model.gguf')
  })

  await test('401 gate — no token refused before any request', async () => {
    assert.strictEqual(loadToken(), null)
    await assert.rejects(
      () => downloads.downloadModel('test-model'),
      (e) => e.message.includes('no login token')
    )
  })

  await test('401 gate — wrong token → clean HTTP 401 error', async () => {
    saveToken('wrong-token')
    await assert.rejects(
      () => downloads.downloadModel('test-model'),
      (e) => e.message.includes('401')
    )
  })

  await test('download: progress events, pct 0→100, done flag', async () => {
    saveToken(GOOD_TOKEN)
    const events = []
    const dest = await downloads.downloadModel('test-model', { onProgress: (e) => events.push(e) })
    assert.strictEqual(dest, path.join(tmp, 'models', 'test-model.gguf'))
    const prog = events.filter((e) => e.kind === 'download-progress')
    assert.ok(prog.length >= 2, 'got progress events')
    const last = prog[prog.length - 1]
    assert.strictEqual(last.pct, 100)
    assert.strictEqual(last.done, true)
    assert.strictEqual(last.received, PAYLOAD.length)
    assert.strictEqual(seenAuths[seenAuths.length - 1], `Bearer ${GOOD_TOKEN}`)
  })

  await test('cached model short-circuit (no new request)', async () => {
    const before = seenRanges.length
    const events = []
    await downloads.downloadModel('test-model', { onProgress: (e) => events.push(e) })
    assert.strictEqual(events[events.length - 1].cached, true)
    assert.strictEqual(seenRanges.length, before, 'no HTTP hit for cached model')
  })

  await test('sha256 gate — corrupt final file is discarded + redownloaded', async () => {
    const dest = path.join(tmp, 'models', 'test-model.gguf')
    fs.writeFileSync(dest, PAYLOAD.subarray(0, 1000)) // truncate → wrong sha
    const events = []
    await downloads.downloadModel('test-model', { onProgress: (e) => events.push(e) })
    assert.strictEqual(events[events.length - 1].pct, 100)
    assert.strictEqual(fs.statSync(dest).size, PAYLOAD.length, 'restored full size')
  })

  await test('resume — existing .partial continues from byte offset (Range)', async () => {
    const dest = path.join(tmp, 'models', 'resume-model.gguf')
    const partial = dest + '.partial'
    fs.writeFileSync(partial, PAYLOAD.subarray(0, 500000))
    const seen = []
    await downloads.downloadFile('http://127.0.0.1:' + port + '/api/app/model/resume-model', dest, {
      token: GOOD_TOKEN,
      expectedSha256: PAYLOAD_SHA,
      onProgress: (e) => seen.push(e),
    })
    const range = seenRanges[seenRanges.length - 1]
    assert.strictEqual(range, 'bytes=500000-', `Range header sent: ${range}`)
    assert.strictEqual(fs.statSync(dest).size, PAYLOAD.length)
    assert.ok(!fs.existsSync(partial), '.partial renamed away')
    const pct = seen.map((e) => e.pct)
    assert.ok(pct[0] < 100, `progress starts under 100 (${pct[0]})`)
  })

  await test('sha256 mismatch on fresh download → error, no rename', async () => {
    const dest = path.join(tmp, 'models', 'bad.gguf')
    const partial = dest + '.partial'
    fs.rmSync(partial, { force: true })
    await assert.rejects(
      () => downloads.downloadFile('http://127.0.0.1:' + port + '/api/app/model/bad-model', dest, {
        token: GOOD_TOKEN,
        expectedSha256: '00'.repeat(32), // wrong on purpose
      }),
      (e) => e.message.includes('checksum mismatch')
    )
    assert.ok(!fs.existsSync(dest), 'final file NOT renamed into place')
  })

  await test('pack version lookup', async () => {
    const v = await downloads.currentPackVersion('AT')
    assert.strictEqual(v, '2026-05-11')
  })

  await test('unknown variant → clean error', async () => {
    await assert.rejects(
      () => downloads.downloadModel('no-such-model'),
      (e) => e.message.includes('unknown model variant')
    )
  })

  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((err) => { console.error(err); process.exit(1) })
