"use strict"
/**
 * Plain text from a PDF via Mozilla pdf.js (Apache-2.0), fully local.
 * Pages are marked "[Page N]" so findings and citations can point to them.
 * Pages without a text layer (scans) are OCR'd on the machine (ocr.js) and
 * marked "[Page N · OCR]" — OCR text can contain recognition errors, and
 * quote verification then checks against that text.
 */

const fs = require('fs')

let pdfjs = null
async function lib() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

async function pdfText(file, { maxPages = 2000, ocr = true } = {}) {
  const raw = Buffer.isBuffer(file) ? file : fs.readFileSync(file)
  const data = new Uint8Array(raw) // a copy: pdf.js may detach its input
  const { getDocument } = await lib()
  const doc = await getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  const pages = []
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let line = ''
      const lines = []
      for (const item of content.items) {
        line += item.str
        if (item.hasEOL) { lines.push(line); line = '' }
      }
      if (line) lines.push(line)
      const text = lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
      pages.push({ n, text })
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  // Scanned pages: little or no text layer → OCR just those pages.
  const scanned = ocr ? pages.filter((p) => p.text.replace(/\s/g, '').length < 20).map((p) => p.n) : []
  let ocrError = null
  if (scanned.length) {
    try {
      const got = await require('./ocr').ocrPdf(raw, scanned)
      for (const p of pages) if (got[p.n] && got[p.n].trim()) { p.text = got[p.n].trim(); p.ocr = true }
    } catch (err) { ocrError = err.message }
  }
  const body = pages.map((p) => `[Page ${p.n}${p.ocr ? ' · OCR' : ''}]\n${p.text}`).join('\n\n')
  if (body.replace(/\[Page \d+( · OCR)?\]/g, '').trim().length < 20) {
    throw new Error(`no text layer (scanned PDF?)${ocrError ? ` — OCR failed: ${ocrError}` : ' — OCR found no text'}`)
  }
  return body
}

module.exports = { pdfText }
