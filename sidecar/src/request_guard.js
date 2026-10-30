"use strict"
/**
 * Which requests the engine answers at all (server.js, before routing).
 *
 * The engine listens on 127.0.0.1 only, but a web page in the lawyer's
 * browser can still reach it:
 *
 * - DNS rebinding: a site whose name first points at its own server and
 *   then at 127.0.0.1 becomes "same origin" with the engine and could read
 *   every answer. The browser then sends that site's name in the Host
 *   header, so only requests addressed to localhost / 127.0.0.1 / [::1] on
 *   the engine's own port are answered.
 * - Cross-site requests: a request carrying a foreign Origin is refused
 *   (no CORS for strangers), and so is one the browser marks as coming from
 *   another site (Sec-Fetch-Site: cross-site / same-site) without a trusted
 *   Origin — that covers <img>, <script>, form and link requests, which
 *   carry no Origin.
 *
 * Local programs (the terminal app, the desktop app's main process, the
 * CLI) send neither Origin nor Sec-Fetch-Site and address 127.0.0.1, so
 * they are unaffected; the Word and Outlook panes are served by the engine
 * itself (same origin).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Extra origins allowed to call the engine (desktop dev servers): OPENLEX_TRUSTED_ORIGINS="http://localhost:5173,app://openlex" */
function trustedOrigins(env = process.env) {
  return new Set(String(env.OPENLEX_TRUSTED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean))
}

/** Host header → { host, port } (port null when absent), or null when unparsable. */
function parseHost(raw) {
  const h = String(raw || '').trim().toLowerCase()
  if (!h) return null
  const m = h.match(/^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/)
  if (!m) return null
  return { host: m[1], port: m[2] ? Number(m[2]) : null }
}

/** True when the Host header names this machine's loopback on the engine's port. */
function hostOk(req, port) {
  const h = parseHost(req.headers.host)
  if (!h || !LOCAL_HOSTS.has(h.host)) return false
  // A missing port means 80/443; the engine never runs there, except when told to.
  return h.port === null ? [80, 443].includes(Number(port)) : h.port === Number(port)
}

/** True for an Origin of the engine itself (the panes) or one the firm trusts explicitly. */
function originOk(origin, port, trusted = trustedOrigins()) {
  if (trusted.has(origin)) return true
  let u
  try { u = new URL(origin) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && String(u.port || (u.protocol === 'https:' ? 443 : 80)) === String(port)
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 *
 * The pane's own files (HTML, scripts, styles, images) hold no data: Word
 * and Outlook on the web and the new Outlook load them in a frame of an
 * Office site, which the browser marks cross-site. They are served then
 * (only GET/HEAD); frame-ancestors (server.js) limits who may frame them.
 */
function check(req, { port, trusted = trustedOrigins(), isStatic = () => false } = {}) {
  if (!hostOk(req, port)) return { ok: false, status: 421, error: 'wrong host' }
  const origin = req.headers.origin
  if (origin !== undefined && !originOk(origin, port, trusted)) return { ok: false, status: 403, error: 'forbidden origin' }
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  const paneFile = (req.method === 'GET' || req.method === 'HEAD') && origin === undefined && isStatic(req)
  if ((site === 'cross-site' || site === 'same-site') && !paneFile && !(origin !== undefined && originOk(origin, port, trusted))) {
    return { ok: false, status: 403, error: 'cross-site request refused' }
  }
  return { ok: true }
}

module.exports = { check, hostOk, originOk, parseHost, trustedOrigins }
