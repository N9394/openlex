/**
 * Settings: which AI, your keys, where client data may go, what OpenLex
 * may do without asking, the folder it works in, the folder where it saves
 * its work, and how it looks (Accessibility). Each row: what it is · what
 * it is now · one line on what it means. Changes are saved at once.
 */

import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym, look } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { describeModel, describeRule, nameOf, friendly } from './api.mjs'
import { cleanPath, completePath, shortPath } from './paths.mjs'
import { PermissionRules } from './permission.mjs'
import { FolderPicker } from './folder.mjs'
import { LawSources } from './sources.mjs'

const row = (label, value) => `${label.padEnd(36)}${value}`
const COLOURS = ['auto', 'none', 'high']
const COLOUR_WORDS = { auto: 'Auto (your terminal\'s colours)', none: 'None', high: 'High contrast' }

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
    setNote(null)
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
      { value: 'model', label: row('Which AI', describeModel(ctx.info)), hint: 'Where the AI runs: on this computer, or an online service with your key.' },
      { value: 'keys', label: row('Your keys', `${withKeys.filter((p) => p.hasKey).length} saved`), hint: 'Keys for online AI services, kept in this computer\'s keychain.' },
      { value: 'data', label: row('Where client data may go', describeRule(ctx.info.policy?.default)), hint: 'Which AI services may receive client documents. Privileged matters never leave this computer.' },
      { value: 'lawsources', label: row('Where OpenLex looks up the law', 'law sources'), hint: 'Official law databases (free) and services you subscribe to (with your key). Same as /law.' },
      { value: 'perms', label: row('What OpenLex may do without asking', 'your rules'), hint: 'Saving files, opening web pages, running commands, using connectors.' },
      { value: 'folder', label: row('Working folder', ctx.folder?.short || 'none'), hint: 'The folder OpenLex reads (and asks before changing). Usually the folder you started OpenLex in.' },
      { value: 'workspace', label: row('Folder for results', shortPath(workspace)), hint: 'Where OpenLex keeps each matter\'s results and its history of earlier versions.' },
      { value: 'access', label: row('Accessibility', [look.accessible ? 'screen reader' : '', look.reducedMotion && !look.accessible ? 'reduced motion' : '', ctx.prefs.colours && ctx.prefs.colours !== 'auto' ? `colours: ${ctx.prefs.colours}` : '', look.ascii ? 'ASCII' : ''].filter(Boolean).join(', ') || 'standard'), hint: 'Screen-reader mode, reduced motion, colours, plain ASCII symbols, the bell.' },
      { value: 'tour', label: 'Take the short tour again', hint: 'What OpenLex can do, how to ask, where your data goes.' },
      { value: 'back', label: 'Back' },
    ]
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${Menu} items=${items} describe onSelect=${(it) => {
        setNote(null)
        if (it.value === 'back') return ctx.back()
        if (it.value === 'tour') return ctx.go('tour', {})
        if (it.value === 'model') return ctx.go('setup', {})
        if (it.value === 'data') {
          if (!active || active === 'local') return setNote({ kind: 'ok', text: 'The AI runs on this computer, so client data stays here. Choose an online AI service first to allow anything else.' })
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
  } else if (mode === 'lawsources') {
    keys = `↑↓ move ${sym.sep} Enter choose ${sym.sep} Esc back`
    body = html`<${LawSources} api=${ctx.api} />`
  } else if (mode === 'perms') {
    keys = `↑↓ move ${sym.sep} Enter remove ${sym.sep} Esc back`
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${PermissionRules} api=${ctx.api} onNote=${setNote} />
    <//>`
  } else if (mode === 'folder') {
    keys = `Enter use it ${sym.sep} Tab complete ${sym.sep} Esc back`
    body = html`<${FolderPicker} onDone=${(n) => { setNote(n); setMode('menu') }} />`
  } else if (mode === 'access') {
    const p = ctx.prefs
    const onOff = (v) => (v ? 'On' : 'Off')
    const items = [
      { value: 'accessible', label: row('Screen-reader mode', onOff(look.accessible)), hint: 'Plain lines without boxes, colours or animation; menus as numbered lists.' },
      { value: 'reducedMotion', label: row('Reduced motion', onOff(look.reducedMotion)), hint: 'No spinners or other animation.' },
      { value: 'colours', label: row('Colours', COLOUR_WORDS[p.colours || 'auto']), hint: 'Auto uses your terminal\'s own colour scheme. None turns colour off (meaning is always also in words).' },
      { value: 'ascii', label: row('Plain ASCII symbols', onOff(look.ascii)), hint: 'For terminals that show ✓ or ─ as boxes or question marks.' },
      { value: 'bell', label: row('Bell when OpenLex asks you', onOff(p.bell !== false)), hint: 'A short sound when a permission question appears.' },
      { value: 'back', label: 'Back' },
    ]
    keys = `↑↓ move ${sym.sep} Enter change ${sym.sep} Esc back`
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${Menu} items=${items} describe onSelect=${(it) => {
        if (it.value === 'back') return setMode('menu')
        const patch = it.value === 'colours' ? { colours: COLOURS[(COLOURS.indexOf(p.colours || 'auto') + 1) % COLOURS.length] }
          : it.value === 'bell' ? { bell: p.bell === false }
            : { [it.value]: !(it.value === 'accessible' ? look.accessible : it.value === 'reducedMotion' ? look.reducedMotion : look.ascii) }
        ctx.setPrefs(patch)
        setNote({ kind: 'ok', text: 'Saved.' })
      }} />
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
