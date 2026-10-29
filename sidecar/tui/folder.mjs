/**
 * The working folder, before OpenLex works in it:
 *
 *   - the whole home folder or the whole computer: a warning, and the
 *     safe choice ("Don't use a folder") comes first;
 *   - a folder OpenLex has not worked in before: a one-time notice that it
 *     can read the files there, with the option to forbid that.
 *
 * Also the field used by /folder and Settings to choose another folder.
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Note, Spinner, sym, color, fitPath, useSize } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { cleanPath, completePath } from './paths.mjs'

const docsWord = (n) => (n === null || n === undefined ? '' : n === 1 ? '1 document' : `${n} documents`)

export function FolderCheck({ info, reason = 'new' }) {
  const ctx = useAppCtx()
  const { cols } = useSize()
  const [mode, setMode] = useState('ask') // ask | choose
  const [input, setInput] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  useInput((_, key) => { if (key.escape && mode === 'choose') { setNote(null); setMode('ask') } }, { isActive: !busy })

  /** Another folder typed or dragged in: inspected, then checked again from the top. */
  const choose = async (raw) => {
    const p = cleanPath(raw)
    if (!p) return
    setBusy(true)
    const f = await ctx.inspectFolder(p)
    setBusy(false)
    if (!f.ok) return setNote({ kind: 'bad', text: f.error })
    ctx.replace('folderCheck', { info: f, reason: f.broad ? 'broad' : 'new' })
  }

  let body
  let keys
  if (busy) body = html`<${Spinner} label="Looking at the folder…" />`
  else if (mode === 'choose') {
    keys = `Enter use it ${sym.sep} Tab complete ${sym.sep} Esc back`
    body = html`<${Box} flexDirection="column">
      ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
      <${Field} label="Which folder should OpenLex work in?" help="The folder of one client or matter. Drag it here from Finder or Explorer, or type the path.">
        <${TextField} value=${input} onChange=${setInput} onTab=${completePath} onSubmit=${choose} placeholder="~/Clients/Alpine" />
      <//>
    <//>`
  } else if (reason === 'broad') {
    const whole = info.broad === 'home' ? 'your whole home folder' : 'the whole computer'
    body = html`<${Box} flexDirection="column">
      <${Note} kind="warn"><${Text} bold>That's ${whole} (${info.short}).<//><//>
      <${Text} wrap="wrap">OpenLex would be able to read every document in it — all clients, not just one. It is better to start OpenLex in the folder of one client or matter.<//>
      <${Box} marginTop=${1}><${Menu} numbered items=${[
        { value: 'none', label: 'Don\'t use a folder (work with matters only)' },
        { value: 'choose', label: 'Choose the folder of one client or matter…' },
        { value: 'anyway', label: `Use ${whole} anyway` },
      ]} onSelect=${(it) => {
        if (it.value === 'choose') return setMode('choose')
        if (it.value === 'anyway') ctx.useFolder(info, { confirmed: true })
        else ctx.useFolder(null)
        ctx.replace('home', it.value === 'anyway' ? { note: { kind: 'warn', text: `Working in ${whole}. OpenLex still asks before it changes anything.` } } : {})
      }} /><//>
    <//>`
  } else {
    const n = docsWord(info.documents)
    body = html`<${Box} flexDirection="column">
      <${Text} bold color=${color.accent}>OpenLex can read the files in this folder<//>
      <${Text} wrap="truncate-start">${fitPath(info.short, cols - 22)}${n ? ` (${n}${info.truncated ? ' or more' : ''})` : ''}<//>
      <${Box} marginTop=${1} flexDirection="column">
        <${Text} wrap="wrap">${sym.bullet} It reads the documents here when your question needs them.<//>
        <${Text} wrap="wrap">${sym.bullet} It asks before it saves, renames or deletes anything here.<//>
        <${Text} wrap="wrap">${sym.bullet} It never looks outside this folder and your matter folders.<//>
      <//>
      <${Box} marginTop=${1}><${Menu} numbered items=${[
        { value: 'ok', label: 'OK, continue' },
        { value: 'forbid', label: 'Don\'t let OpenLex read this folder' },
        { value: 'choose', label: 'Choose another folder…' },
      ]} onSelect=${async (it) => {
        if (it.value === 'choose') return setMode('choose')
        if (it.value === 'forbid') { await ctx.forbidFolder(info); return ctx.replace('home', { note: { kind: 'ok', text: `OpenLex will not read ${info.short}.` } }) }
        ctx.useFolder(info)
        ctx.replace('home', {})
      }} /><//>
    <//>`
  }
  return html`<${Frame} title="Working folder" status=${ctx.status()} keys=${keys || `↑↓ move ${sym.sep} Enter choose ${sym.sep} 1-3 pick`}>${body}<//>`
}

/**
 * /folder and Settings: change the working folder in place. Calls
 * onDone({ kind, text }) when finished; asks for confirmation of a broad folder.
 */
export function FolderPicker({ onDone, initial = '' }) {
  const ctx = useAppCtx()
  const [input, setInput] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [broad, setBroad] = useState(null)
  if (busy) return html`<${Spinner} label="Looking at the folder…" />`
  if (broad) {
    const whole = broad.broad === 'home' ? 'your whole home folder' : 'the whole computer'
    return html`<${Box} flexDirection="column">
      <${Note} kind="warn"><${Text} bold>That's ${whole} (${broad.short}).<//> OpenLex would be able to read every document in it.<//>
      <${Box} marginTop=${1}><${Menu} numbered items=${[{ value: false, label: 'No, choose another folder' }, { value: true, label: `Use ${whole} anyway` }]} onSelect=${(it) => {
        if (!it.value) return setBroad(null)
        ctx.useFolder(broad, { confirmed: true })
        onDone({ kind: 'warn', text: `Now working in ${whole} (${broad.short}). OpenLex asks before changing anything.` })
      }} /><//>
    <//>`
  }
  return html`<${Box} flexDirection="column">
    ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
    <${Field} label="Which folder should OpenLex work in?" help=${`Now: ${ctx.folder?.short || 'no folder'}. Drag a folder here or type its path. Type "none" to stop working in a folder.`}>
      <${TextField} value=${input} onChange=${setInput} onTab=${completePath} noHelp placeholder="~/Clients/Alpine" onSubmit=${async (raw) => {
        if (/^(none|off|no)$/i.test(raw.trim())) { ctx.useFolder(null); return onDone({ kind: 'ok', text: 'Not working in a folder any more. OpenLex uses your matters only.' }) }
        const p = cleanPath(raw)
        if (!p) return
        setBusy(true)
        const f = await ctx.inspectFolder(p)
        setBusy(false)
        if (!f.ok) return setNote({ kind: 'bad', text: f.error })
        if (f.broad) return setBroad(f)
        ctx.useFolder(f)
        onDone({ kind: 'ok', text: `Now working in ${f.short}${f.documents ? ` (${docsWord(f.documents)})` : ''}. OpenLex can read the files there and asks before changing anything.` })
      }} />
    <//>
  <//>`
}
