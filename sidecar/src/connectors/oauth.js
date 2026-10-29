"use strict"
/**
 * OAuth 2.1 sign-in for a law-source gateway (used by Ansvar): the lawyer
 * signs in with their own account in the browser; OpenLex keeps the tokens
 * in the OS keychain and renews them with the refresh token.
 *
 *   discover(resourceUrl)  protected-resource metadata (RFC 9728) → the
 *                          authorization server's metadata (RFC 8414)
 *   register(meta)         dynamic client registration (RFC 7591), a
 *                          public client (no secret), when the server allows it
 *   startDevice(...)       device authorization grant (RFC 8628): a code to
 *                          type in the browser; OpenLex polls for the token
 *   startLoopback(...)     authorization code + PKCE (S256) with a redirect to
 *                          127.0.0.1 (RFC 8252), when device codes are refused
 *   refresh(...)           refresh_token grant
 *
 * Every endpoint must be https (http only on this computer, for tests). The
 * resource indicator (RFC 8707) is sent with every request, as MCP asks.
 */

const crypto = require('crypto')
const http = require('http')
const { request, UA, SourceError } = require('./http')

const TIMEOUT_MS = 25000
const metaCache = new Map() // resource url → { meta, at }

const isLoopback = (h) => h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'

/** The URL if it is https (or http on this computer); else a SourceError. */
function safeUrl(u, label) {
  let x
  try { x = new URL(String(u)) } catch { throw new SourceError(`${label} sent a sign-in address OpenLex cannot use`, 'bad', String(u).slice(0, 80)) }
  if (x.protocol === 'https:' || (x.protocol === 'http:' && isLoopback(x.hostname))) return x.href
  throw new SourceError(`${label} sent a sign-in address that is not secure (https)`, 'bad', x.origin)
}

async function getJsonOrNull(url, label) {
  try {
    const res = await request(url, { label, headers: { Accept: 'application/json' } })
    return await res.json()
  } catch (err) {
    if (err.code === 'notfound' || err.code === 'bad' || err.code === 'key' || err instanceof SyntaxError) return null
    throw err
  }
}

/** POST a form (or JSON) and return { status, json } without throwing on OAuth errors (400/401). */
async function post(url, body, { json = false, headers = {}, label = 'The source' } = {}) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', ...headers },
      body: json ? JSON.stringify(body) : new URLSearchParams(Object.entries(body).filter(([, v]) => v != null && v !== '')).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new SourceError(`${label} could not be reached (no internet connection, or the service is down)`, 'offline', String(err?.cause?.code || err?.message || err))
  }
  const text = await res.text()
  let j = {}
  try { j = text ? JSON.parse(text) : {} } catch { j = {} }
  if (res.status >= 500) throw new SourceError(`${label} is not answering right now; try again later`, 'down', `HTTP ${res.status}`)
  return { status: res.status, json: j }
}

/** RFC 8414: the well-known path goes between the host and the issuer's path. */
function asCandidates(issuer, resourceUrl) {
  const u = new URL(issuer)
  const p = u.pathname.replace(/\/+$/, '')
  const out = []
  if (p) out.push(`${u.origin}/.well-known/oauth-authorization-server${p}`)
  out.push(`${u.origin}${p}/.well-known/oauth-authorization-server`)
  out.push(`${u.origin}${p}/.well-known/openid-configuration`)
  out.push(`${new URL(resourceUrl).origin}/.well-known/oauth-authorization-server`)
  return [...new Set(out)]
}

/**
 * Where to sign in for this resource.
 * @returns {Promise<{ resource, issuer, authorization_endpoint, token_endpoint, device_authorization_endpoint?, registration_endpoint?, code_challenge_methods_supported?, scopes_supported? }>}
 */
