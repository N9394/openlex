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

function privateV4(ip) {
  const [a, b, c] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

/** IPv6 → its 8 hextets (numbers), or null. Handles ::, and a dotted IPv4 tail. */
function hextets(ip) {
  let v = ip.toLowerCase().replace(/%.*$/, '')
  const tail = v.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    if (!net.isIPv4(tail[1])) return null
    const [a, b, c, d] = tail[1].split('.').map(Number)
    v = v.slice(0, -tail[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = v.split('::')
  if (halves.length > 2) return null
  const part = (x) => (x ? x.split(':') : [])
  const head = part(halves[0])
  const rest = halves.length === 2 ? part(halves[1]) : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0) return null
  const all = [...head, ...Array(fill).fill('0'), ...rest]
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null
  return all.map((h) => parseInt(h, 16))
}

const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`

/**
 * True for addresses that are not on the public internet: loopback,
 * private, link-local, CGNAT, benchmarking, multicast — also when
 * an IPv4 address hides inside an IPv6 one (::ffff:7f00:1, ::127.0.0.1,
 * 64:ff9b::/96 NAT64, 2002::/16 6to4) and anything unparsable.
 */
function privateIp(ip) {
  if (net.isIPv4(ip)) return privateV4(ip)
  const h = hextets(String(ip))
  if (!h) return true
  const zeros = (n) => h.slice(0, n).every((x) => x === 0)
  if (zeros(8)) return true // ::
  if (zeros(7) && h[7] === 1) return true // ::1
  if (zeros(5) && (h[5] === 0xffff || h[5] === 0)) return privateV4(v4of(h[6], h[7])) // ::ffff:a.b.c.d, ::a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b) return privateV4(v4of(h[6], h[7])) // NAT64
  if (h[0] === 0x2002) return privateV4(v4of(h[1], h[2])) // 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true // link-local, site-local
  if ((h[0] & 0xff00) === 0xff00) return true // multicast
  return false
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

/**
 * Source terms that bind the agent's own browsing too (connectors/index.js
 * HOST_RULES): sites that forbid automated access (NJT, CyLaw,
 * lawlibrary.org.za, SAFLII), and RIS outside its night window.
 */
function siteRule(host) {
  try { return require('../connectors').hostRule(host) } catch { return null }
}

/** Throws unless the URL is public http(s). Resolves DNS to catch names that point inside. */
async function assertPublicUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { throw new Error(`invalid URL: ${raw}`) }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`only http(s) URLs are allowed (got ${u.protocol})`)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error(`refusing local address ${host}`)
  const rule = siteRule(host)
  if (rule) throw new Error(rule)
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

/** Firm hooks at the before_web decision point (hooks.js). Returns null when allowed, else a message. */
async function webHook(host, call, url) {
  const hooks = require('../hooks')
  if (!hooks.has('before_web')) return null
  const r = await hooks.run('before_web', { host, call, url: url ? String(url) : null, matterId: policy.currentMatter() })
  return r.decision === 'deny' ? `BLOCKED by firm rule: ${r.reason}` : null
}

/**
 * fetch() that re-checks every redirect hop against the public-address
 * guard (a public page must not bounce the request to 127.0.0.1 or the
 * office network). `check` false skips the guard for sources the firm set
 * up on its own network, but redirects are still followed by hand.
 */
async function safeFetch(url, init = {}, { check = true, maxRedirects = 5 } = {}) {
  let target = String(url)
  if (check) await assertPublicUrl(target)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(target, { ...init, redirect: 'manual' })
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!loc) return res
    const next = new URL(loc, target)
    if (!['http:', 'https:'].includes(next.protocol)) throw new Error(`refusing redirect to ${next.protocol}`)
    if (check) await assertPublicUrl(next.href)
    // Credentials never follow a redirect to another site.
    if (next.origin !== new URL(target).origin && init.headers) {
      const h = { ...init.headers }
      for (const k of Object.keys(h)) if (/^(authorization|cookie|x-api-key|api-key)$/i.test(k)) delete h[k]
      init = { ...init, headers: h }
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method && init.method !== 'GET')) init = { ...init, method: 'GET', body: undefined }
    target = next.href
  }
  throw new Error('too many redirects')
}

module.exports = { assertPublicUrl, checkWeb, webHook, privateIp, siteRule, safeFetch }
