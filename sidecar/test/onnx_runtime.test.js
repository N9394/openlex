"use strict"
/**
 * The engine's ONNX runtime (onnx_runtime.js) and what the name finder
 * (pii_ner.js) and the redaction check say about it: "available" (the
 * runtime loads here) separately from "installed" (the model files are on
 * disk), and "basic detection" unless the model really ran for the text.
 *
 *   node --test test/onnx_runtime.test.js
 *
 * Offline: the runtime is faked through setLoader(); the model files are
 * sparse placeholders of the right size (never read, nothing downloaded).
 * Where the real onnxruntime-node is installed (a dev checkout, the desktop
 * app) a one-node model runs through it.
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-onnx-'))
process.env.LEXVAULT_DATA_DIR = DATA

const runtime = require('../src/onnx_runtime')
const ner = require('../src/pii_ner')
const check = require('../src/redaction_check')

const missing = (name) => Object.assign(new Error(`Cannot find module '${name}'\nRequire stack:\n- /x/onnxruntime-node/dist/index.js`), { code: 'MODULE_NOT_FOUND' })
const realRequire = (name) => require(name)
function fakeOrt({ createFails = false } = {}) {
  return {
    Tensor: function Tensor() {},
    InferenceSession: { create: async () => { if (createFails) throw new Error('cannot open model: bad file'); return { run: async () => { throw new Error('not used') } } } },
  }
}
const fakeTokenizers = { Tokenizer: function Tokenizer() { this.encode = () => ({ ids: [] }) } }
const loaderWith = (ort) => (name) => {
  if (name === 'onnxruntime-node') { if (ort instanceof Error) throw ort; return ort }
  if (name === '@huggingface/tokenizers') return fakeTokenizers
  throw missing(name)
}
const modelDir = path.join(DATA, 'models', ner.MODEL.id)
function placeModel() {
  fs.mkdirSync(modelDir, { recursive: true })
  for (const f of ner.MODEL.files) {
    const p = path.join(modelDir, f.to || f.name)
    fs.closeSync(fs.openSync(p, 'w'))
    fs.truncateSync(p, f.bytes) // sparse: the right size, no real bytes
  }
}

test.after(() => { runtime.setLoader(null); ner.setRunner(null); fs.rmSync(DATA, { recursive: true, force: true }) })

test('available vs installed: all four combinations', () => {
  const cases = [
    { ort: missing('onnxruntime-node'), files: false, available: false, installed: false, reason: 'not-bundled' },
    { ort: missing('onnxruntime-node'), files: true, available: false, installed: true, reason: 'not-bundled' },
    { ort: fakeOrt(), files: false, available: true, installed: false, reason: null },
    { ort: fakeOrt(), files: true, available: true, installed: true, reason: null },
  ]
  for (const c of cases) {
    fs.rmSync(modelDir, { recursive: true, force: true })
    if (c.files) placeModel()
    runtime.setLoader(loaderWith(c.ort))
    const st = ner.status()
    assert.strictEqual(st.available, c.available, JSON.stringify(c))
    assert.strictEqual(st.installed, c.installed, JSON.stringify(c))
    assert.strictEqual(st.runtime.reason, c.reason)
  }
  fs.rmSync(modelDir, { recursive: true, force: true })
})

test('the runtime is tried once and cached; "not bundled" vs "cannot load here"', () => {
  let calls = 0
  runtime.setLoader((name) => { calls++; return loaderWith(fakeOrt())(name) })
  for (let i = 0; i < 5; i++) assert.strictEqual(runtime.available(), true)
  assert.strictEqual(calls, 2, 'one require each for the runtime and the tokenizer')
  assert.strictEqual(runtime.ort().InferenceSession.create.constructor.name, 'AsyncFunction')

  runtime.setLoader(loaderWith(missing('onnxruntime-node')))
  assert.deepStrictEqual(runtime.info(), { available: false, reason: 'not-bundled', error: "Cannot find module 'onnxruntime-node'" })
  assert.throws(() => runtime.ort(), (e) => e.code === 'ONNX_UNAVAILABLE' && /desktop app/.test(e.message))

  // The package is there, its native binary is not (another platform's build) or does not load.
  const noBinary = Object.assign(new Error("Cannot find module '../bin/napi-v6/darwin/x64/onnxruntime_binding.node'\nRequire stack:\n- /x/node_modules/onnxruntime-node/dist/binding.js"), { code: 'MODULE_NOT_FOUND' })
  runtime.setLoader(loaderWith(noBinary))
  assert.strictEqual(runtime.info().reason, 'load-failed')
  runtime.setLoader(loaderWith(new Error('dlopen failed: libonnxruntime.so.1: cannot open shared object file')))
  assert.strictEqual(runtime.info().reason, 'load-failed')
  assert.match(runtime.info().error, /dlopen failed/)
  assert.throws(() => runtime.ort(), /cannot load on this computer/)
})

test('a desktop build without a runtime for its platform (Intel Mac): "cannot run here", with the reason', () => {
  const note = path.join(__dirname, '..', 'onnx-runtime.json')
  assert.ok(!fs.existsSync(note), 'no note in a source checkout')
  fs.writeFileSync(note, JSON.stringify({ bundled: false, unsupported: 'The ONNX runtime is not available for Intel Macs.' }))
  try {
    runtime.setLoader(loaderWith(missing('onnxruntime-node')))
    assert.deepStrictEqual(runtime.info(), { available: false, reason: 'load-failed', error: 'The ONNX runtime is not available for Intel Macs.' })
    assert.strictEqual(ner.status().available, false)
  } finally { fs.rmSync(note, { force: true }); runtime.setLoader(null) }
})

test('no runtime: the download is refused, nothing is fetched', async () => {
  runtime.setLoader(loaderWith(missing('onnxruntime-node')))
  const realFetch = global.fetch
  let fetched = 0
  global.fetch = async () => { fetched++; throw new Error('no network in tests') }
  try {
    await assert.rejects(ner.install(), (e) => e.code === 'ONNX_UNAVAILABLE' && /needs the desktop app/.test(e.message))
    assert.strictEqual(fetched, 0)
    assert.strictEqual(fs.existsSync(modelDir), false)
  } finally { global.fetch = realFetch }
})

test('installed but the model does not load: the check reports "basic", per run', async () => {
  placeModel()
  runtime.setLoader(loaderWith(fakeOrt({ createFails: true })))
  ner.setRunner(null)
  assert.deepStrictEqual([ner.status().available, ner.status().installed], [true, true])
  const text = 'Der Vertrag zwischen Johann Huber und Anna Berger.'
  const r = await check.prepare({ matterId: null, items: [{ name: 'Brief', text }] })
  const v = check.view(r)
  assert.strictEqual(v.basic, true)
  assert.strictEqual(v.detection, 'basic')
  assert.strictEqual(v.finder, 'failed')
  assert.deepStrictEqual(v.items.map((it) => it.detection), ['basic'])
  check.cancel(r.id)

  // No runtime at all (CLI tarball): basic, and the check says why.
  runtime.setLoader(loaderWith(missing('onnxruntime-node')))
  const r2 = await check.prepare({ matterId: null, items: [{ name: 'Brief', text }] })
  assert.deepStrictEqual([check.view(r2).basic, check.view(r2).finder, check.view(r2).runtime], [true, 'unavailable', 'not-bundled'])
  check.cancel(r2.id)

  // Runtime there, model not downloaded.
  fs.rmSync(modelDir, { recursive: true, force: true })
  runtime.setLoader(loaderWith(fakeOrt()))
  const r3 = await check.prepare({ matterId: null, items: [{ name: 'Brief', text }] })
  assert.deepStrictEqual([check.view(r3).basic, check.view(r3).finder], [true, 'not-installed'])
  check.cancel(r3.id)
})

test('the model ran for every text: "with name finder"; one text it did not reach: "basic"', async () => {
  const seen = []
  ner.setRunner(async (t) => { seen.push(t); if (t.includes('FAIL')) throw new Error('out of memory'); const i = t.indexOf('Anna Berger'); return i < 0 ? [] : [{ kind: 'PERSON', start: i, end: i + 11, confidence: 0.9 }] })
  const ok = await check.prepare({ matterId: null, items: [{ name: 'A', text: 'Anna Berger schreibt.' }, { name: 'B', text: 'Kein Name hier.' }] })
  const v = check.view(ok)
  assert.deepStrictEqual([v.basic, v.detection, v.finder], [false, 'with-model', 'used'])
  assert.deepStrictEqual(v.items.map((it) => it.detection), ['model', 'model'])
  assert.ok(v.entries.some((e) => e.text === 'Anna Berger' && e.sources.includes('model')))
  check.cancel(ok.id)

  const mixed = await check.prepare({ matterId: null, items: [{ name: 'A', text: 'Anna Berger schreibt.' }, { name: 'B', text: 'FAIL here' }] })
  const m = check.view(mixed)
  assert.deepStrictEqual([m.basic, m.finder], [true, 'failed'])
  assert.deepStrictEqual(m.items.map((it) => it.detection), ['model', 'basic'])
  check.cancel(mixed.id)
  ner.setRunner(null)
})

test('the AI record notes the detection both ways', () => {
  const policy = require('../src/policy')
  policy.audit({ call: 'redaction-check', matter: null, decision: 'checked', documents: 1, hidden: { PERSON: 1 }, changed: false, detection: 'with-model' })
  policy.audit({ call: 'redaction-check', matter: null, decision: 'checked', documents: 2, hidden: { IBAN: 1 }, changed: true, detection: 'basic' })
  policy.audit({ provider: 'openai', model: 'gpt-test', matter: null, call: 'chat', decision: 'allowed', ok: true, redacted: 2, hidden: { PERSON: 2 }, check: 'checked', detection: 'basic' })
  const lines = require('../src/record').list({ limit: 50 }).entries.flatMap((e) => e.lines || [])
  assert.ok(lines.some((l) => /names and numbers hidden \(pseudonymised\), checked by you \(basic detection\)/.test(l)), JSON.stringify(lines))
  assert.ok(lines.some((l) => /^Redaction check: 1 person hidden in 1 text — as suggested \(with name finder\)$/.test(l)), JSON.stringify(lines))
  assert.ok(lines.some((l) => /^Redaction check: .* in 2 texts — changed by you \(basic detection\)$/.test(l)), JSON.stringify(lines))
})

test('the real runtime, where it is installed: a one-node model runs; tokenizer ids as expected', async (t) => {
  runtime.setLoader(realRequire)
  if (!runtime.available()) { t.skip(`no ONNX runtime here (${runtime.info().reason})`); return }
  const r = await runtime.selfTest()
  assert.strictEqual(r.ok, true, r.error)
  assert.strictEqual(r.version, require('onnxruntime-node/package.json').version)
  // A minimal WordPiece tokenizer.json through the same path the models use.
  const dir = fs.mkdtempSync(path.join(DATA, 'tok-'))
  fs.writeFileSync(path.join(dir, 'tokenizer.json'), JSON.stringify({
    version: '1.0', truncation: null, padding: null, added_tokens: [], normalizer: null,
    pre_tokenizer: { type: 'Whitespace' }, post_processor: null, decoder: null,
    model: { type: 'WordLevel', vocab: { '[UNK]': 0, huber: 1, anna: 2 }, unk_token: '[UNK]' },
  }))
  const tok = runtime.tokenizer(dir)
  assert.deepStrictEqual(tok.encode('anna huber', { add_special_tokens: false }).ids, [2, 1])
})
