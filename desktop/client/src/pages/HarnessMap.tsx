// Harness map: the whole pipeline as decision points, with the model each
// role would try (in order, policy-checked) and the firm rules (hooks) at
// each point. Editable: a role's route in one click, every section as
// validated JSON. Firm-locked sections are read-only here.
import { useCallback, useEffect, useState } from 'react'
import { Workflow, Lock, AlertTriangle, ChevronRight, Save } from 'lucide-react'

interface Engine { call: (method: string, path: string, body?: unknown) => Promise<any> }
const engine = (): Engine | null => (typeof window !== 'undefined' && (window as any).lexvault?.engine) || null

const card = 'p-4 bg-leather rounded-card border border-tobacco'
const input = 'w-full bg-transparent border border-tobacco rounded px-2 py-1.5 text-cream text-sm'
const small = 'bg-transparent border border-tobacco rounded px-1.5 py-1 text-cream text-xs'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-obsidian text-sm disabled:opacity-50'

// The chat pipeline, in order: [label, role or null, hook points shown on the node]
const PIPELINE: { id: string; label: string; role?: string; hooks: string[]; note: string }[] = [
  { id: 'request', label: 'Request', hooks: [], note: '@profile and /skill chosen, or a skill suggested' },
  { id: 'plan', label: 'Plan', role: 'plan', hooks: ['before_model'], note: 'decides which tools to use' },
  { id: 'tools', label: 'Tools', hooks: ['before_tool', 'after_tool', 'before_web'], note: 'law search, firm library, EUR-Lex, web…' },
  { id: 'analyze', label: 'Analyze', role: 'analyze', hooks: ['before_model'], note: 'reads tool results between steps' },
  { id: 'write', label: 'Write', role: 'write', hooks: ['before_model'], note: 'the answer and suggested changes' },
  { id: 'judge', label: 'Judge', role: 'judge', hooks: ['before_model'], note: 'checks suggestions against sources' },
  { id: 'answer', label: 'Answer', hooks: ['before_answer', 'on_suggestion'], note: 'firm checks before it reaches you' },
]
const SIDE: { id: string; label: string; role: string; hooks: string[]; note: string }[] = [
  { id: 'extract', label: 'Workflows', role: 'extract', hooks: ['after_workflow'], note: 'review, chronology, grid, playbooks, plans' },
  { id: 'translate', label: 'Translate', role: 'translate', hooks: ['after_workflow'], note: 'document translation' },
  { id: 'summarize', label: 'Monitors', role: 'summarize', hooks: ['before_web'], note: 'alert summaries' },
  { id: 'draft', label: 'Skill builder', role: 'draft', hooks: [], note: 'drafting new skills' },
]

