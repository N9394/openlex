// One question in the App's chat, as the OpenLex engine reports it
// (POST /api/chat) — the same events the terminal app and the Word pane
// read, folded into what the lawyer sees: the steps in plain words (the
// engine sends them as `plain`), where the data went, what the answer is
// based on, whether proposed changes were checked, and permission
// questions. Pure functions, no React. Ported from the Word pane's
// add-in/lib (words, dataline, activity, sources, permission) so the
// windows say the same thing.

import i18n from '../i18n'

// ── words ──────────────────────────────────────────────────────────────

/** A sentence in the App's language (locales: "turn.*"), English when there is none. */
const tr = (key: string, en: string, opts: Record<string, unknown> = {}) => String(i18n.t(`turn.${key}`, { defaultValue: en, ...opts }))

export const clip = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
export const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : (many || `${one}s`)}`
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** "8 s", "1 min 5 s", "12 min". */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m >= 10) return `${m} min`
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

const times = (n: number) => (n === 1 ? tr('once', 'once') : tr('times', '{{n}} times', { n }))
const NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', azure: 'Azure OpenAI', mistral: 'Mistral',
  openrouter: 'OpenRouter', bedrock: 'AWS Bedrock', vertex: 'Google Vertex',
  scaleway: 'Scaleway', ovhcloud: 'OVHcloud', stackit: 'STACKIT', ionos: 'IONOS',
}
const FAMILIES: [RegExp, string][] = [[/claude|anthropic/i, 'Claude'], [/gpt|^o\d|openai/i, 'GPT'], [/mistral|mixtral|magistral|codestral/i, 'Mistral'], [/gemini/i, 'Gemini'], [/llama/i, 'Llama'], [/qwen/i, 'Qwen']]
const isEu = (r: unknown) => /^(eu|europe)/i.test(String(r || ''))

export interface ModelUse { key?: string; provider: string; label?: string; model?: string | null; local: boolean; region?: string | null; redacted: boolean; checked?: boolean; detection?: 'basic' | 'with-model'; calls: number }

/** "Claude (Anthropic, EU)", "Mistral (EU)", "this computer" — never a model id. */
export function serviceName(m: Partial<ModelUse>) {
  if (m.local) return tr('thisComputer', 'this computer')
  if (m.provider === 'custom') return tr('firmServer', 'your firm\'s AI server')
  const company = NAMES[m.provider || ''] || clip(m.label || m.provider || tr('aService', 'an AI service'), 30)
  const hit = FAMILIES.find(([re]) => re.test(String(m.model || '')) || (m.provider === 'anthropic' && re.test('claude')))
  const family = hit ? hit[1] : ''
  const region = m.region ? (isEu(m.region) ? 'EU' : /^us/i.test(m.region) ? 'USA' : clip(m.region, 16)) : ''
  const inner = [family && family !== company ? company : '', region].filter(Boolean).join(', ')
  const head = family && family !== company ? family : company
  return inner ? `${head} (${inner})` : head
}

/** "clause 4 (Liability)" from a heading like "4. Liability" or "§ 4 Haftung". */
export function clauseName(c?: { heading?: string; index?: number } | null) {
  if (!c) return tr('aPart', 'a part of the document')
  const h = String(c.heading || '').trim()
  const m = /^(?:§+\s*|art(?:icle|\.)?\s*|clause\s*|ziffer\s*|punkt\s*)?(\d+(?:\.\d+)*)\.?\s*[-–:)]?\s*(.*)$/i.exec(h)
  if (m && m[2]) return tr('clauseNamed', 'clause {{n}} ({{name}})', { n: m[1], name: clip(m[2], 40) })
  if (m) return tr('clause', 'clause {{n}}', { n: m[1] })
  if (h) return tr('thePart', 'the part “{{name}}”', { name: clip(h, 40) })
  if (Number.isInteger(c.index)) return tr('partN', 'part {{n}} of the document', { n: (c.index as number) + 1 })
  return tr('aPart', 'a part of the document')
}

// ── where the data went ────────────────────────────────────────────────

/** Add one `model` event to the services used (same service → count). */
export function addModel(models: ModelUse[], ev: any): ModelUse[] {
  const key = `${ev.local ? 'local' : ev.provider}|${ev.region || ''}|${ev.redacted ? 1 : 0}`
  const out = models.map((m) => ({ ...m }))
  const hit = out.find((m) => m.key === key)
  // detection: 'basic' as soon as one checked call had no name finder.
  if (hit) { hit.calls++; if (ev.checked) hit.checked = true; if (ev.detection) hit.detection = hit.detection === 'basic' || ev.detection === 'basic' ? 'basic' : 'with-model' }
  else out.push({ key, provider: ev.provider, label: ev.label, model: ev.model || null, local: !!ev.local, region: ev.region || null, redacted: !!ev.redacted, ...(ev.checked ? { checked: true } : {}), ...(ev.detection ? { detection: ev.detection } : {}), calls: 1 })
  return out
}

const shortName = (name: string) => String(name || '').replace(/\s*\(.*\)\s*$/, '').trim() || String(name || '')

/** The always-visible line: ✓ Stayed on this computer · ! Sent to Claude (Anthropic, EU) — names and numbers hidden (pseudonymised) · 2 times. */
export function dataLine(models: ModelUse[] = [], online: string[] = [], running = false) {
  const cloud = models.filter((m) => !m.local)
  const web = [...new Set(online)]
  const parts: string[] = []
  for (const m of cloud) parts.push(tr('sentTo', 'Sent to {{name}} — {{names}} · {{times}}', { name: serviceName(m), names: m.redacted ? (m.checked ? (m.detection === 'basic' ? tr('namesHiddenCheckedBasic', 'names and numbers hidden (pseudonymised), checked by you (basic detection)') : m.detection === 'with-model' ? tr('namesHiddenCheckedModel', 'names and numbers hidden (pseudonymised), checked by you (with name finder)') : tr('namesHiddenChecked', 'names and numbers hidden (pseudonymised), checked by you')) : tr('namesHidden', 'names and numbers hidden (pseudonymised)')) : tr('namesNotHidden', 'names and numbers not hidden'), times: times(m.calls || 1) }))
  if (web.length) parts.push(tr('lookedUp', 'Looked up online: {{list}}', { list: web.map(shortName).join(', ') }))
  if (!parts.length) return { symbol: '✓', left: false, text: running ? tr('nothingLeftYet', 'Nothing has left this computer so far') : tr('stayed', 'Stayed on this computer'), title: tr('stayedTitle', 'The AI ran on this computer and nothing was looked up online.') }
  const title = [
    cloud.length ? tr('sentTitle', 'Your text was sent to the AI service named here, under your firm\'s client-data rule.') : tr('docsStayed', 'Your documents stayed on this computer.'),
    web.length ? tr('onlyWords', 'Only search words or web addresses went to: {{list}}.', { list: web.join(', ') }) : '',
  ].filter(Boolean).join(' ')
  return { symbol: '!', left: true, text: parts.join(' · '), title }
}

// ── one question: the live list of steps ───────────────────────────────

export interface Step { text: string; status: 'now' | 'done' | 'failed'; at: number; end?: number; failed?: boolean; phase?: string; what?: string }
/** origin: 'local' = the law collection on this computer, 'online' = looked up live (RIS, EUR-Lex …), 'copy' = a source's copy kept on this computer; from = that source's name. */
export interface LawSource { chunk_id?: string | null; source_name?: string; section?: string; snippet?: string; origin?: 'local' | 'online' | 'copy'; from?: string; fromDe?: string; url?: string | null }
export interface Activity {
  startedAt: number; endedAt: number | null
  steps: Step[]; models: ModelUse[]; online: string[]; sources: LawSource[]
  clauses: { index?: number; heading?: string }[]; notes: { entity: string; claim: string; section: unknown }[]
  suggestions: number; stopped: boolean; failed: boolean; waiting: string | null; answerWords: number
  /** The second pass (judge): did it check this answer, and what did it find? */
  judge?: { ran: boolean; ok?: boolean; reason?: string; notes?: string[]; unavailable?: boolean } | null
  /** Keys the AI asked the lawyer for (a secure field each; the key never enters the conversation). */
  keys?: KeyRequest[]
}

export interface KeyRequest { source: string; label: string; labelDe?: string; keyHelp?: string | null; keyHelpDe?: string | null; guide?: string; signIn?: boolean }

const generic = () => tr('generic', 'Working on your question')

export function startActivity(now = Date.now()): Activity {
  return { startedAt: now, endedAt: null, steps: [{ text: tr('workingOut', 'Working out how to answer'), status: 'now', at: now }], models: [], online: [], sources: [], clauses: [], notes: [], suggestions: 0, stopped: false, failed: false, waiting: null, answerWords: 0 }
}

const clone = (a: Activity): Activity => ({ ...a, judge: a.judge ? { ...a.judge } : a.judge, steps: a.steps.map((s) => ({ ...s })), online: [...a.online], sources: [...a.sources], clauses: [...a.clauses], notes: [...a.notes], models: [...a.models], keys: [...(a.keys || [])] })
const current = (a: Activity) => { for (let i = a.steps.length - 1; i >= 0; i--) if (a.steps[i].status === 'now') return a.steps[i]; return null }
function push(a: Activity, text: string, now: number, extra: Partial<Step> = {}) {
  const cur = current(a)
  if (cur && cur.text === text) { Object.assign(cur, extra); return }
  if (cur) { cur.status = cur.failed ? 'failed' : 'done'; cur.end = now }
  a.steps.push({ text, status: 'now', at: now, ...extra })
}
function finish(a: Activity, now: number) {
  for (const s of a.steps) if (s.status === 'now') { s.status = s.failed ? 'failed' : 'done'; s.end = now }
  a.endedAt = a.endedAt || now
}

const sameSource = (x: LawSource, s: LawSource) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section)

/** Fold one engine event into the activity (returns a new object). `done` events only mark a stop: the stream's end finishes it. */
export function applyEvent(act: Activity, ev: any, now = Date.now()): Activity {
  if (!ev || !ev.type) return act
  const a = clone(act)
  switch (ev.type) {
    case 'step': {
      if (ev.quiet) return act
      const text = typeof ev.plain === 'string' && ev.plain ? ev.plain : generic()
      if (ev.online && ev.onlineTo && !a.online.includes(ev.onlineTo)) a.online.push(ev.onlineTo)
      const c = ev.detail && ev.detail.clause
      if (c && !a.clauses.some((x) => x.index === c.index && x.heading === c.heading)) a.clauses.push({ index: c.index, heading: c.heading || '' })
      push(a, text, now, { ...(ev.failed ? { failed: true } : {}), ...(ev.kind === 'writing' || ev.kind === 'retry' ? { phase: 'writing' } : {}) })
      return a
    }
    case 'text': {
      const cur = current(a)
      if (!cur || cur.phase !== 'writing') push(a, tr('writing', 'Writing the answer'), now, { phase: 'writing' })
      a.answerWords += String(ev.text || '').split(/\s+/).filter(Boolean).length
      return a
    }
    case 'law':
      for (const s of ev.sources || []) if (s && !a.sources.some((x) => sameSource(x, s))) a.sources.push(s)
      return a
    case 'key_request':
      if (ev.source && !(a.keys || []).some((k) => k.source === ev.source)) a.keys = [...(a.keys || []), { source: ev.source, label: ev.label, labelDe: ev.labelDe, keyHelp: ev.keyHelp, keyHelpDe: ev.keyHelpDe, guide: ev.guide, signIn: !!ev.signIn }]
      return a
    case 'note':
      if (ev.claim || ev.entity) a.notes.push({ entity: ev.entity || '', claim: ev.claim || '', section: ev.section == null ? '' : ev.section })
      return a
    case 'model': a.models = addModel(a.models, ev); return a
    case 'suggestion': a.suggestions++; return a
    case 'skill': push(a, tr('following', 'Following your firm\'s instructions “{{name}}”', { name: clip(ev.title || ev.name, 40) }), now); return a
    case 'agent': push(a, tr('workingAs', 'Working as “{{name}}”', { name: clip((/^de/i.test(i18n.resolvedLanguage || i18n.language || '') && ev.titleDe) || ev.title || ev.name, 40) }), now); return a
    case 'compact': push(a, tr('tidying', 'Tidying up its notes so far (your document is kept)'), now); return a
    case 'permission': {
      a.waiting = ev.summary || 'a step'
      const what = clip(ev.summary || tr('goOn', 'may OpenLex go on?'), 60)
      push(a, tr('waiting', 'Waiting for your answer: {{what}}', { what }), now, { phase: 'ask', what })
      return a
    }
    case 'permission_result': {
      a.waiting = null
      const cur = current(a)
      if (cur && cur.phase === 'ask') {
        const what = cur.what || cur.text
        cur.text = ev.decision === 'deny' ? tr('notAllowedWhat', 'Not allowed: {{what}}', { what }) : tr('allowedWhat', 'Allowed: {{what}}', { what })
        cur.status = ev.decision === 'deny' ? 'failed' : 'done'
        cur.end = now
      }
      return a
    }
    case 'warning': push(a, tr('note', 'Note: {{text}}', { text: clip(ev.message, 80) }), now); return a
    case 'withheld': push(a, tr('heldBack', 'Your firm\'s rules held this answer back'), now, { failed: true }); finish(a, now); return a
    case 'error':
      if (ev.recoverable) { push(a, tr('partFailed', 'One part could not be finished; going on with the rest'), now, { failed: true }); return a }
      a.failed = true; push(a, tr('stoppedWhy', 'Stopped: {{why}}', { why: friendly(ev.message) }), now, { failed: true }); finish(a, now); return a
    case 'judge': a.judge = { ran: !!ev.ran, ok: ev.ok, reason: ev.reason, notes: Array.isArray(ev.notes) ? ev.notes : [], unavailable: !!ev.unavailable }; return a
    case 'done': if (ev.stopped) a.stopped = true; return a
    default: return act
  }
}

/** The stream ended (or the lawyer pressed Stop). */
export function endActivity(act: Activity, now = Date.now(), stopped = false): Activity {
  const a = clone(act)
  if (stopped) a.stopped = true
  finish(a, now)
  return a
}

export const mark = (status: Step['status']) => (status === 'done' ? '✓' : status === 'failed' ? '!' : '▸')

/** Whether the second pass checked the answer, in words ('' when the engine did not say). */
export function judgeLine(act: Pick<Activity, 'judge'> | null | undefined) {
  const j = act?.judge
  if (!j) return ''
  if (j.ran) return j.unavailable && !(j.notes || []).length ? tr('judgeUnavailable', 'second pass could not run') : j.ok === false ? tr('judgeFound', 'second pass found something — see below') : tr('judgeOk', 'checked by a second pass')
  return j.reason === 'off' ? tr('judgeOff', 'not double-checked (switched off in Settings)') : tr('judgeNothing', 'not double-checked (no sources to check against)')
}

/** The one line after an answer: "✓ Done in 12 s · 6 steps · checked by a second pass". */
export function summaryLine(act: Activity) {
  const took = duration((act.endedAt || act.startedAt) - act.startedAt)
  const j = judgeLine(act)
  return act.stopped ? `⏹ ${tr('stoppedAfter', 'Stopped after {{took}}', { took })}` : act.failed ? `! ${tr('endedEarly', 'Ended early after {{took}}', { took })}` : `✓ ${tr('doneIn', 'Done in {{took}}', { took })} · ${tr('steps', '{{count}} steps', { count: act.steps.length })}${j ? ` · ${j}` : ''}`
}

/** The Stop explained: what was kept, and that nothing more is sent. */
export function stopSentence(act: Activity) {
  const kept = [
    act.answerWords ? tr('answerSoFar', 'the answer so far ({{words}})', { words: tr('words', '{{count}} words', { count: act.answerWords }) }) : '',
    act.sources.length ? tr('lawFound', '{{count}} law sections it found', { count: act.sources.length }) : '',
    act.suggestions ? tr('changes', '{{count}} proposed changes', { count: act.suggestions }) : '',
  ].filter(Boolean)
  return `${tr('stoppedByYou', 'Stopped by you.')} ${kept.length ? tr('kept', 'Kept: {{list}}.', { list: kept.join(', ') }) : tr('nothingWritten', 'Nothing was written yet.')} ${tr('nothingMore', 'Nothing more is sent or saved.')}`
}

// ── what an answer is based on; was a proposed change checked ──────────

export interface Basis { n: number; kind: 'law' | 'doc' | 'note'; label: string; detail: string; chunk_id?: string | null; origin?: LawSource['origin']; from?: string; fromDe?: string; url?: string | null }

/** Every law section and document passage the answer used, numbered. */
export function basedOn(act: Pick<Activity, 'sources' | 'clauses' | 'notes'> | null | undefined, max = 12): Basis[] {
  if (!act) return []
  const out: Omit<Basis, 'n'>[] = []
  for (const s of act.sources || []) out.push({ kind: 'law', label: clip([s.source_name, s.section].filter(Boolean).join(' ') || tr('aLawSection', 'a law section'), 50), detail: s.snippet || '', chunk_id: s.chunk_id || null, ...(s.origin ? { origin: s.origin } : {}), ...(s.from ? { from: s.from } : {}), ...(s.fromDe ? { fromDe: s.fromDe } : {}), ...(s.url ? { url: s.url } : {}) })
  for (const c of act.clauses || []) out.push({ kind: 'doc', label: tr('yourDoc', 'Your document: {{part}}', { part: clauseName(c) }), detail: c.heading || '' })
  for (const n of act.notes || []) {
    const hasSec = n.section !== '' && n.section != null
    out.push({ kind: 'note', label: clip(`${hasSec ? tr('notedPart', 'Noted (part {{n}})', { n: n.section }) : tr('noted', 'Noted')}: ${[n.entity, n.claim].filter(Boolean).join(' — ')}`, 70), detail: n.claim || '' })
  }
  return out.slice(0, max).map((x, i) => ({ n: i + 1, ...x }))
}

/**
 * The line under "Based on": where the law sections actually came from —
 * "the law collection on this computer" only when they did. Items without
 * an origin but with a chunk_id are from the collection (older engines).
 */
export function sourcesNote(items: { kind?: string; origin?: string; from?: string; fromDe?: string; chunk_id?: string | null }[] | null | undefined) {
  const law = (items || []).filter((x) => x && x.kind === 'law')
  const de = /^de/i.test(i18n.resolvedLanguage || i18n.language || '')
  const name = (x: { from?: string; fromDe?: string }) => (de && x.fromDe) || x.from
  if (!law.length) return tr('checkPlain', 'Check the sources before relying on the answer.')
  const parts: string[] = []
  const add = (p: string) => { if (!parts.includes(p)) parts.push(p) }
  for (const x of law) if (x.origin === 'online') add(name(x) ? tr('fromOnline', '{{name}} (online)', { name: name(x) }) : tr('fromOnlineAny', 'an official law database (online)'))
  for (const x of law) if (x.origin === 'copy') add(name(x) ? tr('fromCopy', 'your offline copy of {{name}}', { name: name(x) }) : tr('fromCopyAny', 'an offline copy on this computer'))
  if (law.some((x) => x.origin === 'local' || (!x.origin && x.chunk_id))) add(tr('fromCollection', 'the law collection on this computer'))
  if (!parts.length) return tr('checkLaw', 'Check the law sections before relying on the answer.')
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} ${tr('and', 'and')} ${parts[parts.length - 1]}`
  return tr('lawFrom', 'Law sections come from {{list}}. Check them before relying on the answer.', { list })
}

