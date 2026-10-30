// Hub (More tools, for IT and power users): the same engine the Word plugin uses —
// firm library, whole-matter workflows, firm clauses, connectors. Which AI and
// the client-data rule moved to Settings (they were duplicates here).
// Talks to the engine through window.lexvault.engine (main/engine.js IPC).
import { useCallback, useEffect, useState } from 'react'
import { Library, Plug, ListChecks, Link2, BookOpen, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWordLink } from '../lib/hub'
import { SkillsPanel } from './SkillsPanel'

interface Engine {
  call: (method: string, path: string, body?: unknown) => Promise<any>
  stream: (path: string, body: unknown, onEvent: (ev: any) => void) => Promise<unknown>
}
const engine = (): Engine | null => (typeof window !== 'undefined' && (window as any).lexvault?.engine) || null

const card = 'p-5 bg-leather rounded-card border border-tobacco'
const input = 'w-full bg-transparent border border-tobacco rounded px-2 py-1.5 text-cream text-sm'
const btn = 'px-3 py-1.5 rounded bg-accent text-obsidian text-sm disabled:opacity-50'
const ghost = 'px-3 py-1.5 rounded border border-tobacco text-cream text-sm hover:bg-deep-brown'

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-serif text-xl text-parchment mb-3"><Icon size={18} /> {title}</h2>
      {children}
    </section>
  )
}

