/**
 * Home: the lawyer's matters, "New matter" and "Quick question". New
 * matter asks for a name, the client, and whether it is privileged
 * (privileged = never leaves this computer).
 */

import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { nameOf } from './api.mjs'

export function Home() {
  const ctx = useAppCtx()
  const [matters, setMatters] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    ctx.api.matters().then((r) => setMatters(r.matters || [])).catch((err) => { setError(err.message); setMatters([]) })
  }, [])
  useInput((input) => { if (input === 'q') ctx.quit() })

  const ready = ctx.info.status?.model?.loaded || (ctx.info.providers?.active && ctx.info.providers.active !== 'local')
  const items = [
    { value: 'new', label: 'New matter' },
    { value: 'quick', label: 'Quick question (no matter)' },
    ...(matters || []).map((m) => ({
      value: m.id,
      label: `${m.title}${m.client ? `  ${sym.sep} ${m.client}` : ''}${m.privileged ? `  ${sym.lock}` : ''}`,
      hint: m.number || '',
      matter: m,
    })),
    { value: 'settings', label: 'Settings' },
    { value: 'quit', label: 'Quit' },
  ]
  const choose = (it) => {
    if (it.value === 'new') return ctx.go('newMatter')
    if (it.value === 'quick') return ctx.go('matter', { matterId: null })
    if (it.value === 'settings') return ctx.go('settings')
    if (it.value === 'quit') return ctx.quit()
    ctx.go('matter', { matterId: it.value })
  }
  return html`<${Frame} title="Your matters" status=${ctx.status()} keys=${`↑↓ move ${sym.sep} Enter open ${sym.sep} ? help ${sym.sep} q or Ctrl+C quit`}>
    ${!ready ? html`<${Note} kind="warn">The AI is not set up yet. Choose Settings → AI model.<//>` : null}
    ${error ? html`<${Note} kind="bad">${error}<//>` : null}
    ${matters === null
      ? html`<${Spinner} label="Loading your matters…" />`
      : html`<${Box} flexDirection="column" marginTop=${ready ? 0 : 1}>
          ${matters.length ? null : html`<${Text} dimColor>No matters yet. Start with "New matter".<//>`}
          <${Menu} items=${items} onSelect=${choose} maxVisible=${12} />
          ${matters.some((m) => m.privileged) ? html`<${Box} marginTop=${1}><${Text} dimColor>Privileged matters never leave this computer.<//><//>` : null}
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
  return html`<${Frame} title="New matter" status=${ctx.status()} keys=${`Enter continue ${sym.sep} Esc back ${sym.sep} Ctrl+C quit`}>
    ${form.title && step !== 'title' ? html`<${Text} dimColor>${form.title}${form.client ? ` ${sym.sep} ${form.client}` : ''}<//>` : null}
    ${error ? html`<${Note} kind="bad">${error}<//>` : null}
    <${Box} marginTop=${1}>${body}<//>
  <//>`
}

