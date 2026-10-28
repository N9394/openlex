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
    out.write(`  ${cur.status === 'failed' ? '!' : sym.bullet} ${cur.text}\n`)
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
