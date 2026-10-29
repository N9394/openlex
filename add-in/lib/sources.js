/* OpenLex Word pane — "Based on": what an answer used, as small numbered
 * markers (summary first, details on click), and whether a proposed change
 * was checked against the law it cites. No DOM. */
(function (root, factory) {
  const words = typeof require === 'function' ? require('./words.js') : root.OpenLexPane.words
  const m = factory(words)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).sources = m
})(typeof self !== 'undefined' ? self : this, function (words) {
  'use strict'

  /**
   * Every law section and document passage the answer used, numbered:
   * [{ n, kind: 'law'|'doc'|'note', label, detail, chunk_id?, clause?, section? }].
   * `act` = the activity state (activity.js).
   */
  function basedOn(act, max) {
    if (!act) return []
    const out = []
    for (const s of act.sources || []) {
      out.push({ kind: 'law', label: words.clip([s.source_name, s.section].filter(Boolean).join(' ') || 'a law section', 50), detail: s.snippet || '', chunk_id: s.chunk_id || null })
    }
    for (const c of act.clauses || []) {
      out.push({ kind: 'doc', label: `Your document: ${words.clauseName(c)}`, detail: c.heading || '', clause: c })
    }
    for (const n of act.notes || []) {
      const hasSec = n.section !== '' && n.section != null
      out.push({ kind: 'note', label: words.clip(`Noted${hasSec ? ` (part ${n.section})` : ''}: ${[n.entity, n.claim].filter(Boolean).join(' — ')}`, 70), detail: n.claim || '', section: hasSec ? n.section : null })
    }
    return out.slice(0, max || 12).map((x, i) => Object.assign({ n: i + 1 }, x))
  }

  /** The cited law of a suggestion, in words ("ABGB § 933"). */
  function basisText(b) {
    if (!b) return ''
    if (typeof b === 'string') return words.clip(b, 60)
    return words.clip([b.source || b.source_name, b.section].filter(Boolean).join(' '), 60)
  }

  /** Was a proposed change checked? { text, ok, mark } — mark is a symbol, never colour alone. */
  function checkLine(s) {
    s = s || {}
    const basis = basisText(s.basis)
    const v = s.verdict || {}
    if (s.citationWarning) return { ok: false, mark: '!', text: `The cited section may be wrong (${words.clip(s.citationWarning, 60)}) — review carefully` }
    if (s.collapseWarning) return { ok: false, mark: '!', text: 'Much shorter than the original clause — check nothing important was dropped' }
    if (v.status === 'verified' && !/unverified|unavailable/i.test(v.note || '')) return { ok: true, mark: '✓', text: basis ? `checked against ${basis} ✓` : 'checked against your document ✓' }
    if (v.status === 'rewrite') return { ok: true, mark: '✓', text: `checked and corrected${basis ? ` (against ${basis})` : ''} ✓` }
    return { ok: false, mark: '!', text: 'could not be verified — review carefully' }
  }

  /** Text for a Word comment on a proposed change: what, why, legal basis, check. */
  function commentText(s) {
    s = s || {}
    const basis = basisText(s.basis)
    const check = checkLine(s)
    return [
      `OpenLex: ${s.summary || 'proposed change'}`,
      basis ? `Legal basis: ${basis}` : '',
      check.ok ? check.text : `Not verified — review carefully${s.citationWarning ? ` (${s.citationWarning})` : ''}`,
    ].filter(Boolean).join('\n')
  }

  return { basedOn, basisText, checkLine, commentText }
})
