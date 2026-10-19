"use strict"
/**
 * Structured clause extraction (B2) verification.
 *
 *   node test/clause.test.js
 */

const assert = require('assert')
const { analyzeSection, formatClauseAnalysis } = require('../src/clause')

const INDEMNITY = `7. Indemnification. Seller shall indemnify and hold harmless Buyer from and against all claims, losses and damages arising out of any breach of Seller's representations and warranties. The aggregate liability of Seller shall not exceed EUR 500,000. Buyer may terminate this Agreement upon 30 days' written notice if Seller fails to cure a material breach within 30 days.`

const LIMITATION = `12. Limitation of Liability. Neither party shall be liable to the other for any indirect, incidental, special or consequential damages. Each party's aggregate liability under this Agreement shall not exceed the fees paid by Client during the twelve months preceding the claim. Client may set off any undisputed amounts owed.`

const FAVORING = `9. Termination. Company may terminate this Agreement for convenience at any time upon 15 days' written notice. Supplier shall return all Confidential Information within 30 days of termination. Company shall pay for services rendered up to the date of termination only if Supplier delivers a complete invoice within 10 days.`

const MIXED = `4. Fees and Payment. Client agrees to pay Supplier the amount of USD 150,000 upon execution of this Agreement. Payment shall be made within 30 days after receipt of a proper invoice. Supplier warrants that all services will be performed in accordance with the statement of work. Either party may terminate this Agreement at any time upon written notice.`

;(async () => {
  let passed = 0
  const test = async (name, fn) => {
    try { await fn(); passed++; console.log(`  ok  ${name}`) }
    catch (err) { console.error(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1 }
  }

  await test('indemnity: obligations + values + durations extracted', () => {
    const a = analyzeSection(INDEMNITY)
    assert.ok(a.rows.some((r) => r.type === 'obligation' && /Seller/.test(r.subject)), 'Seller obligation row')
    assert.ok(a.rows.some((r) => r.type === 'right' && /Buyer/.test(r.subject)), 'Buyer right row')
    assert.ok(a.rows.some((r) => r.type === 'prohibition' && /shall not exceed/.test(r.clause)), 'cap row')
    assert.ok(a.values.includes('EUR 500,000'), 'value EUR 500,000')
    assert.ok(a.durations.some((d) => d.includes('30 days')), 'duration 30 days')
    assert.ok(a.parties.includes('Seller') && a.parties.includes('Buyer'), 'parties listed')
    assert.ok(a.favoring && /Buyer favored/.test(a.favoring), `favoring verdict: ${a.favoring}`)
  })

  await test('limitation: both-party cap, set-off right', () => {
    const a = analyzeSection(LIMITATION)
    const prohs = a.rows.filter((r) => r.type === 'prohibition')
    assert.ok(prohs.length >= 2, 'both-party caps flagged as prohibitions')
    assert.ok(prohs.every((r) => /both\/either party/.test(r.subject)), 'subjects normalized to both/either party')
    assert.ok(a.rows.some((r) => r.type === 'right' && /Client/.test(r.subject) && /set off/.test(r.clause)), 'Client set-off right')
    assert.ok(a.rows.some((r) => /twelve months/.test(r.clause)), '12-month lookback in clause text')
  })

  await test('favoring: Company termination + Supplier duties → Company favored', () => {
    const a = analyzeSection(FAVORING)
    assert.ok(a.rows.some((r) => r.type === 'right' && /Company/.test(r.subject)), 'Company convenience termination right')
    assert.ok(a.rows.some((r) => r.type === 'obligation' && /Supplier/.test(r.subject)), 'Supplier duty (return Confidential Information)')
    assert.ok(a.rows.some((r) => r.type === 'obligation' && /Company/.test(r.subject)), 'Company payment obligation (conditional on invoice)')
    assert.ok(a.favoring && /Company favored/.test(a.favoring), `favoring: ${a.favoring}`)
  })

  await test('mixed: warranty + balanced termination', () => {
    const a = analyzeSection(MIXED)
    assert.ok(a.rows.some((r) => r.type === 'warranty'), 'warranty row')
    assert.ok(a.rows.some((r) => r.type === 'obligation' && /Client/.test(r.subject)), 'Client pay obligation')
    assert.ok(a.values.includes('USD 150,000'), 'USD 150,000')
    assert.ok(a.favoring === null || /favored/.test(a.favoring), 'favoring may be null on balanced clauses')
  })

  await test('format stays ≤ ~700 chars per 8 rows', () => {
    const a = analyzeSection(FAVORING)
    const out = formatClauseAnalysis(a, 9)
    assert.ok(out.length < 1500, `format length ${out.length}`)
    assert.ok(out.includes('SECTION 9'), 'heading present')
    assert.ok(out.includes('favoring:'), 'favoring line present')
  })

  console.log(`\n${passed} passed${process.exitCode ? ', FAILURES' : ''}`)
  process.exit(process.exitCode || 0)
})().catch((err) => { console.error(err); process.exit(1) })
