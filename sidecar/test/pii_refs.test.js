"use strict"
/**
 * Labelled references and dates of birth (pii_patterns.js: ref.ctx, ref.notary, dob).
 *
 *   node --test test/pii_refs.test.js
 */

const test = require('node:test')
const assert = require('assert')
const detect = require('../src/pii_detect')

const found = (t, kinds = ['ID', 'DATE']) => detect.scan(t, { all: true }).filter((f) => kinds.includes(f.kind)).map((f) => f.text)

test('a reference after its label is found, in every language', () => {
  const cases = {
    'Harrowgate Lettings – our ref SB/WRO/0412\n': 'SB/WRO/0412',
    'Kundennummer: K-40912\nAuftrag': 'K-40912',
    'Das Kennzeichen war HH-KS 4471. Ich': 'HH-KS 4471',
    'dowodem osobistym nr CAX 418273, PESEL': 'CAX 418273',
    'evidenčné číslo PO-482KX, rok výroby': 'PO-482KX',
    'a used car, registration SK19 XHT, on 12 June': 'SK19 XHT',
    'identificat cu CI seria MZ nr. 418273, CNP': 'MZ nr. 418273',
    '(KASZ: 36071459) készítette': '36071459',
    'Claim No. K00CL482\n': 'K00CL482',
  }
  for (const [t, want] of Object.entries(cases)) assert.ok(found(t).includes(want), `${want} in ${JSON.stringify(t)}: ${JSON.stringify(found(t))}`)
  assert.deepStrictEqual(found('N 412/2026\nNz 38811/2026\nNCRls 39204/2026\n'), ['N 412/2026', 'Nz 38811/2026', 'NCRls 39204/2026'])
})

test('no label, no reference: section numbers, years and counts stay', () => {
  for (const t of ['under section 12 of the Act', 'see ref. 2019', 'number of staff 12', 'Artikel 5 Absatz 2']) assert.deepStrictEqual(found(t), [], t)
})

test('dates of birth with a place before them, Polish "r." and the Hungarian order', () => {
  assert.deepStrictEqual(found('urodzonym 5 stycznia 1950 r., PESEL'), ['5 stycznia 1950 r.'])
  assert.deepStrictEqual(found('Született: Debrecen, 1967. március 31.\nAdó'), ['1967. március 31.'])
  assert.deepStrictEqual(found('Der Vertrag beginnt am 5. Jänner 2027.'), [])
})