const basisText = (b: any) => (!b ? '' : typeof b === 'string' ? clip(b, 60) : clip([b.source || b.source_name, b.section].filter(Boolean).join(' '), 60))

/** Was a proposed change checked against the law it cites? { ok, mark, text } — a symbol, never colour alone. */
export function checkLine(s: any = {}) {
  const basis = basisText(s.basis)
  const v = s.verdict || {}
  if (s.citationWarning) return { ok: false, mark: '!', text: tr('citeWrong', 'The cited section may be wrong ({{why}}) — review carefully', { why: clip(s.citationWarning, 60) }) }
  if (s.collapseWarning) return { ok: false, mark: '!', text: tr('muchShorter', 'Much shorter than the original clause — check nothing important was dropped') }
  if (v.status === 'verified' && !/unverified|unavailable/i.test(v.note || '')) return { ok: true, mark: '✓', text: basis ? tr('checkedAgainst', 'checked against {{basis}}', { basis }) : tr('checkedDoc', 'checked against your document') }
  if (v.status === 'rewrite') return { ok: true, mark: '✓', text: basis ? tr('correctedAgainst', 'checked and corrected (against {{basis}})', { basis }) : tr('corrected', 'checked and corrected') }
  return { ok: false, mark: '!', text: tr('notVerified', 'could not be verified — review carefully') }
}
export { basisText }

