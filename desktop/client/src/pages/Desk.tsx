// Matter desk (Phases 7.4 + 7.5): the matter's lists (checklists and
// trackers with an audit trail) and monitors (watches on official sources
// with an alert feed). Both live in the shared OpenLex engine.
import { useCallback, useEffect, useState } from 'react'
import { ListTodo, Radar, Plus, Download, RefreshCw, Trash2, FileDown, History } from 'lucide-react'

interface Engine { call: (method: string, path: string, body?: unknown) => Promise<any> }
const engine = (): Engine | null => (typeof window !== 'undefined' && (window as any).lexvault?.engine) || null

const card = 'p-4 bg-leather rounded-card border border-tobacco'
const input = 'w-full bg-transparent border border-tobacco rounded px-2 py-1.5 text-cream text-sm'
const small = 'bg-transparent border border-tobacco rounded px-1.5 py-1 text-cream text-xs'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-obsidian text-sm disabled:opacity-50'
const ghost = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-tobacco text-cream text-sm hover:bg-deep-brown disabled:opacity-50'
const today = () => new Date().toISOString().slice(0, 10)

export default function Desk() {
  const e = engine()
  const [matter, setMatter] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { (window as any).lexvault?.matters?.list().then((mt: any) => setMatter(mt.active || '')).catch(() => {}) }, [])
  if (!e) return <div className="p-8 text-antique">The matter desk is available in the desktop app.</div>
  return (
    <div className="p-6 grid gap-4 xl:grid-cols-2 items-start">
      {msg && <p className="text-sm text-antique xl:col-span-2">{msg}</p>}
      <Lists e={e} matter={matter} setMsg={setMsg} />
      <Monitors e={e} matter={matter} setMsg={setMsg} />
    </div>
  )
}

