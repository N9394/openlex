/**
 * What OpenLex is doing, in a lawyer's words. Every engine event becomes a
 * short sentence — never a tool name, JSON, a model id or engine jargon.
 *
 *   explainStep(ev)            one `step` event → { text, online?, failed?, hide? }
 *   startActivity / applyEvent the live list of steps for one question
 *   activityLines(act, …)      that list as screen lines (✓ done · ▸ now · waiting)
 *   dataLine(models, online)   "Sent to: Claude (Anthropic, EU) — names hidden · 2 times"
 *   basedOnLines(answer)       the "Based on:" block after an answer
 *   checkLine(suggestion)      "checked against ABGB § 933 ✓" / "could not be verified"
 *   startWork / applyProgress  documents of a review, chronology, grid, plan …
 *   timeLeft(…)                "about 2 minutes left"
 *
 * Pure functions (no React, no engine calls): the mapping tables are tested
 * one by one (test/tui.test.js). Unknown events get a sensible general
 * sentence, never the raw text.
 */

import { sym, color } from './ui.mjs'
import { friendly, NAMES } from './api.mjs'

/** The time source (tests set a fake one to show "about 2 minutes left"). */
export const clock = { now: () => Date.now() }

// ── words ───────────────────────────────────────────────────────────────

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const quoted = (s, n = 60) => (s ? `: “${clip(s, n)}”` : '')

/** Jurisdiction codes → the law in words ("Austrian law"). */
export const LAWS = {
  AT: 'Austrian law', DE: 'German law', CH: 'Swiss law', LI: 'Liechtenstein law', EU: 'EU law', FR: 'French law', IT: 'Italian law',
  ES: 'Spanish law', PT: 'Portuguese law', NL: 'Dutch law', BE: 'Belgian law', LU: 'Luxembourg law', PL: 'Polish law', CZ: 'Czech law',
  SK: 'Slovak law', HU: 'Hungarian law', SI: 'Slovenian law', HR: 'Croatian law', RO: 'Romanian law', BG: 'Bulgarian law', DK: 'Danish law',
  SE: 'Swedish law', FI: 'Finnish law', IE: 'Irish law', UK: 'English law', GB: 'English law', US: 'US law',
}
export const lawOf = (j) => LAWS[String(j || '').toUpperCase()] || 'the law'

/** "clause 4 (Liability)" from a clause heading like "4. Liability" or "§ 4 Haftung". */
export function clauseName(c) {
  if (!c) return 'a part of the document'
  const h = String(c.heading || '').trim()
  const m = /^(?:§+\s*|art(?:icle|\.)?\s*|clause\s*|ziffer\s*|punkt\s*)?(\d+(?:\.\d+)*)\.?\s*[-–:)]?\s*(.*)$/i.exec(h)
  if (m && m[2]) return `clause ${m[1]} (${clip(m[2], 40)})`
  if (m) return `clause ${m[1]}`
  if (h) return `the part “${clip(h, 40)}”`
  if (Number.isInteger(c.index)) return `part ${c.index + 1} of the document`
  return 'a part of the document'
}

const fileWord = (d) => (d?.file ? `“${clip(d.file, 40)}”` : 'a file')
const FORMATS = { csv: 'a spreadsheet (CSV)', xml: 'an XML', json: 'a data', md: 'a text', dat: 'a data', ics: 'a calendar', pdf: 'a PDF', docx: 'a Word', xlsx: 'an Excel' }

/**
 * Engine tool → what the lawyer reads. `online` names who received
 * something (search words or a web address) outside this computer.
 */