// ── permission questions (the broker asks; Allow once is the default) ──

const permLabels = (): Record<string, string> => ({ once: tr('perm.once', 'Allow once'), always_matter: tr('perm.alwaysMatter', 'Always allow (this matter)'), always_folder: tr('perm.alwaysFolder', 'Always allow (this folder)'), always: tr('perm.always', 'Always allow'), deny: tr('perm.deny', 'Don\'t allow') })
const PERM_ORDER = ['once', 'always_matter', 'always_folder', 'always', 'deny']
const DETAIL_KEYS = ['path', 'url', 'command', 'query', 'format']
const detailWords = (): Record<string, string> => ({ path: tr('detail.path', 'File'), url: tr('detail.url', 'Web address'), command: tr('detail.command', 'Program'), query: tr('detail.query', 'Search words'), format: tr('detail.format', 'Format') })
const riskWords = (): Record<string, string> => ({
  'writes a file': tr('risk.file', 'It would save a file.'),
  'runs a command': tr('risk.command', 'It would run a program on this computer.'),
  'sends data to the web': tr('risk.web', 'It would send search words or a web address to the internet.'),
  'uses a connector': tr('risk.connector', 'It would use one of your firm\'s connected systems.'),
  'changes your calendar': tr('risk.calendar', 'It would change your calendar.'),
})

