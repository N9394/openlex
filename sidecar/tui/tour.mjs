/**
 * The first-run tour: three short screens after setup — what OpenLex can
 * do, how to ask, where the data goes. Enter or → next, ← back, Esc skips.
 * Shown once (prefs.tourDone); "t" in the help shows it again.
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, color, sym } from './ui.mjs'
import { useAppCtx } from './context.mjs'

export const PAGES = [
  {
    title: 'What OpenLex can do',
    lines: [
      'Answer questions about your documents and the law, with the sources it used.',
      'Review contracts against a checklist, build chronologies, translate, compare drafts.',
      'Work in the folder you started it in: it reads the documents there and asks before it saves, renames or deletes anything.',
    ],
  },
  {
    title: 'How to ask',
    lines: [
      'Type a question in plain words and press Enter. For example:',
      '  “Summarise the contract in this folder”',
      '  “Which deadlines are in these documents?”',
      'Drag a file into the window to ask about it. Type / for commands, ? for help.',
    ],
  },
  {
    title: 'Where your data goes',
    lines: [
      'Everything is kept on this computer. A question goes to an online AI service only if your client-data rule allows it.',
      'Below every answer one line says where the data went: “Stayed on this computer” or “Sent to: …”.',
      'Privileged matters never leave this computer, whatever the settings say.',
    ],
  },
]

export function Tour({ firstRun = false }) {
  const ctx = useAppCtx()
  const [i, setI] = useState(0)
  const done = () => {
    ctx.setPrefs({ tourDone: true })
    if (firstRun) return ctx.afterTour()
    ctx.back()
  }
  useInput((input, key) => {
    if (key.escape || input === 's') return done()
    if (key.return || key.rightArrow) return i < PAGES.length - 1 ? setI(i + 1) : done()
    if (key.leftArrow && i > 0) setI(i - 1)
  })
  const p = PAGES[i]
  return html`<${Frame} title=${`Welcome (${i + 1} of ${PAGES.length})`} status=${ctx.status()} keys=${`Enter ${i < PAGES.length - 1 ? 'next' : 'start'} ${sym.sep} ← back ${sym.sep} Esc skip the tour`}>
    <${Text} bold color=${color.accent}>${p.title}<//>
    <${Box} flexDirection="column" marginTop=${1}>
      ${p.lines.map((l, k) => html`<${Box} key=${k} marginBottom=${l.startsWith('  ') && !p.lines[k + 1]?.startsWith('  ') ? 1 : l.startsWith('  ') || p.lines[k + 1]?.startsWith('  ') ? 0 : 1}>
        <${Box} width=${2} flexShrink=${0}><${Text} color=${color.accent}>${l.startsWith('  ') ? ' ' : sym.bullet}<//><//>
        <${Box} flexGrow=${1}><${Text} wrap="wrap">${l.trim()}<//><//>
      <//>`)}
    <//>
    <${Text} dimColor>${PAGES.map((_, k) => (k === i ? sym.ok : sym.bullet)).join(' ')}<//>
  <//>`
}
