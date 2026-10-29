"use strict"
/**
 * What OpenLex is doing, in a lawyer's words — once, in the engine, for
 * every front end (Word pane, Outlook pane, terminal app, desktop app).
 *
 * Every `step` event gets a `plain` sentence at emit time (agent.js emit,
 * server.js sendSse), plus `online: true` and `onlineTo` when that step
 * sends something (search words, a web address) outside this computer.
 * Never a tool name, JSON, a model id or engine jargon. Unknown events get a
 * general sentence, never the raw text.
 *
 *   annotate(ev)          a step event → { plain, online?, onlineTo?, quiet? }
 *   explainStep(ev)       one step → { text, online?, failed?, hide?, phase? }
 *   explainTool(tool, d)  a tool + its safe detail → { text, online? }
 *   friendly(err)         an engine error → one line a lawyer can act on
 *   serviceName(model)    "Claude (Anthropic, EU)" — never a model id
 *   dataLine(models, web) "Sent to: Claude (Anthropic, EU) — names hidden · 2 times"
 *   checkLine(sugg)       "checked against ABGB § 933 ✓" / "could not be verified …"
 *
 * Ported from sidecar/tui/explain.mjs (the terminal app moves to this module
 * in a later change). Pure functions; tested in test/explain.test.js.
 */

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const quoted = (s, n = 60) => (s ? `: “${clip(s, n)}”` : '')
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)

/** Provider ids → company names. */
const NAMES = {
  local: 'this computer', anthropic: 'Anthropic', openai: 'OpenAI', azure: 'Azure OpenAI', mistral: 'Mistral',
  openrouter: 'OpenRouter', bedrock: 'AWS Bedrock', vertex: 'Google Vertex', custom: 'your firm server', web: 'web search',
}

/** Jurisdiction codes → the law in words ("Austrian law"). */
const LAWS = {
  AT: 'Austrian law', DE: 'German law', CH: 'Swiss law', LI: 'Liechtenstein law', EU: 'EU law', FR: 'French law', IT: 'Italian law',
  ES: 'Spanish law', PT: 'Portuguese law', NL: 'Dutch law', BE: 'Belgian law', LU: 'Luxembourg law', PL: 'Polish law', CZ: 'Czech law',
  SK: 'Slovak law', HU: 'Hungarian law', SI: 'Slovenian law', HR: 'Croatian law', RO: 'Romanian law', BG: 'Bulgarian law', DK: 'Danish law',
  SE: 'Swedish law', FI: 'Finnish law', IE: 'Irish law', UK: 'English law', GB: 'English law', US: 'US law',
}
const lawOf = (j) => LAWS[String(j || '').toUpperCase()] || 'the law'

