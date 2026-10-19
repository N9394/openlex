import { useState, useEffect } from 'react'
import { ClipboardList, Filter, Loader2 } from 'lucide-react'
import { maApi } from '../../lib/api'

interface AuditEvent {
  id: string
  stage: string
  eventType: string
  detail?: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  createdAt: string
}

interface Props {
  dealId: string
}

const STAGES = [
  'all', 'classify', 'plan', 'analyze', 'rag_verify',
  'risk_review', 'synthesize', 'playbook', 'report', 'counsel_signoff',
]

export default function MaAuditLog({ dealId }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('all')
  const [limit, setLimit] = useState(100)

  const loadEvents = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { limit: String(limit) }
      if (stageFilter !== 'all') params.stage = stageFilter
      const data = await maApi.getAuditLog(dealId, params as { stage?: string; limit?: number })
      setEvents((data as { events: AuditEvent[]; total: number }).events || [])
      setTotal((data as { events: AuditEvent[]; total: number }).total || 0)
    } catch (err) {
      console.error('Failed to load audit:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [dealId, stageFilter, limit])

  // Compute stats
  const totalTokens = events.reduce((sum, e) => sum + (e.inputTokens || 0) + (e.outputTokens || 0), 0)
  const totalDuration = events.reduce((sum, e) => sum + (e.durationMs || 0), 0)
  const stageCounts: Record<string, number> = {}
  for (const e of events) {
    stageCounts[e.stage] = (stageCounts[e.stage] || 0) + 1
  }

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h3 className="font-serif text-lg text-parchment">Audit Log</h3>
        <div className="flex flex-wrap items-center gap-3">
          {/* Stats */}
          <span className="text-antique text-xs">
            {total} events &bull; {formatTokens(totalTokens)} tokens &bull; {formatDuration(totalDuration)}
          </span>

          {/* Stage filter */}
          <div className="flex items-center gap-1">
            <Filter size={12} className="text-antique" />
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              className="input text-xs py-1 px-2 bg-leather border-tobacco"
            >
              {STAGES.map(s => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All Stages' : s.replace('_', ' ')}
                  {s !== 'all' && stageCounts[s] ? ` (${stageCounts[s]})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <Loader2 size={20} className="mx-auto text-antique animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-8 text-antique">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          <p>No audit events{stageFilter !== 'all' ? ` for stage "${stageFilter}"` : ''}.</p>
        </div>
      ) : (
        <>
          <div className="space-y-0.5 max-h-[600px] overflow-y-auto">
            {events.map(event => (
              <div key={event.id} className="flex items-center gap-2 sm:gap-3 py-1.5 px-2 text-sm hover:bg-leather/50 rounded group">
                <span className="text-antique/50 text-xs w-16 sm:w-20 flex-shrink-0 truncate">
                  {new Date(event.createdAt).toLocaleTimeString()}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded text-center flex-shrink-0 w-20 sm:w-24 ${stageColor(event.stage)}`}>
                  {event.stage}
                </span>
                <span className="text-cream flex-1 truncate">{event.eventType}</span>
                {(event.inputTokens > 0 || event.outputTokens > 0) && (
                  <span className="text-antique/50 text-xs hidden group-hover:inline">
                    {event.inputTokens}+{event.outputTokens} tok
                  </span>
                )}
                {event.durationMs > 0 && (
                  <span className="text-antique text-xs w-14 text-right hidden sm:block">{(event.durationMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            ))}
          </div>

          {events.length < total && (
            <button
              onClick={() => setLimit(l => l + 100)}
              className="w-full mt-3 text-center text-xs text-accent hover:underline py-2"
            >
              Load more ({events.length}/{total})
            </button>
          )}
        </>
      )}
    </div>
  )
}

function stageColor(stage: string): string {
  const map: Record<string, string> = {
    classify: 'bg-blue-500/10 text-blue-400',
    plan: 'bg-purple-500/10 text-purple-400',
    analyze: 'bg-amber-500/10 text-amber-400',
    rag_verify: 'bg-cyan-500/10 text-cyan-400',
    risk_review: 'bg-red-500/10 text-red-400',
    synthesize: 'bg-green-500/10 text-green-400',
    playbook: 'bg-orange-500/10 text-orange-400',
    report: 'bg-emerald-500/10 text-emerald-400',
    counsel_signoff: 'bg-violet-500/10 text-violet-400',
  }
  return map[stage] || 'bg-leather text-antique'
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1000000).toFixed(1)}M`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}
