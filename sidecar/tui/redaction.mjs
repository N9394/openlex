/**
 * The redaction check in the terminal: before a question or a file goes to
 * an online AI, a plain numbered list of what OpenLex will hide.
 *
 *   [x]  1  Johann Huber              Person
 *   [ ]  2  Eva Steiner               Person (unticked)
 *
 * Keys: a number then Enter switches that line on or off; + then text and
 * Enter adds something to hide (for the whole matter); s sends with these
 * hidden; Esc cancels (nothing is sent). The same check as the app and Word.
 */

import { useContext, useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, color, look } from './ui.mjs'
import { TypingContext } from './context.mjs'

const GROUPS = { people: 'People', orgs: 'Organisations', addresses: 'Addresses', ids: 'IDs & numbers', contact: 'Contact', other: 'Other' }
export const NOTE = 'OpenLex looks for names, numbers and addresses and hides what it finds. It can miss things, especially indirect details (a rare job title, a unique event). Please check before sending. Hidden text is replaced on your computer and restored in the answer.'
const MAX_ROWS = 40

/** The decisions for POST /api/redaction/confirm from the entries and the switches. */
export function decisions(entries, on, added) {
  return {
    off: entries.filter((x) => x.on && !on[x.key]).map((x) => x.key),
    on: entries.filter((x) => !x.on && on[x.key]).map((x) => x.key),
    add: added.map((text) => ({ text, kind: 'OTHER' })),
  }
}

export function RedactionPrompt({ review, onDone }) {
  const entries = review.entries || []
  const [on, setOn] = useState(() => Object.fromEntries(entries.map((x) => [x.key, !!x.on])))
  const [added, setAdded] = useState([])
  const [num, setNum] = useState('')
  const [adding, setAdding] = useState(null) // text being typed after "+"
  const [sent, setSent] = useState(false)
  const typing = useContext(TypingContext)
  useEffect(() => { typing.current++; return () => { typing.current-- } }, [])

  useInput((input, key) => {
    if (sent) return
    if (adding !== null) {
      if (key.escape) return setAdding(null)
      if (key.return) { const v = adding.replace(/\s+/g, ' ').trim(); if (v.length >= 2 && !added.includes(v)) setAdded((a) => [...a, v]); return setAdding(null) }
      if (key.backspace || key.delete) return setAdding((t) => t.slice(0, -1))
      if (input && !key.ctrl && !key.meta) setAdding((t) => t + input)
      return
    }
    if (key.escape) { setSent(true); return onDone(null) }
    if (/^\d$/.test(input)) return setNum((n) => (n + input).slice(-3))
    if (key.backspace || key.delete) return setNum((n) => n.slice(0, -1))
    if (key.return && num) {
      const x = entries[+num - 1]
      if (x) setOn((o) => ({ ...o, [x.key]: !o[x.key] }))
      return setNum('')
    }
    if (input === '+') return setAdding('')
    if (input === 's' || input === 'S') { setSent(true); onDone(decisions(entries, on, added)) }
  })

  let n = 0
  const rows = []
  for (const g of review.groups || Object.keys(GROUPS)) {
    const list = entries.filter((x) => x.group === g)
    if (!list.length) continue
    rows.push({ head: `${GROUPS[g] || g} (${list.length})` })
    for (const x of list) { n = entries.indexOf(x) + 1; rows.push({ n, x }) }
  }
  const shown = rows.slice(0, MAX_ROWS)
  const hidden = entries.filter((x) => on[x.key]).length + added.length
  return html`<${Box} justifyContent="center">
    <${Box} flexDirection="column" borderStyle=${look.accessible ? undefined : look.border} borderColor=${color.accent} paddingX=${1} width="94%">
      <${Text} bold color=${color.accent}>Check what is hidden before sending<//>
      <${Text} dimColor wrap="wrap">${NOTE}<//>
      ${review.basic ? html`<${Text} dimColor wrap="wrap">Basic detection: patterns, your matter's list, titles and company forms (the optional name finder is in the desktop app's Settings).<//>` : null}
      ${!entries.length ? html`<${Text} wrap="wrap">OpenLex found nothing to hide. Add something with +, or send with s.<//>` : null}
      ${shown.map((r, i) => (r.head
        ? html`<${Text} key=${i} dimColor>${r.head}<//>`
        : html`<${Text} key=${i} wrap="truncate-end">${on[r.x.key] ? '[x]' : '[ ]'} ${String(r.n).padStart(2)}  ${r.x.text.padEnd(30)}  <${Text} dimColor>${r.x.label}${r.x.count > 1 ? ` ×${r.x.count}` : ''}${r.x.confidence < 0.5 ? ' (not sure)' : ''}<//><//>`))}
      ${rows.length > MAX_ROWS ? html`<${Text} dimColor>… and ${rows.length - MAX_ROWS} more lines (all ticked as shown; the desktop app shows the full list)<//>` : null}
      ${added.map((a, i) => html`<${Text} key=${`a${i}`}>[x]  +  ${a}  <${Text} dimColor>added by you<//><//>`)}
      <${Box} marginTop=${1}>
        ${adding !== null
          ? html`<${Text}>Also hide: <${Text} color=${color.accent}>${adding}<//>▏ <${Text} dimColor>(Enter adds, Esc back)<//><//>`
          : html`<${Text} dimColor wrap="wrap">${num ? `Line ${num} — Enter switches it on or off. ` : ''}Number + Enter: on/off · + add text to hide · s send with these hidden (${hidden}) · Esc cancel<//>`}
      <//>
    <//>
  <//>`
}
