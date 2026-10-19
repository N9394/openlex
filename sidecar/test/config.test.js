"use strict"
/**
 * OpenLex rename: OPENLEX_* settings alias the LEXVAULT_* ones.
 *
 *   node --test test/config.test.js
 */

const test = require('node:test')
const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')

const port = (env) => execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./src/config').PORT))"], {
  cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
}).toString()

test('OPENLEX_* names work, LEXVAULT_* still work and win when both are set', () => {
  assert.strictEqual(port({}), '18001')
  assert.strictEqual(port({ OPENLEX_SIDECAR_PORT: '19001' }), '19001')
  assert.strictEqual(port({ LEXVAULT_SIDECAR_PORT: '19002' }), '19002')
  assert.strictEqual(port({ LEXVAULT_SIDECAR_PORT: '19002', OPENLEX_SIDECAR_PORT: '19001' }), '19002')
})
