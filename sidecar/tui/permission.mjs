/**
 * "May OpenLex …?" — the permission prompt shown over the chat or an
 * action while the engine waits for the lawyer's answer, and the list of
 * what OpenLex may do without asking (Settings, and /permissions in chat).
 *
 * One sentence with the verb in bold ("OpenLex wants to save
 * obligations.csv in this folder: ~/Clients/Alpine. Allow?"), the choices
 * numbered: 1 Allow once (always the one highlighted at first — never an
 * "Always …"), then the "always" choices, then Don't allow. Enter takes the
 * highlighted one, 1–4 pick directly, a = always (this matter / this
 * folder), A = always everywhere, n or Esc = don't allow. A short bell
 * rings when it opens (Settings → Accessibility turns it off). It never
 * answers by itself; no answer within a few minutes = not allowed (decided
 * by the engine).
 */

import { useContext, useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { html, Menu, Spinner, Note, color, sym, look } from './ui.mjs'
import { TypingContext } from './context.mjs'

const LABELS = {
  once: { label: 'Allow once', key: 'Enter' },
  always_matter: { label: 'Always allow (this matter)', key: 'a' },
  always_folder: { label: 'Always allow (this folder)', key: 'a' },
  always: { label: 'Always allow', key: 'A' },
  deny: { label: 'Don\'t allow', key: 'n / Esc' },
}

/** The one or two arguments worth showing (never the full content of a file). */
function keyDetail(req) {
  const d = req.detail || {}
  const pick = ['url', 'command', 'query', 'format', 'matter', 'directory', ...(req.folder ? [] : ['path'])].filter((k) => d[k] !== undefined && d[k] !== '').slice(0, 2)
  const out = pick.map((k) => `${k}: ${typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k])}`)
  if (typeof d.content === 'string') out.push(`content: ${d.content.length > 60 ? `${d.content.slice(0, 60).replace(/\s+/g, ' ')}…` : d.content.replace(/\s+/g, ' ')}`)
  return out.slice(0, 2)
}

/** "Save obligations.csv in …" → { verb: 'save', rest: 'obligations.csv in …' } (the verb shown in bold). */
export function questionParts(req) {
  const s = String(req.summary || 'use a tool').trim()
  const two = /^(Add to|Look up|Read the web page|Save the web page)\b\s*(.*)$/i.exec(s)
  if (two) return { verb: two[1].toLowerCase(), rest: two[2] }
  const one = /^(\S+)\s*(.*)$/.exec(s)
  return { verb: one[1].toLowerCase().replace(/:$/, ''), rest: one[2] }
}

const ACTS = {
  write_file: 'saving files', append_file: 'adding to files', export_document: 'saving results as files', sync_calendar: 'writing calendar files',
  delete_file: 'deleting files', rename_file: 'renaming files', read_file: 'reading files', list_directory: 'listing files', search_local_files: 'searching files',
  web_fetch: 'opening web pages', web_save: 'saving web pages', download_to_matter: 'downloading files', run_bash: 'running programs on this computer',
}

/** A permission rule in words: "web_fetch:eur-lex.europa.eu" → "opening web pages on eur-lex.europa.eu". */
export function patternWords(pattern) {
  const p = String(pattern || '')
  if (p === '*') return 'everything'
  // "*:~/Clients/Alpine/**": anything in that folder.
  if (/^\*:/.test(p)) return `anything in ${p.slice(2).replace(/\/?\*\*?$/, '/')}`
  const mcp = /^mcp:([^:]+)(?::(.*))?$/.exec(p)
  if (mcp) return `using your connector “${mcp[1]}”${mcp[2] && mcp[2] !== '*' ? ` (${mcp[2]})` : ''}`
  const i = p.indexOf(':')
  const tool = i < 0 ? p : p.slice(0, i)
  const arg = i < 0 ? '' : p.slice(i + 1)
  const act = ACTS[tool]
  if (!act) return p
  if (!arg || arg === '*' || arg === '**') return act
  if (/^web_|download/.test(tool)) return `${act} on ${arg}`
  if (tool === 'run_bash') return `${act}: ${arg}`
  return `${act} in ${arg.replace(/\/?\*\*?$/, '/')}`
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1)

/** What the confirmation line in the chat says after an answer. */
export function answeredLine(req, decision, saved) {
  if (decision === 'deny') return `Not allowed: ${req.summary}`
  if (decision === 'once') return `Allowed once: ${req.summary}`
  if (decision === 'always_folder') return `Allowed in this folder from now on: ${patternWords(saved || req.alwaysFolder || req.tool)} (remove it with /permissions)`
  return `Allowed${decision === 'always_matter' ? ' for this matter' : ''} from now on: ${patternWords(saved || req.always || req.tool)} (remove it with /permissions)`
}

export function PermissionPrompt({ req, onAnswer }) {
  const choices = (req.choices || ['once', 'deny']).filter((c) => LABELS[c])
  const [sent, setSent] = useState(false)
  const { stdout } = useStdout()
  // While the prompt is open, single keys belong to it ("?" must not leave the screen).
  const typing = useContext(TypingContext)
  useEffect(() => { typing.current++; return () => { typing.current-- } }, [])
  // A short bell: the lawyer may be looking elsewhere while OpenLex waits.
  useEffect(() => { if (look.bell && stdout?.isTTY) stdout.write('\x07') }, [])
  const answer = (d) => { if (sent || !choices.includes(d)) return; setSent(true); onAnswer(d) }
  useInput((input, key) => {
    if (sent) return
    if (key.escape || input === 'n' || input === 'N') return answer('deny')
    if (input === 'a') return answer(choices.includes('always_matter') ? 'always_matter' : 'always_folder')
    if (input === 'A') return answer('always')
  })
  const items = choices.map((c) => ({ value: c, label: `${LABELS[c].label.padEnd(28)}${LABELS[c].key}` }))
  const q = questionParts(req)
  return html`<${Box} justifyContent="center">
    <${Box} flexDirection="column" borderStyle=${look.accessible ? undefined : look.border} borderColor=${color.accent} paddingX=${1} width="94%">
      <${Text} bold color=${color.accent}>${look.accessible ? 'Permission required: ' : ''}${req.title || 'OpenLex wants to use a tool'}<//>
      <${Text} wrap="wrap">OpenLex wants to <${Text} bold>${q.verb}<//>${q.rest ? ` ${q.rest}` : ''}. Allow?<//>
      ${keyDetail(req).map((l, i) => html`<${Text} key=${i} dimColor wrap="truncate-end">  ${l}<//>`)}
      ${req.warning ? html`<${Text} color=${color.bad} wrap="wrap">! ${req.warning}<//>` : null}
      ${req.caution ? html`<${Text} color=${color.warn} wrap="wrap">! ${req.caution}<//>` : null}
      <${Text} dimColor wrap="wrap">This ${req.risk || 'changes something'}.${req.firmRule ? ' Your firm asks for confirmation here.' : ''} Nothing happens until you choose.<//>
      <${Box} marginTop=${1}>
        ${sent ? html`<${Spinner} label="Sending your answer…" />` : html`<${Menu} items=${items} numbered onSelect=${(it) => answer(it.value)} />`}
      <//>
    <//>
  <//>`
}

/**
 * The rules: allowed without asking (everywhere / per matter), never
 * allowed, and the firm's own (shown, not editable). Enter on one of yours
 * offers to remove it.
 */
export function PermissionRules({ api, matterId = null, onNote }) {
  const [data, setData] = useState(null)
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState('')
  const load = () => api.permissions().then(setData).catch((err) => { setData({ error: err.message }) })
  useEffect(() => { load() }, [])
  if (!data || busy) return html`<${Spinner} label=${busy || 'Loading…'} />`
  if (data.error) return html`<${Note} kind="bad">${data.error}<//>`
  if (picked) {
    return html`<${Box} flexDirection="column">
      <${Text} bold wrap="wrap">Remove "${patternWords(picked.pattern)}"${picked.matterId ? ' for this matter' : ''}?<//>
      <${Text} dimColor wrap="wrap">${picked.list === 'deny' ? 'OpenLex may then ask for it again.' : 'OpenLex will ask again before doing it.'}<//>
      <${Box} marginTop=${1}><${Menu} items=${[{ value: true, label: 'Yes, remove it' }, { value: false, label: 'No, keep it' }]} onSelect=${async (it) => {
        if (!it.value) return setPicked(null)
        setBusy('Removing…')
        try { await api.permissionRule('remove', picked.pattern, picked.matterId); onNote?.({ kind: 'ok', text: `Removed: ${patternWords(picked.pattern)}` }) } catch (err) { onNote?.({ kind: 'bad', text: err.message }) }
        setPicked(null)
        setBusy('')
        load()
      }} /><//>
    <//>`
  }
  const u = data.user || {}
  const f = data.firm || {}
  const mine = [
    ...(u.allow || []).map((p) => ({ value: `a:${p}`, label: `${sym.ok} ${cap(patternWords(p))}`, hint: 'allowed everywhere', rule: { pattern: p, list: 'allow' } })),
    ...Object.entries(u.matters || {}).filter(([id]) => !matterId || id === matterId).flatMap(([id, m]) => (m.allow || []).map((p) => ({ value: `m:${id}:${p}`, label: `${sym.ok} ${cap(patternWords(p))}`, hint: id === matterId ? 'this matter' : `matter ${id}`, rule: { pattern: p, list: 'allow', matterId: id } }))),
    ...(u.deny || []).map((p) => ({ value: `d:${p}`, label: `${sym.bad} ${cap(patternWords(p))}`, hint: 'never allowed', rule: { pattern: p, list: 'deny' } })),
  ]
  const firm = [
    ...(f.allow || []).map((p) => ({ value: `fa:${p}`, label: `${sym.ok} ${cap(patternWords(p))}`, hint: 'allowed by your firm', disabled: true })),
    ...(f.deny || []).map((p) => ({ value: `fd:${p}`, label: `${sym.bad} ${cap(patternWords(p))}`, hint: 'blocked by your firm', disabled: true })),
    ...(f.ask || []).map((p) => ({ value: `fq:${p}`, label: `? ${cap(patternWords(p))}`, hint: 'your firm always asks', disabled: true })),
  ]
  return html`<${Box} flexDirection="column">
    <${Text} bold>What OpenLex may do without asking<//>
    ${data.locked ? html`<${Text} dimColor wrap="wrap">Your firm has fixed these rules; your own are not used.<//>` : null}
    ${mine.length || firm.length
      ? html`<${Box} marginTop=${1}><${Menu} items=${[...mine, ...firm]} onSelect=${(it) => it.rule && setPicked(it.rule)} /><//>`
      : html`<${Text} dimColor wrap="wrap">Nothing yet: OpenLex asks before it saves files, opens web pages, runs commands or uses connectors. Choose "Always allow" when it asks to stop being asked.<//>`}
    <${Box} marginTop=${1}><${Text} dimColor wrap="wrap">Reading documents and searching the law never needs asking. Enter on one of your rules removes it.<//><//>
  <//>`
}