export const TOOL_WORDS = {
  get_document_map: () => ({ text: 'Looking at how the document is organised' }),
  get_range_text: (d) => ({ text: `Reading ${clauseName(d.clause)}` }),
  get_clause_analysis: (d) => ({ text: `Reading ${clauseName(d.clause)}` }),
  search_law: (d) => ({ text: `Searching ${lawOf(d.jurisdiction)}${quoted(d.query)}` }),
  get_law_section: () => ({ text: 'Reading the full text of a law section' }),
  search_ris: (d) => ({ text: `Checking the official source (RIS, Austria's federal law database)${quoted(d.query, 40)}`, online: 'RIS (Austria\'s federal law database)' }),
  search_eurlex: (d) => ({ text: `Checking the official source (EUR-Lex, the EU's law database)${quoted(d.query, 40)}`, online: 'EUR-Lex (the EU\'s law database)' }),
  get_eu_law: (d) => ({ text: `Reading EU law on EUR-Lex${d.article ? `, Article ${d.article}` : ''}`, online: 'EUR-Lex (the EU\'s law database)' }),
  web_fetch: (d) => ({ text: `Opening a web page: ${d.host || 'a website'}`, online: d.host || 'a website' }),
  web_save: (d) => ({ text: `Saving a web page into the matter: ${d.host || 'a website'}`, online: d.host || 'a website' }),
  download_to_matter: (d) => ({ text: `Downloading a file into the matter: ${d.host || 'a website'}`, online: d.host || 'a website' }),
  search_firm_library: () => ({ text: 'Looking through your firm\'s precedents' }),
  find_clause: () => ({ text: 'Looking through your firm\'s precedents' }),
  search_sources: (d) => ({ text: `Searching your firm's connected databases${quoted(d.query, 40)}` }),
  search_docs: (d) => ({ text: `Searching the matter's documents${quoted(d.query, 40)}` }),
  search_local_files: (d) => ({ text: `Searching your files folder${quoted(d.query, 40)}` }),
  read_file: (d) => ({ text: `Reading ${fileWord(d)} from your files folder` }),
  list_directory: () => ({ text: 'Looking at what is in your files folder' }),
  write_file: (d) => ({ text: `Saving ${fileWord(d)} in your files folder` }),
  append_file: (d) => ({ text: `Adding to ${fileWord(d)} in your files folder` }),
  export_document: (d) => ({ text: `Saving the result as ${FORMATS[String(d.format || '').toLowerCase()] || 'a'} file` }),
  sync_calendar: () => ({ text: 'Putting the deadlines into a calendar file' }),
  risk_scorecard: () => ({ text: 'Scoring the risks in the document' }),
  run_playbook: (d) => ({ text: `Checking the document against your firm's checklist${d.name ? ` “${clip(d.name, 30)}”` : ''}` }),
  run_bash: () => ({ text: 'Running a program on this computer' }),
  remember: () => ({ text: 'Making a note of an important point' }),
  recall: () => ({ text: 'Looking at its earlier notes' }),
  propose_suggestions: () => ({ text: 'Drafting proposed changes' }),
  delegate_task: () => ({ text: 'Working on one part of the question separately' }),
  // Housekeeping the lawyer need not see.
  get_tool_schemas: () => ({ hide: true }),
  tool_picker: () => ({ hide: true }),
  compress_context: () => ({ hide: true }),
}

/** A tool, including connectors ("mcp__dms__search" → "Using your connector “dms”"). */
export function explainTool(tool, detail = {}) {
  const t = String(tool || '')
  if (TOOL_WORDS[t]) return TOOL_WORDS[t](detail || {})
  const mcp = /^mcp(?:__|:)([^_:]+)/.exec(t)
  if (mcp) return { text: `Using your connector “${mcp[1]}”`, online: `your connector “${mcp[1]}”` }
  return { text: 'Working on your question' }
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)

/** What a failed step means for the answer. */
export function failedSentence(tool, detail = {}, offline = false) {
  if (tool === 'search_ris') return 'Couldn\'t reach RIS (Austria\'s federal law database); the answer uses the copy of the law on this computer instead.'
  if (tool === 'search_eurlex' || tool === 'get_eu_law') return 'Couldn\'t reach EUR-Lex; the answer uses the copy of EU law on this computer instead.'
  if (tool === 'search_law' || tool === 'get_law_section') return 'Couldn\'t search the law on this computer (the law collection may not be installed); the answer may cite less law than usual.'
  if (tool === 'web_fetch' || tool === 'web_save' || tool === 'download_to_matter') return `Couldn't open ${detail.host || 'the web page'}${offline ? ' (no connection)' : ''}; the answer goes on without it.`
  if (tool === 'search_firm_library' || tool === 'find_clause') return 'Couldn\'t search your firm\'s precedents; the answer goes on without them.'
  return `Couldn't finish this step (${lower(explainTool(tool, detail).text || 'a step')}); the answer goes on without it.`
}

/**
 * One `step` event → a sentence. Newer engines send kind/tool/detail;
 * older ones only text ("tool: search_law") — both work.
 */