export default function HarnessMap() {
  const e = engine()
  const [data, setData] = useState<any>(null)
  const [matter, setMatter] = useState('')
  const [matters, setMatters] = useState<any[]>([])
  const [agent, setAgent] = useState('')
  const [sel, setSel] = useState<string>('write')
  const [section, setSection] = useState<'routes' | 'hooks' | 'agents' | 'features'>('routes')
  const [json, setJson] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!e) return
    const q = new URLSearchParams({ matterId: matter, agent })
    const r = await e.call('GET', `/api/harness?${q}`)
    setData(r)
  }, [e, matter, agent])
  useEffect(() => { (window as any).lexvault?.matters?.list().then((mt: any) => { setMatters(mt.matters || []); setMatter(mt.active || '') }).catch(() => {}) }, [])
  useEffect(() => { load().catch((err) => setMsg(err.message)) }, [load])
  useEffect(() => {
    if (!data) return
    // Edit only your own layer; the firm's file stays under the firm's control.
    setJson(JSON.stringify(data.userLayer?.[section] ?? {}, null, 2))
  }, [data, section])

  if (!e) return <div className="p-8 text-antique">The harness map is available in the desktop app.</div>
  if (!data) return <div className="p-8 text-antique">Loading…</div>

  const locked: string[] = data.config.locked || []
  const routeFor = (role?: string) => (role ? data.routes.find((r: any) => r.role === role) : null)
  const hookCount = (ev: string) => (data.config.hooks?.[ev] || []).length

  const setRoleRoute = async (role: string, target: string) => {
    const own = data.userLayer?.routes || {}
    const routes = { ...own, roles: { ...(own.roles || {}) } }
    if (target) routes.roles[role] = target
    else delete routes.roles[role]
    try { await e.call('POST', '/api/harness/section', { section: 'routes', value: routes }); setMsg(`${role} → ${target || 'default'}`); await load() } catch (err: any) { setMsg(err.message) }
  }
  const saveSection = async () => {
    let value
    try { value = JSON.parse(json) } catch (err: any) { setMsg(`Not valid JSON: ${err.message}`); return }
    try { await e.call('POST', '/api/harness/section', { section, value }); setMsg(`Saved ${section} (your layer).`); await load() } catch (err: any) { setMsg(err.message) }
  }

  const Node = ({ n }: { n: { id: string; label: string; role?: string; hooks: string[]; note: string } }) => {
    const route = routeFor(n.role)
    const first = route?.candidates.find((c: any) => c.allowed)
    const hooks = n.hooks.reduce((s, h) => s + hookCount(h), 0)
    return (
      <button onClick={() => setSel(n.role || n.id)} className={`text-left p-3 rounded-card border min-w-[150px] ${sel === (n.role || n.id) ? 'border-accent bg-deep-brown' : 'border-tobacco bg-leather hover:bg-deep-brown'}`}>
        <div className="text-parchment text-sm font-medium">{n.label}</div>
        <div className="text-[11px] text-antique leading-tight">{n.note}</div>
        {route && <div className="text-xs mt-1 text-cream">{first ? `${first.provider}${first.model ? `:${first.model}` : ''}` : <span className="text-red-400">no allowed model</span>}</div>}
        {hooks > 0 && <div className="text-[11px] text-accent mt-0.5">{hooks} firm rule{hooks === 1 ? '' : 's'}</div>}
      </button>
    )
  }

  const selNode = [...PIPELINE, ...SIDE].find((n) => (n.role || n.id) === sel)
  const selRoute = routeFor(selNode?.role)
  const currentTarget = selNode?.role ? (data.config.routes?.roles?.[selNode.role] || '') : ''

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="flex items-center gap-2 font-serif text-2xl text-parchment mr-auto"><Workflow size={20} /> Harness map</h1>
        <select className={small} value={matter} onChange={(ev) => setMatter(ev.target.value)} title="Preview the map under this matter's data policy">
          <option value="">Default policy</option>
          {matters.map((m) => <option key={m.id} value={m.id}>{m.number ? `${m.number} · ` : ''}{m.title}{m.privileged ? ' (privileged)' : ''}</option>)}
        </select>
        <select className={small} value={agent} onChange={(ev) => setAgent(ev.target.value)} title="Preview with an agent profile">
          <option value="">No profile</option>
          {(data.agents || []).filter((a: any) => !a.error).map((a: any) => <option key={a.name} value={a.name}>@{a.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-antique">Built-in defaults &lt; firm file {data.files.firm ? <code>{data.files.firm}</code> : '(no workspace)'} &lt; your file <code>{data.files.user}</code>.{locked.length ? <> The firm locks: {locked.join(', ')}.</> : null}</p>
      {[...(data.errors || []), ...(data.problems || [])].map((p: string) => <p key={p} className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> {p}</p>)}
      {msg && <p className="text-sm text-antique">{msg}</p>}

      <div className={card + ' overflow-x-auto'}>
        <div className="flex items-stretch gap-1 min-w-max">
          {PIPELINE.map((n, i) => (
            <div key={n.id} className="flex items-center gap-1">
              <Node n={n} />
              {i < PIPELINE.length - 1 && <ChevronRight size={16} className="text-antique shrink-0" />}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">{SIDE.map((n) => <Node key={n.id} n={n} />)}</div>
      </div>

      {selNode && (
        <div className={card + ' space-y-2'}>
          <div className="text-parchment font-medium">{selNode.label}{selNode.role ? <span className="text-antique text-xs"> · role “{selNode.role}”</span> : null}</div>
          {selRoute && (
            <>
              <ol className="text-sm space-y-0.5">
                {selRoute.candidates.map((c: any, i: number) => (
                  <li key={i} className={c.allowed ? 'text-cream' : 'text-antique line-through'} title={c.blocked || ''}>
                    {i + 1}. {c.provider}{c.model ? `:${c.model}` : ''} <span className="text-xs text-antique no-underline">({c.reason}{c.local ? ', on this machine' : ''}{c.blocked ? ` — ${c.blocked}` : ''})</span>
                  </li>
                ))}
              </ol>
              <div className="flex items-center gap-2">
                <span className="text-xs text-antique">Route this role to</span>
                <select className={small} disabled={locked.includes('routes')} value={currentTarget.split(':')[0]} onChange={(ev) => setRoleRoute(selNode.role!, ev.target.value)}>
                  <option value="">default (active provider)</option>
                  {data.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {locked.includes('routes') && <span className="text-xs text-antique flex items-center gap-1"><Lock size={11} /> set by the firm</span>}
              </div>
            </>
          )}
          {selNode.hooks.length > 0 && (
            <div className="text-xs text-antique">
              Decision points here: {selNode.hooks.map((h) => <span key={h} className="mr-2"><code>{h}</code> ×{hookCount(h)}</span>)}
            </div>
          )}
        </div>
      )}

      <div className={card + ' space-y-2'}>
        <div className="flex gap-2 items-center">
          {(['routes', 'hooks', 'agents', 'features'] as const).map((s) => (
            <button key={s} onClick={() => setSection(s)} className={`px-2 py-1 rounded text-xs border border-tobacco ${section === s ? 'bg-deep-brown text-parchment' : 'text-cream'}`}>
              {s}{locked.includes(s) ? ' 🔒' : ''} <span className="text-antique">({data.config.sources?.[s]})</span>
            </button>
          ))}
          <span className="text-xs text-antique ml-auto">Your layer only (merged over the firm's). Reference: docs/HARNESS.md</span>
        </div>
        <details className="text-xs text-antique"><summary className="cursor-pointer">Effective {section} (all layers merged)</summary><pre className="whitespace-pre-wrap mt-1">{JSON.stringify(data.config[section], null, 2)}</pre></details>
        <textarea className={input + ' font-mono min-h-[260px]'} value={json} readOnly={locked.includes(section)} onChange={(ev) => setJson(ev.target.value)} spellCheck={false} />
        <button className={btn} disabled={locked.includes(section)} onClick={saveSection}><Save size={14} /> Save {section}</button>
      </div>
    </div>
  )
}
