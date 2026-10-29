// "/" commands in the App's chat — the same commands as the terminal app
// and the Word pane (the engine's one list: GET /api/commands). Typing "/"
// opens one small menu above the question field (↑ ↓ choose, Enter run,
// Tab fill in, Esc close; Ctrl+K / ⌘K opens it too). Commands run through
// the engine; the few that need a choice open a small dialog (which AI,
// which matter, the AI record). A quiet hint line under the field says how
// to find them. /as, /privileged, /permissions, /sources and /law work like
// in the terminal app (same engine endpoints, same words).
//
//   const cmd = useChatCommands({ input, setInput, focusInput, lastAnswer, lastBasis, newConversation, quickAgent, setQuickAgent })
//   <input onKeyDown={cmd.onKeyDown} …/>  ·  handleSubmit: if (cmd.intercept(input)) return
//   {cmd.menu} above the field, {cmd.hint} below it, {cmd.overlay} anywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { Check, Download, Folder, Lock, X } from 'lucide-react'
import { ModelPicker, PickerProvider } from './ModelPicker'
import { useWordLink } from '../lib/hub'
import { ChatCommand, PROVIDER_WORDS, didYouMean, engine, filterCommands, loadCommands, matterFolderName, menuQuery, parseCommand } from '../lib/commands'
import { Basis, friendly, patternWords } from '../lib/turn'

