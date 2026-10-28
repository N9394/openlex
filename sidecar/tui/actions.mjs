/**
 * Larger pieces of work on a matter: checklist review, chronology,
 * translation, comparison, review grid, and a plan the lawyer approves
 * step by step. Each one: a few plain questions, progress while it runs,
 * then the result files with an option to open them.
 */

import path from 'node:path'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { friendly, log } from './api.mjs'
import { shortPath } from './paths.mjs'
import { ACTIONS } from './matter.mjs'
import { PermissionPrompt, answeredLine } from './permission.mjs'

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
  const [progress, setProgress] = useState([]) // lines
  const [count, setCount] = useState('')
  const [result, setResult] = useState(null) // { files, summary }
  const [error, setError] = useState('')
  const [plan, setPlan] = useState(null)
  const [waiting, setWaiting] = useState(null)
  const [opened, setOpened] = useState('')
  const [perm, setPerm] = useState(null) // "may OpenLex …?" while a plan step runs
  const abort = useRef(null)

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

  const fail = (err) => { log(`${kind} failed:`, err); setError(err.message ? err.message : friendly(err)); setStep('failed') }
  const line = (t) => setProgress((p) => [...p.slice(-30), t])

  useInput((_, k) => {
    if (!k.escape || perm) return
    if (step === 'running') { abort.current?.abort(); return }
    ctx.back()
  })

  /** Run a workflow (review, chronology, translate, compare) with progress. */
  const runWorkflow = async (body) => {
    setStep('running')
    const ac = new AbortController()
    abort.current = ac
    let done = null
    let failed = ''
    try {
      await ctx.api.runWorkflow({ ...body, matterId }, (ev) => {
        if (ev.type === 'progress') {
          if (ev.total) setCount(`${ev.index || 0} of ${ev.total}`)
          if (ev.name) line(`${ev.step === 'translate' ? 'Translating' : ev.step === 'rate' ? 'Rating changes' : 'Reading'} ${ev.name}`)
        } else if (ev.type === 'error') failed = friendly(ev.message)
        else if (ev.type === 'done') done = ev
      }, ac.signal)
      if (ac.signal.aborted) return ctx.back()
      if (failed) throw new Error(failed)
      if (!done) throw new Error('The work stopped before it finished. See the log file for details.')
      setResult({ files: done.files || [], summary: describeStats(done.stats) })
      setStep('done')
    } catch (err) { fail(err) }
  }

  const runGrid = async () => {
    setStep('running')
    try {
      const g = await ctx.api.createGrid({ matterId, title: choice.title || 'Review grid', columns: questions.map((q) => ({ label: q.length > 40 ? `${q.slice(0, 37)}…` : q, prompt: q, type: 'text' })) })
      setCount(`${g.rows?.length || 0} documents × ${questions.length} questions`)
      const ac = new AbortController()
      abort.current = ac
      let stats = null
      let failed = ''
      await ctx.api.runGrid(g.id, (ev) => {
        if (ev.type === 'progress' && ev.step === 'cell') line(`${ev.document} ${sym.sep} ${ev.column}: ${ev.status === 'ok' ? ev.value : ev.status === 'not_found' ? 'not found' : 'check'}`)
        else if (ev.type === 'error') failed = friendly(ev.message)
        else if (ev.type === 'done') stats = ev.stats
      }, ac.signal)
      if (ac.signal.aborted) return ctx.back()
      if (failed) throw new Error(failed)
      const ex = await ctx.api.exportGrid(g.id)
      setResult({ files: ex.files || [], summary: describeStats(stats) })
      setStep('done')
    } catch (err) { fail(err) }
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
    setStep('running')
    const ac = new AbortController()
    abort.current = ac
    let done = null
    let failed = ''
    try {
      await ctx.api.runPlan(id, (ev) => {
        if (ev.type === 'progress' && ev.status) line(`${ev.title || ev.step}: ${ev.status}${ev.summary ? ` — ${ev.summary}` : ''}${ev.error ? ` — ${friendly(ev.error)}` : ''}`)
        else if (ev.type === 'permission') setPerm(ev)
        else if (ev.type === 'permission_result' && ev.by !== 'lawyer') setPerm((p) => { if (p?.id === ev.id) line(`No answer in time, so not allowed: ${p.summary}`); return p?.id === ev.id ? null : p })
        else if (ev.type === 'error') failed = friendly(ev.message)
        else if (ev.type === 'done') done = ev
      }, ac.signal)
      setPerm(null)
      if (ac.signal.aborted) return ctx.back()
      if (failed) throw new Error(failed)
      if (done?.status === 'waiting' && done.waiting) { setWaiting(done.waiting); return setStep('checkpoint') }
      const full = await ctx.api.getPlan(id).catch(() => null)
      const files = [done?.report, ...((full?.plan?.steps || []).flatMap((s) => s.result?.files || []))].filter(Boolean)
      setResult({ files, summary: done?.status === 'done' ? 'All steps done.' : `Finished: ${done?.status || 'stopped'}.` })
      setStep('done')
    } catch (err) { fail(err) }
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
      ${progress.slice(-6).map((p, i) => html`<${Text} key=${i} dimColor wrap="truncate-end">${p}<//>`)}
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
    keys = `Esc stop ${sym.sep} Ctrl+C quit`
    body = html`<${Box} flexDirection="column">
      <${Spinner} label=${`Working${count ? ` — ${count}` : ''}…`} />
      ${progress.slice(-8).map((p, i) => html`<${Text} key=${i} dimColor wrap="truncate-end">  ${p}<//>`)}
    <//>`
  } else if (step === 'done' && result) {
    const items = [
      ...result.files.map((f) => ({ value: f, label: `Open ${path.basename(f)}` })),
      ...(result.files.length ? [{ value: 'folder', label: 'Open the folder' }] : []),
      { value: 'back', label: 'Back to the matter' },
    ]
    body = html`<${Box} flexDirection="column">
      <${Note} kind="ok">Done.${result.summary ? ` ${result.summary}` : ''}<//>
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
