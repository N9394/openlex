/**
 * Friendly output for the plain commands (`openlex ask`, `review`,
 * `chronology`, `translate`, `compare`): the same plain sentences as the
 * terminal app (explain.mjs) instead of raw step text, a one-line spinner
 * with the time so far while OpenLex works (only in a terminal, never with
 * reduced motion), and at the end what the answer is based on and where
 * the data went. The answer itself goes to stdout; everything else to
 * stderr, so `openlex ask … > answer.txt` keeps only the answer.
 */

import { sym, look } from './theme.mjs'
import { startActivity, applyEvent, explainStep, basedOnLines, doneLines, startWork, applyProgress, dataLine, duration, clock } from './explain.mjs'
import { friendly } from './api.mjs'

const plain = (segs) => segs.map((g) => g.t).join('')

/** A spinner line on a terminal (stderr) that can be paused for a question. */
function liveLine(out, { tty, now }) {
  let text = ''
  let started = 0
  let timer = null
  let i = 0
  const anim = tty && !look.reducedMotion
  const draw = () => { if (!text) return; out.write(`\r\x1b[2K${sym.spin[i++ % sym.spin.length]} ${text} (${duration(now() - started)})`) }
  return {
    set(t) {
      text = t
      started = now()
      if (!anim) return
      draw()
      if (!timer) { timer = setInterval(draw, 100); timer.unref?.() }
    },
    clear() { if (anim && text) out.write('\r\x1b[2K'); clearInterval(timer); timer = null; text = '' },
  }
}

/**
 * For `openlex ask`: onEvent(ev) for every engine event except the answer
 * text (the caller writes that to stdout and tells us with wrote()),
 * pause()/resume() around a permission question, finish() at the end.
 */
export function askPrinter({ out = process.stderr, tty = !!out.isTTY, now = clock.now } = {}) {
  let act = startActivity(now())
  const line = liveLine(out, { tty, now })
  let shown = '' // the step last printed
  let writing = false
  const show = () => {
    const cur = act.steps.findLast((s) => s.status === 'now' || s.status === 'failed')
    if (!cur || writing) return
    if (cur.text === shown) return
    shown = cur.text
    if (tty && !look.reducedMotion && cur.status === 'now') { line.set(cur.text); return }
    line.clear()
    out.write(`  ${cur.failed || cur.status === 'failed' ? '!' : sym.bullet} ${cur.text}\n`)
  }
  return {
    onEvent(ev) {
      act = applyEvent(act, ev, now())
      if (ev.type === 'step' || ev.type === 'skill' || ev.type === 'warning') show()
      if (ev.type === 'error') { line.clear(); out.write(`${sym.bad} ${friendly(ev.message)}\n`) }
    },
    /** The answer started: the spinner goes, the text has the screen. */
    wrote() { if (!writing) { line.clear(); writing = true } },
    pause() { line.clear() },
    resume() { shown = ''; show() },
    finish({ stopped = false } = {}) {
      line.clear()
      act = applyEvent(act, { type: 'done', ...(stopped ? { stopped: true } : {}) }, now())
      const L = [...basedOnLines(act, 78).map(plain).filter((l) => !/Ctrl\+B/.test(l)), ...doneLines(act, 78).map(plain)]
      out.write(`${writing ? '\n' : ''}${L.join('\n')}\n`)
      return act
    },
    get activity() { return act },
  }
}