interface Matter { id: string; title: string; number?: string; client?: string; privileged?: boolean; agent?: string | null }
interface Agent { name: string; title: string; description?: string }
interface RecordEntry { at: string; title: string; window?: string; left?: boolean; outcome?: string; lines?: string[] }
type Dialog =
  | { kind: 'help' }
  | { kind: 'model'; pick?: string }
  | { kind: 'matter' }
  | { kind: 'record'; all: boolean }
  | { kind: 'activity' }
  | { kind: 'save'; summary: string; body: Record<string, unknown> }
  | { kind: 'as' }
  | { kind: 'unprivilege'; matter: Matter }
  | { kind: 'permissions' }
  | { kind: 'sources'; items: Basis[] }
  | { kind: 'law' }

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
  /** What the last answer is based on (/sources). */
  lastBasis?: () => Basis[]
  newConversation: () => void
  /** /analyse [document]: the full document analysis of the attached (or named) document. */
  analyse?: (arg: string) => void
  /** /investigate, /diligence, /draft: the chat's tools from the old desktop app (they become cards). */
  tool?: (name: string, arg: string) => void
  /** Who OpenLex works as for questions without a matter (a matter keeps its own). */
  quickAgent?: string
  setQuickAgent?: (name: string) => void
  /** An answer is being written: /clear waits. */
  running?: boolean
}) {
  const { input, setInput, focusInput, lastAnswer, lastBasis, newConversation, setQuickAgent, running } = opts
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

  /** /save: the last answer is kept with the matter (Saved; the old Vault). */
  const keep = useCallback(async (arg: string) => {
    const e = engine()
    const text = lastAnswer()
    if (!e) return
    if (!text) return say(t('commands.noAnswer', 'There is no answer yet.'), 'warn')
    try {
      const m = await activeMatter()
      await e.call('POST', '/api/saved', { matterId: m?.id || null, kind: 'answer', title: arg, content: text })
      say(t('commands.keptAnswer', 'Saved with {{where}}. Find it under Saved (or type /saved).', { where: m ? m.title : t('commands.noMatterSaved', 'your quick questions') }))
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
        // "/model local qwen3:8b": one of the models on this computer.
        const loc = /^(local|computer|this-computer)(?:\s+|:)(.+)$/i.exec(arg)
        if (loc) {
          try {
            say(t('modelPicker.switching', 'Switching to {{name}}…', { name: loc[2] }), 'warn')
            const r = await e.call('POST', '/api/local/use', { name: loc[2].trim() })
            if (r?.error) return say(friendly(r.error), 'bad')
            window.dispatchEvent(new CustomEvent('openlex:setup-changed'))
            return say(t('modelPicker.nowLocal', 'Now using {{name}} on this computer. Nothing leaves this computer.', { name: r.model.title }))
          } catch (err) { return say(friendly(err), 'bad') }
        }
        const id = PROVIDER_WORDS[arg.toLowerCase()] || arg.toLowerCase()
        try {
          const pv = await e.call('GET', '/api/providers')
          const p = (pv.providers || []).find((x: PickerProvider) => x.id === id) as PickerProvider | undefined
          if (!p) return say(t('commands.noService', 'There is no AI service called "{{name}}". Type /model to choose one.', { name: arg }), 'bad')
          // A key to add, a model never used for client data, or the cloud notice first: the picker asks.
          if (p.blocked || (p.needsKey && !p.hasKey) || (!p.local && !p.noticeSeen)) return setDialog({ kind: 'model', pick: id })
          await e.call('POST', '/api/providers', { active: id })
          window.dispatchEvent(new CustomEvent('openlex:setup-changed'))
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
      case 'save': return keep(arg)
      case 'saved': return navigate('/vault')
      case 'investigate': case 'diligence': case 'draft':
        return opts.tool ? opts.tool(name, arg) : say(t('commands.notHere', 'This command does not work here.'), 'warn')
      case 'word': {
        const text = lastAnswer()
        if (!text) return say(t('commands.noAnswer', 'There is no answer yet.'), 'warn')
        if (!word.connected) return say(t('commands.noWord', 'Word is not open with the OpenLex pane. Open it, then try again.'), 'warn')
        try { await word.sendToWord(text, { source: 'Research' }); return say(t('commands.sentToWord', 'Sent the last answer to Word.')) } catch (err) { return say((err as Error).message, 'bad') }
      }
      case 'activity': return setDialog({ kind: 'activity' })
      case 'record': return setDialog({ kind: 'record', all: /^all\b/i.test(arg) })
      case 'clear':
        if (running) return say(t('commands.clearWait', 'The answer is still being written. Stop it first, then start a new conversation.'), 'warn')
        newConversation(); return say(t('commands.cleared', 'New conversation. The earlier one stays in the list on the left; the documents are still there.'))
      case 'as': {
        if (!arg) return setDialog({ kind: 'as' })
        try {
          const list: Agent[] = ((await e.call('GET', '/api/agents')).agents || []).filter((a: any) => !a.error)
          const w = arg.toLowerCase()
          const a = list.find((x) => x.name === w || String(x.title).toLowerCase() === w)
          if (!a) return say(t('commands.noRole', 'No role called "{{name}}". Choose one of: {{list}}.', { name: arg, list: list.map((x) => x.name).join(', ') }), 'bad')
          return say(await chooseAgent(a, setQuickAgent))
        } catch (err) { return say(friendly(err), 'bad') }
      }
      case 'privileged': {
        const m = await activeMatter()
        if (!m) return say(t('commands.privNoMatter', 'A quick question has no matter. Choose a matter (/matter) to mark it privileged.'), 'warn')
        const on = /^(on|yes|ja|true|1|ein)$/i.test(arg)
        const off = /^(off|no|nein|false|0|aus)$/i.test(arg)
        if (!on && !off) return say(m.privileged ? t('commands.privIsOn', 'This matter is privileged: nothing from it leaves this computer. Type /privileged off to change that.') : t('commands.privIsOff', 'This matter is not privileged. Type /privileged on to keep everything in it on this computer.'), 'warn')
        if (off) return m.privileged ? setDialog({ kind: 'unprivilege', matter: m }) : say(t('commands.privAlreadyOff', 'This matter is not privileged.'))
        try { await setPrivileged(m, true); return say(t('commands.privOn', 'Privileged: nothing from this matter leaves this computer.')) } catch (err) { return say(friendly(err), 'bad') }
      }
      case 'permissions': return setDialog({ kind: 'permissions' })
      case 'sources': {
        const items = lastBasis ? lastBasis() : []
        if (!items.length) return say(t('commands.noSources', 'Nothing to show yet: the last answer did not use any law or document passages.'), 'warn')
        return setDialog({ kind: 'sources', items })
      }
      case 'law': return setDialog({ kind: 'law' })
      case 'analyse': return opts.analyse ? opts.analyse(arg) : say(t('commands.notHere', 'This command does not work here.'), 'warn')
      default: return say(t('commands.unknown', 'There is no command /{{name}}. Type /help to see the commands.', { name }), 'warn')
    }
  }, [keep, lastAnswer, lastBasis, navigate, newConversation, running, say, setInput, setQuickAgent, t, word])

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
      quickAgent={opts.quickAgent}
      setQuickAgent={setQuickAgent}
    />
  ) : null

  return { onKeyDown, intercept, menu: <>{noticeLine}{menu}</>, hint, overlay, openMenu, run }
}