export function explainStep(ev = {}) {
  let kind = ev.kind
  let tool = ev.tool
  const text = String(ev.text || '')
  if (!kind) {
    const m = /^(tool|blocked|declined|not allowed|failed):\s*(\S+)/.exec(text)
    if (m) { kind = { tool: 'tool', blocked: 'blocked', declined: 'declined', 'not allowed': 'not_allowed', failed: 'tool_failed' }[m[1]]; tool = tool || m[2] }
    else if (/^writing… \(truncated|retrying|rewrite must land/.test(text)) kind = 'retry'
    else if (/^writing/.test(text)) kind = 'writing'
    else if (/^judge: verifying/.test(text)) kind = 'judge'
    else if (/^judge: (\d+)\/(\d+)/.test(text)) { const j = /^judge: (\d+)\/(\d+)/.exec(text); return explainStep({ kind: 'judged', verified: +j[1], total: +j[2] }) }
    else if (/time limit/.test(text)) kind = 'timeout'
    else if (/rethinking/.test(text)) kind = 'rethink'
    else if (/searching local law packs/.test(text)) kind = 'law_search'
    else if (/temporarily unavailable/.test(text)) kind = 'model_unavailable'
    else if (/^delegating/.test(text)) kind = 'delegate'
    else if (/^dropped suggestion|garbage filter/.test(text)) kind = 'dropped'
  }
  const d = ev.detail || {}
  switch (kind) {
    case 'tool': return explainTool(tool, d)
    case 'writing': return { text: 'Writing the answer', phase: 'writing' }
    case 'retry': return { text: 'Writing the answer again (the first try was cut off)', phase: 'writing' }
    case 'judge': return { text: 'Checking each suggestion against the law it cites', phase: 'judge' }
    case 'judged': return { text: `Checked the suggestions: ${ev.verified} of ${ev.total} hold up`, phase: 'judge', judged: { verified: ev.verified, total: ev.total } }
    case 'timeout': return { text: 'Enough research for this question — writing the answer now', phase: 'writing' }
    case 'rethink': return { text: 'Trying a different approach' }
    case 'delegate': return { text: 'Working on one part of the question separately' }
    case 'blocked': return { text: `Not done — your firm's rules don't allow it: ${lower(explainTool(tool, d).text || 'this step')}`, failed: true }
    case 'not_allowed': return { text: `Not done — not allowed without asking you: ${lower(explainTool(tool, d).text || 'this step')}`, failed: true }
    case 'declined': return { text: `Not done — you said no: ${lower(explainTool(tool, d).text || 'this step')}`, failed: true }
    case 'tool_failed': return { text: failedSentence(tool, d, ev.offline), failed: true }
    case 'model_unavailable': return { text: 'The AI stopped responding; writing the answer with what was found so far', failed: true, phase: 'writing' }
    case 'law_search': case 'dropped': case 'filter': return { hide: true }
    default: return { text: 'Working on your question' }
  }
}

/** An `error` event: what went wrong and what it means for the answer. */
export function errorSentence(message, { partial = false } = {}) {
  const what = friendly(message)
  return `${what}${/[.!?]$/.test(what) ? '' : '.'} ${partial ? 'The answer stops here; what was written so far is kept.' : 'There is no answer this time.'}`
}

// ── where the data went ─────────────────────────────────────────────────

const isEu = (r) => /^(eu|europe)/i.test(String(r || ''))
const FAMILIES = [[/claude|anthropic/i, 'Claude'], [/gpt|^o\d|openai/i, 'GPT'], [/mistral|mixtral|magistral|codestral/i, 'Mistral'], [/gemini/i, 'Gemini'], [/llama/i, 'Llama'], [/qwen/i, 'Qwen']]

/** "Claude (Anthropic, EU)", "Mistral (EU)", "your firm's server" — never a model id. */
export function serviceName(m = {}) {
  if (m.local) return 'the AI on this computer'
  if (m.provider === 'custom') return 'your firm\'s AI server'
  const company = NAMES[m.provider] || clip(m.label || m.provider || 'an AI service', 30)
  const family = (FAMILIES.find(([re]) => re.test(String(m.model || '')) || (m.provider === 'anthropic' && re.test('claude'))) || [])[1]
  const region = m.region ? (isEu(m.region) ? 'EU' : /^us/i.test(m.region) ? 'USA' : clip(m.region, 16)) : ''
  const inner = [family && family !== company ? company : '', region].filter(Boolean).join(', ')
  const head = family && family !== company ? family : company
  return inner ? `${head} (${inner})` : head
}

/** Add one `model` event to the list of services used (same service → count). */
export function addModel(models, ev) {
  const key = `${ev.local ? 'local' : ev.provider}|${ev.region || ''}|${ev.redacted ? 1 : 0}`
  const out = models.map((m) => ({ ...m }))
  const hit = out.find((m) => m.key === key)
  if (hit) hit.calls++
  else out.push({ key, provider: ev.provider, label: ev.label, model: ev.model || null, local: !!ev.local, region: ev.region || null, redacted: !!ev.redacted, calls: 1 })
  return out
}

const times = (n) => (n === 1 ? 'once' : n === 2 ? '2 times' : `${n} times`)

/**
 * The "where your data went" line: { text, left } — `left` is true when
 * anything went outside this computer (shown in warning colour, with "!").
 */
export function dataLine(models = [], online = [], { running = false, unreported = '' } = {}) {
  const cloud = models.filter((m) => !m.local)
  const parts = []
  if (cloud.length) {
    parts.push(`Sent to: ${cloud.map((m) => `${serviceName(m)} — ${m.redacted ? 'names hidden' : 'names not hidden'} · ${times(m.calls)}`).join('; ')}`)
  }
  const web = [...new Set(online)]
  if (web.length) parts.push(`${cloud.length ? 'Also looked' : 'Looked'} up online: ${web.join(', ')} (only search words or web addresses)`)
  // An older engine does not report its AI calls: say what the rule allows instead of guessing.
  if (!parts.length && !models.length && unreported) return { text: unreported, left: true }
  if (!parts.length) return { text: running ? 'Nothing has left this computer so far' : 'Stayed on this computer', left: false }
  return { text: `${cloud.length ? '' : 'Your documents stayed on this computer. '}${parts.join('. ')}`, left: true }
}

// ── time ────────────────────────────────────────────────────────────────

/** "8 s", "1 min 5 s", "12 min". */
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m >= 10) return `${m} min`
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

