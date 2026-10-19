"use strict"
/**
 * Minimal dependency-free PDF writer (Batch 4 deferred item: PDF export).
 * Hand-rolls a valid PDF 1.4 with a byte-accurate xref table, A4 pages,
 * base-14 Helvetica (no embedded fonts). Deterministic: text is
 * transliterated to latin-1 so offsets never drift. No external libs —
 * runs anywhere the sidecar runs, testable on the Mac with no LLM.
 *
 *   const { renderPdf } = require('./pdf')
 *   const buf = renderPdf([
 *     { title: 'Obligations', rows: [['§ 3', 'Acme shall deliver…'], …] },
 *     { title: 'Deadlines',    rows: [['2026-12-31', 'payment due'], …] },
 *   ])
 */

const PW = 841.89, PH = 595.28 // A4 landscape? No — portrait: W 595.28 H 841.89
const PAGE_W = 595.28, PAGE_H = 841.89
const M = 50 // margin
const TEXT_W = PAGE_W - M * 2
const FS = 9, LEAD = 13
const TITLE_FS = 13, TITLE_LEAD = 18
const LABEL_W = 88 // first-column width for label cells

/** Normalize arbitrary text to a PDF-safe latin-1 string (escaping for ()\ ). */
function latin1(s) {
  return String(s ?? '')
    .replace(/[\u201C\u201D\u201E\u201F\u201A\u2019]/g, "'")
    .replace(/[\u2018\u201B]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

/** Word-wrap a string to approximate char budget (half-width per char). */
function wrap(text, maxChars) {
  const words = latin1(text).split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const out = []
  let line = ''
  for (const w of words) {
    if ((line + (line ? ' ' : '') + w).length <= maxChars) {
      line = line ? line + ' ' + w : w
    } else {
      if (line) out.push(line)
      line = w
    }
  }
  if (line) out.push(line)
  else if (!out.length) out.push('')
  return out
}

function charBudget(fontSz) { return Math.floor(TEXT_W / (fontSz * 0.5) / 1.04) }

/**
 * Build one page content stream from laid-out lines:
 *   lines: [{ x, y_total_top, text, size, bold }]
 * Coordinates are absolute from the top of the page (inverted later).
 */
function layoutLines(page) {
  // page: { width, height, lines: [{ x, y, text, size, bold }] } with y = distance from top
  let s = 'BT\n'
  for (const ln of page.lines) {
    const y = PAGE_H - M - ln.y // flip: PDF y grows upward from bottom margin
    s += `/${ln.bold ? 'F2' : 'F1'} ${ln.size} Tf\n`
    s += `1 0 0 1 ${ln.x.toFixed(2)} ${y.toFixed(2)} Tm\n`
    s += `(${latin1(ln.text)}) Tj\n`
  }
  s += 'ET'
  return s
}

/** Build the full PDF byte stream. */
function renderPdf(blocks) {
  // -- layout pass: produce pages of lines --
  const sections = [].concat(blocks || [])
  const pages = []
  let cur = [] // lines on current page
  let curY = 0 // cursor from top

  const ensure = (space) => {
    if (curY + space > PAGE_H - M * 2) {
      pages.push({ lines: cur, width: PAGE_W, height: PAGE_H })
      cur = []
      curY = 0
    }
  }
  const push = (ln) => { cur.push(ln); curY += ln.lead || LEAD }

  for (const sec of sections || []) {
    const title = String(sec.title || '').trim()
    const rows = Array.isArray(sec.rows) ? sec.rows : []
    if (!title && !rows.length) continue

    if (title) {
      ensure(TITLE_LEAD)
      push({ x: M, y: curY, text: title, size: TITLE_FS, bold: true, lead: TITLE_LEAD })
      ensure(4); push({ x: M, y: curY, text: '', size: 1, bold: false, lead: 4 })
    }

    for (const r of rows) {
      const label = latin1(Array.isArray(r) ? r[0] : r.label)
      const value = latin1(Array.isArray(r) ? r[1] : r.value)
      const labelChars = Math.floor(LABEL_W / (FS * 0.5))
      const labelLines = value.length
        ? label.split(/\s+/).filter(Boolean).map((w, i) => (i === 0 ? w : w)).join(' ')
        : ''
      // Label column: single (possibly wrapped to 2) lines; value wraps freely.
      const labelWrapped = wrap(label, labelChars)
      const labelLinesUsed = Math.min(labelWrapped.length, 4)
      const valueChars = charBudget(FS) - Math.floor((LABEL_W) / (FS * 0.5))
      const valueWrapped = wrap(value || ' ', Math.max(10, valueChars))
      const h = Math.max(labelLinesUsed, valueWrapped.length) * LEAD

      ensure(h)
      const top = curY
      for (let i = 0; i < labelLinesUsed; i++) {
        push({ x: M, y: curY, text: labelWrapped[i] || '', size: FS, bold: true, lead: 0 })
        curY = top + (i + 1) * LEAD - 0 // keep cells aligned via absolute y from top set below
      }
      push({ x: M, y: curY, text: '', size: FS, bold: false, lead: 0 })
      curY = top
      for (let i = 0; i < valueWrapped.length; i++) {
        push({ x: M + LABEL_W, y: curY, text: valueWrapped[i], size: FS, bold: false, lead: 0 })
        curY = top + (i + 1) * LEAD
      }
      curY = top + h
    }
    ensure(LEAD); push({ x: M, y: curY, text: '', size: FS, bold: false, lead: 4 })
  }
  pages.push({ lines: cur, width: PAGE_W, height: PAGE_H })

  // -- serialize --
  const objects = [] // strings, index by objNum
  // obj 1: catalog
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  // obj 2: pages tree
  const pageRefs = []
  const nPages = pages.length
  let o = 2 // we'll fill after we know page obj numbers

  // Page objects and their content streams: content streams come last.
  // obj 3..(3+n-1): page objects; then n content objects; plus font objs at known offsets.
  const FONT_F1 = 3 + nPages + nPages // reserve: font objects at fixed positions
  const FONT_F2 = FONT_F1 + 1
  const CONTENT_START = FONT_F2 + 1

  // Build object list
  const rawObjects = new Array(CONTENT_START + nPages + 1)
  // font objects
  rawObjects[FONT_F1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  rawObjects[FONT_F2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  // page objects
  for (let i = 0; i < nPages; i++) {
    const contentObjNum = CONTENT_START + i
    const pageObjNum = 3 + i
    rawObjects[pageObjNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${FONT_F1} 0 R /F2 ${FONT_F2} 0 R >> >> /Contents ${contentObjNum} 0 R >>`
  }
  // content streams
  for (let i = 0; i < nPages; i++) {
    const stream = layoutLines(pages[i])
    const len = Buffer.byteLength(stream, 'latin1')
    rawObjects[CONTENT_START + i] = `<< /Length ${len} >>\nstream\n${stream}\nendstream`
  }

  // catalog
  rawObjects[1] = `<< /Type /Catalog /Pages 2 0 R >>`
  // pages tree
  const kids = []
  for (let i = 0; i < nPages; i++) kids.push(`${3 + i} 0 R`)
  rawObjects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`

  const chunks = []
  chunks.push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const offsets = []
  for (let num = 1; num < rawObjects.length; num++) {
    offsets[num] = Buffer.byteLength(chunks.join(''), 'latin1')
    chunks.push(`${num} 0 obj\n${rawObjects[num]}\nendobj\n`)
  }
  const xrefPos = Buffer.byteLength(chunks.join(''), 'latin1')
  let xref = `xref\n0 ${rawObjects.length}\n0000000000 65535 f \n`
  for (let num = 1; num < rawObjects.length; num++) {
    xref += String(offsets[num]).padStart(10, '0') + ' 00000 n \n'
  }
  xref += `trailer\n<< /Size ${rawObjects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`
  chunks.push(xref)

  return Buffer.from(chunks.join(''), 'latin1')
}

module.exports = { renderPdf }