// ── the small dialogs ──────────────────────────────────────────────────────

function CommandDialog({ dialog, commands, onClose, onRun, onSaveOnce, say, quickAgent, setQuickAgent }: {
  dialog: Dialog
  commands: ChatCommand[]
  onClose: () => void
  onRun: (name: string) => void
  onSaveOnce: (body: Record<string, unknown>) => void
  say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void
  quickAgent?: string
  setQuickAgent?: (name: string) => void
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
    as: t('commands.asTitle', 'Who should OpenLex work as?'),
    unprivilege: t('commands.unprivTitle', 'Turn privileged off?'),
    permissions: t('commands.permsTitle', 'What OpenLex may do without asking'),
    sources: t('commands.sourcesTitle', 'What the last answer is based on'),
    law: t('commands.lawTitle', 'Where OpenLex looks up the law'),
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-ink/70" onClick={onClose} />
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={titles[dialog.kind]} className={`relative w-full ${dialog.kind === 'model' ? 'max-w-2xl' : 'max-w-lg'} rounded-card border border-tobacco bg-deep-brown shadow-2xl animate-fade-in`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-tobacco">
          <h2 className="font-serif text-lg text-parchment">{titles[dialog.kind]}</h2>
          <button type="button" onClick={onClose} className="text-antique hover:text-cream" aria-label={t('common.close', 'Close')}><X size={18} /></button>
        </div>
        <div className={`${dialog.kind === 'model' ? 'max-h-[72vh]' : 'max-h-[60vh]'} overflow-y-auto p-4 text-sm`}>
          {dialog.kind === 'help' && <HelpList commands={commands} onRun={onRun} />}
          {dialog.kind === 'model' && <ModelPicker pick={dialog.pick} onDone={(text) => { say(text); onClose() }} />}
          {dialog.kind === 'matter' && <MatterChoice onDone={(text) => { say(text); onClose() }} />}
          {(dialog.kind === 'record' || dialog.kind === 'activity') && <RecordList all={dialog.kind === 'record' && dialog.all} recent={dialog.kind === 'activity'} say={say} />}
          {dialog.kind === 'as' && <AgentChoice quickAgent={quickAgent} setQuickAgent={setQuickAgent} onDone={(text) => { say(text); onClose() }} />}
          {dialog.kind === 'unprivilege' && (
            <div className="space-y-4">
              <p className="text-parchment">{t('commands.unprivAsk', 'Then this matter follows your client-data rule, which may allow sending its documents to an online AI service.')}</p>
              <div className="flex gap-3">
                <button type="button" className="btn-secondary flex-1" onClick={async () => { try { await setPrivileged(dialog.matter, false); say(t('commands.privOff', 'No longer privileged: your client-data rule now decides.')) } catch (err) { say(friendly(err), 'bad') } onClose() }}>{t('commands.unprivYes', 'Turn privileged off')}</button>
                <button type="button" className="btn-primary flex-1" onClick={() => { say(t('commands.stillPriv', 'Still privileged.')); onClose() }}>{t('commands.unprivNo', 'Keep it privileged')}</button>
              </div>
            </div>
          )}
          {dialog.kind === 'permissions' && <PermissionRules say={say} />}
          {dialog.kind === 'sources' && <SourcesList items={dialog.items} />}
          {dialog.kind === 'law' && <LawSources say={say} />}
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
export function RecordList({ all, recent, say }: { all: boolean; recent: boolean; say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
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

// ── /as, /privileged, /permissions, /sources, /law ─────────────────────────

/** /as: a matter keeps its role (shared with the other windows); a quick question uses the App's choice. */
async function chooseAgent(a: Agent, setQuickAgent?: (name: string) => void): Promise<string> {
  const m = await activeMatter()
  if (m) {
    const b = mattersBridge()
    const patch = { agent: a.name === 'associate' ? null : a.name }
    if (b?.update) await b.update(m.id, patch)
    else await engine()!.call('POST', '/api/matters/update', { id: m.id, patch })
    window.dispatchEvent(new CustomEvent('openlex:matter-changed'))
    return String(i18n.t('commands.nowAsMatter', { defaultValue: 'Now working as {{who}} for this matter.', who: a.title }))
  }
  setQuickAgent?.(a.name)
  return String(i18n.t('commands.nowAs', { defaultValue: 'Now working as {{who}}.', who: a.title }))
}

async function setPrivileged(m: Matter, on: boolean) {
  const b = mattersBridge()
  if (b?.update) await b.update(m.id, { privileged: on })
  else await engine()!.call('POST', '/api/matters/update', { id: m.id, patch: { privileged: on } })
  window.dispatchEvent(new CustomEvent('openlex:matter-changed'))
}

function AgentChoice({ quickAgent, setQuickAgent, onDone }: { quickAgent?: string; setQuickAgent?: (name: string) => void; onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const [list, setList] = useState<Agent[] | null>(null)
  const [current, setCurrent] = useState('associate')
  const [error, setError] = useState('')
  useEffect(() => {
    (async () => {
      const r = await engine()!.call('GET', '/api/agents')
      setList((r.agents || []).filter((a: any) => !a.error))
      const m = await activeMatter()
      setCurrent((m ? m.agent : quickAgent) || 'associate')
    })().catch((err) => setError(friendly(err)))
  }, [quickAgent])
  if (error) return <p className="text-red-400">{error}</p>
  if (!list) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  return (
    <div className="space-y-1">
      <p className="mb-2 text-antique">{t('commands.asHelp', 'Stays chosen for this matter until you change it — in every window.')}</p>
      {list.map((a) => (
        <button key={a.name} type="button" onClick={async () => { try { onDone(await chooseAgent(a, setQuickAgent)) } catch (err) { setError(friendly(err)) } }} className="w-full flex items-start gap-3 rounded px-2 py-2 text-left hover:bg-leather/40 focus:bg-leather/40 outline-none">
          <span className="flex-1">
            <span className="text-cream">{a.title}</span>
            {a.description && <span className="block text-xs text-antique">{a.description}</span>}
          </span>
          {a.name === current && <Check size={16} className="text-forest mt-0.5" />}
        </button>
      ))}
    </div>
  )
}

/** /permissions: allowed without asking (everywhere / per matter), never allowed, and the firm's own (shown, not editable). */
function PermissionRules({ say }: { say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
  const { t } = useTranslation()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [matterId, setMatterId] = useState<string | null>(null)
  const load = useCallback(() => {
    (async () => {
      const m = await activeMatter()
      setMatterId(m?.id || null)
      setData(await engine()!.call('GET', '/api/permissions'))
    })().catch((err) => setError(friendly(err)))
  }, [])
  useEffect(() => { load() }, [load])
  const remove = async (pattern: string, mid?: string) => {
    try {
      await engine()!.call('POST', '/api/permissions/rules', { action: 'remove', pattern, ...(mid ? { matterId: mid } : {}) })
      say(t('commands.ruleRemoved', 'Removed: {{what}}. OpenLex will ask again.', { what: patternWords(pattern) }))
      load()
    } catch (err) { say(friendly(err), 'bad') }
  }
  if (error) return <p className="text-red-400">{error}</p>
  if (!data) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  const u = data.user || {}
  const f = data.firm || {}
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const mine: { pattern: string; where: string; mark: string; matterId?: string }[] = [
    ...(u.allow || []).map((p: string) => ({ pattern: p, where: t('commands.everywhere', 'allowed everywhere'), mark: '✓' })),
    ...Object.entries(u.matters || {}).filter(([id]) => !matterId || id === matterId).flatMap(([id, m]: [string, any]) => (m.allow || []).map((p: string) => ({ pattern: p, where: id === matterId ? t('commands.thisMatterRule', 'this matter') : t('commands.matterId', 'matter {{id}}', { id }), mark: '✓', matterId: id }))),
    ...(u.deny || []).map((p: string) => ({ pattern: p, where: t('commands.never', 'never allowed'), mark: '✗' })),
  ]
  const firm: { pattern: string; where: string; mark: string }[] = [
    ...(f.allow || []).map((p: string) => ({ pattern: p, where: t('commands.firmAllows', 'allowed by your firm'), mark: '✓' })),
    ...(f.deny || []).map((p: string) => ({ pattern: p, where: t('commands.firmBlocks', 'blocked by your firm'), mark: '✗' })),
    ...(f.ask || []).map((p: string) => ({ pattern: p, where: t('commands.firmAsks', 'your firm always asks'), mark: '?' })),
  ]
  return (
    <div className="space-y-3">
      {data.locked && <p className="text-antique">{t('commands.rulesLocked', 'Your firm has fixed these rules; your own are not used.')}</p>}
      {!mine.length && !firm.length && <p className="text-antique">{t('commands.noRules', 'Nothing yet: OpenLex asks before it saves files, opens web pages, runs programs or uses connectors. Choose "Always allow" when it asks to stop being asked.')}</p>}
      <ul className="space-y-1">
        {mine.map((r) => (
          <li key={`${r.matterId || ''}:${r.mark}:${r.pattern}`} className="flex items-center gap-2">
            <span aria-hidden="true" className={r.mark === '✓' ? 'text-forest' : 'text-red-400'}>{r.mark}</span>
            <span className="flex-1 text-cream">{cap(patternWords(r.pattern))} <span className="text-xs text-antique">— {r.where}</span></span>
            <button type="button" className="text-xs text-antique underline hover:text-cream" onClick={() => remove(r.pattern, r.matterId)}>{t('commands.removeRule', 'Remove')}</button>
          </li>
        ))}
        {firm.map((r) => (
          <li key={`firm:${r.mark}:${r.pattern}`} className="flex items-center gap-2 opacity-80">
            <span aria-hidden="true">{r.mark}</span>
            <span className="flex-1 text-parchment">{cap(patternWords(r.pattern))} <span className="text-xs text-antique">— {r.where}</span></span>
            <Lock size={12} className="text-antique" />
          </li>
        ))}
      </ul>
      <p className="text-xs text-antique">{t('commands.rulesNote', 'Reading documents and searching the law never needs asking.')}</p>
    </div>
  )
}

/** /sources: every law section and document passage the last answer used; a law section opens in full. */
function SourcesList({ items }: { items: Basis[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<{ n: number; label: string; text: string } | null>(null)
  const show = async (it: Basis) => {
    if (it.kind !== 'law' || !it.chunk_id) return setOpen({ n: it.n, label: it.label, text: it.detail || t('commands.docPassage', 'OpenLex read this part of your document for the answer.') })
    setOpen({ n: it.n, label: it.label, text: t('common.loading', 'Loading…') })
    try {
      const r = await engine()!.call('GET', `/api/law/section?chunk_id=${encodeURIComponent(it.chunk_id)}`)
      setOpen({ n: it.n, label: [r.source_name, r.section].filter(Boolean).join(' ') || it.label, text: r.content || it.detail })
    } catch (err) { setOpen({ n: it.n, label: it.label, text: `${it.detail ? `${it.detail}\n\n` : ''}(${friendly(err)})` }) }
  }
  if (open) {
    return (
      <div className="space-y-2">
        <button type="button" className="text-xs text-antique underline" onClick={() => setOpen(null)}>{t('commands.backToList', '← back to the list')}</button>
        <div className="text-cream font-medium">[{open.n}] {open.label}</div>
        <div className="text-parchment whitespace-pre-wrap text-xs">{open.text}</div>
      </div>
    )
  }
  return (
    <div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.n}>
            <button type="button" onClick={() => show(it)} className="w-full flex items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-leather/40 focus:bg-leather/40 outline-none">
              <span className="text-accent tabular-nums">[{it.n}]</span>
              <span className="flex-1"><span className="text-cream">{it.label}</span>{it.detail && <span className="block text-xs text-antique truncate">{it.detail}</span>}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-antique">{t('commands.sourcesNote', 'Law sections come from the law collection on this computer. Check them before relying on the answer.')}</p>
    </div>
  )
}

interface LawSource { id: string; label: string; status: string; description?: string; state: string; enabled: boolean; needsKey: boolean; optionalKey: boolean; hasKey: boolean; keyHelp?: string | null; managedByFirm: boolean; licence?: string }

/** /law: the law databases OpenLex looks things up in (engine connectors): on/off, paste a key. */
function LawSources({ say }: { say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
  const { t } = useTranslation()
  const [list, setList] = useState<LawSource[] | null>(null)
  const [error, setError] = useState('')
  const [keyFor, setKeyFor] = useState<LawSource | null>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    (async () => {
      const m = await activeMatter()
      const r = await engine()!.call('GET', `/api/sources/law${m ? `?matterId=${encodeURIComponent(m.id)}` : ''}`)
      setList(r.sources || [])
    })().catch((err) => setError(friendly(err)))
  }, [])
  useEffect(() => { load() }, [load])
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try { await fn(); say(done) } catch (err) { say(friendly(err), 'bad') }
    setBusy(false); setKeyFor(null); setSecret(''); load()
  }
  if (error) return <p className="text-red-400">{error}</p>
  if (!list) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  if (keyFor) {
    return (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (secret.trim()) act(() => engine()!.call('POST', '/api/sources/key', { name: keyFor.id, key: secret.trim() }), t('commands.keySavedFor', 'Saved the {{name}} key.', { name: keyFor.label })) }}>
        <label className="block text-cream">{t('commands.yourKey', 'Your {{name}} key', { name: keyFor.label })}</label>
        <input type="password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className="input w-full" autoComplete="off" />
        <p className="text-xs text-antique">{keyFor.keyHelp ? `${keyFor.keyHelp} ` : ''}{t('commands.keyKept', 'It is kept in this computer\'s keychain and only sent to {{name}}.', { name: keyFor.label })}</p>
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !secret.trim()} className="btn-primary flex-1">{t('commands.saveKey', 'Save the key')}</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => { setKeyFor(null); setSecret('') }}>{t('common.cancel', 'Cancel')}</button>
        </div>
      </form>
    )
  }
  const offline = list.some((s) => s.state === 'offline')
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {list.map((s) => (
          <li key={s.id} className="rounded px-2 py-1.5 hover:bg-leather/30">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={s.state === 'ready' ? 'text-forest' : s.state === 'off' ? 'text-antique' : 'text-amber-400'}>{s.state === 'ready' ? '✓' : s.state === 'off' ? '–' : '!'}</span>
              <span className="flex-1 text-cream">{s.status}</span>
              {(s.needsKey || s.optionalKey) && <button type="button" disabled={busy} className="text-xs text-antique underline hover:text-cream" onClick={() => setKeyFor(s)}>{s.hasKey ? t('commands.replaceKey', 'Replace the key') : t('commands.pasteKey', 'Paste your key')}</button>}
              {!s.managedByFirm && (
                <button type="button" disabled={busy} className="text-xs text-antique underline hover:text-cream" onClick={() => act(() => engine()!.call('POST', '/api/sources/enable', { name: s.id, on: !s.enabled }), s.enabled ? t('commands.nowOff', '{{name}} is now off.', { name: s.label }) : t('commands.nowOn', '{{name}} is now on.', { name: s.label }))}>
                  {s.enabled ? t('commands.switchOff', 'Switch off') : t('commands.switchOn', 'Switch on')}
                </button>
              )}
            </div>
            {s.description && <div className="ml-6 text-xs text-antique">{s.description}</div>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-antique">
        {t('commands.lawNote', 'Only your search words are sent, never your documents.')} {offline ? t('commands.lawOffline', 'Online look-ups are off in your client-data rule (/data).') : ''} {list[0]?.managedByFirm ? t('commands.lawFirm', 'Your firm manages this list.') : ''}
      </p>
    </div>
  )
}