/**
 * Time left from the items finished so far: { done, total, startedAt,
 * currentAt (when the current item began), now } → "about 2 minutes left".
 */
export function timeLeft({ done, total, startedAt, currentAt, now }) {
  if (!total || done >= total) return ''
  if (!done) return 'time left: known after the first one'
  const per = Math.max(((currentAt ?? now) - startedAt) / done, 1)
  const left = Math.max(per * (total - done) - (now - (currentAt ?? now)), per * 0.2)
  const s = left / 1000
  if (s < 45) return 'less than a minute left'
  if (s < 90) return 'about a minute left'
  if (s < 50 * 60) return `about ${Math.round(s / 60)} minutes left`
  const h = s / 3600
  return h < 1.5 ? 'about an hour left' : `about ${Math.round(h)} hours left`
}

// ── one question: the live list of steps ────────────────────────────────

export function startActivity(now = clock.now()) {
  return { startedAt: now, endedAt: null, steps: [{ text: 'Working out how to answer', status: 'now', at: now, phase: 'planning' }], models: [], online: [], sources: [], notes: [], clauses: [], suggestions: 0, judged: null, stopped: false, failed: false, waitingForYou: null }
}

const clone = (a) => ({ ...a, steps: a.steps.map((s) => ({ ...s })), online: [...a.online], sources: [...a.sources], notes: [...a.notes], clauses: [...a.clauses] })

function push(a, text, now, extra = {}) {
  const cur = a.steps.findLast((s) => s.status === 'now')
  if (cur && cur.text === text) { Object.assign(cur, extra); return }
  if (cur) { cur.status = cur.failed ? 'failed' : 'done'; cur.end = now }
  a.steps.push({ text, status: 'now', at: now, ...extra })
}

const finish = (a, now, status = 'done') => {
  for (const s of a.steps) if (s.status === 'now') { s.status = s.failed ? 'failed' : status; s.end = now }
  a.endedAt = a.endedAt || now
}

