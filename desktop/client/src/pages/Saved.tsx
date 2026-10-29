// Saved (the old Vault, now on the engine): what is kept with the matter —
// answers (/save in the chat), notes, clauses, templates, documents (their
// text, from a file you add here), and the chat tools' results (an
// investigation, due diligence, a draft). Search, tags, edit, copy, delete,
// export Word / PDF / Markdown, the list as CSV or Word. The matter's
// drafts (/draft) are listed too and open here.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Archive, Copy, FileUp, MessageSquare, Plus, Search, Star, Trash2, X } from 'lucide-react'
import { engine } from '../lib/commands'
import { attachFile, download, refusal } from '../lib/attach'
import { friendly } from '../lib/turn'
import ExportButtons from '../components/ExportButtons'
import DraftCard from '../components/DraftCard'

interface Item { id: string; matterId: string | null; kind: string; title: string; content: string; tags: string[]; favorite: boolean; createdAt: string; updatedAt: string; source?: { kind: string; id: string } }
interface Matter { id: string; title: string; number?: string }
const KINDS = ['answer', 'note', 'clause', 'template', 'draft', 'document', 'analysis', 'investigation', 'diligence']
const mattersBridge = () => (typeof window !== 'undefined' && (window as any).lexvault?.matters) || null

export default function Saved() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [matter, setMatter] = useState<Matter | null>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [drafts, setDrafts] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [open, setOpen] = useState<string | null>((location.state as any)?.id || null)
  const [draft, setDraft] = useState<string | null>((location.state as any)?.draftId || null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const kindWord = (k: string) => t(`saved.kind.${k}`, k)

  const load = useCallback(async () => {
    const e = engine()
    if (!e) return
    let m: Matter | null = null
    try { const r = await mattersBridge()?.list(); m = (r?.matters || []).find((x: Matter) => x.id === r.active) || null } catch { /* none */ }
    setMatter(m)
    const p = new URLSearchParams({ ...(m ? { matterId: m.id } : {}), ...(q ? { q } : {}), ...(kind ? { kind } : {}) })
    try { setItems((await e.call('GET', `/api/saved?${p}`)).items || []) } catch (err) { setMsg({ text: friendly(err), ok: false }); setItems([]) }
    e.call('GET', `/api/drafts${m ? `?matterId=${encodeURIComponent(m.id)}` : ''}`).then((r) => setDrafts(r.drafts || [])).catch(() => setDrafts([]))
  }, [q, kind])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const on = () => load()
    window.addEventListener('openlex:matter-changed', on)
    return () => window.removeEventListener('openlex:matter-changed', on)
  }, [load])

  const upload = async (list: FileList | null) => {
    const f = list?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!f) return
    const no = refusal(f)
    if (no) return setMsg({ text: no, ok: false })
    setMsg({ text: t('saved.reading', 'Reading {{name}} on this computer…', { name: f.name }), ok: true })
    try {
      const a = await attachFile(f, { matterId: matter?.id || null })
      const r = await engine()!.call('POST', '/api/saved', { matterId: matter?.id || null, attachment: a.id })
      setMsg({ text: t('saved.added', 'Saved: {{title}}', { title: r.item.title }), ok: true })
      setOpen(r.item.id)
      load()
    } catch (err) { setMsg({ text: friendly(err), ok: false }) }
  }

  if (!engine()) return <div className="p-8 text-antique">{t('saved.needsApp', 'Saved items are available in the desktop app.')}</div>
  const current = items?.find((x) => x.id === open) || null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-parchment flex items-center gap-2"><Archive size={22} className="text-accent" /> {t('saved.title', 'Saved')}</h1>
          <p className="text-antique text-sm">{matter ? t('saved.inMatter', 'Kept with {{title}} — in every window.', { title: matter.title }) : t('saved.noMatter', 'Without a matter. Choose a matter in the sidebar to see what is kept with it.')}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={() => setAdding(true)} className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1"><Plus size={14} /> {t('saved.new', 'New note or clause')}</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1"><FileUp size={14} /> {t('saved.addFile', 'Add a document')}</button>
          <input ref={fileRef} type="file" className="hidden" accept=".docx,.pdf,.xlsx,.eml,.txt,.md,.csv,.html,.rtf" onChange={(e) => upload(e.target.files)} />
        </div>
      </div>
      {msg && <div className={`text-sm ${msg.ok ? 'text-forest' : 'text-red-400'}`} role="status">{msg.text}</div>}
      {adding && <NewItem matterId={matter?.id || null} onDone={(id) => { setAdding(false); if (id) { setOpen(id); load() } }} />}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-antique" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('saved.search', 'Search titles, tags and text')} className="input w-full !pl-8 !py-1.5 text-sm" data-testid="saved-search" />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input !py-1.5 text-sm w-auto">
          <option value="">{t('saved.allKinds', 'Everything')}</option>
          {KINDS.map((k) => <option key={k} value={k}>{kindWord(k)}</option>)}
        </select>
        {!!items?.length && <ExportList matterId={matter?.id || null} q={q} kind={kind} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-1">
          {items === null ? <p className="text-antique text-sm">{t('common.loading', 'Loading…')}</p> : !items.length && !drafts.length ? (
            <p className="text-antique text-sm">{q || kind ? t('saved.nothingFound', 'Nothing found.') : t('saved.empty', 'Nothing saved yet. In the chat, /save keeps the last answer here; the cards of /investigate, /diligence and /draft have a “Save with the matter” button.')}</p>
          ) : null}
          {(items || []).map((x) => (
            <button key={x.id} type="button" onClick={() => { setOpen(x.id); setDraft(null) }} className={`w-full text-left rounded-card border px-3 py-2 ${open === x.id ? 'border-accent/60 bg-accent/10' : 'border-tobacco hover:bg-leather'}`} data-testid="saved-item">
              <div className="flex items-center gap-2">
                {x.favorite && <Star size={12} className="text-accent shrink-0" fill="currentColor" />}
                <span className="text-cream text-sm truncate flex-1">{x.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-antique">{kindWord(x.kind)}</span>
              </div>
              <div className="text-xs text-antique truncate">{new Date(x.createdAt).toLocaleDateString()}{x.tags.length ? ` · ${x.tags.map((g) => `#${g}`).join(' ')}` : ''}</div>
            </button>
          ))}
          {!!drafts.length && <div className="pt-3 text-xs uppercase tracking-wide text-antique">{t('saved.drafts', 'Drafts')}</div>}
          {drafts.filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase())).map((d) => (
            <button key={d.id} type="button" onClick={() => { setDraft(d.id); setOpen(null) }} className={`w-full text-left rounded-card border px-3 py-2 ${draft === d.id ? 'border-accent/60 bg-accent/10' : 'border-tobacco hover:bg-leather'}`}>
              <div className="text-cream text-sm truncate">{d.title}</div>
              <div className="text-xs text-antique">{t('saved.draftMeta', '{{n}} versions · {{date}}', { n: d.versions, date: new Date(d.updatedAt).toLocaleDateString() })}</div>
            </button>
          ))}
        </div>
        <div>
          {draft ? <DraftCard key={draft} id={draft} /> : current ? <ItemView key={current.id} item={current} onChanged={load} onDeleted={() => { setOpen(null); load() }} openChat={() => navigate('/research')} /> : null}
        </div>
      </div>
    </div>
  )
}

