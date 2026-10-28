/**
 * Settings: the AI model, your keys, where client data may go, what
 * OpenLex may do without asking, and the folder where it saves its work.
 */

import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { describeModel, describeRule, nameOf, friendly } from './api.mjs'
import { cleanPath, completePath, shortPath } from './paths.mjs'
import { PermissionRules } from './permission.mjs'

export function Settings() {
  const ctx = useAppCtx()
  const [mode, setMode] = useState('menu') // menu | keys | key | keyInput | workspace
  const [workspace, setWorkspace] = useState('')
  const [picked, setPicked] = useState(null) // provider for the key screens
  const [input, setInput] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState('')

  useEffect(() => { ctx.api.workspace().then((w) => setWorkspace(w.base)).catch(() => {}) }, [])
  useInput((_, k) => {
    if (!k.escape || busy) return
    if (mode === 'menu') return ctx.back()
    setMode(mode === 'key' || mode === 'keyInput' ? 'keys' : 'menu')
  })

  const run = async (label, fn) => {
    setBusy(label)
    try { setNote(await fn()) } catch (err) { setNote({ kind: 'bad', text: err.message }) }
    await ctx.refresh().catch(() => {})
    setBusy('')
  }

  const providers = ctx.info.providers?.providers || []
  const withKeys = providers.filter((p) => p.needsKey)
  const active = ctx.info.providers?.active

  let body
  let keys
  if (busy) body = html`<${Spinner} label=${busy} />`
  else if (mode === 'menu') {
    const items = [
      { value: 'model', label: 'AI model', hint: describeModel(ctx.info) },
      { value: 'keys', label: 'Your keys', hint: `${withKeys.filter((p) => p.hasKey).length} saved` },
      { value: 'data', label: 'Where client data may go', hint: describeRule(ctx.info.policy?.default) },
      { value: 'perms', label: 'What OpenLex may do without asking', hint: 'saving files, web pages, commands, connectors' },
      { value: 'workspace', label: 'Folder for results', hint: shortPath(workspace) },
      { value: 'back', label: 'Back' },
    ]
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${Menu} items=${items} onSelect=${(it) => {
        setNote(null)
        if (it.value === 'back') return ctx.back()
        if (it.value === 'model') return ctx.go('setup', {})
        if (it.value === 'data') {
          if (!active || active === 'local') return setNote({ kind: 'ok', text: 'The AI runs on this computer, so client data stays here. Choose a cloud AI model first to allow anything else.' })
          return ctx.go('setup', { dataOnly: true })
        }
        if (it.value === 'workspace') { setInput(workspace); return setMode('workspace') }
        setMode(it.value)
      }} />
    <//>`
  } else if (mode === 'keys') {
    body = html`<${Field} label="Your keys" help="Keys are kept in this computer's keychain and never shown again.">
      <${Menu} items=${withKeys.map((p) => ({ value: p.id, label: `${nameOf(p.id)}`, hint: p.hasKey ? `${sym.ok} key saved` : 'no key' }))} onSelect=${(it) => { setPicked(withKeys.find((p) => p.id === it.value)); setNote(null); setMode('key') }} />
    <//>`
  } else if (mode === 'key' && picked) {
    const items = [
      { value: 'set', label: picked.hasKey ? 'Replace the key' : 'Add a key' },
      ...(picked.hasKey ? [{ value: 'test', label: 'Check that it works' }, { value: 'remove', label: 'Remove the key' }] : []),
      { value: 'back', label: 'Back' },
    ]
    body = html`<${Field} label=${nameOf(picked.id)}>
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${Menu} items=${items} onSelect=${(it) => {
        if (it.value === 'back') return setMode('keys')
        if (it.value === 'set') { setInput(''); return setMode('keyInput') }
        if (it.value === 'remove') return run('Removing the key…', async () => { await ctx.api.saveKey(picked.id, null); setPicked({ ...picked, hasKey: false }); return { kind: 'ok', text: 'Key removed.' } })
        run('Checking…', async () => {
          const r = await ctx.api.testProvider(picked.id)
          if (r.ok) return { kind: 'ok', text: `${nameOf(picked.id)} answered — the key works.` }
          return { kind: 'bad', text: friendly(r.error) }
        })
      }} />
    <//>`
  } else if (mode === 'keyInput' && picked) {
    keys = `Enter save ${sym.sep} Esc back`
    body = html`<${Field} label=${`Your ${nameOf(picked.id)} key`} help="Paste it here (it stays hidden).">
      <${TextField} value=${input} mask onChange=${setInput} onSubmit=${(v) => v.trim() && run('Saving the key…', async () => {
        await ctx.api.saveKey(picked.id, v.trim())
        setPicked({ ...picked, hasKey: true })
        setMode('key')
        return { kind: 'ok', text: 'Key saved in this computer\'s keychain.' }
      })} />
    <//>`
  } else if (mode === 'perms') {
    keys = `↑↓ move ${sym.sep} Enter remove ${sym.sep} Esc back`
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${PermissionRules} api=${ctx.api} onNote=${setNote} />
    <//>`
  } else if (mode === 'workspace') {
    keys = `Enter save ${sym.sep} Tab complete ${sym.sep} Esc back`
    body = html`<${Field} label="Folder where OpenLex saves its work" help="Each matter gets its own subfolder here. You can drag a folder into this window.">
      <${TextField} value=${input} onChange=${setInput} onTab=${completePath} onSubmit=${(v) => {
        const p = cleanPath(v)
        if (!p) return
        run('Saving…', async () => { const r = await ctx.api.setWorkspace(p); setWorkspace(r.base); setMode('menu'); return { kind: 'ok', text: `Results are saved in ${shortPath(r.base)}` } })
      }} />
    <//>`
  }
  return html`<${Frame} title="Settings" status=${ctx.status()} keys=${keys}>
    ${body}
    ${mode === 'menu' && !busy ? html`<${Box} marginTop=${1}><${Text} dimColor wrap="wrap">Privileged matters always stay on this computer. Mark a matter privileged in the matter itself.<//><//>` : null}
  <//>`
}
