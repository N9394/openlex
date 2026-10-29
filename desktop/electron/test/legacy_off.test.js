/**
 * The app starts without the old desktop server (desktop/server): its
 * features moved into the chat on the engine, so the supervisor no longer
 * spawns it, the window gets no ?backend= address, and no page of the
 * client calls it. OPENLEX_LEGACY_SERVER=1 switches it back on.
 *
 *   node --test desktop/electron/test/legacy_off.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const legacy = require('../main/legacy')
const Supervisor = require('../sidecars/supervisor')
const ROOT = path.join(__dirname, '..', '..')

test('off by default; OPENLEX_LEGACY_SERVER=1 switches it on', () => {
  assert.strictEqual(legacy.legacyServerWanted({}), false)
  assert.strictEqual(legacy.legacyServerWanted({ OPENLEX_LEGACY_SERVER: '0' }), false)
  for (const v of ['1', 'true', 'on', 'YES']) assert.strictEqual(legacy.legacyServerWanted({ OPENLEX_LEGACY_SERVER: v }), true, v)
  assert.strictEqual(legacy.windowSearch(null), '')
  assert.strictEqual(legacy.windowSearch('http://127.0.0.1:18000'), 'backend=http%3A%2F%2F127.0.0.1%3A18000')
})

function fakeSupervisor(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-boot-'))
  const sup = new Supervisor({ paths: { qdrantData: path.join(dir, 'qdrant') }, license: null, modelPath: null, ...opts })
  const calls = []
  sup._startQdrant = async () => calls.push('qdrant')
  sup._startEmbeddings = async () => calls.push('embeddings')
  sup._startLLM = async () => calls.push('llm')
  sup._startBackend = async () => calls.push('backend')
  sup._wait = async (url) => calls.push(`wait ${url}`)
  return { sup, calls, dir }
}

test('the app starts without the old desktop server: nothing spawned, nothing waited for on its port', async () => {
  const { sup, calls, dir } = fakeSupervisor({})
  const stages = []
  await sup.start((e) => stages.push(`${e.stage}:${e.state}`))
  assert.strictEqual(sup.backendUrl, null)
  assert.deepStrictEqual(calls.filter((c) => !c.startsWith('wait')), ['qdrant', 'embeddings', 'llm'])
  assert.ok(!calls.some((c) => c.includes(':18000')), calls.join(' | '))
  assert.ok(!stages.some((s) => s.startsWith('backend')), stages.join(' | '))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('switched on, it is started as before', async () => {
  const { sup, calls, dir } = fakeSupervisor({ legacyBackend: true })
  await sup.start()
  assert.strictEqual(sup.backendUrl, 'http://127.0.0.1:18000')
  assert.ok(calls.includes('backend') && calls.includes('wait http://127.0.0.1:18000/health'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('main.js asks main/legacy.js, loads the window without ?backend= when off, reopens it without the server', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8')
  assert.match(main, /legacyBackend: require\('\.\/legacy'\)\.legacyServerWanted\(\)/)
  assert.ok(!/search: 'backend=' \+/.test(main), 'no unconditional ?backend=')
  assert.ok(!/getAllWindows\(\)\.length === 0 && backendUrl\)/.test(main), 'macOS activate does not need the server')
})

test('no page of the app calls the old server: its pages are not routed, the sidebar and search go to the engine', () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, 'client', 'src', f), 'utf8')
  const app = src('App.tsx')
  for (const old of ['Upload', 'Vault', 'Workshop', 'Audit', 'DocumentView', 'Investigate', 'MaDashboard', 'MaDealSetup', 'MaDeal', 'Navigator']) {
    assert.ok(!new RegExp(`import ${old} from`).test(app), `App.tsx does not import pages/${old}`)
  }
  for (const f of ['components/Layout.tsx', 'components/CommandPalette.tsx', 'pages/Dashboard.tsx', 'pages/Saved.tsx', 'pages/Record.tsx', 'pages/Research.tsx', 'components/ChatCommands.tsx']) {
    assert.ok(!/from '\.\.\/lib\/api'/.test(src(f)), `${f} does not use the old server's client`)
  }
  const layout = src('components/Layout.tsx')
  for (const p of ["'/upload'", "'/investigate'", "'/workshop'", "'/ma'"]) assert.ok(!layout.includes(p), `sidebar has no ${p}`)
  // Settings: in the app, no account or document calls before the old server is asked.
  const settings = src('pages/Settings.tsx')
  assert.match(settings, /if \(isElectron\) return fetchLocal\(\)/)
})
