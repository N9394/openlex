/**
 * Building blocks of the terminal app: the widgets every screen uses —
 * menu, text field, spinner, error box, and the frame (breadcrumbs on top,
 * status bar and this screen's keys at the bottom). The look (colours by
 * role, symbols, accessible mode) is decided in theme.mjs.
 *
 * No build step: htm gives JSX-like templates on plain React.createElement.
 */

import React, { useContext, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import htm from 'htm'
import { TypingContext, AppContext } from './context.mjs'
import { sym, color, look, configure } from './theme.mjs'

export { sym, color, look, configure }
export const html = htm.bind(React.createElement)
export const NO_COLOR = () => look.colorLevel === 0

/** Smallest window the app lays out for; below this a plain message asks for a wider one. */
export const MIN_COLS = 60

/** Terminal size, re-rendered on resize. Tests have no rows: 24 (the size we design for). */
export function useSize() {
  const { stdout } = useStdout()
  const get = () => ({ cols: Math.max(stdout?.columns || 80, 20), rows: Math.max(stdout?.rows || 24, 10) })
  const [size, setSize] = useState(get)
  useEffect(() => {
    if (!stdout?.on) return undefined
    const on = () => setSize(get())
    stdout.on('resize', on)
    return () => stdout.off?.('resize', on)
  }, [stdout])
  return size
}

/** A spinner — or, with reduced motion / accessible mode, a still "…". */
export function Spinner({ label }) {
  const [i, setI] = useState(0)
  const still = look.reducedMotion
  useEffect(() => { if (still) return undefined; const t = setInterval(() => setI((x) => x + 1), 100); return () => clearInterval(t) }, [still])
  if (still) {
    const l = String(label || 'Working')
    return html`<${Text}>${look.accessible ? 'Working: ' : ''}${/(…|\.\.\.)\)?$/.test(l) ? l : `${l} ${sym.ell}`}<//>`
  }
  return html`<${Text}><${Text} color=${color.accent}>${sym.spin[i % sym.spin.length]}<//> ${label || ''}<//>`
}

/**
 * A vertical list: ↑↓ move, Enter chooses, 1–9 pick. Items are
 * { label, value, hint?, disabled? }; with `describe` the highlighted item's
 * hint is shown underneath in full, else hints show dimmed on the line.
 * `numbered` shows the numbers (always in accessible mode).
 */
export function Menu({ items, onSelect, onHighlight, isActive = true, initial = 0, describe = false, maxVisible = 12, numbered = false }) {
  const [i, setI] = useState(Math.min(initial, Math.max(items.length - 1, 0)))
  // A ref as well as state: keys typed faster than a re-render must see the latest position.
  const at = useRef(i)
  const idx = Math.min(i, Math.max(items.length - 1, 0))
  const set = (n) => { at.current = n; setI(n) }
  const move = (d) => {
    if (!items.length) return
    let n = Math.min(at.current, items.length - 1)
    for (let k = 0; k < items.length; k++) { n = (n + d + items.length) % items.length; if (!items[n].disabled) break }
    set(n)
    onHighlight?.(items[n])
  }
  useInput((input, key) => {
    const cur = Math.min(at.current, Math.max(items.length - 1, 0))
    if (key.upArrow) move(-1)
    else if (key.downArrow) move(1)
    else if (key.return && items[cur] && !items[cur].disabled) onSelect(items[cur])
    else if (/^[1-9]$/.test(input) && items[Number(input) - 1] && !items[Number(input) - 1].disabled) {
      set(Number(input) - 1)
      onSelect(items[Number(input) - 1])
    }
  }, { isActive })
  const nums = numbered || look.accessible
  const start = Math.max(0, Math.min(idx - Math.floor(maxVisible / 2), items.length - maxVisible))
  const shown = items.slice(start, start + maxVisible)
  return html`<${Box} flexDirection="column">
    ${start > 0 ? html`<${Text} dimColor>  ${asciiKeys('↑')} more<//>` : null}
    ${shown.map((it, k) => {
      const on = start + k === idx
      const n = start + k + 1
      return html`<${Box} key=${String(it.value ?? it.label) + k}>
        <${Text} color=${on ? color.accent : undefined} bold=${on}>${on ? sym.pointer : ' '} <//>
        ${nums && n <= 9 ? html`<${Text} bold=${on}>${n}${look.accessible ? '.' : ''} <//>` : null}
        <${Text} bold=${on} dimColor=${!!it.disabled} wrap="truncate-end">${it.label}${look.accessible && on ? ' (selected)' : ''}${!describe && it.hint ? html`<${Text} dimColor>  ${it.hint}<//>` : null}<//>
      <//>`
    })}
    ${start + maxVisible < items.length ? html`<${Text} dimColor>  ${asciiKeys('↓')} more<//>` : null}
    ${describe && items[idx]?.hint ? html`<${Box} marginTop=${1} paddingLeft=${2}><${Text} dimColor wrap="wrap">${items[idx].hint}<//><//>` : null}
  <//>`
}

/**
 * Text field with a cursor: ←→, Home/End (Ctrl+A/E), Backspace, Ctrl+U
 * clears. Ctrl+J or Alt+Enter starts a new line (Shift+Enter where the
 * terminal sends it apart from Enter); Enter sends. Pastes (and files
 * dragged into the terminal) arrive as one chunk — or, with bracketed
 * paste on (index.mjs), between ESC[200~ and ESC[201~; a pasted line break
 * never sends. `onPaste(text)` may take a paste (dropped files, a long
 * block) by returning true. "?" in an empty field opens the help (unless
 * `noHelp`). `onHistory(-1|1)` gets ↑/↓ when the field is empty.
 */
export function TextField({ value, onChange, onSubmit, mask = false, placeholder = '', isActive = true, onTab, prefix, onPaste, onBackspaceEmpty, onHistory, noHelp = false, multiline = false }) {
  const [cur, setCur] = useState(value.length)
  // Refs as well as state: a paste followed at once by Enter must submit the pasted text.
  const st = useRef({ value, cur: value.length })
  if (st.current.value !== value && !st.current.pending) st.current = { value, cur: Math.min(st.current.cur, value.length) }
  st.current.pending = false
  const pos = Math.min(cur, value.length)
  const typing = useContext(TypingContext)
  const app = useContext(AppContext)
  useEffect(() => {
    if (!isActive) return undefined
    typing.current++
    return () => { typing.current-- }
  }, [isActive])
  const put = (v, c) => { st.current = { value: v, cur: c, pending: v !== value }; if (v !== value) onChange(v); setCur(c) }
  const paste = useRef(null) // text of a bracketed paste still arriving
  const insert = (text, raw = false) => {
    const { value: v, cur: c0 } = st.current
    const c = Math.min(c0, v.length)
    if (!raw && onPaste && text.length > 1 && onPaste(text)) return
    const t = raw ? text : text.replace(/\r\n|\r|\n/g, ' ')
    put(v.slice(0, c) + t + v.slice(c), c + t.length)
  }
  useInput((input, key) => {
    // Bracketed paste: collect everything up to the end marker, Enter included.
    if (input === '[200~' || input.startsWith('[200~')) { paste.current = input.slice(5); return }
    if (paste.current !== null) {
      const end = input.indexOf('[201~')
      if (end < 0) { paste.current += key.return ? '\n' : input; return }
      const text = paste.current + input.slice(0, end)
      paste.current = null
      return insert(text)
    }
    if (input === '[201~') return
    const { value: v, cur: c0 } = st.current
    const c = Math.min(c0, v.length)
    // A new line: Ctrl+J (a line feed), Alt+Enter.
    if (multiline && ((input === '\n' && !key.return) || (key.return && key.meta))) return insert('\n', true)
    if (key.return) return onSubmit?.(v)
    if (key.tab) {
      if (!onTab) return
      const next = onTab(v)
      if (typeof next === 'string' && next !== v) put(next, next.length)
      return
    }
    if ((key.upArrow || key.downArrow) && onHistory && !v.includes('\n')) return onHistory(key.upArrow ? -1 : 1)
    if (key.leftArrow) return put(v, Math.max(0, c - 1))
    if (key.rightArrow) return put(v, Math.min(v.length, c + 1))
    if (key.home || (key.ctrl && input === 'a')) return put(v, 0)
    if (key.end || (key.ctrl && input === 'e')) return put(v, v.length)
    if (key.ctrl && input === 'u') return put('', 0)
    if (key.backspace || key.delete) return c ? put(v.slice(0, c - 1) + v.slice(c), c - 1) : (!v ? onBackspaceEmpty?.() : undefined)
    if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return
    if (!input) return
    // "?" in an empty field: the help (a question mark inside a question is typed).
    if (input === '?' && !v && !mask && !noHelp && app?.openHelp) return app.openHelp()
    insert(input)
  }, { isActive })
  const shown = mask ? sym.mask.repeat(value.length) : value
  const pre = prefix ?? `${sym.prompt} `
  if (!value && placeholder) {
    return html`<${Text}><${Text} color=${color.accent}>${pre}<//>${isActive ? html`<${Text} inverse> <//>` : ''}<${Text} dimColor>${placeholder}<//><//>`
  }
  return html`<${Text} wrap="wrap"><${Text} color=${color.accent}>${pre}<//>${shown.slice(0, pos)}${isActive ? html`<${Text} inverse>${shown[pos] === '\n' ? ' \n' : shown[pos] || ' '}<//>` : shown[pos] || ''}${shown.slice(pos + 1)}<//>`
}

/** A labelled field with an explanation underneath (forms and the setup wizard). */
export function Field({ label, help, children }) {
  return html`<${Box} flexDirection="column" marginBottom=${1}>
    <${Text} bold>${label}<//>
    ${children}
    ${help ? html`<${Text} dimColor wrap="wrap">${help}<//>` : null}
  <//>`
}

/** Short status line, always with a mark AND a word-level meaning: ✓ / ! / ✗. */
export function Note({ kind = 'info', children }) {
  const mark = kind === 'ok' ? sym.ok : kind === 'bad' ? sym.bad : kind === 'warn' ? '!' : sym.bullet
  const c = kind === 'ok' ? color.ok : kind === 'bad' ? color.bad : kind === 'warn' ? color.warn : color.accent
  const label = look.accessible ? (kind === 'bad' ? 'error: ' : kind === 'warn' ? 'warning: ' : '') : ''
  return html`<${Text} wrap="wrap"><${Text} color=${c} bold>${mark} <//>${label}${children}<//>`
}

/**
 * An error in three parts: what happened · why · what to do; the raw
 * details only on request (d). `err` is { what, why, todo, details } (api.mjs errorParts).
 */
export function ErrorBox({ err, isActive = false }) {
  const [open, setOpen] = useState(false)
  useInput((input) => { if (input === 'd' && err?.details) setOpen((o) => !o) }, { isActive: isActive && !!err?.details })
  if (!err) return null
  return html`<${Box} flexDirection="column" borderStyle=${look.accessible ? undefined : look.border} borderColor=${color.bad} paddingX=${look.accessible ? 0 : 1}>
    <${Text} wrap="wrap"><${Text} color=${color.bad} bold>${sym.bad} ${look.accessible ? 'error: ' : ''}<//><${Text} bold>${err.what}<//><//>
    ${err.why ? html`<${Text} wrap="wrap" dimColor>${err.why}<//>` : null}
    ${err.todo ? html`<${Text} wrap="wrap">${err.todo}<//>` : null}
    ${err.details && isActive ? html`<${Text} dimColor wrap="truncate-end">${open ? err.details : 'd: show details'}<//>` : null}
  <//>`
}

/** "~/Clients/…/Alpine": a path shortened in the middle to fit `max`. */
export function fitPath(p, max = 32) {
  const s = String(p || '')
  if (s.length <= max) return s
  const parts = s.split('/')
  const first = parts[0] // "~", "" (from "/") or "C:"
  let tail = parts[parts.length - 1]
  for (let i = parts.length - 2; i >= 1; i--) {
    const next = `${parts[i]}/${tail}`
    if (`${first}/${sym.ell}/${next}`.length > max) break
    tail = next
  }
  const out = `${first}/${sym.ell}/${tail}`
  return out.length <= max ? out : `${sym.ell}${s.slice(-(max - 1))}`
}

/** Make sure a key line names the help and the way back. */
export function footerKeys(keys, { noBack = false } = {}) {
  let k = keys || `↑↓ move ${sym.sep} Enter choose ${sym.sep} Esc back`
  if (!noBack && !/\bEsc\b/i.test(k)) k += ` ${sym.sep} Esc back`
  if (!/\?\s*help/i.test(k)) k += ` ${sym.sep} ? help`
  return asciiKeys(k)
}

/** Arrow and dash characters in key hints and chrome, as plain ASCII when the terminal needs it. */
export function asciiKeys(s) {
  if (!look.ascii) return s
  return String(s).replace(/↑↓/g, 'Up/Down').replace(/↑/g, 'Up').replace(/↓/g, 'Down').replace(/←/g, 'Left').replace(/→/g, 'Right').replace(/—/g, '-').replace(/…/g, '...').replace(/·/g, '|').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
}

/**
 * The screen frame: breadcrumbs on top ("OpenLex › Alpine share deal ›
 * Review"), the body, and at the bottom the status bar (matter · working
 * folder · working as / which AI / where client data may go) and this
 * screen's keys — never hidden. Small windows drop the AI line first, then
 * the client-data line; below 60 columns only a request to widen it.
 */
export function Frame({ title, subtitle, crumbs, status, keys, noBack = false, children }) {
  const { cols, rows } = useSize()
  const app = useContext(AppContext)
  const s = Object.fromEntries(Object.entries(status || {}).map(([k, v]) => [k, typeof v === 'string' ? asciiKeys(v) : v]))
  if (cols < MIN_COLS) {
    return html`<${Box} flexDirection="column" width=${cols} paddingX=${1}>
      <${Text} bold>OpenLex<//>
      <${Text} wrap="wrap">${asciiKeys('Window too small — please make it wider')} (at least ${MIN_COLS} columns).<//>
    <//>`
  }
  const trail = [...(crumbs || []), ...(title ? [title] : [])].map(asciiKeys)
  const showAi = rows >= 24
  const showData = rows >= 18
  const foot = app?.quitArmed ? 'Press Ctrl+C again to quit' : footerKeys(keys, { noBack })
  const folder = s.folder ? fitPath(s.folder, Math.max(Math.floor(cols / 3), 20)) : ''
  // One row short of the terminal: a frame as tall as the screen makes Ink redraw everything.
  return html`<${Box} flexDirection="column" width=${cols} height=${rows - 1} paddingX=${1}>
    <${Box}>
      <${Text} color=${color.accent} bold>OpenLex<//>
      ${trail.map((t, i) => html`<${Text} key=${i} wrap="truncate-end"><${Text} dimColor> ${sym.crumb} <//><${Text} bold=${i === trail.length - 1}>${t}<//><//>`)}
      ${subtitle ? html`<${Text} dimColor wrap="truncate-end">  ${subtitle}<//>` : null}
    <//>
    <${Box} flexDirection="column" flexGrow=${1} marginTop=${1} overflow="hidden">${children}<//>
    ${look.accessible ? html`<${Text}> <//>` : html`<${Text} dimColor>${sym.rule.repeat(Math.max(cols - 2, 10))}<//>`}
    <${Text} wrap="truncate-end">
      <${Text} dimColor>Matter: <//>${s.matter || 'none'}${folder ? html`<${Text}><${Text} dimColor>  ${sym.sep}  Working in: <//>${folder}<//>` : null}${s.agent ? html`<${Text}><${Text} dimColor>  ${sym.sep}  Working as: <//>${s.agent}<//>` : null}
    <//>
    ${showAi ? html`<${Text} wrap="truncate-end"><${Text} dimColor>AI: <//>${s.model || 'not set up yet'}${s.busy ? html`<${Text} dimColor>  ${sym.sep}  working${sym.ell}<//>` : null}<//>` : null}
    ${showData ? html`<${Text} wrap="truncate-end"><${Text} dimColor>Client data: <//>${s.data || 'stays on this computer'}<//>` : null}
    <${Text} dimColor=${!app?.quitArmed} bold=${!!app?.quitArmed} wrap="truncate-end">${foot}<//>
  <//>`
}

/** BORDER for older imports: the current border style. */
export const borderStyle = () => (look.accessible ? undefined : look.border)