/** For the workflows: "Document 3 of 12: Lease 3.docx", then the saved files and where the data went. */
export function workPrinter(kind, { out = process.stderr, tty = !!out.isTTY, now = clock.now } = {}) {
  let w = startWork(kind, [], now())
  const line = liveLine(out, { tty, now })
  let last = ''
  return {
    onEvent(ev) {
      w = applyProgress(w, ev, now())
      if (ev.type === 'error') { line.clear(); out.write(`${sym.bad} ${friendly(ev.message)}\n`); return }
      if (ev.type !== 'progress') return
      const cur = w.items.find((x) => x.status === 'now')
      const unit = kind === 'translate' ? 'Part' : 'Document'
      const t = w.total && (cur || ev.name) ? `${unit} ${Math.min(w.done + 1, w.total)} of ${w.total}: ${cur?.name || ev.name}` : w.note || (ev.kind || ev.tool ? explainStep(ev).text : '')
      if (!t || t === last) return
      last = t
      if (tty && !look.reducedMotion) line.set(t)
      else out.write(`  ${sym.bullet} ${t}\n`)
    },
    finish(done) {
      line.clear()
      w = applyProgress(w, done || { type: 'done' }, now())
      const L = []
      if (done) {
        const stats = Object.entries(done.stats || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${v} ${k}`)
        L.push(`${sym.ok} Done after ${duration((w.endedAt || now()) - w.startedAt)}${stats.length ? `: ${stats.join(', ')}` : ''}${done.files?.length ? ` ${sym.sep} saved ${done.files.length} file${done.files.length === 1 ? '' : 's'} (listed below)` : ''}`)
      }
      const d = dataLine(w.models, w.online)
      L.push(`${d.left ? '!' : sym.ok} ${d.text}`)
      out.write(`${L.join('\n')}\n`)
      return w
    },
  }
}

// ── the AI record (`openlex record`, and the terminal app's record view) ──
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The engine's sentences in plain ASCII when the terminal needs it. */
export function asciiText(s) {
  if (!look.ascii) return String(s ?? '')
  return String(s ?? '').replace(/✓/g, '+').replace(/✗/g, 'x').replace(/[—–]/g, '-').replace(/…/g, '...').replace(/·/g, '|').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/×/g, 'x')
}

/** "29 Oct 2026 14:02" (fixed English, local time). */
export function recordWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "12 requests · 3 sent to Claude (Anthropic, EU), names hidden · … · record intact ✓" */
export function recordSummaryLine(r) {
  const v = r?.verify
  return asciiText(`${r?.summary?.text || 'Nothing recorded yet'}${v ? ` · ${v.ok ? `record intact ${sym.ok}` : `record changed ${sym.bad}`}` : ''}`)
}

/** One entry's first line: a mark that does not rely on colour, when, what, from where. */
export function recordHead(x) {
  const mark = x.outcome === 'failed' ? sym.bad : x.left ? '!' : sym.ok
  return asciiText(`${mark} ${recordWhen(x.at)} · ${x.title}${x.window ? ` (${x.window})` : ''}`)
}

/** The record as plain text for `openlex record`. */
export function recordText(r, { cmd = 'openlex record' } = {}) {
  const out = [asciiText(`AI record — ${r.matter ? r.matter.title || r.matter.id : 'all matters'}`), recordSummaryLine(r)]
  if (r.verify && !r.verify.ok) out.push(asciiText(`${sym.bad} ${r.verify.text}`))
  out.push('')
  if (!r.entries.length) out.push(r.total ? 'Nothing on this page.' : 'Nothing recorded for this selection yet. Each question and each larger piece of work is listed here.')
  for (const x of r.entries) {
    out.push(recordHead(x))
    for (const l of x.lines) out.push(`    ${asciiText(l)}`)
  }
  out.push('')
  if (r.nextCursor) out.push(`Showing ${r.entries.length} of ${r.total}. More: ${cmd} --limit ${Math.min(500, r.total)}`)
  out.push(asciiText(`! = something left this computer · Export: ${cmd} --export pdf · Check: ${cmd} --verify`))
  return out.join('\n')
}

/** `openlex record --verify` */
export function verifyText(v) {
  const out = [asciiText(`${v.ok ? sym.ok : sym.bad} ${v.text}`), `Fingerprint: ${v.fingerprint}`]
  for (const f of v.files) out.push(asciiText(`  ${f.ok ? sym.ok : sym.bad} ${f.name}: ${f.entries} line${f.entries === 1 ? '' : 's'}${f.broken ? ` — ${f.broken.why}` : ''}`))
  for (const f of v.files) for (const n of f.notes || []) out.push(asciiText(`  Note: ${n}`))
  out.push('This check finds changed, removed or moved lines. It cannot stop someone with access to this computer from rewriting the files; keep an export as proof.')
  return out.join('\n')
}
