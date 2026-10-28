"use strict"
/**
 * Google Vertex AI provider — the firm's own GCP project, pinned to a
 * region (e.g. europe-west1 / europe-west4 so data stays in the EU).
 *
 *   Claude models  → publishers/anthropic …:rawPredict / :streamRawPredict
 *                    (Anthropic Messages wire format — anthropic.js)
 *   Gemini & co.   → Vertex's OpenAI-compatible endpoint (openai.js),
 *                    model ids like "google/gemini-2.5-pro"
 *
 * Auth: the keychain entry holds a service-account JSON key, exchanged for
 * a 1-hour OAuth token (RS256 JWT → oauth2.googleapis.com, no Google SDK).
 * With no key stored, the local gcloud login is used instead
 * (`gcloud auth print-access-token`).
 */

const crypto = require('crypto')
const { execFile } = require('child_process')
const anthropic = require('./anthropic')
const openai = require('./openai')

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const tokenCache = new Map() // client_email|'gcloud' → { token, exp }

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function parseServiceAccount(key) {
  if (!key) return null
  let sa
  try { sa = JSON.parse(key) } catch { throw new Error('Vertex AI: the stored key must be a service-account JSON key (or leave it empty to use your gcloud login)') }
  if (!sa.client_email || !sa.private_key) throw new Error('Vertex AI: service-account JSON is missing client_email / private_key')
  return sa
}

/** Signed JWT assertion for the OAuth2 JWT-bearer grant. */
function jwtAssertion(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key)
  return `${header}.${claims}.${b64url(sig)}`
}

async function accessToken(key, opts = {}) {
  const sa = parseServiceAccount(key)
  const cacheKey = sa ? sa.client_email : 'gcloud'
  const hit = tokenCache.get(cacheKey)
  if (hit && hit.exp - 60000 > Date.now()) return hit.token
  let token, ttl
  if (sa) {
    const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwtAssertion(sa) }),
      signal: AbortSignal.timeout(opts.timeoutMs || 30000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.access_token) throw new Error(`Vertex AI: token exchange failed (HTTP ${res.status}: ${json.error_description || json.error || 'no token'})`)
    token = json.access_token
    ttl = (json.expires_in || 3600) * 1000
  } else {
    token = await new Promise((resolve, reject) => {
      // Windows: gcloud is gcloud.cmd, which Node only runs through the shell (fixed arguments).
      execFile('gcloud', ['auth', 'print-access-token'], { timeout: 20000, windowsHide: true, shell: process.platform === 'win32' }, (err, out) => {
        if (err) return reject(new Error('Vertex AI: no service-account key stored and `gcloud auth print-access-token` failed — run `gcloud auth login` or add a key in Settings → Model provider'))
        resolve(String(out).trim())
      })
    })
    ttl = 50 * 60 * 1000
  }
  tokenCache.set(cacheKey, { token, exp: Date.now() + ttl })
  return token
}

const isClaude = (model) => /claude/i.test(String(model || ''))

function host(region) {
  return region === 'global' ? 'https://aiplatform.googleapis.com' : `https://${region}-aiplatform.googleapis.com`
}

/** Provider descriptor in the shape anthropic.js / openai.js expect. */
function target(p, key) {
  if (!p.project) throw new Error(`${p.label}: no GCP project id configured (Settings → Model provider)`)
  if (!p.model) throw new Error(`${p.label}: no model configured`)
  const region = p.region || 'europe-west1'
  const root = `${p.baseUrl || host(region)}/v1/projects/${encodeURIComponent(p.project)}/locations/${region}`
  parseServiceAccount(key) // validate the stored key before any network call
  if (isClaude(p.model)) {
    const model = `${root}/publishers/anthropic/models/${encodeURIComponent(p.model)}`
    return { adapter: anthropic, p: { ...p, vertex: { url: (stream) => `${model}:${stream ? 'streamRawPredict' : 'rawPredict'}` } } }
  }
  return { adapter: openai, p: { ...p, kind: 'openai', baseUrl: `${root}/endpoints/openapi`, id: p.id } }
}

async function run(method, p, key, messages, opts) {
  const t = target(p, key)
  const token = await accessToken(key, opts)
  return t.adapter[method](t.p, token, messages, opts)
}

const complete = (p, key, messages, opts = {}) => run('complete', p, key, messages, opts)
const stream = (p, key, messages, opts = {}) => run('stream', p, key, messages, opts)

async function test(p, key) {
  const r = await complete(p, key, [{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 16, temperature: 0, timeoutMs: 30000 })
  return { ok: true, sample: r.content.slice(0, 40) }
}

module.exports = { complete, stream, test, jwtAssertion, accessToken, target, _tokenCache: tokenCache }