/** Fold one engine event into the activity (returns a new object). */
export function applyEvent(act, ev, now = clock.now()) {
  const a = clone(act)
  switch (ev.type) {
    case 'step': {
      const x = explainStep(ev)
      if (x.hide) return act
      if (x.online && !a.online.includes(x.online)) a.online.push(x.online)
      if (ev.detail?.clause && !a.clauses.some((c) => clauseName(c) === clauseName(ev.detail.clause))) a.clauses.push(ev.detail.clause)
      if (x.judged) a.judged = x.judged
      push(a, x.text, now, { ...(x.failed ? { failed: true } : {}), ...(x.phase ? { phase: x.phase } : {}) })
      return a
    }
    case 'text': {
      const cur = a.steps.findLast((s) => s.status === 'now')
      if (cur?.phase !== 'writing') push(a, 'Writing the answer', now, { phase: 'writing' })
      return a
    }
    case 'law': {
      const cur = a.steps.findLast((s) => s.status === 'now') || a.steps[a.steps.length - 1]
      const found = []
      for (const s of ev.sources || []) {
        const cite = clip([s.source_name, s.section].filter(Boolean).join(' '), 50)
        if (!a.sources.some((x) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section))) a.sources.push(s)
        if (cite && !found.includes(cite)) found.push(cite)
      }
      if (cur && found.length) cur.found = [...new Set([...(cur.found || []), ...found])]
      return a
    }
    case 'note': if (ev.claim || ev.entity) a.notes.push({ entity: ev.entity || '', claim: ev.claim || '', section: ev.section ?? '' }); return a
    case 'model': a.models = addModel(a.models, ev); return a
    case 'suggestion': a.suggestions++; return a
    case 'skill': push(a, `Following your firm's instructions “${clip(ev.title || ev.name, 40)}”`, now); return a
    case 'permission': a.waitingForYou = ev.summary || 'a step'; push(a, `Waiting for your answer: ${clip(ev.summary || 'may OpenLex go on?', 60)}`, now, { phase: 'ask' }); return a
    case 'permission_result': {
      a.waitingForYou = null
      const cur = a.steps.findLast((s) => s.status === 'now')
      if (cur?.phase === 'ask') { cur.text = ev.decision === 'deny' ? `Not allowed: ${cur.text.replace(/^Waiting for your answer: /, '')}` : `Allowed: ${cur.text.replace(/^Waiting for your answer: /, '')}`; cur.status = ev.decision === 'deny' ? 'failed' : 'done'; cur.end = now }
      return a
    }
    case 'warning': push(a, `Note from your firm's rules: ${clip(ev.message, 70)}`, now); return a
    case 'withheld': push(a, `Your firm's rules held this answer back: ${clip(ev.message, 60)}`, now, { failed: true }); finish(a, now); return a
    case 'error': a.failed = true; push(a, errorSentence(ev.message, { partial: a.steps.some((s) => s.phase === 'writing') }), now, { failed: true }); finish(a, now); return a
    case 'done': if (ev.stopped) a.stopped = true; finish(a, now); return a
    default: return act // reasoning, compact, agent, skill_suggestion: nothing for the lawyer to act on
  }
}

/** The stop explained: what was kept, and that nothing more is sent. */
export function stopSentence(act, answerText = '') {
  const words = String(answerText || '').trim().split(/\s+/).filter(Boolean).length
  const kept = [words ? `the answer so far (${words} word${words === 1 ? '' : 's'})` : '', act?.sources?.length ? `${act.sources.length} law section${act.sources.length === 1 ? '' : 's'} it found` : '', act?.suggestions ? `${act.suggestions} proposed change${act.suggestions === 1 ? '' : 's'}` : ''].filter(Boolean)
  return `Stopped by you. ${kept.length ? `Kept: ${kept.join(', ')}.` : 'Nothing was written yet.'} Nothing more is sent or saved.`
}

// ── screen lines ────────────────────────────────────────────────────────

const mark = (status) => (status === 'done' ? sym.ok : status === 'failed' ? '!' : status === 'now' ? sym.pointer : sym.bullet)
const markColor = (status) => (status === 'done' ? color.ok : status === 'failed' ? color.warn : status === 'now' ? color.accent : undefined)
const fit = (t, w) => (t.length > w ? `${t.slice(0, Math.max(w - 1, 1))}…` : t)

/** The data line as one screen line (segments). */
export function dataSegs(line) {
  return line.left
    ? [{ t: '! ', color: color.warn, bold: true }, { t: line.text, color: color.warn, bold: true }]
    : [{ t: `${sym.ok} `, color: color.ok, bold: true }, { t: line.text }]
}

/** The data line wrapped to the width — never cut off: it must not be missed. */
export function dataRows(line, width = 78) {
  const words = line.text.split(' ')
  const rows = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width - 2) { rows.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) rows.push(cur)
  return rows.map((t, i) => (line.left
    ? [{ t: i ? '  ' : '! ', color: color.warn, bold: true }, { t, color: color.warn, bold: true }]
    : [{ t: i ? '  ' : `${sym.ok} `, color: color.ok, bold: true }, { t }]))
}

/**
 * The live panel for one question: header, numbered steps (the last
 * `maxSteps`), what comes next, where the data went, how to stop.
 */
