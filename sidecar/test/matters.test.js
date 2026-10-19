"use strict"
/**
 * Matters (Phase 2): shared store, doc binding, privileged → local-only.
 *
 *   node --test test/matters.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-matters-'))
process.env.LEXVAULT_DATA_DIR = DATA
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

const matters = require('../src/matters')
const policy = require('../src/policy')

test('create, list, update, close', () => {
  const m = matters.create({ title: 'Acme v. Beta', client: 'Acme GmbH', number: '2026-014' })
  assert.match(m.id, /^m_[a-f0-9]{12}$/)
  assert.strictEqual(m.policy.mode, 'local-only', 'inherits the default policy')
  assert.strictEqual(matters.list().length, 1)
  matters.update(m.id, { status: 'closed' })
  assert.strictEqual(matters.list().length, 0)
  assert.strictEqual(matters.list({ includeClosed: true }).length, 1)
  assert.throws(() => matters.update(m.id, { status: 'deleted' }), /status must be/)
  assert.throws(() => matters.create({ title: '  ' }), /title is required/)
})

test('privileged matters are pinned to local-only even when the default allows cloud', () => {
  policy.setRule(null, { mode: 'allow-list', providers: ['anthropic'] })
  const open = matters.create({ title: 'Lease review' })
  const priv = matters.create({ title: 'Internal investigation', privileged: true })
  const claude = { id: 'anthropic', local: false }
  assert.strictEqual(policy.check(claude, open.id).allowed, true)
  assert.strictEqual(policy.check(claude, priv.id).allowed, false)
  assert.strictEqual(matters.get(priv.id).policy.mode, 'local-only')
})

test('a document belongs to one matter; rebinding moves it', () => {
  const a = matters.create({ title: 'A' })
  const b = matters.create({ title: 'B' })
  matters.bindDoc(a.id, 'doc-1', 'SPA draft.docx')
  assert.strictEqual(matters.forDoc('doc-1').id, a.id)
  matters.bindDoc(b.id, 'doc-1', 'SPA draft.docx')
  assert.strictEqual(matters.forDoc('doc-1').id, b.id)
  assert.strictEqual(matters.get(a.id).docs.length, 0)
  matters.unbindDoc('doc-1')
  assert.strictEqual(matters.forDoc('doc-1'), null)
})

test('active matter per client; file is written atomically with 0600', () => {
  const m = matters.create({ title: 'Active one' })
  matters.setActive('app', m.id)
  assert.strictEqual(matters.active('app').id, m.id)
  assert.strictEqual(matters.active('word'), null)
  assert.throws(() => matters.setActive('app', 'm_nope'), /unknown matter/)
  assert.strictEqual(fs.statSync(matters.MATTERS_PATH).mode & 0o777, 0o600)
  assert.deepStrictEqual(fs.readdirSync(DATA).filter((f) => f.endsWith('.tmp')), [])
})
