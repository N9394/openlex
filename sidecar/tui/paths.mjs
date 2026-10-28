/**
 * File paths typed, pasted or dragged into the terminal. Dragging a file
 * into a terminal window pastes its path, quoted ('…' or "…") or with
 * backslash-escaped spaces depending on the terminal; some paste a
 * file:// URL. Tab completes the last path segment like a shell.
 *
 * Windows: Windows Terminal and the console quote a dropped path with
 * spaces as "…" only, a backslash is a separator (never an escape), and
 * file:///C:/… URLs become C:\…. The helpers take { platform, home } so the
 * Windows rules are tested on every platform; they default to this computer.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sys = (opts = {}) => {
  const platform = opts.platform || process.platform
  const win = platform === 'win32'
  return { platform, win, P: win ? path.win32 : path.posix, home: opts.home || os.homedir() }
}

/** One or more dropped/typed paths → clean absolute paths. */
export function cleanPaths(input, opts = {}) {
  const o = sys(opts)
  const exists = opts.exists || fs.existsSync
  const s = String(input || '').trim()
  if (!s) return []
  // Only "…" quotes on Windows, so O'Brien.docx stays whole.
  const quotes = o.win ? ['"'] : ['"', "'"]
  // Typed by hand without quotes ("/Users/me/My Files/x.docx"): take it whole if it exists.
  if (!quotes.some((q) => s.includes(q)) && (o.win || !/\\ /.test(s)) && exists(expand(s, o))) return [resolvePath(s, o)]
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (quotes.includes(ch)) quote = ch
    else if (ch === '\\' && !o.win && i + 1 < s.length) cur += s[++i]
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = '' } } else cur += ch
  }
  if (cur) out.push(cur)
  return out.map((p) => resolvePath(p, o))
}

export const cleanPath = (input, opts) => cleanPaths(input, opts)[0] || ''

/** file:// URL → path. Windows: file:///C:/My%20Files/x.docx → C:\My Files\x.docx, file://server/share/x → \\server\share\x. */
export function fileUrlToPath(url, opts = {}) {
  const o = sys(opts)
  let u
  try { u = new URL(url) } catch { return url }
  let p = u.pathname
  try { p = decodeURIComponent(p) } catch { /* keep as is */ }
  if (!o.win) return p
  p = p.replace(/\//g, '\\')
  if (u.hostname && u.hostname !== 'localhost') return `\\\\${u.hostname}${p}`
  return p.replace(/^\\([A-Za-z]:)/, '$1')
}

function expand(p, o = sys()) {
  if (/^file:\/\//i.test(p)) return fileUrlToPath(p, o)
  if (p === '~' || p.startsWith('~/') || (o.win && p.startsWith('~\\'))) return o.P.join(o.home, p.slice(1))
  return p
}
const resolvePath = (p, o) => o.P.resolve(expand(p, o))

/** Tab completion: the longest common continuation of the last segment (dirs get a trailing separator). */
export function completePath(value) {
  const o = sys()
  const raw = String(value || '')
  const unescape = (x) => (o.win ? x : x.replace(/\\ /g, ' '))
  const unquoted = unescape(raw.replace(o.win ? /^"/ : /^["']/, ''))
  const full = expand(unquoted, o)
  // "C:/Users/" typed with forward slashes is a folder on Windows too.
  const isDir = full.endsWith(path.sep) || full.endsWith('/')
  const dir = isDir ? full : path.dirname(full || '.')
  const base = isDir ? '' : path.basename(full)
  let entries
  try { entries = fs.readdirSync(path.resolve(dir), { withFileTypes: true }) } catch { return value }
  const hits = entries.filter((e) => e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
  if (!hits.length) return value
  let common = hits[0].name
  for (const h of hits.slice(1)) { let k = 0; while (k < common.length && common[k] === h.name[k]) k++; common = common.slice(0, k) }
  let tail = common.slice(base.length)
  if (hits.length === 1 && hits[0].isDirectory()) tail += path.sep
  return unquoted + tail
}

/** Short display form: ~/Documents/x.docx (Windows: ~\Documents\x.docx, case-insensitive). */
export function shortPath(p, opts = {}) {
  const { win, home } = sys(opts)
  if (!p || !home) return p
  const head = p.slice(0, home.length)
  const next = p.charAt(home.length)
  const same = win ? head.toLowerCase() === home.toLowerCase() : head === home
  return same && (next === '' || next === '/' || (win && next === '\\')) ? `~${p.slice(home.length)}` : p
}
