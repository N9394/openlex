// Panel — agents working together, in the App's chat (engine: panel.js).
//
//   <PanelSetup …/>   how they work together: side by side, a debate or draft
//                     and review; which agents, their positions, rounds and
//                     who sums up. "Use for my next question" switches the
//                     Panel on next to "Working as".
//   <PanelCard run={…}/>  one panel: first the estimate (online AI: the
//                     lawyer starts it), then one lane per agent — what it
//                     is doing in plain words, who is speaking, what left
//                     this computer — Stop stops all; then the result as a
//                     card: the moderator's summary with its sources, every
//                     turn, export to Word / PDF / Markdown, keep with the matter.
//   <PanelCard id={…}/>   a stored panel (from the conversation or the search).
//   parseTeam("/team debate claimant-counsel defendant-counsel") → a setup.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from './Markdown'
import { ChevronDown, ChevronUp, MessageSquare, Plus, Square, Users, X } from 'lucide-react'
import { agentTitle, engine } from '../lib/commands'
import { ModelUse, addModel, clip, dataLine, friendly, sourcesNote } from '../lib/turn'
import ExportButtons from './ExportButtons'

export type PanelMode = 'parallel' | 'debate' | 'review'
export interface PanelMember { name: string; side?: string; label?: string }
export interface PanelSpec { mode: PanelMode; agents: PanelMember[]; rounds: number; moderator: string | null }
export interface PanelRun { spec: PanelSpec; question: string; matterId: string | null; sessionId: string | null; attachments: string[]; message: string }
interface AgentChoice { name: string; title: string; description?: string; template?: boolean; de?: { title?: string; description?: string } | null }

export const DEFAULT_SPEC: PanelSpec = { mode: 'debate', agents: [{ name: 'claimant-counsel' }, { name: 'defendant-counsel' }], rounds: 2, moderator: 'judge' }
const MODES: PanelMode[] = ['parallel', 'debate', 'review']

/** "/team debate claimant-counsel defendant-counsel 3" → a setup (null: open the setup). */
export function parseTeam(arg: string, base: PanelSpec = DEFAULT_SPEC): PanelSpec | null {
  const words = String(arg || '').trim().split(/[\s,]+/).filter(Boolean)
  if (!words.length) return null
  const mode = (({ parallel: 'parallel', together: 'parallel', parallel_: 'parallel', debate: 'debate', debatte: 'debate', argue: 'debate', review: 'review', chain: 'review', prüfen: 'review' } as Record<string, PanelMode>)[words[0].toLowerCase()]) || null
  const rest = mode ? words.slice(1) : words
  const rounds = rest.find((w) => /^\d$/.test(w))
  const names = rest.filter((w) => !/^\d$/.test(w) && !/^(vs\.?|gegen|and|und)$/i.test(w)).map((w) => w.toLowerCase().replace(/^@/, ''))
  const m = mode || base.mode
  return {
    mode: m,
    agents: names.length ? names.map((name) => ({ name })) : m === 'review' ? [{ name: 'drafter' }, { name: 'reviewer' }] : m === base.mode ? base.agents : DEFAULT_SPEC.agents,
    rounds: rounds ? Math.max(1, Math.min(5, +rounds)) : base.rounds,
    moderator: m === 'debate' ? (base.moderator || 'judge') : m === 'parallel' ? null : null,
  }
}

/** Agents and templates the lawyer can put on a panel. */
export function usePanelAgents() {
  const [list, setList] = useState<AgentChoice[]>([])
  useEffect(() => {
    engine()?.call('GET', '/api/agents').then((r) => {
      const own: AgentChoice[] = (r.agents || []).filter((a: any) => !a.error).map((a: any) => ({ name: a.name, title: a.title, description: a.description, de: a.de || null }))
      const tpl: AgentChoice[] = (r.templates || []).filter((x: any) => !own.some((a) => a.name === x.name)).map((x: any) => ({ name: x.name, title: x.title, description: x.description, de: x.de || null, template: true }))
      setList([...own, ...tpl])
    }).catch(() => setList([]))
  }, [])
  return list
}

