/**
 * File paths typed, pasted or dragged into the terminal. Dragging a file
 * into a terminal window pastes its path, quoted ('…' or "…") or with
 * backslash-escaped spaces depending on the terminal; some paste a
 * file:// URL. Tab completes the last path segment like a shell.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** One or more dropped/typed paths → clean absolute paths. */
export function cleanPaths(input) {
  const s = String(input || '').trim()
  if (!s) return []
  // Typed by hand without quotes ("/Users/me/My Files/x.docx"): take it whole if it exists.
  if (!/["']/.test(s) && !/\\ /.test(s) && fs.existsSync(expand(s))) return [resolvePath(s)]
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '\\' && process.platform !== 'win32' && i + 1 < s.length) cur += s[++i]
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = '' } } else cur += ch
  }
  if (cur) out.push(cur)
  return out.map(resolvePath)
}

export const cleanPath = (input) => cleanPaths(input)[0] || ''

function expand(p) {
  if (p.startsWith('file://')) { try { return decodeURIComponent(new URL(p).pathname) } catch { return p } }
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1))
  return p
}
const resolvePath = (p) => path.resolve(expand(p))

/** Tab completion: the longest common continuation of the last segment (dirs get a trailing /). */
export function completePath(value) {
  const raw = String(value || '')
  const unquoted = raw.replace(/^["']/, '').replace(/\\ /g, ' ')
  const full = expand(unquoted)
  const dir = full.endsWith(path.sep) ? full : path.dirname(full || '.')
  const base = full.endsWith(path.sep) ? '' : path.basename(full)
  let entries
  try { entries = fs.readdirSync(path.resolve(dir), { withFileTypes: true }) } catch { return value }
  const hits = entries.filter((e) => e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
  if (!hits.length) return value
  let common = hits[0].name
  for (const h of hits.slice(1)) { let k = 0; while (k < common.length && common[k] === h.name[k]) k++; common = common.slice(0, k) }
  let tail = common.slice(base.length)
  if (hits.length === 1 && hits[0].isDirectory()) tail += path.sep
  return (raw.startsWith('"') || raw.startsWith("'") ? unquoted : raw.replace(/\\ /g, ' ')) + tail
}

/** Short display form: ~/Documents/x.docx */
export function shortPath(p) {
  const home = os.homedir()
  return p && p.startsWith(home) ? `~${p.slice(home.length)}` : p
}
