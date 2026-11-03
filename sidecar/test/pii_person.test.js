"use strict"
/**
 * Name glue (pii_person.js): a ticked part of a name is widened over the rest of the same name.
 *
 *   node --test test/pii_person.test.js
 */

const test = require('node:test')
const assert = require('assert')
const { glue } = require('../src/pii_person')

const at = (text, piece, extra = {}) => {
  const start = text.indexOf(piece)
  return { kind: 'PERSON', text: piece, start, end: start + piece.length, on: true, source: 'spread', ...extra }
}
const names = (text, findings) => glue(text, findings).filter((f) => f.kind === 'PERSON' && f.on).map((f) => f.text)

test('a surname is widened over its first name, title and initials', () => {
  let t = 'Viele Grüße\nKerstin Fischer | Geschäftsführerin'
  assert.deepStrictEqual(names(t, [at(t, 'Fischer')]), ['Kerstin Fischer'])
  t = 'représentée par M. Laurent Boulanger, en sa qualité de président'
  assert.deepStrictEqual(names(t, [at(t, 'Boulanger')]), ['M. Laurent Boulanger'])
  t = 'Auch die Klägerin – Frau A. H.-K. in der Korrespondenz'
  assert.deepStrictEqual(names(t, [at(t, 'A. H.')]), ['Frau A. H.-K.'])
  t = '2. Elena-Cristina Ursu, născută Vulpe'
  assert.deepStrictEqual(names(t, [at(t, 'Cristina Ursu')]), ['Elena-Cristina Ursu'])
})

test('unknown first names in a name slot, particles and capitals', () => {
  let t = 'Landlord: Ciarán Ó Súilleabháin, of Rathmore House'
  assert.deepStrictEqual(names(t, [at(t, 'Súilleabháin')]), ['Ciarán Ó Súilleabháin'])
  t = 'Present:\n2. Chen Jiayi (Gesellschafterin 35 %)'
  assert.deepStrictEqual(names(t, [at(t, 'Jiayi')]), ['Chen Jiayi'])
  t = 'BY EDITH MARGARET LORD, born 2 May 1941'
  assert.deepStrictEqual(names(t, [at(t, 'LORD')]), ['EDITH MARGARET LORD'])
})

test('family name first: Hungarian order, table cells, "NOWAK, Zdeněk"', () => {
  let t = 'Üdvözlettel:\n\ndr. Halász Krisztina\nügyvéd'
  assert.deepStrictEqual(names(t, [at(t, 'Krisztina')]), ['dr. Halász Krisztina'])
  t = '3 | Huber Andreas | Ignaz-Harrer-Straße 77'
  assert.deepStrictEqual(names(t, [at(t, 'Huber')]), ['Huber Andreas'])
  t = '6 | NOWAK, Zdeněk | Lidická 22'
  assert.deepStrictEqual(names(t, [at(t, 'NOWAK'), at(t, 'Zdeněk')]), ['NOWAK, Zdeněk'])
})

test('a surname a spread marked as a firm becomes the person after a first name', () => {
  const t = 'Geschäftsführer: Thomas Koch, Heinz Koch'
  const f = [at(t, 'Koch', { kind: 'ORG' }), { ...at(t, 'Koch', { kind: 'ORG' }), start: t.lastIndexOf('Koch'), end: t.lastIndexOf('Koch') + 4 }]
  assert.deepStrictEqual(names(t, f), ['Thomas Koch', 'Heinz Koch'])
})

test('lookalikes and sentence words are not pulled in; unticked findings stay as they are', () => {
  let t = 'Do not confuse it with Lord Street in Southport.'
  assert.deepStrictEqual(names(t, [at(t, 'Lord')]), ['Lord'])
  t = 'The Claimant says Mason was late.'
  assert.deepStrictEqual(names(t, [at(t, 'Mason')]), ['Mason'])
  t = 'Kerstin Fischer'
  assert.deepStrictEqual(glue(t, [at(t, 'Fischer', { on: false })]).map((f) => [f.text, f.on]), [['Fischer', false]])
})
