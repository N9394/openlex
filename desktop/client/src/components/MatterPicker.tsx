// The matter the App works on (shared with Word and the terminal through
// the engine: window.lexvault.matters). A button with the full matter name
// opens a searchable list (number, title, client, a privileged badge) and a
// short "New matter" form. The active matter decides the client-data rule
// for the chat; a privileged matter stays on this computer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Folder, Link2, Lock, Plus, Search, X } from 'lucide-react'
import { hubBridge, useWordLink } from '../lib/hub'

export interface Matter {
  id: string
  title: string
  client?: string
  number?: string
  privileged?: boolean
  docs?: { docId: string; title?: string }[]
  policy?: { mode: 'local-only' | 'allow-list'; providers?: string[] }
}

interface MattersBridge {
  list: () => Promise<{ matters: Matter[]; active: string | null }>
  create: (m: { title: string; client?: string; number?: string; privileged?: boolean }) => Promise<Matter>
  setActive: (id: string | null) => Promise<{ ok: boolean }>
  update?: (id: string, patch: Record<string, unknown>) => Promise<unknown>
}

export const mattersBridge = (): MattersBridge | null =>
  (typeof window !== 'undefined' && (window as any).lexvault?.matters) || null

export const matterName = (m: Matter) => `${m.number ? `${m.number} · ` : ''}${m.title}`

/** The matters and the active one, kept fresh (Word, /matter, the palette). */
export function useMatters() {
  const [matters, setMatters] = useState<Matter[]>([])
  const [active, setActive] = useState<string>('')
  const refresh = useCallback(async () => {
    const b = mattersBridge()
    if (!b) return
    try {
      const r = await b.list()
      setMatters(r.matters || [])
      setActive(r.active || '')
    } catch { /* engine not ready */ }
  }, [])
  useEffect(() => {
    refresh()
    hubBridge()?.onEvent((ev) => { if (ev.type === 'matter-changed' || ev.type === 'policy-changed') refresh() })
    window.addEventListener('openlex:matter-changed', refresh)
    return () => window.removeEventListener('openlex:matter-changed', refresh)
  }, [refresh])
  const choose = useCallback(async (id: string | null) => {
    setActive(id || '')
    await mattersBridge()?.setActive(id)
    window.dispatchEvent(new CustomEvent('openlex:matter-changed'))
  }, [])
  return { matters, active, refresh, choose }
}

/** The searchable list (also used by the Matters page and /matter). */
export function MatterList({ matters, active, onChoose, autoFocus = true, showNone = true }: {
  matters: Matter[]; active: string; onChoose: (m: Matter | null) => void; autoFocus?: boolean; showNone?: boolean
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(0)
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase()
    return w ? matters.filter((m) => `${m.number || ''} ${m.title} ${m.client || ''}`.toLowerCase().includes(w)) : matters
  }, [matters, q])
  useEffect(() => setPick(0), [q])
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => { listRef.current?.querySelector(`[data-i="${pick}"]`)?.scrollIntoView({ block: 'nearest' }) }, [pick])
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-button border border-tobacco bg-deep-brown px-3 py-2">
        <Search size={15} className="text-antique shrink-0" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setPick((i) => Math.min(i + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setPick((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && shown[pick]) { e.preventDefault(); onChoose(shown[pick]) }
          }}
          placeholder={t('matters.search', 'Search by name, number or client')}
          className="flex-1 min-w-0 bg-transparent outline-none text-sm text-cream placeholder:text-antique"
          aria-label={t('matters.search', 'Search by name, number or client')}
          data-testid="matter-search"
        />
      </label>
      <ul ref={listRef} className="max-h-[50vh] overflow-y-auto space-y-0.5" role="listbox" aria-label={t('matters.title', 'Matters')}>
        {!matters.length && <li className="px-2 py-2 text-sm text-antique">{t('matters.none', 'No matters yet. Start one with “New matter”.')}</li>}
        {matters.length > 0 && !shown.length && <li className="px-2 py-2 text-sm text-antique">{t('matters.nothing', 'No matter matches “{{q}}”.', { q })}</li>}
        {shown.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              role="option"
              aria-selected={m.id === active}
              data-i={i}
              onClick={() => onChoose(m)}
              onMouseMove={() => setPick(i)}
              className={`w-full flex items-start gap-2 rounded px-2 py-2 text-left text-sm ${i === pick ? 'bg-accent/10' : 'hover:bg-leather/60'}`}
              data-testid="matter-option"
            >
              <Folder size={15} className="text-antique mt-0.5 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="text-cream [overflow-wrap:anywhere]">{matterName(m)}</span>
                {m.privileged && <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-forest border border-forest/40 rounded px-1 py-px"><Lock size={10} /> {t('matters.privileged', 'privileged')}</span>}
                {m.client && <span className="block text-xs text-antique [overflow-wrap:anywhere]">{m.client}</span>}
              </span>
              {m.id === active && <Check size={16} className="text-forest mt-0.5 shrink-0" aria-label={t('matters.current', 'current')} />}
            </button>
          </li>
        ))}
      </ul>
      {showNone && active && (
        <button type="button" onClick={() => onChoose(null)} className="text-xs text-antique underline hover:text-cream px-2 py-1">
          {t('matters.noMatter', 'Work without a matter (quick questions)')}
        </button>
      )}
    </div>
  )
}

