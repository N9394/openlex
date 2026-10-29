// Matter picker for the desktop App sidebar. Matters are shared with the
// Word plugin through the OpenLex engine (window.lexvault.matters); the
// active matter decides the data policy for the App's AI calls.
import { useCallback, useEffect, useState } from 'react'
import { Plus, Lock, Link2 } from 'lucide-react'
import { hubBridge, useWordLink } from '../lib/hub'

interface Matter {
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
}

const bridge = (): MattersBridge | null =>
  (typeof window !== 'undefined' && (window as any).lexvault?.matters) || null

export default function MatterPicker() {
  const [matters, setMatters] = useState<Matter[]>([])
  const [active, setActive] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', client: '', number: '', privileged: false })
  const [error, setError] = useState('')
  const word = useWordLink()

  const refresh = useCallback(async () => {
    const b = bridge()
    if (!b) return
    const r = await b.list()
    setMatters(r.matters)
    setActive(r.active || '')
  }, [])

  useEffect(() => {
    refresh()
    // Word created/bound a matter → refresh the list.
    hubBridge()?.onEvent((ev) => { if (ev.type === 'matter-changed' || ev.type === 'policy-changed') refresh() })
    // "/matter" in the chat chose another matter.
    window.addEventListener('openlex:matter-changed', refresh)
    return () => window.removeEventListener('openlex:matter-changed', refresh)
  }, [refresh])

  if (!bridge()) return null

  const current = matters.find((m) => m.id === active)
  const onSelect = async (id: string) => {
    setActive(id)
    await bridge()!.setActive(id || null)
  }
  const onCreate = async () => {
    setError('')
    try {
      const m = await bridge()!.create(form)
      setForm({ title: '', client: '', number: '', privileged: false })
      setAdding(false)
      await refresh()
      setActive(m.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="px-3 py-2 border-b border-tobacco text-xs">
      <div className="flex items-center gap-2">
        <span className="text-antique">Matter</span>
        <select
          value={active}
          onChange={(e) => onSelect(e.target.value)}
          className="flex-1 min-w-0 bg-transparent border border-tobacco rounded px-1 py-0.5 text-cream"
        >
          <option value="">— none —</option>
          {matters.map((m) => (
            <option key={m.id} value={m.id}>
              {(m.number ? `${m.number} · ` : '') + m.title + (m.privileged ? ' 🔒' : '')}
            </option>
          ))}
        </select>
        <button onClick={() => setAdding(!adding)} className="text-antique hover:text-accent" title="New matter">
          <Plus size={14} />
        </button>
      </div>
      {current && (
        <div className="mt-1 flex items-center gap-2 text-antique">
          {current.policy?.mode === 'local-only' ? (
            <span className="flex items-center gap-1 text-forest"><Lock size={11} /> local only</span>
          ) : (
            <span>cloud: {(current.policy?.providers || []).join(', ') || 'none'}</span>
          )}
          {!!current.docs?.length && <span>· {current.docs.length} Word doc{current.docs.length > 1 ? 's' : ''}</span>}
          {word.connected && <span className="flex items-center gap-1"><Link2 size={11} /> Word</span>}
        </div>
      )}
      {adding && (
        <div className="mt-2 flex flex-col gap-1">
          <input className="bg-transparent border border-tobacco rounded px-1 py-0.5 text-cream" placeholder="Matter title"
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="bg-transparent border border-tobacco rounded px-1 py-0.5 text-cream" placeholder="Client (optional)"
            value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
          <input className="bg-transparent border border-tobacco rounded px-1 py-0.5 text-cream" placeholder="Matter number (optional)"
            value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          <label className="flex items-center gap-1 text-antique">
            <input type="checkbox" checked={form.privileged} onChange={(e) => setForm({ ...form, privileged: e.target.checked })} />
            Privileged — local only
          </label>
          <button onClick={onCreate} className="bg-accent text-obsidian rounded px-2 py-1">Create</button>
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
