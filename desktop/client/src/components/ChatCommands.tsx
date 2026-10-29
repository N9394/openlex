// "/" commands in the App's chat — the same commands as the terminal app
// and the Word pane (the engine's one list: GET /api/commands). Typing "/"
// opens one small menu above the question field (↑ ↓ choose, Enter run,
// Tab fill in, Esc close; Ctrl+K / ⌘K opens it too). Commands run through
// the engine; the few that need a choice open a small dialog (which AI,
// which matter, the AI record). A quiet hint line under the field says how
// to find them.
//
//   const cmd = useChatCommands({ input, setInput, focusInput, lastAnswer, newConversation })
//   <input onKeyDown={cmd.onKeyDown} …/>  ·  handleSubmit: if (cmd.intercept(input)) return
//   {cmd.menu} above the field, {cmd.hint} below it, {cmd.overlay} anywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Cpu, Download, Folder, X } from 'lucide-react'
import { useWordLink } from '../lib/hub'
import { ChatCommand, PROVIDER_WORDS, didYouMean, engine, filterCommands, loadCommands, matterFolderName, menuQuery, parseCommand } from '../lib/commands'

interface Matter { id: string; title: string; number?: string; client?: string; privileged?: boolean }
interface Provider { id: string; label: string; local: boolean; needsKey: boolean; hasKey: boolean | null; model: string | null }
interface RecordEntry { at: string; title: string; window?: string; left?: boolean; outcome?: string; lines?: string[] }
type Dialog =
  | { kind: 'help' }
  | { kind: 'model' }
  | { kind: 'matter' }
  | { kind: 'record'; all: boolean }
  | { kind: 'activity' }
  | { kind: 'save'; summary: string; body: Record<string, unknown> }

const mattersBridge = () => (typeof window !== 'undefined' && (window as any).lexvault?.matters) || null
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')

/** The App's active matter (shared with Word through the engine), or null. */
async function activeMatter(): Promise<Matter | null> {
  const b = mattersBridge()
  if (!b) return null
  const r = await b.list()
  return (r.matters || []).find((m: Matter) => m.id === r.active) || null
}

