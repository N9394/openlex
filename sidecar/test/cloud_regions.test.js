"use strict"
/**
 * AWS Bedrock + Google Vertex AI providers and the approved-regions rule
 * of the data policy (Phase 1).
 *
 *   node --test test/cloud_regions.test.js
 *
 * Fake Bedrock / Vertex / Google-token endpoints on localhost; SigV4 is
 * checked against AWS's published test vector.
 */

const test = require('node:test')
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-cloud-'))
process.env.LEXVAULT_DATA_DIR = DATA

const seen = []
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw && req.headers['content-type'] === 'application/json' ? JSON.parse(raw) : raw
    seen.push({ url: req.url, headers: req.headers, body })
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url === '/token') {
      const assertion = new URLSearchParams(raw).get('assertion')
      return json({ access_token: assertion ? 'ya29.test-token' : null, expires_in: 3600 })
    }
    if (req.url.startsWith('/model/')) {
      if (body.toolConfig) return json({ output: { message: { content: [{ text: 'checking' }, { toolUse: { name: 'search_law', input: { jurisdiction: 'DE', query: 'Mietminderung' } } }] } } })
      return json({ output: { message: { content: [{ text: 'bedrock-ok' }] } }, usage: { totalTokens: 3 } })
    }
    if (req.url.includes('/publishers/anthropic/models/')) {
      if (req.url.endsWith(':streamRawPredict')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'vertex-' } })}\n\n`)
        res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'claude' } })}\n\n`)
        return res.end('data: {"type":"message_stop"}\n\n')
      }
      return json({ content: [{ type: 'text', text: 'vertex-claude-ok' }] })
    }
    if (req.url.endsWith('/endpoints/openapi/chat/completions')) return json({ choices: [{ message: { content: 'vertex-gemini-ok' } }] })
    res.writeHead(404); res.end()
  })
})

