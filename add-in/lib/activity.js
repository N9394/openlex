/* OpenLex Word pane — the live activity of one request.
 * Folds engine events into a small state; view() says what to show:
 * while working ≤3 recent steps (the current one marked), when finished
 * one line ("✓ Done in 12 s · 6 steps"). Sentences come from the engine
 * (`plain` on step events); an older engine without `plain` gets a
 * general sentence, never the raw event text. No DOM. */
(function (root, factory) {
  const req = typeof require === 'function'
  const words = req ? require('./words.js') : root.OpenLexPane.words
  const dataline = req ? require('./dataline.js') : root.OpenLexPane.dataline
  const m = factory(words, dataline)
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).activity = m
})(typeof self !== 'undefined' ? self : this, function (words, dataline) {
  'use strict'

  const GENERIC = 'Working on your question'
  const MAX_REASONING = 4000

  function start(now) {
    return {
      startedAt: now, endedAt: null,
      steps: [{ text: 'Working out how to answer', status: 'now', at: now }],
      models: [], online: [], sources: [], clauses: [], notes: [],
      suggestions: 0, stopped: false, failed: false, waiting: null, reasoning: '', answerWords: 0,
    }
  }

  const clone = (a) => Object.assign({}, a, { steps: a.steps.map((s) => Object.assign({}, s)), online: a.online.slice(), sources: a.sources.slice(), clauses: a.clauses.slice(), notes: a.notes.slice(), models: a.models.slice() })
  const current = (a) => { for (let i = a.steps.length - 1; i >= 0; i--) if (a.steps[i].status === 'now') return a.steps[i]; return null }

  function push(a, text, now, extra) {
    const cur = current(a)
    if (cur && cur.text === text) { Object.assign(cur, extra || {}); return }
    if (cur) { cur.status = cur.failed ? 'failed' : 'done'; cur.end = now }
    a.steps.push(Object.assign({ text, status: 'now', at: now }, extra || {}))
  }

  function finish(a, now) {
    for (const s of a.steps) if (s.status === 'now') { s.status = s.failed ? 'failed' : 'done'; s.end = now }
    a.endedAt = a.endedAt || now
  }

  /** Fold one engine event into the activity (returns a new object). */
  function apply(act, ev, now) {
    if (!ev || !ev.type) return act
    const a = clone(act)
    switch (ev.type) {
      case 'step': {
        if (ev.quiet) return act
        const text = typeof ev.plain === 'string' && ev.plain ? ev.plain : GENERIC
        if (ev.online && ev.onlineTo && !a.online.includes(ev.onlineTo)) a.online.push(ev.onlineTo)
        const c = ev.detail && ev.detail.clause
        if (c && !a.clauses.some((x) => x.index === c.index && x.heading === c.heading)) a.clauses.push({ index: c.index, heading: c.heading || '' })
        push(a, text, now, Object.assign(ev.failed ? { failed: true } : {}, ev.kind === 'writing' || ev.kind === 'retry' ? { phase: 'writing' } : {}))
        return a
      }
      case 'text': {
        const cur = current(a)
        if (!cur || cur.phase !== 'writing') push(a, 'Writing the answer', now, { phase: 'writing' })
        a.answerWords += String(ev.text || '').split(/\s+/).filter(Boolean).length
        return a
      }
      case 'reasoning':
        a.reasoning = (a.reasoning + (ev.streaming ? '' : '\n') + String(ev.text || '')).slice(-MAX_REASONING)
        return a
      case 'law':
        for (const s of ev.sources || []) {
          if (!s) continue
          if (!a.sources.some((x) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section))) a.sources.push(s)
        }
        return a
      case 'note':
        if (ev.claim || ev.entity) a.notes.push({ entity: ev.entity || '', claim: ev.claim || '', section: ev.section == null ? '' : ev.section })
        return a
      case 'model': a.models = dataline.addModel(a.models, ev); return a
      case 'suggestion': a.suggestions++; return a
      case 'skill': push(a, `Following your firm's instructions “${words.clip(ev.title || ev.name, 40)}”`, now); return a
      case 'agent': push(a, `Working as “${words.clip(ev.title || ev.name, 40)}”`, now); return a
      case 'compact': push(a, 'Tidying up its notes so far (your document is kept)', now); return a
      case 'permission':
        a.waiting = ev.summary || 'a step'
        push(a, `Waiting for your answer: ${words.clip(ev.summary || 'may OpenLex go on?', 60)}`, now, { phase: 'ask' })
        return a
      case 'permission_result': {
        a.waiting = null
        const cur = current(a)
        if (cur && cur.phase === 'ask') {
          const what = cur.text.replace(/^Waiting for your answer: /, '')
          cur.text = ev.decision === 'deny' ? `Not allowed: ${what}` : `Allowed: ${what}`
          cur.status = ev.decision === 'deny' ? 'failed' : 'done'
          cur.end = now
        }
        return a
      }
      case 'warning': push(a, `Note: ${words.clip(ev.message, 80)}`, now); return a
      case 'withheld': push(a, 'Your firm\'s rules held this answer back', now, { failed: true }); finish(a, now); return a
      case 'error':
        if (ev.recoverable) { push(a, 'One part could not be finished; going on with the rest', now, { failed: true }); return a }
        a.failed = true; finish(a, now); return a
      case 'done': if (ev.stopped) a.stopped = true; finish(a, now); return a
      default: return act
    }
  }

  /** The user pressed Stop (the stream may not say so itself). */
  function stop(act, now) { const a = clone(act); a.stopped = true; finish(a, now); return a }

  /**
   * What to show: { running, steps: [{ text, status, current, mark }],
   * earlier, summary, label }. `mark` is a symbol so status never relies
   * on colour: ✓ done · ▸ now · ! failed.
   */
  function view(act, opts) {
    const now = (opts && opts.now) || act.endedAt || act.startedAt
    const max = (opts && opts.maxSteps) || 3
    const running = !act.endedAt
    const n = act.steps.length
    const took = words.duration((act.endedAt || now) - act.startedAt)
    const mark = (s) => (s === 'done' ? '✓' : s === 'failed' ? '!' : '▸')
    const from = running ? Math.max(n - max, 0) : n
    const steps = act.steps.slice(from).map((s) => ({ text: s.text, status: s.status, current: s.status === 'now', mark: mark(s.status) }))
    const summary = running ? '' : act.stopped ? `⏹ Stopped after ${took}` : act.failed ? `! Ended early after ${took}` : `✓ Done in ${took} · ${words.plural(n, 'step')}`
    return { running, steps, earlier: running ? from : 0, summary, label: running ? `Working… ${took} so far` : summary }
  }

  /** Every step, for the expanded "what OpenLex did" list after it finished. */
  function allSteps(act) {
    return act.steps.map((s) => ({ text: s.text, status: s.status, mark: s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : '▸', took: s.end ? words.duration(s.end - s.at) : '' }))
  }

  /** The Stop explained: what was kept, and that nothing more is sent. */
  function stopSentence(act) {
    const kept = [
      act.answerWords ? `the answer so far (${words.plural(act.answerWords, 'word')})` : '',
      act.sources.length ? words.plural(act.sources.length, 'law section') + ' it found' : '',
      act.suggestions ? words.plural(act.suggestions, 'proposed change') : '',
    ].filter(Boolean)
    return `Stopped by you. ${kept.length ? `Kept: ${kept.join(', ')}.` : 'Nothing was written yet.'} Nothing more is sent or saved.`
  }

  return { start, apply, stop, view, allSteps, stopSentence, GENERIC }
})
