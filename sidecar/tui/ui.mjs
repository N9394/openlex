/**
 * Building blocks of the terminal app: theme (calm, one amber accent,
 * NO_COLOR respected), plain symbols with an ASCII fallback, and the few
 * widgets every screen uses — menu, text field, spinner, frame with the
 * status bar.
 *
 * No build step: htm gives JSX-like templates on plain React.createElement.
 */

import React, { useContext, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import htm from 'htm'
import { TypingContext } from './context.mjs'

export const html = htm.bind(React.createElement)

const env = process.env
export const NO_COLOR = env.NO_COLOR !== undefined && env.NO_COLOR !== ''
// Legacy Windows consoles (conhost: no braille or rounded corners in its
// fonts) and dumb terminals get plain ASCII. Windows Terminal sets
// WT_SESSION, VS Code / WezTerm TERM_PROGRAM, ConEmu ConEmuANSI.
// OPENLEX_ASCII=1 forces ASCII, OPENLEX_ASCII=0 forces the symbols.
const ASCII = env.OPENLEX_ASCII === '1' || (env.OPENLEX_ASCII !== '0' && (env.TERM === 'dumb' || (process.platform === 'win32' && !env.WT_SESSION && !env.TERM_PROGRAM && env.ConEmuANSI !== 'ON')))

/** Colours: amber accent sparingly; everything else is the terminal's own foreground (works light and dark). */
export const color = {
  accent: NO_COLOR ? undefined : '#d9a86c',
  ok: NO_COLOR ? undefined : 'green',
  bad: NO_COLOR ? undefined : 'red',
  warn: NO_COLOR ? undefined : 'yellow',
}

export const sym = ASCII
  ? { pointer: '>', ok: '+', bad: 'x', bullet: '-', sep: '|', down: 'v', on: '[x]', off: '[ ]', lock: '[privileged]', mask: '*', bar: '|', prompt: '>', rule: '-', spin: ['-', '\\', '|', '/'] }
  : { pointer: '▸', ok: '✓', bad: '✗', bullet: '•', sep: '·', down: '▾', on: '[x]', off: '[ ]', lock: '[privileged]', mask: '•', bar: '│', prompt: '›', rule: '─', spin: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] }
export const BORDER = ASCII ? 'classic' : 'round'

/** Terminal size, re-rendered on resize. Tests have no rows: 24 (the minimum we design for). */
export function useSize() {
  const { stdout } = useStdout()
  const get = () => ({ cols: Math.max(stdout?.columns || 80, 40), rows: Math.max(stdout?.rows || 24, 12) })
  const [size, setSize] = useState(get)
  useEffect(() => {
    if (!stdout?.on) return undefined
    const on = () => setSize(get())
    stdout.on('resize', on)
    return () => stdout.off?.('resize', on)
  }, [stdout])
  return size
}

export function Spinner({ label }) {
  const [i, setI] = useState(0)
  useEffect(() => { const t = setInterval(() => setI((x) => x + 1), 100); return () => clearInterval(t) }, [])
  return html`<${Text}><${Text} color=${color.accent}>${sym.spin[i % sym.spin.length]}<//> ${label || ''}<//>`
}

/**
 * A vertical list: ↑↓ (or j/k) move, Enter chooses, 1–9 jump. Items are
 * { label, value, hint?, disabled? }; with `describe` the highlighted item's
 * hint is shown underneath in full, else hints show dimmed on the line.
 */
export function Menu({ items, onSelect, onHighlight, isActive = true, initial = 0, describe = false, maxVisible = 12 }) {
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
    if (key.upArrow || input === 'k') move(-1)
    else if (key.downArrow || input === 'j') move(1)
    else if (key.return && items[cur] && !items[cur].disabled) onSelect(items[cur])
    else if (/^[1-9]$/.test(input) && items[Number(input) - 1] && !items[Number(input) - 1].disabled) {
      set(Number(input) - 1)
      onSelect(items[Number(input) - 1])
    }
  }, { isActive })
  const start = Math.max(0, Math.min(idx - Math.floor(maxVisible / 2), items.length - maxVisible))
  const shown = items.slice(start, start + maxVisible)
  return html`<${Box} flexDirection="column">
    ${start > 0 ? html`<${Text} dimColor>  ↑ more<//>` : null}
    ${shown.map((it, k) => {
      const on = start + k === idx
      return html`<${Box} key=${String(it.value ?? it.label) + k}>
        <${Text} color=${on ? color.accent : undefined} bold=${on}>${on ? sym.pointer : ' '} <//>
        <${Text} bold=${on} dimColor=${!!it.disabled} wrap="truncate-end">${it.label}${!describe && it.hint ? html`<${Text} dimColor>  ${it.hint}<//>` : null}<//>
      <//>`
    })}
    ${start + maxVisible < items.length ? html`<${Text} dimColor>  ↓ more<//>` : null}
    ${describe && items[idx]?.hint ? html`<${Box} marginTop=${1} paddingLeft=${2}><${Text} dimColor wrap="wrap">${items[idx].hint}<//><//>` : null}
  <//>`
}

