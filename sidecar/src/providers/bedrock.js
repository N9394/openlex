"use strict"
/**
 * AWS Bedrock provider — Converse API, in the firm's own AWS account and
 * region (e.g. eu-central-1 Frankfurt, so data stays in the EU).
 *
 * Credentials (stored in the OS keychain like every other key):
 *   - a Bedrock API key (bearer token), or
 *   - "ACCESS_KEY_ID:SECRET_ACCESS_KEY" (optionally ":SESSION_TOKEN"),
 *     signed per request with AWS Signature V4 — no AWS SDK needed.
 *
 * Model ids are Bedrock ids or inference profiles, e.g.
 * "eu.anthropic.claude-sonnet-4-5-20250929-v1:0". Streaming uses the plain
 * Converse call and hands the whole reply to onContent once (ConverseStream
 * is a binary event stream; not worth a parser for one callback).
 */

const crypto = require('crypto')
const { normalizeMessages, httpError, timeoutSignal } = require('./common')
const native = require('./native_tools')

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest()

function parseCreds(key) {
  const s = String(key || '').trim()
  const parts = s.split(':')
  if (parts.length >= 2 && /^(AKIA|ASIA)[A-Z0-9]{12,}$/.test(parts[0])) {
    return { accessKeyId: parts[0], secretAccessKey: parts[1], sessionToken: parts.slice(2).join(':') || null }
  }
  return { bearer: s }
}

/** AWS SigV4 headers for one request (default service: bedrock). */
function sigv4({ method, url, body, region, creds, now = new Date(), service = 'bedrock', contentType = 'application/json' }) {
  const u = new URL(url)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const headers = { host: u.host, 'x-amz-date': amzDate }
  if (contentType) headers['content-type'] = contentType
  if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken
  const signed = Object.keys(headers).sort()
  // Canonical URI: each path segment URI-encoded twice for non-S3 services.
  const canonicalUri = u.pathname.split('/').map((seg) => encodeURIComponent(encodeURIComponent(decodeURIComponent(seg)))).join('/')
  const canonical = [
    method, canonicalUri, u.searchParams.toString(),
    signed.map((h) => `${h}:${headers[h]}\n`).join(''), signed.join(';'), sha256(body),
  ].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  let k = hmac(`AWS4${creds.secretAccessKey}`, date)
  k = hmac(k, region); k = hmac(k, service); k = hmac(k, 'aws4_request')
  const signature = crypto.createHmac('sha256', k).update(toSign).digest('hex')
  const { host, ...rest } = headers
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}` }
}

function endpoint(p) {
  const region = p.region || 'eu-central-1'
  const base = p.baseUrl || `https://bedrock-runtime.${region}.amazonaws.com`
  if (!p.model) throw new Error(`${p.label}: no model id configured (Settings → Model provider)`)
  return { url: `${base}/model/${encodeURIComponent(p.model)}/converse`, region }
}

function buildBody(p, messages, opts) {
  const { system, turns } = normalizeMessages(messages)
  const body = {
    messages: turns.map((t) => ({ role: t.role, content: [{ text: t.content }] })),
    inferenceConfig: { maxTokens: opts.maxTokens || 1024 },
  }
  if (system) body.system = [{ text: system }]
  if (opts.temperature !== undefined) body.inferenceConfig.temperature = opts.temperature
  if (opts.nativeTools?.tools.length) {
    body.toolConfig = {
      tools: opts.nativeTools.tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters } } })),
      toolChoice: { auto: {} },
    }
  }
  return body
}

async function complete(p, key, messages, opts = {}) {
  if (!key) throw new Error(`${p.label}: no AWS credentials set (Settings → Model provider)`)
  const { url, region } = endpoint(p)
  const body = JSON.stringify(buildBody(p, messages, opts))
  const creds = parseCreds(key)
  const headers = creds.bearer
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.bearer}` }
    : sigv4({ method: 'POST', url, body, region, creds })
  const res = await fetch(url, { method: 'POST', headers, body, signal: timeoutSignal(opts.timeoutMs || 180000, opts.signal) })
  if (!res.ok) throw await httpError(res, p.label)
  const json = await res.json()
  const blocks = json.output?.message?.content || []
  const use = blocks.find((b) => b.toolUse)
  const content = use && opts.nativeTools
    ? native.asTextCall(opts.nativeTools.names, use.toolUse.name, use.toolUse.input)
    : blocks.filter((b) => typeof b.text === 'string').map((b) => b.text).join('')
  const reasoning = blocks.map((b) => b.reasoningContent?.reasoningText?.text || '').join('')
  return { content, reasoning, usage: json.usage || null }
}

async function stream(p, key, messages, opts = {}) {
  const r = await complete(p, key, messages, opts)
  if (r.reasoning) opts.onReasoning?.(r.reasoning)
  if (r.content && !opts.nativeTools) opts.onContent?.(r.content)
  else if (r.content && !r.content.startsWith('{"tool"')) opts.onContent?.(r.content)
  return { content: r.content, reasoning: r.reasoning }
}

async function test(p, key) {
  const r = await complete(p, key, [{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 16, temperature: 0, timeoutMs: 30000 })
  return { ok: true, sample: r.content.slice(0, 40) }
}

module.exports = { complete, stream, test, buildBody, sigv4, parseCreds }