export function specWords(spec: PanelSpec, agents: AgentChoice[], tf: unknown) {
  const t = (k: string, d: string, o?: Record<string, unknown>) => String((tf as (k: string, o: Record<string, unknown>) => unknown)(k, { defaultValue: d, ...(o || {}) }))
  const names = spec.agents.map((a) => { const x = agents.find((y) => y.name === a.name); return a.label || (x ? agentTitle(x) : a.name) })
  const how = spec.mode === 'debate' ? t('panel.debateN', 'Debate, {{n}} rounds', { n: spec.rounds }) : spec.mode === 'review' ? t('panel.reviewShort', 'Draft and review') : t('panel.parallelShort', 'Side by side')
  return `${how}: ${names.join(' · ')}`
}

// ── setup ───────────────────────────────────────────────────────────────────

export function PanelSetup({ initial, onUse, onCancel }: { initial?: PanelSpec | null; onUse: (spec: PanelSpec) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const agents = usePanelAgents()
  const [spec, setSpec] = useState<PanelSpec>(initial || DEFAULT_SPEC)
  const set = (patch: Partial<PanelSpec>) => setSpec((s) => ({ ...s, ...patch }))
  const setMode = (mode: PanelMode) => set({ mode, ...(mode === 'review' ? { agents: [{ name: 'drafter' }, { name: 'reviewer' }], moderator: null } : mode === 'debate' ? { moderator: spec.moderator || 'judge', agents: spec.mode === 'review' ? DEFAULT_SPEC.agents : spec.agents } : { moderator: null, agents: spec.mode === 'review' ? [{ name: 'researcher', side: 'Austrian law' }, { name: 'researcher', side: 'EU law' }] : spec.agents }) })
  const member = (i: number, patch: Partial<PanelMember>) => set({ agents: spec.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const modeWords: Record<PanelMode, [string, string]> = {
    parallel: [t('panel.parallel', 'Side by side'), t('panel.parallelHelp', 'Several agents answer the same question at once; the answers are shown together, each under its name.')],
    debate: [t('panel.debate', 'Debate'), t('panel.debateHelp', 'Agents take positions and answer each other for a few rounds; a moderator sums up where they agree and disagree, which position is stronger and what is open.')],
    review: [t('panel.review', 'Draft and review'), t('panel.reviewHelp', 'A drafter writes, a reviewer reviews, the drafter revises.')],
  }
  const ok = spec.agents.length >= 2 && spec.agents.every((a) => a.name)
  return (
    <div className="space-y-4 text-sm" data-testid="panel-setup">
      <fieldset>
        <legend className="text-cream mb-1">{t('panel.how', 'How they work together')}</legend>
        <div className="space-y-1">
          {MODES.map((m) => (
            <label key={m} className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="panel-mode" className="mt-1" checked={spec.mode === m} onChange={() => setMode(m)} data-testid={`panel-mode-${m}`} />
              <span><span className="text-cream">{modeWords[m][0]}</span> <span className="text-antique">— {modeWords[m][1]}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-cream mb-1">{spec.mode === 'review' ? t('panel.whoReview', 'Drafter and reviewer') : t('panel.who', 'Who takes part')}</legend>
        <div className="space-y-2">
          {spec.agents.map((a, i) => (
            <div key={i} className="flex gap-2 items-center">
              {spec.mode === 'review' && <span className="w-20 text-xs text-antique shrink-0">{i === 0 ? t('panel.drafter', 'Drafter') : t('panel.reviewer', 'Reviewer')}</span>}
              <select className="input flex-1 !py-1.5" value={a.name} onChange={(e) => member(i, { name: e.target.value })} data-testid={`panel-agent-${i}`}>
                {!agents.some((x) => x.name === a.name) && <option value={a.name}>{a.name}</option>}
                {agents.map((x) => <option key={x.name} value={x.name}>{agentTitle(x)}{x.template ? ` (${t('panel.template', 'template')})` : ''}</option>)}
              </select>
              {spec.mode !== 'review' && <input className="input flex-1 !py-1.5" value={a.side || ''} onChange={(e) => member(i, { side: e.target.value })} placeholder={spec.mode === 'debate' ? t('panel.positionPh', 'Position (optional), e.g. for the tenant') : t('panel.focusPh', 'Focus (optional), e.g. EU law')} />}
              {spec.mode !== 'review' && spec.agents.length > 2 && <button type="button" onClick={() => set({ agents: spec.agents.filter((_, j) => j !== i) })} className="text-antique hover:text-cream" aria-label={t('panel.remove', 'Remove')}><X size={14} /></button>}
            </div>
          ))}
          {spec.mode !== 'review' && spec.agents.length < 6 && (
            <button type="button" onClick={() => set({ agents: [...spec.agents, { name: agents.find((x) => !spec.agents.some((a) => a.name === x.name))?.name || 'devils-advocate' }] })} className="text-xs text-antique hover:text-cream inline-flex items-center gap-1"><Plus size={12} /> {t('panel.add', 'Add an agent')}</button>
          )}
        </div>
        <p className="text-xs text-antique mt-1">{t('panel.makeOwn', 'Your own agents: /agent new.')}</p>
      </fieldset>
      {spec.mode !== 'parallel' && (
        <label className="flex items-center gap-2">
          <span className="text-cream">{spec.mode === 'debate' ? t('panel.rounds', 'Rounds') : t('panel.cycles', 'Review rounds')}</span>
          <select className="input !w-20 !py-1" value={spec.mode === 'review' ? Math.max(1, spec.rounds - 1) : spec.rounds} onChange={(e) => set({ rounds: spec.mode === 'review' ? +e.target.value + 1 : +e.target.value })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      {spec.mode !== 'review' && (
        <label className="flex items-center gap-2">
          <span className="text-cream">{t('panel.moderator', 'Who sums up')}</span>
          <select className="input flex-1 !py-1" value={spec.moderator || ''} onChange={(e) => set({ moderator: e.target.value || null })} data-testid="panel-moderator">
            {spec.mode === 'parallel' && <option value="">{t('panel.noSummary', 'Nobody — show the answers side by side')}</option>}
            <option value="judge">{t('panel.judge', 'The judge (the second pass)')}</option>
            {agents.filter((x) => !x.template).map((x) => <option key={x.name} value={x.name}>{agentTitle(x)}</option>)}
          </select>
        </label>
      )}
      <p className="text-xs text-antique">{t('panel.costNote', 'Before a panel uses online AI you see what it will cost and start it yourself. Each agent follows your client-data rule.')}</p>
      <div className="flex gap-2">
        <button type="button" disabled={!ok} className="btn-primary flex-1" onClick={() => onUse(spec)} data-testid="panel-use">{t('panel.use', 'Use for my next question')}</button>
        <button type="button" className="btn-secondary flex-1" onClick={onCancel}>{t('common.cancel', 'Cancel')}</button>
      </div>
    </div>
  )
}

// ── one panel: estimate, lanes, result ─────────────────────────────────────────

interface Lane { lane: string; title: string; side?: string; where?: string | null; local?: boolean; skipped?: boolean; note?: string; status: string; plain: string; round?: number; live: string; models: ModelUse[]; online: string[]; warn?: boolean }
const STATUS_MARK: Record<string, string> = { working: '▸', speaking: '»', done: '✓', failed: '!', stopped: '⏹', waiting: '·', skipped: '–' }

export default function PanelCard({ run, id, onPermission }: { run?: PanelRun; id?: string; onPermission?: (ev: any) => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'loading' | 'confirm' | 'running' | 'done' | 'error' | 'cancelled'>('loading')
  const [estimate, setEstimate] = useState<any>(null)
  const [lanes, setLanes] = useState<Lane[]>([])
  const [round, setRound] = useState<{ round: number; rounds: number } | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const streamId = useRef(`p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
  const started = useRef(false)
  const patchLane = (key: string, fn: (l: Lane) => Lane) => setLanes((ls) => ls.map((l) => (l.lane === key ? fn({ ...l }) : l)))

  const start = useCallback(async () => {
    if (!run || started.current) return
    started.current = true
    setPhase('running')
    const e = engine()
    if (!e?.stream) { setError(t('chat.noEngine', 'The chat needs the OpenLex engine, which runs with the desktop app.')); setPhase('error'); return }
    let failed = ''
    try {
      const r = await e.stream('/api/panel/run', {
        mode: run.spec.mode, agents: run.spec.agents, rounds: run.spec.rounds, moderator: run.spec.moderator, question: run.question, confirmed: true, interactive: true,
        message: run.message, ...(run.matterId ? { matterId: run.matterId } : {}), ...(run.sessionId ? { sessionId: run.sessionId } : {}), ...(run.attachments.length ? { attachments: run.attachments } : {}),
      }, (ev) => {
        switch (ev.type) {
          case 'panel_start':
            setLanes([...ev.members.map((m: any) => ({ lane: m.lane, title: agentTitle(m), side: m.side, where: m.where, local: m.local, skipped: m.skipped, note: m.note, status: m.skipped ? 'skipped' : 'waiting', plain: m.skipped ? t('panel.sitsOut', 'Does not take part') : t('panel.waiting', 'Waiting for its turn'), live: '', models: [], online: [] })),
              ...(ev.moderator ? [{ lane: 'moderator', title: ev.moderator.title, status: 'waiting', plain: t('panel.modWaits', 'Sums up at the end'), live: '', models: [], online: [] }] : [])])
            return
          case 'panel_note': setNotes((n) => [...n, ev.text]); return
          case 'panel_round': setRound({ round: ev.round, rounds: ev.rounds }); return
          case 'panel_lane': patchLane(ev.lane, (l) => ({ ...l, status: ev.status, plain: ev.plain || l.plain, round: ev.round || l.round, warn: !!ev.warn, ...(ev.online && !l.online.includes(ev.online) ? { online: [...l.online, ev.online] } : {}), ...(ev.status === 'working' && l.status !== 'working' ? { live: '' } : {}) })); return
          case 'panel_text': patchLane(ev.lane, (l) => ({ ...l, live: (l.live + (ev.text || '')).slice(-600) })); return
          case 'model': if (ev.lane) patchLane(ev.lane, (l) => ({ ...l, models: addModel(l.models, ev) })); return
          case 'panel_result': setResult(ev.panel); return
          case 'permission': onPermission?.(ev); return
          case 'error': failed = friendly(ev.message); return
          default:
        }
      }, streamId.current)
      if (failed) { setError(failed); setPhase('error'); return }
      setPhase(r?.stopped ? 'done' : 'done')
    } catch (err) { setError(friendly(err)); setPhase('error') }
  }, [run, t, onPermission])

  // A new panel: the estimate first; online AI waits for the lawyer.
  useEffect(() => {
    if (id) {
      engine()?.call('GET', `/api/panel?id=${encodeURIComponent(id)}`).then((r) => { if (r?.error) throw new Error(r.error); setResult(r.panel); setPhase('done') }).catch((err) => { setError(friendly(err)); setPhase('error') })
      return
    }
    if (!run) return
    engine()?.call('POST', '/api/panel/estimate', { mode: run.spec.mode, agents: run.spec.agents, rounds: run.spec.rounds, moderator: run.spec.moderator, matterId: run.matterId })
      .then((r) => {
        if (r?.error) throw new Error(r.error)
        setEstimate(r.estimate)
        if (r.estimate.needsConfirm || r.estimate.capReached) setPhase('confirm')
        else start()
      }).catch((err) => { setError(friendly(err)); setPhase('error') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const stop = () => engine()?.stop?.(streamId.current)

  return (
    <div className="rounded-card border border-accent/40 bg-deep-brown/60 p-4 space-y-3 text-sm" data-testid="panel-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-accent flex items-center gap-1"><Users size={12} /> {t('panel.title', 'Panel')}{result ? ` · ${result.mode === 'debate' ? t('panel.debateN', 'Debate, {{n}} rounds', { n: result.rounds }) : result.mode === 'review' ? t('panel.reviewShort', 'Draft and review') : t('panel.parallelShort', 'Side by side')}` : ''}</div>
          {result && <div className="font-serif text-lg text-parchment">{clip(result.question, 140)}</div>}
        </div>
        {phase === 'running' && (
          <button type="button" onClick={stop} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-button text-xs inline-flex items-center gap-1" data-testid="panel-stop"><Square size={11} fill="currentColor" /> {t('panel.stopAll', 'Stop all')}</button>
        )}
      </div>

      {phase === 'loading' && <div className="text-antique" role="status">{t('panel.estimating', 'Working out what this panel will take…')}</div>}
      {estimate && phase !== 'done' && <div className={`text-xs ${estimate.cloudCalls ? 'text-amber-400' : 'text-forest'}`} data-testid="panel-estimate">{estimate.cloudCalls ? '!' : '✓'} {estimate.text}</div>}
      {phase === 'confirm' && estimate && (
        <div className="space-y-2">
          {estimate.notes?.map((n: string, i: number) => <div key={i} className="text-xs text-amber-400">! {n}</div>)}
          {estimate.agents?.filter((a: any) => !a.skipped).map((a: any) => <div key={a.lane} className="text-xs text-antique">· {agentTitle(a)}: {a.local ? t('panel.onThisComputer', 'on this computer') : a.where} — {t('panel.calls', 'about {{n}} calls', { n: a.calls })}{a.eur ? `, €${a.eur.toFixed(2)}` : ''}</div>)}
          {estimate.capReached ? <div className="text-red-400 text-xs">✗ {t('panel.capReached', 'This month\'s limit for online AI is reached. Use agents on this computer, or raise the limit.')}</div>
            : estimate.overCap ? <div className="text-amber-400 text-xs">! {t('panel.overCap', 'This may go over your monthly limit; the panel stops when the limit is reached and keeps what was said.')}</div> : null}
          <div className="flex gap-2">
            {!estimate.capReached && <button type="button" className="btn-primary !py-1.5 text-xs" onClick={start} data-testid="panel-start">{t('panel.start', 'Start the panel (about €{{eur}})', { eur: estimate.eur.toFixed(2) })}</button>}
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setPhase('cancelled')}>{t('common.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}
      {phase === 'cancelled' && <div className="text-xs text-antique">{t('panel.cancelled', 'Not started. Nothing was sent.')}</div>}

      {(phase === 'running' || (phase === 'done' && lanes.length > 0 && !result)) && (
        <>
          {round && <div className="text-xs text-antique">{t('panel.roundOf', 'Round {{round}} of {{rounds}}', round)}</div>}
          {notes.map((n, i) => <div key={i} className="text-xs text-amber-400">! {n}</div>)}
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]" data-testid="panel-lanes">
            {lanes.map((l) => <LaneBox key={l.lane} l={l} />)}
          </div>
        </>
      )}
      {error && <div className="text-red-400">✗ {error}</div>}
      {result && <PanelResult r={result} lanes={lanes} />}
    </div>
  )
}

function LaneBox({ l }: { l: Lane }) {
  const { t } = useTranslation()
  const speaking = l.status === 'speaking'
  const data = l.models.length ? dataLine(l.models, l.online, l.status === 'working' || speaking) : null
  return (
    <div className={`min-w-0 [overflow-wrap:anywhere] rounded-button border p-2.5 space-y-1 ${speaking ? 'border-accent bg-accent/10' : l.skipped ? 'border-tobacco/40 opacity-70' : 'border-tobacco'}`} data-testid={`lane-${l.lane}`} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="text-cream font-medium truncate">{l.title}</span>
        {speaking && <span className="text-[11px] text-accent inline-flex items-center gap-1"><MessageSquare size={11} /> {t('panel.speaking', 'speaking')}</span>}
      </div>
      {l.side && <div className="text-[11px] text-antique truncate">{l.side}</div>}
      <div className={`text-xs flex gap-1.5 ${l.status === 'failed' || l.warn ? 'text-amber-400' : l.status === 'done' ? 'text-forest' : 'text-parchment'}`}>
        <span aria-hidden="true">{STATUS_MARK[l.status] || '·'}</span><span>{l.plain}{l.round && l.lane !== 'moderator' ? <span className="text-antique"> · {t('panel.roundShort', 'round {{n}}', { n: l.round })}</span> : null}</span>
      </div>
      {speaking && l.live && <div className="text-[11px] text-parchment/80 line-clamp-3">{clip(l.live, 220)}</div>}
      {l.note && <div className="text-[11px] text-amber-400">{l.note}</div>}
      {data ? <div className={`text-[11px] ${data.left ? 'text-amber-400' : 'text-forest'}`} title={data.title}>{data.symbol} {data.text}</div>
        : !l.skipped && l.where ? <div className={`text-[11px] ${l.local ? 'text-forest' : 'text-amber-400'}`}>{l.local ? `✓ ${t('panel.staysHere', 'Runs on this computer')}` : `! ${t('panel.runsOn', 'Runs on {{where}}', { where: l.where })}`}</div> : null}
    </div>
  )
}

function Cites({ ids, sources }: { ids: string[]; sources: any[] }) {
  const { t } = useTranslation()
  if (!ids?.length) return <span className="text-[11px] text-amber-400/80"> [{t('panel.noSource', 'no source')}]</span>
  return <>{ids.map((id) => { const s = sources.find((x) => x.id === id); return <span key={id} className="ml-1 text-[11px] text-accent" title={s ? `${s.label}${s.snippet ? ` — ${s.snippet}` : ''}` : id}>[{id}]</span> })}</>
}

function PanelResult({ r, lanes }: { r: any; lanes: Lane[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [showLanes, setShowLanes] = useState(false)
  const s = r.summary
  // Names in the App's language: built-in roles and templates have a German one (titleDe).
  const nameOf = (x: any) => (x ? agentTitle(x) : '')
  const byLane = (lane: string | null | undefined, fallback: string) => { const m = (r.members || []).find((y: any) => y.lane === lane); return m ? nameOf(m) : fallback }
  const byTitle = (title: string) => { const m = (r.members || []).find((y: any) => y.title === title); return m ? nameOf(m) : title }
  const turnLabel = (x: any) => (r.mode === 'debate' ? `${t('panel.roundShort', 'round {{n}}', { n: x.round })} — ${nameOf(x)}` : r.mode === 'review' ? `${nameOf(x)} — ${x.kind === 'draft' ? t('panel.kDraft', 'draft') : x.kind === 'review' ? t('panel.kReview', 'review') : t('panel.kRevision', 'revision')}` : nameOf(x))
  return (
    <div className="space-y-3" data-testid="panel-result">
      {r.stopped && <div className="text-xs text-amber-400">! {r.stopped === 'cap' ? t('panel.stoppedCap', 'Stopped: the monthly limit for online AI was reached. What was said so far is kept.') : t('panel.stoppedYou', 'Stopped by you. What was said so far is kept; nothing more is sent.')}</div>}
      {r.members.filter((m: any) => m.note).map((m: any) => <div key={m.lane} className="text-xs text-amber-400">! {m.note}</div>)}
      {s && !s.fallback && (
        <div className="space-y-2 border-l-2 border-accent pl-3">
          {s.stronger && <div><span className="text-xs uppercase text-accent">{t('panel.stronger', 'Stronger position')}</span><div className="text-parchment"><span className="text-cream font-medium">{s.stronger.title ? byLane(s.stronger.lane, s.stronger.title) : t('panel.neither', 'Neither clearly')}</span>: {s.stronger.why}<Cites ids={s.stronger.cites} sources={r.sources} /></div></div>}
          {s.agreement.length > 0 && <div><span className="text-xs uppercase text-accent">{t('panel.agree', 'Where they agree')}</span><ul className="list-disc ml-5 text-parchment">{s.agreement.map((a: any, i: number) => <li key={i}>{a.point}<Cites ids={a.cites} sources={r.sources} /></li>)}</ul></div>}
          {s.disagreement.length > 0 && <div><span className="text-xs uppercase text-accent">{t('panel.disagree', 'Where they disagree')}</span><ul className="list-disc ml-5 text-parchment">{s.disagreement.map((d: any, i: number) => <li key={i}>{d.point}<Cites ids={d.cites} sources={r.sources} />{d.positions.map((p: any) => <div key={p.lane} className="text-xs text-antique">{byLane(p.lane, p.title)}: {p.view}</div>)}</li>)}</ul></div>}
          {s.open.length > 0 && <div><span className="text-xs uppercase text-accent">{t('panel.open', 'Open questions')}</span><ul className="list-disc ml-5 text-parchment">{s.open.map((o: any, i: number) => <li key={i}>{o.question}{o.why ? <span className="text-antique"> — {o.why}</span> : null}</li>)}</ul></div>}
          {s.quotes?.length > 0 && <div className="text-xs text-antique">{s.quotes.map((q: any, i: number) => <div key={i}>“{q.text}”{q.source ? <Cites ids={[q.source]} sources={r.sources} /> : null}</div>)}</div>}
          {s.removed ? <div className="text-xs text-antique">✓ {t('panel.removed', '{{count}} citations or quotes of the moderator could not be verified and were removed.', { count: s.removed })}</div> : <div className="text-xs text-antique">✓ {t('panel.citesChecked', 'Every citation points to a source an agent brought.')}</div>}
        </div>
      )}
      {s?.fallback && <div className="text-xs text-amber-400">! {s.note}</div>}
      {r.mode === 'review' && r.final && <div><div className="text-xs uppercase text-accent">{t('panel.final', 'Final draft')}</div><div className="prose-custom max-w-none"><Markdown>{r.final}</Markdown></div></div>}
      <div className="space-y-1">
        <div className="text-xs font-medium text-parchment">{r.mode === 'parallel' ? t('panel.answers', 'The answers') : t('panel.transcript', 'Who said what')}</div>
        {r.turns.map((x: any, i: number) => (
          <div key={i} className="border-t border-tobacco/40 pt-1">
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} aria-expanded={!!open[i] || r.mode === 'parallel'} className="w-full flex items-center justify-between text-left text-xs text-cream hover:text-accent">
              <span>{turnLabel(x)}{x.noSource ? <span className="text-amber-400"> · {t('panel.citedNone', 'cited no source')}</span> : null}</span>
              {open[i] || r.mode === 'parallel' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {(open[i] || r.mode === 'parallel') && <div className="prose-custom max-w-none text-sm mt-1">{x.error ? <span className="text-red-400">✗ {x.error}</span> : <Markdown>{x.text}</Markdown>}</div>}
          </div>
        ))}
      </div>
      {r.sources.length > 0 && (
        <div className="border-t border-tobacco/50 pt-2">
          <div className="text-xs font-medium text-parchment mb-1">{t('panel.sources', 'Sources the agents brought')}</div>
          <ul className="space-y-0.5 text-xs text-parchment/90">{r.sources.map((x: any) => <li key={x.id}><span className="text-accent">[{x.id}]</span> {x.label}{x.snippet ? <span className="text-antique"> — {clip(x.snippet, 100)}</span> : null} <span className="text-antique">({x.by.map(byTitle).join(', ')})</span></li>)}</ul>
          <div className="text-[11px] text-antique/70 mt-1">{sourcesNote(r.sources)}</div>
        </div>
      )}
      {lanes.length > 0 && (
        <div className="text-xs text-antique">
          <button type="button" className="underline" onClick={() => setShowLanes(!showLanes)}>{showLanes ? t('panel.hideWhere', 'Hide where each agent ran') : t('panel.showWhere', 'Where each agent ran')}</button>
          {showLanes && <div className="grid gap-2 mt-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">{lanes.map((l) => <LaneBox key={l.lane} l={l} />)}</div>}
        </div>
      )}
      <ExportButtons path="/api/panel/export" id={r.id} formats={['docx', 'pdf', 'md']} save={{ kind: 'panel', matterId: r.matterId, source: { kind: 'panel', id: r.id } }} />
    </div>
  )
}
