/* OpenLex Word pane — "Analyse this document" and "Matter overview".
 * Both use engine endpoints that arrive with a separate engine change
 * (POST /api/workflows/run { type: 'analyse' }, GET /api/matters/overview).
 * The pane feature-detects them: the menu entries stay hidden while the
 * engine answers 404 "not found", so the pane works before and after.
 * Here: the probe and the shapes, normalised for one summary-first card.
 * No DOM. */
(function (root, factory) {
  const words = typeof require === 'function' ? require('./words.js') : root.OpenLexPane.words
  const m = factory(words)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).matter = m
})(typeof self !== 'undefined' ? self : this, function (words) {
  'use strict'

  const SEV = ['high', 'medium', 'low']

  /**
   * Does the engine have this route? Only the engine's own catch-all
   * (404 + { error: 'not found', path }) — or a 404 that is not JSON —
   * means no; any other answer (400 for a made-up id, 404 "matter not
   * found", 200) means the route exists.
   */
  function routeExists(status, body) {
    if (status !== 404) return status > 0
    if (!body || typeof body !== 'object') return false
    return !(/^not found$/i.test(String(body.error || '').trim()) && 'path' in body)
  }

  const lawText = (l) => (!l ? '' : typeof l === 'string' ? l : [l.source || l.source_name || l.statute, l.section].filter(Boolean).join(' '))

  /** The `done` event of an analyse run → { summary, risks[], deadlines[], obligations[], parties[] }. */
  function analysis(done) {
    const d = done || {}
    const list = Array.isArray(d.analyses) ? d.analyses : []
    const risks = []
    const deadlines = []
    const obligations = []
    const parties = []
    for (const a of list) {
      for (const r of a.risks || []) {
        const loc = r.location || {}
        risks.push({
          severity: SEV.includes(r.severity) ? r.severity : 'low',
          why: String(r.why || r.summary || 'A risk'),
          fix: String(r.fix || ''),
          quote: String(r.quote || loc.text || ''),
          where: String(loc.text || ''),
          law: lawText(r.law),
          file: a.file || '',
        })
      }
      for (const x of a.deadlines || []) deadlines.push(typeof x === 'string' ? x : [x.date, x.text || x.what || x.event].filter(Boolean).join(' — '))
      for (const x of a.obligations || []) obligations.push(typeof x === 'string' ? x : [x.party || x.who, x.text || x.what].filter(Boolean).join(': '))
      for (const x of a.parties || []) parties.push(typeof x === 'string' ? x : [x.name, x.role].filter(Boolean).join(' — '))
    }
    risks.sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity))
    return { summary: String(d.summary || ''), risks, deadlines, obligations, parties }
  }

  /** "2 high risks, 1 medium · 3 deadlines · 4 parties". */
  function analysisLine(a) {
    const c = { high: 0, medium: 0, low: 0 }
    for (const r of a.risks) c[r.severity]++
    const risk = SEV.filter((s) => c[s]).map((s, i) => (i === 0 ? `${c[s]} ${s} risk${c[s] === 1 ? '' : 's'}` : `${c[s]} ${s}`)).join(', ') || 'No risks found'
    return [risk, a.deadlines.length ? words.plural(a.deadlines.length, 'deadline') : '', a.parties.length ? words.plural(a.parties.length, 'party', 'parties') : ''].filter(Boolean).join(' · ')
  }

  /**
   * A risk's fix as a suggestion for the normal apply path (tracked change).
   * Only when there is replacement wording and a quote to anchor it.
   */
  function riskSuggestion(r, i) {
    if (!r.fix || r.fix.length < 20 || !r.quote) return null
    return { id: `risk-${i}`, summary: r.why, severity: r.severity, anchor: { text: r.quote }, proposed_text: r.fix, basis: r.law ? { source: r.law } : null }
  }

  const CARDS = [['summary', 'Summary'], ['findings', 'Findings'], ['deadlines', 'Deadlines'], ['decisions', 'Decisions'], ['openQuestions', 'Open questions'], ['documents', 'Documents'], ['notes', 'Notes'], ['sources', 'Sources'], ['activity', 'Recent work']]

  const itemText = (x) => (typeof x === 'string' ? x : String(x.text || x.title || x.summary || x.question || x.name || x.event || x.what || ''))

  /** GET /api/matters/overview → [{ key, title, items: [{ text, from, at }] }] with empty cards dropped. */
  function overview(json) {
    const toItems = (v) => (Array.isArray(v) ? v : [v]).map((x) => ({ text: words.clip(itemText(x), 300), from: (x && x.from) || null, at: (x && x.at) || '' })).filter((x) => x.text)
    // The engine sends `cards` as a list ({ id, title, items }); keep the keyed form working too.
    if (json && Array.isArray(json.cards)) {
      return json.cards.map((c) => ({ key: c.id || c.key, title: c.title || c.id, items: toItems(c.items || []), more: c.more || 0, link: c.link || null })).filter((c) => c.items.length)
    }
    const o = (json && (json.overview || json.cards || json)) || {}
    const out = []
    for (const [key, title] of CARDS) {
      const v = o[key]
      if (v == null) continue
      const items = toItems(v)
      if (items.length) out.push({ key, title, items })
    }
    return out
  }

  /** "From: contract.docx, clause 4" for an overview item. */
  function fromLine(from) {
    if (!from) return ''
    return [from.file, from.location && (from.location.text || from.location)].filter((x) => typeof x === 'string' && x).map((x) => words.clip(x, 60)).join(', ')
  }

  return { routeExists, analysis, analysisLine, riskSuggestion, overview, fromLine }
})
