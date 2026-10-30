"use strict"
/**
 * A tiny fake GOWA model for tests: a real ONNX file (written here with a
 * minimal protobuf encoder, no Python needed), a WordLevel tokenizer and a
 * gowa-model.json. It has the same inputs and output as the real export
 * (models/gowa/export_onnx.py):
 *
 *   inputs  input_ids [B,L], attention_mask [B,L], option_index [B,K], decide_index [B]  (int64)
 *   output  option_logits [B,K] (float)
 *
 * Its "decision": the logit of an option is the token id of the option's
 * last word (the token just before its </opt> marker). So with the
 * vocabulary below, "yes" (40) beats "no" (10), and tests can steer the
 * answer through the words they use.
 */

const fs = require('fs')
const path = require('path')

// ── protobuf, just enough for an ONNX ModelProto ─────────────────────────
function varint(n) {
  let v = BigInt(n)
  const out = []
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b) } while (v)
  return Buffer.from(out)
}
const key = (field, wire) => varint((field << 3) | wire)
const vint = (field, n) => Buffer.concat([key(field, 0), varint(n)])
const bytes = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf])
const str = (field, s) => bytes(field, Buffer.from(s, 'utf8'))
const msg = (field, parts) => bytes(field, Buffer.concat(parts))

const INT64 = 7
const FLOAT = 1
const dim = (d) => msg(1, [typeof d === 'number' ? vint(1, d) : str(2, d)])
const valueInfo = (field, name, elem, dims) => msg(field, [str(1, name), msg(2, [msg(1, [vint(1, elem), msg(2, dims.map(dim))])])])
const attrInt = (name, i) => msg(5, [str(1, name), vint(3, i), vint(20, 2)])
const node = (op, inputs, outputs, attrs = []) => msg(1, [...inputs.map((x) => str(1, x)), ...outputs.map((x) => str(2, x)), str(3, `${op}_${outputs[0]}`), str(4, op), ...attrs])

function fakeOnnx() {
  const one = Buffer.alloc(8)
  one.writeBigInt64LE(1n)
  const graph = [
    node('Sub', ['option_index', 'one'], ['prev']),
    node('GatherElements', ['input_ids', 'prev'], ['picked'], [attrInt('axis', 1)]),
    node('Cast', ['picked'], ['option_logits'], [attrInt('to', FLOAT)]),
    str(2, 'fake_gowa'),
    msg(5, [vint(2, INT64), str(8, 'one'), bytes(9, one)]),
    valueInfo(11, 'input_ids', INT64, ['B', 'L']),
    valueInfo(11, 'attention_mask', INT64, ['B', 'L']),
    valueInfo(11, 'option_index', INT64, ['B', 'K']),
    valueInfo(11, 'decide_index', INT64, ['B']),
    valueInfo(12, 'option_logits', FLOAT, ['B', 'K']),
  ]
  return Buffer.concat([vint(1, 8), str(2, 'openlex-test'), msg(7, graph), msg(8, [str(1, ''), vint(2, 13)])])
}

// ── tokenizer and head config ────────────────────────────────────────────
const MARKERS = { pad: 0, cls: 1, sep: 2, state: 3, question: 4, opt_open: 5, opt_close: 6, decide: 7 }
const VOCAB = {
  '[PAD]': 0, '[CLS]': 1, '[SEP]': 2, '<state>': 3, '<q>': 4, '<opt>': 5, '</opt>': 6, '<decide>': 7, '[UNK]': 8,
  no: 10, low: 11, medium: 12, high: 13, other: 14, person: 30, organisation: 25, yes: 40,
}
for (const w of 'the contract is governed by austrian law ? is chosen does this say what which a an of in and to'.split(' ')) if (!(w in VOCAB)) VOCAB[w] = 100 + Object.keys(VOCAB).length

function tokenizerJson() {
  return {
    version: '1.0', truncation: null, padding: null,
    added_tokens: Object.entries(VOCAB).filter(([w]) => /^[[<]/.test(w)).map(([content, id]) => ({ id, content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true })),
    normalizer: { type: 'Lowercase' }, pre_tokenizer: { type: 'Whitespace' }, post_processor: null, decoder: null,
    model: { type: 'WordLevel', vocab: VOCAB, unk_token: '[UNK]' },
  }
}

function headConfig(extra = {}) {
  return { format: 'gowa-decision-v1', version: 'test', base: 'fake', max_length: 64, markers: MARKERS, unk: 8, temperature: 4, temperatures: {}, thresholds: { redaction: 0.6 }, ...extra }
}

/** Write a complete fake model into `dir`. */
function writeFakeModel(dir, extra = {}) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'model.onnx'), fakeOnnx())
  fs.writeFileSync(path.join(dir, 'tokenizer.json'), JSON.stringify(tokenizerJson()))
  fs.writeFileSync(path.join(dir, 'tokenizer_config.json'), JSON.stringify({ tokenizer_class: 'PreTrainedTokenizerFast', unk_token: '[UNK]' }))
  fs.writeFileSync(path.join(dir, 'gowa-model.json'), JSON.stringify(headConfig(extra)))
  return dir
}

/** A word-level encoder for mocked-runner tests (same vocabulary). */
function encode(text) {
  return String(text).toLowerCase().split(/[^\p{L}\p{N}?]+/u).filter(Boolean).map((w) => VOCAB[w] ?? 8)
}

module.exports = { fakeOnnx, writeFakeModel, tokenizerJson, headConfig, encode, MARKERS, VOCAB }
