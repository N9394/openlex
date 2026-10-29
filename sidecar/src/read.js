"use strict"
/**
 * Read a file into text for the shared document model (doc.js): the one
 * reader the chat attachments, the analysis, the workflows and the batch
 * runs use.
 *
 *   .docx            Word (docx_text.js)
 *   .pdf             PDF text layer, scanned pages OCR'd on this computer (pdf_text.js, ocr.js)
 *   .xlsx            every sheet as tab-separated rows
 *   .eml             e-mail: headers, the text part, the names of attachments;
 *                    attached Word/PDF/text files are read too
 *   .txt .md .csv .json .xml .rtf .html …   plain text (HTML/RTF markup removed)
 *
 * Old binary formats (.doc, .xls, .msg) get a sentence that says what to do.
 * The one size rule (limits.js) applies before anything is read.
 *
 *   readDocument({ file } | { buffer, name }, { ocr }) →
 *     { name, kind, text, chars, pages, ocrPages, tokens, attachments? }
 */

const fs = require('fs')
const path = require('path')
const limits = require('./limits')

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.log', '.text'])
const KINDS = { '.docx': 'word', '.pdf': 'pdf', '.xlsx': 'excel', '.eml': 'email', '.html': 'html', '.htm': 'html', '.rtf': 'rtf' }
const OLD = {
  '.doc': 'This is the old Word format (.doc). Open it in Word and save it as .docx, then attach it again.',
  '.xls': 'This is the old Excel format (.xls). Open it in Excel and save it as .xlsx, then attach it again.',
  '.msg': 'Outlook .msg files cannot be read yet. In Outlook, use File → Save As → .eml (or forward it as an attachment), then attach that.',
  '.pages': 'Pages files cannot be read. Export it as Word (.docx) or PDF first.',
}
const SUPPORTED = ['.docx', '.pdf', '.xlsx', '.eml', '.html', '.htm', '.rtf', ...TEXT_EXT]

/** Rough token count (the same 4-characters rule compress.js uses, a little more for safety). */
const tokensFor = (text) => Math.ceil(String(text || '').length / 3.8)

/** Pages: PDF page markers when present, else ~3,000 characters per page. */
function pagesOf(text) {
  const marks = String(text || '').match(/\[Page \d+(?: · OCR)?\]/g)
  if (marks && marks.length) return marks.length
  return Math.max(1, Math.ceil(String(text || '').length / 3000))
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { try { return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) } catch { return m } }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function htmlText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|section|article)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function rtfText(rtf) {
  let s = String(rtf)
  s = s.replace(/\{\\\*[^{}]*\}/g, '') // destinations
  s = s.replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from([parseInt(h, 16)]).toString('latin1'))
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((+n + 65536) % 65536))
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

// ── Excel (.xlsx): shared strings + every sheet, rows as tab-separated lines ──
function xlsxText(buf) {
  const { readZipEntry } = require('./docx_text')
  const xml = (name) => { const b = readZipEntry(buf, name); return b ? b.toString('utf8') : '' }
  const shared = []
  for (const si of xml('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) {
    shared.push(decodeEntities((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
  }
  const wb = xml('xl/workbook.xml')
  if (!wb) throw new Error('not an Excel workbook (.xlsx)')
  const rels = xml('xl/_rels/workbook.xml.rels')
  const target = {}
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1]
    const t = (m[0].match(/Target="([^"]+)"/) || [])[1]
    if (id && t) target[id] = t.replace(/^\/?xl\//, '').replace(/^\//, '')
  }
  const out = []
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeEntities((m[0].match(/name="([^"]*)"/) || [])[1] || 'Sheet')
    const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1]
    const sheet = xml(`xl/${target[rid] || ''}`)
    if (!sheet) continue
    const rows = []
    for (const row of sheet.match(/<row\b[\s\S]*?<\/row>/g) || []) {
      const cells = []
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = (c.match(/\br="([A-Z]+)\d+"/) || [])[1]
        const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length
        const type = (c.match(/\bt="([^"]+)"/) || [])[1]
        let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        if (type === 's') v = shared[+v] ?? ''
        else if (type === 'inlineStr') v = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
        v = decodeEntities(v ?? '')
        while (cells.length < col) cells.push('')
        cells[col] = String(v).replace(/[\t\n]+/g, ' ')
      }
      if (cells.some((x) => x !== '')) rows.push(cells.join('\t'))
    }
    out.push(`=== Sheet: ${name} ===\n${rows.join('\n')}`)
  }
  return out.join('\n\n')
}

// ── E-mail (.eml): headers, the readable body, attachments ──────────────
function decodeWords(s) {
  // RFC 2047 encoded words: =?utf-8?B?...?= / =?iso-8859-1?Q?...?=
  return String(s || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, enc, data) => {
    try {
      const buf = enc.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
      return /utf-?8/i.test(cs) ? buf.toString('utf8') : buf.toString('latin1')
    } catch { return data }
  })
}

function parseHeaders(raw) {
  const h = {}
  for (const line of raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return h
}

function decodeBody(body, headers) {
  const enc = String(headers['content-transfer-encoding'] || '').toLowerCase()
  const charset = (String(headers['content-type'] || '').match(/charset="?([^";\s]+)/i) || [])[1] || 'utf-8'
  let buf
  if (enc === 'base64') buf = Buffer.from(body.replace(/\s+/g, ''), 'base64')
  else if (enc === 'quoted-printable') buf = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
  else buf = Buffer.from(body, 'latin1')
  return { buf, text: () => (/utf-?8/i.test(charset) ? buf.toString('utf8') : buf.toString('latin1')) }
}

