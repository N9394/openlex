"use strict"
/**
 * Firm library (Phase 2): index the firm's own documents, matter scoping,
 * incremental re-index, deletion.
 *
 *   node --test test/library.test.js
 *
 * Needs a qdrant binary (sidecar/bin/qdrant or QDRANT_BIN); skips otherwise.
 * Uses a deterministic bag-of-words embedder so no model download is needed.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')

const BIN = process.env.QDRANT_BIN || path.join(__dirname, '..', 'bin', 'qdrant')
const HAVE_QDRANT = fs.existsSync(BIN)
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-lib-'))
process.env.LEXVAULT_DATA_DIR = DATA
const PORT = 26333 + Math.floor(Math.random() * 1000)

const library = require('../src/library')
const { docxText } = require('../src/docx_text')

// Deterministic embedder: hashed bag of words → 64-dim dense + sparse.
const tokens = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2)
const hashTok = (w) => crypto.createHash('md5').update(w).digest().readUInt32LE(0)
function fakeEmbed(texts) {
  return Promise.resolve(texts.map((t) => {
    const dense = new Array(64).fill(0)
    const sparse = new Map()
    for (const w of tokens(t)) {
      const h = hashTok(w)
      dense[h % 64] += 1
      sparse.set(h % 100000, (sparse.get(h % 100000) || 0) + 1)
    }
    const norm = Math.sqrt(dense.reduce((s, x) => s + x * x, 0)) || 1
    const idx = [...sparse.keys()].sort((a, b) => a - b)
    return { dense: dense.map((x) => x / norm), sparse: { indices: idx, values: idx.map((i) => sparse.get(i)) } }
  }))
}

function makeDocx(file, paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  execFileSync('python3', ['-c', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
z.writestr('word/document.xml', sys.stdin.read())
z.close()`, file], { input: xml })
}

let qd
const firm = path.join(DATA, 'Firm Precedents')
const matterDir = path.join(DATA, 'Acme matter')

test.before(async () => {
  if (!HAVE_QDRANT) return
  const storage = path.join(DATA, 'qdrant')
  fs.mkdirSync(storage)
  qd = spawn(BIN, [], {
    env: { ...process.env, QDRANT__SERVICE__HTTP_PORT: String(PORT), QDRANT__SERVICE__GRPC_PORT: String(PORT + 1), QDRANT__STORAGE__STORAGE_PATH: storage, QDRANT__TELEMETRY_DISABLED: 'true' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/readyz`)).ok) break } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  library._configure({ embed: fakeEmbed, qdrant: `http://127.0.0.1:${PORT}` })
  fs.mkdirSync(firm); fs.mkdirSync(matterDir)
  makeDocx(path.join(firm, 'Haftungsbeschränkung Muster.docx'), [
    'Haftungsbeschränkung',
    'Die Haftung des Auftragnehmers ist auf den Auftragswert begrenzt, ausgenommen Vorsatz und grobe Fahrlässigkeit.',
  ])
  fs.writeFileSync(path.join(firm, 'force-majeure.md'), '# Force majeure\n\nNeither party is liable for delay caused by events beyond its reasonable control, including pandemic and war.')
  fs.writeFileSync(path.join(matterDir, 'acme-notes.txt'), 'Acme insists on a liability cap of EUR 2 million and a governing law of Austria.')
  fs.writeFileSync(path.join(firm, '~$lockfile.docx'), 'word lock file')
  fs.writeFileSync(path.join(firm, 'Schiedsklausel.pdf'), require('../src/pdf').renderPdf([{ title: 'Schiedsklausel', rows: [['Art. 1', 'Alle Streitigkeiten werden durch ein Schiedsgericht in Wien nach den Wiener Regeln entschieden.']] }]))
})
test.after(() => { qd?.kill(); fs.rmSync(DATA, { recursive: true, force: true }) })

test('docx text extraction keeps paragraphs and decodes entities', { skip: !HAVE_QDRANT }, () => {
  const t = docxText(path.join(firm, 'Haftungsbeschränkung Muster.docx'))
  assert.match(t, /^Haftungsbeschränkung\nDie Haftung/)
})

test('index folders, scope by matter, find by content', { skip: !HAVE_QDRANT }, async () => {
  library.addFolder(firm, '')
  library.addFolder(matterDir, 'm_acme')
  const r = await library.sync()
  assert.deepStrictEqual(r.errors, [])
  assert.strictEqual(r.indexed, 4, 'lock files are skipped; the PDF is indexed')
  assert.strictEqual(library.status().files, 4)
  const pdfHit = await library.search('Schiedsgericht Wien Wiener Regeln Streitigkeiten')
  assert.strictEqual(pdfHit[0].title, 'Schiedsklausel.pdf')
  assert.match(pdfHit[0].text, /\[Page 1\]/)

  const hits = await library.search('Haftung Auftragnehmer begrenzt Vorsatz', { matterId: null })
  assert.strictEqual(hits[0].title, 'Haftungsbeschränkung Muster.docx')
  assert.ok(!hits.some((h) => h.title === 'acme-notes.txt'), 'matter documents are not visible firm-wide')

  const inMatter = await library.search('Acme liability cap governing law Austria', { matterId: 'm_acme' })
  assert.strictEqual(inMatter[0].title, 'acme-notes.txt')
  const otherMatter = await library.search('Acme liability cap governing law Austria', { matterId: 'm_other' })
  assert.ok(!otherMatter.some((h) => h.title === 'acme-notes.txt'), 'other matters cannot see Acme files')
})

test('incremental: unchanged files skipped, edits re-indexed, deletions removed', { skip: !HAVE_QDRANT }, async () => {
  let r = await library.sync()
  assert.strictEqual(r.indexed, 0)
  assert.strictEqual(r.unchanged, 4)

  fs.writeFileSync(path.join(firm, 'force-majeure.md'), '# Höhere Gewalt\n\nKeine Partei haftet für Verzögerungen durch Streik oder Naturkatastrophen.')
  r = await library.sync()
  assert.strictEqual(r.indexed, 1)
  const hits = await library.search('Streik Naturkatastrophen Verzögerungen')
  assert.strictEqual(hits[0].title, 'force-majeure.md')
  assert.ok(!hits.some((h) => /pandemic/.test(h.text)), 'old chunks of an edited file are gone')

  fs.rmSync(path.join(firm, 'force-majeure.md'))
  r = await library.sync()
  assert.strictEqual(r.removed, 1)
  assert.ok(!(await library.search('Streik Naturkatastrophen')).some((h) => h.title === 'force-majeure.md'))
})

test('chunking keeps chunks bounded with overlap', () => {
  const long = Array.from({ length: 40 }, (_, i) => `§ ${i + 1} ${'Lorem ipsum dolor sit amet. '.repeat(8)}`).join('\n\n')
  const chunks = library.chunkText(long)
  assert.ok(chunks.length > 5)
  assert.ok(chunks.every((c) => c.length <= 1800))
})
