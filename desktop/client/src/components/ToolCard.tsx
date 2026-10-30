// The chat tools that moved from the old desktop server, as cards in the
// conversation:
//   <ToolCard tool={…}/>      a tool just asked for (/investigate, /diligence, /draft): starts it
//   <ResultCard result={…}/>  a result kept in the conversation ({ kind, id } from the engine)
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'
import AnalysisCard from './AnalysisCard'
import BatchCard from './BatchCard'
import DiligenceCard from './DiligenceCard'
import DraftCard from './DraftCard'
import InvestigationCard from './InvestigationCard'
import PanelCard from './Panel'

export interface ToolRun {
  name: 'investigate' | 'diligence' | 'draft'
  arg: string
  attachments: string[]
  matterId: string | null
  sessionId: string | null
  message: string
  options?: Record<string, unknown>
  /** The confirmed redaction check (online AI). */
  redactionCheck?: string
}

export interface Result { kind: string; id: string; name?: string }

export function ResultCard({ result, matterId }: { result: Result; matterId: string | null }) {
  switch (result.kind) {
    case 'analysis': return <AnalysisCard id={result.id} />
    case 'batch': return <BatchCard jobId={result.id} matterId={matterId} />
    case 'investigation': return <InvestigationCard id={result.id} />
    case 'diligence': return <DiligenceCard id={result.id} />
    case 'draft': return <DraftCard id={result.id} />
    case 'panel': return <PanelCard id={result.id} />
    default: return null
  }
}

export default function ToolCard({ tool }: { tool: ToolRun }) {
  if (tool.name === 'draft') return <StartDraft tool={tool} />
  return <BatchCard kind={tool.name} attachments={tool.attachments} matterId={tool.matterId} options={tool.options} sessionId={tool.sessionId} message={tool.message} redactionCheck={tool.redactionCheck} />
}

/** /draft: the engine writes the first draft (or takes the attached document), then the draft card. */
function StartDraft({ tool }: { tool: ToolRun }) {
  const { t } = useTranslation()
  const [id, setId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    engine()?.call('POST', '/api/draft', { instruction: tool.arg, attachments: tool.attachments, ...(tool.matterId ? { matterId: tool.matterId } : {}), ...(tool.sessionId ? { sessionId: tool.sessionId, message: tool.message } : {}) })
      .then((r) => setId(r.draft.id)).catch((err) => setError(friendly(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (error) return <div className="text-sm text-red-400">✗ {error}</div>
  if (!id) return <div className="text-sm text-antique" role="status">{tool.arg ? t('draft.writingFirst', 'Writing the first draft… (this can take a minute)') : t('draft.opening', 'Opening the document as a draft…')}</div>
  return <DraftCard id={id} />
}
