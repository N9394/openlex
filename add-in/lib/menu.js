/* OpenLex Word pane — "What can I do here?": the one searchable menu that
 * holds every secondary action, so the pane itself stays one question box
 * and one main action. New features add an entry here, not a new panel.
 *
 * An entry: { id, label, hint, group, keywords, feature?, needs? }
 *   feature  hidden when the firm's openlex.json says "features": { <feature>: false }
 *   needs    hidden until the engine offers it (e.g. 'analyse', 'overview')
 * No DOM. */
(function (root, factory) {
  const m = factory()
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).menu = m
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const ENTRIES = [
    { id: 'review', group: 'This document', label: 'Review this contract', hint: 'Clause by clause, with changes and comments in the document', keywords: 'risk check analyse playbook redline', feature: 'review' },
    { id: 'analyse', group: 'This document', label: 'Analyse this document', hint: 'Parties, dates, obligations and risks at a glance', keywords: 'analysis summary overview facts', feature: 'analyse', needs: 'analyse' },
    { id: 'compare', group: 'This document', label: 'Compare with another version…', hint: 'Word marks every difference; OpenLex explains them', keywords: 'diff redline counterparty version', feature: 'compare' },
    { id: 'comments', group: 'This document', label: 'Answer the comments in this document', hint: 'Drafts a reply memo to the comments', keywords: 'comment digest response memo', feature: 'comments' },
    { id: 'obligations', group: 'This document', label: 'List the obligations', hint: 'Every "shall", "must", "undertakes to" as a checklist', keywords: 'obligation checklist duties shall', feature: 'obligations' },
    { id: 'xref', group: 'This document', label: 'Check cross-references', hint: 'Finds references to sections that do not exist', keywords: 'cross reference broken section numbering', feature: 'xref' },
    { id: 'outline', group: 'This document', label: 'Show the document outline', hint: 'Its parts; click one to read it', keywords: 'map structure headings sections toc', feature: 'outline' },
    { id: 'changes', group: 'This document', label: 'Proposed changes', hint: 'All changes OpenLex proposed, to accept or dismiss', keywords: 'suggestions list accept dismiss', feature: 'review' },
    { id: 'acceptAll', group: 'This document', label: 'Accept all tracked changes', hint: 'Same as Review → Accept All in Word', keywords: 'tracked changes accept', feature: 'review' },
    { id: 'rejectAll', group: 'This document', label: 'Reject all tracked changes', hint: 'Same as Review → Reject All in Word', keywords: 'tracked changes reject', feature: 'review' },

    { id: 'overview', group: 'This matter', label: 'Matter overview', hint: 'What is known about the matter so far', keywords: 'matter summary status recall', feature: 'overview', needs: 'overview' },
    { id: 'matterReview', group: 'This matter', label: 'Review every document in the matter', hint: 'Against a checklist; each finding quotes the document', keywords: 'workflow due diligence playbook all documents', feature: 'matterReview' },
    { id: 'chronology', group: 'This matter', label: 'Build a chronology', hint: 'Dated events from the matter\'s documents', keywords: 'timeline dates events', feature: 'chronology' },
    { id: 'translate', group: 'This matter', label: 'Translate a document', hint: 'Keeps numbers and your glossary', keywords: 'translation language', feature: 'translate' },
    { id: 'compareDocs', group: 'This matter', label: 'Compare two documents of the matter', hint: 'A Word file listing each change and how much it matters', keywords: 'diff versions', feature: 'compare' },
    { id: 'clauses', group: 'This matter', label: 'Find wording in your firm\'s clauses', hint: 'Your precedents, most used first', keywords: 'clause library precedent template insert', feature: 'clauses' },
    { id: 'record', group: 'This matter', label: 'AI record for this matter', hint: 'What the AI did, where it ran, what left this computer — to show a client', keywords: 'audit log record history data protection dpo gdpr export verify', feature: 'record', needs: 'record' },
    { id: 'recordAll', group: 'This matter', label: 'AI record — all matters', hint: 'The same for every matter, to export or check', keywords: 'audit log record history data protection dpo gdpr export verify', feature: 'record', needs: 'record' },
    { id: 'newMatter', group: 'This matter', label: 'Start a new matter', hint: 'Its own rules, folder and notes', keywords: 'matter create file client', feature: 'matters' },

    { id: 'settingsAI', group: 'Settings', label: 'Settings: which AI', hint: 'On this computer or an AI service', keywords: 'model provider key cloud local', feature: 'settings' },
    { id: 'settingsData', group: 'Settings', label: 'Settings: where client data may go', hint: 'Your client-data rule', keywords: 'policy privacy gdpr redact names eu', feature: 'settings' },
    { id: 'settingsLibrary', group: 'Settings', label: 'Settings: firm library', hint: 'Folders of precedents OpenLex may search', keywords: 'precedents folder index', feature: 'settings' },
    { id: 'settings', group: 'Settings', label: 'All settings', hint: 'Appearance, suggestions, your files folder, updates', keywords: 'preferences options theme language workspace', feature: 'settings' },
    { id: 'clear', group: 'Settings', label: 'Forget this conversation', hint: 'Clears what OpenLex remembers about this document\'s chat', keywords: 'clear reset memory', feature: 'settings' },
  ]

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  /** Is the entry allowed here? `features` = openlex.json features, `available` = engine capabilities. */
  function allowed(e, features, available) {
    if (e.feature && features && features[e.feature] === false) return false
    if (e.needs && !(available && available[e.needs])) return false
    return true
  }

  /**
   * The entries to show for a search, best first. Every word of the query
   * must appear in the label, hint or keywords; label matches rank first.
   */
  function search(query, opts) {
    const o = opts || {}
    const list = (o.entries || ENTRIES).filter((e) => allowed(e, o.features, o.available))
    const q = norm(query).split(/\s+/).filter(Boolean)
    if (!q.length) return list
    return list
      .map((e, i) => {
        const label = norm(e.label)
        const all = `${label} ${norm(e.hint)} ${norm(e.keywords)}`
        if (!q.every((w) => all.includes(w))) return null
        const score = q.reduce((n, w) => n + (label.startsWith(w) ? 3 : label.includes(w) ? 2 : 1), 0)
        return { e, i, score }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.e)
  }

  /** Entries grouped for display: [{ group, entries }]. */
  function grouped(list) {
    const out = []
    for (const e of list) {
      let g = out.find((x) => x.group === e.group)
      if (!g) { g = { group: e.group, entries: [] }; out.push(g) }
      g.entries.push(e)
    }
    return out
  }

  /** Next index for arrow keys, wrapping. */
  function move(index, delta, length) {
    if (!length) return -1
    return ((index + delta) % length + length) % length
  }

  return { ENTRIES, search, grouped, allowed, move }
})
