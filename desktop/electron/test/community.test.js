/**
 * Community mode (no license, no account): the supervisor runs without a
 * local model and says so clearly instead of failing boot.
 *
 *   node --test desktop/electron/test/community.test.js
 */
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const Supervisor = require('../sidecars/supervisor')

const binName = () => {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `llama-server-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
}

function fakePaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-community-'))
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, binName()), '')
  return { root, bin, models: path.join(root, 'models'), hardware: path.join(root, 'hardware.json'), license: path.join(root, 'license.json'), userData: root }
}

test('no local model: LLM proxy starts, local calls get a clear error', async () => {
  const paths = fakePaths()
  const s = new Supervisor({ paths, license: { community: true, tier: 'community', entitlements: [] }, modelPath: null })
  s._spawnLLMProxy = () => {} // no port binding in tests
  s._startLLM()
  clearInterval(s._llmIdleTimer)
  await assert.rejects(s._ensureLLMRunning(), /No local model installed.*API key/)
  fs.rmSync(paths.root, { recursive: true, force: true })
})

test('a configured model path that is missing still fails loudly', () => {
  const paths = fakePaths()
  const s = new Supervisor({ paths, license: {}, modelPath: path.join(paths.models, 'llm', 'gone.gguf') })
  s._spawnLLMProxy = () => {}
  assert.throws(() => s._startLLM(), /LLM model missing/)
  fs.rmSync(paths.root, { recursive: true, force: true })
})