export const permission = {
  /** "May OpenLex save obligations.csv in Acme/?" */
  question(ev: any) {
    const what = String(ev?.summary || '').trim().replace(/[.?!]+$/, '')
    if (what) return tr('mayWhat', 'May OpenLex {{what}}?', { what: lowerFirst(what) })
    const t = String(ev?.title || '').replace(/^OpenLex wants to\s*/i, '').trim()
    return t ? tr('mayWhat', 'May OpenLex {{what}}?', { what: t }) : tr('mayGoOn', 'May OpenLex go on with this step?')
  },
  /** The buttons, in order; Allow once is the default, "Always" never is. */
  buttons(ev: any) {
    const labels = permLabels()
    const offered: string[] = (Array.isArray(ev?.choices) && ev.choices.length ? ev.choices : ['once', 'deny']).filter((c: string) => labels[c])
    return PERM_ORDER.filter((c) => offered.includes(c)).map((c) => ({ choice: c, label: labels[c], primary: c === 'once' }))
  },
  /** At most 3 "what exactly" rows, never a whole file. */
  details(ev: any) {
    const d = ev?.detail || {}
    const words = detailWords()
    return DETAIL_KEYS.filter((k) => d[k] !== undefined && d[k] !== '').slice(0, 3)
      .map((k) => ({ label: words[k], value: clip(typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k]), 140) }))
  },
  riskLine(ev: any) {
    return `${riskWords()[ev?.risk] || tr('risk.other', 'It would change something.')}${ev?.firmRule ? ` ${tr('firmAsks', 'Your firm asks for confirmation here.')}` : ''} ${tr('untilYouChoose', 'Nothing happens until you choose.')}`
  },
  /** Prompt injection: the request came up while reading outside text (shown above the risk line). */
  caution(ev: any): string | null {
    return ev?.caution ? tr('injection.caution', ev.caution) : null
  },
  /** Prompt injection: what would be sent looks like client data (names, placeholders, copied passages). */
  warning(ev: any): string | null {
    return ev?.warning ? tr('injection.warning', ev.warning) : null
  },
  /** The line in the conversation after an answer (same words as the terminal app). */
  answered(ev: any, decision: string, saved?: string) {
    if (decision === 'deny') return tr('notAllowedWhat', 'Not allowed: {{what}}', { what: ev.summary })
    if (decision === 'once') return tr('allowedOnce', 'Allowed once: {{what}}', { what: ev.summary })
    const what = patternWords(saved || ev.always || ev.tool)
    if (decision === 'always_matter') return tr('allowedMatter', 'Allowed for this matter from now on: {{what}} (remove it with /permissions)', { what })
    if (decision === 'always_folder') return tr('allowedFolder', 'Allowed in this folder from now on: {{what}} (remove it with /permissions)', { what })
    return tr('allowedAlways', 'Allowed from now on: {{what}} (remove it with /permissions)', { what })
  },
  /** Settled without the lawyer (no answer in time, the run ended). */
  settled(ev: any) {
    if (ev?.by === 'timeout') return tr('noAnswerInTime', 'No answer in time, so not allowed')
    if (ev?.by === 'disconnect') return tr('stoppedNotAllowed', 'Stopped, so not allowed')
    return ev?.decision === 'deny' ? tr('notAllowed', 'Not allowed') : tr('allowed', 'Allowed')
  },
}