/** "New matter": title, client, number, privileged, names to hide. */
export function NewMatterForm({ onDone, onCancel }: { onDone: (m: Matter) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ title: '', client: '', number: '', privileged: false, hide: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!form.title.trim()) return setError(t('matters.titleNeeded', 'Give the matter a name.'))
    setBusy(true); setError('')
    try {
      const b = mattersBridge()!
      const m = await b.create({ title: form.title.trim(), client: form.client.trim(), number: form.number.trim(), privileged: form.privileged })
      if (form.hide.trim() && b.update) await b.update(m.id, { redactTerms: form.hide })
      await b.setActive(m.id)
      window.dispatchEvent(new CustomEvent('openlex:matter-changed'))
      onDone(m)
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
  const field = 'input w-full !py-2 text-sm'
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); create() }} data-testid="new-matter-form">
      <input autoFocus className={field} placeholder={t('matters.name', 'Name of the matter')} aria-label={t('matters.name', 'Name of the matter')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <input className={field} placeholder={t('matters.client', 'Client (optional)')} aria-label={t('matters.client', 'Client (optional)')} value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
      <input className={field} placeholder={t('matters.number', 'Matter number (optional)')} aria-label={t('matters.number', 'Matter number (optional)')} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
      <input className={field} placeholder={t('matters.hide', 'Names to hide from online AI (optional, comma-separated)')} aria-label={t('matters.hide', 'Names to hide from online AI (optional, comma-separated)')} value={form.hide} onChange={(e) => setForm({ ...form, hide: e.target.value })} />
      <label className="flex items-start gap-2 text-sm text-parchment">
        <input type="checkbox" className="mt-0.5" checked={form.privileged} onChange={(e) => setForm({ ...form, privileged: e.target.checked })} />
        <span>{t('matters.privilegedLabel', 'Privileged: everything stays on this computer')}</span>
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary !px-4 !py-2 text-sm">{t('matters.create', 'Create the matter')}</button>
        <button type="button" onClick={onCancel} className="btn-secondary !px-4 !py-2 text-sm">{t('common.cancel', 'Cancel')}</button>
      </div>
    </form>
  )
}

/** A small dialog box (the picker, the new-matter form). */
export function SmallDialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const { t } = useTranslation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
      <div className="fixed inset-0 bg-ink/70" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-card border border-tobacco bg-deep-brown shadow-2xl animate-fade-in`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-tobacco">
          <h2 className="font-serif text-lg text-parchment">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 text-antique hover:text-cream" aria-label={t('common.close', 'Close')}><X size={18} /></button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto p-4 text-sm">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Sidebar: the current matter as a button; click opens the picker. */
export default function MatterPicker() {
  const { t } = useTranslation()
  const { matters, active, choose } = useMatters()
  const [open, setOpen] = useState<'list' | 'new' | null>(null)
  const word = useWordLink()
  if (!mattersBridge()) return null
  const current = matters.find((m) => m.id === active)
  return (
    <div className="px-3 py-2 border-b border-tobacco text-xs" data-testid="matter-picker">
      <div className="text-[11px] uppercase tracking-wide text-antique/80 mb-1">{t('matters.label', 'Matter')}</div>
      <button
        type="button"
        onClick={() => setOpen('list')}
        aria-haspopup="dialog"
        title={current ? `${matterName(current)}${current.client ? ` — ${current.client}` : ''}` : undefined}
        className="w-full flex items-center gap-2 rounded-button border border-tobacco px-2.5 py-1.5 text-left text-sm text-cream hover:border-accent"
        data-testid="matter-button"
      >
        {current?.privileged ? <Lock size={13} className="text-forest shrink-0" aria-label={t('matters.privileged', 'privileged')} /> : <Folder size={13} className="text-antique shrink-0" />}
        <span className="flex-1 min-w-0 line-clamp-2 [overflow-wrap:anywhere]">{current ? matterName(current) : t('matters.noneChosen', 'No matter (quick questions)')}</span>
        <ChevronDown size={13} className="text-antique shrink-0" />
      </button>
      <div className="mt-1 flex items-center gap-2 text-antique">
        {current && (current.privileged || current.policy?.mode === 'local-only'
          ? <span className="flex items-center gap-1 text-forest"><Lock size={11} /> {t('matters.localOnly', 'stays on this computer')}</span>
          : <span>{t('matters.followsRule', 'follows your client-data rule')}</span>)}
        {word.connected && <span className="flex items-center gap-1"><Link2 size={11} /> Word</span>}
        <button type="button" onClick={() => setOpen('new')} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 hover:text-accent" title={t('matters.new', 'New matter')} data-testid="new-matter">
          <Plus size={13} /> {t('matters.newShort', 'New')}
        </button>
      </div>
      {open && (
        <SmallDialog title={open === 'new' ? t('matters.new', 'New matter') : t('matters.choose', 'Choose a matter')} onClose={() => setOpen(null)}>
          {open === 'list' ? (
            <>
              <MatterList matters={matters} active={active} onChoose={async (m) => { await choose(m ? m.id : null); setOpen(null) }} />
              <button type="button" onClick={() => setOpen('new')} className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:text-cream px-2 py-1"><Plus size={14} /> {t('matters.new', 'New matter')}</button>
            </>
          ) : (
            <NewMatterForm onDone={() => setOpen(null)} onCancel={() => setOpen('list')} />
          )}
        </SmallDialog>
      )}
    </div>
  )
}
