"use strict"
/* Judge regression test: force-majeure rewrite (the 0/3 failure case).
 * Suggests rewrites that FAVOR the client — the old judge dropped them
 * because the proposal wasn't in the clause/law. The new judge must
 * verify rewrites whose ANALYSIS matches the clause.
 * Run: LEXVAULT_LLM_URL=http://127.0.0.1:11439 node judge-regression.js
 */
process.env.LEXVAULT_LLM_URL = process.env.LEXVAULT_LLM_URL || 'http://127.0.0.1:11439'
const { judgeSuggestions } = require('./src/judge')

const FM_CLAUSE = `Section 10. Force Majeure
Neither Party shall be liable for any failure or delay in performing its obligations under this Agreement if such failure or delay results from an event of Force Majeure. Force Majeure means any event beyond the reasonable control of the affected Party, including war, terrorism, fire, flood, epidemic, governmental action, or labor dispute. The affected Party shall notify the other Party in writing within five (5) Business Days of the onset of the event, and shall use reasonable efforts to mitigate the effects of the event. If the event of Force Majeure persists for more than thirty (30) consecutive days, either Party may terminate this Agreement upon written notice, with no liability for termination.`

const doc = { text: 'PREAMBLE\n' + FM_CLAUSE + '\n\nSection 11. Governing Law\nThis Agreement shall be governed by Austrian law.' }

const suggestions = [
  {
    id: 's-1', type: 'rephrase', severity: 'high',
    summary: 'Force majeure clause is reciprocal and allows either party to terminate after 30 days — the clause does not favor the Client.',
    proposed_text: 'Neither Party shall be liable for any failure or delay in performing its obligations under this Agreement if such failure or delay results from an event of Force Majeure. Force Majeure means any event beyond the reasonable control of the affected Party, including war, terrorism, fire, flood, epidemic, governmental action, or labor dispute. The affected Party shall notify the other Party in writing within five (5) Business Days of the onset of the event, and shall use reasonable efforts to mitigate the effects of the event. If the event of Force Majeure persists for more than ninety (90) consecutive days, the Client may terminate this Agreement upon written notice, with no liability for termination; the other Party may terminate only with the Client\u2019s prior written consent.',
    anchor: { text: 'either Party may terminate this Agreement upon written notice', wholeParagraph: true },
    clauseText: FM_CLAUSE, sectionIndex: 10,
  },
  {
    id: 's-2', type: 'flag-favoring', severity: 'medium',
    summary: 'The mitigation duty falls on both parties equally; a carve-out for the Client\u2019s suppliers and sub-contractors would strengthen the Client\u2019s position.',
    proposed_text: 'The affected Party shall notify the other Party in writing within five (5) Business Days of the onset of the event, and shall use reasonable efforts to mitigate the effects of the event. The Client\u2019s obligations are deemed excused where the failure is caused by a Force Majeure event affecting the Client\u2019s suppliers, sub-contractors or service providers.',
    anchor: { text: 'shall use reasonable efforts to mitigate the effects' },
    clauseText: FM_CLAUSE, sectionIndex: 10,
  },
  {
    id: 's-3', type: 'legal-risk', severity: 'low',
    summary: 'A thirty-day trigger is a short window; extending the persistence period gives the Client more flexibility before a termination right arises.',
    proposed_text: 'If the event of Force Majeure persists for more than sixty (60) consecutive days, either Party may terminate this Agreement upon written notice.',
    anchor: { text: 'persists for more than thirty (30) consecutive days' },
    clauseText: FM_CLAUSE, sectionIndex: 10,
  },
]

;(async () => {
  const verdicts = await judgeSuggestions({ doc, readSectionText: FM_CLAUSE }, suggestions, '')
  console.log('\n=== VERDICTS ===')
  suggestions.forEach((s, i) => {
    console.log(`[${verdicts[i].status}] ${s.summary.slice(0, 90)}`)
    console.log(`    note: ${verdicts[i].note}`)
  })
  const drops = verdicts.filter((v) => v.status === 'drop').length
  console.log(`\n${verdicts.length - drops}/${verdicts.length} verified — ${drops === 0 ? 'PASS (rewrites survive)' : 'FAIL (rewrites dropped)'}`)
  process.exit(drops === 0 ? 0 : 1)
})().catch((e) => { console.error('test error', e); process.exit(2) })