function mimeParts(raw, depth = 0) {
  const split = raw.search(/\r?\n\r?\n/)
  const headers = parseHeaders(split < 0 ? raw : raw.slice(0, split))
  const body = split < 0 ? '' : raw.slice(split).replace(/^\r?\n\r?\n/, '')
  const type = String(headers['content-type'] || 'text/plain').toLowerCase()
  const boundary = (String(headers['content-type'] || '').match(/boundary="?([^";]+)"?/i) || [])[1]
  if (type.startsWith('multipart/') && boundary && depth < 5) {
    const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*`)).filter((p) => p.trim() && !/^--\s*$/.test(p))
    return parts.flatMap((p) => mimeParts(p, depth + 1))
  }
  const disp = String(headers['content-disposition'] || '')
  const filename = decodeWords((disp.match(/filename\*?="?([^";]+)"?/i) || String(headers['content-type'] || '').match(/name="?([^";]+)"?/i) || [])[1] || '')
  return [{ headers, type, body, filename, attachment: /attachment/i.test(disp) || !!filename }]
}

async function emlText(buf, opts) {
  const raw = buf.toString('latin1')
  const parts = mimeParts(raw)
  const top = parseHeaders(raw.slice(0, Math.max(0, raw.search(/\r?\n\r?\n/))))
  const head = ['From', 'To', 'Cc', 'Date', 'Subject'].map((k) => (top[k.toLowerCase()] ? `${k}: ${decodeWords(top[k.toLowerCase()])}` : '')).filter(Boolean)
  let body = ''
  const plain = parts.find((p) => !p.attachment && p.type.startsWith('text/plain'))
  const html = parts.find((p) => !p.attachment && p.type.startsWith('text/html'))
  if (plain) body = decodeBody(plain.body, plain.headers).text()
  else if (html) body = htmlText(decodeBody(html.body, html.headers).text())
  const attachments = []
  const attachedText = []
  for (const p of parts.filter((x) => x.attachment && x.filename)) {
    attachments.push(p.filename)
    const ext = path.extname(p.filename).toLowerCase()
    if (!SUPPORTED.includes(ext) || ext === '.eml') continue
    try {
      const r = await readDocument({ buffer: decodeBody(p.body, p.headers).buf, name: p.filename }, opts)
      if (r.text.trim()) attachedText.push(`=== Attachment: ${p.filename} ===\n${r.text}`)
    } catch { /* unreadable attachment: listed by name only */ }
  }
  return {
    text: [head.join('\n'), body.replace(/\r\n/g, '\n').trim(), attachments.length ? `Attachments: ${attachments.join(', ')}` : '', ...attachedText].filter(Boolean).join('\n\n'),
    attachments,
  }
}

/**
 * Read one file. `src` is { file } (a path) or { buffer, name }.
 * opts.ocr: OCR scanned PDF pages on this computer (default true).
 */
async function readDocument(src = {}, opts = {}) {
  const name = String(src.name || (src.file ? path.basename(src.file) : 'document')).slice(0, 200)
  const ext = path.extname(name).toLowerCase()
  if (OLD[ext]) { const e = new Error(`${name}: ${OLD[ext]}`); e.code = 'UNSUPPORTED'; throw e }
  let buf = src.buffer
  if (!buf) {
    const st = fs.statSync(src.file)
    limits.checkSize(name, st.size)
    buf = fs.readFileSync(src.file)
  } else limits.checkSize(name, buf.length)
  let text = ''
  let attachments
  let kind = KINDS[ext] || 'text'
  if (ext === '.docx') text = require('./docx_text').docxText(buf)
  else if (ext === '.pdf') text = await require('./pdf_text').pdfText(buf, { ocr: opts.ocr !== false })
  else if (ext === '.xlsx') text = xlsxText(buf)
  else if (ext === '.eml') ({ text, attachments } = await emlText(buf, opts))
  else if (ext === '.html' || ext === '.htm') text = htmlText(buf.toString('utf8'))
  else if (ext === '.rtf') text = rtfText(buf.toString('latin1'))
  else if (TEXT_EXT.has(ext) || !ext) {
    // Binary check: a NUL byte in the first 8 KB is not text.
    if (buf.subarray(0, 8192).includes(0)) { const e = new Error(`${name}: this kind of file cannot be read; save it as Word, PDF or text`); e.code = 'UNSUPPORTED'; throw e }
    text = buf.toString('utf8').replace(/^﻿/, '')
  } else {
    const e = new Error(`${name}: this kind of file cannot be read; save it as Word, PDF or text`)
    e.code = 'UNSUPPORTED'
    throw e
  }
  text = String(text || '').replace(/\r\n/g, '\n')
  const ocrPages = (text.match(/\[Page \d+ · OCR\]/g) || []).length
  return { name, kind, bytes: buf.length, text, chars: text.length, pages: pagesOf(text), ocrPages, tokens: tokensFor(text), ...(attachments ? { attachments } : {}) }
}

module.exports = { readDocument, tokensFor, pagesOf, htmlText, rtfText, xlsxText, SUPPORTED }
