// Plans (Phase 7.3): the engine proposes a multi-step plan for a goal,
// the lawyer edits and approves it, steps run (independent ones side by
// side), and checkpoint steps pause until the lawyer decides.
import { useCallback, useEffect, useState } from 'react'
import { Route as RouteIcon, Play, Check, X, Square, FileText } from 'lucide-react'

interface Engine {
  call: (method: string, path: string, body?: unknown) => Promise<any>
  stream: (path: string, body: unknown, onEvent: (ev: any) => void) => Promise<unknown>
}
const engine = (): Engine | null => (typeof window !== 'undefined' && (window as any).lexvault?.engine) || null

interface Step { id: string; kind: string; title: string; args: any; dependsOn: string[]; status: string; result?: { summary?: string; files?: string[] }; error?: string; note?: string; decision?: { decision: string; note: string } }
interface Plan { id: string; goal: string; status: string; steps: Step[]; notes?: string[]; report?: string }

const card = 'p-4 bg-leather rounded-card border border-tobacco'
const input = 'w-full bg-transparent border border-tobacco rounded px-2 py-1.5 text-cream text-sm'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-obsidian text-sm disabled:opacity-50'
const ghost = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-tobacco text-cream text-sm hover:bg-deep-brown disabled:opacity-50'
const STATUS_CLS: Record<string, string> = { done: 'text-forest', running: 'text-accent animate-pulse', waiting: 'text-amber-400', failed: 'text-red-400', skipped: 'text-antique line-through', pending: 'text-antique' }

