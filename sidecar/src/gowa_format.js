"use strict"
/**
 * GOWA (General OpenLex Worker Agent) — the input format and the answer
 * maths of OpenLex's own decision model. Pure functions, no model needed;
 * models/gowa/gowa/format.py is the Python twin used for training, and
 * the two must stay identical (the same token sequence for the same
 * question, the same probabilities for the same scores).
 *
 * One sequence per question (Kev-style pointer head):
 *
 *   [CLS] <state> state … <q> instructions <opt> option 1 </opt> <opt> option 2 </opt> … <decide> [SEP]
 *
 * The model returns one score (logit) per option: the `</opt>` position's
 * vector scored against the `<decide>` vector. Dividing by the fitted
 * temperature and a softmax give calibrated probabilities. The three
 * System One answer types are read from those probabilities:
 *
 *   noul    options ["yes", "no"]          → { noul: p(yes) }
 *   choice  the options (≤ 255)            → { choice, probabilities, confidence = (p_max − 1/K) / (1 − 1/K) }
 *   score   the levels, lowest first       → { score = Σ i·p_i, legend, probabilities, confidence = max(0, 1 − E|i − mode| / (K − 1)) }
 *
 * The marker token ids (<state>, <q>, <opt>, </opt>, <decide>, plus the
 * tokenizer's CLS/SEP/PAD) come from the model's gowa-model.json.
 */

const MAX_OPTIONS = 255
const NOUL_OPTIONS = ['yes', 'no']

/** The state as text: strings as they are, anything else as JSON (System One allows objects and arrays). */
function stateText(state) {
  if (typeof state === 'string') return state
  try { return JSON.stringify(state) } catch { return String(state) }
}

/** Choice criteria as { option: description|null } (a plain list of options is allowed too). */
function choiceCriteria(q) {
  return Array.isArray(q.criteria) ? Object.fromEntries(q.criteria.map((o) => [String(o), null])) : (q.criteria || {})
}

/** The option texts of one (already validated) question, in order. */
function optionsOf(q, cfg = {}) {
  if (q.type === 'noul') return (cfg.noul_options || NOUL_OPTIONS).slice(0, 2)
  if (q.type === 'choice') return Object.entries(choiceCriteria(q)).map(([k, d]) => (d ? `${k}: ${d}` : k))
  if (q.type === 'score') return (q.criteria || []).map((c) => String(c))
  throw new Error(`unknown question type ${q.type}`)
}

/** The option keys an answer names (choice keys, score level indices). */
function optionKeys(q) {
  if (q.type === 'choice') return Object.keys(choiceCriteria(q))
  if (q.type === 'score') return (q.criteria || []).map((_, i) => String(i))
  return NOUL_OPTIONS
}

/**
 * Token ids for one question.
 * @param {object} p
 *   encode(text) → number[]   the tokenizer, without special tokens
 *   markers {cls, sep, state, question, opt_open, opt_close, decide}
 *   maxLen  the model's sequence limit
 * @returns {{ ids:number[], optionIndex:number[], decideIndex:number, truncated:boolean }}
 */
function buildSequence({ state, question, encode, markers, maxLen = 512, cfg = {} }) {
  const m = markers
  const opts = optionsOf(question, cfg)
  if (!opts.length) throw new Error('a question needs at least one option')
  if (opts.length > MAX_OPTIONS) throw new Error(`at most ${MAX_OPTIONS} options`)
  const tail = [m.question, ...encode(String(question.instructions || ''))]
  const optionRel = []
  for (const o of opts) {
    tail.push(m.opt_open, ...encode(o), m.opt_close)
    optionRel.push(tail.length - 1)
  }
  tail.push(m.decide)
  const decideRel = tail.length - 1
  tail.push(m.sep)
  const head = [m.cls, m.state]
  const room = maxLen - head.length - tail.length
  if (room < 1) throw new Error('the question and its options are too long for the model (shorten the instructions or the options)')
  let stateIds = encode(stateText(question.state ?? state))
  const truncated = stateIds.length > room
  if (truncated) stateIds = stateIds.slice(0, room)
  const at = head.length + stateIds.length
  return {
    ids: [...head, ...stateIds, ...tail],
    optionIndex: optionRel.map((i) => at + i),
    decideIndex: at + decideRel,
    truncated,
  }
}

/** Softmax of logits / temperature (numerically stable). */
function softmax(logits, temperature = 1) {
  const t = Number(temperature) > 0 ? Number(temperature) : 1
  const z = logits.map((x) => x / t)
  const max = Math.max(...z)
  const e = z.map((x) => Math.exp(x - max))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((x) => x / sum)
}

const r4 = (x) => Math.round(x * 1e4) / 1e4

/** One System One answer from the option logits of one question. */
function answerFrom(question, logits, temperature = 1) {
  const p = softmax(logits, temperature)
  const K = p.length
  if (question.type === 'noul') return { type: 'noul', noul: r4(p[0]) }
  let best = 0
  for (let i = 1; i < K; i++) if (p[i] > p[best]) best = i
  const keys = optionKeys(question)
  const probabilities = Object.fromEntries(keys.map((k, i) => [k, r4(p[i])]))
  if (question.type === 'choice') {
    const confidence = K > 1 ? Math.max(0, (p[best] - 1 / K) / (1 - 1 / K)) : 1
    return { type: 'choice', choice: keys[best], probabilities, confidence: r4(confidence) }
  }
  const score = p.reduce((s, x, i) => s + i * x, 0)
  const spread = p.reduce((s, x, i) => s + x * Math.abs(i - best), 0)
  const confidence = K > 1 ? Math.max(0, 1 - spread / (K - 1)) : 1
  const legend = Object.fromEntries(question.criteria.map((c, i) => [String(i), c]))
  return { type: 'score', score: r4(score), legend, probabilities, confidence: r4(confidence) }
}

/**
 * Pack sequences into one padded batch for the model.
 * @returns {{ B, L, K, inputIds: number[], attention: number[], optionIndex: number[], decideIndex: number[], optionCounts: number[] }}
 */
function packBatch(seqs, pad = 0) {
  const B = seqs.length
  const L = Math.max(...seqs.map((s) => s.ids.length))
  const K = Math.max(...seqs.map((s) => s.optionIndex.length))
  const inputIds = []
  const attention = []
  const optionIndex = []
  for (const s of seqs) {
    for (let i = 0; i < L; i++) { inputIds.push(i < s.ids.length ? s.ids[i] : pad); attention.push(i < s.ids.length ? 1 : 0) }
    // Missing options point at the decide token; their logits are ignored.
    for (let k = 0; k < K; k++) optionIndex.push(k < s.optionIndex.length ? s.optionIndex[k] : s.decideIndex)
  }
  return { B, L, K, inputIds, attention, optionIndex, decideIndex: seqs.map((s) => s.decideIndex), optionCounts: seqs.map((s) => s.optionIndex.length) }
}

module.exports = { buildSequence, answerFrom, softmax, packBatch, optionsOf, optionKeys, stateText, MAX_OPTIONS, NOUL_OPTIONS }
