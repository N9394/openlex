/**
 * Packaging rules for the public desktop installers:
 *   - product name OpenLex, but app id and settings folder stay (existing
 *     installs keep their data);
 *   - no update/licence server URL and no obfuscation in the open build;
 *   - the separate embeddings service is optional;
 *   - every downloaded binary is sha256-pinned.
 *
 *   node --test desktop/electron/test/packaging.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const pkg = require('../package.json')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

test('installers are called OpenLex; app id and settings folder stay LexVault', () => {
  assert.strictEqual(pkg.productName, 'OpenLex')
  assert.strictEqual(pkg.build.productName, 'OpenLex')
  assert.strictEqual(pkg.build.appId, 'com.lexvault.app')
  for (const k of ['mac', 'win', 'linux']) assert.match(pkg.build[k].artifactName, /^OpenLex-\$\{version\}-/, k)
  assert.match(read('main/main.js'), /app\.setPath\('userData', require\('path'\)\.join\(app\.getPath\('appData'\), 'LexVault'\)\)/)
})

test('no update or licence server in the open build, nothing obfuscated', () => {
  assert.ok(!pkg.build.publish, 'no publish/update feed in package.json')
  assert.ok(!JSON.stringify(pkg).includes('OPENLEX_UPDATE_FEED'))
  assert.ok(!pkg.devDependencies['javascript-obfuscator'] && !pkg.dependencies?.['javascript-obfuscator'])
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) {
    assert.ok(!/javascript-obfuscator|JsObfuscator/.test(read(`scripts/${f}`)), `scripts/${f} does not obfuscate`)
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'distribution.json')), 'no distribution.json in the repository')
})

test('package target from flags, env, host', () => {
  const { packageTarget } = require('../scripts/prepare-resources')
  assert.deepStrictEqual(packageTarget(['--mac', '--x64'], {}), { os: 'darwin', arch: 'x64', id: 'darwin-x64' })
  assert.deepStrictEqual(packageTarget(['--win'], {}), { os: 'win32', arch: 'x64', id: 'win32-x64' })
  assert.deepStrictEqual(packageTarget([], { PACKAGE_TARGETS: 'linux', PACKAGE_ARCH: 'arm64' }), { os: 'linux', arch: 'arm64', id: 'linux-arm64' })
  assert.ok(['darwin', 'win32', 'linux'].includes(packageTarget([], {}).os))
})

test('every Qdrant / llama.cpp download is sha256-pinned', () => {
  const f = require('../scripts/fetch-sidecars')
  for (const t of Object.keys(f.QDRANT_TARGETS)) assert.match(f.SHA256[`qdrant-${f.QDRANT_VERSION}-${t}`] || '', /^[0-9a-f]{64}$/, `qdrant ${t}`)
  for (const t of Object.keys(f.LLAMA_TARGETS)) assert.match(f.SHA256[`llama-${f.LLAMA_BUILD}-${t}`] || '', /^[0-9a-f]{64}$/, `llama ${t}`)
})

test('the app boots without an embeddings service (the engine embeds on its own)', async () => {
  const Supervisor = require('../sidecars/supervisor')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-noemb-'))
  const sup = new Supervisor({ paths: { qdrantData: path.join(dir, 'q'), bin: path.join(dir, 'bin'), models: dir, userData: dir }, license: null, modelPath: null })
  const waited = []
  sup._startQdrant = async () => {}
  sup._startLLM = async () => {}
  sup._wait = async (url) => { waited.push(url) }
  const stages = []
  await sup.start((e) => stages.push(`${e.stage}:${e.state}`))
  assert.ok(stages.includes('embeddings:absent'), stages.join(' '))
  assert.ok(!waited.some((u) => u.includes(':11435')), 'does not wait for the embeddings port')
  fs.rmSync(dir, { recursive: true, force: true })
})
