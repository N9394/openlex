"use strict"
/**
 * Address glue (pii_address.js): the pieces of one address become one ticked finding.
 *
 *   node --test test/pii_address.test.js
 */

const test = require('node:test')
const assert = require('assert')
const { glue } = require('../src/pii_address')

// A ticked piece where `piece` occurs in `text` (what a pattern or the decision model left).
const at = (text, piece, extra = {}) => {
  const start = text.indexOf(piece)
  return { kind: 'ADDRESS', text: piece, start, end: start + piece.length, on: true, source: 'model', ...extra }
}
const glued = (text, findings) => glue(text, findings).filter((f) => f.source === 'address').map((f) => f.text)

test('pieces of one address on a line become one finding, lead and trailing words stay out', () => {
  const t = 'I read the tenancy agreement for Flat 3, 18 Marsh Lane, Leeds LS9 8AB. Your landlord wrote.'
  assert.deepStrictEqual(glued(t, [at(t, '18 Marsh Lane'), at(t, 'Leeds')]), ['Flat 3, 18 Marsh Lane, Leeds LS9 8AB'])
  const f = 'dont le siège social est situé 14, rue Victor Hugo, 69002 Lyon, représentée par M. B.'
  assert.deepStrictEqual(glued(f, [at(f, 'Victor Hugo')]), ['14, rue Victor Hugo, 69002 Lyon'])
  const r = 'cu domiciliul în București, Str. Gen. Ernest Broșteanu nr. 7, sector 1, CNP 1640407073898'
  assert.deepStrictEqual(glued(r, [at(r, 'București'), at(r, 'Broșteanu')]), ['București, Str. Gen. Ernest Broșteanu nr. 7, sector 1'])
})

test('an address block over lines: street line, then postcode and town', () => {
  const t = 'Novák advokátska kancelária s.r.o.\nŠtúrova 9\n811 02 Bratislava\ntel.: +421 2 5441 7720'
  assert.deepStrictEqual(glued(t, [at(t, 'Bratislava')]), ['Štúrova 9\n811 02 Bratislava'])
  const e = 'Baker Price Solicitors LLP\n2 Park Square East\nLeeds LS1 2NE\nDDI 0113 496 0731'
  assert.deepStrictEqual(glued(e, []), ['2 Park Square East\nLeeds LS1 2NE'])
})

test('a trailing comma carries the address to the next line; a line that is not an address ends it', () => {
  const t = 'demeurant Résidence Les Tilleuls, bât. C,\n8, avenue Jean Jaurès, 69007 Lyon,\nci-après « la Salariée ».'
  assert.deepStrictEqual(glued(t, [at(t, 'Résidence Les Tilleuls')]), ['Résidence Les Tilleuls, bât. C,\n8, avenue Jean Jaurès, 69007 Lyon'])
})

test('two addresses in one sentence stay two', () => {
  const t = 'of The Old Rectory, Church Lane, Sleights, Whitby YO22 5AA and Anjali Lord-Banerjee of 29 Clifton Road, York YO30 6AY jointly'
  assert.deepStrictEqual(glued(t, [at(t, 'Old Rectory'), at(t, 'Sleights'), at(t, '29 Clifton Road')]),
    ['The Old Rectory, Church Lane, Sleights, Whitby YO22 5AA', '29 Clifton Road, York YO30 6AY'])
})

test('no anchor, no glue: numbers that look like postcodes or house numbers are not addresses', () => {
  for (const t of ['nicht durch meinen Tod (§ 1022 ABGB).', 'Abgasanlage nach DIN EN 1443 | 1 | 690,00', 'under section 1 of the Employment Rights Act 1996)']) {
    assert.deepStrictEqual(glued(t, []), [], t)
  }
})

test('a court’s or an authority’s address is left as it is', () => {
  const t = 'An das\nLandgericht München I\nPrielmayerstraße 7\n80335 München\n\nKLAGE'
  assert.deepStrictEqual(glued(t, [at(t, 'München I')]), [])
  const c = 'Okresní soud v Kladně\nnám. Edvarda Beneše 1478\n272 01 Kladno\n\nŽalobce: Tomáš Novák'
  assert.deepStrictEqual(glued(c, []), [])
})

test('the decision model’s "not personal data" stands, and nothing is ever unticked', () => {
  const t = 'Sitz: Hauptstraße 5, 10115 Berlin.'
  const veto = at(t, 'Hauptstraße 5', { on: false, decided: { answer: 'not_personal', outcome: 'automate' } })
  assert.deepStrictEqual(glued(t, [veto]), [])
  const other = { kind: 'EMAIL', text: 'a@b.de', start: 0, end: 6, on: true }
  const p = 'a@b.de, Flat 2, 15 Skinner Street, Whitby YO21 3AH'
  const out = glue(p, [other, at(p, '15 Skinner Street')])
  assert.ok(out.some((f) => f.kind === 'EMAIL' && f.on))
  assert.deepStrictEqual(out.filter((f) => f.kind === 'ADDRESS').map((f) => [f.text, f.on]), [['Flat 2, 15 Skinner Street, Whitby YO21 3AH', true]])
})
