/**
 * /law — the law sources OpenLex looks things up in, one list in plain
 * words ("RIS Austria: connected, free", "Ansvar: paste your key").
 * Enter on a source: switch it on or off, or paste its key (hidden, kept
 * in this computer's keychain). The engine decides the words
 * (connectors/index.js status), so every front end says the same.
 */

import { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { html, Menu, TextField, Spinner, Note, Field, sym } from './ui.mjs'

const mark = (s) => (s.state === 'ready' ? sym.ok : s.state === 'off' ? '–' : sym.bullet)

/** Menu items for the list (pure, tested). */
export function sourceItems(list = []) {
  return list.map((s) => ({ value: s.id, label: `${mark(s)} ${s.status}`, hint: s.description }))
}

/** What Enter on a source offers (pure, tested). */
export function sourceChoices(s) {
  if (!s) return []
  const out = []
  if (s.needsKey || s.optionalKey) out.push({ value: 'key', label: s.hasKey ? 'Replace the key' : 'Paste your key', hint: s.keyHelp || '' })
  if (s.hasKey) out.push({ value: 'nokey', label: 'Remove the key' })
  if (!s.managedByFirm) out.push(s.enabled ? { value: 'off', label: 'Switch it off', hint: 'OpenLex will not look anything up there.' } : { value: 'on', label: 'Switch it on' })
  out.push({ value: 'back', label: 'Back to the list' })
  return out
}

/** The client-data rule with "web" added (keeps the AI services already allowed). */
export function withWeb(rule) {
  const r = rule && rule.mode === 'allow-list' ? rule : { mode: 'allow-list', providers: [] }
  return { ...r, providers: [...new Set([...(r.providers || []), 'web'])] }
}

async function allowWeb(api, matterId) {
  const p = await api.policy()
  const own = matterId ? p.matters?.[matterId] : null
  if (matterId) return api.setMatterPolicy(matterId, withWeb(own || p.default))
  return api.setPolicy(withWeb(p.default))
}

export function LawSources({ api, matterId = null, onNote }) {
  const [list, setList] = useState(null)
  const [picked, setPicked] = useState(null)
  const [keyMode, setKeyMode] = useState(false)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState(null)
  const load = () => api.lawSources(matterId).then((r) => setList(r.sources || [])).catch((err) => setList({ error: err.message }))
  useEffect(() => { load() }, [])
  const say = (n) => { setNote(n); onNote?.(n) }
  const act = async (label, fn, done) => {
    setBusy(label)
    try { await fn(); say({ kind: 'ok', text: done }) } catch (err) { say({ kind: 'bad', text: err.message }) }
    setBusy('')
    setPicked(null)
    setKeyMode(false)
    setSecret('')
    load()
  }

  if (!list || busy) return html`<${Spinner} label=${busy || 'Loading…'} />`
  if (list.error) return html`<${Note} kind="bad">${list.error}<//>`

  if (picked && keyMode) {
    return html`<${Field} label=${`Your ${picked.label} key`} help=${`${picked.keyHelp || 'Paste it here (it stays hidden).'} It is kept in this computer's keychain and only sent to ${picked.label}.`}>
      <${TextField} value=${secret} mask onChange=${setSecret} onSubmit=${(v) => v.trim() && act('Saving…', () => api.saveSourceKey(picked.id, v.trim()), `Saved the ${picked.label} key.`)} />
    <//>`
  }
  if (picked) {
    return html`<${Box} flexDirection="column">
      <${Text} bold wrap="wrap">${picked.status}<//>
      <${Text} dimColor wrap="wrap">${picked.description}<//>
      <${Text} dimColor wrap="wrap">Licence: ${picked.licence}<//>
      <${Box} marginTop=${1}><${Menu} items=${sourceChoices(picked)} describe onSelect=${(it) => {
        if (it.value === 'back') return setPicked(null)
        if (it.value === 'key') return setKeyMode(true)
        if (it.value === 'nokey') return act('Removing…', () => api.saveSourceKey(picked.id, null), `Removed the ${picked.label} key.`)
        return act(it.value === 'on' ? 'Switching on…' : 'Switching off…', () => api.enableSource(picked.id, it.value === 'on'), `${picked.label} is now ${it.value}.`)
      }} /><//>
    <//>`
  }
  const offline = list.some((s) => s.state === 'offline')
  const items = [...sourceItems(list), ...(offline ? [{ value: '__web', label: 'Allow online look-ups (only search words leave this computer)' }] : [])]
  return html`<${Box} flexDirection="column">
    <${Text} bold>Where OpenLex looks up the law<//>
    ${note ? html`<${Note} kind=${note.kind}>${note.text}<//>` : null}
    <${Box} marginTop=${1}><${Menu} items=${items} onSelect=${(it) => (it.value === '__web' ? act('Saving…', () => allowWeb(api, matterId), `Online look-ups are allowed${matterId ? ' for this matter' : ''}.`) : setPicked(list.find((s) => s.id === it.value)))} /><//>
    <${Box} marginTop=${1}><${Text} dimColor wrap="wrap">Only your search words are sent, never your documents. ${offline ? 'Online look-ups are off in your client-data rule (/data or Settings). ' : ''}${list[0]?.managedByFirm ? 'Your firm manages this list.' : 'Enter on a source to switch it or add a key.'}<//><//>
  <//>`
}
