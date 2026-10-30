/**
 * A matter: ask questions (streamed answers with the sources found and
 * proposed changes as cards), add documents (typed, pasted or dragged into
 * the window), run actions, choose who OpenLex works as, and mark the
 * matter privileged. "Quick question" is the same screen without a matter.
 *
 * "Working as" never needs "@" (hard to type on German/Austrian keyboards):
 * Tab or the menu opens a picker; "@name …" and "as researcher: …" typed
 * at the start of a question also work, for that question only.
 *
 * Commands typed with "/" change the setup without leaving the chat
 * (/model, /key, /data, /as, /privileged, /permissions, /clear, /help);
 * they win over firm skills of the same name, "/skill …" runs a skill
 * otherwise. When OpenLex wants to save a file, open a web page, run a
 * command or use a connector, a prompt asks first (permission.mjs).
 *
 * While a question runs, the lawyer sees each step in plain words, how
 * long it has taken, where the data went and how to stop (explain.mjs);
 * afterwards what the answer is based on (Ctrl+B or /sources for the full
 * text). Files dropped into the question field are attached to that
 * question (attach.mjs).
 *
 * Working folder (folder.mjs): questions carry it, so OpenLex reads the
 * documents there and asks before changing anything; /folder changes it,
 * and a matter can take the folder's documents in one step.
 *
 * Forgiving input: "help" or "?" shows the commands, "exit" or "quit"
 * quits, a mistyped command gets "Did you mean /model?", Esc with typed
 * text first says the text is kept, ↑ brings back earlier questions,
 * Ctrl+J starts a new line, a long paste becomes one "[Pasted 214 lines]"
 * chip (Ctrl+O puts it into the field). Ctrl+K lists every command.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, color, sym, look, useSize, fitPath } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { matchInvocation, log, friendly, errorParts, describeRule, describeModel, nameOf } from './api.mjs'
import { cleanPaths, completePath, shortPath } from './paths.mjs'
import { PermissionPrompt, PermissionRules, answeredLine } from './permission.mjs'
import { clock, startActivity, applyEvent, activityLines, doneLines, basedOnLines, basedOn, sourcesNote, checkLine, basisText, stopSentence } from './explain.mjs'
import { pastedFiles, chipLabel, attachSentence, readAttachment, joinTexts } from './attach.mjs'
import { FolderPicker } from './folder.mjs'
import { LawSources } from './sources.mjs'
import { copyText, onExit } from './clip.mjs'

const require = createRequire(import.meta.url)

// Conversations survive going back to the matter list (for this session).
const conversations = new Map()
// Matters to reopen in the chat (left for Recent activity from the chat).
const backToChat = new Set()
// Text typed but not sent when the lawyer went back (restored on return).
const drafts = new Map()
// Questions asked, per matter, for ↑ / ↓ in the question field.
const histories = new Map()
// The engine conversation each matter continues (shared with the Word pane and the desktop app).
const sessionIds = new Map()
const WINDOW_WORDS = { app: 'the desktop app', word: 'Word', tui: 'the terminal', cli: 'the command line' }

/** A stored conversation (GET /api/session) as chat messages. */
export function historyMessages(messages = []) {
  return messages.map((m) => (m.role === 'user'
    ? { role: 'you', text: m.content, files: [] }
    : { id: ++seq, role: 'ai', text: m.content, sources: m.sources || [], suggestions: [], ...(m.stopped ? { stopped: true } : {}) }))
}

export const ACTIONS = [
  { value: 'review', label: 'Review the documents against a checklist', hint: 'Every document, checked point by point; each finding quotes the document.' },
  { value: 'chronology', label: 'Build a chronology', hint: 'Dated events from all documents, each date checked against its quote.' },
  { value: 'translate', label: 'Translate a document', hint: 'A Word translation plus a side-by-side file for checking.' },
  { value: 'compare', label: 'Compare two versions', hint: 'What changed between two drafts, with the important changes rated.' },
  { value: 'grid', label: 'Ask the same questions of every document (review grid)', hint: 'One row per document, one column per question, saved as Excel.' },
  { value: 'plan', label: 'Plan a larger task (you approve each step)', hint: 'OpenLex proposes the steps; nothing runs until you approve.' },
  { value: 'skill', label: 'Use your firm\'s instructions', hint: 'Instructions your firm wrote for recurring tasks.' },
]

/**
 * Commands in the chat ("/model …"): the terminal app's share of the one
 * list every window uses (src/commands.js, also GET /api/commands). They
 * win over firm skills with the same name.
 */
export const COMMANDS = require('../src/commands.js').list({ surface: 'tui' }).map(({ name, args, help }) => ({ name, args, help }))

/** The closest command or skill name to a mistyped one (null when nothing is close). */
export function didYouMean(word, names) {
  const w = String(word || '').toLowerCase()
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 1; j <= b.length; j++) d[0][j] = j
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return d[a.length][b.length]
  }
  let best = null
  for (const n of names) {
    const score = n.startsWith(w) && w.length >= 2 ? 0 : dist(w, n)
    if (score <= Math.max(2, Math.floor(n.length / 3)) && (!best || score < best.score)) best = { n, score }
  }
  return best?.n || null
}

/** Examples for an empty conversation (the folder ones only when working in a folder). */
export function examples({ folder = false, matter = false } = {}) {
  return [
    ...(folder ? ['Summarise the contract in this folder', 'Which deadlines are in these documents?'] : matter ? ['Summarise the documents of this matter', 'Which deadlines are in these documents?'] : ['Which deadlines are in this lease? (drag the file here first)']),
    'Is a two-year non-compete enforceable under Austrian law?',
  ]
}
const PROVIDER_WORDS = { claude: 'anthropic', computer: 'local', 'this-computer': 'local', gpt: 'openai', firm: 'custom' }
let seq = 0

/** Folder name the engine uses for a matter's files (workspace.matterFolder). */
const folderName = (m) => String(m ? (m.number ? `${m.number} ${m.title}` : m.title) : 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)

