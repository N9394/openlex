"use strict"
/**
 * Clause library (Phase 2): the firm's own clauses, split, typed and
 * counted across documents — no model.
 *
 *   node --test test/clauses.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-clauses-'))
process.env.LEXVAULT_DATA_DIR = DATA
const cl = require('../src/clauses')
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

const LIAB = 'Die Haftung des Auftragnehmers ist auf den Auftragswert begrenzt, ausgenommen Vorsatz und grobe Fahrlässigkeit. Die Haftung für entgangenen Gewinn ist ausgeschlossen.'
const docA = `Werkvertrag Alpha\n\n§ 1 Gegenstand\nDer Auftragnehmer erstellt eine Software nach Anlage 1 und übergibt sie bis zum 30.10.2026 an den Auftraggeber.\n\n§ 9 Haftung\n${LIAB}\n\n§ 12 Gerichtsstand und Rechtswahl\nEs gilt österreichisches Recht. Gerichtsstand ist das sachlich zuständige Gericht in Wien, Innere Stadt.`
const docB = `Werkvertrag Beta\n\n§ 4 Haftung\n${LIAB}\n\n§ 5 Höhere Gewalt\nKeine Partei haftet für Verzögerungen durch Ereignisse höherer Gewalt wie Krieg, Pandemie oder Naturkatastrophen, sofern sie die andere Partei unverzüglich verständigt.`
const docMatter = `Side letter Acme\n\n1. Confidentiality\nEach party shall keep confidential all information received from the other party and shall not disclose it to third parties without prior written consent.`

test('split at clause headings; type by heading and text', () => {
  const parts = cl.split(docA)
  assert.deepStrictEqual(parts.map((p) => p.heading), ['§ 1 Gegenstand', '§ 9 Haftung', '§ 12 Gerichtsstand und Rechtswahl'])
  assert.strictEqual(cl.classify(parts[1].heading, parts[1].text), 'liability')
  assert.strictEqual(cl.classify(parts[2].heading, parts[2].text), 'disputes')
  assert.strictEqual(cl.classify('§ 5 Höhere Gewalt', 'Keine Partei haftet für Verzögerungen durch höhere Gewalt.'), 'force_majeure', 'heading beats a passing mention of liability')
  assert.strictEqual(cl.classify('1. Confidentiality', 'Each party shall keep confidential …'), 'confidentiality')
  assert.ok(!cl.split('Kurzer Text ohne Überschriften.').length)
})

test('same wording under different numbers counts as one clause used twice', () => {
  cl.updateFile('/firm/alpha.docx', docA, '')
  cl.updateFile('/firm/beta.docx', docB, '')
  const hits = cl.search({ type: 'liability' })
  assert.strictEqual(hits.length, 1)
  assert.strictEqual(hits[0].uses, 2)
  assert.deepStrictEqual(hits[0].documents.sort(), ['alpha.docx', 'beta.docx'])
  assert.strictEqual(hits[0].lang, 'de')
  assert.strictEqual(hits[0].label, 'Liability & limitation')
})

test('matter scoping: matter clauses stay in their matter', () => {
  cl.updateFile('/matters/acme/side-letter.docx', docMatter, 'm_acme')
  assert.strictEqual(cl.search({ type: 'confidentiality', matterId: 'm_acme' }).length, 1)
  assert.strictEqual(cl.search({ type: 'confidentiality', matterId: 'm_other' }).length, 0)
  assert.strictEqual(cl.search({ type: 'confidentiality' }).length, 0, 'not firm-wide either')
  const ov = cl.overview('m_acme')
  assert.strictEqual(ov.files, 3)
  assert.strictEqual(ov.types.find((t) => t.id === 'liability').count, 2)
})

test('word search, removal, persistence', () => {
  assert.strictEqual(cl.search({ query: 'Pandemie Naturkatastrophen' })[0].type, 'force_majeure')
  assert.strictEqual(cl.search({ query: 'Kryptowährung Blockchain' }).length, 0)
  cl.removeFile('/firm/beta.docx')
  cl._reset() // reload from disk
  assert.strictEqual(cl.search({ type: 'liability' })[0].uses, 1)
  assert.strictEqual(fs.statSync(cl.STORE).mode & 0o777, 0o600)
})

test('agent tool find_clause returns the firm wording with its sources', async () => {
  const tools = require('../src/tools')
  const r = await tools.dispatch({ doc: { jurisdiction: () => 'AT' } }, 'find_clause', { type: 'liability' })
  assert.match(r.output, /Liability & limitation — "§ 9 Haftung" — used in 1 document \(alpha\.docx\)/)
  assert.match(r.output, /ausgenommen Vorsatz und grobe Fahrlässigkeit/)
  const none = await tools.dispatch({ doc: {} }, 'find_clause', { type: 'insurance' })
  assert.match(none.output, /No firm clauses found of type insurance/)
})
