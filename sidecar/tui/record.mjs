/**
 * The AI record (/record, Ctrl+K, or the matter menu): what the AI did —
 * when, from which window, which AI service and where it ran, whether
 * names were hidden, what was looked up online, permission decisions, the
 * result — never any client content. The same summary line as the Word
 * pane, a list of entries with the highlighted one's details underneath,
 * and keys to show only what left this computer (l), export (p PDF,
 * c CSV) and check that nothing was changed (v). Esc goes back.
 * Built from GET /api/record (record.js in the engine).
 */

import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, Spinner, Note, color, sym, useSize, fitPath } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { recordHead, recordSummaryLine, asciiText } from './cli.mjs'

export function RecordView({ matterId = null }) {
  const ctx = useAppCtx()
  const { rows, cols } = useSize()
  const [data, setData] = useState(null)
  const [left, setLeft] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState('')
  const [at, setAt] = useState(0)
  const [matter, setMatter] = useState(null)

  const load = async (onlyLeft = left) => {
    try {
      const r = await ctx.api.record({ matterId, left: onlyLeft ? '1' : '', limit: 200 })
      setData(r)
      setAt(0)
      setError('')
    } catch (err) { setError(err.message); setData({ entries: [], summary: null }) }
  }
  useEffect(() => {
    load()
    if (matterId) ctx.api.matters().then((m) => setMatter((m.matters || []).find((x) => x.id === matterId) || null)).catch(() => {})
  }, [matterId])

  const exportAs = async (format) => {
    setBusy(`Saving the AI record as ${format.toUpperCase()}…`)
    try {
      const r = await ctx.api.recordExport({ matterId, left, format })
      setNote({ kind: 'ok', text: `Saved (${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}): ${fitPath(r.file, cols - 24)}` })
    } catch (err) { setNote({ kind: 'bad', text: err.message }) }
    setBusy('')
  }
  const check = async () => {
    setBusy('Checking that nothing in the record was changed…')
    try {
      const v = await ctx.api.recordVerify()
      setNote({ kind: v.ok ? 'ok' : 'bad', text: `${v.text} Fingerprint: ${v.fingerprint}` })
      setData((d) => (d ? { ...d, verify: { ok: v.ok, text: v.text, fingerprint: v.fingerprint } } : d))
    } catch (err) { setNote({ kind: 'bad', text: err.message }) }
    setBusy('')
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') return ctx.back()
    if (busy) return
    if (input === 'l') { const next = !left; setLeft(next); setNote(null); load(next); return }
    if (input === 'p') return exportAs('pdf')
    if (input === 'c') return exportAs('csv')
    if (input === 'v') return check()
  })

  let body
  if (data === null) body = html`<${Spinner} label="Loading the AI record…" />`
  else {
    const entries = data.entries || []
    const cur = entries[Math.min(at, Math.max(entries.length - 1, 0))]
    // Fit 80×24: the frame takes 8 rows; then the summary, the filter line, a note, the list, the details.
    const width = Math.max(cols - 6, 20)
    const tall = (t) => Math.max(1, Math.ceil(String(t).length / width))
    const listRows = Math.max(Math.min(entries.length, rows - 20), Math.min(entries.length, 3))
    let room = rows - 8 - tall(recordSummaryLine(data)) - 1 - (busy || note ? tall(note?.text || busy) : 0) - (error ? 1 : 0) - 1 - listRows - (entries.length > listRows ? 2 : 0) - 1
    let detailRows = 0
    for (const l of cur?.lines || []) { const h = tall(`! ${l}`); if (room - h < (detailRows + 1 < (cur.lines.length) ? 1 : 0)) break; room -= h; detailRows++ }
    const items = entries.map((x, i) => ({ value: i, label: recordHead(x) }))
    body = html`<${Box} flexDirection="column">
      <${Box} flexShrink=${0}><${Text} wrap="wrap" bold>${recordSummaryLine(data)}<//><//>
      <${Text} dimColor wrap="truncate-end">${left ? `Showing only what left this computer (l: show everything)` : asciiText('Showing everything · ! = something left this computer (l: only those)')}<//>
      ${error ? html`<${Note} kind="bad">${error}<//>` : null}
      ${busy ? html`<${Spinner} label=${busy} />` : note ? html`<${Note} kind=${note.kind}>${asciiText(note.text)}<//>` : null}
      ${!entries.length
        ? html`<${Box} marginTop=${1}><${Text} dimColor wrap="wrap">${left ? 'Nothing left this computer in this selection.' : 'Nothing recorded yet. Each question and each larger piece of work is listed here: when, which AI and where it ran, what was looked up online, and every permission decision — never the content.'}<//><//>`
        : html`<${Box} flexDirection="column" marginTop=${1}>
          <${Menu} items=${items} maxVisible=${listRows} isActive=${!busy} onHighlight=${(it) => setAt(it.value)} onSelect=${(it) => setAt(it.value)} />
          <${Box} flexDirection="column" marginTop=${1}>
            ${cur.lines.slice(0, detailRows).map((l, i) => html`<${Box} key=${i} paddingLeft=${2}><${Text} wrap="wrap" color=${/sent outside|^Looked up online/.test(l) ? color.warn : undefined}>${/sent outside|^Looked up online/.test(l) ? '! ' : ''}${asciiText(l)}<//><//>`)}
            ${cur.lines.length > detailRows ? html`<${Text} dimColor>  ${sym.ell} ${cur.lines.length - detailRows} more (export for the full record)<//>` : null}
          <//>
        <//>`}
    <//>`
  }
  return html`<${Frame} title="AI record" subtitle=${matterId ? matter?.title || '' : 'all matters'} status=${ctx.status(matter)} keys=${`↑↓ choose ${sym.sep} l only sent outside ${sym.sep} p PDF ${sym.sep} c CSV ${sym.sep} v check ${sym.sep} Esc back`}>${body}<//>`
}
