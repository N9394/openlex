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

test('person cues without a known first name are proposed to the model (initials, titles, birth names)', () => {
  const { cues } = require('../src/pii_candidates')
  const t = 'Monteur J. Wagner) | 6\n11 | ZAUNER M. | Bahnhof\nMaître Inès Benkirane, avant\nPán Nagy trvalo\nTisztelt Tóth Úr!\nMag. Theresa Wolf, geb. Lindner\nSchedule A. The parties\nsee Annex B.\n'
  const got = cues(t).map((f) => t.slice(f.start, f.end))
  for (const want of ['Wagner', 'ZAUNER M.', 'Inès Benkirane', 'Nagy', 'Tóth', 'Lindner']) assert.ok(got.includes(want), `${want}: ${JSON.stringify(got)}`)
  assert.ok(!got.some((g) => /Schedule|Annex/.test(g)))
})

test('inflected and derived forms of a name found elsewhere are spread (possessives, family-name-first, mobile e, Hungarian lengthening)', () => {
  const d = require('../src/pii_detect')
  const spread = (name, t) => d.scan(t, { terms: [{ text: name, kind: 'PERSON', source: 'found' }], all: true }).map((f) => f.text)
  assert.deepStrictEqual(spread('Tomáš Novák', 'Tomáš Novák platil. Novákův syn je ochoten'), ['Tomáš Novák', 'Novákův'])
  assert.deepStrictEqual(spread('ŠVEC Lubomír', 'ŠVEC Lubomír. Švcova přihláška. Švec'), ['ŠVEC Lubomír', 'Švcova', 'Švec'])
  assert.deepStrictEqual(spread('Kočí Zdeňka', 'Kočí Zdeňka. Kočímu byla zaslána'), ['Kočí Zdeňka', 'Kočímu'])
  assert.deepStrictEqual(spread('Silvia Mrázová', 'Silvia Mrázová; Silviin servisný zošit'), ['Silvia Mrázová', 'Silviin'])
  assert.deepStrictEqual(spread('Ewa Nowicka', 'Ewa Nowicka. Ewei i se va comunica'), ['Ewa Nowicka', 'Ewei'])
  assert.deepStrictEqual(spread('Juhász Ferenc', 'Juhász Ferenc. Juhász kontra Tóth'), ['Juhász Ferenc', 'Juhász'])
  // a short surname takes only name-like endings: "Lisowa", never "List" or "Lisa"
  assert.deepStrictEqual(spread('Lis Joanna', 'Lis Joanna. Lisowa kandydatura. List. Lisa'), ['Lis Joanna', 'Lisowa'])
})

test('lower-case sign-offs of a hidden name; initials that go on', () => {
  const { glue, signoffs } = require('../src/pii_person')
  const t = 'Kerstin Fischer schrieb.\n\nViele Grüße\nkerstin\n\nkerstin ist nett'
  const out = signoffs(t, [{ kind: 'PERSON', text: 'Kerstin Fischer', start: 0, end: 15, on: true }])
  assert.deepStrictEqual(out.map((f) => f.text), ['Kerstin Fischer', 'kerstin'])
  const u = 'Signed by the Tenants: Lucía F. O.   Mateus O.'
  const s = u.indexOf('Lucía F.')
  assert.deepStrictEqual(glue(u, [{ kind: 'PERSON', text: 'Lucía F.', start: s, end: s + 8, on: true }]).map((f) => f.text), ['Lucía F. O.'])
})
