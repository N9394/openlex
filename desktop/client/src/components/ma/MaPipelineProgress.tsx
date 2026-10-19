import { useState, useEffect, useRef } from 'react'
import { CheckCircle, Circle, Loader2, Pause, AlertTriangle, Clock } from 'lucide-react'
import { streamMaPipeline } from '../../lib/api'

const STAGES = [
  { key: 'classify', label: 'Classify' },
  { key: 'plan', label: 'Plan' },
  { key: 'plan_review', label: 'Review' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'rag_verify', label: 'Verify' },
  { key: 'risk_review', label: 'Risk Review' },
  { key: 'synthesize', label: 'Synthesize' },
  { key: 'report', label: 'Report' },
  { key: 'counsel_signoff', label: 'Sign-Off' },
  { key: 'completed', label: 'Complete' },
]

interface PipelineEvent {
  type: string
  data: Record<string, unknown>
  time: Date
}

interface Props {
  dealId: string
  currentStage: string
  dealStatus: string
  onCheckpoint?: (data: { stage: string; proposal: Record<string, unknown> }) => void
  onUpdate?: () => void
}

export default function MaPipelineProgress({ dealId, currentStage, dealStatus, onCheckpoint, onUpdate }: Props) {
  const [events, setEvents] = useState<PipelineEvent[]>([])
  const [connected, setConnected] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const [activeDoc, setActiveDoc] = useState<string | null>(null)
  const [stageItems, setStageItems] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 })
  const [estimatedSeconds, setEstimatedSeconds] = useState<number>(0)

  useEffect(() => {
    if (!dealId || dealStatus === 'created' || dealStatus === 'completed') return

    const controller = streamMaPipeline(dealId, {
      onState: (data) => {
        setConnected(true)
        addEvent('state', data)
      },
      onStageStart: (data) => {
        setStageItems({ completed: 0, total: data.totalItems })
        setEstimatedSeconds(0)
        addEvent('stage_start', data)
      },
      onStageComplete: (data) => {
        addEvent('stage_complete', data)
        setEstimatedSeconds(0)
        onUpdate?.()
      },
      onDocClassified: (data) => {
        setStageItems(s => ({ ...s, completed: s.completed + 1 }))
        if (typeof data.estimatedSeconds === 'number') setEstimatedSeconds(data.estimatedSeconds as number)
        addEvent('doc_classified', data)
      },
      onDocAnalyzing: (data) => {
        setActiveDoc(data.docName)
        if (typeof data.estimatedSeconds === 'number') setEstimatedSeconds(data.estimatedSeconds as number)
        addEvent('doc_analyzing', data)
      },
      onDocAnalyzed: (data) => {
        setStageItems(s => ({ ...s, completed: s.completed + 1 }))
        setActiveDoc(null)
        addEvent('doc_analyzed', data)
        onUpdate?.()
      },
      onRiskVerified: (data) => {
        setStageItems(s => ({ ...s, completed: s.completed + 1 }))
        if (typeof data.estimatedSeconds === 'number') setEstimatedSeconds(data.estimatedSeconds as number)
        addEvent('risk_verified', data)
      },
      onSynthesisProgress: (data) => {
        addEvent('synthesis_progress', data)
      },
      onCheckpoint: (data) => {
        addEvent('checkpoint', data)
        onCheckpoint?.(data)
        onUpdate?.()
      },
      onError: (data) => {
        addEvent('error', data)
      },
      onPaused: (data) => {
        addEvent('paused', data)
      },
      onDone: () => {
        addEvent('done', {})
        onUpdate?.()
      },
    })

    controllerRef.current = controller

    return () => {
      controller.abort()
    }
  }, [dealId, dealStatus])

  const addEvent = (type: string, data: Record<string, unknown>) => {
    setEvents(prev => [...prev.slice(-50), { type, data, time: new Date() }])
  }

  const getStageStatus = (stageKey: string) => {
    const stageIndex = STAGES.findIndex(s => s.key === stageKey)
    const currentIndex = STAGES.findIndex(s => s.key === currentStage)

    if (dealStatus === 'completed') return 'complete'
    if (dealStatus === 'failed') return stageIndex <= currentIndex ? 'failed' : 'pending'
    if (dealStatus === 'paused') return stageIndex < currentIndex ? 'complete' : stageIndex === currentIndex ? 'paused' : 'pending'
    // Checkpoint statuses map to the matching stage key
    const checkpointStatuses = ['plan_review', 'risk_review', 'counsel_signoff']
    if (checkpointStatuses.includes(dealStatus)) {
      const checkIdx = STAGES.findIndex(s => s.key === dealStatus)
      if (stageIndex < checkIdx) return 'complete'
      if (stageIndex === checkIdx) return 'paused'
      return 'pending'
    }
    if (stageIndex < currentIndex) return 'complete'
    if (stageIndex === currentIndex) return 'active'
    return 'pending'
  }

  const StageIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'complete': return <CheckCircle size={14} className="text-green-400" />
      case 'active': return <Loader2 size={14} className="text-accent animate-spin" />
      case 'paused': return <Pause size={14} className="text-amber-400" />
      case 'failed': return <AlertTriangle size={14} className="text-red-400" />
      default: return <Circle size={14} className="text-antique/30" />
    }
  }

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h3 className="font-serif text-lg text-parchment">Pipeline Progress</h3>
        <div className="flex items-center gap-3">
          {estimatedSeconds > 0 && (
            <span className="flex items-center gap-1 text-xs text-antique">
              <Clock size={12} />
              ~{formatEta(estimatedSeconds)} remaining
            </span>
          )}
          {connected && <span className="text-xs text-green-400">Connected</span>}
        </div>
      </div>

      {/* Stage bar */}
      <div className="flex items-center gap-0.5 mb-4 overflow-x-auto">
        {STAGES.map((stage, i) => {
          const status = getStageStatus(stage.key)
          return (
            <div key={stage.key} className="flex items-center flex-shrink-0">
              <div className="flex flex-col items-center">
                <StageIcon status={status} />
                <span className={`text-[10px] mt-1 whitespace-nowrap ${status === 'active' ? 'text-accent' : status === 'complete' ? 'text-green-400/70' : 'text-antique/50'}`}>
                  {stage.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`w-4 h-0.5 mx-0.5 ${status === 'complete' ? 'bg-green-400/50' : 'bg-tobacco'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Progress detail */}
      {stageItems.total > 0 && dealStatus !== 'completed' && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-antique mb-1">
            <span>{activeDoc || currentStage}</span>
            <span>{stageItems.completed}/{stageItems.total}</span>
          </div>
          <div className="w-full bg-tobacco rounded-full h-1.5">
            <div
              className="bg-accent rounded-full h-1.5 transition-all duration-300"
              style={{ width: `${Math.min(100, (stageItems.completed / stageItems.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Recent events */}
      {events.length > 0 && (
        <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">
          {events.slice(-8).reverse().map((event, i) => (
            <div key={i} className="flex gap-2 text-antique">
              <span className="text-antique/50 flex-shrink-0">
                {event.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="truncate">
                {formatEvent(event)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatEvent(event: PipelineEvent): string {
  const d = event.data
  switch (event.type) {
    case 'stage_start': return `Stage ${d.stage} started (${d.totalItems} items)`
    case 'stage_complete': return `Stage ${d.stage} complete${d.elapsedMs ? ` (${Math.round((d.elapsedMs as number) / 1000)}s)` : ''}`
    case 'doc_classified': return `Classified: ${d.docName} → ${d.type} (${d.jurisdiction})${d.retries ? ` [${d.retries} retries]` : ''}`
    case 'doc_analyzing': return `Analyzing: ${d.docName} (chunk ${d.chunk}/${d.totalChunks})`
    case 'doc_analyzed': return `Analyzed: ${d.docName} — ${d.riskCount} risks, ${d.warrantyCount} warranties`
    case 'risk_verified': return `Verified: ${d.title} — ${d.verified ? 'confirmed' : 'unverified'}${d.retries ? ` [${d.retries} retries]` : ''}`
    case 'synthesis_progress': return `Synthesizing: ${d.substage}`
    case 'checkpoint': return `Checkpoint: ${d.stage} — awaiting review`
    case 'error': return `Error: ${d.message}`
    case 'paused': return `Pipeline paused at ${d.stage}`
    case 'done': return 'Pipeline complete'
    default: return event.type
  }
}
