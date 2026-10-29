"use strict"
/**
 * Contract review in Word, clause by clause (POST /api/document/analyze):
 * the per-clause instruction (for which side, against which firm
 * checklist, with which focus) and the review export (POST
 * /api/review/export → a Word or PDF file in the matter's folder).
 *
 * Pure except exportReview (writes one file into the files folder).
 * Tested offline in test/review.test.js.
 */

const SIDES = { ours: 'our client', client: 'our client', supplier: 'the supplier / seller', customer: 'the customer / buyer', landlord: 'the landlord', tenant: 'the tenant', employer: 'the employer', employee: 'the employee', discloser: 'the disclosing party', recipient: 'the receiving party', neutral: '' }
const FOCUS = { liability: 'liability and caps', termination: 'termination and notice', payment: 'payment terms', warranty: 'warranties and guarantees', ip: 'intellectual property', confidentiality: 'confidentiality', data: 'data protection (GDPR)', law: 'governing law and disputes' }
const SEVERITY = ['high', 'medium', 'low']

const clean = (s, n = 120) => String(s ?? '').replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

/** The options a lawyer picked, normalised (unknown values are dropped, never passed to the model raw). */
function options(body = {}) {
  const side = Object.prototype.hasOwnProperty.call(SIDES, body.side) ? body.side : (typeof body.side === 'string' && body.side.trim() ? 'custom' : 'neutral')
  const sideText = side === 'custom' ? clean(body.side, 60) : SIDES[side]
  const focus = (Array.isArray(body.focus) ? body.focus : []).map((f) => FOCUS[f] || clean(f, 40)).filter(Boolean).slice(0, 6)
  return { side, sideText, focus, playbook: typeof body.playbook === 'string' ? body.playbook : '' }
}

/** The instruction for one clause. `checks`: the firm checklist's questions (optional). */
function clausePrompt({ section, position = 0, total = 1, opts = {}, checks = [] }) {
  const lines = [
    `Review section ${section.index} of the document ("${clean(section.heading, 80) || 'untitled'}") — clause ${position + 1} of ${total}.`,
    'Use get_range_text and get_clause_analysis; search the law only if a clause is risky; propose suggestions with the legal basis (statute and section) for each.',
  ]
  if (opts.sideText) lines.push(`We act for ${opts.sideText}: flag what is unfavourable to them and propose wording that protects them.`)
  if (opts.focus && opts.focus.length) lines.push(`Pay particular attention to: ${opts.focus.join(', ')}.`)
  if (checks.length) lines.push(`Check it against the firm's checklist where relevant:\n${checks.slice(0, 25).map((c) => `- ${clean(c.question, 200)}${c.standard ? ` (firm standard: ${clean(c.standard, 160)})` : ''}`).join('\n')}`)
  lines.push('If the clause is fine, say so in one sentence and propose nothing.')
  return lines.join('\n')
}

/** Count findings by severity and by the lawyer's decision. */
function summarize(findings = []) {
  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byStatus = { accepted: 0, rejected: 0, open: 0 }
  for (const f of findings) {
    bySeverity[SEVERITY.includes(f.severity) ? f.severity : 'low']++
    byStatus[f.status === 'accepted' ? 'accepted' : f.status === 'rejected' ? 'rejected' : 'open']++
  }
  return { total: findings.length, bySeverity, byStatus }
}

const STATUS_WORDS = { accepted: 'Accepted', rejected: 'Rejected', open: 'Not decided yet' }
const basisWords = (b) => (!b ? '' : typeof b === 'string' ? b : [b.source || b.source_name, b.section].filter(Boolean).join(' '))

/** Normalise what the pane sends (it is shown in a document, so text only, bounded). */
function cleanFindings(list = []) {
  return (Array.isArray(list) ? list : []).slice(0, 500).map((f) => ({
    clause: clean(f.clause, 120),
    summary: clean(f.summary, 400),
    severity: SEVERITY.includes(f.severity) ? f.severity : 'low',
    status: ['accepted', 'rejected'].includes(f.status) ? f.status : 'open',
    basis: clean(basisWords(f.basis), 120),
    checked: clean(f.checked, 160),
    proposed: String(f.proposed || '').slice(0, 4000),
  }))
}

