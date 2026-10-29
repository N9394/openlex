"use strict"
/**
 * Small HTTP helpers for law-source connectors: one User-Agent, a timeout,
 * and errors a lawyer can read ("could not be reached", "did not accept
 * your key") instead of stack traces.
 */

const UA = 'OpenLex (+https://github.com/N9394/openlex)'
const TIMEOUT_MS = 25000

class SourceError extends Error {
  /** @param {string} plain one sentence for the lawyer; code: offline | down | key | limit | notfound | bad */
  constructor(plain, code = 'bad', detail = '') {
    super(detail ? `${plain} (${detail})` : plain)
    this.plain = plain
    this.code = code
  }
}

const OFFLINE_RE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|network|aborted|timeout/i

/** fetch() with a timeout; network failures and HTTP errors become SourceErrors. */
async function request(url, { label = 'The source', method = 'GET', headers = {}, body, timeoutMs = TIMEOUT_MS, redirect = 'follow' } = {}) {
  let res
  try {
    res = await fetch(url, { method, headers: { 'User-Agent': UA, ...headers }, body, redirect, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const why = String(err?.cause?.code || err?.name || err?.message || err)
    if (OFFLINE_RE.test(why) || OFFLINE_RE.test(String(err?.message))) throw new SourceError(`${label} could not be reached (no internet connection, or the service is down)`, 'offline', why)
    throw new SourceError(`${label} could not be reached`, 'offline', why)
  }
  if (res.ok) return res
  const s = res.status
  if (s === 401 || s === 403) throw new SourceError(`${label} did not accept the key`, 'key', `HTTP ${s}`)
  if (s === 404) throw new SourceError(`${label} has no such document`, 'notfound', `HTTP ${s}`)
  if (s === 429) throw new SourceError(`${label} says the limit of searches is reached for now`, 'limit', `HTTP ${s}`)
  if (s >= 500) throw new SourceError(`${label} is not answering right now; try again later`, 'down', `HTTP ${s}`)
  throw new SourceError(`${label} refused the request`, 'bad', `HTTP ${s}`)
}

async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } })
  try { return await res.json() } catch { throw new SourceError(`${opts.label || 'The source'} sent an answer OpenLex cannot read`, 'bad', 'not JSON') }
}

async function getText(url, opts = {}) {
  const res = await request(url, opts)
  return res.text()
}

/** HTML → readable text (shared with the EUR-Lex adapter). */
function htmlToText(html) {
  return require('../web/eurlex').htmlToText(html)
}

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

module.exports = { request, getJson, getText, htmlToText, strip, SourceError, UA }
