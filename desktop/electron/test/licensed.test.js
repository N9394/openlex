/**
 * Licensed (distribution) mode behaves like the community App for the AI
 * setup, finds distribution.json in the settings folder, and updates macOS
 * from a zip. No Electron needed.
 *
 *   node --test desktop/electron/test/licensed.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `openlex-${p}-`))

const { settleLocalModel, localModelSuggestion, downloadSuggestedModel, findLocalModel } = require('../main/model-setup')
const { fetchModel } = require('../main/model-fetcher')
const { loadDistribution, distributionCandidates, serverOf, readToken } = require('../main/distribution')
const Updater = require('../main/updater')
const { writeUpdateInfo } = require('../scripts/update-info')

const HW = { tier: 'apple', model: 'tier-model-q4', model_filename: 'tier-model.gguf', model_size_bytes: 10, model_sha256: null }

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler)
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }))
  })
}

// ── 1 no forced download, no quit ──────────────────────────────────────────

test('licensed boot: no model download at start, no quit when there is no model', () => {
  const dir = tmp('models')
  const r = settleLocalModel({ modelDir: path.join(dir, 'llm'), hw: HW })
  assert.strictEqual(r.modelPath, null)
  assert.deepStrictEqual(r.state, { state: 'none' })

  const main = read('main/main.js')
  const boot = main.slice(main.indexOf('async function boot()'), main.indexOf('new Supervisor('))
  assert.ok(boot.length > 1000, 'boot section found')
  assert.ok(!/fetchModel\(/.test(boot), 'boot does not download a model')
  assert.ok(!/app\.quit\(\)/.test(boot), 'boot does not quit before the services start')
  assert.ok(!/model setup failed/i.test(main), 'no "model setup failed" dialog')
  assert.match(boot, /settleLocalModel\(/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('licensed: the supervisor starts without a local model (setup page offers one)', async () => {
  const Supervisor = require('../sidecars/supervisor')
  const root = tmp('lic-sup')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  fs.writeFileSync(path.join(bin, `llama-server-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`), '')
  const paths = { root, bin, models: path.join(root, 'models'), hardware: path.join(root, 'hardware.json'), license: path.join(root, 'license.json'), userData: root }
  const s = new Supervisor({ paths, license: { account_id: 'a1', tier: 'solo', entitlements: [] }, modelPath: null })
  s._spawnLLMProxy = () => {}
  s._startLLM()
  clearInterval(s._llmIdleTimer)
  await assert.rejects(s._ensureLLMRunning(), /No local model installed/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('the recommended model is offered only with a licence, a token, a server and "localModel"', () => {
  const modelDir = tmp('sug')
  const base = { distribution: { localModel: true }, licensed: true, token: 'lv_live_x', server: 'https://downloads.example.com', hw: HW, modelDir }
  assert.strictEqual(localModelSuggestion({ ...base, licensed: false }), null)
  assert.strictEqual(localModelSuggestion({ ...base, token: null }), null)
  assert.strictEqual(localModelSuggestion({ ...base, server: null }), null)
  assert.strictEqual(localModelSuggestion({ ...base, distribution: {} }), null)
  const s = localModelSuggestion(base)
  assert.strictEqual(s.variant, 'tier-model-q4')
  assert.strictEqual(s.filename, 'tier-model.gguf')
  assert.strictEqual(s.installed, false)
  const own = localModelSuggestion({ ...base, distribution: { localModel: { variant: 'v1', filename: 'Firm-7B.gguf', sizeBytes: 5, title: 'Firm 7B' } } })
  assert.strictEqual(own.title, 'Firm 7B')
  // unsafe names are refused
  assert.strictEqual(localModelSuggestion({ ...base, distribution: { localModel: { variant: 'v1', filename: '../x.gguf' } } }), null)
  assert.strictEqual(localModelSuggestion({ ...base, distribution: { localModel: { variant: '../v', filename: 'x.gguf' } } }), null)
  fs.rmSync(modelDir, { recursive: true, force: true })
})

test('a failed download of the recommended model returns an error, never throws', async () => {
  const srv = await server((req, res) => { res.writeHead(503); res.end('busy') })
  const modelDir = tmp('dl-fail')
  const suggestion = { variant: 'tier-model-q4', filename: 'tier-model.gguf', sizeBytes: 10, sha256: null }
  const r = await downloadSuggestedModel({ suggestion, server: srv.url, token: 't', modelDir, fetchModel })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /HTTP 503/)
  const r2 = await downloadSuggestedModel({ suggestion, server: srv.url, token: 't', modelDir, fetchModel: async () => { throw new Error('offline') } })
  assert.deepStrictEqual(r2, { ok: false, error: 'offline' })
  assert.deepStrictEqual(await downloadSuggestedModel({ suggestion: null }), { ok: false, error: 'This build recommends no model to download.' })
  await srv.close()
  fs.rmSync(modelDir, { recursive: true, force: true })
})

test('the recommended model downloads on request, with progress, verified', async () => {
  const body = Buffer.from('GGUF-test-model-bytes')
  const sha = crypto.createHash('sha256').update(body).digest('hex')
  let auth = null
  const srv = await server((req, res) => {
    auth = req.headers.authorization
    if (req.url !== '/api/app/model/tier-model-q4') { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Length': body.length }); res.end(body)
  })
  const modelDir = tmp('dl-ok')
  const seen = []
  const r = await downloadSuggestedModel({
    suggestion: { variant: 'tier-model-q4', filename: 'tier-model.gguf', sizeBytes: body.length, sha256: sha },
    server: srv.url, token: 'lv_live_abc', modelDir, fetchModel, onProgress: (p) => seen.push(p),
  })
  assert.strictEqual(r.ok, true, r.error)
  assert.strictEqual(r.file, 'tier-model.gguf')
  assert.strictEqual(auth, 'Bearer lv_live_abc')
  assert.ok(seen.length >= 1 && seen.at(-1).downloaded === body.length)
  assert.deepStrictEqual(fs.readFileSync(path.join(modelDir, 'tier-model.gguf')), body)
  await srv.close()
  fs.rmSync(modelDir, { recursive: true, force: true })
})

// ── 2 user model files are never deleted ──────────────────────────────────

test('start keeps every GGUF the lawyer has; another tier\'s model is used, not removed', () => {
  const modelDir = path.join(tmp('keep'), 'llm')
  fs.mkdirSync(modelDir, { recursive: true })
  for (const f of ['my-own-model.gguf', 'old-tier-model.gguf', 'half.gguf.part']) fs.writeFileSync(path.join(modelDir, f), 'x')
  const r = settleLocalModel({ modelDir, hw: HW })
  assert.strictEqual(path.basename(r.modelPath), 'my-own-model.gguf')
  assert.deepStrictEqual(fs.readdirSync(modelDir).sort(), ['half.gguf.part', 'my-own-model.gguf', 'old-tier-model.gguf'])
  // the tier's model wins when it is there
  fs.writeFileSync(path.join(modelDir, 'tier-model.gguf'), 'x')
  assert.strictEqual(path.basename(findLocalModel(modelDir, HW.model_filename)), 'tier-model.gguf')

  const main = read('main/main.js')
  assert.ok(!/orphan/i.test(main), 'no orphan-model clean-up in main.js')
  for (const m of main.matchAll(/unlinkSync\(([^)]*)\)/g)) assert.ok(!/model/i.test(m[1]), `main.js deletes no model file: ${m[0]}`)
  fs.rmSync(path.dirname(modelDir), { recursive: true, force: true })
})

test('a failed download leaves an existing file of the same name alone', async () => {
  const srv = await server((req, res) => { res.writeHead(500); res.end() })
  const modelDir = tmp('keep-same')
  fs.writeFileSync(path.join(modelDir, 'tier-model.gguf'), 'the lawyer\'s own bytes')
  const r = await downloadSuggestedModel({ suggestion: { variant: 'tier-model-q4', filename: 'tier-model.gguf', sizeBytes: 999, sha256: null }, server: srv.url, token: 't', modelDir, fetchModel })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(fs.readFileSync(path.join(modelDir, 'tier-model.gguf'), 'utf8'), 'the lawyer\'s own bytes')
  await srv.close()
  fs.rmSync(modelDir, { recursive: true, force: true })
})

// ── 3 distribution.json lookup ─────────────────────────────────────────────

test('distribution.json: $OPENLEX_DISTRIBUTION, then <userData>, then the installer, else community', () => {
  const root = tmp('dist')
  const userData = path.join(root, 'LexVault'); fs.mkdirSync(userData)
  const resources = path.join(root, 'resources'); fs.mkdirSync(resources)
  const envFile = path.join(root, 'env.json')
  const write = (f, name) => fs.writeFileSync(f, JSON.stringify({ name, server: `https://${name}.example.com/` }))
  const quiet = { log: () => {} }

  assert.deepStrictEqual(loadDistribution({ env: {}, userData, resourcesPath: resources, ...quiet }), { config: {}, file: null, from: null })

  write(path.join(resources, 'distribution.json'), 'bundled')
  assert.strictEqual(loadDistribution({ env: {}, userData, resourcesPath: resources, ...quiet }).config.name, 'bundled')

  write(path.join(userData, 'distribution.json'), 'dropped')
  const u = loadDistribution({ env: {}, userData, resourcesPath: resources, ...quiet })
  assert.strictEqual(u.config.name, 'dropped')
  assert.strictEqual(u.from, 'userData')

  write(envFile, 'fromenv')
  const e = loadDistribution({ env: { OPENLEX_DISTRIBUTION: envFile }, userData, resourcesPath: resources, ...quiet })
  assert.strictEqual(e.config.name, 'fromenv')
  assert.strictEqual(e.from, 'env')
  assert.strictEqual(serverOf(e.config, {}), 'https://fromenv.example.com')
  assert.strictEqual(serverOf(e.config, { LEXVAULT_LICENSE_SERVER: 'http://127.0.0.1:9/' }), 'http://127.0.0.1:9')

  // an unreadable env path or broken JSON falls through to the next place
  const logs = []
  const missing = loadDistribution({ env: { OPENLEX_DISTRIBUTION: path.join(root, 'nope.json') }, userData, resourcesPath: resources, log: (m) => logs.push(m) })
  assert.strictEqual(missing.config.name, 'dropped')
  assert.match(logs.join('\n'), /not readable/)
  fs.writeFileSync(path.join(userData, 'distribution.json'), '{ broken')
  assert.strictEqual(loadDistribution({ env: {}, userData, resourcesPath: resources, ...quiet }).config.name, 'bundled')

  assert.deepStrictEqual(distributionCandidates({ env: { OPENLEX_DISTRIBUTION: envFile }, userData, resourcesPath: resources }).map((c) => c.from), ['env', 'userData', 'resources'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('the licence token is read from <userData>/token.txt; main.js uses the shared lookup', () => {
  const userData = tmp('tok')
  assert.strictEqual(readToken(userData), null)
  fs.writeFileSync(path.join(userData, 'token.txt'), '  lv_live_abc\n')
  assert.strictEqual(readToken(userData), 'lv_live_abc')
  const main = read('main/main.js')
  assert.match(main, /loadDistribution\(\{\s*userData: app\.getPath\('userData'\)/)
  assert.ok(!/process\.env\.OPENLEX_DISTRIBUTION, path\.join\(process\.resourcesPath/.test(main), 'old env/resources-only lookup is gone')
  fs.rmSync(userData, { recursive: true, force: true })
})

// ── 4 macOS updates install from the zip ───────────────────────────────────

test('release config builds mac zips; update metadata lists them; the updater picks the zip', async () => {
  const pkg = require('../package.json')
  assert.ok(pkg.build.mac.target.includes('zip') && pkg.build.mac.target.includes('dmg'))
  assert.match(pkg.build.mac.artifactName, /^OpenLex-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}$/)

  const dir = tmp('meta')
  const v = '9.8.7'
  for (const f of [`OpenLex-${v}-mac-arm64.zip`, `OpenLex-${v}-mac-x64.zip`, `OpenLex-${v}-mac-arm64.dmg`, `OpenLex-${v}-windows-x64-setup.exe`, `OpenLex-${v}-linux-x64.AppImage`]) fs.writeFileSync(path.join(dir, f), f)
  const written = await writeUpdateInfo(dir, v, { releaseDate: '2026-10-30T00:00:00.000Z' })
  assert.deepStrictEqual(written.map((w) => w.name).sort(), ['latest-linux.yml', 'latest-mac.yml', 'latest.yml'])

  const mac = Updater.parseYml(fs.readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8'))
  assert.strictEqual(mac.version, v)
  assert.strictEqual(mac.files.length, 2)
  const arm = Updater.pickArtifact(mac, 'darwin', 'arm64')
  const x64 = Updater.pickArtifact(mac, 'darwin', 'x64')
  assert.strictEqual(arm.url, `OpenLex-${v}-mac-arm64.zip`)
  assert.strictEqual(x64.url, `OpenLex-${v}-mac-x64.zip`)
  const want = crypto.createHash('sha512').update(`OpenLex-${v}-mac-x64.zip`).digest('base64')
  assert.strictEqual(x64.sha512, want)

  // never the dmg, never the other architecture
  assert.strictEqual(Updater.pickArtifact({ version: v, files: [{ url: `OpenLex-${v}-mac-arm64.dmg`, sha512: 'x' }] }, 'darwin', 'arm64'), null)
  assert.strictEqual(Updater.pickArtifact({ version: v, files: [{ url: `OpenLex-${v}-mac-arm64.zip`, sha512: 'x' }] }, 'darwin', 'x64'), null)
  assert.strictEqual(Updater.pickArtifact({ version: v, path: `OpenLex-${v}-mac-arm64.dmg`, sha512: 'x' }, 'darwin', 'arm64'), null)

  const win = Updater.parseYml(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'))
  assert.strictEqual(Updater.pickArtifact(win, 'win32', 'x64').url, `OpenLex-${v}-windows-x64-setup.exe`)
  const lin = Updater.parseYml(fs.readFileSync(path.join(dir, 'latest-linux.yml'), 'utf8'))
  assert.strictEqual(Updater.pickArtifact(lin, 'linux', 'x64').url, `OpenLex-${v}-linux-x64.AppImage`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('update artifact names cannot leave the updates folder', () => {
  const feed = 'https://downloads.example.com/api/app/update'
  assert.deepStrictEqual(Updater.artifactLocation(feed, 'OpenLex-1.0.0-mac-arm64.zip'), { name: 'OpenLex-1.0.0-mac-arm64.zip', href: `${feed}/OpenLex-1.0.0-mac-arm64.zip` })
  assert.strictEqual(Updater.artifactLocation(feed, '../../evil.zip'), null)
  assert.strictEqual(Updater.artifactLocation(feed, '/etc/evil.zip'), null)
  assert.strictEqual(Updater.artifactLocation(feed, 'http://insecure.example.com/OpenLex.zip'), null)
  assert.strictEqual(Updater.artifactLocation(feed, 'OpenLex.sh'), null)
  assert.strictEqual(Updater.artifactLocation(feed, 'https://cdn.example.com/x/OpenLex-1.0.0-mac-x64.zip').name, 'OpenLex-1.0.0-mac-x64.zip')
})

test('macOS: when the App cannot replace itself, it says why instead of trying', () => {
  const ok = () => {}
  const denied = () => { throw new Error('EACCES') }
  assert.strictEqual(Updater.macAppBundle('/Applications/OpenLex.app/Contents/MacOS/OpenLex'), '/Applications/OpenLex.app')
  assert.strictEqual(Updater.macInstallBlocker('/Applications/OpenLex.app', ok), null)
  assert.match(Updater.macInstallBlocker('/Applications/OpenLex.app', denied), /cannot write/)
  assert.match(Updater.macInstallBlocker('/private/var/folders/x/AppTranslocation/ABC/d/OpenLex.app', ok), /temporary copy/)
  assert.match(Updater.macInstallBlocker('/Volumes/OpenLex 1.0/OpenLex.app', ok), /disk image/)
})

// The real install script on a real (ad-hoc signed) bundle: macOS only.
const onMac = process.platform === 'darwin' && fs.existsSync('/usr/bin/codesign') && fs.existsSync('/usr/bin/ditto')

function fakeApp(dir, version, id = 'com.lexvault.app') {
  const app = path.join(dir, 'OpenLex.app')
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>OpenLex</string>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`)
  fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents', 'MacOS', 'OpenLex'))
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', `only-in-${version}.txt`), version)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
  return app
}

function runScript({ installed, zip, root }) {
  const work = fs.mkdtempSync(path.join(root, 'work-'))
  const result = path.join(root, 'updates', 'last-update.json')
  const script = path.join(work, 'apply-update.sh')
  // a pid that has already exited
  const gone = spawnSync('/usr/bin/true').pid
  fs.writeFileSync(script, Updater.macUpdateScript({ zipPath: zip, appBundle: installed, pid: gone, resultFile: result, workDir: work, relaunch: false, waitSeconds: 5 }), { mode: 0o755 })
  const r = spawnSync('/bin/bash', [script], { encoding: 'utf8', timeout: 60_000 })
  return { status: r.status, out: r.stdout + r.stderr, result: JSON.parse(fs.readFileSync(result, 'utf8')), workGone: !fs.existsSync(work) }
}

const version = (app) => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()

test('macOS: the update script swaps in the new ad-hoc signed app from the zip', { skip: !onMac && 'macOS only' }, () => {
  const root = tmp('macupd')
  const apps = path.join(root, 'Applications'); fs.mkdirSync(apps)
  const installed = fakeApp(apps, '1.0.0')
  const build = path.join(root, 'build'); fs.mkdirSync(build)
  const fresh = fakeApp(build, '1.0.1')
  const zip = path.join(root, 'OpenLex-1.0.1-mac-arm64.zip')
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', fresh, zip])

  const r = runScript({ installed, zip, root })
  assert.strictEqual(r.status, 0, r.out)
  assert.strictEqual(r.result.ok, true)
  assert.strictEqual(version(installed), '1.0.1')
  assert.ok(!fs.existsSync(path.join(installed, 'Contents', 'Resources', 'only-in-1.0.0.txt')), 'no files of the old version left in the bundle')
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed])
  assert.deepStrictEqual(fs.readdirSync(apps), ['OpenLex.app'], 'no staging folder left behind')
  assert.ok(r.workGone)
  fs.rmSync(root, { recursive: true, force: true })
})

test('macOS: a damaged or foreign update is refused and the installed app stays', { skip: !onMac && 'macOS only' }, () => {
  const root = tmp('macbad')
  const apps = path.join(root, 'Applications'); fs.mkdirSync(apps)
  const installed = fakeApp(apps, '1.0.0')

  // damaged: changed after signing
  const b1 = path.join(root, 'b1'); fs.mkdirSync(b1)
  const tampered = fakeApp(b1, '1.0.1')
  fs.appendFileSync(path.join(tampered, 'Contents', 'MacOS', 'OpenLex'), 'x')
  const z1 = path.join(root, 'bad.zip')
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', tampered, z1])
  const r1 = runScript({ installed, zip: z1, root })
  assert.notStrictEqual(r1.status, 0)
  assert.strictEqual(r1.result.ok, false)
  assert.match(r1.result.reason, /signature/)
  assert.strictEqual(version(installed), '1.0.0')

  // foreign: another bundle id
  const b2 = path.join(root, 'b2'); fs.mkdirSync(b2)
  const other = fakeApp(b2, '2.0.0', 'com.example.other')
  const z2 = path.join(root, 'other.zip')
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', other, z2])
  const r2 = runScript({ installed, zip: z2, root })
  assert.strictEqual(r2.result.ok, false)
  assert.match(r2.result.reason, /different app/)
  assert.strictEqual(version(installed), '1.0.0')
  assert.deepStrictEqual(fs.readdirSync(apps), ['OpenLex.app'])
  fs.rmSync(root, { recursive: true, force: true })
})
