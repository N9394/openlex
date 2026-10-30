/* OpenLex Word pane — permission cards ("May OpenLex save … ?").
 * One sentence with the verb; "Allow once" is the default button, "Always"
 * is never the default; Escape means "Don't allow". No DOM. */
(function (root, factory) {
  const words = typeof require === 'function' ? require('./words.js') : root.OpenLexPane.words
  const m = factory(words)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).permission = m
})(typeof self !== 'undefined' ? self : this, function (words) {
  'use strict'

  const LABELS = { once: 'Allow once', always_matter: 'Always for this matter', always: 'Always', deny: 'Don\'t allow' }
  const ORDER = ['once', 'deny', 'always_matter', 'always']
  const DETAIL_WORDS = { path: 'File', url: 'Web address', command: 'Program', query: 'Search words', format: 'Format' }
  const RISK_WORDS = {
    'writes a file': 'It would save a file in your files folder.',
    'runs a command': 'It would run a program on this computer.',
    'sends data to the web': 'It would send search words or a web address to the internet.',
    'uses a connector': 'It would use one of your firm\'s connected systems.',
    'changes your calendar': 'It would change your calendar.',
  }

  /** "May OpenLex save obligations.csv in Acme/?" */
  function question(evt) {
    const e = evt || {}
    const what = String(e.summary || '').trim().replace(/[.?!]+$/, '')
    if (what) return `May OpenLex ${words.lowerFirst(what)}?`
    const t = String(e.title || '').replace(/^OpenLex wants to\s*/i, '').trim()
    return t ? `May OpenLex ${t}?` : 'May OpenLex go on with this step?'
  }

  /** The buttons, in order: [{ choice, label, primary, isDefault }]. */
  function buttons(evt) {
    const offered = (evt && Array.isArray(evt.choices) && evt.choices.length ? evt.choices : ['once', 'deny']).filter((c) => LABELS[c])
    return ORDER.filter((c) => offered.includes(c)).map((c) => ({ choice: c, label: LABELS[c], primary: c === 'once', isDefault: c === 'once' }))
  }

  /** "What exactly" rows: [{ label, value }] — at most 3, never a full content dump. */
  function details(evt) {
    const d = (evt && evt.detail) || {}
    return Object.keys(DETAIL_WORDS).filter((k) => d[k] !== undefined && d[k] !== '').slice(0, 3)
      .map((k) => ({ label: DETAIL_WORDS[k], value: words.clip(typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k]), 140) }))
  }

  /** The line under the question: what it would do and that nothing happens until answered. */
  function riskLine(evt) {
    const e = evt || {}
    // Prompt injection: why this is asked although a rule may allow it.
    const guard = [e.warning, e.caution].filter(Boolean).map((x) => String(x).trim()).join(' ')
    return `${guard ? guard + ' ' : ''}${RISK_WORDS[e.risk] || 'It would change something.'}${e.firmRule ? ' Your firm asks for confirmation here.' : ''} Nothing happens until you choose.`
  }

  /** What the card says once answered. */
  function outcome(choice, saved) {
    if (choice === 'deny') return 'Not allowed.'
    if (choice === 'once') return 'Allowed once.'
    return `Allowed from now on${choice === 'always_matter' ? ' for this matter' : ''}${saved ? ` (rule saved: ${saved})` : ''}.`
  }

  /** When the engine settled it (timeout, disconnect). */
  function settled(evt) {
    const e = evt || {}
    if (e.by === 'timeout') return 'No answer in time, so not allowed.'
    if (e.by === 'disconnect') return 'Stopped, so not allowed.'
    return e.decision === 'deny' ? 'Not allowed.' : 'Allowed.'
  }

  return { question, buttons, details, riskLine, outcome, settled, LABELS }
})
