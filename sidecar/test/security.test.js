"use strict"
/**
 * Tool security: run_bash is off by default, allowlisted, path-checked,
 * runs without secrets in an OS sandbox; file tools stay inside the
 * workspace even through symlinks, keep previous versions, and cannot
 * change the firm's configuration.
 *
 *   node --test test/security.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-sec-'))
process.env.LEXVAULT_DATA_DIR = DATA
process.env.OPENLEX_KEY_OPENAI = 'sk-must-never-leak'

let ws
const WS = path.join(DATA, 'workspace')
const OUTSIDE = path.join(DATA, 'outside')
const shellOn = (on, extra = {}) => fs.writeFileSync(path.join(DATA, 'openlex.json'), JSON.stringify({ features: { shell: on, ...extra } }))

test.before(() => {
  ws = require('../src/workspace')
  ws.setBase(WS)
  fs.mkdirSync(OUTSIDE)
  fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'TOP SECRET')
  fs.writeFileSync(path.join(WS, 'notes.txt'), 'hello world\nsecond line\n')
  fs.symlinkSync(OUTSIDE, path.join(WS, 'escape'))
})
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

test('run_bash is off unless the firm turns it on', async () => {
  shellOn(false)
  assert.match(await ws.runBash('ls'), /turned off/)
})

test('only read/organise commands; code, network, env and delete commands are refused', () => {
  for (const cmd of ['python3 x.py', 'node x.js', 'npm install', 'pip install x', 'curl https://example.com', 'wget x', 'env', 'rm -rf notes.txt', 'chmod 777 notes.txt', 'dd if=notes.txt', '/bin/ls', 'bash -lc ls', 'sh notes.txt']) {
    assert.throws(() => ws.checkCommand(cmd), /not allowed|by name/, cmd)
  }
})

test('shell syntax and dangerous options are refused', () => {
  for (const cmd of ['ls; rm notes.txt', 'cat notes.txt | head', 'ls && pwd', 'echo $(whoami)', 'echo `id`', 'cat < notes.txt', 'echo x > notes.txt', 'find . -delete', 'find . -name x -execdir ls', 'git -c core.pager=less log', 'git push', 'git config user.name x', 'grep -f notes.txt notes.txt', 'date -s 2020', 'cp -f notes.txt b.txt']) {
    assert.throws(() => ws.checkCommand(cmd), Error, cmd)
  }
})

test('paths must stay in the workspace, also through symlinks; ~ and absolute paths are refused', () => {
  for (const cmd of ['cat /etc/passwd', 'cat ~/.ssh/id_ed25519', 'cat ../outside/secret.txt', `cat ${path.join(OUTSIDE, 'secret.txt')}`, 'cat escape/secret.txt', 'cp notes.txt escape/x.txt', 'find escape', 'grep -r TOP escape', 'ls --color=/tmp']) {
    assert.throws(() => ws.checkCommand(cmd), /outside the OpenLex workspace|outside the workspace/, cmd)
  }
  assert.throws(() => ws.writeFile('escape/planted.txt', 'x'), /outside/)
  assert.throws(() => ws.readFile('escape/secret.txt'), /outside/)
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'planted.txt')))
})

test('allowed commands run, see no secrets, and cp never overwrites', async () => {
  shellOn(true)
  const sb = ws.sandboxFor(ws.realBase())
  if (!sb) shellOn(true, { shellWithoutSandbox: true }) // CI without a sandbox: still test the checks
  assert.match(await ws.runBash('grep -n second notes.txt'), /2:second line/)
  assert.match(await ws.runBash('cat "notes.txt"'), /hello world/)
  fs.writeFileSync(path.join(WS, 'b.txt'), 'original')
  await ws.runBash('cp notes.txt b.txt')
  assert.strictEqual(fs.readFileSync(path.join(WS, 'b.txt'), 'utf8'), 'original', 'cp -n: no overwrite')
  assert.ok(!(await ws.runBash('echo hello')).includes('sk-must-never-leak'))
})

test('the OS sandbox blocks writes outside, home reads and network even if a check slipped', { skip: !require('../src/workspace').sandboxFor || process.platform === 'win32' }, async () => {
  const sb = ws.sandboxFor(ws.realBase())
  if (!sb) return
  const { execFileSync } = require('child_process')
  const run = (bin, args) => { const [f, a] = sb.wrap(bin, args); try { return { ok: true, out: execFileSync(f, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } } catch (e) { return { ok: false, out: String(e.stderr || e.message) } } }
  const target = path.join(fs.realpathSync(OUTSIDE), 'written-by-sandbox.txt')
  assert.strictEqual(run('/bin/cp', [path.join(ws.realBase(), 'notes.txt'), target]).ok, false)
  assert.ok(!fs.existsSync(target))
  const homeFile = path.join(os.homedir(), '.bash_history')
  if (fs.existsSync(homeFile)) assert.strictEqual(run('/bin/cat', [homeFile]).ok, false, 'no reads in the home folder')
  if (fs.existsSync('/usr/bin/curl')) assert.strictEqual(run('/usr/bin/curl', ['-s', '-m', '3', 'https://example.com']).ok, false, 'no network')
  assert.strictEqual(run('/bin/cp', [path.join(ws.realBase(), 'notes.txt'), path.join(ws.realBase(), 'c.txt')]).ok, true, 'writes inside still work')
})

test('overwrites keep the previous version; restore brings it back', () => {
  ws.writeFile('Acme/memo.md', 'v1')
  ws.writeFile('Acme/memo.md', 'v2')
  ws.appendFile('Acme/memo.md', '+')
  assert.strictEqual(ws.versions('Acme/memo.md').length, 2)
  ws.restoreVersion('Acme/memo.md', ws.versions('Acme/memo.md')[1].version)
  assert.strictEqual(fs.readFileSync(ws.resolve('Acme/memo.md'), 'utf8'), 'v1')
  assert.ok(!ws.listFiles().some((f) => f.path.startsWith('.openlex')), 'history stays out of listings')
})

test('the agent cannot write the firm configuration', async () => {
  const { dispatch } = require('../src/tools')
  for (const p of ['openlex.json', 'skills/x/SKILL.md', 'playbooks/nda.json', '.openlex/history/x']) {
    const r = await dispatch({}, 'write_file', { path: p, content: '{"features":{"shell":true}}' })
    assert.match(r.output, /protected/, p)
  }
  const ok = await dispatch({}, 'write_file', { path: 'Acme/out.md', content: 'fine' })
  assert.match(ok.output, /^written:/)
})
