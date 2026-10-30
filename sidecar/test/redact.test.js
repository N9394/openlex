"use strict"
/**
 * Redact-before-send: placeholders out, real names back, provider never
 * sees the client's names.
 *
 *   node --test test/redact.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-redact-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-test'

const { Redactor } = require('../src/redact')

test('terms (longest first, case-insensitive, word bounded) and patterns', () => {
  const r = new Redactor(['Acme', 'Acme Holding GmbH', 'Dr. Eva Huber'])
  const out = r.redact('Acme Holding GmbH (Acme) and Dr. Eva Huber, eva.huber@acme.at, IBAN AT61 1904 3002 3457 3201, tel +43 664 1234567. § 1295 ABGB, 2026. Acmeville stays.')
  assert.ok(!/Acme Holding|Eva Huber|eva\.huber|AT61|664 1234567/.test(out), out)
  assert.match(out, /^\[\[PARTY_\d\]\] \(\[\[PARTY_\d\]\]\) and \[\[PARTY_\d\]\], \[\[EMAIL_1\]\], IBAN \[\[IBAN_1\]\], tel \[\[PHONE_1\]\]\./)
  assert.match(out, /§ 1295 ABGB, 2026/, 'statute numbers and years untouched')
  assert.match(out, /Acmeville/, 'no partial-word replacement')
  assert.strictEqual(r.restore(out), 'Acme Holding GmbH (Acme) and Dr. Eva Huber, eva.huber@acme.at, IBAN AT61 1904 3002 3457 3201, tel +43 664 1234567. § 1295 ABGB, 2026. Acmeville stays.')
  assert.strictEqual(r.restore('[[PARTY_3]]] and [PARTY_1]]'), 'Dr. Eva Huber and Acme Holding GmbH', 'tolerates a lost/extra bracket')
})

test('stream restorer handles placeholders split across chunks', () => {
  const r = new Redactor(['Beta AG'])
  r.redact('Beta AG')
  let got = ''
  const s = r.streamRestorer((t) => { got += t })
  for (const c of ['The claim against [', '[PAR', 'TY_1]', '] is time-barred [see § 1489].']) s.push(c)
  s.flush()
  assert.strictEqual(got, 'The claim against Beta AG is time-barred [see § 1489].')
})

test('cloud call: provider sees placeholders only, user gets real names', async () => {
  const seen = []
  const fake = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push(JSON.stringify(body.messages))
      // Answer like a model would: reuse the placeholders it was given.
      const q = body.messages.map((m) => m.content).join(' ')
      const [, a = '?', b = '?'] = q.match(/Does (\[\[\w+\]\]) owe (\[\[\w+\]\])/) || []
      const mail = (q.match(/\[\[EMAIL_\d+\]\]/) || ['?'])[0]
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const t of [a.slice(0, 5), a.slice(5) + ' owes ', `${b} EUR 10k; write to ${mail}.`]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  try {
    const settings = require('../src/providers/settings')
    settings.update({ provider: 'openai', overrides: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'gpt-test' } })
    settings.update({ active: 'openai' })
    const policy = require('../src/policy')
    const matters = require('../src/matters')
    const m = matters.create({ title: 'Acme v. Beta', client: 'Acme Holding GmbH' })
    matters.update(m.id, { redactTerms: 'Beta AG, Dr. Eva Huber' })
    policy.setRule(m.id, { mode: 'allow-list', providers: ['openai'], redact: true })

    const llm = require('../src/llm')
    const streamed = []
    const r = await policy.withMatter(m.id, () => llm.chatWithReasoning([
      { role: 'user', content: 'Does Acme Holding GmbH owe Beta AG? Contact: eva.huber@acme.at (Dr. Eva Huber).' },
    ], { onContent: (t) => streamed.push(t) }))

    assert.ok(!/Acme Holding|Beta AG|Eva Huber|eva\.huber/.test(seen[0]), seen[0])
    assert.strictEqual(r.content, 'Acme Holding GmbH owes Beta AG EUR 10k; write to eva.huber@acme.at.')
    assert.strictEqual(streamed.join(''), r.content)
    const audit = fs.readFileSync(policy.AUDIT_PATH, 'utf8').trim().split('\n').map(JSON.parse).pop()
    assert.strictEqual(audit.redacted, 4)

    // Without redact in the rule and with the redaction check switched off, the text goes as-is.
    policy.setRule(m.id, { mode: 'allow-list', providers: ['openai'] })
    require('../src/redaction_check').setCheck(false)
    await policy.withMatter(m.id, () => llm.chatWithReasoning([{ role: 'user', content: 'Acme Holding GmbH' }]))
    assert.match(seen[1], /Acme Holding GmbH/)
  } finally {
    fake.close()
    fs.rmSync(DATA, { recursive: true, force: true })
  }
})
