"use strict"
/**
 * A scripted GOWA backend for tests (gowa._setTestBackend): a word-level
 * tokenizer that remembers every word, and a "model" that reads each
 * sequence back as text and answers by rules the test gives:
 *
 *   rule(state, instructions, options) → index of the winning option, or null (unsure: all equal)
 *
 * The winner gets a logit of `margin`, the others 0 — with temperature 1
 * and margin 6 that is p ≈ 0.99 for two options, ≈ 0.95 for six.
 */

const { headConfig, MARKERS } = require('./fake_gowa')

function scripted(rule, { margin = 6, config = {} } = {}) {
  const words = new Map()
  const back = new Map()
  const encode = (text) => String(text).match(/⟦|⟧|[^\s⟦⟧]+/g)?.map((w) => {
    if (!words.has(w)) { const id = 100 + words.size; words.set(w, id); back.set(id, w) }
    return words.get(w)
  }) || []
  const text = (ids) => ids.map((i) => back.get(i) ?? '').join(' ')
  const calls = []
  const run = async (b) => {
    const out = []
    for (let r = 0; r < b.B; r++) {
      const ids = b.inputIds.slice(r * b.L, (r + 1) * b.L)
      const q = ids.indexOf(MARKERS.question)
      const firstOpt = ids.indexOf(MARKERS.opt_open)
      const state = text(ids.slice(2, q))
      const instructions = text(ids.slice(q + 1, firstOpt))
      const options = []
      let cur = null
      for (let i = firstOpt; i < ids.length; i++) {
        if (ids[i] === MARKERS.opt_open) cur = []
        else if (ids[i] === MARKERS.opt_close) { options.push(text(cur)); cur = null } else if (cur) cur.push(ids[i])
      }
      calls.push({ state, instructions, options })
      const win = rule(state, instructions, options)
      for (let k = 0; k < b.K; k++) out.push(k < options.length && win === k ? margin : 0)
    }
    return out
  }
  return { encode, run, config: headConfig({ temperature: 1, max_length: 2048, ...config }), calls }
}

module.exports = { scripted }