export function activityLines(act, { now = clock.now(), width = 78, maxSteps = 6, stopHint = 'the answer so far is kept' } = {}) {
  const L = []
  const running = !act.endedAt
  L.push([{ t: running ? 'OpenLex is working on it' : 'What OpenLex did', bold: true }, { t: ` ${sym.sep} ${duration((act.endedAt || now) - act.startedAt)}${running ? ' so far' : ''}`, dim: true }])
  const steps = act.steps
  const from = Math.max(steps.length - maxSteps, 0)
  if (from) L.push([{ t: `    … ${from} earlier step${from === 1 ? '' : 's'}`, dim: true }])
  steps.slice(from).forEach((s, k) => {
    const n = String(from + k + 1).padStart(2)
    const time = duration((s.end || now) - s.at)
    const room = width - n.length - 3 - time.length - 2
    L.push([{ t: `${n} ` }, { t: `${mark(s.status)} `, color: markColor(s.status), bold: true }, { t: fit(s.text, room).padEnd(room), bold: s.status === 'now' }, { t: `  ${time}`, dim: true }])
    if (s.found?.length) L.push([{ t: `      found: ${fit(s.found.join(', '), width - 13)}`, dim: true }])
  })
  if (running && !act.waitingForYou && !steps.some((s) => s.phase === 'writing')) L.push([{ t: `    ${sym.bullet} `, dim: true }, { t: 'Next: writing the answer', dim: true }])
  L.push(...dataRows(dataLine(act.models, act.online, { running, unreported: running ? '' : act.unreported }), width))
  if (running) L.push([{ t: `Esc stop ${sym.sep} ${stopHint}`, dim: true }])
  return L
}

/** After the answer: one line saying how long it took, then the data line. */
export function doneLines(act, width = 78) {
  const n = act.steps.length
  return [
    [{ t: `${act.stopped ? 'Stopped' : act.failed ? 'Ended early' : 'Done'} after ${duration((act.endedAt || act.startedAt) - act.startedAt)} ${sym.sep} ${n} step${n === 1 ? '' : 's'}`, dim: true }],
    ...dataRows(dataLine(act.models, act.online, { unreported: act.unreported }), width),
  ]
}

/** The cited law of a suggestion, in words ("ABGB § 933"). */
export function basisText(b) {
  if (!b) return ''
  if (typeof b === 'string') return clip(b, 60)
  return clip([b.source || b.source_name, b.section].filter(Boolean).join(' '), 60)
}

/** Was a proposed change checked? { text, ok } */
export function checkLine(s = {}) {
  const basis = basisText(s.basis)
  const v = s.verdict || {}
  if (s.citationWarning) return { text: `The cited section may be wrong (${clip(s.citationWarning, 60)}) — review carefully`, ok: false }
  if (s.collapseWarning) return { text: 'Much shorter than the original clause — check nothing important was dropped', ok: false }
  if (v.status === 'verified' && !/unverified|unavailable/i.test(v.note || '')) return { text: basis ? `checked against ${basis} ${sym.ok}` : `checked against your document ${sym.ok}`, ok: true }
  if (v.status === 'rewrite') return { text: `checked and corrected${basis ? ` (against ${basis})` : ''} ${sym.ok}`, ok: true }
  return { text: 'could not be verified — review carefully', ok: false }
}

/**
 * "Based on:" — every law section and document passage the answer used,
 * numbered, one line each. Returns [{ label, detail, kind, chunk_id? }].
 */
export function basedOn(act) {
  if (!act) return []
  const out = []
  for (const s of act.sources || []) out.push({ kind: 'law', label: clip([s.source_name, s.section].filter(Boolean).join(' ') || 'a law section', 50), detail: s.snippet || '', chunk_id: s.chunk_id || null })
  for (const c of act.clauses || []) out.push({ kind: 'doc', label: `Your document: ${clauseName(c)}`, detail: '' })
  for (const n of act.notes || []) out.push({ kind: 'note', label: `Noted${n.section !== '' && n.section !== undefined ? ` (clause ${n.section})` : ''}: ${clip([n.entity, n.claim].filter(Boolean).join(' — '), 60)}`, detail: n.claim || '' })
  return out
}

/** The "Based on:" block as screen lines. */
export function basedOnLines(act, width = 78, max = 5) {
  const items = basedOn(act)
  if (!items.length) return []
  const L = [[{ t: 'Based on:', bold: true }]]
  items.slice(0, max).forEach((it, i) => {
    const head = `  [${i + 1}] ${it.label}`
    const rest = it.detail ? ` — ${it.detail}` : ''
    L.push([{ t: fit(head, width) }, { t: fit(rest, Math.max(width - head.length, 0)), dim: true }])
  })
  L.push([{ t: `  ${items.length > max ? `… ${items.length - max} more. ` : ''}Ctrl+B or /sources: see each one in full`, dim: true }])
  return L
}

// ── larger work: documents of a review, chronology, grid, plan ──────────

const UNITS = { translate: 'Part', plan: 'Step' }

