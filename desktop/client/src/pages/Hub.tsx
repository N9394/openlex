// OpenLex hub page (desktop App): the same engine the Word plugin uses —
// model + data policy, firm library, connectors, whole-matter workflows.
// Talks to the engine through window.lexvault.engine (main/engine.js IPC).
import { useCallback, useEffect, useState } from 'react'
import { Cpu, Shield, Library, Plug, ListChecks, Lock, Cloud, Link2, BookOpen, Languages } from 'lucide-react'
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
  const word = useWordLink()
  const [providers, setProviders] = useState<any[]>([])
  const [active, setActive] = useState('local')
  const [sel, setSel] = useState('local')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [region, setRegion] = useState('')
  const [project, setProject] = useState('')
  const [docs, setDocs] = useState<{ name: string; path: string }[]>([])
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [docA, setDocA] = useState('')
  const [docB, setDocB] = useState('')
  const [target, setTarget] = useState('en')
  const [glossary, setGlossary] = useState('')
  const [clauseInfo, setClauseInfo] = useState<any>(null)
  const [clauseType, setClauseType] = useState('')
  const [clauseQuery, setClauseQuery] = useState('')
  const [policy, setPolicy] = useState<any>(null)
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
    const [pv, pol, lib, m, mt] = await Promise.all([
      e.call('GET', '/api/providers'), e.call('GET', '/api/policy'), e.call('GET', '/api/library'),
      e.call('GET', '/api/mcp'), (window as any).lexvault.matters.list(),
    ])
    setProviders(pv.providers); setActive(pv.active); setPolicy(pol); setLibrary(lib); setMcp(m.servers)
    setMatters(mt.matters); setActiveMatter(mt.active || '')
  }, [e])

  useEffect(() => { refresh().catch((err) => setMsg(String(err.message || err))) }, [refresh])
  useEffect(() => {
    const p = providers.find((x) => x.id === sel)
    setModel(p?.model || ''); setBaseUrl(p?.baseUrl || ''); setKey(''); setRegion(p?.region || ''); setProject(p?.project || '')
  }, [sel, providers])
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
  useEffect(() => { setSel(active) }, [active])

  if (!e) return <div className="p-8 text-antique">The OpenLex hub is available in the desktop app.</div>

  const current = providers.find((p) => p.id === sel)
  const saveProvider = async () => {
    try {
      if (key.trim()) await e.call('POST', '/api/providers/key', { provider: sel, key: key.trim() })
      const overrides: any = {}
      if (current?.kind !== 'local') {
        overrides.model = model || null
        if (sel === 'azure' || sel === 'custom') overrides.baseUrl = baseUrl || null
        if (sel === 'bedrock' || sel === 'vertex' || sel === 'azure') overrides.region = region || null
        if (sel === 'vertex') overrides.project = project || null
      }
      await e.call('POST', '/api/providers', { active: sel, provider: sel, overrides })
      setMsg(`Using ${current?.label}.`)
      await refresh()
    } catch (err: any) { setMsg(err.message) }
  }
  const test = async () => {
    const r = await e.call('POST', '/api/providers/test', { provider: sel })
    setMsg(r.ok ? `OK — ${r.sample || 'reachable'}` : `Failed: ${r.error}`)
  }
  const targets = [
    ...providers.filter((p) => !p.local).map((p) => ({ id: p.id, label: p.label })),
    { id: 'web', label: 'Web access (RIS, public pages)' },
    ...mcp.filter((s) => s.remote).map((s) => ({ id: `mcp:${s.name}`, label: `Connector: ${s.name}` })),
  ]
  const rule = policy?.default || { mode: 'local-only' }
  const setRule = async (next: any) => { await e.call('POST', '/api/policy', { rule: next }); await refresh() }
  const toggle = (id: string, on: boolean) => {
    const list = new Set(rule.providers || [])
    on ? list.add(id) : list.delete(id)
    setRule({ ...rule, mode: 'allow-list', providers: [...list] })
  }
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
        <h1 className="font-serif text-3xl text-parchment mb-1">OpenLex hub</h1>
        <p className="text-antique text-sm flex items-center gap-2">
          One local engine for the app and Word. {word.connected ? <span className="flex items-center gap-1 text-forest"><Link2 size={13} /> Word connected</span> : 'Word not open.'}
        </p>
        {msg && <p className="text-cream text-sm mt-2">{msg}</p>}
      </div>

      <Section icon={Cpu} title="Model">
        <div className="grid gap-2">
          <select className={input} value={sel} onChange={(ev) => setSel(ev.target.value)}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.id === active ? ' — active' : ''}{p.local ? '' : ' ☁'}</option>)}
          </select>
          {current && current.kind !== 'local' && (
            <>
              <input className={input} placeholder="Model" value={model} onChange={(ev) => setModel(ev.target.value)} />
              {(sel === 'azure' || sel === 'custom') && <input className={input} placeholder="Endpoint URL" value={baseUrl} onChange={(ev) => setBaseUrl(ev.target.value)} />}
              {(sel === 'bedrock' || sel === 'vertex' || sel === 'azure') && (
                <div className="flex gap-2">
                  <input className={input} placeholder={sel === 'vertex' ? 'Region, e.g. europe-west1' : sel === 'azure' ? 'Region, e.g. swedencentral' : 'Region, e.g. eu-central-1'} value={region} onChange={(ev) => setRegion(ev.target.value)} />
                  {sel === 'vertex' && <input className={input} placeholder="GCP project id" value={project} onChange={(ev) => setProject(ev.target.value)} />}
                </div>
              )}
              {sel === 'vertex' && !current.needsKey && <input className={input} type="password" placeholder="Service-account JSON (optional — empty uses your gcloud login)" value={key} onChange={(ev) => setKey(ev.target.value)} />}
              {current.needsKey && <input className={input} type="password" placeholder={`API key ${current.hasKey ? '(saved ✓ — paste to replace)' : '— stored in the OS keychain'}`} value={key} onChange={(ev) => setKey(ev.target.value)} />}
            </>
          )}
          <div className="flex gap-2"><button className={btn} onClick={saveProvider}>Save &amp; use</button><button className={ghost} onClick={test}>Test</button></div>
        </div>
      </Section>

      <Section icon={Shield} title="Data policy">
        <label className="flex items-center gap-2 text-cream text-sm"><input type="radio" checked={rule.mode === 'local-only'} onChange={() => setRule({ mode: 'local-only' })} /> <Lock size={13} /> Local only — client data never leaves this machine</label>
        <label className="flex items-center gap-2 text-cream text-sm mt-1"><input type="radio" checked={rule.mode === 'allow-list'} onChange={() => setRule({ mode: 'allow-list', providers: rule.providers || [] })} /> <Cloud size={13} /> Allow:</label>
        <div className="ml-6 mt-1 grid gap-1">
          {targets.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-antique text-sm">
              <input type="checkbox" disabled={rule.mode !== 'allow-list'} checked={rule.mode === 'allow-list' && (rule.providers || []).includes(t.id)} onChange={(ev) => toggle(t.id, ev.target.checked)} /> {t.label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-cream text-sm mt-2">
          <input type="checkbox" disabled={rule.mode !== 'allow-list'} checked={!!rule.redact} onChange={(ev) => setRule({ ...rule, redact: ev.target.checked })} />
          Hide names &amp; identifiers from cloud models (client, listed names, e-mails, IBANs, phone numbers)
        </label>
        <label className="flex items-center gap-2 text-cream text-sm mt-1">
          <input type="checkbox" disabled={rule.mode !== 'allow-list'} checked={(rule.regions || []).includes('eu')} onChange={(ev) => setRule({ ...rule, regions: ev.target.checked ? ['eu'] : undefined })} />
          Only EU regions (Bedrock eu-*, Vertex europe-*, Mistral, Azure in the EU)
        </label>
        <p className="text-antique text-xs mt-2">Privileged matters always stay local. Audit log: {policy?.auditLog}</p>
      </Section>

      <Section icon={Library} title="Firm library">
        <p className="text-antique text-sm mb-2">{library?.files || 0} files · {library?.chunks || 0} passages indexed locally (.docx, .pdf, .txt, .md)</p>
        <ul className="text-sm text-cream mb-2 space-y-1">
          {(library?.folders || []).map((f: any) => (
            <li key={f.path} className="flex items-center gap-2">
              <span className="truncate flex-1" title={f.path}>{f.path}</span>
              <span className="text-xs text-antique">{f.matterId ? (matters.find((m) => m.id === f.matterId)?.title || 'matter') : 'firm-wide'}</span>
              <button className="text-antique hover:text-accent text-xs" onClick={async () => { await e.call('POST', '/api/library/folders/remove', { path: f.path }); refresh() }}>remove</button>
            </li>
          ))}
        </ul>
        <input className={input} placeholder="Folder path, e.g. ~/Documents/Precedents" value={folder} onChange={(ev) => setFolder(ev.target.value)} />
        <div className="flex gap-2 mt-2">
          <button className={btn} disabled={!folder} onClick={() => addFolder(false)}>Add firm-wide</button>
          <button className={ghost} disabled={!folder || !activeMatter} onClick={() => addFolder(true)}>Add to current matter</button>
        </div>
      </Section>

      <Section icon={ListChecks} title="Whole matter">
        <p className="text-antique text-sm mb-2">Runs over the active matter's library folders. Every finding must quote its source verbatim.</p>
        <div className="flex gap-2">
          <button className={btn} disabled={busy} onClick={() => runWorkflow('review')}>Review documents</button>
          <button className={ghost} disabled={busy} onClick={() => runWorkflow('chronology')}>Build chronology</button>
        </div>
        <div className="mt-4 grid gap-2">
          <p className="flex items-center gap-2 text-parchment text-sm"><Languages size={14} /> Translate or compare documents</p>
          <select className={input} value={docA} onChange={(ev) => setDocA(ev.target.value)}>
            {docs.length === 0 && <option value="">— no documents in this matter's folders —</option>}
            {docs.map((d) => <option key={d.path} value={d.path}>{d.name}</option>)}
          </select>
          <div className="flex gap-2">
            <select className={input} value={target} onChange={(ev) => setTarget(ev.target.value)}>
              {Object.entries(langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            <input className={input} placeholder="glossary (optional)" value={glossary} onChange={(ev) => setGlossary(ev.target.value)} />
            <button className={ghost} disabled={busy || !docA} onClick={() => runWorkflow('translate')}>Translate</button>
          </div>
          <div className="flex gap-2">
            <select className={input} value={docB} onChange={(ev) => setDocB(ev.target.value)}>
              {docs.map((d) => <option key={d.path} value={d.path}>{d.name}</option>)}
            </select>
            <button className={ghost} disabled={busy || !docA || !docB} onClick={() => runWorkflow('compare')}>Compare versions</button>
          </div>
        </div>
        {wfMsg && <p className="text-cream text-sm mt-2">{wfMsg}</p>}
        {wfFiles.map((f) => <p key={f} className="text-antique text-xs break-all">{f}</p>)}
      </Section>

      <SkillsPanel e={e} activeMatter={activeMatter} docs={docs} />

      <Section icon={BookOpen} title="Firm clauses">
        <p className="text-antique text-sm mb-2">Your firm's own wording from the precedents in the firm library — most used first. Send one to the cursor in Word.</p>
        <div className="flex gap-2">
          <select className={input} value={clauseType} onChange={(ev) => setClauseType(ev.target.value)}>
            <option value="">Clause type…</option>
            {(clauseInfo?.types || []).filter((t: any) => t.count).map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.count})</option>)}
          </select>
          <input className={input} placeholder="words…" value={clauseQuery} onChange={(ev) => setClauseQuery(ev.target.value)} />
        </div>
        <div className="mt-2 space-y-2">
          {(clauseInfo?.clauses || []).map((c: any) => (
            <details key={c.heading + c.documents.join()} className="border border-tobacco rounded p-2">
              <summary className="text-cream text-sm cursor-pointer">{c.heading} <span className="text-antique text-xs">· {c.uses} doc{c.uses === 1 ? '' : 's'}: {c.documents.slice(0, 3).join(', ')}</span></summary>
              <p className="text-antique text-sm whitespace-pre-wrap mt-2">{c.text}</p>
              <button className={`${ghost} mt-2`} onClick={() => sendToWord(c.text)}>Insert in Word</button>
            </details>
          ))}
        </div>
      </Section>

      <Section icon={Plug} title="Connectors">
        <ul className="text-sm text-cream space-y-1">
          {mcp.length === 0 && <li className="text-antique">No connectors. Add MCP servers in Word's Settings → Connectors, or in ~/.lexvault/mcp-servers.json.</li>}
          {mcp.map((s) => <li key={s.name}>{s.name} — {s.connected ? `${s.tools.length} tools` : s.error || 'not connected'} <span className="text-xs text-antique">({s.remote ? 'external' : 'local'})</span></li>)}
        </ul>
      </Section>
    </div>
  )
}
