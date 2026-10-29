// The App's chat: questions and answers through the OpenLex engine
// (POST /api/chat) — the same engine, the same events and the same matter
// conversation as the terminal app and the Word pane ("one OpenLex, three
// windows"). While OpenLex works, the lawyer sees each step in plain words,
// how long it has taken, where the data went and how to stop; afterwards
// what the answer is based on and whether proposed changes were checked.
// When OpenLex wants to save a file, open a web page, run a program or use
// a connector, a small dialog asks first (Allow once / Always / Don't allow).
//
// Conversations live in the engine (GET /api/sessions?matterId=…): the
// matter's newest one opens here, whichever window it was started in, and
// continuing it here continues it everywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { BookOpen, Check, ChevronDown, ChevronUp, Clock, Copy, FileSearch, FileText, FolderOpen, Lock, MessageSquare, Paperclip, Plus, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useWordLink, hubBridge } from '../lib/hub'
import { useChatCommands } from '../components/ChatCommands'
import { ModelLabel } from '../components/ModelPicker'
import i18n from '../i18n'
import { engine } from '../lib/commands'
import {
  Activity, Basis, LawSource, ModelUse, WINDOW_WORDS, applyEvent, basedOn, checkLine, basisText, clip, dataLine, duration,
  endActivity, friendly, mark, permission, startActivity, stopSentence, summaryLine,
} from '../lib/turn'
import { Attachment, attachFile, chipDetail, refusal } from '../lib/attach'
import AnalysisCard from '../components/AnalysisCard'
import BatchCard from '../components/BatchCard'

interface Matter { id: string; title: string; number?: string; client?: string; privileged?: boolean; agent?: string | null }
interface Conversation { id: string; title: string; matterId: string | null; clients: string[]; turns: number; updatedAt: string | null }
interface Agent { name: string; title: string; description?: string }

interface Message {
  id: string
  role: 'user' | 'assistant' | 'sys'
  content: string
  kind?: 'ok' | 'warn' | 'bad' | 'info'
  files?: string[]
  at?: string
  client?: string
  as?: string
  act?: Activity
  stored?: boolean // from the engine's conversation (earlier, or another window)
  suggestions?: any[]
  notes?: string[]
  error?: string
  stopNote?: string
  tip?: string
  analyses?: any[] // full document analyses (POST /api/analyse), shown as cards
  analysisIds?: string[] // from a stored turn: loaded by the card
  batch?: { attachments: string[] } // several documents: analysed one by one in the background
  reading?: string // how an attached document is read ("in full by Claude (EU)" / "part by part")
}

const mattersBridge = () => (typeof window !== 'undefined' && (window as any).lexvault?.matters) || null
let seq = 0
const nextId = () => `m${Date.now().toString(36)}${++seq}`

/** A stored turn (GET /api/session) as a message on screen. */
function storedMessage(m: any): Message {
  if (m.role === 'user') return { id: nextId(), role: 'user', content: m.content, at: m.at, client: m.client, stored: true }
  const at = m.at ? Date.parse(m.at) : Date.now()
  const act: Activity = { ...startActivity(at), steps: [], endedAt: at, models: (m.data || []) as ModelUse[], online: m.online || [], sources: (m.sources || []) as LawSource[], stopped: !!m.stopped }
  const analysisIds = (m.results || []).filter((r: any) => r && r.kind === 'analysis' && r.id).map((r: any) => r.id)
  return { id: nextId(), role: 'assistant', content: m.content, at: m.at, client: m.client, as: m.agent || '', act, stored: true, ...(analysisIds.length ? { analysisIds } : {}) }
}

