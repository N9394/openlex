"use strict"
/* E2E: pre-read pass for rewrite asks on big docs (>40K chars → no full
 * injection) + long-proposal capability (WRITE_MAX_TOKENS 6000).
 * Real Lotus 2. Expectation: the model does NOT re-fetch the FM clause
 * via get_range_text (it's pre-read) and produces a FULL-length rewrite.
 * Run: LEXVAULT_LLM_URL=http://127.0.0.1:11439 node preread-test.js
 */
process.env.LEXVAULT_LLM_URL = 'http://127.0.0.1:11439'
const { runAction } = require('./src/agent')

const FM = `Section 10. Force Majeure
Neither Party shall be liable for any failure or delay in performing its obligations under this Agreement if such failure or delay results from an event of Force Majeure. Force Majeure means any event beyond the reasonable control of the affected Party, including war, terrorism, fire, flood, epidemic, governmental action, or labor dispute. The affected Party shall notify the other Party in writing within five (5) Business Days of the onset of the event, and shall use reasonable efforts to mitigate the effects of the event. If the event of Force Majeure persists for more than thirty (30) consecutive days, either Party may terminate this Agreement upon written notice, with no liability for termination.`

const NEIGHBOR = `Section 11. Governing Law
This Agreement shall be governed by and construed in accordance with the laws of the Republic of Austria. The parties submit to the exclusive jurisdiction of the courts of Vienna.`

// Pad the doc past the 40K full-injection threshold with boilerplate.
const PAD = []
for (let i = 1; i <= 130; i++) {
  PAD.push(`Section ${i}. Boilerplate ${i}\nThe parties acknowledge that this clause is boilerplate filler for context-window testing purposes and carries no legal meaning of its own. It repeats several full sentences so that the document reaches a length well beyond the full-text injection threshold, forcing the pre-read pass to supply the target clause verbatim to the agent. This paragraph is intentionally verbose and says nothing of substance.`)
}
const DOC = PAD.join('\n\n') + '\n\n' + FM + '\n\n' + NEIGHBOR

const ctx = {
  doc: {
    text: DOC,
    sections: (() => {
      const { Document } = require('./src/doc')
      return new Document(DOC, 'preread-test').sections
    })(),
    summary: () => { try { return require('./src/doc').Document.prototype.summary.call({ text: DOC, sections: [], glossary: [] }) } catch { return '' } },
    jurisdiction: () => 'AT',
    map: null,
    section: null,
  },
  memory: { addFact: () => {}, recall: () => [], registerSuggestion: () => {}, ledger: () => [] },
  search: {
    hybridSearch: async (v, { jurisdiction, limit }) => ({ results: [], error: null }),
    getChunk: async () => null,
  },
  embeddings: { embedQueries: async (qs) => qs.map(() => new Array(64).fill(0.5)) },
}
ctx.doc.sections.forEach((s) => { s.text = s.text }) // ensure verbatim
ctx.doc.map = () => ({ sections: ctx.doc.sections.map((s) => ({ index: s.index, heading: s.text.split('\n')[0] || null, level: 0 })) })
ctx.doc.section = (i) => ctx.doc.sections[i] || null
ctx.doc.jurisdiction = () => 'AT'

;(async () => {
  const events = []
  const t0 = Date.now()
  const r = await runAction(ctx, 'Please rewrite the force majeure clause (Section 10) to heavily favor the Provider.', (e) => events.push(e))
  console.log(`\nelapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log('steps:', events.filter((e) => e.type === 'step').map((e) => e.text).join(' | ') || '(none)')
  const hops = events.filter((e) => e.type === 'step' && /^tool:/.test(e.text || '')).map((e) => e.text)
  console.log('tool hops:', hops.length ? hops.join(', ') : '(none)')
  const reFetch = hops.filter((h) => h.includes('get_range_text') || h.includes('get_clause_analysis'))
  console.log(reFetch.length === 0 ? 'PASS — target clause was pre-read, no re-fetch hop' : `NOTE — model re-fetched: ${reFetch.join(', ')}`)
  console.log('suggestions:', r.suggestions.length)
  for (const s of r.suggestions) console.log(`  - [${s.verdict?.status || '?'}] ${s.summary} | proposal ${(s.proposed_text || '').length} chars`)
  console.log('final:', String(r.text).slice(0, 140))
  process.exit(0)
})().catch((e) => { console.error('test error:', e); process.exit(2) })