function NewItem({ matterId, onDone }: { matterId: string | null; onDone: (id: string | null) => void }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState('note')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const add = async () => {
    try {
      const r = await engine()!.call('POST', '/api/saved', { matterId, kind, title, content, tags })
      onDone(r.item.id)
    } catch (err) { setError(friendly(err)) }
  }
  return (
    <div className="rounded-card border border-tobacco bg-deep-brown/60 p-4 space-y-2">
      <div className="flex gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input !py-1.5 text-sm w-auto">
          {['note', 'clause', 'template', 'answer'].map((k) => <option key={k} value={k}>{t(`saved.kind.${k}`, k)}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('saved.titleField', 'Title')} className="input flex-1 !py-1.5 text-sm" />
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder={t('saved.textField', 'Text (Markdown works)')} className="input w-full text-sm" />
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('saved.tagsField', 'Tags, separated by commas')} className="input w-full !py-1.5 text-sm" />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!content.trim()} onClick={add} className="btn-primary !py-1.5 text-sm">{t('saved.saveButton', 'Save')}</button>
        <button type="button" onClick={() => onDone(null)} className="btn-secondary !py-1.5 text-sm">{t('common.cancel', 'Cancel')}</button>
      </div>
    </div>
  )
}

function ItemView({ item, onChanged, onDeleted, openChat }: { item: Item; onChanged: () => void; onDeleted: () => void; openChat: () => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState(item.content)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [note, setNote] = useState('')
  const patch = async (p: Record<string, unknown>) => {
    try { await engine()!.call('POST', '/api/saved/update', { id: item.id, patch: p }); onChanged(); return true } catch (err) { setNote(friendly(err)); return false }
  }
  const remove = async () => {
    if (!confirm(t('saved.deleteConfirm', 'Delete “{{title}}”? The documents of the matter stay.', { title: item.title }))) return
    try { await engine()!.call('POST', '/api/saved/delete', { id: item.id }); onDeleted() } catch (err) { setNote(friendly(err)) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(item.content); setNote(t('saved.copied', 'Copied.')) } catch { setNote(t('saved.copyFailed', 'Copying did not work — select the text and copy it by hand.')) } }
  return (
    <div className="rounded-card border border-tobacco bg-leather p-4 space-y-3" data-testid="saved-view">
      <div className="flex items-start justify-between gap-3">
        {editing ? <input value={title} onChange={(e) => setTitle(e.target.value)} className="input flex-1 !py-1.5" /> : <h2 className="font-serif text-xl text-parchment">{item.title}</h2>}
        <div className="flex gap-2 shrink-0 text-antique">
          <button type="button" onClick={() => patch({ favorite: !item.favorite })} title={t('saved.favorite', 'Favourite')} className="hover:text-accent"><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button>
          <button type="button" onClick={copy} title={t('saved.copy', 'Copy the text')} className="hover:text-cream"><Copy size={16} /></button>
          <button type="button" onClick={remove} title={t('saved.delete', 'Delete')} className="hover:text-red-400"><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="text-xs text-antique">{t(`saved.kind.${item.kind}`, item.kind)} · {new Date(item.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}{item.tags.length && !editing ? ` · ${item.tags.map((g) => `#${g}`).join(' ')}` : ''}</div>
      {editing ? (
        <>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14} className="input w-full text-sm" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('saved.tagsField', 'Tags, separated by commas')} className="input w-full !py-1.5 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={async () => { if (await patch({ title, content, tags })) setEditing(false) }} className="btn-primary !py-1.5 text-sm">{t('saved.saveButton', 'Save')}</button>
            <button type="button" onClick={() => { setEditing(false); setTitle(item.title); setContent(item.content); setTags(item.tags.join(', ')) }} className="btn-secondary !py-1.5 text-sm"><X size={14} className="inline" /> {t('common.cancel', 'Cancel')}</button>
          </div>
        </>
      ) : (
        <>
          <div className="prose-custom max-w-none text-sm max-h-[55vh] overflow-y-auto"><ReactMarkdown>{item.content.length > 60000 ? `${item.content.slice(0, 60000)}\n\n…` : item.content}</ReactMarkdown></div>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setEditing(true)} className="underline text-antique hover:text-cream">{t('saved.edit', 'Edit')}</button>
            {item.source?.kind === 'session' && <button type="button" onClick={openChat} className="underline text-antique hover:text-cream inline-flex items-center gap-1"><MessageSquare size={11} /> {t('saved.openChat', 'Open the chat')}</button>}
          </div>
        </>
      )}
      {note && <p className="text-xs text-antique" role="status">{note}</p>}
      <ExportButtons path="/api/saved/export" id={item.id} formats={['docx', 'pdf', 'md']} />
    </div>
  )
}

/** The whole list as CSV (Excel) or one Word document. */
function ExportList({ matterId, q, kind }: { matterId: string | null; q: string; kind: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const run = async (format: string) => {
    setBusy(true)
    try {
      const r = await engine()!.call('POST', '/api/saved/export', { matterId, q, kind: kind || null, format })
      await download(r.name, r.mime, r.data)
    } catch { /* shown by the save dialog */ } finally { setBusy(false) }
  }
  return (
    <span className="flex gap-1 text-xs">
      <button type="button" disabled={busy} onClick={() => run('csv')} className="btn-secondary !px-2.5 !py-1.5 text-xs">{t('saved.listCsv', 'List as CSV')}</button>
      <button type="button" disabled={busy} onClick={() => run('docx')} className="btn-secondary !px-2.5 !py-1.5 text-xs">{t('saved.listWord', 'All as Word')}</button>
    </span>
  )
}