/** "clause 4 (Liability)" from a clause heading like "4. Liability" or "§ 4 Haftung". */
function clauseName(c) {
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
const RIS = 'RIS (Austria\'s federal law database)'
const EURLEX = 'EUR-Lex (the EU\'s law database)'

/**
 * Engine tool → what the lawyer reads. `online` names who received
 * something (search words or a web address) outside this computer.
 */
const TOOL_WORDS = {
  get_document_map: () => ({ text: 'Looking at how the document is organised' }),
  get_range_text: (d) => ({ text: `Reading ${clauseName(d.clause)}` }),
  get_clause_analysis: (d) => ({ text: `Reading ${clauseName(d.clause)}` }),
  search_law: (d) => ({ text: `Searching ${lawOf(d.jurisdiction)}${quoted(d.query)}` }),
  get_law_section: () => ({ text: 'Reading the full text of a law section' }),
  search_ris: (d) => ({ text: `Checking RIS, Austria's official law database${quoted(d.query, 40)}`, online: RIS }),
  search_eurlex: (d) => ({ text: `Checking EUR-Lex, the EU's official law database${quoted(d.query, 40)}`, online: EURLEX }),
  get_eu_law: (d) => ({ text: `Reading EU law on EUR-Lex${d.article ? `, Article ${d.article}` : ''}`, online: EURLEX }),
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
  get_tool_schemas: () => ({ text: 'Getting ready', hide: true }),
  tool_picker: () => ({ text: 'Getting ready', hide: true }),
  compress_context: () => ({ text: 'Tidying up its notes so far', hide: true }),
}

/** A tool, including connectors ("mcp__dms__search" → "Using your connector “dms”"). */
function explainTool(tool, detail = {}) {
  const t = String(tool || '')
  if (Object.prototype.hasOwnProperty.call(TOOL_WORDS, t)) return TOOL_WORDS[t](detail || {})
  const mcp = /^mcp(?:__|:)([^_:]+)/.exec(t)
  if (mcp) return { text: `Using your connector “${mcp[1]}”`, online: `your connector “${mcp[1]}”` }
  return { text: 'Working on your question' }
}

/** What a failed step means for the answer. */
function failedSentence(tool, detail = {}, offline = false) {
  if (tool === 'search_ris') return 'Couldn\'t reach RIS (Austria\'s federal law database); the answer uses the copy of the law on this computer instead.'
  if (tool === 'search_eurlex' || tool === 'get_eu_law') return 'Couldn\'t reach EUR-Lex; the answer uses the copy of EU law on this computer instead.'
  if (tool === 'search_law' || tool === 'get_law_section') return 'Couldn\'t search the law on this computer (the law collection may not be installed); the answer may cite less law than usual.'
  if (tool === 'web_fetch' || tool === 'web_save' || tool === 'download_to_matter') return `Couldn't open ${detail.host || 'the web page'}${offline ? ' (no connection)' : ''}; the answer goes on without it.`
  if (tool === 'search_firm_library' || tool === 'find_clause') return 'Couldn\'t search your firm\'s precedents; the answer goes on without them.'
  return `Couldn't finish this step (${lower(explainTool(tool, detail).text || 'a step')}); the answer goes on without it.`
}

const OLD_PREFIX = { tool: 'tool', blocked: 'blocked', declined: 'declined', 'not allowed': 'not_allowed', failed: 'tool_failed' }

/**
 * One `step` event → a sentence. Newer engines send kind/tool/detail;
 * older ones only text ("tool: search_law") — both work.
 */
function explainStep(ev = {}) {
  let kind = ev.kind
  let tool = ev.tool
  const text = String(ev.text || '')
  if (!kind) {
    const m = /^(tool|blocked|declined|not allowed|failed):\s*(\S+)/.exec(text)
    if (m) { kind = OLD_PREFIX[m[1]]; tool = tool || m[2] }
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
    else if (/^verifying pack signature/.test(text)) kind = 'pack_verify'
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
    case 'clause': {
      // Contract review in Word: one clause at a time ("Clause 4 of 18").
      const c = d.clause || (ev.heading !== undefined || ev.index !== undefined ? { heading: ev.heading, index: ev.index } : null)
      const of = ev.total ? ` — ${(ev.position || 0) + 1} of ${ev.total}` : ''
      return { text: `Reviewing ${clauseName(c)}${of}`, phase: 'clause' }
    }
    case 'pack_verify': return { text: 'Checking the law collection is genuine' }
    case 'law_search': return { text: 'Searching the law on this computer', hide: true }
    case 'dropped': case 'filter': return { text: 'Leaving out a proposed change that did not hold up', hide: true }
    default: return { text: 'Working on your question' }
  }
}

/**
 * The fields the engine adds to a `step` event: `plain` (always a
 * sentence), `online` + `onlineTo` when something left this computer,
 * `quiet` for housekeeping a front end may skip, `failed` when the step
 * did not work out.
 */
function annotate(ev = {}) {
  let x
  try { x = explainStep(ev) } catch { x = { text: 'Working on your question' } }
  const out = { plain: x.text || 'Working on your question' }
  if (x.online) { out.online = true; out.onlineTo = x.online }
  if (x.hide) out.quiet = true
  if (x.failed) out.failed = true
  return out
}

/** Add `plain` (and `online`) to a step event in place; other events pass through. */
function withPlain(ev) {
  if (!ev || typeof ev !== 'object') return ev
  const isStep = ev.type === 'step' || (ev.type === 'progress' && (ev.kind || ev.tool))
  if (!isStep || typeof ev.plain === 'string') return ev
  Object.assign(ev, annotate(ev))
  return ev
}

/**
 * One line a lawyer can act on, from whatever went wrong. The raw message
 * is logged; this is what goes on screen.
 */
function friendly(err) {
  const m = String(err?.message || err || '')
  if (/Blocked by data policy|POLICY_BLOCKED|local-only|not on the allow-list/i.test(m)) return 'Your client-data rule does not allow sending this to the AI service. Change it in Settings → Where client data may go, or use the AI on this computer.'
  if (/outside the approved regions|no pinned region/i.test(m)) return 'This AI service is not in an approved region (EU only). Pick an EU service in Settings, or change the client-data rule.'
  if (/no API key|NO_KEY|no AWS credentials/i.test(m)) return 'There is no key for this AI service yet. Add it in Settings → Which AI.'
  if (/401|403|invalid.*key|unauthori[sz]ed|authentication|permission denied/i.test(m)) return 'The AI service did not accept your key. Check the key in Settings → Which AI (copy it again from your account page).'
  if (/429|rate limit|quota|insufficient/i.test(m)) return 'The AI service says the account has reached its limit. Try again in a minute, or check your plan with the provider of your key.'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed? ?out|network|socket hang up/i.test(m) && !/engine/i.test(m)) return 'The AI service could not be reached. Check the internet connection (or that the firm server is running) and try again.'
  if (/cannot reach the engine|engine is not running|registry is stale|did not start/i.test(m)) return 'OpenLex is not running in the background. Restart this app; if it keeps happening, see the log file.'
  if (/model not installed|local engine unavailable/i.test(m)) return 'No AI model is installed on this computer yet. Choose Settings → Which AI to set one up (or use your own key).'
  if (/model unavailable|not loaded|no model|llama/i.test(m)) return 'The AI is not ready. Open Settings → Which AI to set it up.'
  if (/not a folder|ENOENT|no such file/i.test(m)) return 'That file or folder was not found. Check the path.'
  if (/matter title is required/i.test(m)) return 'Please give the matter a name.'
  if (/privileged/i.test(m)) return 'This matter is privileged, so its documents stay on this computer. Turn "Privileged" off first if that is really intended.'
  const first = m.split('\n')[0].replace(/^Error:\s*/, '')
  return first.length > 160 ? `${first.slice(0, 157)}…` : first || 'Something went wrong.'
}

