"use strict"
/**
 * GET /api/sources/law?matterId=… — per source: how often it answered a
 * lookup in this matter (from the AI record's audit lines), plus the
 * gateway flag and jurisdictions. Offline: audit lines are written directly.
 *
 *   node --test test/law_uses.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-lawuses-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_NO_BROWSER = '1'
process.env.OPENLEX_MONITORS = '0'
test.after(() => fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))

test('uses per source in one matter: answered lookups only, other matters not counted', async () => {
  require('../src/workspace').setBase(path.join(DATA, 'workspace'))
  const policy = require('../src/policy')
  const record = require('../src/record')
  const ls = require('../src/connectors')
  ls._setStore({ get: async () => null, set: async () => {} })
  const line = (matter, id, extra) => policy.audit({ provider: `source:${id}`, model: 'connector', matter, call: 'law_source', decision: 'allowed', ...extra })
  line('m1', 'ris', { ok: true, ms: 5, results: 3 })
  line('m1', 'ris', { ok: true, ms: 5, results: 1 })
  line('m1', 'ris', {}) // the permission check before a call: not a use
  line('m1', 'eurlex', { ok: false, ms: 5, error: 'down' }) // failed: not a use
  line('m1', 'ansvar', { ok: true, ms: 5, results: 2 })
  line('m2', 'eurlex', { ok: true, ms: 5, results: 2 })
  policy.audit({ provider: 'web', model: 'example.org', matter: 'm1', call: 'web_fetch', decision: 'allowed' })

  assert.deepStrictEqual(record.sourceUses('m1'), { ris: 2, ansvar: 1 })
  assert.deepStrictEqual(record.sourceUses(null), {})

  const st = await ls.status({ matterId: 'm1' })
  const by = Object.fromEntries(st.map((s) => [s.id, s]))
  assert.strictEqual(by.ris.uses, 2)
  assert.strictEqual(by.ansvar.uses, 1)
  assert.strictEqual(by.eurlex.uses, 0)
  for (const s of st) {
    assert.strictEqual(typeof s.uses, 'number', s.id)
    assert.strictEqual(typeof s.gateway, 'boolean', s.id)
    assert.ok(Array.isArray(s.jurisdictions), s.id)
  }
  assert.strictEqual(by.ansvar.gateway, true)
  assert.strictEqual(by.ris.gateway, false)
  assert.ok(by.ris.jurisdictions.includes('AT'))
  assert.strictEqual((await ls.status({ matterId: 'm2' })).find((s) => s.id === 'eurlex').uses, 1)
  // Without a matter: no counts (null), everything else as before.
  for (const s of await ls.status()) assert.strictEqual(s.uses, null, s.id)
})
