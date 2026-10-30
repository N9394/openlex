"use strict"
/**
 * Paths the model names (analyse_document's `file`): only the matter's
 * folders, the working folder or the workspace — never any file on the
 * computer, also not through a symlink.
 *
 *   node --test test/agent_paths.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-paths-'))
process.env.LEXVAULT_DATA_DIR = DATA
const WS = path.join(DATA, 'workspace')
const OUTSIDE = path.join(DATA, 'outside')

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

test('the agent may name documents in the workspace, not files elsewhere', () => {
  require('../src/workspace').setBase(WS)
  fs.mkdirSync(path.join(WS, 'm1'), { recursive: true })
  fs.mkdirSync(OUTSIDE)
  fs.writeFileSync(path.join(WS, 'm1', 'contract.txt'), 'A contract.')
  fs.writeFileSync(path.join(OUTSIDE, 'id_rsa'), 'PRIVATE KEY')
  try { fs.symlinkSync(OUTSIDE, path.join(WS, 'link')) } catch { /* Windows without symlink rights */ }
  const { resolveDoc } = require('../src/workflows_docs')
  assert.strictEqual(fs.realpathSync(resolveDoc(null, path.join(WS, 'm1', 'contract.txt'), { strict: true })), fs.realpathSync(path.join(WS, 'm1', 'contract.txt')))
  assert.ok(resolveDoc(null, 'm1/contract.txt', { strict: true }).endsWith('contract.txt'))
  for (const f of [path.join(OUTSIDE, 'id_rsa'), '../outside/id_rsa', '~/.ssh/id_rsa', 'link/id_rsa', path.join(WS, 'link', 'id_rsa')]) {
    assert.throws(() => resolveDoc(null, f, { strict: true }), /may not|outside|not in this matter/, f)
  }
  // The lawyer's own front ends (a file they picked) are not limited.
  assert.strictEqual(resolveDoc(null, path.join(OUTSIDE, 'id_rsa')), path.join(OUTSIDE, 'id_rsa'))
})

test('analyse_document passes the strict rule for the file the model names', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tools.js'), 'utf8')
  assert.match(src, /runAnalyse\(\{ matterId, \.\.\.input, strict: true \}\)/)
})
