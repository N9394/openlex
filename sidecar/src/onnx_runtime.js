"use strict"
/**
 * The engine's one ONNX runtime: onnxruntime-node (native, CPU only) and a
 * tokenizer (@huggingface/tokenizers, pure JavaScript). Everything that runs
 * an ONNX model in this process goes through here — the name finder
 * (pii_ner.js) and the in-process BGE-M3 embedder (onnx_bge.js) — so there
 * is one copy of the runtime, loaded once.
 *
 * The desktop app bundles both (for its own platform only); the CLI tarball
 * and Homebrew leave them out to stay small and portable. So: ask first.
 *
 *   available()       can a model run here? (tries to load the runtime once, cached)
 *   info()            { available, reason: null|'not-bundled'|'load-failed', error }
 *   ort()             the onnxruntime-node module (throws when not available)
 *   tokenizer(dir)    a tokenizer from <dir>/tokenizer.json (+ tokenizer_config.json)
 *   selfTest()        run a one-node model: does the native binary work here?
 *   setLoader(fn)     tests: replace require (fn(name) → module, or throw)
 */

const fs = require('fs')
const path = require('path')

const RUNTIME = 'onnxruntime-node'
const TOKENIZERS = '@huggingface/tokenizers'

let loader = (name) => require(name)
let state = null // { ok, ort, Tokenizer } | { ok: false, reason, error }

function probe() {
  if (state) return state
  try {
    const ort = loader(RUNTIME)
    const { Tokenizer } = loader(TOKENIZERS)
    if (!ort || typeof ort.InferenceSession?.create !== 'function' || typeof ort.Tensor !== 'function') throw new Error(`${RUNTIME} is incomplete`)
    if (typeof Tokenizer !== 'function') throw new Error(`${TOKENIZERS} is incomplete`)
    state = { ok: true, ort, Tokenizer }
  } catch (err) {
    const first = String(err?.message || err).split('\n')[0]
    // The package itself is not there (CLI tarball, Homebrew) — as opposed to
    // a package that is there but cannot load on this computer (a missing
    // system library, a binary for another platform).
    const missing = err?.code === 'MODULE_NOT_FOUND' && new RegExp(`Cannot find (module|package) '(${RUNTIME}|${TOKENIZERS.replace('/', '\\/')})'`).test(first)
    // The desktop app for a platform the runtime does not support (Intel
    // Macs) has no runtime either, but a note saying why (stage-onnx.js).
    let unsupported = null
    if (missing) { try { unsupported = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'onnx-runtime.json'), 'utf8')).unsupported || null } catch { /* the CLI: no note */ } }
    state = unsupported
      ? { ok: false, reason: 'load-failed', error: String(unsupported).slice(0, 300) }
      : { ok: false, reason: missing ? 'not-bundled' : 'load-failed', error: first.slice(0, 300) }
  }
  return state
}

function available() { return probe().ok }

function info() {
  const s = probe()
  return { available: s.ok, reason: s.ok ? null : s.reason, error: s.ok ? null : s.error }
}

function ort() {
  const s = probe()
  if (!s.ok) {
    const e = new Error(s.reason === 'not-bundled' ? 'The ONNX runtime is not part of this build (it comes with the desktop app).' : `The ONNX runtime cannot load on this computer: ${s.error}`)
    e.code = 'ONNX_UNAVAILABLE'
    throw e
  }
  return s.ort
}

/** A tokenizer from a Hugging Face tokenizer.json (pure JS; the same ids as the Python/transformers tokenizers). */
function tokenizer(dir) {
  ort() // same availability as the runtime: never half a setup
  const json = (f, need) => {
    const p = path.join(dir, f)
    if (!need && !fs.existsSync(p)) return {}
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }
  return new state.Tokenizer(json('tokenizer.json', true), json('tokenizer_config.json', false))
}

// A one-node ONNX model, y = x + x (float[2]), built byte by byte: proves the
// native binary loads and computes on this computer without shipping a file.
function pb(field, wire, value) {
  const varint = (n) => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b) } while (n); return Buffer.from(out) }
  const key = varint((field << 3) | wire)
  if (wire === 0) return Buffer.concat([key, varint(value)])
  const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
  return Buffer.concat([key, varint(body.length), body])
}
const cat = (...b) => Buffer.concat(b)
function tinyModel() {
  const valueInfo = (name) => cat(pb(1, 2, name), pb(2, 2, pb(1, 2, cat(pb(1, 0, 1 /* FLOAT */), pb(2, 2, pb(1, 2, pb(1, 0, 2)))))))
  const node = cat(pb(1, 2, 'x'), pb(1, 2, 'x'), pb(2, 2, 'y'), pb(4, 2, 'Add'))
  const graph = cat(pb(1, 2, node), pb(2, 2, 'selftest'), pb(11, 2, valueInfo('x')), pb(12, 2, valueInfo('y')))
  return new Uint8Array(cat(pb(1, 0, 7), pb(7, 2, graph), pb(8, 2, cat(pb(1, 2, ''), pb(2, 0, 13)))))
}

/** Load the runtime, run a one-node model. { ok, version, ms } or { ok: false, error }. */
async function selfTest() {
  const t = Date.now()
  try {
    const o = ort()
    const session = await o.InferenceSession.create(tinyModel(), { executionProviders: ['cpu'] })
    const out = await session.run({ x: new o.Tensor('float32', Float32Array.from([1.5, -2]), [2]) })
    const y = Array.from(out.y.data)
    await session.release?.()
    if (y[0] !== 3 || y[1] !== -4) throw new Error(`wrong result ${JSON.stringify(y)}`)
    return { ok: true, version: o.env?.versions?.common || null, ms: Date.now() - t }
  } catch (err) {
    return { ok: false, error: String(err?.message || err).split('\n')[0] }
  }
}

function setLoader(fn) {
  loader = fn || ((name) => require(name))
  state = null
}

module.exports = { available, info, ort, tokenizer, selfTest, setLoader }