/** An `error` event: what went wrong and what it means for the answer. */
function errorSentence(message, { partial = false } = {}) {
  const what = friendly(message)
  return `${what}${/[.!?]$/.test(what) ? '' : '.'} ${partial ? 'The answer stops here; what was written so far is kept.' : 'There is no answer this time.'}`
}

// ── where the data went ─────────────────────────────────────────────────

const isEu = (r) => /^(eu|europe)/i.test(String(r || ''))
const FAMILIES = [[/claude|anthropic/i, 'Claude'], [/gpt|^o\d|openai/i, 'GPT'], [/mistral|mixtral|magistral|codestral/i, 'Mistral'], [/gemini/i, 'Gemini'], [/llama/i, 'Llama'], [/qwen/i, 'Qwen']]

/** "Claude (Anthropic, EU)", "Mistral (EU)", "your firm's AI server" — never a model id. */
function serviceName(m = {}) {
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
function addModel(models, ev) {
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
 * anything went outside this computer.
 */
function dataLine(models = [], online = [], { running = false } = {}) {
  const cloud = models.filter((m) => !m.local)
  const parts = []
  if (cloud.length) parts.push(`Sent to: ${cloud.map((m) => `${serviceName(m)} — ${m.redacted ? 'names hidden' : 'names not hidden'} · ${times(m.calls)}`).join('; ')}`)
  const web = [...new Set(online)]
  if (web.length) parts.push(`${cloud.length ? 'Also looked' : 'Looked'} up online: ${web.join(', ')} (only search words or web addresses)`)
  if (!parts.length) return { text: running ? 'Nothing has left this computer so far' : 'Stayed on this computer', left: false }
  return { text: `${cloud.length ? '' : 'Your documents stayed on this computer. '}${parts.join('. ')}`, left: true }
}

/** "8 s", "1 min 5 s", "12 min". */
function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m >= 10) return `${m} min`
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

/** The cited law of a suggestion, in words ("ABGB § 933"). */
function basisText(b) {
  if (!b) return ''
  if (typeof b === 'string') return clip(b, 60)
  return clip([b.source || b.source_name, b.section].filter(Boolean).join(' '), 60)
}

/** Was a proposed change checked? { text, ok } */
function checkLine(s = {}) {
  const basis = basisText(s.basis)
  const v = s.verdict || {}
  if (s.citationWarning) return { text: `The cited section may be wrong (${clip(s.citationWarning, 60)}) — review carefully`, ok: false }
  if (s.collapseWarning) return { text: 'Much shorter than the original clause — check nothing important was dropped', ok: false }
  if (v.status === 'verified' && !/unverified|unavailable/i.test(v.note || '')) return { text: basis ? `checked against ${basis} ✓` : 'checked against your document ✓', ok: true }
  if (v.status === 'rewrite') return { text: `checked and corrected${basis ? ` (against ${basis})` : ''} ✓`, ok: true }
  return { text: 'could not be verified — review carefully', ok: false }
}

module.exports = {
  annotate, withPlain, explainStep, explainTool, failedSentence, errorSentence, friendly,
  serviceName, addModel, dataLine, duration, basisText, checkLine, clauseName, lawOf,
  TOOL_WORDS, LAWS, NAMES,
}