function when(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return i18n.t('chat.justNow', 'just now')
  if (mins < 60) return i18n.t('chat.minAgo', '{{n}} min ago', { n: mins })
  if (mins < 24 * 60) return i18n.t('chat.todayAt', 'today {{time}}', { time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export default function Research() {
  const { t } = useTranslation()
  const location = useLocation()
  const wordLink = useWordLink()
  const hasEngine = !!engine()?.stream

  const [matter, setMatter] = useState<Matter | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [quickAgent, setQuickAgent] = useState('associate')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessagesRaw] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const setMessages = useCallback((up: Message[] | ((m: Message[]) => Message[])) => {
    messagesRef.current = typeof up === 'function' ? up(messagesRef.current) : up
    setMessagesRaw(messagesRef.current)
  }, [])
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<Attachment[]>([]) // attached documents, read by the engine on this computer
  const [attaching, setAttaching] = useState<string[]>([]) // names being read right now
  const [convDocs, setConvDocs] = useState<Attachment[]>([]) // documents this conversation is about (sent with every question)
  const [dragging, setDragging] = useState(false)
  const analyseAfterAttach = useRef(false)
  const analyseRef = useRef<(arg: string) => void>(() => {}) // the newest runAnalyse (the command hook keeps its first callback)
  const [running, setRunning] = useState<string | null>(null) // stream id while an answer is written
  const [now, setNow] = useState(Date.now())
  const [perm, setPerm] = useState<any>(null) // a permission question waiting for the lawyer
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [sentToWord, setSentToWord] = useState<string | null>(null)
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const loadGen = useRef(0)

  const agentName = (matter ? matter.agent : quickAgent) || 'associate'
  const agent = agents.find((a) => a.name === agentName) || { name: 'associate', title: t('chat.associate', 'Associate') }

  // ── setup: matter, roles, which AI ──
  const refreshSetup = useCallback(async () => {
    const e = engine()
    const b = mattersBridge()
    try {
      if (b) {
        const r = await b.list()
        setMatter((r.matters || []).find((m: Matter) => m.id === r.active) || null)
      }
    } catch { /* no matters bridge */ }
    if (!e) return
    e.call('GET', '/api/agents').then((r) => setAgents((r.agents || []).filter((a: any) => !a.error))).catch(() => {})
  }, [])

  useEffect(() => {
    refreshSetup()
    const on = () => refreshSetup()
    window.addEventListener('openlex:matter-changed', on)
    window.addEventListener('openlex:setup-changed', on)
    hubBridge()?.onEvent((ev) => { if (['matter-changed', 'policy-changed', 'provider-changed'].includes(ev.type)) refreshSetup() })
    return () => { window.removeEventListener('openlex:matter-changed', on); window.removeEventListener('openlex:setup-changed', on) }
  }, [refreshSetup])

  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill
    if (prefill) setInput(prefill)
  }, [location.state])

  // ── conversations of this matter (any window) ──
  const loadList = useCallback(async (matterId: string | null) => {
    const e = engine()
    if (!e) { setLoadingList(false); return [] as Conversation[] }
    try {
      const r = await e.call('GET', `/api/sessions${matterId ? `?matterId=${encodeURIComponent(matterId)}` : ''}`)
      const list: Conversation[] = r?.sessions || []
      setConversations(list)
      return list
    } catch { setConversations([]); return [] } finally { setLoadingList(false) }
  }, [])

  const openConversation = useCallback(async (id: string | null) => {
    const gen = ++loadGen.current
    setSessionId(id)
    setPerm(null)
    setConvDocs([])
    if (!id) { setMessages([]); return }
    try {
      const r = await engine()!.call('GET', `/api/session?id=${encodeURIComponent(id)}`)
      if (gen !== loadGen.current) return
      setMessages((r?.messages || []).map(storedMessage))
      nearBottom.current = true
    } catch (err) {
      if (gen !== loadGen.current) return
      setMessages([{ id: nextId(), role: 'sys', kind: 'bad', content: friendly(err) }])
    }
  }, [setMessages])

  // A matter opens with its newest conversation, whichever window it was held in.
  const matterId = matter?.id || null
  useEffect(() => {
    if (running) return
    let alive = true
    setLoadingList(true)
    loadList(matterId).then((list) => { if (alive) openConversation(list[0]?.id || null) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId])

  // ── scrolling: stay at the bottom unless the lawyer scrolled up ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => { nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => { const el = scrollRef.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight }, [messages, perm])
  useEffect(() => {
    if (!running) return
    const t0 = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t0)
  }, [running])

  const sys = useCallback((content: string, kind: Message['kind'] = 'ok') => setMessages((m) => [...m, { id: nextId(), role: 'sys', content, kind }]), [setMessages])

  const startNew = useCallback(() => {
    if (running) return
    loadGen.current++
    setSessionId(null)
    setConvDocs([])
    setMessages([])
    setFiles([])
    setInput('')
    inputRef.current?.focus()
  }, [running, setMessages])

  const lastAnswer = () => [...messagesRef.current].reverse().find((m) => m.role === 'assistant' && m.content) || null

  // "/" commands (the engine's one list, same as the terminal app and Word).
  const commands = useChatCommands({
    input,
    setInput,
    focusInput: () => inputRef.current?.focus(),
    lastAnswer: () => lastAnswer()?.content || null,
    lastBasis: () => basedOn([...messagesRef.current].reverse().find((m) => m.role === 'assistant' && m.act)?.act),
    newConversation: startNew,
    analyse: (arg: string) => { analyseRef.current(arg) },
    quickAgent,
    setQuickAgent,
    running: !!running,
  })

  // ── asking ──
  const send = async (raw: string) => {
    const typed = raw.trim()
    if (!typed && !files.length) return
    if (commands.intercept(typed)) return
    const e = engine()
    if (!e?.stream) return sys(t('chat.noEngine', 'The chat needs the OpenLex engine, which runs with the desktop app.'), 'warn')
    if (running) return sys(t('chat.stillWriting', 'The answer is still being written. Wait for it (or press Stop), then ask again. Commands like /model work meanwhile.'), 'warn')
    const message = typed || t('chat.aboutFile', 'Please look at the attached file.')
    // The conversation's documents stay with it: follow-up questions are about them too
    // (and an online AI service reads them from its cache).
    const att = [...convDocs.filter((d) => !files.some((f) => f.id === d.id)), ...files]
    setConvDocs(att)
    const sid = sessionId || `app:${matterId || 'quick'}:${Date.now().toString(36)}`
    if (!sessionId) setSessionId(sid)
    const streamId = `q-${Date.now().toString(36)}-${++seq}`
    const aid = nextId()
    const t0 = Date.now()
    setInput('')
    setFiles([])
    nearBottom.current = true
    setMessages((m) => [...m,
      { id: nextId(), role: 'user', content: message, files: files.map((f) => f.name), client: 'app' },
      { id: aid, role: 'assistant', content: '', act: startActivity(t0), suggestions: [], notes: [], as: agent.name !== 'associate' ? agent.title : '' },
    ])
    setRunning(streamId)
    setNow(t0)
    const patch = (fn: (a: Message) => void) => setMessages((m) => m.map((x) => { if (x.id !== aid) return x; const c = { ...x }; fn(c); return c }))
    // Streamed words are shown in small batches, not one redraw per word.
    let buf = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => { if (timer) clearTimeout(timer); timer = null; if (!buf) return; const add = buf; buf = ''; patch((a) => { a.content += add }) }
    let stopped = false
    let gotText = false
    let failed = false
    const body = {
      message, docId: `app:${matterId || 'quick'}`, sessionId: sid, interactive: true,
      ...(matterId ? { matterId } : { agent: quickAgent }),
      ...(att.length ? { attachments: att.map((f) => f.id), files: att.map((f) => f.name) } : {}),
    }
    try {
      const r = await e.stream('/api/chat', body, (ev) => {
        const at = Date.now()
        if (ev.type === 'text') {
          if (!gotText) patch((a) => { a.act = applyEvent(a.act!, ev, at) })
          gotText = true
          buf += ev.text || ''
          if (!timer) timer = setTimeout(flush, 60)
          return
        }
        flush()
        patch((a) => { a.act = applyEvent(a.act!, ev, at) })
        if (ev.type === 'suggestion') patch((a) => { a.suggestions = [...(a.suggestions || []), ev.suggestion] })
        else if (ev.type === 'warning') patch((a) => { a.notes = [...(a.notes || []), String(ev.message || '')] })
        else if (ev.type === 'strategy') patch((a) => { a.reading = String(ev.text || '') })
        else if (ev.type === 'withheld') patch((a) => { a.notes = [...(a.notes || []), t('chat.withheld', 'Your firm\'s rules held this answer back{{why}}. Do not rely on the text above.', { why: ev.message ? `: ${ev.message}` : '' })] })
        else if (ev.type === 'skill_suggestion' && ev.name) patch((a) => { a.tip = t('chat.skillTip', 'Your firm\'s instructions “{{title}}” may fit — type /{{name}} followed by your question to use them.', { title: ev.title || ev.name, name: ev.name }) })
        else if (ev.type === 'error' && !ev.recoverable) { failed = true; patch((a) => { a.error = friendly(ev.message) }) }
        else if (ev.type === 'permission') setPerm(ev)
        else if (ev.type === 'permission_result' && ev.by !== 'lawyer') {
          setPerm((p: any) => { if (p?.id === ev.id) sys(`${permission.settled(ev)}: ${p.summary}`, 'warn'); return p?.id === ev.id ? null : p })
        }
      }, streamId)
      stopped = !!r?.stopped
    } catch (err) {
      failed = true
      patch((a) => { a.error = friendly(err) })
    }
    flush()
    patch((a) => {
      a.act = endActivity(a.act!, Date.now(), stopped)
      if (stopped) a.stopNote = stopSentence(a.act)
    })
    if (failed && !gotText && typed) {
      setInput((cur) => cur || typed)
      sys(t('chat.backInField', 'Your question is back in the field: press Enter to try again.'), 'info')
    }
    setPerm(null)
    setRunning(null)
    loadList(matterId)
    try { (window as any).lexvault?.notify?.(t('chat.notifyTitle', 'OpenLex answered'), t('chat.notifyBody', 'Your question is answered — click to view.')) } catch { /* optional */ }
  }

  const stop = () => { if (running) engine()?.stop?.(running) }

  const answerPerm = async (req: any, decision: string) => {
    setPerm((p: any) => (p?.id === req.id ? null : p))
    try {
      const r = await engine()!.call('POST', '/api/permissions/answer', { id: req.id, decision })
      sys(permission.answered(req, decision, r?.saved), decision === 'deny' ? 'warn' : 'ok')
    } catch (err) { sys(friendly(err), 'bad') }
  }

  const deleteConversation = async (c: Conversation) => {
    if (!confirm(t('chat.deleteConfirm', 'Delete this conversation in every window (the terminal, Word and this app)? The documents of the matter stay.'))) return
    try {
      await engine()!.call('POST', '/api/session/clear', { sessionId: c.id })
      const list = await loadList(matterId)
      if (c.id === sessionId) openConversation(list[0]?.id || null)
    } catch (err) { sys(friendly(err), 'bad') }
  }

  // Attach: the engine reads the file on this computer (Word, PDF with text
  // recognition for scans, Excel, e-mail, text) and keeps it for this conversation.
  const attach = async (list: FileList | File[] | null) => {
    const picked = Array.from(list || [])
    if (fileRef.current) fileRef.current.value = ''
    if (folderRef.current) folderRef.current.value = ''
    const e = engine()
    if (!e) return sys(t('chat.noEngine', 'The chat needs the OpenLex engine, which runs with the desktop app.'), 'warn')
    const sid = sessionId || `app:${matterId || 'quick'}:${Date.now().toString(36)}`
    if (!sessionId) setSessionId(sid)
    const done: Attachment[] = []
    for (const f of picked) {
      const no = refusal(f)
      if (no) { sys(no, 'warn'); continue }
      setAttaching((cur) => [...cur, f.name])
      try {
        const a = await attachFile(f, { matterId, sessionId: sid })
        done.push(a)
        setFiles((cur) => [...cur.filter((x) => x.name !== a.name), a])
      } catch (err) {
        sys(`${f.name}: ${friendly(err)}`, 'bad')
      } finally {
        setAttaching((cur) => cur.filter((n) => n !== f.name))
      }
    }
    if (analyseAfterAttach.current && done.length) { analyseAfterAttach.current = false; runAnalyse('', done) }
    else analyseAfterAttach.current = false
    inputRef.current?.focus()
  }

  useEffect(() => { analyseRef.current = (arg: string) => { runAnalyse(arg) } })

  // ── the full document analysis (/analyse, or the button on an attached document) ──
  const runAnalyse = async (arg: string, only?: Attachment[]) => {
    const e = engine()
    if (!e?.stream) return sys(t('chat.noEngine', 'The chat needs the OpenLex engine, which runs with the desktop app.'), 'warn')
    if (running) return sys(t('chat.stillWriting', 'The answer is still being written. Wait for it (or press Stop), then ask again. Commands like /model work meanwhile.'), 'warn')
    const att = only || files
    const named = arg.trim()
    if (!att.length && !named) {
      // Nothing attached yet: choose the document, then the analysis starts.
      analyseAfterAttach.current = true
      sys(t('analysis.choose', 'Choose the document to analyse (Word, PDF, Excel, e-mail or text) — or drop it here.'), 'info')
      fileRef.current?.click()
      return
    }
    const sid = sessionId || `app:${matterId || 'quick'}:${Date.now().toString(36)}`
    if (!sessionId) setSessionId(sid)
    const names = att.length ? att.map((f) => f.name) : [named]
    // Several documents: one by one in the background, with an estimate first (BatchCard).
    if (att.length >= 3) {
      setInput('')
      if (!only) setFiles([])
      nearBottom.current = true
      setMessages((m) => [...m,
        { id: nextId(), role: 'user', content: `/analyse ${att.length} documents`, files: names, client: 'app' },
        { id: nextId(), role: 'assistant', content: '', batch: { attachments: att.map((f) => f.id) } },
      ])
      return
    }
    const message = `/analyse ${names.join(', ')}${att.length && named ? ` — ${named}` : ''}`
    const streamId = `a-${Date.now().toString(36)}-${++seq}`
    const aid = nextId()
    const t0 = Date.now()
    setInput('')
    if (!only) setFiles([])
    nearBottom.current = true
    setMessages((m) => [...m,
      { id: nextId(), role: 'user', content: message, files: att.map((f) => f.name), client: 'app' },
      { id: aid, role: 'assistant', content: '', act: startActivity(t0), analyses: [], notes: [] },
    ])
    setRunning(streamId)
    setNow(t0)
    const patch = (fn: (a: Message) => void) => setMessages((m) => m.map((x) => { if (x.id !== aid) return x; const c = { ...x }; fn(c); return c }))
    let stopped = false
    try {
      const r = await e.stream('/api/analyse', {
        message, sessionId: sid, interactive: true,
        ...(matterId ? { matterId } : {}),
        ...(att.length ? { attachments: att.map((f) => f.id), ...(named ? { focus: named } : {}) } : { files: [named] }),
      }, (ev) => {
        const at = Date.now()
        patch((a) => { a.act = applyEvent(a.act!, ev, at) })
        if (ev.type === 'analysis') patch((a) => { a.analyses = [...(a.analyses || []), ev.analysis] })
        else if (ev.type === 'step' && ev.step === 'plan') patch((a) => { a.reading = ev.plain })
        else if (ev.type === 'error' && !ev.recoverable) patch((a) => { a.error = friendly(ev.message) })
        else if (ev.type === 'permission') setPerm(ev)
      }, streamId)
      stopped = !!r?.stopped
    } catch (err) {
      patch((a) => { a.error = friendly(err) })
    }
    patch((a) => {
      a.act = endActivity(a.act!, Date.now(), stopped)
      if (stopped) a.stopNote = stopSentence(a.act)
    })
    setPerm(null)
    setRunning(null)
    loadList(matterId)
    try { (window as any).lexvault?.notify?.('OpenLex', t('chat.analysisReady', 'The document analysis is ready — click to view.')) } catch { /* optional */ }
  }

  const copy = async (m: Message) => {
    let ok = false
    try { await navigator.clipboard.writeText(m.content); ok = true } catch { /* fall back */ }
    if (!ok) { try { ok = !!(await (window as any).lexvault?.copyText?.(m.content)) } catch { /* none */ } }
    if (ok) { setCopied(m.id); setTimeout(() => setCopied(null), 2000) }
  }
  const toWord = async (m: Message) => {
    try { await wordLink.sendToWord(m.content, { source: 'Research' }); setSentToWord(m.id); setTimeout(() => setSentToWord(null), 2000) } catch (err) { sys(friendly(err), 'bad') }
  }

  const current = conversations.find((c) => c.id === sessionId)
  const title = matter ? matter.title : t('chat.quick', 'Quick question')
  const otherWindows = useMemo(() => (current?.clients || []).filter((c) => c !== 'app').map((c) => WINDOW_WORDS[c] || c), [current])

  return (
    <div className="h-[calc(100vh-0px)] flex overflow-hidden">
      {/* Conversations of this matter, from every window */}
      <aside className={`${sidebarCollapsed ? 'w-0' : 'w-72'} border-r border-tobacco flex flex-col transition-all duration-200 overflow-hidden bg-deep-brown`}>
        <div className="h-[72px] px-4 border-b border-tobacco flex items-center">
          <button onClick={startNew} disabled={!!running} className="w-full btn-primary flex items-center justify-center gap-2 !py-2">
            <Plus size={18} />
            {t('chat.new', 'New conversation')}
          </button>
        </div>
        <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-antique/70">
          {matter ? t('chat.inMatter', 'In this matter (every window)') : t('chat.withoutMatter', 'Without a matter')}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="p-4 text-center text-antique text-sm">{t('common.loading', 'Loading…')}</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-antique text-sm">{t('chat.noConversations', 'No conversations yet.')}</div>
          ) : (
            <div className="py-1">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => !running && openConversation(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !running) openConversation(c.id) }}
                  className={`group px-4 py-3 cursor-pointer transition-colors ${c.id === sessionId ? 'bg-accent/10 border-l-2 border-accent' : 'hover:bg-leather border-l-2 border-transparent'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-antique flex-shrink-0" />
                        <span className="text-cream text-sm font-medium truncate">{c.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-antique">
                        <Clock size={10} />
                        <span>{when(c.updatedAt)}</span>
                        <span className="text-tobacco">·</span>
                        <span className="truncate">{c.clients.length ? c.clients.map((x) => WINDOW_WORDS[x] || x).join(', ') : t('chat.earlier', 'earlier')}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c) }}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-antique hover:text-red-400 transition-all"
                      aria-label={t('chat.delete', 'Delete conversation')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div
        className={`flex-1 flex flex-col min-w-0 min-h-0 relative ${dragging ? 'ring-2 ring-accent/60 ring-inset' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={(e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); setDragging(false); attach(e.dataTransfer.files) }}
      >
        {dragging && <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/60 text-parchment text-lg pointer-events-none">{t('chat.dropHere', 'Drop the document: OpenLex reads it on this computer')}</div>}
        {/* Header: the matter, who OpenLex works as, where the AI runs */}
        <div className="h-[72px] border-b border-tobacco px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-antique hover:text-cream transition-colors flex-shrink-0" aria-label={t('chat.conversations', 'Conversations')}>
              <MessageSquare size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="font-serif text-lg text-parchment truncate flex items-center gap-2">
                {title}
                {matter?.privileged && <span className="inline-flex items-center gap-1 text-xs text-forest border border-forest/40 rounded px-1.5 py-0.5"><Lock size={11} /> {t('chat.privileged', 'privileged — stays on this computer')}</span>}
              </h1>
              <p className="text-antique text-xs truncate">
                {current ? `${clip(current.title, 60)}${otherWindows.length ? ` · ${t('chat.alsoIn', 'also asked in {{where}}', { where: otherWindows.join(' and ') })}` : ''}` : t('chat.newConversation', 'New conversation')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 text-xs">
            <button type="button" onClick={() => commands.run('as')} className="btn-secondary !px-3 !py-1.5 text-xs inline-flex items-center gap-1" title={t('chat.asHint', 'Who OpenLex works as (/as)')}>
              {t('chat.workingAs', 'Working as: {{who}}', { who: agent.title })} <ChevronDown size={12} />
            </button>
          </div>
        </div>

        {/* The conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0" aria-live="polite">
          {!hasEngine && (
            <div className="max-w-xl mx-auto px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-card text-sm text-amber-300">
              {t('chat.noEngine', 'The chat needs the OpenLex engine, which runs with the desktop app.')}
            </div>
          )}
          {messages.length === 0 && hasEngine && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Sparkles size={32} className="text-accent" />
              </div>
              <div className="font-serif text-2xl text-parchment mb-3">
                {matter ? t('chat.emptyMatter', 'Ask anything about this matter') : t('chat.emptyQuick', 'Ask a legal question')}
              </div>
              <p className="text-antique text-sm max-w-lg mx-auto mb-6">
                {matter
                  ? t('chat.emptyMatterHelp', 'Its documents, the law, a draft. This conversation is the same in the terminal app and in Word.')
                  : t('chat.emptyQuickHelp', 'Nothing here is tied to a matter. Choose a matter in the sidebar (or /matter) to keep the conversation with it.')}
              </p>
              <ul className="space-y-1 text-sm text-parchment">
                {[matter ? t('chat.example1', 'Summarise the documents of this matter') : t('chat.example1q', 'Which deadlines apply to a commercial lease?'), t('chat.example2', 'Is a two-year non-compete enforceable under Austrian law?')].map((ex) => (
                  <li key={ex}><button type="button" className="hover:text-accent" onClick={() => { setInput(ex); inputRef.current?.focus() }}>› {ex}</button></li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === 'sys') {
              return (
                <div key={m.id} role="status" className={`max-w-3xl text-sm flex gap-2 ${m.kind === 'bad' ? 'text-red-400' : m.kind === 'warn' ? 'text-amber-400' : m.kind === 'info' ? 'text-antique' : 'text-forest'}`}>
                  <span aria-hidden="true">{m.kind === 'bad' ? '✗' : m.kind === 'warn' ? '!' : m.kind === 'info' ? '·' : '✓'}</span>
                  <span className="text-parchment/90">{m.content}</span>
                </div>
              )
            }
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-3xl bg-accent/20 rounded-card rounded-br-sm px-5 py-3">
                    <p className="text-parchment whitespace-pre-wrap">{m.content}</p>
                    {!!m.files?.length && <p className="mt-1 text-xs text-antique">📎 {m.files.join(', ')}</p>}
                    {m.stored && m.client && m.client !== 'app' && <p className="mt-1 text-[11px] text-antique">{t('chat.askedIn', 'asked in {{where}}', { where: WINDOW_WORDS[m.client] || m.client })}{m.at ? ` · ${when(m.at)}` : ''}</p>}
                  </div>
                </div>
              )
            }
            return <Answer key={m.id} m={m} now={now} live={!!running && m === messages[messages.length - 1]} openSteps={!!openSteps[m.id]} toggleSteps={() => setOpenSteps((s) => ({ ...s, [m.id]: !s[m.id] }))}
              onCopy={() => copy(m)} copied={copied === m.id} onWord={wordLink.connected && m.content ? () => toWord(m) : null} sentToWord={sentToWord === m.id} onStop={stop} matterId={matterId} />
          })}
        </div>

        {/* The question field */}
        <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="border-t border-tobacco p-4 bg-deep-brown">
          {(!!files.length || !!attaching.length) && (
            <div className="mb-2 space-y-1" data-testid="attachments">
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <span key={f.id} className="flex items-center gap-2 px-3 py-1 bg-tobacco/30 border border-tobacco rounded-button text-xs text-parchment" title={f.strategy?.text || ''}>
                    <Paperclip size={12} className="text-antique" /> {f.name}
                    {chipDetail(f) && <span className="text-antique">· {chipDetail(f)}</span>}
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} className="text-antique hover:text-cream" aria-label={t('research.removeFile', 'Remove file')}><X size={12} /></button>
                  </span>
                ))}
                {attaching.map((n) => (
                  <span key={n} className="flex items-center gap-2 px-3 py-1 border border-dashed border-tobacco rounded-button text-xs text-antique" role="status">
                    <Paperclip size={12} /> {t('chat.reading', 'Reading {{name}} on this computer…', { name: n })}
                  </span>
                ))}
                {!!files.length && !running && (
                  <button type="button" onClick={() => runAnalyse('')} className="flex items-center gap-1.5 px-3 py-1 border border-accent/60 text-accent hover:bg-accent/10 rounded-button text-xs" data-testid="analyse-button">
                    <FileSearch size={12} /> {t('chat.analyse', 'Full analysis (/analyse)')}
                  </button>
                )}
              </div>
              {files.map((f) => f.strategy?.text ? <div key={f.id} className="text-[11px] text-antique">{f.strategy.text}</div> : null)}
              {!!files.length && <div className="text-[11px] text-antique">{files[0].where?.text || t('chat.attachSentence', 'Sent with your question, under your client-data rule.')} {t('chat.attachAsk', 'Ask about it, or run the full analysis.')}</div>}
            </div>
          )}
          {!!convDocs.length && !files.length && (
            <div className="mb-2 text-[11px] text-antique flex flex-wrap items-center gap-1" data-testid="conv-docs">
              {t('chat.convDocs', 'Questions are about')}: {convDocs.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-tobacco/60">{d.name}
                  <button type="button" onClick={() => setConvDocs((cur) => cur.filter((x) => x.id !== d.id))} aria-label={t('research.removeFile', 'Remove file')} className="hover:text-cream"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
          {commands.menu}
          {/* Which AI answers (and this month's spending): one click opens /model. */}
          <ModelLabel onOpen={() => commands.run('model')} />
          <div className="flex gap-3 items-end">
            <input ref={fileRef} type="file" multiple accept=".docx,.pdf,.xlsx,.eml,.txt,.md,.csv,.json,.xml,.html,.rtf" className="hidden" onChange={(e) => attach(e.target.files)} data-testid="attach-input" />
            <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => attach(e.target.files ? Array.from(e.target.files).filter((f) => !refusal(f)) : null)} {...({ webkitdirectory: '', directory: '' } as any)} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!running} className="text-antique hover:text-cream transition-colors px-1 pb-2" title={t('research.attachFile', 'Attach documents (Word, PDF, Excel, e-mail, text) — or drop them here')}>
              <Paperclip size={18} />
            </button>
            <button type="button" onClick={() => folderRef.current?.click()} disabled={!!running} className="text-antique hover:text-cream transition-colors px-1 pb-2" title={t('research.attachFolder', 'Attach a folder (every document in it)')}>
              <FolderOpen size={18} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                commands.onKeyDown(e)
                if (e.defaultPrevented) return
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
                if (e.key === 'Escape' && running) { e.preventDefault(); stop() }
              }}
              placeholder={running ? t('chat.placeholderRunning', 'Commands work while the answer is written: /model, /data …') : t('chat.placeholder', 'Type your question (or / for commands) and press Enter')}
              className="input flex-1 resize-none min-h-[42px] max-h-40"
            />
            {running ? (
              <button type="button" onClick={stop} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-button transition-colors inline-flex items-center gap-2" title={t('chat.stopHint', 'Stop (Esc): the answer so far is kept')}>
                <Square size={14} fill="currentColor" /> {t('research.stop', 'Stop')}
              </button>
            ) : (
              <button type="submit" disabled={(!input.trim() && !files.length) || !!attaching.length} className="btn-primary px-5" aria-label={t('chat.send', 'Send')}>
                <Send size={18} />
              </button>
            )}
          </div>
          {commands.hint}
        </form>
        {commands.overlay}
        {perm && <PermissionDialog req={perm} onAnswer={(d) => answerPerm(perm, d)} />}
      </div>
    </div>
  )
}