/** Start tracking a workflow; `names` (optional) are the documents known in advance. */
export function startWork(kind, names = [], now = clock.now()) {
  return { kind, startedAt: now, endedAt: null, total: names.length || 0, done: 0, currentAt: null, items: names.map((n) => ({ name: n, status: 'waiting' })), note: '', models: [], online: [], stopped: false }
}

const ensure = (w, name) => {
  let it = w.items.find((x) => x.name === name)
  if (!it) { it = { name, status: 'waiting' }; w.items.push(it) }
  return it
}

/** Fold one workflow event (progress, model, done, error) into the tracker. */
export function applyProgress(work, ev, now = clock.now()) {
  const w = { ...work, items: work.items.map((x) => ({ ...x })), online: [...work.online] }
  if (ev.type === 'model') { w.models = addModel(w.models, ev); return w }
  if (ev.type === 'done') { for (const it of w.items) if (it.status === 'now') { it.status = 'done'; it.end = now } w.endedAt = now; return w }
  if (ev.type === 'error') { for (const it of w.items) if (it.status === 'now') { it.status = 'failed'; it.end = now } w.endedAt = now; return w }
  if (ev.type !== 'progress') return work
  // A plan: its steps, and inside them the documents and the agent's steps.
  if (w.kind === 'plan' && ev.status) {
    const it = w.items.find((x) => x.id && x.id === ev.step) || ensure(w, ev.title || 'A step')
    it.id = ev.step
    if (ev.status === 'running') { it.status = 'now'; it.at = now; w.currentAt = now }
    else if (ev.status === 'done') { it.status = 'done'; it.end = now; w.done = w.items.filter((x) => x.status === 'done').length }
    else if (ev.status === 'failed') { it.status = 'failed'; it.end = now; it.note = ev.error ? friendly(ev.error) : '' }
    else if (ev.status === 'waiting') { it.status = 'now'; w.note = 'Waiting for your decision' }
    w.total = Math.max(w.total, w.items.length)
    return w
  }
  if (w.kind === 'plan') {
    if (ev.kind || ev.tool) { const x = explainStep(ev); if (!x.hide) w.note = x.text; if (x.online && !w.online.includes(x.online)) w.online.push(x.online) }
    else if (ev.name) w.note = `${ev.total ? `Document ${ev.index} of ${ev.total}: ` : ''}${ev.name}`
    return w
  }
  if (ev.step === 'cell') { w.note = `${clip(ev.document, 30)}: ${clip(ev.column, 30)}`; return w }
  if (ev.step === 'read') { w.note = 'Reading both versions'; return w }
  if (ev.step === 'rate') { w.note = `Rating how important each change is${ev.total ? ` (${ev.total} changes)` : ''}`; return w }
  if (!ev.total) return w
  w.total = ev.total
  if (w.kind === 'grid') {
    // The grid reports a document when it is finished.
    const it = ensure(w, ev.name)
    it.status = 'done'; it.end = now; it.at = it.at || w.currentAt || w.startedAt
    w.done = ev.index
    w.currentAt = now
    const next = w.items.find((x) => x.status === 'waiting')
    if (next && w.done < w.total) { next.status = 'now'; next.at = now }
    return w
  }
  if (w.kind === 'translate') {
    // Parts of one document: no list, only the count.
    w.done = Math.max((ev.index || 1) - 1, 0); w.currentAt = now; w.note = `Translating ${ev.name || 'the document'}`
    return w
  }
  // review, chronology: a document is reported when it starts.
  for (const it of w.items) if (it.status === 'now') { it.status = 'done'; it.end = now }
  const it = ensure(w, ev.name || `Document ${ev.index}`)
  it.status = 'now'; it.at = now
  w.done = Math.max((ev.index || 1) - 1, 0)
  w.currentAt = now
  return w
}

const WORK_DOING = { review: 'checking it point by point', chronology: 'finding the dated events', grid: 'answering your questions' }