const ACTS_EN: Record<string, string> = {
  write_file: 'saving files', append_file: 'adding to files', export_document: 'saving results as files', sync_calendar: 'writing calendar files',
  delete_file: 'deleting files', rename_file: 'renaming files', read_file: 'reading files', list_directory: 'listing files', search_local_files: 'searching files',
  web_fetch: 'opening web pages', web_save: 'saving web pages', download_to_matter: 'downloading files', run_bash: 'running programs on this computer',
}
const actWords = (tool: string) => (ACTS_EN[tool] ? tr(`act.${tool}`, ACTS_EN[tool]) : '')

/** A permission rule in words: "web_fetch:eur-lex.europa.eu" → "opening web pages on eur-lex.europa.eu". */
export function patternWords(pattern: unknown) {
  const p = String(pattern || '')
  if (p === '*') return tr('everything', 'everything')
  if (/^\*:/.test(p)) return tr('anythingIn', 'anything in {{where}}', { where: p.slice(2).replace(/\/?\*\*?$/, '/') })
  const mcp = /^mcp:([^:]+)(?::(.*))?$/.exec(p)
  if (mcp) return `${tr('usingConnector', 'using your connector “{{name}}”', { name: mcp[1] })}${mcp[2] && mcp[2] !== '*' ? ` (${mcp[2]})` : ''}`
  const i = p.indexOf(':')
  const tool = i < 0 ? p : p.slice(0, i)
  const arg = i < 0 ? '' : p.slice(i + 1)
  const act = actWords(tool)
  if (!act) return p
  if (!arg || arg === '*' || arg === '**') return act
  if (/^web_|download/.test(tool)) return tr('actOn', '{{act}} on {{where}}', { act, where: arg })
  if (tool === 'run_bash') return `${act}: ${arg}`
  return tr('actIn', '{{act}} in {{where}}', { act, where: arg.replace(/\/?\*\*?$/, '/') })
}

