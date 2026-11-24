"use strict"
/**
 * Health data candidates (pii_health.js).
 *
 *   node --test test/pii_health.test.js
 */

const test = require('node:test')
const assert = require('assert')
const { health } = require('../src/pii_health')

const found = (t) => health(t).map((f) => t.slice(f.start, f.end))

test('a health word grows into its phrase: modifiers, connectors, a bracket, "since <date>"', () => {
  assert.deepStrictEqual(found('you have told us that you have type 1 diabetes; we will'), ['type 1 diabetes'])
  assert.deepStrictEqual(found('| Porter | on long-term sick leave since 08/2026 (back injury)\n'), ['on long-term sick leave since 08/2026 (back injury)'])
  assert.deepStrictEqual(found('| 2 270,00 | arrêt maladie depuis le 12/08 (burn-out)\n'), ['arrêt maladie depuis le 12/08 (burn-out)'])
  assert.deepStrictEqual(found('est atteinte d’une maladie de Parkinson qui'), ['maladie de Parkinson'])
  assert.deepStrictEqual(found('I suffer from early-stage macular degeneration and'), ['early-stage macular degeneration'])
})

test('inflected forms and compounds in the other languages', () => {
  assert.deepStrictEqual(found('podstoupila léčbu onkologického onemocnění.'), ['léčbu onkologického onemocnění'])
  assert.deepStrictEqual(found('je držiteľom preukazu ZŤP (sluchové postihnutie); pracovisko'), ['držiteľom preukazu ZŤP (sluchové postihnutie)'])
  assert.deepStrictEqual(found('że jest w ciąży (14. tydzień); Pracodawca'), ['ciąży (14. tydzień)'])
  assert.deepStrictEqual(found('a férje depresszió miatt áll pszichiátriai kezelés alatt.'), ['depresszió miatt áll pszichiátriai kezelés alatt'])
  assert.deepStrictEqual(found('kért a rokkantsági ellátásáról, mert'), ['rokkantsági ellátásáról'])
  assert.deepStrictEqual(found('(Gehbehinderung, Pflegestufe 2); der Vermieter'), ['Gehbehinderung, Pflegestufe 2'])
})

test('numbers before a health word only with a modifier; no health word, no candidate', () => {
  assert.deepStrictEqual(found('§ 8 Krankheit des Arbeitnehmers'), ['Krankheit'])
  for (const t of ['The tenant pays the rent by the 3rd of each month.', 'Der Vertrag endet am 31.12.2026.', 'Arrêt de la Cour du 12 mars']) {
    assert.deepStrictEqual(found(t), [], t)
  }
})

test('every candidate is OTHER for the decision model to judge', () => {
  const f = health('She is pregnant.')
  assert.strictEqual(f.length, 1)
  assert.strictEqual(f[0].kind, 'OTHER')
})