let base
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${fake.address().port}`
})
test.after(() => { fake.close(); fs.rmSync(DATA, { recursive: true, force: true }) })

const settings = require('../src/providers/settings')
const policy = require('../src/policy')
const llm = require('../src/llm')
const bedrock = require('../src/providers/bedrock')
const vertex = require('../src/providers/vertex')

test('SigV4 matches the AWS test suite (get-vanilla)', () => {
  const h = bedrock.sigv4({
    method: 'GET', url: 'https://example.amazonaws.com/', body: '', region: 'us-east-1', service: 'service', contentType: null,
    creds: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, now: new Date('2015-08-30T12:36:00Z'),
  })
  assert.strictEqual(h.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
})

test('Bedrock: access keys are SigV4-signed, Converse body, region in the audit', async () => {
  process.env.OPENLEX_KEY_BEDROCK = 'AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
  policy.setRule(null, { mode: 'allow-list', providers: ['bedrock', 'vertex', 'openai'], regions: ['eu'] })
  settings.update({ provider: 'bedrock', overrides: { baseUrl: base, region: 'eu-central-1', model: 'eu.anthropic.claude-test-v1:0' } })
  settings.update({ active: 'bedrock' })
  assert.strictEqual(await llm.chat([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], { maxTokens: 64 }), 'bedrock-ok')
  const req = seen[seen.length - 1]
  assert.strictEqual(req.url, '/model/eu.anthropic.claude-test-v1%3A0/converse')
  assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-central-1\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/)
  assert.deepStrictEqual(req.body.system, [{ text: 'S' }])
  assert.deepStrictEqual(req.body.messages, [{ role: 'user', content: [{ text: 'U' }] }])
  assert.strictEqual(req.body.inferenceConfig.maxTokens, 64)
  const last = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse).pop()
  assert.strictEqual(last.region, 'eu-central-1')
})

test('Bedrock: API key as bearer; native toolUse → text-JSON tool call', async () => {
  process.env.OPENLEX_KEY_BEDROCK = 'bedrock-api-key-123'
  const out = await llm.chat([{ role: 'user', content: 'Miete?' }], { phase: 'planning' })
  const req = seen[seen.length - 1]
  assert.strictEqual(req.headers.authorization, 'Bearer bedrock-api-key-123')
  assert.ok(req.body.toolConfig.tools.some((t) => t.toolSpec.name === 'search_law' && t.toolSpec.inputSchema.json.type === 'object'))
  assert.deepStrictEqual(JSON.parse(out), { tool: 'search_law', args: { jurisdiction: 'DE', query: 'Mietminderung' } })
})

test('approved regions: a non-EU region or an unpinned provider is blocked before any request', async () => {
  settings.update({ provider: 'bedrock', overrides: { region: 'us-east-1' } })
  const before = seen.length
  await assert.rejects(llm.chat([{ role: 'user', content: 'x' }]), (e) => e.code === 'POLICY_BLOCKED' && /us-east-1/.test(e.message))
  settings.update({ provider: 'openai', overrides: { baseUrl: base } })
  settings.update({ active: 'openai' })
  await assert.rejects(llm.chat([{ role: 'user', content: 'x' }]), (e) => e.code === 'POLICY_BLOCKED' && /no pinned region/.test(e.message))
  assert.strictEqual(seen.length, before)
  settings.update({ provider: 'bedrock', overrides: { region: 'eu-central-1' } })
  assert.deepStrictEqual(policy.load().default.regions, ['eu'])
})

test('Vertex: service-account JWT → token; Claude via streamRawPredict in the pinned region', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const sa = { client_email: 'openlex@firm.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${base}/token` }
  process.env.OPENLEX_KEY_VERTEX = JSON.stringify(sa, null, 2)
  settings.update({ provider: 'vertex', overrides: { baseUrl: base, region: 'europe-west4', project: 'firm-proj', model: 'claude-test@2025' } })
  settings.update({ active: 'vertex' })
  const pieces = []
  const r = await llm.chatWithReasoning([{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }], { onContent: (t) => pieces.push(t) })
  assert.strictEqual(r.content, 'vertex-claude')
  const tok = seen.find((x) => x.url === '/token')
  const jwt = new URLSearchParams(tok.body).get('assertion').split('.')
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${jwt[0]}.${jwt[1]}`).verify(publicKey, Buffer.from(jwt[2], 'base64url')), 'JWT is RS256-signed with the SA key')
  assert.strictEqual(JSON.parse(Buffer.from(jwt[1], 'base64url')).scope, 'https://www.googleapis.com/auth/cloud-platform')
  const req = seen[seen.length - 1]
  assert.strictEqual(req.url, '/v1/projects/firm-proj/locations/europe-west4/publishers/anthropic/models/claude-test%402025:streamRawPredict')
  assert.strictEqual(req.headers.authorization, 'Bearer ya29.test-token')
  assert.strictEqual(req.body.anthropic_version, 'vertex-2023-10-16')
  assert.ok(!('model' in req.body))
  const tokens = seen.filter((x) => x.url === '/token').length
  await llm.chat([{ role: 'user', content: 'again' }])
  assert.strictEqual(seen.filter((x) => x.url === '/token').length, tokens, 'token is cached')
})

test('Vertex: Gemini goes through the OpenAI-compatible endpoint', async () => {
  settings.update({ provider: 'vertex', overrides: { model: 'google/gemini-2.5-pro' } })
  assert.strictEqual(await llm.chat([{ role: 'user', content: 'x' }]), 'vertex-gemini-ok')
  const req = seen[seen.length - 1]
  assert.strictEqual(req.url, '/v1/projects/firm-proj/locations/europe-west4/endpoints/openapi/chat/completions')
  assert.strictEqual(req.body.model, 'google/gemini-2.5-pro')
})

test('keychain: multi-line keys are stored single-line and come back intact', () => {
  const { _wrap, _unwrap } = require('../src/secrets')
  const sa = '{\n  "private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n"\n}'
  assert.ok(!/[\r\n]/.test(_wrap(sa)))
  assert.strictEqual(_unwrap(_wrap(sa)), sa)
  assert.strictEqual(_wrap('sk-plain-key'), 'sk-plain-key', 'ordinary keys are stored as-is')
})
