/**
 * Home: the lawyer's matters, "New matter" (N) and "Quick question" (Q),
 * "/" filters the list. With no matters yet, one sentence and one thing to
 * do. Started in a folder, the folder and its documents are named.
 */

import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym, color, fitPath, useSize } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { nameOf } from './api.mjs'

/** "Today", "3 Oct" — when a matter was last used (if the engine says). */
function lastUsed(m) {
  const t = m.updatedAt || m.lastUsed || m.createdAt
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.round((Date.now() - d.getTime()) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`
}

export function Home({ note = null }) {
  const ctx = useAppCtx()
  const { cols } = useSize()
  const [matters, setMatters] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState(null) // null = no filter field
  useEffect(() => {
    ctx.api.matters().then((r) => setMatters(r.matters || [])).catch((err) => { setError(err.message); setMatters([]) })
  }, [])
  useInput((input, key) => {
    if (filter !== null) { if (key.escape) setFilter(null); return }
    if (input === '/') return setFilter('')
    if (input === 'n' || input === 'N') return ctx.go('newMatter')
    if (input === 'q' || input === 'Q') return ctx.go('matter', { matterId: null })
  })

  const ready = ctx.info.status?.model?.loaded || (ctx.info.providers?.active && ctx.info.providers.active !== 'local')
  const f = (filter || '').toLowerCase()
  const list = (matters || []).filter((m) => !f || `${m.title} ${m.client || ''} ${m.number || ''}`.toLowerCase().includes(f))
  const items = [
    ...(filter === null ? [{ value: 'new', label: 'New matter', hint: 'N' }, { value: 'quick', label: ctx.folder ? 'Quick question (about this folder, no matter)' : 'Quick question (no matter)', hint: 'Q' }] : []),
    ...list.map((m) => ({
      value: m.id,
      label: `${m.title}${m.client ? `  ${sym.sep} ${m.client}` : ''}${m.privileged ? `  ${sym.lock}` : ''}`,
      hint: [m.number || '', lastUsed(m)].filter(Boolean).join(`  ${sym.sep} `),
      matter: m,
    })),
    ...(filter === null ? [{ value: 'settings', label: 'Settings' }, { value: 'quit', label: 'Quit' }] : []),
  ]
  const choose = (it) => {
    if (it.value === 'new') return ctx.go('newMatter')
    if (it.value === 'quick') return ctx.go('matter', { matterId: null })
    if (it.value === 'settings') return ctx.go('settings')
    if (it.value === 'quit') return ctx.quit()
    ctx.go('matter', { matterId: it.value })
  }
  const keys = filter !== null ? `type to filter ${sym.sep} ↑↓ move ${sym.sep} Enter open ${sym.sep} Esc clear the filter` : `Enter open ${sym.sep} N new matter ${sym.sep} Q quick question ${sym.sep} / filter ${sym.sep} ? help`
  const empty = matters && !matters.length
  return html`<${Frame} title="Your matters" status=${ctx.status()} keys=${keys} noBack=${filter === null}>
    ${!ready ? html`<${Note} kind="warn">The AI is not set up yet. Choose Settings → Which AI.<//>` : null}
    ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
    ${error ? html`<${Note} kind="bad">${error}<//>` : null}
    ${ctx.folder ? html`<${Text} wrap="truncate-end"><${Text} dimColor>Working in <//>${fitPath(ctx.folder.short, Math.max(cols - 46, 16))}${ctx.folder.documents ? html`<${Text} dimColor>  ${sym.sep}  ${ctx.folder.documents} document${ctx.folder.documents === 1 ? '' : 's'} OpenLex can read<//>` : null}<//>` : null}
    ${matters === null
      ? html`<${Spinner} label="Loading your matters…" />`
      : html`<${Box} flexDirection="column" marginTop=${ready && !note && !ctx.folder ? 0 : 1}>
          ${empty ? html`<${Box} marginBottom=${1}><${Text}>No matters yet. Press <${Text} bold color=${color.accent}>N<//> to create your first matter${ctx.folder ? html` — or <${Text} bold color=${color.accent}>Q<//> to ask about this folder now` : ''}.<//><//>` : null}
          ${filter !== null ? html`<${TextField} value=${filter} onChange=${setFilter} onSubmit=${() => list[0] && choose({ value: list[0].id })} prefix="/ " noHelp placeholder="part of a matter or client name" />` : null}
          ${filter !== null && !list.length ? html`<${Text} dimColor>No matter matches “${filter}”.<//>` : null}
          <${Menu} items=${items} onSelect=${choose} maxVisible=${10} isActive=${filter === null || list.length > 0} />
          ${matters.some((m) => m.privileged) ? html`<${Box} marginTop=${1}><${Text} dimColor>[privileged] matters never leave this computer.<//><//>` : null}
        <//>`}
  <//>`
}

export function NewMatter() {
  const ctx = useAppCtx()
  const [step, setStep] = useState('title')
  const [form, setForm] = useState({ title: '', client: '' })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cloud = ctx.prefs.cloudForMatters // "Only for matters I choose" in setup

  useInput((_, key) => {
    if (!key.escape || busy) return
    if (step === 'title') return ctx.back()
    if (step === 'client') { setInput(form.title); return setStep('title') }
    if (step === 'privileged') { setInput(form.client); return setStep('client') }
    setStep('privileged')
  })

  const create = async (privileged, allowCloud) => {
    setBusy(true)
    setError('')
    try {
      const r = await ctx.api.createMatter({ title: form.title, client: form.client, privileged })
      if (allowCloud && cloud) await ctx.api.setMatterPolicy(r.matter.id, cloud)
      ctx.replace('matter', { matterId: r.matter.id })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  let body
  if (busy) body = html`<${Spinner} label="Creating the matter…" />`
  else if (step === 'title' || step === 'client') {
    const isTitle = step === 'title'
    body = html`<${Field} label=${isTitle ? 'Name of the matter' : 'Client (optional)'} help=${isTitle ? 'For example: Share purchase Alpine Holding' : 'Press Enter to skip.'}>
      <${TextField} key=${step} value=${input} onChange=${setInput} onSubmit=${(v) => {
        const t = v.trim()
        if (isTitle) { if (!t) return; setForm({ ...form, title: t }); setInput(form.client); setStep('client') } else { setForm({ ...form, client: t }); setStep('privileged') }
      }} />
    <//>`
  } else if (step === 'privileged') {
    body = html`<${Field} label="Is this matter privileged?" help="Privileged means nothing from this matter ever leaves this computer — not even with a cloud AI set up.">
      <${Menu} items=${[{ value: false, label: 'No' }, { value: true, label: 'Yes — keep it on this computer' }]} onSelect=${(it) => {
        if (it.value || !cloud) return create(it.value, false)
        setStep('cloud')
      }} />
    <//>`
  } else {
    body = html`<${Field} label=${`May documents of this matter be sent to ${(cloud.providers || []).map(nameOf).join(', ')}?`} help="You chose to decide this per matter. You can change it later in the matter.">
      <${Menu} items=${[{ value: false, label: 'No — keep them on this computer' }, { value: true, label: 'Yes, for this matter' }]} onSelect=${(it) => create(false, it.value)} />
    <//>`
  }
  return html`<${Frame} title="New matter" status=${ctx.status()} keys=${`Enter continue ${sym.sep} Esc back`}>
    ${form.title && step !== 'title' ? html`<${Text} dimColor>${form.title}${form.client ? ` ${sym.sep} ${form.client}` : ''}<//>` : null}
    ${error ? html`<${Note} kind="bad">${error}<//>` : null}
    <${Box} marginTop=${1}>${body}<//>
  <//>`
}

