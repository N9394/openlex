// Review grid (Phase 7.1): rows are the matter's documents, columns are
// questions, every cell an answer with a verbatim quote from its document.
// Runs in the shared OpenLex engine (sidecar/src/grid.js) under the
// matter's data policy; the same grids are reachable from the CLI and API.
import { useCallback, useEffect, useState } from 'react'
import { Table2, Play, RotateCcw, Download, Plus, Trash2, Lock, Unlock, X } from 'lucide-react'

interface Engine {
  call: (method: string, path: string, body?: unknown) => Promise<any>
  stream: (path: string, body: unknown, onEvent: (ev: any) => void) => Promise<unknown>
}
const engine = (): Engine | null => (typeof window !== 'undefined' && (window as any).lexvault?.engine) || null

type ColType = 'text' | 'yesno' | 'choice' | 'date' | 'number'
interface Column { id?: string; label: string; prompt: string; type: ColType; options?: string[]; dependsOn?: string[] }
interface Cell { value: string; quote: string; location: string; status: string; locked?: boolean; note?: string }
interface View { id: string; title: string; columns: Column[]; rows: { document: string; name: string; cells: (Cell | null)[] }[] }

const card = 'p-4 bg-leather rounded-card border border-tobacco'
const input = 'w-full bg-transparent border border-tobacco rounded px-2 py-1.5 text-cream text-sm'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-obsidian text-sm disabled:opacity-50'
const ghost = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-tobacco text-cream text-sm hover:bg-deep-brown disabled:opacity-50'

const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: '', cls: 'text-cream' },
  edited: { label: 'edited', cls: 'text-cream' },
  unverified: { label: 'quote not found', cls: 'text-amber-400' },
  invalid: { label: 'check', cls: 'text-amber-400' },
  not_found: { label: '—', cls: 'text-antique' },
  error: { label: 'error', cls: 'text-red-400' },
}