// ── one answer ─────────────────────────────────────────────────────────────

function Answer({ m, now, live, openSteps, toggleSteps, onCopy, copied, onWord, sentToWord, onStop, matterId = null }: {
  m: Message; now: number; live: boolean; matterId?: string | null; openSteps: boolean; toggleSteps: () => void
  onCopy: () => void; copied: boolean; onWord: (() => void) | null; sentToWord: boolean; onStop: () => void
}) {
  const { t } = useTranslation()
  const act = m.act
  const running = !!act && !act.endedAt
  const data = act ? dataLine(act.models, act.online, running) : null
  const basis = basedOn(act)
  const steps = act?.steps || []
  const shown = running ? steps.slice(-3) : steps
  const earlier = running ? Math.max(steps.length - 3, 0) : 0
  return (
    <div className="flex justify-start">
      <div className="max-w-3xl w-full bg-leather border border-tobacco rounded-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-tobacco/50 bg-deep-brown/50">
          <div className="flex items-center gap-2 text-antique text-sm">
            <BookOpen size={14} />
            OpenLex{m.as ? <span className="text-xs">· {t('chat.as', 'as {{who}}', { who: m.as })}</span> : null}
            {m.stored && m.client && m.client !== 'app' && <span className="text-xs">· {t('chat.answeredIn', 'answered in {{where}}', { where: WINDOW_WORDS[m.client] || m.client })}</span>}
          </div>
          {!running && m.content && (
            <div className="flex items-center gap-2">
              {onWord && (
                <button onClick={onWord} className="text-antique hover:text-accent transition-colors" title={t('research.sendToWord', 'Send to Word (insert at cursor)')}>
                  {sentToWord ? <Check size={14} className="text-forest" /> : <FileText size={14} />}
                </button>
              )}
              <button onClick={onCopy} className="text-antique hover:text-accent transition-colors" title={t('research.copyResponse', 'Copy response')}>
                {copied ? <Check size={14} className="text-forest" /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
        <div className="px-5 py-4 space-y-3">
          {m.reading && <div className="text-xs text-antique">· {m.reading}</div>}
          {m.batch && <BatchCard attachments={m.batch.attachments} matterId={matterId} />}
          {(m.analyses || []).map((a) => <AnalysisCard key={a.id} analysis={a} />)}
          {(m.analysisIds || []).map((id) => <AnalysisCard key={id} id={id} />)}
          {m.content && !(m.analysisIds?.length) ? <div className="prose-custom max-w-none"><ReactMarkdown>{m.content}</ReactMarkdown></div> : null}

          {/* What OpenLex is doing right now (≤3 recent steps, the current one marked) */}
          {running && act && (
            <div className="rounded-button border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm" aria-live="polite">
              <div className="text-parchment font-medium">{t('chat.working', 'OpenLex is working on it')} <span className="text-antique font-normal">· {duration(now - act.startedAt)} {t('chat.soFar', 'so far')}</span></div>
              {earlier > 0 && <div className="text-xs text-antique mt-1">… {earlier} {t('chat.earlierSteps', 'earlier steps')}</div>}
              <ul className="mt-1 space-y-0.5">
                {shown.map((s, i) => (
                  <li key={i} className={`flex gap-2 ${s.status === 'now' ? 'text-cream font-medium' : s.status === 'failed' ? 'text-amber-400' : 'text-parchment/80'}`}>
                    <span aria-hidden="true" className={s.status === 'done' ? 'text-forest' : s.status === 'failed' ? 'text-amber-400' : 'text-accent'}>{mark(s.status)}</span>
                    <span className="flex-1">{s.text}</span>
                    <span className="text-xs text-antique tabular-nums">{duration((s.end || now) - s.at)}</span>
                  </li>
                ))}
              </ul>
              {!act.waiting && !steps.some((s) => s.phase === 'writing') && <div className="text-xs text-antique mt-1">· {t('chat.next', 'Next: writing the answer')}</div>}
            </div>
          )}

          {/* Where the data went: always visible, symbol + words */}
          {data && (
            <div className={`text-xs flex gap-2 ${data.left ? 'text-amber-400 font-medium' : 'text-forest'}`} title={data.title}>
              <span aria-hidden="true">{data.symbol}</span>
              <span>{data.text}</span>
            </div>
          )}
          {running && live && (
            <div className="text-xs text-antique">
              <button type="button" onClick={onStop} className="underline hover:text-cream">{t('research.stop', 'Stop')}</button> {t('chat.stopKeeps', '(or Esc): the answer so far is kept')}
            </div>
          )}

          {!running && act && !m.stored && (
            <div className="text-xs text-antique">
              <button type="button" onClick={toggleSteps} className="inline-flex items-center gap-1 hover:text-cream" aria-expanded={openSteps}>
                {summaryLine(act)} {openSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {openSteps && (
                <ol className="mt-1 ml-1 space-y-0.5">
                  {steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-parchment/80">
                      <span className="tabular-nums w-5 text-right">{i + 1}</span>
                      <span aria-hidden="true">{mark(s.status)}</span>
                      <span className="flex-1">{s.text}</span>
                      <span className="tabular-nums">{s.end ? duration(s.end - s.at) : ''}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {!running && basis.length > 0 && <BasedOn items={basis} />}

          {(m.suggestions || []).map((s, i) => {
            const check = checkLine(s)
            return (
              <div key={i} className="border-l-2 border-accent pl-3 text-sm space-y-1">
                <div><span className={`font-semibold uppercase text-xs ${s.severity === 'high' ? 'text-red-400' : 'text-accent'}`}>{String(t(`chat.severity.${s.severity || 'note'}`, { defaultValue: s.severity || 'note' }))}</span> <span className="text-parchment">{s.summary}</span></div>
                {s.proposed_text && <div className="text-cream-dark text-xs">{t('chat.proposed', 'Proposed:')} {clip(s.proposed_text, 400)}</div>}
                {s.basis && <div className="text-antique text-xs">{t('chat.legalBasis', 'Legal basis:')} {basisText(s.basis)}</div>}
                <div className={`text-xs ${check.ok ? 'text-forest' : 'text-amber-400'}`}>{check.mark} {check.text}</div>
              </div>
            )
          })}

          {(m.notes || []).map((n, i) => <div key={i} className="text-xs text-amber-400">! {n}</div>)}
          {m.error && <div className="text-sm text-red-400">✗ {m.error}</div>}
          {m.stopNote ? <div className="text-xs text-antique">{m.stopNote}</div> : m.stored && act?.stopped ? <div className="text-xs text-antique">{t('chat.wasStopped', '(stopped)')}</div> : null}
          {m.tip && <div className="text-xs text-antique">{m.tip}</div>}
        </div>
      </div>
    </div>
  )
}

/** "Based on": numbered; a law section opens in full on click (GET /api/law/section). */
function BasedOn({ items }: { items: Basis[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<number | null>(null)
  const [full, setFull] = useState<Record<number, string>>({})
  const toggle = async (it: Basis) => {
    if (open === it.n) return setOpen(null)
    setOpen(it.n)
    if (it.kind !== 'law' || !it.chunk_id || full[it.n]) return
    setFull((f) => ({ ...f, [it.n]: t('common.loading', 'Loading…') }))
    try {
      const r = await engine()!.call('GET', `/api/law/section?chunk_id=${encodeURIComponent(it.chunk_id)}`)
      setFull((f) => ({ ...f, [it.n]: r?.content || it.detail }))
    } catch (err) { setFull((f) => ({ ...f, [it.n]: `${it.detail ? `${it.detail}\n\n` : ''}(${t('chat.notOpened', 'The full text could not be opened')}: ${friendly(err)})` })) }
  }
  return (
    <div className="border-t border-tobacco/50 pt-3">
      <div className="text-xs font-medium text-parchment mb-1">{t('chat.basedOn', 'Based on')}</div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.n}>
            <button type="button" onClick={() => toggle(it)} aria-expanded={open === it.n} className="w-full text-left text-xs flex gap-2 hover:text-cream text-parchment/90">
              <span className="text-accent tabular-nums">[{it.n}]</span>
              <span className="flex-1">{it.label}{it.detail && open !== it.n ? <span className="text-antique"> — {clip(it.detail, 90)}</span> : null}</span>
            </button>
            {open === it.n && <div className="ml-7 mt-1 mb-2 text-xs text-cream-dark whitespace-pre-wrap">{full[it.n] || it.detail || t('chat.docPassage', 'OpenLex read this part of your document for the answer.')}</div>}
          </li>
        ))}
      </ul>
      <div className="text-[11px] text-antique/70 mt-1">{t('chat.checkSources', 'Law sections come from the law collection on this computer. Check them before relying on the answer.')}</div>
    </div>
  )
}

/** "May OpenLex …?" — the broker's question; Allow once is the default, Esc = Don't allow. */
function PermissionDialog({ req, onAnswer }: { req: any; onAnswer: (decision: string) => void }) {
  const { t } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  const [sent, setSent] = useState(false)
  const answer = useCallback((d: string) => { if (sent) return; setSent(true); onAnswer(d) }, [onAnswer, sent])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer('deny') } }
    document.addEventListener('keydown', onKey, true)
    boxRef.current?.querySelector<HTMLElement>('button[data-default]')?.focus()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [answer])
  const buttons = permission.buttons(req)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[18vh]">
      <div className="fixed inset-0 bg-ink/70" />
      <div ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby="perm-q" aria-describedby="perm-risk" className="relative w-full max-w-lg rounded-card border border-accent/60 bg-deep-brown shadow-2xl animate-fade-in p-5 space-y-3">
        <div className="text-xs uppercase tracking-wide text-accent">{req.title || t('chat.permTitle', 'OpenLex wants to use a tool')}</div>
        <p id="perm-q" className="text-parchment text-base">{permission.question(req)}</p>
        {permission.details(req).map((d) => (
          <div key={d.label} className="text-xs text-antique"><span className="text-parchment/80">{d.label}:</span> <span className="font-mono break-all">{d.value}</span></div>
        ))}
        <p id="perm-risk" className="text-xs text-antique">{permission.riskLine(req)}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {buttons.map((b) => (
            <button key={b.choice} type="button" disabled={sent} data-default={b.primary ? '' : undefined} onClick={() => answer(b.choice)}
              className={b.primary ? 'btn-primary !py-1.5 text-sm' : b.choice === 'deny' ? 'btn-secondary !py-1.5 text-sm' : 'btn-secondary !py-1.5 text-sm opacity-90'}>
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-antique/70">{t('chat.permKeys', 'Enter: allow once · Esc: don\'t allow · nothing happens until you choose')}</p>
      </div>
    </div>
  )
}
