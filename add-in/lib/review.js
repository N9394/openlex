/* OpenLex Word pane — contract review state ("Review this contract").
 * Folds the review stream (POST /api/document/analyze: step kind 'clause',
 * suggestion, error, done) into progress ("Clause 4 of 18"), findings and
 * the summary line ("3 high risks, 5 medium"). Where each finding landed in
 * Word (tracked change, comment, not placed) and the lawyer's decision
 * (accepted / rejected) are recorded here too. No DOM, no Office.js. */
(function (root, factory) {
  const req = typeof require === 'function'
  const words = req ? require('./words.js') : root.OpenLexPane.words
  const sources = req ? require('./sources.js') : root.OpenLexPane.sources
  const m = factory(words, sources)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).review = m
})(typeof self !== 'undefined' ? self : this, function (words, sources) {
  'use strict'

  const SEV = ['high', 'medium', 'low']
  const SIDES = [
    ['neutral', 'No side — balanced review'], ['ours', 'Our client (as named in the matter)'],
    ['supplier', 'Supplier / seller'], ['customer', 'Customer / buyer'], ['landlord', 'Landlord'], ['tenant', 'Tenant'],
    ['employer', 'Employer'], ['employee', 'Employee'], ['discloser', 'Disclosing party'], ['recipient', 'Receiving party'],
  ]
  const FOCUS = [['liability', 'Liability and caps'], ['termination', 'Termination and notice'], ['payment', 'Payment'], ['warranty', 'Warranties'], ['ip', 'Intellectual property'], ['confidentiality', 'Confidentiality'], ['data', 'Data protection'], ['law', 'Governing law and disputes']]

  function start(opts, now) {
    return { startedAt: now, endedAt: null, opts: opts || {}, position: -1, total: 0, clause: null, clauseAt: now, findings: [], problems: [], stopped: false, failed: false }
  }

  const clone = (r) => Object.assign({}, r, { findings: r.findings.map((f) => Object.assign({}, f)), problems: r.problems.slice() })

  function apply(rev, ev, now) {
    if (!ev) return rev
    const r = clone(rev)
    if (ev.type === 'step' && ev.kind === 'clause') {
      r.position = ev.position || 0
      r.total = ev.total || r.total
      r.clause = (ev.detail && ev.detail.clause) || null
      r.clauseAt = now
      return r
    }
    if (ev.type === 'suggestion' && ev.suggestion) {
      const s = ev.suggestion
      r.findings.push({
        id: s.id || `f${r.findings.length + 1}`,
        clause: s.clause ? words.clauseName(s.clause) : (r.clause ? words.clauseName(r.clause) : ''),
        summary: s.summary || 'Proposed change',
        severity: SEV.includes(s.severity) ? s.severity : 'low',
        basis: sources.basisText(s.basis),
        check: sources.checkLine(s),
        status: 'open', placed: 'pending', problem: '',
        suggestion: s,
      })
      return r
    }
    if (ev.type === 'error') {
      if (ev.recoverable) { r.problems.push(ev.clause ? `${words.cap(words.clauseName(ev.clause))} could not be reviewed.` : 'One part could not be reviewed.'); return r }
      r.failed = true; r.endedAt = r.endedAt || now; return r
    }
    if (ev.type === 'done') { r.stopped = !!ev.stopped || r.stopped; r.total = ev.total || r.total; r.endedAt = now; return r }
    return rev
  }

  function stop(rev, now) { const r = clone(rev); r.stopped = true; r.endedAt = r.endedAt || now; return r }

  /** Time left from the clauses finished so far. */
  function timeLeft(rev, now) {
    const done = rev.position
    if (!rev.total || done < 1 || done >= rev.total) return ''
    const per = Math.max((rev.clauseAt - rev.startedAt) / done, 1)
    const s = Math.max(per * (rev.total - done) - (now - rev.clauseAt), per * 0.2) / 1000
    if (s < 45) return 'less than a minute left'
    if (s < 90) return 'about a minute left'
    return `about ${Math.round(s / 60)} minutes left`
  }

  /** "Clause 4 of 18 · clause 4 (Liability) · about 2 minutes left". */
  function progressLine(rev, now) {
    if (!rev.total) return 'Reading the contract'
    const left = timeLeft(rev, now)
    return [`Clause ${rev.position + 1} of ${rev.total}`, rev.clause ? words.clauseName(rev.clause) : '', left].filter(Boolean).join(' · ')
  }

  function counts(rev) {
    const bySeverity = { high: 0, medium: 0, low: 0 }
    const byStatus = { accepted: 0, rejected: 0, open: 0 }
    for (const f of rev.findings) { bySeverity[f.severity]++; byStatus[f.status]++ }
    return { bySeverity, byStatus, total: rev.findings.length, notPlaced: rev.findings.filter((f) => f.placed === 'failed').length }
  }

  /** The one summary line: "3 high risks, 5 medium, 1 low" / "No risks found in 18 clauses". */
  function summaryLine(rev) {
    const c = counts(rev)
    if (!c.total) return rev.total ? `No risks found in ${words.plural(rev.total, 'clause')}` : 'No risks found'
    const parts = []
    SEV.forEach((s, i) => { if (c.bySeverity[s]) parts.push(i === 0 || !parts.length ? `${c.bySeverity[s]} ${s} risk${c.bySeverity[s] === 1 ? '' : 's'}` : `${c.bySeverity[s]} ${s}`) })
    return parts.join(', ')
  }

  /** "2 accepted · 1 rejected · 6 to decide". */
  function decisionLine(rev) {
    const c = counts(rev)
    return [c.byStatus.accepted ? `${c.byStatus.accepted} accepted` : '', c.byStatus.rejected ? `${c.byStatus.rejected} rejected` : '', c.byStatus.open ? `${c.byStatus.open} to decide` : ''].filter(Boolean).join(' · ')
  }

  /** How the review ended, in one sentence. */
  function endLine(rev) {
    const reviewed = rev.stopped ? Math.max(rev.position, 0) : rev.total
    if (rev.stopped) return `Stopped by you after ${words.plural(reviewed, 'clause')} of ${rev.total || '?'}. Everything found so far is kept in the document.`
    if (rev.failed) return 'The review ended early. Everything found so far is kept in the document.'
    return `Reviewed ${words.plural(rev.total, 'clause')} in ${words.duration((rev.endedAt || rev.startedAt) - rev.startedAt)}.`
  }

  function setPlaced(rev, id, placed, problem) {
    const r = clone(rev)
    const f = r.findings.find((x) => x.id === id)
    if (f) { f.placed = placed; f.problem = problem || '' }
    return r
  }

  function decide(rev, id, status) {
    const r = clone(rev)
    const f = r.findings.find((x) => x.id === id)
    if (f && ['accepted', 'rejected', 'open'].includes(status)) f.status = status
    return r
  }

  /** Findings ordered for the expanded list: severity first, then document order. */
  function ordered(rev) {
    return rev.findings.map((f, i) => Object.assign({ i }, f)).sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || a.i - b.i)
  }

  /** Body for POST /api/review/export. */
  function exportPayload(rev, title) {
    const side = SIDES.find(([k]) => k === rev.opts.side)
    return {
      title: title || 'Contract review',
      side: side && rev.opts.side !== 'neutral' ? side[1] : '',
      findings: rev.findings.map((f) => ({ clause: f.clause, summary: f.summary, severity: f.severity, status: f.status, basis: f.basis, checked: f.check.text, proposed: f.suggestion.proposed_text || '' })),
    }
  }

  /** Why a finding could not be placed in the document, in plain words. */
  function anchorProblem(err) {
    const m = String((err && err.message) || err || '')
    if (/no anchor|has no anchor/i.test(m)) return 'OpenLex did not say which words this is about, so it could not be marked in the document.'
    if (/no longer present|not found|anchor/i.test(m)) return 'The words this is about were not found in the document — it may have been edited since the review started.'
    if (/tracked changes are not available|Compatibility Mode/i.test(m)) return 'This document cannot show tracked changes (it may be in Compatibility Mode).'
    if (/comments are not available/i.test(m)) return 'This version of Word cannot add comments from OpenLex.'
    return 'Word did not accept the change.'
  }

  return { start, apply, stop, progressLine, summaryLine, decisionLine, endLine, counts, setPlaced, decide, ordered, exportPayload, anchorProblem, timeLeft, SIDES, FOCUS }
})
