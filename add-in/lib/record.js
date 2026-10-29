/* OpenLex Word pane — the AI record: what the AI did, in plain words, to
 * show a client, a data protection officer or a bar auditor. One view
 * (opened from the menu, the "Your data" line or the matter overview)
 * with the summary line, filters, the entries (each expands for details)
 * and Export PDF / CSV / Check. Built from GET /api/record; never any
 * client content (the engine stores none in the record).
 * Here: the query, the summary line, entry rows and the export body.
 * No DOM. */
(function (root, factory) {
  const words = typeof require === 'function' ? require('./words.js') : root.OpenLexPane.words
  const m = factory(words)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).record = m
})(typeof self !== 'undefined' ? self : this, function (words) {
  'use strict'

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const DAY = /^\d{4}-\d{2}-\d{2}$/

  /**
   * The view's state → the query string for GET /api/record.
   * state: { matterId, from, to, left }  (dates as YYYY-MM-DD from <input type="date">)
   */
  function query(state, limit) {
    const s = state || {}
    const p = []
    if (s.matterId) p.push(['matterId', s.matterId])
    if (s.from && DAY.test(s.from)) p.push(['from', s.from])
    if (s.to && DAY.test(s.to)) p.push(['to', s.to])
    if (s.left) p.push(['left', '1'])
    p.push(['limit', String(limit || 100)])
    return '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  }

  /** Is the date range usable? '' when fine, else what to fix. */
  function rangeProblem(state) {
    const s = state || {}
    if (s.from && s.to && s.from > s.to) return 'The first date is after the second one.'
    return ''
  }

  /** The body for POST /api/record/export. */
  function exportBody(state, format) {
    const s = state || {}
    const b = { format: format === 'csv' ? 'csv' : format === 'md' ? 'md' : 'pdf' }
    if (s.matterId) b.matterId = s.matterId
    if (s.from && DAY.test(s.from)) b.from = s.from
    if (s.to && DAY.test(s.to)) b.to = s.to
    if (s.left) b.left = true
    return b
  }

  /** "12 requests · 3 sent to Claude (Anthropic, EU), names hidden · … · record intact ✓" */
  function summaryLine(r) {
    const text = (r && r.summary && r.summary.text) || 'Nothing recorded yet'
    const v = r && r.verify
    return v ? `${text} · ${v.ok ? 'record intact ✓' : 'record changed ✗'}` : text
  }

  /** "29 Oct 2026 14:02" in the pane's local time. */
  function when(iso) {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  /**
   * One entry as a row: { symbol, mark (words for screen readers), head, sub, lines }.
   * Symbol + words, never colour alone: ! = something left this computer.
   */
  function row(x) {
    const e = x || {}
    const failed = e.outcome === 'failed'
    const symbol = failed ? '✗' : e.left ? '!' : '✓'
    const mark = failed ? 'Did not finish.' : e.left ? 'Something left this computer.' : 'Stayed on this computer.'
    const sub = [when(e.at), e.window, e.matter].filter(Boolean).join(' · ')
    return { id: e.id, symbol, mark, left: !!e.left, head: words.clip(e.title || 'Entry', 140), sub, lines: Array.isArray(e.lines) ? e.lines.slice() : [] }
  }

  /** The check result in one sentence (and whether it is good news). */
  function verifyLine(v) {
    if (!v) return { ok: true, text: '' }
    return { ok: !!v.ok, text: `${v.ok ? '✓' : '✗'} ${v.text || ''}${v.fingerprint ? ` Fingerprint: ${v.fingerprint}` : ''}`.trim() }
  }

  /** The heading of the view. */
  function title(state, matterTitle) {
    return state && state.matterId ? `AI record${matterTitle ? ': ' + matterTitle : ''}` : 'AI record — all matters'
  }

  return { query, rangeProblem, exportBody, summaryLine, when, row, verifyLine, title }
})
