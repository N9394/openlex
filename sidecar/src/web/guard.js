"use strict"
/**
 * Web access guard — every outbound web call from the agent goes through
 * here first.
 *
 * - Data policy: fetching a URL or running a site search sends the query
 *   (which may contain client facts) to the internet. It is treated like a
 *   cloud provider named "web": allowed only when the matter's policy
 *   allow-lists "web". Privileged matters stay offline.
 * - Network safety: only http(s) to public hosts. Loopback, private and
 *   link-local addresses are refused (a prompt-injected page must not be
 *   able to point the agent at the local sidecar or the office network).
 * - Every call is audited with the host only (never the path or query).
 */

const dns = require('dns').promises
const net = require('net')
const policy = require('../policy')

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateIp(v.slice(7))
}

// Short DNS cache: the browser re-checks every subresource request.
const dnsCache = new Map() // host → { addrs, at }
async function resolve(host) {
  const hit = dnsCache.get(host)
  if (hit && Date.now() - hit.at < 60000) return hit.addrs
  const addrs = (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  dnsCache.set(host, { addrs, at: Date.now() })
  return addrs
}

/** Throws unless the URL is public http(s). Resolves DNS to catch names that point inside. */
async function assertPublicUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { throw new Error(`invalid URL: ${raw}`) }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`only http(s) URLs are allowed (got ${u.protocol})`)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error(`refusing local address ${host}`)
  const addrs = net.isIP(host) ? [host] : await resolve(host)
  if (!addrs.length) throw new Error(`cannot resolve ${host}`)
  if (addrs.some(privateIp)) throw new Error(`refusing private network address for ${host}`)
  return u
}

/** Policy gate for web access; audits host only. Returns null when allowed, else a message. */
function checkWeb(host, call) {
  const matter = policy.currentMatter()
  const decision = policy.check({ id: 'web', local: false }, matter)
  policy.audit({ provider: 'web', model: host, matter, call, decision: decision.allowed ? 'allowed' : 'blocked', ...(decision.allowed ? {} : { reason: decision.reason }) })
  return decision.allowed ? null : `BLOCKED by data policy: ${decision.reason}. Web access needs "web" allowed in Settings → Data policy.`
}

module.exports = { assertPublicUrl, checkWeb, privateIp }