// Starter column sets; firms edit them or build their own.
const PRESETS: Record<string, { title: string; columns: Column[] }> = {
  nda: {
    title: 'NDA review',
    columns: [
      { label: 'Parties', prompt: 'Who are the parties?', type: 'text' },
      { label: 'Mutual', prompt: 'Are the confidentiality obligations mutual?', type: 'yesno' },
      { label: 'Term', prompt: 'How long do the confidentiality obligations last?', type: 'text' },
      { label: 'Governing law', prompt: 'Which law governs the agreement?', type: 'text' },
      { label: 'Non-solicit', prompt: 'Is there a non-solicitation obligation?', type: 'yesno' },
    ],
  },
  dd: {
    title: 'Contract due diligence',
    columns: [
      { label: 'Contract type', prompt: 'What kind of contract is this?', type: 'choice', options: ['Supply', 'Services', 'License', 'Lease', 'Employment', 'Loan', 'Other'] },
      { label: 'Signed', prompt: 'When was the contract signed?', type: 'date' },
      { label: 'Change of control', prompt: 'Does a change of control of a party trigger consent, termination or other rights?', type: 'yesno' },
      { label: 'CoC consequence', prompt: 'What exactly happens on a change of control?', type: 'text', dependsOn: ['change_of_control'] },
      { label: 'Assignment', prompt: 'Can the contract be assigned, and is consent required?', type: 'text' },
      { label: 'Liability cap', prompt: 'What is the liability cap (amount)?', type: 'number' },
      { label: 'Termination', prompt: 'Can a party terminate for convenience? With what notice?', type: 'text' },
      { label: 'Exclusivity', prompt: 'Are there exclusivity or non-compete obligations?', type: 'yesno' },
    ],
  },
  lease: {
    title: 'Lease review',
    columns: [
      { label: 'Premises', prompt: 'Which premises are leased?', type: 'text' },
      { label: 'Start', prompt: 'When does the lease start?', type: 'date' },
      { label: 'Fixed term', prompt: 'Is the lease for a fixed term?', type: 'yesno' },
      { label: 'Rent', prompt: 'What is the monthly rent?', type: 'number' },
      { label: 'Indexation', prompt: 'Is the rent indexed, and to which index?', type: 'text' },
      { label: 'Break option', prompt: 'Can the tenant terminate early? Notice?', type: 'text' },
    ],
  },
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

export default function Grid() {
  const e = engine()
  const [matter, setMatter] = useState('')
  const [grids, setGrids] = useState<any[]>([])
  const [view, setView] = useState<View | null>(null)
  const [title, setTitle] = useState('')
  const [cols, setCols] = useState<Column[]>([])
  const [editing, setEditing] = useState(false)
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const loadList = useCallback(async () => {
    if (!e) return
    const mt = await (window as any).lexvault.matters.list()
    const m = mt.active || ''
    setMatter(m)
    const r = await e.call('GET', `/api/grids?matterId=${encodeURIComponent(m)}`)
    setGrids(r.grids)
  }, [e])
  useEffect(() => { loadList().catch((err) => setMsg(String(err.message || err))) }, [loadList])

  const open = async (id: string) => {
    if (!e) return
    setSel(null); setEditing(false)
    setView(await e.call('GET', `/api/grids/view?id=${encodeURIComponent(id)}`))
  }

  if (!e) return <div className="p-8 text-antique">The review grid is available in the desktop app.</div>

  const startNew = (preset?: string) => {
    const p = preset ? PRESETS[preset] : null
    setView(null); setSel(null); setEditing(true)
    setTitle(p?.title || 'Review grid')
    setCols(p ? p.columns.map((c) => ({ ...c, id: slug(c.label) })) : [{ label: '', prompt: '', type: 'text' }])
  }
  const editColumns = () => {
    if (!view) return
    setTitle(view.title); setCols(view.columns.map((c) => ({ ...c }))); setEditing(true)
  }
  const saveColumns = async () => {
    const clean = cols.filter((c) => c.prompt.trim() || c.label.trim()).map((c) => ({ ...c, id: c.id || slug(c.label || c.prompt) }))
    try {
      if (view) {
        const v = await e.call('POST', '/api/grids/update', { id: view.id, patch: { title, columns: clean } })
        setView(v)
      } else {
        if (!matter) { setMsg('Pick a matter in the sidebar first: the grid uses its documents.'); return }
        const v = await e.call('POST', '/api/grids', { matterId: matter, title, columns: clean })
        setView(v)
        setMsg(`${v.rows.length} documents from the matter folders. Press Run to fill the grid.`)
      }
      setEditing(false)
      await loadList()
    } catch (err: any) { setMsg(err.message) }
  }

  const run = async (force = false) => {
    if (!view) return
    setBusy(true); setMsg('Starting…')
    try {
      await e.stream('/api/grids/run', { id: view.id, force }, (ev) => {
        if (ev.type === 'progress' && ev.step === 'cell') {
          setView((v) => {
            if (!v) return v
            const r = v.rows.findIndex((x) => x.name === ev.document)
            const c = v.columns.findIndex((x) => x.id === ev.column)
            if (r < 0 || c < 0) return v
            const rows = v.rows.map((row, i) => (i !== r ? row : { ...row, cells: row.cells.map((cell, j) => (j !== c ? cell : { ...(cell || { quote: '', location: '' }), value: ev.value, status: ev.status } as Cell)) }))
            return { ...v, rows }
          })
          setMsg(`${ev.document} · ${ev.column}`)
        } else if (ev.type === 'error') setMsg(ev.message)
        else if (ev.type === 'done') {
          const s = ev.stats || {}
          setMsg(`${s.cells} cells: ${s.ok || 0} verified · ${s.unverified || 0} quote not found · ${s.invalid || 0} to check · ${s.not_found || 0} not in the document${s.errors?.length ? ` · ${s.errors.length} errors` : ''}`)
        }
      })
      await open(view.id)
    } catch (err: any) { setMsg(err.message) }
    setBusy(false)
  }

  const exportGrid = async () => {
    if (!view) return
    try { const r = await e.call('POST', '/api/grids/export', { id: view.id }); setMsg(`Saved: ${r.files.join(' · ')}`) } catch (err: any) { setMsg(err.message) }
  }
  const remove = async () => {
    if (!view || !confirm(`Delete the grid "${view.title}"? The documents are not touched.`)) return
    await e.call('POST', '/api/grids/delete', { id: view.id })
    setView(null); await loadList()
  }

  const selected = view && sel ? { row: view.rows[sel.r], col: view.columns[sel.c], cell: view.rows[sel.r].cells[sel.c] } : null
  const saveCell = async (patch: { value?: string; locked?: boolean }) => {
    if (!view || !selected) return
    await e.call('POST', '/api/grids/cell', { id: view.id, document: selected.row.document, column: selected.col.id, ...patch })
    await open(view.id)
    setSel(sel)
  }

  return (
    <div className="flex gap-4 p-6 h-full">
      <aside className="w-60 shrink-0 space-y-3">
        <h1 className="flex items-center gap-2 font-serif text-2xl text-parchment"><Table2 size={20} /> Review grid</h1>
        <p className="text-xs text-antique">Rows are the matter's documents, columns are your questions. Every answer must quote its document; answers whose quote isn't found are flagged, never shown as fact.</p>
        <div className="flex flex-wrap gap-1.5">
          <button className={ghost} onClick={() => startNew()}><Plus size={14} /> New</button>
          {Object.entries(PRESETS).map(([k, p]) => <button key={k} className={ghost} onClick={() => startNew(k)}>{p.title}</button>)}
        </div>
        <ul className="space-y-1">
          {grids.map((g) => (
            <li key={g.id}>
              <button onClick={() => open(g.id)} className={`w-full text-left px-2 py-1.5 rounded text-sm ${view?.id === g.id ? 'bg-deep-brown text-parchment' : 'text-cream hover:bg-deep-brown'}`}>
                {g.title}<span className="block text-xs text-antique">{g.documents} docs × {g.columns} columns</span>
              </button>
            </li>
          ))}
          {!grids.length && <li className="text-xs text-antique">No grids for this matter yet.</li>}
        </ul>
      </aside>

      <main className="flex-1 min-w-0 space-y-3">
        {msg && <div className="text-sm text-antique">{msg}</div>}

        {editing && (
          <div className={card + ' space-y-2'}>
            <input className={input} value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Grid title" />
            {cols.map((c, i) => {
              const set = (patch: Partial<Column>) => setCols(cols.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              const others = cols.filter((x, j) => j !== i && (x.id || x.label)).map((x) => x.id || slug(x.label))
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <input className={input + ' col-span-2'} value={c.label} onChange={(ev) => set({ label: ev.target.value })} placeholder="Column" />
                  <input className={input + ' col-span-5'} value={c.prompt} onChange={(ev) => set({ prompt: ev.target.value })} placeholder="Question for each document" />
                  <select className={input + ' col-span-2'} value={c.type} onChange={(ev) => set({ type: ev.target.value as ColType })}>
                    <option value="text">Text</option><option value="yesno">Yes / no</option><option value="choice">Choice</option><option value="date">Date</option><option value="number">Number / amount</option>
                  </select>
                  {c.type === 'choice'
                    ? <input className={input + ' col-span-2'} value={(c.options || []).join(', ')} onChange={(ev) => set({ options: ev.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} placeholder="Options, comma-separated" />
                    : <select className={input + ' col-span-2'} value={c.dependsOn?.[0] || ''} onChange={(ev) => set({ dependsOn: ev.target.value ? [ev.target.value] : undefined })} title="Use another column's answer as context">
                        <option value="">No dependency</option>
                        {others.map((o) => <option key={o} value={o}>uses: {o}</option>)}
                      </select>}
                  <button className={ghost + ' col-span-1 justify-center'} onClick={() => setCols(cols.filter((_, j) => j !== i))} title="Remove column"><X size={14} /></button>
                </div>
              )
            })}
            <div className="flex gap-2">
              <button className={ghost} onClick={() => setCols([...cols, { label: '', prompt: '', type: 'text' }])}><Plus size={14} /> Column</button>
              <button className={btn} onClick={saveColumns}>{view ? 'Save columns' : 'Create grid'}</button>
              <button className={ghost} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}

        {view && !editing && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-serif text-xl text-parchment mr-auto">{view.title}</h2>
              <button className={btn} disabled={busy} onClick={() => run(false)}><Play size={14} /> Run</button>
              <button className={ghost} disabled={busy} onClick={() => run(true)} title="Recompute every unlocked cell"><RotateCcw size={14} /> Rerun all</button>
              <button className={ghost} disabled={busy} onClick={editColumns}>Columns</button>
              <button className={ghost} disabled={busy} onClick={exportGrid}><Download size={14} /> Excel</button>
              <button className={ghost} disabled={busy} onClick={remove}><Trash2 size={14} /></button>
            </div>
            <div className="overflow-auto border border-tobacco rounded-card max-h-[70vh]">
              <table className="text-sm border-collapse min-w-full">
                <thead className="sticky top-0 bg-leather">
                  <tr>
                    <th className="text-left p-2 border-b border-tobacco text-parchment font-medium sticky left-0 bg-leather">Document</th>
                    {view.columns.map((c) => <th key={c.id} className="text-left p-2 border-b border-tobacco text-parchment font-medium min-w-[160px]" title={c.prompt}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row, r) => (
                    <tr key={row.document} className="align-top">
                      <td className="p-2 border-b border-tobacco text-cream sticky left-0 bg-obsidian max-w-[220px] truncate" title={row.document}>{row.name}</td>
                      {row.cells.map((cell, c) => {
                        const st = STATUS[cell?.status || ''] || { label: '', cls: 'text-antique' }
                        const isSel = sel?.r === r && sel?.c === c
                        return (
                          <td key={c} onClick={() => { setSel({ r, c }); setDraft(cell?.value || '') }}
                            className={`p-2 border-b border-l border-tobacco cursor-pointer ${isSel ? 'bg-deep-brown' : 'hover:bg-deep-brown/50'}`}>
                            {!cell ? <span className="text-antique">·</span> : cell.status === 'not_found' ? <span className="text-antique">—</span> : (
                              <span className={st.cls}>
                                {cell.locked && <Lock size={11} className="inline mr-1 -mt-0.5" />}
                                {cell.value}
                                {st.label && <span className="ml-1 text-xs">[{st.label}]</span>}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!view && !editing && <div className="text-antique text-sm">Open a grid on the left, or start a new one from a preset.</div>}
      </main>

      {selected && !editing && (
        <aside className={card + ' w-80 shrink-0 space-y-2 self-start'}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-parchment font-medium">{selected.col.label}</div>
              <div className="text-xs text-antique">{selected.row.name}</div>
            </div>
            <button className="text-antique" onClick={() => setSel(null)}><X size={16} /></button>
          </div>
          <div className="text-xs text-antique">{selected.col.prompt}</div>
          {selected.cell?.quote && (
            <blockquote className="border-l-2 border-accent pl-2 text-sm text-cream italic">“{selected.cell.quote}”{selected.cell.location && <span className="not-italic text-antique"> — {selected.cell.location}</span>}</blockquote>
          )}
          {selected.cell?.status === 'unverified' && <div className="text-xs text-amber-400">This quote does not appear in the document. Check before relying on the answer.</div>}
          {selected.cell?.note && <div className="text-xs text-amber-400">{selected.cell.note}</div>}
          <textarea className={input + ' min-h-[70px]'} value={draft} onChange={(ev) => setDraft(ev.target.value)} />
          <div className="flex gap-2">
            <button className={btn} onClick={() => saveCell({ value: draft })}>Save (locks)</button>
            <button className={ghost} onClick={() => saveCell({ locked: !selected.cell?.locked })}>
              {selected.cell?.locked ? <><Unlock size={14} /> Unlock</> : <><Lock size={14} /> Lock</>}
            </button>
          </div>
        </aside>
      )}
    </div>
  )
}
