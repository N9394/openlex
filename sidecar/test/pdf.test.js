"use strict"
/**
 * PDF text extraction (pdf.js) — page markers, OCR for scanned pages, and
 * the workflows reading PDFs.
 *
 *   node --test test/pdf.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const DATA = fs.mkdtempSync(require('path').join(os.tmpdir(), 'openlex-pdf-'))
process.env.LEXVAULT_DATA_DIR = DATA // OCR cache + scripts stay out of ~/.lexvault
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))
const { renderPdf } = require('../src/pdf')
const { pdfText } = require('../src/pdf_text')

test('extracts text with page markers', async () => {
  const pdf = renderPdf([
    { title: 'Mietvertrag Acme', rows: [['§ 7 Kündigung', 'Jede Partei kann mit einer Frist von drei Monaten kündigen.']] },
  ])
  const text = await pdfText(Buffer.from(pdf, 'latin1'))
  assert.match(text, /^\[Page 1\]\nMietvertrag Acme/)
  assert.match(text, /drei Monaten/)
})

test('a PDF without a text layer is reported, not silently empty', async () => {
  const pdf = renderPdf([{ title: ' ', rows: [] }, { title: '', rows: [['', '']] }])
  await assert.rejects(pdfText(Buffer.from(pdf, 'latin1')), /no text layer/)
})

test('scanned PDF: pages without a text layer are OCR\'d on the machine and marked', { skip: !require('../src/ocr').backend() }, async () => {
  const fixture = require('path').join(__dirname, 'fixtures', 'scanned-lease.pdf')
  await assert.rejects(pdfText(fixture, { ocr: false }), /no text layer/)
  const text = await pdfText(fixture)
  assert.match(text, /^\[Page 1 · OCR\]\n/)
  // Windows' OCR engine drops the "§" in this scan; the rest must match exactly.
  assert.match(text, process.platform === 'win32' ? /(§ )?1 Der Mietzins beträgt EUR 1\.250,00 monatlich/ : /§ 1 Der Mietzins beträgt EUR 1\.250,00 monatlich/)
  assert.match(text, /Kündigungsfrist beträgt drei Monate zum Quartalsende/)
  assert.match(text, /15\. November 2025/)
  const t0 = Date.now()
  assert.strictEqual(await pdfText(fixture), text, 'second read comes from the OCR cache')
  assert.ok(Date.now() - t0 < 1500)
})

test('OCR homoglyphs: Cyrillic look-alikes in Latin words are mapped back', () => {
  const { latinize } = require('../src/ocr')
  assert.strictEqual(latinize('Mietvertrag Аст GmbH'), 'Mietvertrag Acm GmbH')
  assert.strictEqual(latinize('Сlause 7'), 'Clause 7')
  assert.strictEqual(latinize('Москва'), 'Москва', 'real words in another script are left alone')
})