/** The progress panel of a workflow as screen lines. */
export function workLines(w, { now = clock.now(), width = 78, maxItems = 7, stopHint = 'what is done so far is saved in the matter folder' } = {}) {
  const L = []
  const unit = UNITS[w.kind] || 'Document'
  const running = !w.endedAt
  const current = Math.min(w.done + (running && w.total && w.done < w.total ? 1 : 0), w.total)
  const left = running ? timeLeft({ done: w.done, total: w.total, startedAt: w.startedAt, currentAt: w.currentAt, now }) : ''
  L.push([{ t: w.total ? `${unit} ${current || 1} of ${w.total}` : 'Getting started', bold: true }, { t: `${left ? ` ${sym.sep} ${left}` : ''} ${sym.sep} ${duration((w.endedAt || now) - w.startedAt)} so far`, dim: true }])
  if (w.total) {
    const barW = Math.max(Math.min(width - 10, 40), 10)
    const fill = Math.round((w.done / w.total) * barW)
    const full = sym.ok === '+' ? '#' : '█'
    const empty = sym.ok === '+' ? '-' : '░'
    L.push([{ t: full.repeat(fill), color: color.accent }, { t: empty.repeat(barW - fill), dim: true }, { t: ` ${Math.round((w.done / w.total) * 100)}%`, dim: true }])
  }
  if (w.kind !== 'translate' && w.items.length) {
    const nowIdx = Math.max(w.items.findIndex((x) => x.status === 'now'), w.items.filter((x) => x.status === 'done').length - 1, 0)
    const start = Math.max(0, Math.min(nowIdx - 2, w.items.length - maxItems))
    if (start) L.push([{ t: `    … ${start} done before`, dim: true }])
    for (const it of w.items.slice(start, start + maxItems)) {
      const time = it.status === 'done' || it.status === 'failed' ? duration((it.end || now) - (it.at || w.startedAt)) : it.status === 'now' ? duration(now - (it.at || now)) : ''
      const extra = it.status === 'now' && WORK_DOING[w.kind] ? ` — ${WORK_DOING[w.kind]}` : it.note ? ` — ${it.note}` : ''
      const room = width - 4 - time.length - 2
      L.push([{ t: `  ${mark(it.status)} `, color: markColor(it.status), bold: true }, { t: fit(`${it.name}${extra}`, room).padEnd(room), bold: it.status === 'now', dim: it.status === 'waiting' }, { t: `  ${time}`, dim: true }])
    }
    const more = w.items.length - start - maxItems
    if (more > 0) L.push([{ t: `    … ${more} more waiting`, dim: true }])
  }
  if (w.note) L.push([{ t: `  ${fit(w.note, width - 2)}`, dim: true }])
  L.push(...dataRows(dataLine(w.models, w.online, { running }), width))
  if (running) L.push([{ t: `Esc stop ${sym.sep} ${stopHint}`, dim: true }])
  return L
}

// ── recent activity (GET /api/activity records) ─────────────────────────

const KIND_WORDS = { question: 'Question', review: 'Checklist review', chronology: 'Chronology', translate: 'Translation', compare: 'Comparison', grid: 'Review grid', plan: 'Plan' }

/** "Today 14:02", "Yesterday 09:15", "3 Oct 16:40". */
export function when(iso, now = new Date()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff === 0) return `Today ${hm}`
  if (diff === 1) return `Yesterday ${hm}`
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${hm}`
}

/** One activity record → { title, result, lines[] } in plain words. */
export function describeRecord(r, now = new Date()) {
  const looked = []
  for (const l of r.looked || []) {
    if (l.document) looked.push(clip(l.document, 40))
    else if (l.tool) {
      const x = explainTool(l.tool, l.detail || {})
      if (!x.hide) looked.push(x.text)
    }
  }
  const online = (r.looked || []).map((l) => (l.tool ? explainTool(l.tool, l.detail || {}).online : null)).filter(Boolean)
  const data = dataLine((r.data || []).map((m) => ({ ...m })), online)
  const result = r.result === 'failed' ? `Did not finish: ${friendly(r.error || 'something went wrong')}`
    : r.result === 'stopped' ? 'Stopped by you (what was done so far is kept)'
      : [r.kind === 'question' ? 'Answered' : 'Done', r.suggestions ? `${r.suggestions} proposed change${r.suggestions === 1 ? '' : 's'}` : '', r.saved?.length ? `saved ${r.saved.join(', ')}` : ''].filter(Boolean).join(', ')
  const lines = [
    ...(r.files?.length ? [`With: ${r.files.join(', ')}`] : []),
    `Looked at: ${looked.length ? [...new Set(looked)].slice(0, 6).join('; ') : 'nothing beyond the question'}${looked.length > 6 ? ' …' : ''}`,
    ...(r.sources?.length ? [`Law used: ${r.sources.slice(0, 6).join(', ')}${r.sources.length > 6 ? ' …' : ''}`] : []),
    `${data.left ? '! ' : ''}${data.text}`,
    `Result: ${result}`,
  ]
  return {
    title: `${when(r.at, now)} ${sym.sep} ${KIND_WORDS[r.kind] || 'Request'}${r.asked ? `: “${clip(r.asked, 50)}”` : ''}`,
    took: r.ms ? duration(r.ms) : '',
    left: data.left,
    result: r.result,
    lines,
  }
}