export default function Hub() {
  const e = engine()
  const { t } = useTranslation()
  const word = useWordLink()
  const [docs, setDocs] = useState<{ name: string; path: string }[]>([])
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [docA, setDocA] = useState('')
  const [docB, setDocB] = useState('')
  const [target, setTarget] = useState('en')
  const [glossary, setGlossary] = useState('')
  const [clauseInfo, setClauseInfo] = useState<any>(null)
  const [clauseType, setClauseType] = useState('')
  const [clauseQuery, setClauseQuery] = useState('')
  const [mcp, setMcp] = useState<any[]>([])
  const [library, setLibrary] = useState<any>(null)
  const [folder, setFolder] = useState('')
  const [matters, setMatters] = useState<any[]>([])
  const [activeMatter, setActiveMatter] = useState('')
  const [wfMsg, setWfMsg] = useState('')
  const [wfFiles, setWfFiles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!e) return
    const [lib, m, mt] = await Promise.all([
      e.call('GET', '/api/library'), e.call('GET', '/api/mcp'), (window as any).lexvault.matters.list(),
    ])
    setLibrary(lib); setMcp(m.servers)
    setMatters(mt.matters); setActiveMatter(mt.active || '')
  }, [e])

  useEffect(() => { refresh().catch((err) => setMsg(String(err.message || err))) }, [refresh])
  useEffect(() => {
    if (!e) return
    e.call('GET', `/api/workflows/documents?matterId=${encodeURIComponent(activeMatter)}`)
      .then((r) => { setDocs(r.documents); setLangs(r.languages); setDocA(r.documents[0]?.path || ''); setDocB(r.documents[1]?.path || '') })
      .catch(() => {})
  }, [e, activeMatter])
  useEffect(() => {
    if (!e) return
    const q = new URLSearchParams({ matterId: activeMatter, type: clauseType, q: clauseQuery })
    const t = setTimeout(() => { e.call('GET', `/api/clauses?${q}`).then(setClauseInfo).catch(() => {}) }, 250)
    return () => clearTimeout(t)
  }, [e, activeMatter, clauseType, clauseQuery])

  if (!e) return <div className="p-8 text-antique">{t('hub.appOnly', 'The OpenLex hub is available in the desktop app.')}</div>

  const addFolder = async (matterOnly: boolean) => {
    setMsg('Indexing…')
    try {
      const r = await e.call('POST', '/api/library/folders', { path: folder, matterId: matterOnly ? activeMatter : '' })
      setMsg(`${r.result.indexed} indexed, ${r.result.removed} removed`); setFolder(''); await refresh()
    } catch (err: any) { setMsg(err.message) }
  }
  const runWorkflow = async (type: 'review' | 'chronology' | 'translate' | 'compare') => {
    if (!activeMatter) { setWfMsg('Pick a matter in the sidebar first.'); return }
    if (type === 'compare' && (!docA || !docB || docA === docB)) { setWfMsg('Pick two different documents.'); return }
    const extra = type === 'translate' ? { file: docA, target, glossary: glossary || undefined } : type === 'compare' ? { fileA: docA, fileB: docB } : {}
    setBusy(true); setWfFiles([]); setWfMsg('Starting…')
    try {
      await e.stream('/api/workflows/run', { type, matterId: activeMatter, ...extra }, (ev) => {
        if (ev.type === 'progress') setWfMsg(ev.step === 'rate' ? `rating ${ev.total} changes…` : ev.index ? `${ev.index}/${ev.total} · ${ev.name}` : ev.name || '…')
        else if (ev.type === 'error') setWfMsg(ev.message)
        else if (ev.type === 'done') {
          const st = ev.stats || {}
          setWfMsg(type === 'translate' ? `${st.translated}/${st.paragraphs} paragraphs translated · ${st.flags} flagged for review`
            : type === 'compare' ? `${st.changes} changes${st.high ? ` · ${st.high} high` : ''}${st.medium ? ` · ${st.medium} medium` : ''}`
            : `${ev.count} ${type === 'review' ? 'verified findings' : 'dated events'} from ${st.documents} documents · ${st.unverified} unverified dropped`)
          setWfFiles(ev.files || [])
        }
      })
    } finally { setBusy(false) }
  }
  const sendToWord = async (text: string) => {
    try { await (window as any).lexvault.hub.sendToWord(text, { source: 'clause library' }); setMsg(word.connected ? 'Sent to Word.' : 'Queued for Word — open the add-in to insert it.') }
    catch (err: any) { setMsg(err.message) }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="font-serif text-3xl text-parchment mb-1">{t('hub.title', 'Hub')}</h1>
        <p className="text-antique text-sm mb-1">{t('hub.intro', 'For IT and power users. Everyday settings are under Settings.')}</p>
        <p className="text-antique text-sm flex items-center gap-2">
          {t('hub.engine', 'One local engine for the app and Word.')} {word.connected ? <span className="flex items-center gap-1 text-forest"><Link2 size={13} /> {t('hub.wordOn', 'Word connected')}</span> : t('hub.wordOff', 'Word not open.')}
        </p>
        {msg && <p className="text-cream text-sm mt-2">{msg}</p>}
      </div>

      <p className="text-sm text-antique">{t('hub.moved', 'Which AI and where client data may go are now under Settings.')}</p>

      <Section icon={Library} title={t('hub.library', 'Firm library')}>
        <p className="text-antique text-sm mb-2">{library?.files || 0} {t('hub.files', 'files')} · {library?.chunks || 0} {t('hub.passages', 'passages indexed locally (.docx, .pdf, .txt, .md)')}</p>
        <ul className="text-sm text-cream mb-2 space-y-1">
          {(library?.folders || []).map((f: any) => (
            <li key={f.path} className="flex items-center gap-2">
              <span className="truncate flex-1" title={f.path}>{f.path}</span>
              <span className="text-xs text-antique">{f.matterId ? (matters.find((m) => m.id === f.matterId)?.title || 'matter') : t('hub.firmWide', 'firm-wide')}</span>
              <button className="text-antique hover:text-accent text-xs" onClick={async () => { await e.call('POST', '/api/library/folders/remove', { path: f.path }); refresh() }}>{t('hub.remove', 'remove')}</button>
            </li>
          ))}
        </ul>
        <input className={input} placeholder={t('hub.folder', 'Folder path, e.g. ~/Documents/Precedents')} value={folder} onChange={(ev) => setFolder(ev.target.value)} />
        <div className="flex gap-2 mt-2">
          <button className={btn} disabled={!folder} onClick={() => addFolder(false)}>{t('hub.addFirm', 'Add firm-wide')}</button>
          <button className={ghost} disabled={!folder || !activeMatter} onClick={() => addFolder(true)}>{t('hub.addMatter', 'Add to current matter')}</button>
        </div>
      </Section>

      <Section icon={ListChecks} title={t('hub.whole', 'Whole matter')}>
        <p className="text-antique text-sm mb-2">{t('hub.wholeText', "Runs over the active matter's library folders. Every finding must quote its source verbatim.")}</p>
        <div className="flex gap-2">
          <button className={btn} disabled={busy} onClick={() => runWorkflow('review')}>{t('hub.review', 'Review documents')}</button>
          <button className={ghost} disabled={busy} onClick={() => runWorkflow('chronology')}>{t('hub.chrono', 'Build chronology')}</button>
        </div>
        <div className="mt-4 grid gap-2">
          <p className="flex items-center gap-2 text-parchment text-sm"><Languages size={14} /> {t('hub.translateCompare', 'Translate or compare documents')}</p>
          <select className={input} value={docA} onChange={(ev) => setDocA(ev.target.value)}>
            {docs.length === 0 && <option value="">{t('hub.noDocs', "— no documents in this matter's folders —")}</option>}
            {docs.map((d) => <option key={d.path} value={d.path}>{d.name}</option>)}
          </select>
          <div className="flex gap-2">
            <select className={input} value={target} onChange={(ev) => setTarget(ev.target.value)}>
              {Object.entries(langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            <input className={input} placeholder={t('hub.glossary', 'glossary (optional)')} value={glossary} onChange={(ev) => setGlossary(ev.target.value)} />
            <button className={ghost} disabled={busy || !docA} onClick={() => runWorkflow('translate')}>{t('hub.translate', 'Translate')}</button>
          </div>
          <div className="flex gap-2">
            <select className={input} value={docB} onChange={(ev) => setDocB(ev.target.value)}>
              {docs.map((d) => <option key={d.path} value={d.path}>{d.name}</option>)}
            </select>
            <button className={ghost} disabled={busy || !docA || !docB} onClick={() => runWorkflow('compare')}>{t('hub.compare', 'Compare versions')}</button>
          </div>
        </div>
        {wfMsg && <p className="text-cream text-sm mt-2">{wfMsg}</p>}
        {wfFiles.map((f) => <p key={f} className="text-antique text-xs break-all">{f}</p>)}
      </Section>

      <SkillsPanel e={e} activeMatter={activeMatter} docs={docs} />

      <Section icon={BookOpen} title={t('hub.clauses', 'Firm clauses')}>
        <p className="text-antique text-sm mb-2">{t('hub.clausesText', "Your firm's own wording from the precedents in the firm library — most used first. Send one to the cursor in Word.")}</p>
        <div className="flex gap-2">
          <select className={input} value={clauseType} onChange={(ev) => setClauseType(ev.target.value)}>
            <option value="">{t('hub.clauseType', 'Clause type…')}</option>
            {(clauseInfo?.types || []).filter((t: any) => t.count).map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.count})</option>)}
          </select>
          <input className={input} placeholder={t('hub.words', 'words…')} value={clauseQuery} onChange={(ev) => setClauseQuery(ev.target.value)} />
        </div>
        <div className="mt-2 space-y-2">
          {(clauseInfo?.clauses || []).map((c: any) => (
            <details key={c.heading + c.documents.join()} className="border border-tobacco rounded p-2">
              <summary className="text-cream text-sm cursor-pointer">{c.heading} <span className="text-antique text-xs">· {c.uses} doc{c.uses === 1 ? '' : 's'}: {c.documents.slice(0, 3).join(', ')}</span></summary>
              <p className="text-antique text-sm whitespace-pre-wrap mt-2">{c.text}</p>
              <button className={`${ghost} mt-2`} onClick={() => sendToWord(c.text)}>{t('hub.insert', 'Insert in Word')}</button>
            </details>
          ))}
        </div>
      </Section>

      <Section icon={Plug} title={t('hub.connectors', 'Connectors')}>
        <ul className="text-sm text-cream space-y-1">
          {mcp.length === 0 && <li className="text-antique">{t('hub.noConnectors', "No connectors. Add MCP servers in Word's Settings → Connectors, or in ~/.lexvault/mcp-servers.json.")}</li>}
          {mcp.map((s) => <li key={s.name}>{s.name} — {s.connected ? `${s.tools.length} tools` : s.error || 'not connected'} <span className="text-xs text-antique">({s.remote ? 'external' : 'local'})</span></li>)}
        </ul>
      </Section>
    </div>
  )
}