/**
 * One-line text field with a cursor: ←→, Home/End (Ctrl+A/E), Backspace,
 * Ctrl+U clears. Pastes (and files dragged into the terminal) arrive as one
 * chunk; line breaks in them become spaces. `mask` hides what is typed;
 * `onTab` gets the value and returns a completed one.
 */
export function TextField({ value, onChange, onSubmit, mask = false, placeholder = '', isActive = true, onTab, prefix }) {
  const [cur, setCur] = useState(value.length)
  // Refs as well as state: a paste followed at once by Enter must submit the pasted text.
  const st = useRef({ value, cur: value.length })
  if (st.current.value !== value && !st.current.pending) st.current = { value, cur: Math.min(st.current.cur, value.length) }
  st.current.pending = false
  const pos = Math.min(cur, value.length)
  const typing = useContext(TypingContext)
  useEffect(() => {
    if (!isActive) return undefined
    typing.current++
    return () => { typing.current-- }
  }, [isActive])
  const put = (v, c) => { st.current = { value: v, cur: c, pending: v !== value }; if (v !== value) onChange(v); setCur(c) }
  useInput((input, key) => {
    const { value: v, cur: c0 } = st.current
    const c = Math.min(c0, v.length)
    if (key.return) return onSubmit?.(v)
    if (key.tab) {
      if (!onTab) return
      const next = onTab(v)
      if (typeof next === 'string' && next !== v) put(next, next.length)
      return
    }
    if (key.leftArrow) return put(v, Math.max(0, c - 1))
    if (key.rightArrow) return put(v, Math.min(v.length, c + 1))
    if (key.home || (key.ctrl && input === 'a')) return put(v, 0)
    if (key.end || (key.ctrl && input === 'e')) return put(v, v.length)
    if (key.ctrl && input === 'u') return put('', 0)
    if (key.backspace || key.delete) return c ? put(v.slice(0, c - 1) + v.slice(c), c - 1) : undefined
    if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return
    if (!input) return
    const text = input.replace(/\r\n|\r|\n/g, ' ')
    put(v.slice(0, c) + text + v.slice(c), c + text.length)
  }, { isActive })
  const shown = mask ? sym.mask.repeat(value.length) : value
  const pre = prefix ?? `${sym.prompt} `
  if (!value && placeholder) {
    return html`<${Text}><${Text} color=${color.accent}>${pre}<//>${isActive ? html`<${Text} inverse> <//>` : ''}<${Text} dimColor>${placeholder}<//><//>`
  }
  return html`<${Text} wrap="wrap"><${Text} color=${color.accent}>${pre}<//>${shown.slice(0, pos)}${isActive ? html`<${Text} inverse>${shown[pos] || ' '}<//>` : shown[pos] || ''}${shown.slice(pos + 1)}<//>`
}

/** A labelled field with an explanation underneath (forms and the setup wizard). */
export function Field({ label, help, children }) {
  return html`<${Box} flexDirection="column" marginBottom=${1}>
    <${Text} bold>${label}<//>
    ${children}
    ${help ? html`<${Text} dimColor wrap="wrap">${help}<//>` : null}
  <//>`
}

/** Short status line: ✓ / ✗ / note. */
export function Note({ kind = 'info', children }) {
  const mark = kind === 'ok' ? sym.ok : kind === 'bad' ? sym.bad : kind === 'warn' ? '!' : sym.bullet
  const c = kind === 'ok' ? color.ok : kind === 'bad' ? color.bad : kind === 'warn' ? color.warn : color.accent
  return html`<${Text} wrap="wrap"><${Text} color=${c} bold>${mark} <//>${children}<//>`
}

/**
 * The screen frame: title line, body, and the always-visible status bar
 * (matter · AI model · where client data may go · working as) plus keys.
 */
export function Frame({ title, subtitle, status, keys, children }) {
  const { cols, rows } = useSize()
  const s = status || {}
  // One row short of the terminal: a frame as tall as the screen makes Ink redraw everything.
  return html`<${Box} flexDirection="column" width=${cols} height=${rows - 1} paddingX=${1}>
    <${Box}>
      <${Text} color=${color.accent} bold>OpenLex<//>
      <${Text} dimColor> ${sym.sep} <//>
      <${Text} bold wrap="truncate-end">${title}<//>
      ${subtitle ? html`<${Text} dimColor wrap="truncate-end">  ${subtitle}<//>` : null}
    <//>
    <${Box} flexDirection="column" flexGrow=${1} marginTop=${1} overflow="hidden">${children}<//>
    <${Text} dimColor>${sym.rule.repeat(Math.max(cols - 2, 10))}<//>
    <${Text} wrap="truncate-end">
      <${Text} dimColor>Matter: <//>${s.matter || 'none'}${s.agent ? html`<${Text}><${Text} dimColor>  ${sym.sep}  Working as: <//>${s.agent}<//>` : null}
    <//>
    <${Text} wrap="truncate-end"><${Text} dimColor>AI model: <//>${s.model || 'not set up yet'}<//>
    <${Text} wrap="truncate-end"><${Text} dimColor>Client data: <//>${s.data || 'stays on this computer'}<//>
    <${Text} dimColor wrap="truncate-end">${keys || `↑↓ move ${sym.sep} Enter choose ${sym.sep} Esc back ${sym.sep} ? help ${sym.sep} Ctrl+C quit`}<//>
  <//>`
}