export function Matter({ matterId = null }) {
  const ctx = useAppCtx()
  const key = matterId || 'quick'
  const [matter, setMatter] = useState(null)
  const [docs, setDocs] = useState([])
  const [mode, setMode] = useState(() => (!matterId || backToChat.delete(key) ? 'chat' : 'menu'))
  const [msgs, setMsgs] = useState(() => conversations.get(key) || [])
  const [input, setInputRaw] = useState(() => drafts.get(matterId || 'quick') || '')
  const [escHint, setEscHint] = useState(false) // Esc pressed once with text typed
  const [slashClosed, setSlashClosed] = useState(false) // Esc closed the command hints
  const [pastes, setPastes] = useState([]) // long pasted blocks: [{ text, lines }]
  const [hist, setHist] = useState(-1) // position in the earlier questions (↑)
  const [saveAsk, setSaveAsk] = useState(null) // "save the answer" waiting for permission
  const [confirmText, setConfirmText] = useState('') // "yes" to turn privileged off
  const setInput = (v) => { drafts.set(matterId || 'quick', v); setInputRaw(v); setEscHint(false); setSlashClosed(false) }
  const [streaming, setStreaming] = useState(false)
  const [skills, setSkills] = useState(null)
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState([]) // [{ kind, text }]
  const [scroll, setScroll] = useState(0)
  const [perm, setPerm] = useState(null) // a permission request waiting for the lawyer
  const [keyFor, setKeyFor] = useState(null) // provider whose key is being typed (/key)
  const [secret, setSecret] = useState('')
  const [returnTo, setReturnTo] = useState('menu') // where a picker opened from the chat goes back to
  const [files, setFiles] = useState([]) // files dropped into the question field: [{ path, name, size }]
  const [now, setNow] = useState(clock.now()) // ticks every second while an answer is written
  const [source, setSource] = useState(null) // the law section opened from "Based on"
  const [sessionId, setSessionIdRaw] = useState(() => sessionIds.get(key) || `tui:${key}`)
  const setSessionId = (v) => { sessionIds.set(key, v); setSessionIdRaw(v) }
  const abort = useRef(null)
  const pendingTeam = useRef(null) // a panel on online AI waiting for "/team go" (the estimate was shown)
  const pageRef = useRef({ height: 10, total: 0 })
  const { cols, rows } = useSize()

  const agents = ctx.info.agents || []
  // The cloud AI this matter could be allowed to use ("Only for matters I choose" in setup).
  const active = ctx.info.providers?.providers?.find((p) => p.id === ctx.info.providers?.active)
  const def = ctx.info.policy?.default || {}
  const cloud = ctx.prefs.cloudForMatters || (active && !active.local ? { mode: 'allow-list', providers: [active.id], ...(def.regions ? { regions: def.regions } : {}), ...(def.redact ? { redact: true } : {}) } : null)
  const agentName = (matterId ? matter?.agent : ctx.prefs.quickAgent) || 'associate'
  const agent = agents.find((a) => a.name === agentName) || { name: 'associate', title: 'Associate' }

  const load = async () => {
    if (!matterId) return
    try {
      const r = await ctx.api.matters()
      setMatter((r.matters || []).find((m) => m.id === matterId) || null)
      const d = await ctx.api.documents(matterId)
      setDocs(d.documents || [])
    } catch (err) { setNotes([{ kind: 'bad', text: err.message }]) }
  }
  useEffect(() => { load() }, [matterId, ctx.hubTick])
  // One conversation per matter in every window: an empty chat picks up the
  // matter's newest conversation from the engine (asked here, in Word or in the desktop app).
  useEffect(() => {
    if (!matterId || conversations.get(key)?.length || sessionIds.has(key)) return
    let alive = true
    ;(async () => {
      try {
        const newest = (await ctx.api.sessions(matterId)).sessions?.[0]
        if (!newest || !alive) return
        const r = await ctx.api.session(newest.id)
        if (!alive || !r.messages?.length) return
        setSessionId(newest.id)
        const where = (newest.clients || []).filter((c) => c !== 'tui').map((c) => WINDOW_WORDS[c] || c)
        setMsgs((m) => (m.length ? m : [{ role: 'sys', kind: 'info', text: `Continuing this matter's conversation${where.length ? ` (also asked in ${where.join(' and ')})` : ''}. /clear starts a new one.` }, ...historyMessages(r.messages)]))
      } catch (err) { log('loading the matter conversation failed:', err) }
    })()
    return () => { alive = false }
  }, [matterId])
  useEffect(() => { conversations.set(key, msgs) }, [msgs])
  useEffect(() => () => abort.current?.abort(), [])
  // Typed text survives going back (and is said to).
  useEffect(() => { drafts.set(key, input) }, [input])
  useEffect(() => {
    if (!streaming) return undefined
    const t = setInterval(() => setNow(clock.now()), 1000)
    return () => clearInterval(t)
  }, [streaming])
  const skillsAsked = useRef(false)
  const loadSkills = () => { if (skillsAsked.current) return; skillsAsked.current = true; ctx.api.skills().then((r) => setSkills((r.skills || []).filter((s) => !s.error))).catch(() => setSkills([])) }

  // ── asking ──
  /** One line from OpenLex itself in the conversation (command confirmations, permission answers). */
  const sys = (text, kind = 'ok') => setMsgs((m) => [...m, { role: 'sys', text, kind }])

  /** Files dropped or pasted into the question field become chips (not text). */
  const attach = (list) => {
    setFiles((cur) => [...cur, ...list.filter((f) => !cur.some((c) => c.path === f.path))])
    return true
  }
  const onPaste = (text) => {
    const list = pastedFiles(text)
    if (list) return attach(list)
    // A long block (an email, a clause) stays out of the way: one chip, Ctrl+O to see it in the field.
    const lines = String(text).split(/\r\n|\r|\n/).length
    if (lines >= 5) { setPastes((p) => [...p, { text: String(text), lines }]); return true }
    return false
  }

  const send = async (raw) => {
    const typed = raw.trim()
    const text = [typed, ...pastes.map((p) => p.text.trim())].filter(Boolean).join('\n\n')
    if (!text) return
    // Forgiving words: "help" or "?" → the commands; "exit" or "quit" → quit.
    if (!pastes.length && /^(help|\?)$/i.test(typed)) { setInput(''); return command('help', '') }
    if (!pastes.length && /^(exit|quit)$/i.test(typed)) { setInput(''); return ctx.quit() }
    const cmd = typed.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/)
    // /analyse runs as a question: the engine's analyse skill reads the attached
    // (or named) document with the full analysis (analysis.js) and saves the report.
    if (cmd && cmd[1].toLowerCase() !== 'analyse' && COMMANDS.some((c) => c.name === cmd[1].toLowerCase())) {
      setInput('')
      setScroll(0)
      return command(cmd[1].toLowerCase(), (cmd[2] || '').trim())
    }
    if (cmd && !pastes.length) {
      // Not one of ours: a firm skill of that name — or a typing error.
      let list = skills
      if (!list) { list = await ctx.api.skills().then((r) => (r.skills || []).filter((s) => !s.error)).catch(() => []); setSkills(list); skillsAsked.current = true }
      if (!list.some((s) => s.name === cmd[1])) {
        const guess = didYouMean(cmd[1], [...COMMANDS.map((c) => c.name), ...list.map((s) => s.name)])
        // The likely command goes into the field: Enter uses it, or keep typing.
        if (guess) setInput(`/${guess}${cmd[2] ? ` ${cmd[2]}` : ''}`)
        return sys(guess ? `There is no command /${cmd[1]}. Did you mean /${guess}? Press Enter to use it (/help lists them all).` : `There is no command /${cmd[1]}. Type /help to see the commands.`, 'warn')
      }
    }
    // Only paths typed or pasted without bracketed paste: attach them.
    const dropped = pastedFiles(text)
    if (dropped) { setInput(''); return attach(dropped) }
    if (streaming) return sys('The answer is still being written. Wait for it (or press Esc to stop it), then ask again. Commands like /model work meanwhile.', 'warn')
    let message = text
    let as = agent
    const inv = matchInvocation(text, agents)
    if (inv) { as = inv.agent; message = inv.message || text }
    histories.set(key, [...(histories.get(key) || []), typed || text].slice(-50))
    setHist(-1)
    setInput('')
    setPastes([])
    setScroll(0)
    const att = files
    setFiles([])
    const id = ++seq
    setMsgs((m) => [...m, { role: 'you', text: pastes.length ? `${typed}${typed ? ' ' : ''}[${pastes.map((p) => `pasted ${p.lines} lines`).join(', ')}]` : text, files: att.map((f) => f.name) }])
    const ac = new AbortController()
    abort.current = ac
    // Ctrl+C stops this answer (a second Ctrl+C then quits).
    ctx.interrupt.current = () => { ac.abort(); return true }
    setStreaming(true)
    // Attached files: read here, sent with the question (like `openlex ask --file`), and kept in the matter.
    let docText = ''
    let docId = `tui:${key}`
    if (att.length) {
      const parts = []
      for (const f of att) {
        try {
          const t = String(await readAttachment(f.path) || '').trim()
          if (t) parts.push({ name: f.name, text: t })
          else sys(`${f.name} has no readable text (perhaps a scan), so the question is sent without it.`, 'warn')
        } catch (err) {
          log(`reading ${f.path} failed:`, err)
          sys(`${f.name} could not be read (${String(err.message).split('\n')[0]}), so the question is sent without it.`, 'warn')
        }
      }
      if (parts.length) { docText = joinTexts(parts); docId = `tui:${key}:${att.map((f) => f.path).join('|')}` }
      if (matterId) for (const n of await copyIntoMatter(att.map((f) => f.path))) sys(n.text, n.kind)
    }
    const t0 = clock.now()
    // If the engine does not report its AI calls, the data line says what the rule allows.
    const rule = matter ? matter.policy || ctx.info.policy?.default : ctx.info.policy?.default
    const mayLeave = active && !active.local && !matter?.privileged && rule?.mode === 'allow-list' && (rule.providers || []).includes(active.id)
    const answer = { id, role: 'ai', text: '', sources: [], suggestions: [], act: { ...startActivity(t0), unreported: mayLeave ? `Not reported which AI answered. Your client-data rule: ${describeRule(rule, matter)}` : '' }, as: as.name !== 'associate' ? as.title : '' }
    setMsgs((m) => [...m, answer])
    setNow(t0)
    // By id, not "the last message": command lines may arrive while the answer streams.
    const patch = (fn) => setMsgs((m) => m.map((x) => { if (x.id !== id) return x; const c = { ...x }; fn(c); return c }))
    // Streamed words are shown in batches (every 60 ms), not one redraw per word.
    let buf = ''
    let timer = null
    let gotText = false
    let failed = false
    const flush = () => { clearTimeout(timer); timer = null; if (!buf) return; const t = buf; buf = ''; patch((a) => { a.text += t }) }
    try {
      await ctx.api.chat({ message, docId, ...(docText ? { text: docText, files: att.map((f) => f.name) } : {}), matterId: matterId || undefined, sessionId, agent: as.name, interactive: true, ...ctx.folderBody() }, (ev) => {
        const at = clock.now()
        if (ev.type === 'text') {
          // The first words switch the activity to "Writing the answer"; the rest only add text.
          if (!gotText) patch((a) => { a.act = applyEvent(a.act, ev, at) })
          gotText = true
          buf += ev.text
          if (!timer) timer = setTimeout(flush, 60)
          return
        }
        flush()
        if (ev.type === 'error') failed = true
        patch((a) => { a.act = applyEvent(a.act, ev, at) })
        if (ev.type === 'law') patch((a) => { for (const s of ev.sources || []) if (!a.sources.some((x) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section))) a.sources = [...a.sources, s] })
        else if (ev.type === 'suggestion') patch((a) => { a.suggestions = [...a.suggestions, ev.suggestion] })
        else if (ev.type === 'skill') patch((a) => { a.skill = ev.title })
        else if (ev.type === 'key_request') patch((a) => { a.tip = `OpenLex needs your free key for ${ev.label}${ev.signIn ? ' (or a free browser sign-in)' : ''}: type /law, choose ${ev.label}, and paste it there (it stays hidden and never goes into the chat). ${ev.keyHelp || ''}`.trim() })
        else if (ev.type === 'skill_suggestion' && ev.name) patch((a) => { a.tip = `Your firm's instructions "${ev.title || ev.name}" may fit — choose them under Actions → Use your firm's instructions.` })
        else if (ev.type === 'error') patch((a) => { a.error = friendly(ev.message); a.err = errorParts(ev.message) })
        else if (ev.type === 'permission') { setPerm(ev); setMode('chat') }
        else if (ev.type === 'permission_result' && ev.by !== 'lawyer') {
          // Decided without the lawyer (no answer in time): close the prompt and say so.
          setPerm((p) => { if (p?.id === ev.id) sys(`No answer in time, so not allowed: ${p.summary}`, 'warn'); return p?.id === ev.id ? null : p })
        }
      }, ac.signal)
    } catch (err) {
      if (!ac.signal.aborted) { failed = true; patch((a) => { a.error = err.message; a.err = errorParts(err); a.act = applyEvent(a.act, { type: 'error', message: err.raw || err.message }) }) }
    }
    flush()
    ctx.interrupt.current = null
    // Nothing came back because of an error: the question goes back into the field (never lost).
    if (failed && !gotText && !ac.signal.aborted && typed) {
      setInputRaw((cur) => cur || typed)
      sys('Your question is back in the field: press Enter to try again.', 'info')
    }
    patch((a) => {
      if (ac.signal.aborted) { a.stopped = true; a.stopNote = stopSentence(a.act, a.text) }
      a.act = applyEvent(a.act, { type: 'done', ...(ac.signal.aborted ? { stopped: true } : {}) })
    })
    abort.current = null
    setPerm(null)
    setStreaming(false)
  }

  const answerPerm = async (req, decision) => {
    try {
      const r = await ctx.api.answerPermission(req.id, decision)
      sys(answeredLine(req, decision, r?.saved), decision === 'deny' ? 'warn' : 'ok')
    } catch (err) { sys(err.message, 'bad') }
    setPerm((p) => (p?.id === req.id ? null : p))
  }

  // ── commands ("/model anthropic") ──
  /** "Now using … Client data for this matter: …" after any change to the setup. */
  const describeSetup = async () => {
    const info = await ctx.refresh()
    let m = matter
    if (matterId) { try { m = (await ctx.api.matters()).matters.find((x) => x.id === matterId) || m; setMatter(m) } catch { /* keep */ } }
    const prov = info?.providers?.providers?.find((p) => p.id === info.providers.active)
    const rule = m ? m.policy || info?.policy?.default : info?.policy?.default
    const where = !prov || prov.local ? 'the AI on this computer' : describeModel(info).replace(' — online AI service', ', an online AI service')
    const allowed = prov?.local || (rule?.mode === 'allow-list' && (rule.providers || []).includes(prov?.id) && !m?.privileged)
    return { line: `Now using ${where}. Client data${matterId ? ' for this matter' : ''}: ${describeRule(rule, m)}.${!allowed && prov && !prov.local ? ` To send documents to ${nameOf(prov.id)}: /data.` : ''}`, info }
  }
  const nextNote = () => (streaming ? ' This applies from your next question; the answer being written keeps the current model.' : '')

  // "/model local qwen3:8b": one of the models on this computer (Ollama's, or a GGUF file).
  const useLocalModel = async (name) => {
    setBusy(`Switching the AI on this computer to ${name}…`)
    try {
      const r = await ctx.api.useLocalModel(name)
      await ctx.refresh().catch(() => {})
      sys(`Now using ${r.model.title} on this computer. Nothing leaves this computer.${r.restarted ? ' It is starting; the first answer can take about 20 seconds longer.' : ''}`)
    } catch (err) {
      let names = ''
      try { names = ((await ctx.api.localModels()).models || []).map((m) => m.name).join(', ') } catch { /* engine busy */ }
      sys(`${err.message}.${names ? ` On this computer: ${names}.` : ' There is no model on this computer yet: download one in the desktop app, or with Ollama ("ollama pull qwen3:8b").'}`, 'bad')
    } finally { setBusy('') }
  }

  const switchModel = async (arg) => {
    const loc = /^(local|computer|this-computer)(?:\s+|:)(.+)$/i.exec(arg.trim())
    if (loc) return useLocalModel(loc[2].trim())
    const i = arg.indexOf(':')
    const word = (i < 0 ? arg : arg.slice(0, i)).trim().toLowerCase()
    const id = PROVIDER_WORDS[word] || word
    const model = i < 0 ? '' : arg.slice(i + 1).trim()
    const list = ctx.info.providers?.providers || []
    if (!list.some((p) => p.id === id)) return sys(`There is no AI service called "${word}". Choose one of: ${list.map((p) => p.id).join(', ')} (or type /model to pick).`, 'bad')
    try {
      await ctx.api.useProvider(id, model ? { model } : undefined)
      const { line, info } = await describeSetup()
      const fresh = info?.providers?.providers?.find((p) => p.id === id)
      sys(`${line}${model ? ` Model: ${model}.` : ''}${nextNote()}${fresh?.needsKey && !fresh.hasKey ? ` There is no key for ${nameOf(id)} yet: /key ${id}.` : ''}`)
    } catch (err) { sys(err.message, 'bad') }
  }

  const saveKey = async (provider, value) => {
    setMode('chat')
    setSecret('')
    setBusy(`Saving the key and checking ${nameOf(provider)}…`)
    try {
      await ctx.api.saveKey(provider, value)
      const r = await ctx.api.testProvider(provider, matterId)
      await ctx.refresh().catch(() => {})
      if (r.ok) sys(`Key saved for ${nameOf(provider)} (in this computer's keychain). Checked: it answers.`)
      else if (r.code === 'POLICY_BLOCKED') sys(`Key saved for ${nameOf(provider)}. Not checked yet: client data ${matterId ? 'of this matter ' : ''}may not go there (/data to change that).`, 'warn')
      else sys(`Key saved for ${nameOf(provider)}, but the check failed: ${friendly(r.error)}`, 'bad')
    } catch (err) { sys(err.message, 'bad') }
    setBusy('')
  }

  const setData = async (choice) => {
    setMode('chat')
    const active = ctx.info.providers?.active
    const rule = choice === 'local' ? { mode: 'local-only' } : { mode: 'allow-list', providers: [active], ...(choice === 'eu' ? { regions: ['eu'] } : {}), ...(choice === 'redact' ? { redact: true } : {}) }
    try {
      if (matterId) await ctx.api.setMatterPolicy(matterId, rule)
      else await ctx.api.setPolicy(rule)
      sys((await describeSetup()).line)
    } catch (err) { sys(err.message, 'bad') }
  }

  const command = async (name, arg) => {
    if (name === 'help') {
      sys('Commands (type them in the question field):', 'info')
      for (const c of COMMANDS) sys(`/${c.name}${c.args ? ` ${c.args}` : ''} — ${c.help}`, 'info')
      return sys('Anything else after "/" uses your firm\'s instructions of that name.', 'info')
    }
    if (name === 'model') { if (arg) return switchModel(arg); return setMode('model') }
    if (name === 'analyse') {
      setInput(`/analyse ${arg}`.trimEnd() + ' ')
      return sys('Drop or paste a document\'s path (or name a document of the matter after /analyse), then press Enter: OpenLex analyses it in full and saves the report (Word, Markdown) in the matter folder.', 'info')
    }
    if (name === 'key') {
      const active = ctx.info.providers?.providers?.find((p) => p.id === ctx.info.providers?.active)
      const id = arg ? (PROVIDER_WORDS[arg.toLowerCase()] || arg.toLowerCase()) : active?.needsKey ? active.id : null
      if (!id) return setMode('keypick')
      const prov = (ctx.info.providers?.providers || []).find((p) => p.id === id)
      if (!prov) return sys(`There is no AI service called "${arg}".`, 'bad')
      if (!prov.needsKey) return sys(`${nameOf(id)} needs no key.`, 'info')
      setKeyFor(id)
      setSecret('')
      return setMode('key')
    }
    if (name === 'data') {
      const active = ctx.info.providers?.providers?.find((p) => p.id === ctx.info.providers?.active)
      if (matter?.privileged) return sys('This matter is privileged, so client data stays on this computer. Type /privileged off first if that is really intended.', 'warn')
      if (!active || active.local) return sys('The AI runs on this computer, so client data stays here. Choose a cloud AI with /model first.', 'info')
      return setMode('datapick')
    }
    if (name === 'as') {
      if (!arg) return setMode('agent')
      const a = agents.find((x) => x.name === arg.toLowerCase() || String(x.title).toLowerCase() === arg.toLowerCase())
      if (!a) return sys(`No role called "${arg}". Choose one of: ${agents.map((x) => x.name).join(', ')}.`, 'bad')
      await chooseAgent(a.name)
      return sys(`Now working as ${a.title}${matterId ? ' for this matter' : ''}.`)
    }
    if (name === 'privileged') {
      if (!matterId) return sys('A quick question has no matter. Open a matter to mark it privileged.', 'info')
      const on = /^(on|yes|ja|true|1)$/i.test(arg)
      const off = /^(off|no|nein|false|0)$/i.test(arg)
      if (!on && !off) return sys('Type /privileged on or /privileged off.', 'info')
      if (on) return setPrivileged(true, 'chat')
      setReturnTo('chat')
      return setMode('unprivilege')
    }
    if (name === 'permissions') return setMode('perms')
    if (name === 'judge') {
      const on = /^(on|yes|ja|ein|an|1)$/i.test(arg)
      const off = /^(off|no|nein|aus|0)$/i.test(arg)
      try {
        if (!on && !off) { const st = await ctx.api.judge(); return sys(st.enabled ? `Answers are checked with a second pass${st.locked ? ' (set by your firm)' : ''}. /judge off switches it off.` : 'Answers are not double-checked. /judge on switches the second pass on (recommended).', st.enabled ? 'ok' : 'warn') }
        await ctx.api.setJudge(on)
        return sys(on ? 'Answers are checked with a second pass from now on.' : 'Second pass off: answers are no longer double-checked. /judge on brings it back.', on ? 'ok' : 'warn')
      } catch (err) { return sys(err.message, 'warn') }
    }
    if (name === 'agent') return agentCommand(arg)
    if (name === 'team') return teamCommand(arg)
    if (name === 'folder') {
      if (!arg) return setMode('folder')
      if (/^(none|off)$/i.test(arg)) { ctx.useFolder(null); return sys('Not working in a folder any more. OpenLex uses your matters only.') }
      const p = cleanPaths(arg)[0]
      const f = p ? await ctx.inspectFolder(p) : { ok: false, error: 'No folder given.' }
      if (!f.ok) return sys(f.error, 'bad')
      if (f.broad) return setMode('folder')
      ctx.useFolder(f)
      return sys(`Now working in ${f.short}${f.documents ? ` (${f.documents} document${f.documents === 1 ? '' : 's'})` : ''}. OpenLex can read the files there and asks before changing anything.`)
    }
    if (name === 'copy') {
      if (!lastAnswer?.text) return sys('There is no answer to copy yet.', 'info')
      const ok = await copyText(lastAnswer.text)
      return sys(ok ? 'Copied the last answer. Paste it anywhere with Cmd+V or Ctrl+V.' : 'Copying is not possible in this terminal. Use /save to keep the answer as a file.', ok ? 'ok' : 'warn')
    }
    if (name === 'save') return saveAnswer(arg)
    if (name === 'saved') return showSaved()
    if (name === 'investigate' || name === 'diligence') return runTool(name, arg)
    if (name === 'draft') return writeDraft(arg)
    if (name === 'transcript') {
      onExit.lines = transcript(msgs, 100, clock.now()).map((l) => l.segs.map((g) => g.t).join(''))
      return sys('This conversation will be printed in your terminal window when you quit OpenLex (there you can scroll, select and copy it).')
    }
    if (name === 'sources') return openSources()
    if (name === 'law') return setMode('lawsources')
    if (name === 'activity') { backToChat.add(key); return ctx.go('activity', { matterId }) }
    if (name === 'record') { backToChat.add(key); return ctx.go('record', { matterId: /^all\b/i.test(arg) ? null : matterId }) }
    if (name === 'clear') {
      try {
        await ctx.api.clearConversation(sessionId)
        setSessionId(`tui:${key}`)
        setMsgs([])
        sys(`New conversation${matterId ? ' for this matter' : ''}: OpenLex no longer remembers the earlier questions. The documents are still there.`)
      } catch (err) { sys(err.message, 'bad') }
    }
  }

  // ── the tools from the old desktop app ──
  /** The documents a tool reads: the files in the question field, else the working folder. */
  const toolDocs = () => (files.length ? { files: files.map((f) => f.path) } : ctx.folder ? { folder: ctx.folder.path } : null)

  /** /investigate and /diligence: one document at a time in the engine, then the result as a few lines and a Word report. */
  const runTool = async (kind, arg) => {
    const docs = toolDocs()
    if (!docs) return sys(`Drop the documents into the question field (or choose a folder with /folder), then type /${kind}${kind === 'investigate' ? ' and your question' : ''} again.`, 'info')
    if (kind === 'investigate' && !arg) return sys('Type your question after /investigate (or one of: liability, exit, obligations, advantages).', 'info')
    const options = kind === 'investigate' ? { question: arg } : { ...(/seller|verkäufer/i.test(arg) ? { perspective: 'seller' } : { perspective: 'buyer' }), dealType: /asset/i.test(arg) ? 'asset_purchase' : /merger/i.test(arg) ? 'merger' : 'share_purchase' }
    setFiles([])
    let job
    try {
      job = (await ctx.api.batchStart({ ...docs, kind, options, matterId: matterId || undefined, sessionId, message: `/${kind} ${arg}`.trim(), confirmed: true })).batch
    } catch (err) { return sys(err.message, 'bad') }
    sys(`${kind === 'investigate' ? 'Investigating' : 'Due diligence of'} ${job.counts.total} document${job.counts.total === 1 ? '' : 's'}: ${job.estimate.sentence}`, 'info')
    let last = -1
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500))
      try { job = (await ctx.api.batch(job.id)).batch } catch (err) { return sys(err.message, 'bad') }
      const done = job.counts.done + job.counts.failed + job.counts.skipped
      if (done !== last && job.state === 'running') { last = done; sys(`${done} of ${job.counts.total} read…`, 'info') }
      if (job.state !== 'running' && job.state !== 'finishing') break
    }
    if (job.state !== 'done' || !job.result) return sys(`Stopped: ${job.note || 'not finished'}. The documents read so far are kept.`, 'warn')
    const what = kind === 'investigate' ? 'investigation' : 'diligence'
    try {
      const r = (await ctx.api.getResult(what, job.result.id))[what]
      if (kind === 'investigate') {
        sys(r.comparison.answer || 'Nothing in the documents answers the question.')
        for (const c of r.comparison.conflicts.slice(0, 5)) sys(`Differs — ${c.topic}: ${c.detail}`, 'info')
        sys(`${r.stats.verified} quoted findings in ${r.stats.documents} documents; ${r.stats.removed} statements removed by the check.`, 'info')
      } else {
        sys(`${r.stats.flags} red flags in ${r.stats.documents} documents: ${r.byTier.deal_breaker} deal breakers, ${r.byTier.price_affecting} price-affecting.`)
        if (r.overview.summary) sys(r.overview.summary, 'info')
        if (r.missing.length) sys(`Not in the data room: ${r.missing.join(', ')}.`, 'info')
      }
      const w = await ctx.api.exportResult(what, job.result.id, kind === 'investigate' ? 'docx' : 'xlsx')
      sys(`Report saved: ${w.file}`)
    } catch (err) { sys(err.message, 'bad') }
  }

  /** /draft: a first draft from the instructions (and dropped documents), saved as Word in the matter folder. */
  const writeDraft = async (arg) => {
    if (!arg && !files.length) return sys('Type what to draft after /draft (for example: /draft a mutual NDA, Austrian law) — or drop a document to work on.', 'info')
    const att = files.map((f) => f.path)
    setFiles([])
    setBusy('Writing the draft…')
    try {
      const d = (await ctx.api.draftCreate({ instruction: arg, files: att, matterId: matterId || undefined, sessionId, message: `/draft ${arg}`.trim() })).draft
      const text = d.versions[d.versions.length - 1].text
      setMsgs((m) => [...m, { role: 'you', text: `/draft ${arg}`.trim() }, { id: ++seq, role: 'ai', text, sources: [], suggestions: [] }])
      const w = await ctx.api.exportResult('draft', d.id, 'docx')
      sys(`Draft saved as Word: ${w.file}. In the desktop app you can fill in, change and check it.`)
    } catch (err) { sys(err.message, 'bad') }
    setBusy('')
  }

  /** /saved: what is kept with this matter. */
  const showSaved = async () => {
    try {
      const { items } = await ctx.api.saved(matterId || undefined)
      if (!items.length) return sys('Nothing saved with this matter yet. /save keeps the last answer here.', 'info')
      sys(`Saved with this ${matterId ? 'matter' : 'quick question'} (${items.length}):`, 'info')
      for (const it of items.slice(0, 20)) sys(`${it.createdAt.slice(0, 10)} · ${it.kind} · ${it.title}${it.tags.length ? ` (${it.tags.map((t) => `#${t}`).join(' ')})` : ''}`, 'info')
      if (items.length > 20) sys(`… and ${items.length - 20} more in the desktop app (Saved).`, 'info')
    } catch (err) { sys(err.message, 'bad') }
  }

  // ── your own agents (/agent) ──
  const agentCommand = async (arg) => {
    const m = /^(new|neu)\s+([^:]{2,60}):\s*([\s\S]{3,})$/i.exec(arg)
    if (m) {
      try {
        const r = await ctx.api.saveAgent({ title: m[2].trim(), instructions: m[3].trim(), groups: ['law', 'austria', 'eu', 'otherLaw', 'documents', 'firm'] })
        await ctx.refresh().catch(() => {})
        return sys(`Made "${r.agent.title}" (/as ${r.agent.name}, or in a panel: /team debate ${r.agent.name} …). Sources, where it runs and how thorough: change them in the desktop app (/agent edit ${r.agent.name}).`)
      } catch (err) { return sys(err.message, 'bad') }
    }
    sys('Agents (use one with /as NAME, or several with /team):', 'info')
    for (const a of agents) sys(`${a.name} — ${a.title}${a.description ? `: ${a.description}` : ''}`, 'info')
    return sys('Make your own: /agent new NAME: what it does (in your own words). The desktop app has the full form (/agent new there).', 'info')
  }

  // ── a Panel of agents (/team): sequential plain text of the same run ──
  const teamCommand = async (arg) => {
    const confirmed = /^(go|los|start)$/i.test(arg.trim())
    let req = confirmed ? pendingTeam.current : null
    pendingTeam.current = null
    if (confirmed && !req) return sys('There is no panel waiting to start. Type /team debate claimant-counsel defendant-counsel: your question', 'info')
    if (!req) {
      const [setup, ...rest] = arg.split(':')
      const question = rest.join(':').trim()
      const words = setup.trim().split(/[\s,]+/).filter(Boolean)
      const mode = { parallel: 'parallel', together: 'parallel', debate: 'debate', debatte: 'debate', review: 'review' }[String(words[0] || '').toLowerCase()] || null
      const names = (mode ? words.slice(1) : words).filter((w) => !/^\d$/.test(w) && !/^(vs\.?|gegen|and|und)$/i.test(w)).map((w) => w.toLowerCase())
      const rounds = +(words.find((w) => /^\d$/.test(w)) || 2)
      if (!question) {
        sys('A panel: several agents answer together, argue a question out, or draft and review.', 'info')
        sys('/team debate claimant-counsel defendant-counsel: Is the landlord liable for the water damage?', 'info')
        sys('/team parallel researcher compliance-checker: May we send newsletters to these customers?', 'info')
        return sys('/team review drafter reviewer: Draft a confidentiality clause for a software licence. Templates: claimant-counsel, defendant-counsel, devils-advocate, drafter, researcher, compliance-checker; /agent lists your own.', 'info')
      }
      const m = mode || 'debate'
      req = { mode: m, agents: names.length ? names : m === 'review' ? ['drafter', 'reviewer'] : ['claimant-counsel', 'defendant-counsel'], rounds, question, moderator: m === 'debate' ? 'judge' : null }
      try {
        const est = (await ctx.api.panelEstimate({ ...req, matterId: matterId || undefined })).estimate
        for (const n of est.notes || []) sys(n, 'warn')
        if (est.capReached) return sys(`${est.text} This month's limit for online AI is reached: use agents on this computer, or raise the limit.`, 'bad')
        if (est.needsConfirm) {
          pendingTeam.current = req
          return sys(`${est.text}${est.overCap ? ' This may go over your monthly limit; the panel would stop there and keep what was said.' : ''} Type /team go to start it; anything else cancels.`, 'warn')
        }
        sys(est.text, 'info')
      } catch (err) { return sys(err.message, 'bad') }
    }
    if (streaming) return sys('An answer is still being written. Wait for it (or press Esc), then start the panel.', 'warn')
    setMsgs((m) => [...m, { role: 'you', text: `[Panel · ${req.mode}: ${req.agents.join(', ')}] ${req.question}`, files: [] }])
    const ac = new AbortController()
    abort.current = ac
    ctx.interrupt.current = () => { ac.abort(); return true }
    setStreaming(true)
    const titles = {}
    const seen = new Set()
    try {
      await ctx.api.panel({ ...req, confirmed: true, interactive: true, matterId: matterId || undefined, sessionId, message: `/team ${req.mode} ${req.agents.join(' ')}: ${req.question}`, ...ctx.folderBody() }, (ev) => {
        if (ev.type === 'panel_start') { for (const x of ev.members) titles[x.lane] = x.title; if (ev.moderator) titles.moderator = ev.moderator.title; sys(`Panel: ${ev.members.filter((x) => !x.skipped).map((x) => `${x.title} (${x.local ? 'this computer' : x.where})`).join(', ')}${ev.moderator ? `; ${ev.moderator.title} sums up` : ''}. Esc stops all.`, 'info') }
        else if (ev.type === 'panel_note') sys(ev.text, 'warn')
        else if (ev.type === 'panel_round') sys(`— Round ${ev.round} of ${ev.rounds} —`, 'info')
        else if (ev.type === 'panel_lane') {
          const key = `${ev.lane}:${ev.round || 0}:${ev.status}`
          if (ev.status === 'working' && seen.has(key)) return
          seen.add(key)
          if (['working', 'failed', 'stopped'].includes(ev.status) || (ev.status === 'done' && ev.warn)) sys(`${titles[ev.lane] || ev.lane}: ${ev.plain}`, ev.status === 'failed' || ev.warn ? 'warn' : 'info')
        } else if (ev.type === 'panel_turn') setMsgs((m) => [...m, { id: ++seq, role: 'ai', text: ev.text, sources: [], suggestions: [], as: `${titles[ev.lane] || ev.lane}${req.mode === 'debate' ? ` · round ${ev.round}` : ev.kind && ev.kind !== 'answer' ? ` · ${ev.kind}` : ''}` }])
        else if (ev.type === 'panel_summary') {
          const s = ev.summary
          if (s.fallback) return sys(s.note, 'warn')
          const lines = []
          if (s.stronger) lines.push(`Stronger position: ${s.stronger.title || 'neither clearly'} — ${s.stronger.why}${s.stronger.cites?.length ? ` [${s.stronger.cites.join(', ')}]` : ''}`)
          for (const a of s.agreement) lines.push(`Agree: ${a.point}${a.cites.length ? ` [${a.cites.join(', ')}]` : ' [no source]'}`)
          for (const d of s.disagreement) lines.push(`Disagree: ${d.point}${d.cites.length ? ` [${d.cites.join(', ')}]` : ' [no source]'}${d.positions.map((p) => ` · ${p.title}: ${p.view}`).join('')}`)
          for (const o of s.open) lines.push(`Open: ${o.question}`)
          if (s.removed) lines.push(`(${s.removed} unverifiable citation${s.removed === 1 ? '' : 's'} removed)`)
          setMsgs((m) => [...m, { id: ++seq, role: 'ai', text: lines.join('\n'), sources: [], suggestions: [], as: titles.moderator || 'Moderator' }])
        } else if (ev.type === 'panel_result') {
          if (ev.panel.sources.length) sys(`Sources: ${ev.panel.sources.map((x) => `${x.id} ${x.label}`).join('; ')}`, 'info')
          if (ev.panel.stopped) sys(ev.panel.stopped === 'cap' ? 'Stopped: the monthly limit for online AI was reached. What was said so far is kept.' : 'Stopped. What was said so far is kept; nothing more is sent.', 'warn')
          else sys('The panel is in this conversation; in the desktop app it can be exported to Word or PDF.', 'ok')
        } else if (ev.type === 'permission') { setPerm(ev); setMode('chat') }
        else if (ev.type === 'error') sys(friendly(ev.message), 'bad')
      }, ac.signal)
    } catch (err) { if (!ac.signal.aborted) sys(err.message, 'bad') }
    if (ac.signal.aborted) sys('Stopped. What was said so far is kept; nothing more is sent.', 'warn')
    ctx.interrupt.current = null
    abort.current = null
    setPerm(null)
    setStreaming(false)
  }

  // ── getting the answer out ──
  /** /save: the last answer as a Markdown file in the working folder (or the matter folder), asked first like any save. */
  const saveAnswer = async (arg, decision) => {
    const a = lastAnswer
    if (!a?.text) return sys('There is no answer to save yet.', 'info')
    const q = [...msgs].slice(0, msgs.indexOf(a)).reverse().find((m) => m.role === 'you')
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2')
    const name = (arg || `answer-${stamp}`).replace(/[\\/:*?"<>|]/g, '_').replace(/(\.md)?$/i, '.md')
    const rel = ctx.folder ? name : `${folderName(matter)}/${name}`
    const basis = basedOn(a.act).map((b, i) => `${i + 1}. ${b.label}`)
    const content = `# ${q ? q.text : 'Answer'}\n\n${a.text}\n${basis.length ? `\n## Based on\n\n${basis.join('\n')}\n` : ''}`
    try {
      const r = await ctx.api.saveInFolder({ ...ctx.folderBody(), path: rel, content, matterId: matterId || undefined, ...(decision ? { decision } : {}) })
      if (r.ask) return setSaveAsk({ req: r.ask, arg })
      // Also kept with the matter (Saved in the desktop app, /saved here).
      await ctx.api.saveItem({ matterId: matterId || null, kind: 'answer', title: arg || (q ? q.text.slice(0, 120) : ''), content, source: { kind: 'session', id: sessionId, sessionId } }).catch(() => {})
      sys(`Saved the answer as ${r.short} and with the matter (/saved).`)
    } catch (err) { sys(err.message, 'bad') }
  }

  // ── adding documents ──
  /** Copy files (or register folders) into the matter; one plain line per item. */
  const copyIntoMatter = async (paths) => {
    const out = []
    try {
      const ws = await ctx.api.workspace()
      const dest = path.join(ws.base, folderName(matter), 'documents')
      let copied = false
      for (const p of paths) {
        try {
          const stat = fs.statSync(p)
          if (stat.isDirectory()) {
            await ctx.api.addFolder(p, matterId)
            out.push({ kind: 'ok', text: `Folder added: ${shortPath(p)}` })
          } else {
            fs.mkdirSync(dest, { recursive: true })
            const target = path.join(dest, path.basename(p))
            if (path.resolve(target) !== path.resolve(p)) fs.copyFileSync(p, target)
            copied = true
            out.push({ kind: 'ok', text: `${path.basename(p)} — copied into the matter folder (your original is unchanged)` })
          }
        } catch (err) {
          log(`add ${p} failed:`, err)
          out.push({ kind: 'bad', text: `${path.basename(p)}: ${err.code === 'ENOENT' ? 'not found — check the path' : err.message}` })
        }
      }
      if (copied) await ctx.api.addFolder(dest, matterId)
    } catch (err) { out.push({ kind: 'bad', text: err.message }) }
    return out
  }

  const addDocs = async (raw) => {
    const paths = cleanPaths(raw)
    if (!paths.length) return
    setBusy('Adding and reading the documents… (large folders take a while)')
    const out = await copyIntoMatter(paths)
    setBusy('')
    setNotes(out)
    setInput('')
    await load()
  }

  // ── privileged on/off ──
  const setPrivileged = async (on, back = 'menu') => {
    setBusy(on ? 'Marking the matter privileged…' : 'Turning privileged off…')
    const text = on ? 'Privileged: nothing from this matter leaves this computer.' : 'No longer privileged: your client-data rule now decides.'
    try {
      const r = await ctx.api.updateMatter(matterId, { privileged: on })
      setMatter(r.matter)
      if (back === 'chat') sys(text)
      else setNotes([{ kind: 'ok', text }])
    } catch (err) { if (back === 'chat') sys(err.message, 'bad'); else setNotes([{ kind: 'bad', text: err.message }]) }
    setBusy('')
    setMode(back)
  }

  const chooseAgent = async (name) => {
    try {
      if (matterId) { const r = await ctx.api.updateMatter(matterId, { agent: name === 'associate' ? null : name }); setMatter(r.matter) } else ctx.setPrefs({ quickAgent: name })
    } catch (err) { setNotes([{ kind: 'bad', text: err.message }]) }
    setMode(matterId && mode === 'agent-menu' ? 'menu' : 'chat')
  }

  /** "Based on" in full for the last answer (Ctrl+B, /sources). */
  const lastAnswer = [...msgs].reverse().find((m) => m.role === 'ai' && m.act)
  const openSources = () => {
    if (!lastAnswer || !basedOn(lastAnswer.act).length) return sys('Nothing to show yet: the last answer did not use any law or document passages.', 'info')
    setSource(null)
    setMode('sources')
  }

  useInput((ch, k) => {
    if (busy || perm || saveAsk) return
    if (mode === 'chat' && k.ctrl && ch === 'b') return openSources()
    if (k.ctrl && ch === 'k' && !streaming) { setReturnTo(mode === 'chat' ? 'chat' : 'menu'); return setMode('palette') }
    if (mode === 'chat' && k.ctrl && ch === 'o' && pastes.length) { setInputRaw((v) => [v, ...pastes.map((p) => p.text)].filter(Boolean).join('\n')); return setPastes([]) }
    if (k.escape) {
      if (mode === 'sources' && source) return setSource(null)
      if (['model', 'key', 'keypick', 'datapick', 'perms', 'sources', 'lawsources', 'folder'].includes(mode) || (mode === 'unprivilege' && returnTo === 'chat')) { setReturnTo('menu'); return setMode('chat') }
      if (mode === 'palette') return setMode(returnTo)
      if (streaming && mode === 'chat') return abort.current?.abort()
      // The command hints close first; the typed text stays.
      if (mode === 'chat' && input.startsWith('/') && !slashClosed) return setSlashClosed(true)
      // Text typed and not sent: say it is kept before leaving.
      if (mode === 'chat' && (input.trim() || pastes.length) && !escHint) return setEscHint(true)
      if (mode === 'chat') return matterId ? setMode('menu') : ctx.back()
      if (mode === 'agent') return setMode('chat')
      if (mode === 'menu') return ctx.back()
      setNotes([])
      return setMode(matterId ? 'menu' : 'chat')
    }
    if (mode === 'chat' && k.tab && !streaming && !input.startsWith('/')) { setMode('agent') }
    const page = Math.max(pageRef.current.height - 2, 1)
    if (mode === 'chat' && k.pageUp) setScroll((s) => Math.min(s + page, Math.max(pageRef.current.total - pageRef.current.height, 0)))
    if (mode === 'chat' && k.pageDown) setScroll((s) => Math.max(s - page, 0))
  })

  const title = matterId ? (matter ? matter.title : 'Matter') : 'Quick question'
  const subtitle = matter ? [matter.client, matter.privileged ? `${sym.lock} privileged` : ''].filter(Boolean).join(`  ${sym.sep}  `) : ''
  const status = ctx.status(matter, `${agent.title} ${sym.down}`, { busy: streaming })
  const MODE_CRUMBS = { model: 'Which AI', key: 'Key', keypick: 'Key', datapick: 'Client data', data: 'Client data', perms: 'Permissions', lawsources: 'Law sources', actions: 'Actions', skills: 'Firm instructions', sources: 'Based on', docs: 'Documents', add: 'Add documents', folder: 'Working folder', palette: 'All commands', agent: 'Working as', 'agent-menu': 'Working as', unprivilege: 'Privileged', folderDocs: 'Working folder' }
  const crumbs = MODE_CRUMBS[mode] ? [title] : []
  const shownTitle = MODE_CRUMBS[mode] || title
  const agentItems = agents.map((a) => ({ value: a.name, label: `${a.name === agent.name ? sym.ok : ' '} ${a.title}`, hint: a.description }))

  let body
  let keys
  if (busy) body = html`<${Spinner} label=${busy} />`
  else if (mode === 'menu') {
    const items = [
      { value: 'chat', label: 'Ask a question', hint: msgs.length ? `${msgs.filter((m) => m.role === 'you').length} so far` : '' },
      { value: 'add', label: 'Add documents', hint: `${docs.length} in this matter` },
      { value: 'actions', label: 'Actions…', hint: 'review, chronology, translate, compare, grid, plan' },
      { value: 'agent', label: `Working as: ${agent.title} ${sym.down}` },
      { value: 'priv', label: `Privileged — keep on this computer: ${matter?.privileged ? 'On' : 'Off'}` },
      ...(cloud && !matter?.privileged ? [{ value: 'data', label: `Client data for this matter: ${describeRule(matter?.policy, matter)}` }] : []),
      { value: 'docs', label: `Documents in this matter (${docs.length})` },
      ...(ctx.folder && ctx.folder.documents && !docs.some((d) => String(d.path).startsWith(ctx.folder.path)) ? [{ value: 'folderDocs', label: `Use the ${ctx.folder.documents} document${ctx.folder.documents === 1 ? '' : 's'} in this folder for this matter`, hint: ctx.folder.short }] : []),
      { value: 'activity', label: 'Recent activity', hint: 'what OpenLex did, and where data went' },
      { value: 'record', label: 'AI record', hint: 'what the AI did, checkable, to show a client' },
      { value: 'back', label: 'Back to matters' },
    ]
    body = html`<${Box} flexDirection="column">
      ${notes.map((n, i) => html`<${Note} key=${i} kind=${n.kind}>${n.text}<//>`)}
      <${Menu} items=${items} onSelect=${(it) => {
        setNotes([])
        if (it.value === 'back') return ctx.back()
        if (it.value === 'agent') return setMode('agent-menu')
        if (it.value === 'priv') return matter?.privileged ? setMode('unprivilege') : setPrivileged(true)
        if (it.value === 'actions') return setMode('actions')
        if (it.value === 'activity') return ctx.go('activity', { matterId })
        if (it.value === 'record') return ctx.go('record', { matterId })
        if (it.value === 'chat') setEscHint(false)
        setMode(it.value)
      }} />
      <${Box} marginTop=${1}><${Text} dimColor wrap="wrap">${matter?.privileged ? 'Privileged: nothing from this matter leaves this computer, whatever the settings say.' : 'Mark the matter privileged to keep everything in it on this computer.'}<//><//>
    <//>`
  } else if (mode === 'data') {
    body = html`<${Field} label=${`May documents of this matter be sent to ${(cloud.providers || []).map(nameOf).join(', ')}?`} help="Only for this matter. Your general rule is in Settings.">
      <${Menu} items=${[{ value: false, label: 'No — keep them on this computer' }, { value: true, label: 'Yes, for this matter' }]} onSelect=${async (it) => {
        setBusy('Saving…')
        try { await ctx.api.setMatterPolicy(matterId, it.value ? cloud : { mode: 'local-only' }); await load() } catch (err) { setNotes([{ kind: 'bad', text: err.message }]) }
        setBusy('')
        setMode('menu')
      }} />
    <//>`
  } else if (mode === 'agent' || mode === 'agent-menu') {
    keys = `↑↓ move ${sym.sep} Enter choose ${sym.sep} Esc back`
    body = html`<${Field} label="Who should OpenLex work as?" help="Stays chosen for this matter until you change it. Typing as researcher: … at the start of a question works too.">
      <${Menu} items=${agentItems} initial=${Math.max(0, agents.findIndex((a) => a.name === agent.name))} describe onSelect=${(it) => chooseAgent(it.value)} />
    <//>`
  } else if (mode === 'unprivilege') {
    keys = `type yes and Enter ${sym.sep} Esc keep it privileged`
    body = html`<${Field} label="Turn privileged off?" help="Then this matter follows your client-data rule, which may allow sending its documents to the cloud AI. Type yes to confirm; anything else keeps it privileged.">
      <${TextField} value=${confirmText} onChange=${setConfirmText} noHelp placeholder="yes" onSubmit=${(v) => { const back = returnTo; setReturnTo('menu'); setConfirmText(''); return /^\s*yes\s*$/i.test(v) ? setPrivileged(false, back) : (setMode(back), back === 'chat' ? sys('Still privileged.', 'info') : setNotes([{ kind: 'ok', text: 'Still privileged.' }])) }} />
    <//>`
  } else if (mode === 'folder') {
    keys = `Enter use it ${sym.sep} Tab complete ${sym.sep} Esc back to the chat`
    body = html`<${FolderPicker} onDone=${(n) => { setMode('chat'); sys(n.text, n.kind) }} />`
  } else if (mode === 'folderDocs') {
    body = html`<${Field} label=${`Use the ${ctx.folder?.documents || ''} documents in this folder for this matter?`} help=${`${fitPath(ctx.folder?.short || '', cols - 10)} — OpenLex adds the folder to this matter's documents (your files stay where they are) and reads them for reviews, chronologies and questions.`}>
      <${Menu} numbered items=${[{ value: true, label: 'Yes, use them for this matter' }, { value: false, label: 'No' }]} onSelect=${async (it) => {
        if (!it.value) return setMode('menu')
        setBusy('Adding the folder to the matter…')
        try { await ctx.api.addFolder(ctx.folder.path, matterId); setNotes([{ kind: 'ok', text: `The documents in ${ctx.folder.short} now belong to this matter.` }]); await load() } catch (err) { setNotes([{ kind: 'bad', text: err.message }]) }
        setBusy('')
        setMode('menu')
      }} />
    <//>`
  } else if (mode === 'palette') {
    keys = `↑↓ move ${sym.sep} Enter run ${sym.sep} Esc back`
    body = html`<${Field} label="All commands" help="The same as typing them with / in the question field.">
      <${Menu} items=${COMMANDS.map((c) => ({ value: c.name, label: `/${c.name}`.padEnd(14) + c.help }))} maxVisible=${Math.max(rows - 12, 5)} onSelect=${(it) => { setMode('chat'); command(it.value, '') }} />
    <//>`
  } else if (mode === 'model') {
    keys = `↑↓ move ${sym.sep} Enter choose ${sym.sep} Esc back to the chat`
    const list = ctx.info.providers?.providers || []
    const items = [
      ...list.filter((p) => p.local || p.hasKey || p.id === ctx.info.providers?.active || ['anthropic', 'openai', 'mistral', 'openrouter'].includes(p.id)).map((p) => ({
        value: p.id,
        label: `${p.id === ctx.info.providers?.active ? sym.ok : ' '} ${p.local ? 'On this computer' : nameOf(p.id)}${p.model ? `  ${p.model}` : ''}`,
        hint: p.local ? 'nothing leaves this computer' : p.needsKey ? (p.hasKey ? 'key saved' : 'no key yet') : '',
      })),
      { value: '__setup', label: '  Set up another way…', hint: 'your firm\'s cloud account, a firm server, Ollama' },
    ]
    body = html`<${Field} label="Where should the AI run?" help="Applies from your next question. Client data still follows your rule (/data).">
      <${Menu} items=${items} onSelect=${(it) => { setMode('chat'); return it.value === '__setup' ? ctx.go('setup', {}) : switchModel(it.value) }} />
    <//>`
  } else if (mode === 'keypick') {
    const withKeys = (ctx.info.providers?.providers || []).filter((p) => p.needsKey)
    body = html`<${Field} label="Which service is the key for?">
      <${Menu} items=${withKeys.map((p) => ({ value: p.id, label: nameOf(p.id), hint: p.hasKey ? 'key saved' : 'no key' }))} onSelect=${(it) => { setKeyFor(it.value); setSecret(''); setMode('key') }} />
    <//>`
  } else if (mode === 'key' && keyFor) {
    keys = `Enter save and check ${sym.sep} Esc back to the chat`
    body = html`<${Field} label=${`Your ${nameOf(keyFor)} key`} help="Paste it here (it stays hidden). It is stored in this computer's keychain, then checked with one tiny request.">
      <${TextField} value=${secret} mask onChange=${setSecret} onSubmit=${(v) => v.trim() && saveKey(keyFor, v.trim())} />
    <//>`
  } else if (mode === 'datapick') {
    const active = ctx.info.providers?.active
    const items = [
      { value: 'local', label: 'Keep it on this computer', hint: 'Most private. Questions about documents then need the AI on this computer.' },
      { value: 'allow', label: `Allow ${nameOf(active)}`, hint: `Documents may be sent to ${nameOf(active)}.` },
      { value: 'eu', label: `Allow ${nameOf(active)}, EU data centres only`, hint: 'Blocked if the AI would run outside the EU.' },
      { value: 'redact', label: `Allow ${nameOf(active)}, hide client names`, hint: 'Names you list for a matter are replaced before sending and put back in the answer.' },
    ]
    body = html`<${Field} label=${`Where may client data ${matterId ? 'of this matter ' : ''}go?`} help=${matterId ? 'Only for this matter. Your general rule is in Settings.' : 'Your general rule (matters can have their own).'}>
      <${Menu} items=${items} describe onSelect=${(it) => setData(it.value)} />
    <//>`
  } else if (mode === 'lawsources') {
    keys = `↑↓ move ${sym.sep} Enter choose ${sym.sep} Esc back to the chat`
    body = html`<${LawSources} api=${ctx.api} matterId=${matterId} />`
  } else if (mode === 'perms') {
    keys = `↑↓ move ${sym.sep} Enter remove ${sym.sep} Esc back to the chat`
    body = html`<${PermissionRules} api=${ctx.api} matterId=${matterId} onNote=${(n) => sys(n.text, n.kind)} />`
  } else if (mode === 'actions') {
    body = html`<${Field} label="What should OpenLex do?">
      <${Menu} items=${ACTIONS} describe onSelect=${(it) => {
        if (it.value === 'skill') { loadSkills(); return setMode('skills') }
        ctx.go('action', { kind: it.value, matterId })
      }} />
    <//>`
  } else if (mode === 'skills') {
    body = skills === null
      ? html`<${Spinner} label="Loading your firm's instructions…" />`
      : skills.length
        ? html`<${Field} label="Which of your firm's instructions?">
            <${Menu} items=${skills.map((s) => ({ value: s.name, label: s.title || s.name, hint: s.description }))} describe onSelect=${(it) => { setInput(`/${it.value} `); setMode('chat') }} />
          <//>`
        : html`<${Note}>Your firm has not written any instructions yet.<//>`
  } else if (mode === 'sources') {
    keys = source ? 'Esc back to the list' : `↑↓ move ${sym.sep} Enter show in full ${sym.sep} Esc back to the chat`
    const items = basedOn(lastAnswer?.act)
    body = source
      ? html`<${Box} flexDirection="column">
          <${Text} bold wrap="truncate-end">${source.label}<//>
          <${Box} marginTop=${1}><${Text} wrap="wrap">${source.text}<//><//>
        <//>`
      : html`<${Field} label="What the last answer is based on" help=${sourcesNote(items)}>
          <${Menu} items=${items.map((it, i) => ({ value: i, label: `[${i + 1}] ${it.label}`, hint: it.detail || (it.kind === 'doc' ? 'a passage of your document that OpenLex read' : '') }))} describe onSelect=${async (it) => {
            const item = items[it.value]
            if (item.kind !== 'law' || !item.chunk_id) return setSource({ label: item.label, text: `${item.detail || 'OpenLex read this part of your document for the answer.'}${item.url ? `\n\n${item.url}` : ''}` })
            setSource({ label: item.label, text: 'Opening…' })
            try {
              const r = await ctx.api.lawSection(item.chunk_id)
              setSource({ label: [r.source_name, r.section].filter(Boolean).join(' ') || item.label, text: r.content || item.detail })
            } catch (err) { setSource({ label: item.label, text: `${item.detail ? `${item.detail}\n\n` : ''}(The full text could not be opened: ${err.message})` }) }
          }} />
        <//>`
  } else if (mode === 'docs') {
    body = html`<${Box} flexDirection="column">
      ${docs.length ? docs.slice(0, rows - 11).map((d) => html`<${Text} key=${d.path} wrap="truncate-middle">${sym.bullet} ${d.name}<${Text} dimColor>  ${shortPath(path.dirname(d.path))}<//><//>`) : html`<${Text} dimColor>No documents yet. Choose "Add documents".<//>`}
      ${docs.length > rows - 11 ? html`<${Text} dimColor>… and ${docs.length - (rows - 11)} more<//>` : null}
    <//>`
  } else if (mode === 'add') {
    keys = `Enter add ${sym.sep} Tab complete the name ${sym.sep} Esc back`
    body = html`<${Box} flexDirection="column">
      ${notes.map((n, i) => html`<${Note} key=${i} kind=${n.kind}>${n.text}<//>`)}
      <${Field} label="Which documents?" help="Drag files or a folder from Finder or Explorer into this window, or type the path. Word, PDF, text. Several at once is fine.">
        <${TextField} value=${input} onChange=${setInput} onSubmit=${addDocs} onTab=${completePath} placeholder="~/Documents/Matter/contract.docx" />
      <//>
    <//>`
  } else {
    // chat
    const running = streaming ? [...msgs].reverse().find((m) => m.role === 'ai' && m.act && !m.act.endedAt) : null
    const current = running?.act.steps.findLast((x) => x.status === 'now')?.text
    const ask = perm || saveAsk?.req
    keys = ask ? `1-${(ask.choices || []).length} or Enter choose ${sym.sep} ${ask.choices?.includes('always_matter') ? `a always (this matter) ${sym.sep} ` : ask.choices?.includes('always_folder') ? `a always (this folder) ${sym.sep} ` : ''}${ask.choices?.includes('always') ? `A always ${sym.sep} ` : ''}n or Esc don't allow`
      : streaming ? `Esc or Ctrl+C stop (the answer so far is kept) ${sym.sep} /model, /data work meanwhile`
        : escHint ? `Esc again: ${matterId ? 'menu' : 'back'} ${sym.sep} your text is kept for when you come back`
          : `Enter send ${sym.sep} Ctrl+J new line ${sym.sep} / or Ctrl+K commands ${sym.sep} Esc ${matterId ? 'menu' : 'back'}`
    const slash = ask || slashClosed ? [] : slashHints(input, () => { loadSkills(); return skills || [] })
    const chips = (files.length ? files.length + 1 : 0) + (pastes.length ? 1 : 0)
    // The newest lines that fit between the title and the question field
    // (the permission prompt takes about 11 of them while it is open).
    const width = Math.max(cols - 2, 20)
    const inputRows = Math.min(input.split('\n').reduce((n, l) => n + Math.max(Math.ceil((l.length + 3) / width), 1), 0), 5)
    const height = ask ? Math.max(rows - 22, 1) : Math.max(rows - 10 - slash.length - chips - inputRows, 3)
    const lines = msgs.length ? transcript(msgs, width, now) : emptyLines({ folder: !!ctx.folder, matter: !!matterId, folderShort: ctx.folder?.short })
    const end = Math.max(lines.length - Math.min(scroll, Math.max(lines.length - height, 0)), 0)
    const shown = lines.slice(Math.max(end - height, 0), end)
    pageRef.current = { height, total: lines.length }
    body = html`<${Box} flexDirection="column" flexGrow=${1}>
      <${Box} flexDirection="column" flexGrow=${1}>
        ${shown.map((l, i) => html`<${Text} key=${i} wrap="truncate-end">${l.segs.map((g, k) => html`<${Text} key=${k} dimColor=${!!g.dim} bold=${!!g.bold} color=${g.color}>${g.t}<//>`)}<//>`)}
      <//>
      ${slash.map((s) => html`<${Text} key=${s.key} dimColor wrap="truncate-end">  ${s.text}<//>`)}
      ${perm
        ? html`<${PermissionPrompt} key=${perm.id} req=${perm} onAnswer=${(d) => answerPerm(perm, d)} />`
        : saveAsk
          ? html`<${PermissionPrompt} key="save" req=${saveAsk.req} onAnswer=${(d) => { const s = saveAsk; setSaveAsk(null); if (d === 'deny') return sys(`Not saved: ${s.req.summary}`, 'warn'); saveAnswer(s.arg, d) }} />`
          : html`<${Box} flexDirection="column">
            ${files.map((f) => html`<${Text} key=${f.path} color=${color.accent} wrap="truncate-middle">${chipLabel(f)}<//>`)}
            ${files.length ? html`<${Text} dimColor wrap="truncate-end">${attachSentence(files)}<//>` : null}
            ${pastes.length ? html`<${Text} color=${color.accent} wrap="truncate-end">${pastes.map((p) => `[Pasted ${p.lines} lines]`).join(' ')}<${Text} dimColor>  Ctrl+O shows it in the field ${sym.sep} Backspace removes it<//><//>` : null}
            ${streaming ? html`<${Spinner} label=${`${current || 'Working'}… (Esc stops it)`} />` : escHint ? html`<${Note} kind="info">Your text is kept. Press Esc again to go back, or Enter to send it.<//>` : html`<${Text} dimColor>Working as: <${Text} color=${color.accent}>${agent.title} ${sym.down}<//> (Tab to change)<//>`}
            <${TextField} value=${input} onChange=${setInput} onSubmit=${send} onPaste=${onPaste} multiline
              onTab=${(v) => { if (!v.startsWith('/') || /\s/.test(v)) return v; const h = slashHints(v, () => skills || [])[0]; return h ? `/${h.key.replace(/^[cs]:/, '')} ` : v }}
              onHistory=${(d) => { const hs = histories.get(key) || []; if (!hs.length || input && hist < 0) return; const n = hist < 0 ? (d < 0 ? hs.length - 1 : -1) : hist + d; if (n < 0 || n >= hs.length) { setHist(-1); return setInputRaw('') } setHist(n); setInputRaw(hs[n]) }}
              onBackspaceEmpty=${() => (pastes.length ? setPastes((p) => p.slice(0, -1)) : setFiles((f) => f.slice(0, -1)))} placeholder=${streaming ? 'Commands work while the answer is written: /model, /data …' : files.length ? 'Type your question about the file and press Enter' : 'Type your question (or / for commands) and press Enter'} />
          <//>`}
    <//>`
  }
  return html`<${Frame} title=${shownTitle} crumbs=${crumbs} subtitle=${crumbs.length ? '' : subtitle} status=${status} keys=${keys}>${body}<//>`
}

/** An empty conversation: what to ask, with examples. */
export function emptyLines({ folder = false, matter = false, folderShort = '' } = {}) {
  const L = [{ segs: [{ t: matter ? 'Ask anything about this matter: its documents, the law, a draft.' : folder ? `Ask about the documents in ${folderShort}, or any legal question.` : 'Ask a legal question. Nothing here is tied to a matter.', dim: false }] }, { segs: [{ t: ' ' }] }, { segs: [{ t: 'Try:', bold: true }] }]
  for (const e of examples({ folder, matter })) L.push({ segs: [{ t: `  ${sym.prompt} `, color: color.accent }, { t: e }] })
  L.push({ segs: [{ t: ' ' }] }, { segs: [{ t: 'Drag a file into this window to ask about it. ? shows help.', dim: true }] })
  return L
}

/**
 * Hints under the question field while a "/" is typed: matching commands
 * first, then firm skills; for a complete command, what it takes.
 */
export function slashHints(input, skills) {
  const full = /^\/([\w-]+)\s/.exec(input)
  if (full) {
    const c = COMMANDS.find((x) => x.name === full[1].toLowerCase())
    return c ? [{ key: c.name, text: `/${c.name}${c.args ? ` ${c.args}` : ''} ${sym.sep} ${c.help}` }] : []
  }
  if (!/^\/[\w-]*$/.test(input)) return []
  const word = input.slice(1).toLowerCase()
  // A short list that leaves room for the conversation: keep typing to narrow it, Ctrl+K for all.
  const allCmds = COMMANDS.filter((c) => c.name.startsWith(word))
  const allSk = skills().filter((s) => s.name.startsWith(word) && !COMMANDS.some((c) => c.name === s.name))
  const cmds = allCmds.slice(0, word ? 5 : 6)
  const sk = allSk.slice(0, word ? 2 : 1)
  const more = allCmds.length - cmds.length + allSk.length - sk.length
  return [
    ...cmds.map((c) => ({ key: `c:${c.name}`, text: `/${c.name}${c.args ? ` ${c.args}` : ''} ${sym.sep} ${c.help}` })),
    ...sk.map((s) => ({ key: `s:${s.name}`, text: `/${s.name} ${sym.sep} firm instructions: ${s.description || s.title || ''}` })),
    ...(more > 0 ? [{ key: 'more', text: `${sym.ell} ${more} more: keep typing, or Ctrl+K for the full list` }] : []),
  ]
}

/** Word-wrap plain text to a width (long words are split). */
export function wrap(text, width) {
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (let word of para.split(/(\s+)/)) {
      while (word.length > width) { if (line) { out.push(line); line = '' } out.push(word.slice(0, width)); word = word.slice(width) }
      if ((line + word).length > width) { out.push(line.trimEnd()); line = word.trimStart() } else line += word
    }
    out.push(line)
  }
  return out
}

/**
 * The conversation as screen lines: the question (and the files sent with
 * it), the answer; while it is written the live steps (explain.mjs), then
 * what it is based on, proposed changes as cards with their check, where
 * the data went, tips and errors.
 */
export function transcript(msgs, width, now = clock.now()) {
  const L = []
  const add = (...segs) => L.push({ segs })
  const para = (text, style = {}, indent = '') => { for (const l of wrap(text, width - indent.length)) add(...(indent ? [{ t: indent, ...style.bar }] : []), { t: l, ...style }) }
  for (const m of msgs) {
    if (m.role === 'sys') {
      const mark = m.kind === 'bad' ? sym.bad : m.kind === 'warn' ? '!' : m.kind === 'info' ? ' ' : sym.ok
      const c = m.kind === 'bad' ? color.bad : m.kind === 'warn' ? color.warn : m.kind === 'ok' ? color.ok : undefined
      wrap(m.text, width - 2).forEach((l, i) => add({ t: i ? '  ' : `${mark} `, color: c, bold: true }, { t: l, dim: m.kind === 'info' }))
      continue
    }
    if (m.role === 'you') {
      add({ t: '' })
      const you = look.accessible ? 'you: ' : 'You: '
      wrap(`${you}${m.text}`, width).forEach((l, i) => add(...(i ? [{ t: l }] : [{ t: you, color: color.accent, bold: true }, { t: l.slice(you.length) }])))
      if (m.files?.length) add({ t: `  ${sym.clip} with ${m.files.join(', ')}`, dim: true })
      continue
    }
    if (m.as || m.skill) add({ t: [m.as ? `as ${m.as}` : '', m.skill ? `firm instructions: ${m.skill}` : ''].filter(Boolean).join(` ${sym.sep} `), dim: true })
    if (look.accessible && m.role === 'ai') add({ t: 'OpenLex:', bold: true })
    if (m.text) para(m.text)
    const act = m.act
    const live = act && !act.endedAt
    if (live) {
      if (m.text) add({ t: '' })
      // At most three steps while it works (the newest); the data line always.
      for (const segs of activityLines(act, { now, width, maxSteps: 3 })) add(...segs)
      continue
    }
    if (act) for (const segs of basedOnLines(act, width)) add(...segs)
    else if (m.sources?.length) {
      add({ t: 'Based on:', bold: true })
      m.sources.slice(0, 5).forEach((s, i) => add({ t: `  [${i + 1}] ` }, { t: [s.source_name, s.section].filter(Boolean).join(' ') }))
    }
    for (const s of m.suggestions) {
      const bar = { t: look.accessible ? '  ' : `${sym.bar} `, color: color.accent }
      if (look.accessible) add({ t: 'Proposed change:', bold: true })
      add(bar, { t: String(s.severity || 'note').toUpperCase(), bold: true, color: s.severity === 'high' ? color.bad : color.accent }, { t: `  ${s.summary || ''}` })
      if (s.proposed_text) wrap(`Proposed: ${String(s.proposed_text).slice(0, 400)}`, width - 2).forEach((l) => add(bar, { t: l }))
      if (s.basis) wrap(`Legal basis: ${basisText(s.basis)}`, width - 2).forEach((l) => add(bar, { t: l, dim: true }))
      const check = checkLine(s)
      add(bar, { t: check.ok ? check.text : `! ${check.text}`, color: check.ok ? color.ok : color.warn })
    }
    if (m.tip) para(m.tip, { dim: true })
    // An error in three parts: what happened (bold), why, what to do.
    if (m.err) {
      wrap(`${sym.bad} ${look.accessible ? 'error: ' : ''}${m.err.what}`, width).forEach((l) => add({ t: l, color: color.bad, bold: true }))
      if (m.err.why) wrap(m.err.why, width - 2).forEach((l) => add({ t: `  ${l}`, dim: true }))
      if (m.err.todo) wrap(m.err.todo, width - 2).forEach((l) => add({ t: `  ${l}` }))
    } else if (m.error) wrap(`${sym.bad} ${m.error}`, width).forEach((l) => add({ t: l, color: color.bad }))
    if (m.stopNote) para(m.stopNote, { dim: true })
    else if (m.stopped) add({ t: '(stopped)', dim: true })
    if (act) for (const segs of doneLines(act, width)) add(...segs)
    // What to do next, under the newest finished answer.
    if (act && m === msgs.findLast((x) => x.role === 'ai') && m.text && !m.error) add({ t: `Next: ask a follow-up ${sym.sep} /save the answer ${sym.sep} /copy it`, dim: true })
  }
  return L
}