async function discover(resourceUrl, { label = 'The source', fresh = false } = {}) {
  const hit = metaCache.get(resourceUrl)
  if (!fresh && hit && Date.now() - hit.at < 3600000) return hit.meta
  const r = new URL(resourceUrl)
  const path = r.pathname.replace(/\/+$/, '')
  let prm = null
  for (const u of [...new Set([path ? `${r.origin}/.well-known/oauth-protected-resource${path}` : null, `${r.origin}/.well-known/oauth-protected-resource`].filter(Boolean))]) {
    prm = await getJsonOrNull(u, label)
    if (prm) break
  }
  const issuer = Array.isArray(prm?.authorization_servers) ? prm.authorization_servers[0] : null
  if (!issuer) throw new SourceError(`${label} does not offer a browser sign-in`, 'unavailable', 'no authorization server')
  safeUrl(issuer, label)
  let as = null
  for (const u of asCandidates(issuer, resourceUrl)) {
    as = await getJsonOrNull(u, label)
    if (as?.token_endpoint) break
    as = null
  }
  if (!as) throw new SourceError(`${label} does not offer a browser sign-in`, 'unavailable', 'no authorization server metadata')
  // Mix-up protection: the metadata must belong to the issuer the resource named.
  if (as.issuer && as.issuer.replace(/\/+$/, '') !== issuer.replace(/\/+$/, '')) throw new SourceError(`${label}'s sign-in details do not match`, 'bad', 'issuer mismatch')
  const meta = {
    resource: prm.resource || resourceUrl,
    issuer,
    scopes_supported: prm.scopes_supported || as.scopes_supported || [],
    authorization_endpoint: as.authorization_endpoint ? safeUrl(as.authorization_endpoint, label) : null,
    token_endpoint: safeUrl(as.token_endpoint, label),
    device_authorization_endpoint: as.device_authorization_endpoint ? safeUrl(as.device_authorization_endpoint, label) : null,
    registration_endpoint: as.registration_endpoint ? safeUrl(as.registration_endpoint, label) : null,
    code_challenge_methods_supported: as.code_challenge_methods_supported || [],
    grant_types_supported: as.grant_types_supported || null,
  }
  metaCache.set(resourceUrl, { meta, at: Date.now() })
  return meta
}

const REDIRECT = 'http://127.0.0.1/callback'

/**
 * Register OpenLex as a public client (RFC 7591). A server that does not
 * accept open registration answers 401/403: then the sign-in is "not
 * available yet" and the lawyer uses a service credential.
 */
async function register(meta, { label = 'The source', clientName = 'OpenLex', scope = '' } = {}) {
  const notYet = new SourceError(`${label}'s browser sign-in is not available for OpenLex yet (OpenLex has asked ${label} for a client id). Use a service credential (paste your key) for now.`, 'unavailable')
  if (!meta.registration_endpoint) throw notYet
  const body = {
    client_name: clientName,
    client_uri: 'https://github.com/N9394/openlex',
    redirect_uris: [REDIRECT],
    grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    ...(scope ? { scope } : {}),
  }
  const r = await post(meta.registration_endpoint, body, { json: true, label })
  if (r.status === 201 || r.status === 200) {
    if (!r.json.client_id) throw notYet
    return { client_id: String(r.json.client_id), ...(r.json.client_secret ? { client_secret: String(r.json.client_secret) } : {}), issuer: meta.issuer }
  }
  throw new SourceError(notYet.plain, 'unavailable', `registration HTTP ${r.status}${r.json.error ? ` ${r.json.error}` : ''}`)
}

const clientAuth = (client) => ({ client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) })

function tokenError(j, label) {
  const e = String(j.error || '')
  if (e === 'access_denied') return new SourceError(`The ${label} sign-in was cancelled`, 'key', e)
  if (e === 'expired_token') return new SourceError(`The ${label} sign-in code ran out before it was used; start the sign-in again`, 'key', e)
  if (e === 'invalid_grant') return new SourceError(`Your ${label} sign-in has run out: sign in again under Law sources (/law)`, 'key', e)
  if (e === 'unauthorized_client' || e === 'unsupported_grant_type') return new SourceError(`${label} does not allow this kind of sign-in for OpenLex`, 'unsupported', e)
  if (e === 'invalid_client') return new SourceError(`${label} no longer knows OpenLex as a client; start the sign-in again`, 'client', e)
  return new SourceError(`${label} did not complete the sign-in`, 'key', e || 'no token')
}

/** Start the device grant: { device_code, user_code, verification_uri, verification_uri_complete?, expires_in, interval }. */
async function startDevice(meta, client, { scope, label = 'The source' } = {}) {
  if (!meta.device_authorization_endpoint) throw new SourceError(`${label} has no sign-in code`, 'unsupported')
  const r = await post(meta.device_authorization_endpoint, { ...clientAuth(client), scope, resource: meta.resource }, { label })
  if (r.status !== 200 || !r.json.device_code || !r.json.user_code) throw tokenError(r.json, label)
  return {
    device_code: String(r.json.device_code),
    user_code: String(r.json.user_code),
    verification_uri: safeUrl(r.json.verification_uri || r.json.verification_url, label),
    verification_uri_complete: r.json.verification_uri_complete ? safeUrl(r.json.verification_uri_complete, label) : null,
    expires_in: Number(r.json.expires_in) || 600,
    interval: Math.max(1, Number(r.json.interval) || 5),
  }
}

const sleeper = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); no(new SourceError('The sign-in was stopped', 'cancelled')) }, { once: true })
})

