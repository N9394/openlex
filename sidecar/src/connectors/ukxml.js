"use strict"
/**
 * Small helpers shared by the two UK connectors (legislation.gov.uk and
 * Find Case Law): reading Atom feeds and cutting balanced HTML/XML blocks.
 */

const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')

/** The <entry> blocks of an Atom feed. */
const entries = (xml) => String(xml).match(/<entry\b[\s\S]*?<\/entry>/g) || []

/** Text of the first <tag …>…</tag> (namespaced tags work: "tna:uri"). */
function tag(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? decode(m[1]).trim() : null
}

/** Value of an attribute on the first matching element ("ukm:Year", "Value"). */
function attr(xml, name, a, where = '') {
  const m = new RegExp(`<${name}\\b[^>]*${where}[^>]*>`).exec(xml)
  if (!m) return null
  const v = new RegExp(`\\b${a}="([^"]*)"`).exec(m[0])
  return v ? decode(v[1]) : null
}

/** [start, end) of the balanced element that starts at `from` (an opening tag). */
function balanced(src, from, name) {
  const re = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, 'g')
  re.lastIndex = from
  let depth = 0
  let m
  while ((m = re.exec(src))) {
    if (m[2]) { if (!depth) return [from, re.lastIndex]; continue } // self-closing
    depth += m[1] ? -1 : 1
    if (!depth) return [from, re.lastIndex]
  }
  return [from, src.length]
}

const classRe = (name, cls) => new RegExp(`<${name}\\b[^>]*\\bclass="[^"]*\\b(?:${cls})\\b[^"]*"[^>]*>`, 'g')

/** Remove every element <name class="… cls …"> with all it contains. */
function dropBlocks(src, name, cls) {
  const open = classRe(name, cls)
  let out = ''
  let i = 0
  let m
  while ((m = open.exec(src))) {
    if (m.index < i) continue
    out += src.slice(i, m.index)
    const [, end] = balanced(src, m.index, name)
    i = end
    open.lastIndex = end
  }
  return out + src.slice(i)
}

/** The first element <name class="… cls …"> with all it contains, or null. */
function block(src, name, cls) {
  const m = classRe(name, cls).exec(src)
  if (!m) return null
  const [a, b] = balanced(src, m.index, name)
  return src.slice(a, b)
}

module.exports = { decode, entries, tag, attr, dropBlocks, block }
