"use strict"
/** Cutting one section ("§ 433", "Čl. 5") out of a statute's plain text. */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The text from the heading line of section `num` to the next heading of
 * the same kind, or null. `marker` is "§" or a word list like "Čl\\.|Článok".
 */
function sliceSection(text, num, marker = '§') {
  const n = String(num).replace(/^\s*(§+|čl\.?|článok|článek|art\.?|article)\s*/i, '').trim()
  if (!n) return null
  const head = new RegExp(`(^|\\n)[ \\t]*(?:${marker})\\s*${esc(n)}(?![\\w])[^\\n]*`, 'iu')
  const m = head.exec(text)
  if (!m) return null
  const from = m.index + m[1].length
  const rest = text.slice(from + m[0].length - m[1].length)
  const next = new RegExp(`\\n[ \\t]*(?:${marker})\\s*\\d+[a-z]?(?![\\w])`, 'iu').exec(rest)
  return text.slice(from, from + (m[0].length - m[1].length) + (next ? next.index : rest.length)).trim()
}

module.exports = { sliceSection }
