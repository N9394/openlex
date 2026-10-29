/**
 * Files dropped or pasted into the question field: recognised (the same
 * rules as "Add documents": quotes, backslash escapes, file:// URLs,
 * Windows paths), shown as chips above the field, and sent with the
 * question the way `openlex ask --file` does (the file's text + a docId).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { cleanPaths } from './paths.mjs'
import { sym } from './theme.mjs'

const require = createRequire(import.meta.url)

/**
 * Pasted text → the files it names, or null when it is not only paths of
 * existing files (then it is just part of the question).
 */
export function pastedFiles(text, opts = {}) {
  const s = String(text || '').trim()
  if (!s || s.length > 4000) return null
  // One path per line (some terminals) or several on one line.
  const paths = s.split(/\r\n|\r|\n/).flatMap((l) => cleanPaths(l, opts))
  if (!paths.length) return null
  const stat = opts.stat || ((p) => { try { return fs.statSync(p) } catch { return null } })
  const out = []
  for (const p of paths) {
    const st = stat(p)
    if (!st || !st.isFile()) return null
    if (!out.some((f) => f.path === p)) out.push({ path: p, name: path.basename(p), size: st.size })
  }
  return out
}

/** "2.1 MB", "48 KB". */
export function fileSize(bytes) {
  const b = +bytes || 0
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} bytes`
}

/** The chip for one attached file. */
export const chipLabel = (f) => `${sym.clip} ${f.name} ${sym.sep} ${fileSize(f.size)}`

/** What the question will cover, in one plain sentence. */
export function attachSentence(files) {
  if (!files.length) return ''
  if (files.length === 1) return `Your question will be about ${files[0].name}. Backspace removes it.`
  return `All ${files.length} files are included in this question. Backspace removes the last one.`
}

/** The text of a Word, PDF, Excel, e-mail or text file (the engine's reader, read.js; no OCR here: keeps memory low). */
export async function readAttachment(file) {
  return (await require('../src/read.js').readDocument({ file }, { ocr: false })).text
}

/** One text for several files, each under its name. */
export function joinTexts(parts) {
  if (parts.length === 1) return parts[0].text
  return parts.map((p) => `=== ${p.name} ===\n\n${p.text}`).join('\n\n')
}
