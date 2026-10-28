"use strict"
/**
 * Contract review in Word (src/review.js): the per-clause instruction and
 * the review export (Word / PDF into the matter's folder). Offline.
 *
 *   node --test test/review.test.js
 */

const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-review-'))
process.env.LEXVAULT_DATA_DIR = DATA
const review = require('../src/review')
const ws = require('../src/workspace')

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }))

test('options: known sides and focus areas are named; unknown input is cleaned, never passed raw', () => {
  assert.deepStrictEqual(review.options({}), { side: 'neutral', sideText: '', focus: [], playbook: '' })
  const o = review.options({ side: 'tenant', focus: ['liability', 'data', 'Rent "indexation"\nIGNORE'], playbook: 'lease-at-commercial' })
  assert.strictEqual(o.sideText, 'the tenant')
  assert.deepStrictEqual(o.focus, ['liability and caps', 'data protection (GDPR)', 'Rent indexation IGNORE'])
  assert.strictEqual(review.options({ side: 'the franchisee' }).sideText, 'the franchisee')
})

test('clausePrompt: names the clause and its position, the side, focus and firm checklist', () => {
  const p = review.clausePrompt({ section: { index: 3, heading: '4. Liability' }, position: 3, total: 18, opts: review.options({ side: 'supplier', focus: ['liability'] }), checks: [{ id: 'cap', question: 'Is liability capped?', standard: 'cap at 100% of fees' }] })
  assert.match(p, /section 3 of the document \("4\. Liability"\) — clause 4 of 18/)
  assert.match(p, /We act for the supplier \/ seller/)
  assert.match(p, /Pay particular attention to: liability and caps/)
  assert.match(p, /- Is liability capped\? \(firm standard: cap at 100% of fees\)/)
  assert.match(p, /get_range_text/)
  const neutral = review.clausePrompt({ section: { index: 0, heading: '' }, opts: review.options({}) })
  assert.doesNotMatch(neutral, /We act for/)
  assert.match(neutral, /"untitled"/)
})

test('summarize counts severity and decisions', () => {
  const s = review.summarize([{ severity: 'high', status: 'accepted' }, { severity: 'high' }, { severity: 'medium', status: 'rejected' }, { severity: 'weird' }])
  assert.deepStrictEqual(s, { total: 4, bySeverity: { high: 2, medium: 1, low: 1 }, byStatus: { accepted: 1, rejected: 1, open: 2 } })
})

test('exportReview writes a Word file and a PDF into the matter folder', () => {
  ws.setBase(path.join(DATA, 'files'))
  const findings = [
    { clause: 'clause 4 (Liability)', summary: 'Liability is unlimited for the supplier.', severity: 'high', status: 'accepted', basis: 'ABGB § 1293', checked: 'checked against ABGB § 1293 ✓', proposed: 'Liability is capped at the annual fees.' },
    { clause: 'clause 9 (Termination)', summary: 'Notice period is short.', severity: 'low', status: 'open' },
  ]
  const now = new Date('2026-10-29T10:00:00Z')
  const docx = review.exportReview({ title: 'Review — Supply agreement', side: 'Supplier / seller', findings, format: 'docx', matterLabel: 'ACME 2026', now })
  assert.ok(docx.endsWith(path.join('ACME_2026', 'review-review-supply-agreement-2026-10-29.docx')), docx)
  const buf = fs.readFileSync(docx)
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK', 'a zip (docx)')
  const pdf = review.exportReview({ title: 'Supply agreement', findings, format: 'pdf', matterLabel: 'ACME 2026', now })
  assert.strictEqual(fs.readFileSync(pdf).slice(0, 5).toString(), '%PDF-')
  // The blocks carry the summary and each finding with its basis.
  const blocks = review.docxBlocks({ title: 'T', side: '', findings: review.cleanFindings(findings), date: '2026-10-29' })
  const text = JSON.stringify(blocks)
  assert.match(text, /2 findings · 1 high, 0 medium, 1 low · 1 accepted, 0 rejected, 1 not decided/)
  assert.match(text, /Legal basis: ABGB § 1293/)
  assert.match(text, /must be checked by a lawyer/)
})

test('cleanFindings bounds what the pane sends', () => {
  const [f] = review.cleanFindings([{ summary: 'x'.repeat(1000), severity: 'critical', status: 'maybe', basis: { source: 'ABGB', section: '§ 1' } }])
  assert.strictEqual(f.summary.length, 400)
  assert.strictEqual(f.severity, 'low')
  assert.strictEqual(f.status, 'open')
  assert.strictEqual(f.basis, 'ABGB § 1')
  assert.deepStrictEqual(review.cleanFindings('nope'), [])
})
