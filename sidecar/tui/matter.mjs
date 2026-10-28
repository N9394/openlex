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
 */

import fs from 'node:fs'
import path from 'node:path'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, color, sym, useSize } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { matchInvocation, log, friendly, describeRule, nameOf } from './api.mjs'
import { cleanPaths, completePath, shortPath } from './paths.mjs'
import { PermissionPrompt, PermissionRules, answeredLine } from './permission.mjs'

// Conversations survive going back to the matter list (for this session).
const conversations = new Map()

export const ACTIONS = [
  { value: 'review', label: 'Review the documents against a checklist', hint: 'Every document, checked point by point; each finding quotes the document.' },
  { value: 'chronology', label: 'Build a chronology', hint: 'Dated events from all documents, each date checked against its quote.' },
  { value: 'translate', label: 'Translate a document', hint: 'A Word translation plus a side-by-side file for checking.' },
  { value: 'compare', label: 'Compare two versions', hint: 'What changed between two drafts, with the important changes rated.' },
  { value: 'grid', label: 'Ask the same questions of every document (review grid)', hint: 'One row per document, one column per question, saved as Excel.' },
  { value: 'plan', label: 'Plan a larger task (you approve each step)', hint: 'OpenLex proposes the steps; nothing runs until you approve.' },
  { value: 'skill', label: 'Use a firm skill', hint: 'Instructions your firm wrote for recurring tasks.' },
]

/** Commands in the chat ("/model …"). They win over firm skills with the same name. */
export const COMMANDS = [
  { name: 'model', args: '[local | anthropic | openrouter:MODEL]', help: 'where the AI runs' },
  { name: 'key', args: '[service]', help: 'add or replace a key, then check it' },
  { name: 'data', args: '', help: 'where client data may go' },
  { name: 'as', args: '[profile]', help: 'who OpenLex works as' },
  { name: 'privileged', args: 'on|off', help: 'keep this matter on this computer' },
  { name: 'permissions', args: '', help: 'what OpenLex may do without asking' },
  { name: 'clear', args: '', help: 'start a new conversation' },
  { name: 'help', args: '', help: 'these commands' },
]
const PROVIDER_WORDS = { claude: 'anthropic', computer: 'local', 'this-computer': 'local', gpt: 'openai', firm: 'custom' }
const isEu = (r) => /^(eu|europe)/i.test(String(r || ''))
let seq = 0

/** Folder name the engine uses for a matter's files (workspace.matterFolder). */
const folderName = (m) => String(m ? (m.number ? `${m.number} ${m.title}` : m.title) : 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)