function Lists({ e, matter, setMsg }: { e: Engine; matter: string; setMsg: (m: string) => void }) {
  const [lists, setLists] = useState<any[]>([])
  const [list, setList] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState('')
  const [sources, setSources] = useState<any[]>([])
  const [showAudit, setShowAudit] = useState(false)

  const load = useCallback(async () => {
    setLists((await e.call('GET', `/api/lists?matterId=${encodeURIComponent(matter)}`)).lists)
    setSources((await e.call('GET', `/api/lists/sources?matterId=${encodeURIComponent(matter)}`)).sources)
  }, [e, matter])
  useEffect(() => { load().catch((err) => setMsg(err.message)) }, [load, setMsg])
  const open = async (id: string) => setList((await e.call('GET', `/api/lists/get?id=${encodeURIComponent(id)}`)).list)
  const act = async (fn: () => Promise<any>) => { try { await fn(); if (list) await open(list.id); await load() } catch (err: any) { setMsg(err.message) } }

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-serif text-xl text-parchment mb-2"><ListTodo size={18} /> Lists</h2>
      <div className="flex gap-2 mb-2">
        <input className={input} placeholder="New list, e.g. Closing checklist" value={title} onChange={(ev) => setTitle(ev.target.value)} />
        <button className={btn} disabled={!title.trim()} onClick={() => act(async () => { const r = await e.call('POST', '/api/lists', { matterId: matter || null, title }); setTitle(''); setList(r.list) })}><Plus size={14} /> Create</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {lists.map((l) => (
          <button key={l.id} onClick={() => open(l.id)} className={`px-2 py-1 rounded text-xs border border-tobacco ${list?.id === l.id ? 'bg-deep-brown text-parchment' : 'text-cream'}`}>
            {l.title} · {l.open} open{l.overdue ? <span className="text-red-400"> · {l.overdue} overdue</span> : ''}
          </button>
        ))}
        {!lists.length && <span className="text-xs text-antique">No lists for this matter.</span>}
      </div>
      {list && (
        <>
          <table className="w-full text-sm">
            <thead><tr className="text-antique text-xs text-left"><th className="py-1">Item</th><th>Owner</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.items.map((i: any) => {
                const late = i.due && i.due < today() && (i.status === 'open' || i.status === 'blocked')
                return (
                  <tr key={i.id} className="border-t border-tobacco align-top">
                    <td className="py-1.5 pr-2 text-cream">
                      <span className={i.status === 'done' || i.status === 'n/a' ? 'line-through text-antique' : ''}>{i.text}</span>
                      {i.source?.quote && <div className="text-xs text-antique italic" title={i.source.document}>“{String(i.source.quote).slice(0, 120)}” — {i.source.document}</div>}
                    </td>
                    <td><input className={small + ' w-20'} defaultValue={i.owner} onBlur={(ev) => ev.target.value !== i.owner && act(() => e.call('POST', '/api/lists/items/update', { id: list.id, itemId: i.id, patch: { owner: ev.target.value } }))} /></td>
                    <td><input type="date" className={small + (late ? ' text-red-400' : '')} defaultValue={i.due || ''} onBlur={(ev) => (ev.target.value || null) !== i.due && act(() => e.call('POST', '/api/lists/items/update', { id: list.id, itemId: i.id, patch: { due: ev.target.value || null } }))} /></td>
                    <td>
                      <select className={small} value={i.status} onChange={(ev) => act(() => e.call('POST', '/api/lists/items/update', { id: list.id, itemId: i.id, patch: { status: ev.target.value } }))}>
                        {['open', 'done', 'blocked', 'n/a'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td><button className="text-antique hover:text-accent" onClick={() => act(() => e.call('POST', '/api/lists/items/delete', { id: list.id, itemId: i.id }))}><Trash2 size={13} /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex gap-2 mt-2">
            <input className={input} placeholder="New item" value={text} onChange={(ev) => setText(ev.target.value)} />
            <input className={input + ' max-w-[7rem]'} placeholder="Owner" value={owner} onChange={(ev) => setOwner(ev.target.value)} />
            <input type="date" className={input + ' max-w-[10rem]'} value={due} onChange={(ev) => setDue(ev.target.value)} />
            <button className={ghost} disabled={!text.trim()} onClick={() => act(async () => { await e.call('POST', '/api/lists/items', { id: list.id, item: { text, owner, due: due || null } }); setText(''); setDue(''); setOwner('') })}><Plus size={14} /></button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 items-center">
            {sources.length > 0 && (
              <select className={small} defaultValue="" onChange={(ev) => { const f = ev.target.value; ev.target.value = ''; if (f) act(async () => { const r = await e.call('POST', '/api/lists/seed', { id: list.id, file: f }); setMsg(`${r.added} items added from ${f.split('/').pop()}`) }) }}>
                <option value="">Add from a workflow result…</option>
                {sources.map((s) => <option key={s.file} value={s.file}>{s.kind}: {s.name}</option>)}
              </select>
            )}
            <button className={ghost} onClick={() => act(async () => { const r = await e.call('POST', '/api/lists/export', { id: list.id }); setMsg(`Saved: ${r.files.join(' · ')}`) })}><Download size={14} /> Excel + calendar</button>
            <button className={ghost} onClick={() => setShowAudit(!showAudit)}><History size={14} /> Audit trail</button>
          </div>
          {showAudit && (
            <ul className="mt-2 text-xs text-antique max-h-48 overflow-auto space-y-0.5">
              {[...list.audit].reverse().map((a: any, k: number) => <li key={k}>{a.at.slice(0, 16).replace('T', ' ')} · {a.by} · {a.action}{a.field ? ` ${a.field}: ${a.from ?? '—'} → ${a.to ?? '—'}` : a.text ? ` "${a.text}"` : ''}</li>)}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Monitors({ e, matter, setMsg }: { e: Engine; matter: string; setMsg: (m: string) => void }) {
  const [monitors, setMonitors] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [form, setForm] = useState({ title: '', type: 'eurlex', query: '', url: '', topics: '', everyHours: 24 })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setMonitors((await e.call('GET', `/api/monitors?matterId=${encodeURIComponent(matter)}`)).monitors)
    setAlerts((await e.call('GET', `/api/monitors/alerts?matterId=${encodeURIComponent(matter)}`)).alerts)
  }, [e, matter])
  useEffect(() => { load().catch((err) => setMsg(err.message)) }, [load, setMsg])

  const create = async () => {
    try {
      const source = form.type === 'eurlex' || form.type === 'ris' ? { type: form.type, query: form.query } : { type: form.type, url: form.url }
      await e.call('POST', '/api/monitors', { title: form.title, matterId: matter || null, source, topics: form.topics, everyHours: Number(form.everyHours) })
      setForm({ ...form, title: '', query: '', url: '', topics: '' })
      setMsg('Monitor added. Its first check sets the baseline; you get alerts for what appears after today.')
      await load()
    } catch (err: any) { setMsg(err.message) }
  }
  const check = async (id?: string) => {
    setBusy(true)
    try { const r = await e.call('POST', '/api/monitors/check', id ? { id } : {}); setMsg(id ? (r.error ? `Check failed: ${r.error}` : `${r.checked} items checked, ${r.alerts.length} new alerts`) : 'Checked all due monitors.'); await load() } catch (err: any) { setMsg(err.message) }
    setBusy(false)
  }
  const unread = alerts.filter((a) => !a.read).length

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-serif text-xl text-parchment mb-1"><Radar size={18} /> Monitors {unread > 0 && <span className="text-xs bg-accent text-obsidian rounded px-1.5">{unread} new</span>}</h2>
      <p className="text-antique text-xs mb-2">Watch official sources: new EU acts (EUR-Lex), the Austrian federal gazette (RIS), any RSS/Atom feed, or changes on a public page. Needs "Web access" allowed in the data policy; only the monitor's own query or URL leaves the machine.</p>
      <div className="grid gap-2 mb-3">
        <div className="flex gap-2">
          <select className={input + ' max-w-[9rem]'} value={form.type} onChange={(ev) => setForm({ ...form, type: ev.target.value })}>
            <option value="eurlex">EUR-Lex</option><option value="ris">RIS (BGBl)</option><option value="rss">RSS / Atom</option><option value="page">Web page</option>
          </select>
          {form.type === 'eurlex' || form.type === 'ris'
            ? <input className={input} placeholder="Title words, e.g. artificial intelligence / Datenschutz" value={form.query} onChange={(ev) => setForm({ ...form, query: ev.target.value })} />
            : <input className={input} placeholder="https://…" value={form.url} onChange={(ev) => setForm({ ...form, url: ev.target.value })} />}
        </div>
        <div className="flex gap-2">
          <input className={input} placeholder="Name" value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} />
          <input className={input} placeholder="Only if about… (topics, comma-separated)" value={form.topics} onChange={(ev) => setForm({ ...form, topics: ev.target.value })} />
          <select className={input + ' max-w-[7rem]'} value={form.everyHours} onChange={(ev) => setForm({ ...form, everyHours: Number(ev.target.value) })}>
            <option value={6}>6 h</option><option value={24}>daily</option><option value={168}>weekly</option>
          </select>
          <button className={btn} disabled={!(form.query || form.url)} onClick={create}><Plus size={14} /></button>
        </div>
      </div>
      <ul className="text-sm space-y-1 mb-3">
        {monitors.map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <span className="text-cream flex-1 truncate">{m.title} <span className="text-xs text-antique">· {m.source.type} · every {m.everyHours} h{m.lastRun ? ` · checked ${m.lastRun.slice(0, 16).replace('T', ' ')}` : ' · not checked yet'}</span>{m.lastError && <span className="block text-xs text-red-400">{m.lastError}</span>}</span>
            <button className="text-antique hover:text-accent" title="Check now" disabled={busy} onClick={() => check(m.id)}><RefreshCw size={13} /></button>
            <button className="text-antique hover:text-accent" title="Delete" onClick={async () => { await e.call('POST', '/api/monitors/delete', { id: m.id }); load() }}><Trash2 size={13} /></button>
          </li>
        ))}
        {!monitors.length && <li className="text-xs text-antique">No monitors for this matter.</li>}
      </ul>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-parchment text-sm mr-auto">Alerts</p>
        {unread > 0 && <button className="text-xs text-antique hover:text-accent" onClick={async () => { await e.call('POST', '/api/monitors/alerts/read', { ids: alerts.filter((a) => !a.read).map((a) => a.id) }); load() }}>mark all read</button>}
      </div>
      <ul className="space-y-2 max-h-96 overflow-auto">
        {alerts.map((a) => (
          <li key={a.id} className={`border border-tobacco rounded p-2 ${a.read ? 'opacity-70' : ''}`}>
            <div className="text-sm text-cream">{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="hover:text-accent">{a.title}</a> : a.title}</div>
            <div className="text-xs text-antique">{a.date || a.at.slice(0, 10)} · {a.monitor}{a.relevance != null ? ` · relevance ${Math.round(a.relevance * 100)}%` : ''}</div>
            {a.summary && <div className="text-xs text-cream mt-1">{a.summary}</div>}
            {a.text && !a.summary && <div className="text-xs text-antique mt-1 line-clamp-2">{a.text}</div>}
            <button className="text-xs text-antique hover:text-accent mt-1 inline-flex items-center gap-1" onClick={async () => { try { const r = await e.call('POST', '/api/monitors/alerts/file', { id: a.id }); await e.call('POST', '/api/monitors/alerts/read', { ids: [a.id] }); setMsg(`Filed: ${r.file}`); load() } catch (err: any) { setMsg(err.message) } }}><FileDown size={12} /> File into the matter</button>
          </li>
        ))}
        {!alerts.length && <li className="text-xs text-antique">No alerts yet.</li>}
      </ul>
    </section>
  )
}
