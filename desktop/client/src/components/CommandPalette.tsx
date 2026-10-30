// The App's one palette (Ctrl+K / ⌘K, everywhere, the chat too): pages,
// chat commands and search. Pages and chat tools are listed at once; typing
// searches the engine (GET /api/find): matters, conversations from every
// window, saved items, drafts, documents in the matter folders, commands.
// The old palette searched the legacy server's documents and vault.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { HelpCircle, Archive, Briefcase, ClipboardList, FileSearch, FileText, Folder, LayoutDashboard, MessageSquare, ScanSearch, Search, Settings, Slash, Wrench } from 'lucide-react'
import { ChatCommand, engine, loadCommands } from '../lib/commands'

interface Target { page?: string; matterId?: string | null; sessionId?: string; id?: string; draftId?: string; command?: string; file?: string }
interface Entry { key: string; group: string; title: string; detail?: string; icon: React.ReactNode; target: Target }

const ICON: Record<string, React.ReactNode> = {
  matter: <Folder size={16} />, conversation: <MessageSquare size={16} />, saved: <Archive size={16} />, draft: <Wrench size={16} />,
  document: <FileText size={16} />, command: <Slash size={16} />,
}
const mattersBridge = () => (typeof window !== 'undefined' && (window as any).lexvault?.matters) || null

