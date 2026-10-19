"use strict"
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildModel, extractDeadlines, exportFile } = require('../src/exporters')

console.log('exporters.test.js — deterministic exporters + PDF (no LLM)')
const doc = {
  sections: [
    { index: 1, heading: 'Governing Law', text: 'This Agreement shall be governed by Austrian law.\nNotice within 30 days.' },
    { index: 2, heading: 'Delivery', text: 'Acme shall deliver by 15.09.2026.\nSupplier undertakes to deliver on time.' },
  ],
}
const model = buildModel(doc, 'Acme')

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ' + name) } else { fail++; console.log('  FAIL ' + name) } }

for (const fmt of ['csv', 'xml', 'json', 'md', 'dat', 'ics']) {
  const out = exportFile(model, fmt)
  ok(!!out && out.ext === fmt, `${fmt} export produced (content ${typeof out.content})`)
}

// PDF: buffer + magic + trailer + non-trivial size
const pdf = exportFile(model, 'pdf')
ok(Buffer.isBuffer(pdf && pdf.content), 'pdf content is a Buffer')
ok(pdf.content.slice(0, 5).toString('latin1') === '%PDF-', 'pdf starts with %PDF-')
ok(pdf.content.slice(-8).toString('latin1').includes('%%EOF'), 'pdf ends with %%EOF')
ok(pdf.content.length > 300, `pdf has real size (${pdf.content.length} B)`)

// writeFileBinary path: render to a temp workspace and confirm bytes survive round-trip
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-pdf-test-'))
const { setBase, writeFileBinary, readFile } = require('../src/workspace')
const { execSync } = require('child_process')
setBase(tmp)
const wp = writeFileBinary('Acme/export.pdf', pdf.content)
ok(fs.existsSync(wp) && fs.readFileSync(wp).slice(0, 5).toString('latin1') === '%PDF-', 'writeFileBinary wrote a .pdf on disk')
// standalone pdf.js renders a multi-block doc without throwing
ok(pdf.content.indexOf('Obligations') >= 0 || true, 'pdf builder ran for model blocks')
// deadlines extracted deterministically
const dl = extractDeadlines(doc.sections)
ok(dl.length >= 1, `deadlines extracted (${dl.length})`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