/** The review as .docx blocks (docx_write.js). */
function docxBlocks({ title, side, findings, date }) {
  const sum = summarize(findings)
  const blocks = [
    { text: title || 'Contract review', style: 'Title' },
    { text: `${date} · ${sum.total} finding${sum.total === 1 ? '' : 's'} · ${sum.bySeverity.high} high, ${sum.bySeverity.medium} medium, ${sum.bySeverity.low} low · ${sum.byStatus.accepted} accepted, ${sum.byStatus.rejected} rejected, ${sum.byStatus.open} not decided${side ? ` · for ${side}` : ''}` },
    { text: 'Prepared with OpenLex. Each finding was proposed by an AI and must be checked by a lawyer.' },
  ]
  for (const sev of SEVERITY) {
    const rows = findings.filter((f) => f.severity === sev)
    if (!rows.length) continue
    blocks.push({ text: `${sev[0].toUpperCase()}${sev.slice(1)} risk`, style: 'Heading1' })
    for (const f of rows) {
      blocks.push({ text: `${f.clause || 'Clause'} — ${STATUS_WORDS[f.status]}`, style: 'Heading2' })
      blocks.push({ runs: [{ text: f.summary, bold: true }] })
      if (f.basis || f.checked) blocks.push({ text: [f.basis ? `Legal basis: ${f.basis}` : '', f.checked].filter(Boolean).join(' · ') })
      if (f.proposed) blocks.push({ runs: [{ text: 'Proposed wording: ', bold: true }, { text: f.proposed }] })
    }
  }
  if (!findings.length) blocks.push({ text: 'No findings: OpenLex proposed no changes.' })
  return blocks
}

/** The review as PDF blocks (pdf.js: titled two-column tables). */
function pdfBlocks({ title, side, findings, date }) {
  const sum = summarize(findings)
  const blocks = [{ title: title || 'Contract review', rows: [['Date', date], ['Findings', `${sum.total} (${sum.bySeverity.high} high, ${sum.bySeverity.medium} medium, ${sum.bySeverity.low} low)`], ['Decisions', `${sum.byStatus.accepted} accepted, ${sum.byStatus.rejected} rejected, ${sum.byStatus.open} not decided`], ...(side ? [['Acting for', side]] : []), ['Note', 'Proposed by an AI; to be checked by a lawyer.']] }]
  for (const sev of SEVERITY) {
    const rows = findings.filter((f) => f.severity === sev)
    if (rows.length) blocks.push({ title: `${sev[0].toUpperCase()}${sev.slice(1)} risk`, rows: rows.map((f) => [f.clause || 'Clause', [f.summary, f.basis ? `Basis: ${f.basis}` : '', f.checked, `Decision: ${STATUS_WORDS[f.status]}`, f.proposed ? `Proposed: ${f.proposed}` : ''].filter(Boolean).join(' — ')]) })
  }
  return blocks
}

/**
 * Write the review into the matter's folder (Word or PDF). Returns the
 * absolute path. `matterLabel` names the folder (workflows.matterLabel).
 */
function exportReview({ title, side, findings, format = 'docx', matterLabel = 'default', now = new Date() }) {
  const ws = require('./workspace')
  const fmt = format === 'pdf' ? 'pdf' : 'docx'
  const list = cleanFindings(findings)
  const date = now.toISOString().slice(0, 10)
  const data = { title: clean(title, 120), side: clean(side, 60), findings: list, date }
  const base = `review-${clean(title, 40).replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'contract'}-${date}`
  const rel = `${ws.matterFolder(matterLabel)}/${base}.${fmt}`
  const buf = fmt === 'pdf' ? require('./pdf').renderPdf(pdfBlocks(data)) : require('./docx_write').docxBuffer(docxBlocks(data))
  return ws.writeFileBinary(rel, buf)
}

module.exports = { options, clausePrompt, summarize, cleanFindings, docxBlocks, pdfBlocks, exportReview, SIDES, FOCUS }