export default function CommandPalette() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [found, setFound] = useState<Entry[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const pages: Entry[] = useMemo(() => [
    { key: 'p-chat', group: 'go', title: t('palette.chat', 'Chat'), detail: t('palette.chatHint', 'questions, documents, the law'), icon: <MessageSquare size={16} />, target: { page: '/research' } },
    { key: 'p-analyse', group: 'go', title: t('palette.analyse', 'Analyse a document'), detail: '/analyse', icon: <FileSearch size={16} />, target: { page: '/research', command: 'analyse' } },
    { key: 'p-investigate', group: 'go', title: t('palette.investigate', 'Investigate several documents'), detail: '/investigate', icon: <ScanSearch size={16} />, target: { page: '/research', command: 'investigate' } },
    { key: 'p-draft', group: 'go', title: t('palette.draft', 'Write a draft'), detail: '/draft', icon: <Wrench size={16} />, target: { page: '/research', command: 'draft' } },
    { key: 'p-diligence', group: 'go', title: t('palette.diligence', 'Due diligence of a data room'), detail: '/diligence', icon: <Briefcase size={16} />, target: { page: '/research', command: 'diligence' } },
    { key: 'p-saved', group: 'go', title: t('palette.saved', 'Saved'), detail: t('palette.savedHint', 'answers, notes, clauses, documents, drafts'), icon: <Archive size={16} />, target: { page: '/vault' } },
    { key: 'p-record', group: 'go', title: t('palette.record', 'AI record'), icon: <ClipboardList size={16} />, target: { page: '/audit' } },
    { key: 'p-matters', group: 'go', title: t('palette.matters', 'Matters'), icon: <Folder size={16} />, target: { page: '/matters' } },
    { key: 'p-more', group: 'go', title: t('nav.more', 'More tools'), detail: t('palette.moreHint', 'review grid, plans, matter desk, hub'), icon: <LayoutDashboard size={16} />, target: { page: '/more' } },
    { key: 'p-settings', group: 'go', title: t('palette.settings', 'Settings'), icon: <Settings size={16} />, target: { page: '/settings' } },
    { key: 'p-help', group: 'go', title: t('nav.help', 'Help'), detail: t('palette.helpHint', 'commands, guides, diagnostics'), icon: <HelpCircle size={16} />, target: { page: '/help' } },
  ], [t])

  // The chat's "/" commands (the engine's one list): typing "/" or a word finds them.
  const [cmds, setCmds] = useState<ChatCommand[]>([])
  useEffect(() => {
    if (!isOpen || cmds.length || !engine()) return
    loadCommands(/^de/i.test(i18n.language || '') ? 'de' : 'en').then(setCmds).catch(() => {})
  }, [isOpen, cmds.length, i18n.language])
  const shownPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? pages.filter((p) => `${p.title} ${p.detail || ''}`.toLowerCase().includes(q)) : pages
  }, [pages, query])
  const shownCommands = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\//, '')
    if (!query.trim()) return []
    return cmds.filter((c) => `${c.name} ${c.help}`.toLowerCase().includes(q)).slice(0, query.trim().startsWith('/') ? 30 : 6)
      .map((c): Entry => ({ key: `cmd:${c.name}`, group: 'command', title: `/${c.name}`, detail: c.help, icon: <Slash size={16} />, target: { page: '/research', command: c.name } }))
  }, [cmds, query])
  const results = useMemo(() => {
    const seen = new Set(shownCommands.map((c) => c.key))
    return [...shownPages, ...shownCommands, ...found.filter((f) => f.group !== 'command' || !seen.has(`cmd:${String(f.title).replace(/^\//, '')}`))]
  }, [shownPages, shownCommands, found])

  // Search the engine (debounced).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || !engine()) { setFound([]); return }
    let alive = true
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        let matterId = ''
        try { matterId = (await mattersBridge()?.list())?.active || '' } catch { /* none */ }
        const lang = /^de/i.test(i18n.language || '') ? 'de' : 'en'
        const r = await engine()!.call('GET', `/api/find?q=${encodeURIComponent(q)}&lang=${lang}${matterId ? `&matterId=${encodeURIComponent(matterId)}` : ''}`)
        if (!alive) return
        setFound((r.groups || []).flatMap((g: any) => g.items.map((it: any) => ({ key: `${g.kind}:${it.id}`, group: g.kind, title: it.title, detail: it.detail, icon: ICON[g.kind] || <Search size={16} />, target: it.target || {} }))))
      } catch { if (alive) setFound([]) } finally { if (alive) setSearching(false) }
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, i18n.language])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setIsOpen((v) => !v) }
      if (e.key === 'Escape' && isOpen) { e.preventDefault(); setIsOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])
  useEffect(() => {
    if (!isOpen) return
    setTimeout(() => inputRef.current?.focus(), 50)
    setQuery('')
    setFound([])
    setSelected(0)
  }, [isOpen])
  useEffect(() => { setSelected(0) }, [query, found.length])
  useEffect(() => { listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' }) }, [selected])

  const go = useCallback(async (e: Entry) => {
    setIsOpen(false)
    const tg = e.target
    // A result of another matter: that matter becomes the active one first.
    if (tg.matterId && ['matter', 'conversation', 'saved', 'draft'].includes(e.group)) {
      try { await mattersBridge()?.setActive(tg.matterId); window.dispatchEvent(new CustomEvent('openlex:matter-changed')) } catch { /* keep */ }
    }
    if (tg.file) { engine()?.call('POST', '/api/workspace/reveal', { path: tg.file }).catch(() => {}); return }
    const state = tg.command ? { command: tg.command } : tg.sessionId ? { sessionId: tg.sessionId } : tg.id || tg.draftId ? { id: tg.id, draftId: tg.draftId } : undefined
    navigate(tg.page || '/research', state ? { state } : undefined)
  }, [navigate])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[selected]) go(results[selected]) }
  }

  if (!isOpen) return null
  const GROUPS: Record<string, string> = {
    go: t('palette.groupGo', 'Go to'), matter: t('palette.groupMatters', 'Matters'), conversation: t('palette.groupConversations', 'Conversations'),
    saved: t('palette.groupSaved', 'Saved'), draft: t('palette.groupDrafts', 'Drafts'), document: t('palette.groupDocuments', 'Documents (opens the folder)'), command: t('palette.groupCommands', 'Chat commands'),
  }
  const groups = [...new Set(results.map((r) => r.group))]

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto" data-testid="palette">
      <div className="fixed inset-0 bg-ink/70 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      <div className="flex items-start justify-center min-h-screen p-4 pt-[15vh]">
        <div className="relative w-full max-w-xl rounded-card shadow-2xl overflow-hidden bg-deep-brown border border-tobacco animate-fade-in" role="dialog" aria-modal="true" aria-label={t('palette.title', 'Search')}>
          <div className="flex items-center gap-3 px-4 py-4 border-b border-tobacco">
            <Search size={20} className="text-antique flex-shrink-0" />
            <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
              placeholder={t('palette.placeholder', 'Search matters, conversations, saved items, documents, commands')}
              className="flex-1 bg-transparent text-cream outline-none text-base placeholder:text-antique" data-testid="palette-input" />
            {searching && <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
          </div>
          <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
            {!results.length && <div className="px-4 py-8 text-center text-sm text-antique">{t('palette.nothing', 'Nothing found for “{{q}}”.', { q: query })}</div>}
            {groups.map((g) => (
              <div key={g}>
                <div className="px-4 py-1.5 text-xs font-medium text-antique/60 uppercase tracking-wider">{GROUPS[g] || g}</div>
                {results.filter((r) => r.group === g).map((item) => {
                  const i = results.indexOf(item)
                  return (
                    <button key={item.key} type="button" data-index={i} onClick={() => go(item)} onMouseMove={() => setSelected(i)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${i === selected ? 'bg-accent/10' : 'hover:bg-leather/30'}`} data-testid="palette-item">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${i === selected ? 'bg-accent/20 text-accent' : 'bg-obsidian text-antique'}`}>{item.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-cream truncate">{item.title}</div>
                        {item.detail && <div className="text-xs text-antique truncate">{item.detail}</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 border-t border-tobacco bg-obsidian/30 text-xs text-antique/60">{t('palette.keys', '↑↓ choose · ↵ open · esc close')}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