/** Poll the token endpoint until the lawyer has signed in (RFC 8628 § 3.4/3.5). */
async function pollDevice(meta, client, dev, { label = 'The source', signal, intervalMs } = {}) {
  let wait = intervalMs ?? dev.interval * 1000
  const until = Date.now() + dev.expires_in * 1000
  while (Date.now() < until) {
    await sleeper(wait, signal)
    const r = await post(meta.token_endpoint, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dev.device_code, resource: meta.resource, ...clientAuth(client) }, { label })
    if (r.status === 200 && r.json.access_token) return r.json
    const e = r.json.error
    if (e === 'authorization_pending') continue
    if (e === 'slow_down') { wait += intervalMs ? intervalMs : 5000; continue }
    throw tokenError(r.json, label)
  }
  throw tokenError({ error: 'expired_token' }, label)
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Authorization code + PKCE with a one-time listener on 127.0.0.1.
 * @returns {Promise<{ url, done: Promise<tokens>, close() }>}
 */
async function startLoopback(meta, client, { scope, label = 'The source', timeoutMs = 10 * 60000, signal } = {}) {
  if (!meta.authorization_endpoint) throw new SourceError(`${label} has no browser sign-in`, 'unavailable')
  if (meta.code_challenge_methods_supported?.length && !meta.code_challenge_methods_supported.includes('S256')) throw new SourceError(`${label}'s sign-in is not secure enough for OpenLex (no PKCE)`, 'unavailable')
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(16))
  let settle
  const done = new Promise((ok, no) => { settle = { ok, no } })
  done.catch(() => {})
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname !== '/callback') { res.writeHead(404); return res.end() }
    const page = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>OpenLex</title><p style="font-family:sans-serif">${msg}</p>`) }
    if (u.searchParams.get('state') !== state) { page('This sign-in link is not from OpenLex. You can close this window.'); return }
    if (u.searchParams.get('error')) { page('The sign-in was not completed. You can close this window.'); finish(tokenError({ error: u.searchParams.get('error') }, label)); return }
    const code = u.searchParams.get('code')
    if (!code) { page('No sign-in code arrived. You can close this window.'); return }
    page('Signed in. You can close this window and go back to OpenLex.')
    post(meta.token_endpoint, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, resource: meta.resource, ...clientAuth(client) }, { label })
      .then((r) => (r.status === 200 && r.json.access_token ? finish(null, r.json) : finish(tokenError(r.json, label))))
      .catch((err) => finish(err))
  })
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok) })
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`
  const timer = setTimeout(() => finish(tokenError({ error: 'expired_token' }, label)), timeoutMs)
  timer.unref?.()
  let over = false
  function finish(err, tokens) {
    if (over) return
    over = true
    clearTimeout(timer)
    server.close()
    if (err) settle.no(err); else settle.ok(tokens)
  }
  signal?.addEventListener('abort', () => finish(new SourceError('The sign-in was stopped', 'cancelled')), { once: true })
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, scope, state, code_challenge: challenge, code_challenge_method: 'S256', resource: meta.resource })
  return { url: `${meta.authorization_endpoint}?${q}`, done, close: () => finish(new SourceError('The sign-in was stopped', 'cancelled')), redirectUri }
}

/** A new access token from the refresh token. */
async function refresh({ token_endpoint, client_id, client_secret, refresh_token, resource }, { label = 'The source' } = {}) {
  const r = await post(safeUrl(token_endpoint, label), { grant_type: 'refresh_token', refresh_token, client_id, client_secret, resource }, { label })
  if (r.status === 200 && r.json.access_token) return r.json
  throw tokenError(r.json.error ? r.json : { error: r.status === 400 || r.status === 401 ? 'invalid_grant' : '' }, label)
}

/** The credential kept in the keychain after a sign-in. */
function credential(tokens, meta, client, prev = {}) {
  return {
    type: 'oauth',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || prev.refresh_token || null,
    expires_at: Date.now() + (Number(tokens.expires_in) || 300) * 1000,
    token_endpoint: meta?.token_endpoint || prev.token_endpoint,
    resource: meta?.resource || prev.resource || null,
    client_id: client?.client_id || prev.client_id,
    ...(client?.client_secret || prev.client_secret ? { client_secret: client?.client_secret || prev.client_secret } : {}),
  }
}

/** Open a web address in the lawyer's browser (never in tests: OPENLEX_NO_BROWSER=1). */
function openBrowser(url) {
  if (process.env.OPENLEX_NO_BROWSER === '1') return false
  let u
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:') return false
  const { execFile } = require('child_process')
  const [cmd, args] = process.platform === 'darwin' ? ['open', [u.href]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', u.href]] : ['xdg-open', [u.href]]
  try { execFile(cmd, args, { windowsHide: true }, () => {}).unref?.(); return true } catch { return false }
}

module.exports = { discover, register, startDevice, pollDevice, startLoopback, refresh, credential, openBrowser, safeUrl, _reset: () => metaCache.clear() }