export function useChatCommands(opts: {
  input: string
  setInput: (v: string) => void
  focusInput: () => void
  lastAnswer: () => string | null
  newConversation: () => void
}) {
  const { input, setInput, focusInput, lastAnswer, newConversation } = opts
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const word = useWordLink()
  const lang = /^de/i.test(i18n.language || '') ? 'de' : 'en'
  const [commands, setCommands] = useState<ChatCommand[]>([])
  const [pick, setPick] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'warn' | 'bad' } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    loadCommands(lang).then(setCommands).catch(() => setCommands([]))
  }, [lang])

  const say = useCallback((text: string, kind: 'ok' | 'warn' | 'bad' = 'ok') => {
    setNotice({ text, kind })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'ok' ? 6000 : 10000)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const query = commands.length && input !== dismissed ? menuQuery(input) : null
  const shown = useMemo(() => (query === null ? [] : filterCommands(commands, query)), [commands, query])
  const menuOpen = query !== null && shown.length > 0
  useEffect(() => { setPick(0) }, [query])

  // ── running a command ──
  const save = useCallback(async (arg: string, decision?: string, body?: Record<string, unknown>) => {
    const e = engine()
    const text = lastAnswer()
    if (!e) return
    if (!text) return say(t('commands.noAnswer', 'There is no answer yet.'), 'warn')
    try {
      let req = body
      if (!req) {
        const m = await activeMatter()
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2')
        const name = (arg || `answer-${stamp}`).replace(/[\\/:*?"<>|]/g, '_').replace(/(\.md)?$/i, '.md')
        req = { path: `${matterFolderName(m)}/${name}`, content: text, ...(m ? { matterId: m.id } : {}) }
      }
      const r = await e.call('POST', '/api/folder/save', { ...req, ...(decision ? { decision } : {}) })
      if (r?.ask) return setDialog({ kind: 'save', summary: r.ask.summary || r.ask.title, body: req })
      if (r?.error) return say(r.error, 'bad')
      say(t('commands.saved', 'Saved the answer as {{file}}.', { file: r.short || r.saved }))
    } catch (err) { say((err as Error).message, 'bad') }
  }, [lastAnswer, say, t])

  const run = useCallback(async (name: string, arg = '') => {
    setDismissed(null)
    setInput('')
    const e = engine()
    if (!e) return say(t('commands.noEngine', 'Commands need the OpenLex engine, which runs with the desktop app.'), 'warn')
    switch (name) {
      case 'help': return setDialog({ kind: 'help' })
      case 'model': {
        if (!arg) return setDialog({ kind: 'model' })
        const id = PROVIDER_WORDS[arg.toLowerCase()] || arg.toLowerCase()
        try {
          const pv = await e.call('GET', '/api/providers')
          const p = (pv.providers || []).find((x: Provider) => x.id === id)
          if (!p) return say(t('commands.noService', 'There is no AI service called "{{name}}". Type /model to choose one.', { name: arg }), 'bad')
          await e.call('POST', '/api/providers', { active: id })
          return say(t('commands.nowUsing', 'Now using {{name}}. This applies from your next question.', { name: p.local ? t('commands.thisComputer', 'the AI on this computer') : p.label }))
        } catch (err) { return say((err as Error).message, 'bad') }
      }
      case 'data': return navigate('/hub')
      case 'matter': {
        if (!arg) return setDialog({ kind: 'matter' })
        const b = mattersBridge()
        if (!b) return
        const list: Matter[] = (await b.list()).matters || []
        const w = arg.toLowerCase()
        const m = list.find((x) => x.title.toLowerCase() === w || x.number?.toLowerCase() === w) || list.find((x) => `${x.number || ''} ${x.title} ${x.client || ''}`.toLowerCase().includes(w))
        if (!m) return say(t('commands.noMatter', 'No matter called "{{name}}". Type /matter to choose one.', { name: arg }), 'bad')
        await b.setActive(m.id)
        window.dispatchEvent(new CustomEvent('openlex:matter-changed'))
        return say(t('commands.nowMatter', 'Now working on {{title}}.', { title: m.title }))
      }
      case 'copy': {
        const text = lastAnswer()
        if (!text) return say(t('commands.noAnswer', 'There is no answer yet.'), 'warn')
        try { await navigator.clipboard.writeText(text); return say(t('commands.copied', 'Copied the last answer.')) } catch { return say(t('commands.copyFailed', 'Copying did not work. Select the answer and copy it by hand, or use /save.'), 'bad') }
      }
      case 'save': return save(arg)
      case 'word': {
        const text = lastAnswer()
        if (!text) return say(t('commands.noAnswer', 'There is no answer yet.'), 'warn')
        if (!word.connected) return say(t('commands.noWord', 'Word is not open with the OpenLex pane. Open it, then try again.'), 'warn')
        try { await word.sendToWord(text, { source: 'Research' }); return say(t('commands.sentToWord', 'Sent the last answer to Word.')) } catch (err) { return say((err as Error).message, 'bad') }
      }
      case 'activity': return setDialog({ kind: 'activity' })
      case 'record': return setDialog({ kind: 'record', all: /^all\b/i.test(arg) })
      case 'clear': newConversation(); return say(t('commands.cleared', 'New conversation. The documents are still there.'))
      default: return say(t('commands.unknown', 'There is no command /{{name}}. Type /help to see the commands.', { name }), 'warn')
    }
  }, [lastAnswer, navigate, newConversation, save, say, setInput, t, word])

  /** In handleSubmit: true when the text was a command (then it is not sent as a question). */
  const intercept = useCallback((text: string) => {
    const c = parseCommand(text)
    if (!c || !commands.length) return false
    if (commands.some((x) => x.name === c.name)) { run(c.name, c.arg); return true }
    const guess = didYouMean(c.name, commands.map((x) => x.name))
    if (guess) setInput(`/${guess}${c.arg ? ` ${c.arg}` : ''}`)
    say(guess
      ? t('commands.didYouMean', 'There is no command /{{name}}. Did you mean /{{guess}}? Press Enter to use it.', { name: c.name, guess })
      : t('commands.unknown', 'There is no command /{{name}}. Type /help to see the commands.', { name: c.name }), 'warn')
    return true
  }, [commands, run, say, setInput, t])

  const openMenu = useCallback(() => {
    if (!commands.length) return
    if (!input || menuQuery(input) !== null) { setDismissed(null); setInput('/') } else setDialog({ kind: 'help' })
    focusInput()
  }, [commands.length, focusInput, input, setInput])

  // Ctrl+K / ⌘K on the chat page opens this menu (elsewhere: the App's search palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k' || !commands.length) return
      e.preventDefault()
      e.stopPropagation()
      if (menuOpen) { setDismissed(input); return }
      openMenu()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [commands.length, input, menuOpen, openMenu])

  /** On the question field: arrows, Enter, Tab and Esc while the menu is open. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!menuOpen) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(shown[pick].name)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      setInput(`/${shown[pick].name} `)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(input)
    }
  }, [input, menuOpen, pick, run, setInput, shown])

  const menu = menuOpen ? (
    <div role="listbox" aria-label={t('commands.title', 'Commands')} className="mb-2 max-h-72 overflow-y-auto rounded-card border border-tobacco bg-obsidian/95 py-1 shadow-xl">
      {shown.map((c, i) => (
        <button
          key={c.name}
          type="button"
          role="option"
          aria-selected={i === pick}
          onMouseDown={(e) => { e.preventDefault(); run(c.name) }}
          onMouseMove={() => setPick(i)}
          className={`w-full flex items-baseline gap-3 px-3 py-1.5 text-left text-sm ${i === pick ? 'bg-accent/10' : ''}`}
        >
          <span className="font-mono text-accent w-24 shrink-0">/{c.name}</span>
          <span className="text-parchment truncate">{c.help}</span>
        </button>
      ))}
      <div className="px-3 pt-1 text-[11px] text-antique/70">{t('commands.menuKeys', '↑ ↓ choose · Enter run · Tab add details · Esc close')}</div>
    </div>
  ) : null

  const hint = commands.length && !input ? (
    <div className="mt-1.5 text-[11px] text-antique/60" aria-hidden="true">
      {t('commands.hint', 'Type / for commands · {{key}} · /help', { key: isMac ? '⌘K' : 'Ctrl+K' })}
    </div>
  ) : null

  const noticeLine = notice ? (
    <div role="status" className={`mb-2 text-xs ${notice.kind === 'bad' ? 'text-red-400' : notice.kind === 'warn' ? 'text-amber-400' : 'text-forest'}`}>{notice.text}</div>
  ) : null

  const close = () => { setDialog(null); focusInput() }
  const overlay = dialog ? (
    <CommandDialog
      dialog={dialog}
      commands={commands}
      onClose={close}
      onRun={(n) => { setDialog(null); run(n); focusInput() }}
      onSaveOnce={(body) => { setDialog(null); save('', 'once', body) }}
      say={say}
    />
  ) : null

  return { onKeyDown, intercept, menu: <>{noticeLine}{menu}</>, hint, overlay, openMenu }
}

// ── the small dialogs ──────────────────────────────────────────────────────

function CommandDialog({ dialog, commands, onClose, onRun, onSaveOnce, say }: {
  dialog: Dialog
  commands: ChatCommand[]
  onClose: () => void
  onRun: (name: string) => void
  onSaveOnce: (body: Record<string, unknown>) => void
  say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void
}) {
  const { t } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    boxRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const titles: Record<Dialog['kind'], string> = {
    help: t('commands.helpTitle', 'Commands'),
    model: t('commands.modelTitle', 'Where the AI runs'),
    matter: t('commands.matterTitle', 'Choose a matter'),
    record: t('commands.recordTitle', 'AI record'),
    activity: t('commands.activityTitle', 'Recent activity'),
    save: t('commands.saveTitle', 'Save the answer?'),
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-ink/70" onClick={onClose} />
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={titles[dialog.kind]} className="relative w-full max-w-lg rounded-card border border-tobacco bg-deep-brown shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-tobacco">
          <h2 className="font-serif text-lg text-parchment">{titles[dialog.kind]}</h2>
          <button type="button" onClick={onClose} className="text-antique hover:text-cream" aria-label={t('common.close', 'Close')}><X size={18} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4 text-sm">
          {dialog.kind === 'help' && <HelpList commands={commands} onRun={onRun} />}
          {dialog.kind === 'model' && <ModelChoice onDone={(text) => { say(text); onClose() }} />}
          {dialog.kind === 'matter' && <MatterChoice onDone={(text) => { say(text); onClose() }} />}
          {(dialog.kind === 'record' || dialog.kind === 'activity') && <RecordList all={dialog.kind === 'record' && dialog.all} recent={dialog.kind === 'activity'} say={say} />}
          {dialog.kind === 'save' && (
            <div className="space-y-4">
              <p className="text-parchment">{t('commands.saveAsk', 'OpenLex wants to save a file:')} <span className="font-mono text-cream">{dialog.summary}</span></p>
              <div className="flex gap-3">
                <button type="button" className="btn-primary flex-1" onClick={() => onSaveOnce(dialog.body)}>{t('commands.saveOnce', 'Save')}</button>
                <button type="button" className="btn-secondary flex-1" onClick={onClose}>{t('commands.dontSave', 'Don\'t save')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** /help: every command, in plain words; click one to run it. */
function HelpList({ commands, onRun }: { commands: ChatCommand[]; onRun: (name: string) => void }) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="mb-3 text-antique">{t('commands.helpIntro', 'Type them in the question field, or click one.')}</p>
      <ul className="space-y-0.5">
        {commands.map((c) => (
          <li key={c.name}>
            <button type="button" onClick={() => onRun(c.name)} className="w-full flex items-baseline gap-3 rounded px-2 py-1.5 text-left hover:bg-leather/40 focus:bg-leather/40 outline-none">
              <span className="font-mono text-accent w-24 shrink-0">/{c.name}</span>
              <span className="text-parchment">{c.help}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** /model: choose where the AI runs (engine providers). */
function ModelChoice({ onDone }: { onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [list, setList] = useState<Provider[] | null>(null)
  const [active, setActive] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    engine()?.call('GET', '/api/providers').then((r) => { setList(r.providers || []); setActive(r.active) }).catch((err) => setError(String(err.message || err)))
  }, [])
  const choose = async (p: Provider) => {
    try {
      await engine()!.call('POST', '/api/providers', { active: p.id })
      onDone(t('commands.nowUsing', 'Now using {{name}}. This applies from your next question.', { name: p.local ? t('commands.thisComputer', 'the AI on this computer') : p.label }))
    } catch (err) { setError((err as Error).message) }
  }
  if (error) return <p className="text-red-400">{error}</p>
  if (!list) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  return (
    <div className="space-y-1">
      {list.map((p) => {
        const noKey = p.needsKey && !p.hasKey
        return (
          <button key={p.id} type="button" disabled={noKey} onClick={() => choose(p)} className="w-full flex items-center gap-3 rounded px-2 py-2 text-left hover:bg-leather/40 focus:bg-leather/40 outline-none disabled:opacity-50">
            <Cpu size={15} className="text-antique shrink-0" />
            <span className="flex-1">
              <span className="text-cream">{p.local ? t('commands.thisComputerTitle', 'On this computer') : p.label}</span>
              <span className="block text-xs text-antique">{p.local ? t('commands.staysHere', 'Nothing leaves this computer') : noKey ? t('commands.needsKey', 'Needs a key first (OpenLex hub page)') : t('commands.online', 'Online AI service')}{p.model ? ` · ${p.model}` : ''}</span>
            </span>
            {p.id === active && <Check size={16} className="text-forest" />}
          </button>
        )
      })}
      <button type="button" onClick={() => navigate('/hub')} className="mt-2 text-xs text-antique underline">{t('commands.moreSettings', 'Keys and more settings: OpenLex hub page')}</button>
    </div>
  )
}

/** /matter: choose the matter the App works on (shared with Word). */
function MatterChoice({ onDone }: { onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const [list, setList] = useState<Matter[] | null>(null)
  const [active, setActive] = useState('')
  useEffect(() => {
    mattersBridge()?.list().then((r: { matters: Matter[]; active: string | null }) => { setList(r.matters || []); setActive(r.active || '') }).catch(() => setList([]))
  }, [])
  const choose = async (m: Matter | null) => {
    await mattersBridge()!.setActive(m ? m.id : null)
    window.dispatchEvent(new CustomEvent('openlex:matter-changed'))
    onDone(m ? t('commands.nowMatter', 'Now working on {{title}}.', { title: m.title }) : t('commands.noMatterNow', 'Not working on a matter.'))
  }
  if (!list) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  return (
    <div className="space-y-1">
      {!list.length && <p className="text-antique">{t('commands.noMatters', 'No matters yet. Start one in the sidebar.')}</p>}
      {list.map((m) => (
        <button key={m.id} type="button" onClick={() => choose(m)} className="w-full flex items-center gap-3 rounded px-2 py-2 text-left hover:bg-leather/40 focus:bg-leather/40 outline-none">
          <Folder size={15} className="text-antique shrink-0" />
          <span className="flex-1 text-cream">{m.number ? `${m.number} · ` : ''}{m.title}{m.client ? <span className="text-antique"> — {m.client}</span> : null}</span>
          {m.id === active && <Check size={16} className="text-forest" />}
        </button>
      ))}
      {active && <button type="button" onClick={() => choose(null)} className="mt-2 text-xs text-antique underline">{t('commands.noMatterChoice', 'Work without a matter')}</button>}
    </div>
  )
}

/** /record and /activity: what the AI did (engine AI record), never any content. */
function RecordList({ all, recent, say }: { all: boolean; recent: boolean; say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
  const { t } = useTranslation()
  const [data, setData] = useState<{ line?: string; entries: RecordEntry[]; matterId: string | null } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    (async () => {
      const m = all ? null : await activeMatter()
      const q = new URLSearchParams({ limit: recent ? '20' : '100', ...(m ? { matterId: m.id } : {}), ...(recent ? { verify: '0' } : {}) })
      const r = await engine()!.call('GET', `/api/record?${q}`)
      setData({ line: r.line, entries: r.entries || [], matterId: m?.id || null })
    })().catch((err) => setError(String(err.message || err)))
  }, [all, recent])
  const exportAs = async (format: 'pdf' | 'csv') => {
    try {
      const r = await engine()!.call('POST', '/api/record/export', { matterId: data?.matterId || null, format })
      say(t('commands.exported', 'Saved the AI record: {{file}}', { file: r.file }))
    } catch (err) { say((err as Error).message, 'bad') }
  }
  if (error) return <p className="text-red-400">{error}</p>
  if (!data) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  return (
    <div>
      <p className="mb-3 text-antique">{data.matterId ? t('commands.thisMatter', 'This matter.') : t('commands.allMatters', 'All matters.')} {!recent && data.line}</p>
      {!data.entries.length && <p className="text-antique">{t('commands.recordEmpty', 'Nothing recorded yet. Each question and each larger piece of work is listed here: when, which AI and where it ran, what was looked up online — never the content.')}</p>}
      <ul className="space-y-0.5">
        {data.entries.map((x, i) => (
          <li key={i}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-leather/40 focus:bg-leather/40 outline-none">
              <span className={x.outcome === 'failed' ? 'text-red-400' : x.left ? 'text-amber-400' : 'text-forest'}>{x.outcome === 'failed' ? '✗' : x.left ? '!' : '✓'}</span>
              <span className="text-antique tabular-nums shrink-0">{new Date(x.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="text-cream truncate">{x.title}{x.window ? <span className="text-antique"> ({x.window})</span> : null}</span>
            </button>
            {open === i && <div className="ml-8 mb-2 space-y-0.5 text-xs text-parchment">{(x.lines || []).map((l, j) => <div key={j}>{l}</div>)}</div>}
          </li>
        ))}
      </ul>
      {!recent && data.entries.length > 0 && (
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => exportAs('pdf')}><Download size={14} /> {t('commands.exportPdf', 'Save as PDF')}</button>
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => exportAs('csv')}><Download size={14} /> {t('commands.exportCsv', 'Save as CSV')}</button>
        </div>
      )}
    </div>
  )
}
