"use strict"
/**
 * Pattern matching on large documents stays linear: no detection pattern
 * (pii_patterns.js) takes seconds on long runs without spaces — a crafted
 * document must not stall the engine (one thread for every window).
 *
 *   node --test test/redos.test.js
 */

const test = require('node:test')
const assert = require('assert')

test('every PII pattern handles 200 000 characters of adversarial text quickly', () => {
  const { PATTERNS } = require('../src/pii_patterns')
  const inputs = ['a.'.repeat(100000), '1 '.repeat(100000), 'A'.repeat(200000), '1/'.repeat(100000), 'A1 '.repeat(70000), '1'.repeat(200000), 'a@'.repeat(100000), 'x@' + 'a.'.repeat(100000) + '1', 'Abcdefgh '.repeat(25000)]
  const slow = []
  for (const p of PATTERNS) {
    if (!p.re) continue
    for (const s of inputs) {
      const t = Date.now()
      s.replace(new RegExp(p.re.source, p.re.flags), 'x')
      const ms = Date.now() - t
      if (ms > 1500) slow.push(`${p.id}: ${ms} ms on ${JSON.stringify(s.slice(0, 6))}…`)
    }
  }
  assert.deepStrictEqual(slow, [])
})

test('the e-mail pattern still finds ordinary addresses', () => {
  const { PATTERNS } = require('../src/pii_patterns')
  const re = PATTERNS.find((p) => p.id === 'email').re
  assert.deepStrictEqual('Mail max.mustermann@kanzlei-wien.co.at or x@y.de.'.match(new RegExp(re.source, re.flags)), ['max.mustermann@kanzlei-wien.co.at', 'x@y.de'])
})