// ── errors in one line a lawyer can act on (sidecar/src/explain.js friendly) ──

export function friendly(err: unknown) {
  const m = String((err as any)?.message || err || '')
  if (/limit for online AI|SPEND_CAP/i.test(m)) return tr('err.cap', 'This month\'s limit for online AI is reached. Use the AI on this computer (/model local), or raise the limit next to the model name.')
  if (/Claude Fable 5/i.test(m)) return tr('err.fable', 'Claude Fable 5 and 5.1 keep what you send for up to 30 days, so OpenLex does not send client data to them. Choose Claude Sonnet 5.5 or Opus 5.5 (/model).')
  if (/Mistral model is a preview/i.test(m)) return tr('err.mistralPreview', 'This Mistral model is a preview: Mistral may train on what you send. Choose Mistral Medium 3.5 (/model).')
  if (/processed outside the EU|not an EU region/i.test(m)) return tr('err.bedrockRegion', 'This AWS Bedrock setting would process data outside the EU. Use eu-central-1 (Frankfurt) and an "eu." model (/model).')
  if (/Blocked by data policy|POLICY_BLOCKED|local-only|not on the allow-list/i.test(m)) return tr('err.policy', 'Your client-data rule does not allow sending this to the AI service. Change it with /data, or use the AI on this computer (/model local).')
  if (/outside the approved regions|no pinned region/i.test(m)) return tr('err.region', 'This AI service is not in an approved region (EU only). Pick an EU service with /model, or change the client-data rule.')
  if (/no API key|NO_KEY|no AWS credentials/i.test(m)) return tr('err.noKey', 'There is no key for this AI service yet. Add it with /model (the gear next to the service).')
  if (/\b401\b|\b403\b|invalid.*key|unauthori[sz]ed|authentication|permission denied/i.test(m)) return tr('err.badKey', 'The AI service did not accept your key. Check the key with /model (the gear next to the service).')
  if (/\b429\b|rate limit|quota|insufficient/i.test(m)) return tr('err.rate', 'The AI service says the account has reached its limit. Try again in a minute, or check your plan.')
  if (/engine path not allowed|engine is not running|Word plugin engine is not running|cannot reach the engine/i.test(m)) return tr('err.engine', 'OpenLex is not running in the background. Restart this app; if it keeps happening, see the log file.')
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed? ?out|network|socket hang up/i.test(m)) return tr('err.network', 'The AI service could not be reached. Check the internet connection (or that the firm server is running) and try again.')
  if (/model not installed|local engine unavailable/i.test(m)) return tr('err.noLocal', 'No AI model is installed on this computer yet. Download one with /model (On this computer), or use a cloud service.')
  if (/model unavailable|not loaded|no model|llama/i.test(m)) return tr('err.notReady', 'The AI is not ready. Check it with /model.')
  if (/privileged/i.test(m)) return tr('err.privileged', 'This matter is privileged, so its documents stay on this computer. Type /privileged off first if that is really intended.')
  const first = m.split('\n')[0].replace(/^Error:\s*/, '')
  return first.length > 160 ? `${first.slice(0, 157)}…` : first || tr('err.other', 'Something went wrong.')
}

/** Which window a conversation was held in, in words. */
const WINDOW_EN: Record<string, string> = { app: 'this app', word: 'Word', tui: 'the terminal', cli: 'the command line', local: 'another program' }
export const WINDOW_WORDS: Record<string, string> = new Proxy(WINDOW_EN, { get: (o, k: string) => (o[k] ? tr(`window.${k}`, o[k]) : undefined) })
