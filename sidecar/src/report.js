"use strict"
/**
 * One way to turn a tool's result into the files a lawyer takes away:
 * Word, PDF, CSV (Excel), Excel (.xlsx) and Markdown — for the tools that
 * moved from the old desktop server into the chat (saved items, the
 * investigation, due diligence, drafts). The full analysis keeps its own,
 * richer report (analysis.js); this is the same machinery for the others.
 *
 *   report = {
 *     title, subtitle?, note?,                 // note: the "check before relying" line
 *     sections: [{
 *       title,
 *       text?: string | string[],             // paragraphs ("- " lines become bullets in Word)
 *       rows?: [[label, value]],               // a two-column list
 *       table?: [[header…], [cell…]…],         // a table (first row = header)
 *     }],
 *     csv?: [[header…], [cell…]…],             // the one table for CSV / Excel (default: every table)
 *     sheets?: [{ name, rows }],               // extra sheets for .xlsx
 *   }
 *
 *   render(report, format) → Buffer      (docx | pdf | csv | xlsx | md)
 *   save({ report, format, matterId, base }) → { file, name, mime, bytes, data }
 *     written into the matter folder (workspace), data = base64 for the
 *     window's save dialog (the same contract as /api/analysis/export).
 */

const FORMATS = {
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  csv: { ext: 'csv', mime: 'text/csv' },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  md: { ext: 'md', mime: 'text/markdown' },
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const paras = (t) => (Array.isArray(t) ? t : t ? String(t).split(/\n{2,}|\n(?=- )/) : []).map((x) => String(x).trim()).filter(Boolean)

/** Markdown (the same text the chat shows). */
function toMarkdown(r) {
  const md = [`# ${r.title}`, '']
  if (r.subtitle) md.push(r.subtitle, '')
  if (r.note) md.push(`> ${r.note}`, '')
  for (const s of r.sections || []) {
    if (!s) continue
    md.push(`## ${s.title}`, '')
    for (const p of paras(s.text)) md.push(p, '')
    if (s.rows?.length) { for (const [k, v] of s.rows) md.push(`- **${oneLine(k)}:** ${oneLine(v)}`); md.push('') }
    if (s.table?.length) {
      const cell = (c) => oneLine(c).replace(/\|/g, '/')
      md.push(`| ${s.table[0].map(cell).join(' | ')} |`, `|${s.table[0].map(() => '---').join('|')}|`)
      for (const row of s.table.slice(1)) md.push(`| ${row.map(cell).join(' | ')} |`)
      md.push('')
    }
  }
  return md.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

function toDocx(r) {
  const { docxBuffer } = require('./docx_write')
  const b = [{ text: r.title, style: 'Title' }]
  if (r.subtitle) b.push({ text: r.subtitle })
  if (r.note) b.push({ runs: [{ text: r.note, color: '595959' }] })
  for (const s of r.sections || []) {
    if (!s) continue
    b.push({ text: s.title, style: 'Heading1' })
    for (const p of paras(s.text)) {
      const h = /^#{2,4}\s+(.*)$/.exec(p)
      if (h) b.push({ text: h[1], style: 'Heading2' })
      else b.push({ text: p.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^- /gm, '• ') })
    }
    if (s.rows?.length) b.push({ table: [['', ''], ...s.rows.map(([k, v]) => [String(k ?? ''), String(v ?? '')])] })
    if (s.table?.length) b.push({ table: s.table.map((row) => row.map((c) => String(c ?? ''))) })
  }
  return docxBuffer(b)
}

function toPdf(r) {
  const { renderPdf } = require('./pdf')
  const blocks = [{ title: r.title, rows: [...(r.subtitle ? [['', r.subtitle]] : []), ...(r.note ? [['', r.note]] : [])] }]
  for (const s of r.sections || []) {
    if (!s) continue
    const rows = []
    for (const p of paras(s.text)) rows.push(['', p.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{2,4}\s+/, '')])
    for (const [k, v] of s.rows || []) rows.push([oneLine(k), oneLine(v)])
    if (s.table?.length) {
      const head = s.table[0]
      for (const row of s.table.slice(1)) rows.push([oneLine(row[0]), row.slice(1).map((c, i) => (oneLine(c) ? `${head[i + 1] ? `${oneLine(head[i + 1])}: ` : ''}${oneLine(c)}` : '')).filter(Boolean).join(' · ')])
    }
    blocks.push({ title: s.title, rows: rows.length ? rows : [['', '—']] })
  }
  return renderPdf(blocks)
}

/** The table for CSV / Excel: the report's own, else every table and list in it. */
function tableOf(r) {
  if (r.csv?.length) return r.csv
  const out = []
  for (const s of r.sections || []) {
    if (!s) continue
    if (s.table?.length) { out.push([s.title, ...s.table[0]]); for (const row of s.table.slice(1)) out.push(['', ...row]) }
    for (const [k, v] of s.rows || []) out.push([s.title, k, v])
  }
  return out.length ? out : [[r.title]]
}

/** CSV for Excel: UTF-8 with BOM, quoted where needed, formulas neutralised. */
function toCsv(rows) {
  const cellCsv = (v) => {
    let t = String(v ?? '').replace(/\r?\n/g, ' ')
    if (/^[=+\-@]/.test(t)) t = `'${t}`
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return '﻿' + rows.map((r) => r.map(cellCsv).join(',')).join('\r\n') + '\r\n'
}

function render(r, format) {
  switch (format) {
    case 'docx': return toDocx(r)
    case 'pdf': return toPdf(r)
    case 'csv': return Buffer.from(toCsv(tableOf(r)), 'utf8')
    case 'xlsx': {
      const { xlsxBuffer } = require('./xlsx_write')
      const safe = (rows) => rows.map((row) => row.map((c) => { const t = String(c ?? ''); return /^[=+\-@]/.test(t) ? `'${t}` : t }))
      return xlsxBuffer([{ name: 'Table', rows: safe(tableOf(r)) }, ...(r.sheets || []).map((s) => ({ name: String(s.name).slice(0, 31), rows: safe(s.rows) }))])
    }
    case 'md': return Buffer.from(toMarkdown(r), 'utf8')
    default: throw new Error('format must be docx, pdf, csv, xlsx or md')
  }
}

const safeBase = (s) => String(s || 'report').replace(/[^\p{L}\p{N} _.-]/gu, '_').replace(/\s+/g, '-').slice(0, 80)

/** Write the file into the matter folder and hand its bytes to the window. */
function save({ report, format, matterId = null, base }) {
  const fmt = FORMATS[String(format || '').toLowerCase()]
  if (!fmt) throw new Error('format must be docx, pdf, csv, xlsx or md')
  const buf = render(report, String(format).toLowerCase())
  const ws = require('./workspace')
  const folder = ws.matterFolder(require('./workflows').matterLabel(matterId))
  const name = `${safeBase(base)}.${fmt.ext}`
  const file = ws.writeFileBinary(`${folder}/${name}`, buf)
  return { file, name, mime: fmt.mime, bytes: buf.length, data: buf.toString('base64') }
}

module.exports = { render, save, toMarkdown, toDocx, toPdf, toCsv, tableOf, FORMATS, safeBase }