export default function Plans() {
  const e = engine()
  const [matter, setMatter] = useState('')
  const [plans, setPlans] = useState<any[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [goal, setGoal] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const loadList = useCallback(async () => {
    if (!e) return
    const mt = await (window as any).lexvault.matters.list()
    setMatter(mt.active || '')
    setPlans((await e.call('GET', `/api/plans?matterId=${encodeURIComponent(mt.active || '')}`)).plans)
  }, [e])
  useEffect(() => { loadList().catch((err) => setMsg(String(err.message || err))) }, [loadList])

  if (!e) return <div className="p-8 text-antique">Plans are available in the desktop app.</div>

  const open = async (id: string) => setPlan((await e.call('GET', `/api/plans/get?id=${encodeURIComponent(id)}`)).plan)
  const propose = async () => {
    if (!matter) { setMsg('Pick a matter in the sidebar first: the plan works on its documents.'); return }
    setBusy(true); setMsg('Planning…')
    try { const r = await e.call('POST', '/api/plans', { goal, matterId: matter }); setPlan(r.plan); setMsg('Review the steps. Remove what you don\'t want, then approve.'); await loadList() } catch (err: any) { setMsg(err.message) }
    setBusy(false)
  }
  const removeStep = async (id: string) => {
    if (!plan) return
    try { setPlan((await e.call('POST', '/api/plans/update', { id: plan.id, steps: plan.steps.filter((s) => s.id !== id) })).plan) } catch (err: any) { setMsg(err.message) }
  }
  const run = async () => {
    if (!plan) return
    setBusy(true); setMsg('Running…')
    try {
      if (plan.status === 'proposed') await e.call('POST', '/api/plans/approve', { id: plan.id })
      await e.stream('/api/plans/run', { id: plan.id }, (ev) => {
        if (ev.type === 'progress' && ev.status) {
          setPlan((p) => p && { ...p, steps: p.steps.map((s) => (s.id === ev.step ? { ...s, status: ev.status, ...(ev.summary ? { result: { summary: ev.summary, files: ev.files } } : {}), ...(ev.error ? { error: ev.error } : {}) } : s)) })
        } else if (ev.type === 'progress' && ev.text) setMsg(`${ev.step}: ${ev.text}`)
        else if (ev.type === 'error') setMsg(ev.message)
        else if (ev.type === 'done') setMsg(ev.status === 'waiting' ? 'Waiting for your decision.' : ev.status === 'done' ? `Done. Report: ${ev.report}` : `Plan ${ev.status}.`)
      })
      await open(plan.id); await loadList()
    } catch (err: any) { setMsg(err.message) }
    setBusy(false)
  }
  const decide = async (stepId: string, decision: 'continue' | 'stop') => {
    if (!plan) return
    try {
      const r = await e.call('POST', '/api/plans/decide', { id: plan.id, stepId, decision, note })
      setPlan(r.plan); setNote('')
      if (decision === 'continue') await run()
      else setMsg(`Stopped. Report: ${r.plan.report}`)
    } catch (err: any) { setMsg(err.message) }
  }

  const editable = plan?.status === 'proposed' || plan?.status === 'approved'
  return (
    <div className="flex gap-4 p-6">
      <aside className="w-60 shrink-0 space-y-2">
        <h1 className="flex items-center gap-2 font-serif text-2xl text-parchment"><RouteIcon size={20} /> Plans</h1>
        <p className="text-xs text-antique">Describe the goal; OpenLex proposes steps from what it can do (review, chronology, grid, translate, compare, research, skills). Nothing runs until you approve, and checkpoints wait for your decision.</p>
        <ul className="space-y-1">
          {plans.map((p) => (
            <li key={p.id}><button onClick={() => open(p.id)} className={`w-full text-left px-2 py-1.5 rounded text-sm ${plan?.id === p.id ? 'bg-deep-brown text-parchment' : 'text-cream hover:bg-deep-brown'}`}>
              <span className="line-clamp-2">{p.goal}</span><span className="block text-xs text-antique">{p.status} · {p.steps} steps</span>
            </button></li>
          ))}
          {!plans.length && <li className="text-xs text-antique">No plans for this matter yet.</li>}
        </ul>
      </aside>

      <main className="flex-1 min-w-0 space-y-3 max-w-3xl">
        <div className={card + ' space-y-2'}>
          <textarea className={input + ' min-h-[70px]'} placeholder="Goal, e.g. “Due diligence on the supplier contracts: find change-of-control and exclusivity issues, then a memo on what needs consent.”" value={goal} onChange={(ev) => setGoal(ev.target.value)} />
          <button className={btn} disabled={busy || !goal.trim()} onClick={propose}>Propose a plan</button>
        </div>
        {msg && <p className="text-sm text-antique">{msg}</p>}

        {plan && (
          <div className={card + ' space-y-3'}>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-lg text-parchment mr-auto">{plan.goal}</h2>
              <span className="text-xs text-antique">{plan.status}</span>
              {(editable || plan.status === 'paused') && <button className={btn} disabled={busy} onClick={run}><Play size={14} /> {plan.status === 'proposed' ? 'Approve & run' : 'Run'}</button>}
            </div>
            <ol className="space-y-2">
              {plan.steps.map((s, i) => (
                <li key={s.id} className="border border-tobacco rounded p-2">
                  <div className="flex items-start gap-2">
                    <span className="text-antique text-xs w-5 shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-cream text-sm">{s.title} <span className="text-xs text-antique">· {s.kind}{s.dependsOn.length ? ` · after ${s.dependsOn.join(', ')}` : ''}</span></div>
                      {s.kind === 'checkpoint' && <div className="text-sm text-amber-400">{s.args.question}</div>}
                      {s.result?.summary && <div className="text-xs text-antique mt-1">{s.result.summary}</div>}
                      {s.error && <div className="text-xs text-red-400 mt-1">{s.error}</div>}
                      {s.note && <div className="text-xs text-antique mt-1">{s.note}</div>}
                      {s.result?.files?.map((f) => <div key={f} className="text-xs text-antique break-all flex items-center gap-1"><FileText size={11} /> {f}</div>)}
                      {s.status === 'waiting' && (
                        <div className="mt-2 flex gap-2 items-center">
                          <input className={input} placeholder="Note for the next steps (optional)" value={note} onChange={(ev) => setNote(ev.target.value)} />
                          <button className={btn} disabled={busy} onClick={() => decide(s.id, 'continue')}><Check size={14} /> Continue</button>
                          <button className={ghost} disabled={busy} onClick={() => decide(s.id, 'stop')}><Square size={14} /> Stop</button>
                        </div>
                      )}
                    </div>
                    <span className={`text-xs ${STATUS_CLS[s.status] || 'text-antique'}`}>{s.status}</span>
                    {editable && <button className="text-antique hover:text-accent" title="Remove step" onClick={() => removeStep(s.id)}><X size={14} /></button>}
                  </div>
                </li>
              ))}
            </ol>
            {!!plan.notes?.length && <ul className="text-xs text-antique list-disc ml-4">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {plan.report && <p className="text-xs text-antique break-all">Report: {plan.report}</p>}
          </div>
        )}
      </main>
    </div>
  )
}
