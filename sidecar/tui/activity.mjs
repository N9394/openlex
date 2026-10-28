/**
 * Recent activity of a matter (matter menu → Recent activity, or
 * /activity in the chat): the last requests with when, what was asked,
 * what OpenLex looked at, where the data went and the result — a log a
 * lawyer can read. Built from the engine's activity records
 * (GET /api/activity: metadata only, never document text).
 */

import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, Spinner, Note, color, sym, useSize } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { describeRecord } from './explain.mjs'

export function RecentActivity({ matterId = null }) {
  const ctx = useAppCtx()
  const [records, setRecords] = useState(null)
  const [matter, setMatter] = useState(null)
  const [error, setError] = useState('')
  const [at, setAt] = useState(0)
  const { rows } = useSize()

  useEffect(() => {
    (async () => {
      try {
        const [a, m] = await Promise.all([ctx.api.activity(matterId, 20), matterId ? ctx.api.matters() : Promise.resolve({ matters: [] })])
        setRecords(a.activity || [])
        setMatter((m.matters || []).find((x) => x.id === matterId) || null)
      } catch (err) { setError(err.message); setRecords([]) }
    })()
  }, [matterId])
  useInput((input, key) => { if (key.escape || input === 'q') ctx.back() })

  let body
  if (records === null) body = html`<${Spinner} label="Loading what OpenLex did…" />`
  else if (error) body = html`<${Note} kind="bad">${error}<//>`
  else if (!records.length) body = html`<${Text} dimColor wrap="wrap">Nothing yet. Each question and each larger piece of work in this matter is listed here: what was asked, what OpenLex looked at, where the data went and the result.<//>`
  else {
    const described = records.map((r) => describeRecord(r))
    const cur = described[Math.min(at, described.length - 1)]
    const items = described.map((d, i) => ({ value: i, label: `${d.result === 'failed' ? sym.bad : d.result === 'stopped' ? '!' : sym.ok} ${d.title}`, hint: d.left ? 'sent outside' : '' }))
    body = html`<${Box} flexDirection="column">
      <${Menu} items=${items} maxVisible=${Math.max(rows - 18, 3)} onHighlight=${(it) => setAt(it.value)} onSelect=${(it) => setAt(it.value)} />
      <${Box} flexDirection="column" marginTop=${1} borderStyle="single" borderTop=${true} borderBottom=${false} borderLeft=${false} borderRight=${false} paddingTop=${0}>
        <${Text} bold wrap="truncate-end">${cur.title}${cur.took ? html`<${Text} dimColor>  ${sym.sep} took ${cur.took}<//>` : null}<//>
        ${cur.lines.map((l, i) => html`<${Text} key=${i} wrap="truncate-end" color=${l.startsWith('! ') ? color.warn : undefined} bold=${l.startsWith('! ')}>  ${l}<//>`)}
      <//>
    <//>`
  }
  return html`<${Frame} title="Recent activity" subtitle=${matter?.title || (matterId ? '' : 'quick questions')} status=${ctx.status(matter)} keys=${`↑↓ choose a request ${sym.sep} Esc back`}>${body}<//>`
}
