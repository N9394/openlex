/**
 * Larger pieces of work on a matter: checklist review, chronology,
 * translation, comparison, review grid, and a plan the lawyer approves
 * step by step. Each one: a few plain questions, progress while it runs
 * ("Document 3 of 12 · about 2 minutes left", each document ✓ done /
 * ▸ now / waiting, where the data went, how to stop — explain.mjs), then
 * the result files with an option to open them.
 */

import path from 'node:path'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym, useSize } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { friendly, log } from './api.mjs'
import { shortPath } from './paths.mjs'
import { ACTIONS } from './matter.mjs'
import { PermissionPrompt, answeredLine } from './permission.mjs'
import { clock, startWork, applyProgress, workLines, dataLine, dataSegs, duration } from './explain.mjs'

const TITLES = { review: 'Checklist review', chronology: 'Chronology', translate: 'Translation', compare: 'Compare two versions', grid: 'Review grid', plan: 'Plan a larger task' }

/** Plain words for the workflow's numbers ("documents: 4 · verified: 12"). */
const STAT_WORDS = { documents: 'documents', verified: 'findings (each quoted)', unverified: 'left out (quote not found)', events: 'dated events', changes: 'changes', flags: 'points to check', cells: 'answers', filled: 'answers', paragraphs: 'paragraphs' }
const describeStats = (stats) => Object.entries(stats || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${v} ${STAT_WORDS[k] || k}`).join(` ${sym.sep} `)

export function Action({ kind, matterId }) {
  const ctx = useAppCtx()
  const [matter, setMatter] = useState(null)
  const [step, setStep] = useState('loading') // loading | ask… | running | done | failed | plan-review | checkpoint
  const [docs, setDocs] = useState([])
  const [langs, setLangs] = useState({})
  const [playbooks, setPlaybooks] = useState([])
  const [choice, setChoice] = useState({})
  const [input, setInput] = useState('')
  const [questions, setQuestions] = useState([])
  const [progress, setProgress] = useState([]) // lines (plan answers, permission answers)
  const [work, setWork] = useState(null) // progress of the running work (explain.mjs)
  const [now, setNow] = useState(clock.now())
  const [result, setResult] = useState(null) // { files, summary }
  const [error, setError] = useState('')
  const [plan, setPlan] = useState(null)
  const [waiting, setWaiting] = useState(null)
  const [opened, setOpened] = useState('')
  const [perm, setPerm] = useState(null) // "may OpenLex …?" while a plan step runs
  const abort = useRef(null)
  const { cols, rows } = useSize()

  useEffect(() => {
    (async () => {
      try {
        const [m, d] = await Promise.all([ctx.api.matters(), ctx.api.documents(matterId)])
        setMatter((m.matters || []).find((x) => x.id === matterId) || null)
        setDocs(d.documents || [])
        setLangs(d.languages || {})
        if (kind === 'review') setPlaybooks((await ctx.api.playbooks()).playbooks || [])
        setStep('ask')
      } catch (err) { fail(err) }
    })()
    return () => abort.current?.abort()
  }, [])

  useEffect(() => {
    if (step !== 'running') return undefined
    const t = setInterval(() => setNow(clock.now()), 1000)
    return () => clearInterval(t)
  }, [step])
  const track = (ev) => { const at = clock.now(); setWork((w) => (w ? applyProgress(w, ev, at) : w)) }
  /** Esc while it runs: say what was kept, instead of just leaving. */
  const stopped = () => {
    setWork((w) => {
      const done = w?.done || 0
      const unit = kind === 'plan' ? 'step' : kind === 'translate' ? 'part' : 'document'
      setResult({ files: [], stopped: true, summary: `Stopped by you after ${done} of ${w?.total || '?'} ${unit}${(w?.total || 0) === 1 ? '' : 's'}. ${kind === 'plan' ? 'Finished steps keep their results.' : 'What was done so far is saved in the matter folder.'} Nothing more is sent.` })
      return w ? { ...w, endedAt: clock.now() } : w
    })
    setStep('done')
  }

  const fail = (err) => { log(`${kind} failed:`, err); setError(err.message ? err.message : friendly(err)); setStep('failed') }
  const line = (t) => setProgress((p) => [...p.slice(-30), t])

  useInput((_, k) => {
    if (!k.escape || perm) return
    if (step === 'running') { abort.current?.abort(); return }
    ctx.back()
  })

  /** Run a workflow (review, chronology, translate, compare) with progress. */
  const runWorkflow = async (body) => {
    setWork(startWork(body.type, ['review', 'chronology'].includes(body.type) ? docs.map((d) => d.name) : []))
    setNow(clock.now())
    setStep('running')
    const ac = new AbortController()
    abort.current = ac
    let done = null
    let failed = ''
    try {
      await ctx.api.runWorkflow({ ...body, matterId }, (ev) => {
        track(ev)
        if (ev.type === 'error') failed = friendly(ev.message)
        else if (ev.type === 'done') done = ev
      }, ac.signal)
      if (ac.signal.aborted) return stopped()
      if (failed) throw new Error(failed)
      if (!done) throw new Error('The work stopped before it finished. See the log file for details.')
      setResult({ files: done.files || [], summary: describeStats(done.stats) })
      setStep('done')
    } catch (err) { if (ac.signal.aborted) stopped(); else fail(err) }
  }

  const runGrid = async () => {
    setStep('running')
    const ac = new AbortController()
    abort.current = ac
    try {
      const g = await ctx.api.createGrid({ matterId, title: choice.title || 'Review grid', columns: questions.map((q) => ({ label: q.length > 40 ? `${q.slice(0, 37)}…` : q, prompt: q, type: 'text' })) })
      const names = docs.map((d) => d.name)
      setWork({ ...startWork('grid', names), items: names.map((n, i) => ({ name: n, status: i ? 'waiting' : 'now', at: clock.now() })) })
      setNow(clock.now())
      let stats = null
      let failed = ''
      await ctx.api.runGrid(g.id, (ev) => {
        track(ev)
        if (ev.type === 'error') failed = friendly(ev.message)
        else if (ev.type === 'done') stats = ev.stats
      }, ac.signal)
      if (ac.signal.aborted) return stopped()
      if (failed) throw new Error(failed)
      const ex = await ctx.api.exportGrid(g.id)
      setResult({ files: ex.files || [], summary: describeStats(stats) })
      setStep('done')
    } catch (err) { if (ac.signal.aborted) stopped(); else fail(err) }
  }

  const proposePlan = async (goal) => {
    setStep('planning')
    try {
      const r = await ctx.api.proposePlan(goal, matterId)
      setPlan(r.plan)
      setStep('plan-review')
    } catch (err) { fail(err) }
  }

  const runPlan = async (id) => {
    // Steps already finished (after a pause) count as done.
    setWork((w) => w || { ...startWork('plan', []), items: (plan?.steps || []).map((s) => ({ id: s.id, name: s.kind === 'checkpoint' ? 'Pause: you decide' : s.title, status: s.status === 'done' ? 'done' : 'waiting' })), total: plan?.steps?.length || 0, done: (plan?.steps || []).filter((s) => s.status === 'done').length })
    setWork((w) => ({ ...w, endedAt: null, note: '' }))
    setNow(clock.now())
    setStep('running')
    const ac = new AbortController()
    abort.current = ac
    let done = null
    let failed = ''
    try {
      await ctx.api.runPlan(id, (ev) => {
        track(ev)
        if (ev.type === 'progress' && ev.status === 'failed') line(`${ev.title || 'A step'} did not finish: ${friendly(ev.error)}`)
        else if (ev.type === 'permission') setPerm(ev)
        else if (ev.type === 'permission_result' && ev.by !== 'lawyer') setPerm((p) => { if (p?.id === ev.id) line(`No answer in time, so not allowed: ${p.summary}`); return p?.id === ev.id ? null : p })
        else if (ev.type === 'error') failed = friendly(ev.message)
        else if (ev.type === 'done') done = ev
      }, ac.signal)
      setPerm(null)
      if (ac.signal.aborted) return stopped()
      if (failed) throw new Error(failed)
      if (done?.status === 'waiting' && done.waiting) { setWaiting(done.waiting); return setStep('checkpoint') }
      const full = await ctx.api.getPlan(id).catch(() => null)
      const files = [done?.report, ...((full?.plan?.steps || []).flatMap((s) => s.result?.files || []))].filter(Boolean)
      setResult({ files, summary: done?.status === 'done' ? 'All steps done.' : done?.status === 'failed' ? 'Some steps did not finish (see above).' : 'Stopped before the end.' })
      setStep('done')
    } catch (err) { if (ac.signal.aborted) stopped(); else fail(err) }
  }

  const docItems = docs.map((d) => ({ value: d.path, label: d.name, hint: shortPath(path.dirname(d.path)) }))
  const noDocs = !docs.length && kind !== 'plan'
  let body
  let keys

  if (step === 'loading') body = html`<${Spinner} label="Getting ready…" />`
  else if (step === 'failed') {
    body = html`<${Box} flexDirection="column">
      <${Note} kind="bad">${error}<//>
      <${Text} dimColor>Esc to go back. Details are in ~/.lexvault/logs/tui.log.<//>
    <//>`
  } else if (step === 'ask' && noDocs) {
    body = html`<${Note} kind="warn">This matter has no documents yet. Go back and choose "Add documents" first.<//>`
  } else if (step === 'ask') {
    if (kind === 'review') {
      body = html`<${Field} label="Which checklist?" help=${`${docs.length} documents will be checked. Each finding is kept only if its quote is really in the document.`}>
        <${Menu} items=${playbooks.map((p) => ({ value: p.name, label: p.title, hint: p.checks ? `${p.checks} points${p.firm ? ' · your firm' : ''}` : '' }))} onSelect=${(it) => runWorkflow({ type: 'review', playbook: it.value || undefined })} />
      <//>`
    } else if (kind === 'chronology') {
      body = html`<${Field} label=${`Build a chronology from ${docs.length} document${docs.length === 1 ? '' : 's'}?`} help="Every dated event, with the date checked against the quote it comes from. Saved as Excel and Word.">
        <${Menu} items=${[{ value: 'go', label: 'Start' }, { value: 'back', label: 'Back' }]} onSelect=${(it) => (it.value === 'go' ? runWorkflow({ type: 'chronology' }) : ctx.back())} />
      <//>`
    } else if (kind === 'translate') {
      body = !choice.file
        ? html`<${Field} label="Which document?"><${Menu} items=${docItems} onSelect=${(it) => setChoice({ file: it.value })} /><//>`
        : html`<${Field} label=${`Translate ${path.basename(choice.file)} into…`}>
            <${Menu} items=${Object.entries(langs).map(([v, label]) => ({ value: v, label }))} onSelect=${(it) => runWorkflow({ type: 'translate', file: choice.file, target: it.value })} />
          <//>`
    } else if (kind === 'compare') {
      body = !choice.fileA
        ? html`<${Field} label="Which is the OLDER version?"><${Menu} items=${docItems} onSelect=${(it) => setChoice({ fileA: it.value })} /><//>`
        : html`<${Field} label="Which is the NEWER version?" help=${`Older: ${path.basename(choice.fileA)}`}>
            <${Menu} items=${docItems.filter((d) => d.value !== choice.fileA)} onSelect=${(it) => runWorkflow({ type: 'compare', fileA: choice.fileA, fileB: it.value, rate: true })} />
          <//>`
    } else if (kind === 'grid') {
      keys = `Enter add ${sym.sep} Enter on an empty line: start ${sym.sep} Esc back`
      body = html`<${Box} flexDirection="column">
        <${Text} wrap="wrap">Type one question at a time; each becomes a column, asked of all ${docs.length} documents. Press Enter on an empty line to start.<//>
        ${questions.slice(-8).map((q, i) => html`<${Text} key=${i} wrap="truncate-end">  ${Math.max(questions.length - 8, 0) + i + 1}. ${q}<//>`)}
        <${Box} marginTop=${1}>
          <${TextField} value=${input} onChange=${setInput} placeholder=${questions.length ? 'Another question, or Enter to start' : 'e.g. Who may terminate, and with what notice?'} onSubmit=${(v) => {
            const t = v.trim()
            if (t) { setQuestions([...questions, t]); return setInput('') }
            if (questions.length) runGrid()
          }} />
        <//>
      <//>`
    } else if (kind === 'plan') {
      keys = `Enter continue ${sym.sep} Esc back`
      body = html`<${Field} label="What should be done?" help="Describe the goal in your own words. OpenLex proposes the steps; nothing runs until you approve them.">
        <${TextField} value=${input} onChange=${setInput} placeholder="e.g. Due diligence of the lease agreements: risks, deadlines, a summary memo" onSubmit=${(v) => v.trim() && proposePlan(v.trim())} />
      <//>`
    }
  } else if (step === 'planning') body = html`<${Spinner} label="OpenLex is planning the steps…" />`
  else if (step === 'plan-review' && plan) {
    body = html`<${Box} flexDirection="column">
      <${Text} bold wrap="wrap">${plan.goal}<//>
      <${Text} dimColor wrap="wrap">What OpenLex will do, in this order:<//>
      ${plan.steps.slice(0, 9).map((s, i) => html`<${Text} key=${s.id} wrap="truncate-end">  ${i + 1}. ${s.kind === 'checkpoint' ? `Pause: you decide — ${s.args?.question || ''}` : s.title}<//>`)}
      ${plan.steps.length > 9 ? html`<${Text} dimColor>  … and ${plan.steps.length - 9} more steps<//>` : null}
      ${(plan.notes || []).slice(0, 2).map((n, i) => html`<${Text} key=${`n${i}`} dimColor wrap="truncate-end">${n}<//>`)}
      <${Box} marginTop=${1}>
        <${Menu} items=${[{ value: 'go', label: 'Approve and run' }, { value: 'back', label: 'Cancel' }]} onSelect=${async (it) => {
          if (it.value === 'back') return ctx.back()
          try { await ctx.api.approvePlan(plan.id) } catch (err) { return fail(err) }
          runPlan(plan.id)
        }} />
      <//>
    <//>`
  } else if (step === 'checkpoint' && waiting) {
    body = html`<${Box} flexDirection="column">
      ${work ? html`<${Text} dimColor wrap="truncate-end">${work.done} of ${work.total} steps done ${sym.sep} ${dataLine(work.models, work.online).text}<//>` : null}
      ${progress.slice(-4).map((p, i) => html`<${Text} key=${i} dimColor wrap="truncate-end">${p}<//>`)}
      <${Box} marginTop=${1}><${Field} label=${waiting.args?.question || 'Continue with the next steps?'}>
        <${Menu} items=${[{ value: 'continue', label: 'Continue' }, { value: 'stop', label: 'Stop here (a report is written)' }]} onSelect=${async (it) => {
          try { await ctx.api.decidePlan(plan.id, waiting.id, it.value) } catch (err) { return fail(err) }
          runPlan(plan.id)
        }} />
      <//><//>
    <//>`
  } else if (step === 'running' && perm) {
    keys = `Enter choose ${sym.sep} ${perm.choices?.includes('always_matter') ? `a always (this matter) ${sym.sep} ` : ''}${perm.choices?.includes('always') ? `A always ${sym.sep} ` : ''}n or Esc don't allow`
    body = html`<${Box} flexDirection="column">
      ${progress.slice(-3).map((p, i) => html`<${Text} key=${i} dimColor wrap="truncate-end">  ${p}<//>`)}
      <${PermissionPrompt} key=${perm.id} req=${perm} onAnswer=${async (d) => {
        try { const r = await ctx.api.answerPermission(perm.id, d); line(answeredLine(perm, d, r?.saved)) } catch (err) { line(err.message) }
        setPerm((p) => (p?.id === perm.id ? null : p))
      }} />
    <//>`
  } else if (step === 'running') {
    keys = `Esc stop ${sym.sep} ${kind === 'plan' ? 'finished steps keep their results' : 'what is done so far is kept'} ${sym.sep} Ctrl+C quit`
    const lines = work ? workLines(work, { now, width: Math.max(cols - 2, 20), maxItems: Math.max(rows - 18, 3), stopHint: kind === 'plan' ? 'finished steps keep their results' : 'what is done so far is saved in the matter folder' }) : []
    body = html`<${Box} flexDirection="column">
      <${Spinner} label=${`${TITLES[kind] || 'Working'}${docs.length && kind !== 'plan' && kind !== 'translate' && kind !== 'compare' ? ` of ${docs.length} document${docs.length === 1 ? '' : 's'}` : ''}…`} />
      ${lines.map((l, i) => html`<${Text} key=${i} wrap="truncate-end">${l.map((g, k) => html`<${Text} key=${k} dimColor=${!!g.dim} bold=${!!g.bold} color=${g.color}>${g.t}<//>`)}<//>`)}
      ${progress.slice(-2).map((p, i) => html`<${Text} key=${`p${i}`} dimColor wrap="truncate-end">  ${p}<//>`)}
    <//>`
  } else if (step === 'done' && result) {
    const items = [
      ...result.files.map((f) => ({ value: f, label: `Open ${path.basename(f)}` })),
      ...(result.files.length ? [{ value: 'folder', label: 'Open the folder' }] : []),
      { value: 'back', label: 'Back to the matter' },
    ]
    const data = work ? dataLine(work.models, work.online) : null
    body = html`<${Box} flexDirection="column">
      ${result.stopped ? html`<${Note} kind="warn">${result.summary}<//>` : html`<${Note} kind="ok">Done${work ? ` in ${duration((work.endedAt || clock.now()) - work.startedAt)}` : ''}.${result.summary ? ` ${result.summary}` : ''}<//>`}
      ${data ? html`<${Text} wrap="wrap">${dataSegs(data).map((g, k) => html`<${Text} key=${k} bold=${!!g.bold} color=${g.color}>${g.t}<//>`)}<//>` : null}
      ${result.files.length ? html`<${Text} dimColor wrap="truncate-middle">Saved in ${shortPath(path.dirname(result.files[0]))}<//>` : null}
      ${opened ? html`<${Text} dimColor>${opened}<//>` : null}
      <${Box} marginTop=${1}>
        <${Menu} items=${items} onSelect=${async (it) => {
          if (it.value === 'back') return ctx.back()
          const target = it.value === 'folder' ? path.dirname(result.files[0]) : it.value
          try { await ctx.api.openPath(target); setOpened(`Opened ${path.basename(target)}`) } catch (err) { log('open failed:', err); setOpened(`Could not open it here — the file is at ${shortPath(target)}`) }
        }} />
      <//>
    <//>`
  }

  const label = ACTIONS.find((a) => a.value === kind)?.label
  return html`<${Frame} title=${TITLES[kind] || label || 'Action'} subtitle=${matter?.title || ''} status=${ctx.status(matter)} keys=${keys}>${body}<//>`
}