export function Matter({ matterId = null }) {
  const ctx = useAppCtx()
  const key = matterId || 'quick'
  const [matter, setMatter] = useState(null)
  const [docs, setDocs] = useState([])
  const [mode, setMode] = useState(matterId ? 'menu' : 'chat')
  const [msgs, setMsgs] = useState(() => conversations.get(key) || [])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [skills, setSkills] = useState(null)
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState([]) // [{ kind, text }]
  const [scroll, setScroll] = useState(0)
  const [perm, setPerm] = useState(null) // a permission request waiting for the lawyer
  const [keyFor, setKeyFor] = useState(null) // provider whose key is being typed (/key)
  const [secret, setSecret] = useState('')
  const [returnTo, setReturnTo] = useState('menu') // where a picker opened from the chat goes back to
  const abort = useRef(null)
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
  useEffect(() => { conversations.set(key, msgs) }, [msgs])
  useEffect(() => () => abort.current?.abort(), [])
  const skillsAsked = useRef(false)
  const loadSkills = () => { if (skillsAsked.current) return; skillsAsked.current = true; ctx.api.skills().then((r) => setSkills((r.skills || []).filter((s) => !s.error))).catch(() => setSkills([])) }

  // ── asking ──
  /** One line from OpenLex itself in the conversation (command confirmations, permission answers). */
  const sys = (text, kind = 'ok') => setMsgs((m) => [...m, { role: 'sys', text, kind }])

  const send = async (raw) => {
    const text = raw.trim()
    if (!text) return
    const cmd = text.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/)
    if (cmd && COMMANDS.some((c) => c.name === cmd[1].toLowerCase())) {
      setInput('')
      setScroll(0)
      return command(cmd[1].toLowerCase(), (cmd[2] || '').trim())
    }
    if (streaming) return sys('The answer is still being written. Wait for it (or press Esc to stop it), then ask again. Commands like /model work meanwhile.', 'warn')
    let message = text
    let as = agent
    const inv = matchInvocation(text, agents)
    if (inv) { as = inv.agent; message = inv.message || text }
    setInput('')
    setScroll(0)
    const id = ++seq
    const answer = { id, role: 'ai', text: '', sources: [], suggestions: [], step: 'Thinking…', as: as.name !== 'associate' ? as.title : '' }
    setMsgs((m) => [...m, { role: 'you', text }, answer])
    // By id, not "the last message": command lines may arrive while the answer streams.
    const patch = (fn) => setMsgs((m) => m.map((x) => { if (x.id !== id) return x; const c = { ...x }; fn(c); return c }))
    const ac = new AbortController()
    abort.current = ac
    setStreaming(true)
    try {
      await ctx.api.chat({ message, docId: `tui:${key}`, matterId: matterId || undefined, agent: as.name, interactive: true }, (ev) => {
        if (ev.type === 'text') patch((a) => { a.text += ev.text; a.step = '' })
        else if (ev.type === 'step') patch((a) => { a.step = ev.text })
        else if (ev.type === 'law') patch((a) => { for (const s of ev.sources || []) if (!a.sources.some((x) => (x.chunk_id && x.chunk_id === s.chunk_id) || (x.source_name === s.source_name && x.section === s.section))) a.sources = [...a.sources, s] })
        else if (ev.type === 'suggestion') patch((a) => { a.suggestions = [...a.suggestions, ev.suggestion] })
        else if (ev.type === 'skill') patch((a) => { a.skill = ev.title })
        else if (ev.type === 'skill_suggestion' && ev.name) patch((a) => { a.tip = `The firm skill "${ev.title || ev.name}" may fit — choose it under Actions → Use a firm skill.` })
        else if (ev.type === 'error') patch((a) => { a.error = friendly(ev.message) })
        else if (ev.type === 'permission') { setPerm(ev); setMode('chat') }
        else if (ev.type === 'permission_result' && ev.by !== 'lawyer') {
          // Decided without the lawyer (no answer in time): close the prompt and say so.
          setPerm((p) => { if (p?.id === ev.id) sys(`No answer in time, so not allowed: ${p.summary}`, 'warn'); return p?.id === ev.id ? null : p })
        }
      }, ac.signal)
    } catch (err) {
      patch((a) => { a.error = err.message })
    }
    patch((a) => { a.step = ''; if (ac.signal.aborted) a.stopped = true })
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
    const name = prov ? `${prov.model || (prov.local && info?.status?.model?.name) || 'the AI'} (${nameOf(prov.id)})` : 'the AI'
    const where = !prov || prov.local ? 'on this computer' : `cloud${isEu(prov.region) ? ', EU' : ''}`
    const allowed = prov?.local || (rule?.mode === 'allow-list' && (rule.providers || []).includes(prov?.id) && !m?.privileged)
    return { line: `Now using ${name}, ${where}. Client data${matterId ? ' for this matter' : ''}: ${describeRule(rule, m)}.${!allowed && prov && !prov.local ? ` To send documents to ${nameOf(prov.id)}: /data.` : ''}`, info }
  }
  const nextNote = () => (streaming ? ' This applies from your next question; the answer being written keeps the current model.' : '')

  const switchModel = async (arg) => {
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
      sys(`${line}${nextNote()}${fresh?.needsKey && !fresh.hasKey ? ` There is no key for ${nameOf(id)} yet: /key ${id}.` : ''}`)
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
      return sys('Anything else after "/" runs a firm skill of that name.', 'info')
    }
    if (name === 'model') { if (arg) return switchModel(arg); return setMode('model') }
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
      if (!a) return sys(`No profile called "${arg}". Choose one of: ${agents.map((x) => x.name).join(', ')}.`, 'bad')
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
    if (name === 'clear') {
      try {
        await ctx.api.clearConversation(`tui:${key}`)
        setMsgs([])
        sys(`New conversation${matterId ? ' for this matter' : ''}: OpenLex no longer remembers the earlier questions. The documents are still there.`)
      } catch (err) { sys(err.message, 'bad') }
    }
  }

  // ── adding documents ──
  const addDocs = async (raw) => {
    const paths = cleanPaths(raw)
    if (!paths.length) return
    setBusy('Adding and reading the documents… (large folders take a while)')
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
            fs.copyFileSync(p, path.join(dest, path.basename(p)))
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

  useInput((ch, k) => {
    if (busy || perm) return
    if (k.escape) {
      if (['model', 'key', 'keypick', 'datapick', 'perms'].includes(mode) || (mode === 'unprivilege' && returnTo === 'chat')) { setReturnTo('menu'); return setMode('chat') }
      if (streaming && mode === 'chat') return abort.current?.abort()
      if (mode === 'chat') return matterId ? setMode('menu') : ctx.back()
      if (mode === 'agent') return setMode('chat')
      if (mode === 'menu') return ctx.back()
      setNotes([])
      return setMode(matterId ? 'menu' : 'chat')
    }
    if (mode === 'chat' && k.tab && !streaming) { setMode('agent') }
    const page = Math.max(pageRef.current.height - 2, 1)
    if (mode === 'chat' && k.pageUp) setScroll((s) => Math.min(s + page, Math.max(pageRef.current.total - pageRef.current.height, 0)))
    if (mode === 'chat' && k.pageDown) setScroll((s) => Math.max(s - page, 0))
  })

  const title = matterId ? (matter ? matter.title : 'Matter') : 'Quick question'
  const subtitle = matter ? [matter.client, matter.privileged ? `${sym.lock} privileged` : ''].filter(Boolean).join(`  ${sym.sep}  `) : ''
  const status = ctx.status(matter, `${agent.title} ${sym.down}`)
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
    body = html`<${Field} label="Turn privileged off?" help="Then this matter follows your client-data rule, which may allow sending its documents to the cloud AI.">
      <${Menu} items=${[{ value: false, label: 'No, keep it privileged' }, { value: true, label: 'Yes, turn privileged off' }]} onSelect=${(it) => { const back = returnTo; setReturnTo('menu'); return it.value ? setPrivileged(false, back) : setMode(back) }} />
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
      ? html`<${Spinner} label="Loading the firm's skills…" />`
      : skills.length
        ? html`<${Field} label="Which skill?">
            <${Menu} items=${skills.map((s) => ({ value: s.name, label: s.title || s.name, hint: s.description }))} describe onSelect=${(it) => { setInput(`/${it.value} `); setMode('chat') }} />
          <//>`
        : html`<${Note}>Your firm has no skills yet.<//>`
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
    keys = perm ? `Enter choose ${sym.sep} ${perm.choices?.includes('always_matter') ? `a always (this matter) ${sym.sep} ` : ''}${perm.choices?.includes('always') ? `A always ${sym.sep} ` : ''}n or Esc don't allow`
      : streaming ? `Esc stop the answer ${sym.sep} /model, /data … work meanwhile ${sym.sep} Ctrl+C quit` : `Enter send ${sym.sep} / commands ${sym.sep} Tab working as ${sym.sep} PgUp/PgDn scroll ${sym.sep} Esc ${matterId ? 'menu' : 'back'}`
    const slash = perm ? [] : slashHints(input, () => { loadSkills(); return skills || [] })
    // The newest lines that fit between the title and the question field
    // (the permission prompt takes about 11 of them while it is open).
    const width = Math.max(cols - 2, 20)
    const height = perm ? Math.max(rows - 21, 1) : Math.max(rows - 10 - slash.length - Math.ceil((input.length + 3) / width), 3)
    const lines = msgs.length ? transcript(msgs, width) : [{ segs: [{ t: matterId ? 'Ask anything about this matter: its documents, the law, a draft.' : 'Ask a legal question. Nothing here is tied to a matter.', dim: true }] }]
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
        : html`<${Box} flexDirection="column">
            ${streaming ? html`<${Spinner} label="Writing the answer… (Esc stops it)" />` : html`<${Text} dimColor>Working as: <${Text} color=${color.accent}>${agent.title} ${sym.down}<//> (Tab to change)<//>`}
            <${TextField} value=${input} onChange=${setInput} onSubmit=${send} placeholder=${streaming ? 'Commands work while the answer is written: /model, /data …' : 'Type your question (or / for commands) and press Enter'} />
          <//>`}
    <//>`
  }
  return html`<${Frame} title=${title} subtitle=${subtitle} status=${status} keys=${keys}>${body}<//>`
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
  const cmds = COMMANDS.filter((c) => c.name.startsWith(word)).slice(0, word ? 4 : COMMANDS.length)
  const sk = skills().filter((s) => s.name.startsWith(word) && !COMMANDS.some((c) => c.name === s.name)).slice(0, word ? 3 : 2)
  return [
    ...cmds.map((c) => ({ key: `c:${c.name}`, text: `/${c.name}${c.args ? ` ${c.args}` : ''} ${sym.sep} ${c.help}` })),
    ...sk.map((s) => ({ key: `s:${s.name}`, text: `/${s.name} ${sym.sep} firm skill: ${s.description || s.title || ''}` })),
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
 * The conversation as screen lines: the question, the answer, the sources
 * found (numbered), proposed changes as cards, tips and errors.
 */
export function transcript(msgs, width) {
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
      wrap(`You: ${m.text}`, width).forEach((l, i) => add(...(i ? [{ t: l }] : [{ t: 'You: ', color: color.accent, bold: true }, { t: l.slice(5) }])))
      continue
    }
    if (m.as || m.skill) add({ t: [m.as ? `as ${m.as}` : '', m.skill ? `firm skill: ${m.skill}` : ''].filter(Boolean).join(` ${sym.sep} `), dim: true })
    if (m.text) para(m.text)
    if (m.step) add({ t: `${sym.bullet} ${m.step}`, dim: true })
    if (m.sources.length) {
      add({ t: 'Sources found:', dim: true })
      m.sources.slice(0, 5).forEach((s, i) => add({ t: `  [${i + 1}] `, dim: true }, { t: [s.source_name, s.section].filter(Boolean).join(' ') }))
      if (m.sources.length > 5) add({ t: `  … ${m.sources.length - 5} more`, dim: true })
    }
    for (const s of m.suggestions) {
      const bar = { t: `${sym.bar} `, color: color.accent }
      add(bar, { t: String(s.severity || 'note').toUpperCase(), bold: true, color: s.severity === 'high' ? color.bad : color.accent }, { t: `  ${s.summary || ''}` })
      if (s.proposed_text) wrap(`Proposed: ${String(s.proposed_text).slice(0, 400)}`, width - 2).forEach((l) => add(bar, { t: l }))
      if (s.basis) wrap(`Basis: ${s.basis}`, width - 2).forEach((l) => add(bar, { t: l, dim: true }))
    }
    if (m.tip) para(m.tip, { dim: true })
    if (m.error) wrap(`${sym.bad} ${m.error}`, width).forEach((l) => add({ t: l, color: color.bad }))
    if (m.stopped) add({ t: '(stopped)', dim: true })
  }
  return L
}
