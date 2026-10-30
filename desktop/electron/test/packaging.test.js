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

// ── the ONNX runtime (name finder): in the desktop app, for its platform only ──

/** A minimal npm tarball: gzip'd ustar with package/<file> entries. */
function fakeTgz(files) {
  const zlib = require('zlib')
  const blocks = []
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content)
    const h = Buffer.alloc(512)
    h.write(`package/${name}`, 0, 100, 'utf8')
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write('        ', 148); h.write('0', 156); h.write('ustar\0' + '00', 257)
    let sum = 0; for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(blocks))
}

function fakeOnnxPackages() {
  const bins = {}
  for (const p of ['darwin/arm64', 'linux/x64', 'linux/arm64', 'win32/x64', 'win32/arm64']) bins[`bin/napi-v6/${p}/onnxruntime_binding.node`] = `binding ${p}`
  bins['bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib'] = 'dylib'
  bins['bin/napi-v6/darwin/arm64/libonnxruntime.1.30.0.dylib'] = 'dylib'
  bins['bin/napi-v6/linux/x64/libonnxruntime.so.1'] = 'so'
  for (const f of ['onnxruntime.dll', 'DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) bins[`bin/napi-v6/win32/x64/${f}`] = f
  return {
    'onnxruntime-node': fakeTgz({ 'package.json': '{"name":"onnxruntime-node"}', 'dist/index.js': '', 'script/install.js': '', ...bins }),
    'onnxruntime-common': fakeTgz({ 'package.json': '{"name":"onnxruntime-common"}', 'dist/cjs/index.js': '' }),
    '@huggingface/tokenizers': fakeTgz({ 'package.json': '{"name":"@huggingface/tokenizers"}', 'dist/tokenizers.cjs': '', 'types/index.d.ts': '' }),
  }
}

function fakeLock(dir, tgz, { tamper = null } = {}) {
  const crypto = require('crypto')
  const packages = {}
  for (const [name, buf] of Object.entries(tgz)) packages[`node_modules/${name}`] = { version: '1.30.0', resolved: `https://registry.example/${name}.tgz`, integrity: `sha512-${crypto.createHash('sha512').update(name === tamper ? Buffer.from('other') : buf).digest('base64')}` }
  const f = path.join(dir, 'package-lock.json')
  fs.writeFileSync(f, JSON.stringify({ packages }))
  return f
}

const listFiles = (dir) => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.relative(dir, path.join(d, e.name)).split(path.sep).join('/')) }; if (fs.existsSync(dir)) walk(dir); return out.sort() }

test('ONNX runtime staging: this platform\'s binary only, no DirectML, lockfile-verified; Intel Mac gets a note', async () => {
  const { stageOnnx } = require('../scripts/stage-onnx')
  const tgz = fakeOnnxPackages()
  const fetchTgz = async (name) => tgz[name]
  const run = async (target, opts = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-onnx-stage-'))
    const engineDir = path.join(dir, 'engine')
    fs.mkdirSync(path.join(engineDir, 'node_modules'), { recursive: true })
    const vcrtDir = path.join(dir, 'sys32')
    fs.mkdirSync(vcrtDir)
    for (const f of require('../scripts/stage-onnx').WIN_VCRT) fs.writeFileSync(path.join(vcrtDir, f), f)
    const r = await stageOnnx({ engineDir, lockFile: fakeLock(dir, tgz, opts), target, fetchTgz, vcrtDir, log: () => {} })
    return { r, engineDir, files: listFiles(path.join(engineDir, 'node_modules')) }
  }
  const mac = await run({ os: 'darwin', arch: 'arm64' })
  assert.deepStrictEqual(mac.files.filter((f) => f.includes('napi-v6')), ['onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib', 'onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node'])
  assert.ok(mac.files.includes('onnxruntime-common/dist/cjs/index.js') && mac.files.includes('@huggingface/tokenizers/dist/tokenizers.cjs'))
  assert.ok(!mac.files.some((f) => f.includes('script/install') || f.startsWith('@huggingface/tokenizers/types')), 'no install script, no type files')

  const win = await run({ os: 'win32', arch: 'x64' })
  const winBin = win.files.filter((f) => f.includes('napi-v6')).map((f) => path.basename(f))
  assert.ok(winBin.includes('onnxruntime.dll') && winBin.includes('onnxruntime_binding.node') && winBin.includes('vcruntime140.dll'), winBin.join(' '))
  for (const f of ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) assert.ok(!winBin.includes(f), `${f} left out`)
  assert.ok(!win.files.some((f) => f.includes('win32/arm64') || f.includes('linux/')))

  const linux = await run({ os: 'linux', arch: 'x64' })
  assert.deepStrictEqual(linux.files.filter((f) => f.includes('napi-v6')).map((f) => path.basename(f)), ['libonnxruntime.so.1', 'onnxruntime_binding.node'])

  // Intel Mac: the runtime has no build for it — nothing bundled, a note the engine reads.
  const intel = await run({ os: 'darwin', arch: 'x64' })
  assert.deepStrictEqual(intel.files, [])
  assert.match(JSON.parse(fs.readFileSync(path.join(intel.engineDir, 'onnx-runtime.json'), 'utf8')).unsupported, /Intel Macs/)

  // A tarball that does not match the lockfile is refused.
  await assert.rejects(run({ os: 'linux', arch: 'x64' }, { tamper: 'onnxruntime-node' }), /does not match the lockfile/)
})

test('the engine reads the Intel Mac note: "cannot run on this computer", not "needs the desktop app"', () => {
  const src = fs.readFileSync(path.join(ROOT, '..', '..', 'sidecar', 'src', 'onnx_runtime.js'), 'utf8')
  assert.match(src, /onnx-runtime\.json/)
  // The packaged-app smoke test checks the runtime binary is there (or the note) and runs a one-node model.
  const smoke = read('scripts/smoke-packaged.js')
  assert.match(smoke, /onnxruntime_binding\.node/)
  assert.match(smoke, /smokeOnnx/)
  assert.match(read('scripts/prepare-resources.js'), /stage-onnx/)
})

test('the CLI tarball has no ONNX runtime; its check says so', () => {
  const sh = fs.readFileSync(path.join(ROOT, '..', '..', 'scripts', 'package-cli.sh'), 'utf8')
  assert.match(sh, /npm ci --omit=dev --omit=optional/)
  const chk = fs.readFileSync(path.join(ROOT, '..', '..', 'scripts', 'check-cli-tarball.sh'), 'utf8')
  assert.match(chk, /onnxruntime-node onnxruntime-common onnxruntime-web @huggingface\/tokenizers/)
  assert.match(chk, /"reason":"not-bundled"/)
  const lock = require('../../../sidecar/package-lock.json')
  for (const n of ['onnxruntime-node', '@huggingface/tokenizers']) assert.strictEqual(lock.packages[`node_modules/${n}`].optional, true, `${n} is optional (left out of the CLI tarball)`)
  assert.ok(!lock.packages['node_modules/@huggingface/transformers'], 'no transformers (it pulled sharp and a second onnxruntime-node)')
})
