// Many documents at once (a folder, a data room): read one by one in the
// background by the engine (POST /api/batch/*), with progress, Stop and
// Resume. Before a big run with an online AI service the lawyer sees the
// estimate ("about 480 pages, roughly 640,000 tokens to Claude (EU), est.
// $3.10") and starts it themselves.
// The same card runs every kind of batch: the full analysis per document,
// an investigation (/investigate) and due diligence (/diligence); when the
// last document is read, the overall result appears as its card. A batch
// started earlier (`jobId`, from the conversation) is followed again.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Pause, Play } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'
import AnalysisCard from './AnalysisCard'
import InvestigationCard from './InvestigationCard'
import DiligenceCard from './DiligenceCard'

const STATUS: Record<string, string> = { waiting: '·', reading: '▸', done: '✓', failed: '!', skipped: '–' }

export default function BatchCard({ attachments = [], matterId, onStarted, kind = 'analyse', options, jobId, sessionId, message }: {
  attachments?: string[]
  matterId: string | null
  onStarted?: (id: string) => void
  kind?: 'analyse' | 'investigate' | 'diligence'
  options?: Record<string, unknown>
  /** A batch started earlier: follow it (no new estimate). */
  jobId?: string
  /** The conversation it belongs to (it comes back there). */
  sessionId?: string | null
  message?: string
}) {
  const { t } = useTranslation()
  const [estimate, setEstimate] = useState<any>(null)
  const [job, setJob] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const poll = useCallback(async (id: string) => {
    try {
      const r = await engine()!.call('GET', `/api/batch?id=${encodeURIComponent(id)}`)
      setJob(r.batch)
      if (r.batch.state === 'running' || r.batch.state === 'finishing') timer.current = setTimeout(() => poll(id), 1500)
    } catch (err) { setError(friendly(err)) }
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const r = await engine()!.call('POST', '/api/batch/start', { attachments, kind, ...(options ? { options } : {}), ...(matterId ? { matterId } : {}), ...(sessionId ? { sessionId, message } : {}), confirmed: true })
      setJob(r.batch)
      onStarted?.(r.batch.id)
      poll(r.batch.id)
    } catch (err) { setError(friendly(err)) }
  }, [attachments, kind, options, matterId, sessionId, message, onStarted, poll])

  useEffect(() => {
    if (jobId) { poll(jobId); return }
    engine()?.call('POST', '/api/batch/estimate', { attachments, kind, ...(matterId ? { matterId } : {}) })
      .then((r) => { setEstimate(r.estimate); if (!r.estimate.needsConfirm) start() })
      .catch((err) => setError(friendly(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = async () => { try { const r = await engine()!.call('POST', '/api/batch/stop', { id: job.id }); setJob(r.batch); clearTimeout(timer.current) } catch (err) { setError(friendly(err)) } }
  const resume = async () => { try { const r = await engine()!.call('POST', '/api/batch/resume', { id: job.id }); setJob(r.batch); poll(job.id) } catch (err) { setError(friendly(err)) } }

  const k = job?.kind || kind
  const title = k === 'investigate' ? t('batch.titleInvestigate', 'Investigation: reading the documents one by one') : k === 'diligence' ? t('batch.titleDiligence', 'Due diligence: reviewing the documents one by one') : t('batch.title', 'Several documents, one by one')
  const c = job?.counts
  const running = job && (job.state === 'running' || job.state === 'finishing')
  const question = String(job?.options?.question || options?.question || '')
  return (
    <div className="space-y-3">
      <div className="rounded-card border border-accent/40 bg-deep-brown/60 p-4 space-y-2 text-sm" data-testid="batch-card">
        <div className="text-xs uppercase tracking-wide text-accent">{title}</div>
        {k === 'investigate' && question ? <p className="text-parchment">{question}</p> : null}
        {estimate && <p className="text-parchment" data-testid="batch-estimate">{estimate.sentence}</p>}
        {estimate?.cost?.basis && <p className="text-[11px] text-antique">{t('batch.costBasis', 'Estimate at')} {estimate.cost.basis}.</p>}
        {estimate?.skipped ? <p className="text-xs text-amber-400">! {t('batch.skippedFiles', '{{n}} files are skipped (too large or unreadable).', { n: estimate.skipped })}</p> : null}
        {estimate && estimate.needsConfirm && !job && !cancelled && (
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-primary !py-1.5 text-sm" onClick={start} data-testid="batch-start">{t('batch.startRun', 'Start')}</button>
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setCancelled(true)}>{t('batch.cancel', 'Not now')}</button>
          </div>
        )}
        {cancelled && !job && <p className="text-xs text-antique">{t('batch.cancelled', 'Not started. Nothing was sent.')}</p>}
        {job && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded bg-tobacco/40 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${c.total ? Math.round(((c.done + c.failed + c.skipped) / c.total) * 100) : 0}%` }} /></div>
              <span className="text-xs text-antique tabular-nums" data-testid="batch-progress">{t('batch.progress', '{{done}} / {{total}} done', { done: c.done, total: c.total })}{c.failed ? ` · ${t('batch.failedCount', '{{n}} failed', { n: c.failed })}` : ''}</span>
              {running
                ? <button type="button" onClick={stop} className="btn-secondary !px-2.5 !py-1 text-xs inline-flex items-center gap-1"><Pause size={12} /> {t('batch.stop', 'Stop')}</button>
                : job.state !== 'done' && <button type="button" onClick={resume} className="btn-secondary !px-2.5 !py-1 text-xs inline-flex items-center gap-1"><Play size={12} /> {t('batch.resume', 'Resume')}</button>}
            </div>
            {job.note && <p className="text-xs text-amber-400">! {job.note}</p>}
            <ul className="space-y-1">
              {(job.files || []).map((f: any) => (
                <li key={f.file}>
                  <button type="button" disabled={!f.analysisId} onClick={() => setOpen(open === f.file ? null : f.file)} className="w-full text-left text-xs flex items-center gap-2 text-parchment/90 disabled:cursor-default">
                    <span className={f.status === 'failed' ? 'text-amber-400' : f.status === 'done' ? 'text-forest' : 'text-accent'}>{STATUS[f.status] || '·'}</span>
                    <span className="flex-1 truncate">{f.name}{f.pages ? <span className="text-antique"> · {f.pages} {t('batch.pagesShort', 'p.')}</span> : null}</span>
                    {f.risks && <span className="text-antique">{t('batch.risks', '{{high}} high · {{medium}} medium', { high: f.risks.high, medium: f.risks.medium })}</span>}
                    {k === 'investigate' && f.status === 'done' && <span className="text-antique">{t('investigation.findingsCount', '{{count}} findings', { count: f.findings || 0 })}</span>}
                    {k === 'diligence' && f.status === 'done' && <span className="text-antique">{t('diligence.flagCount', '{{count}} flags', { count: f.flags || 0 })}{f.docType ? ` · ${f.docType}` : ''}</span>}
                    {f.note && <span className="text-amber-400 truncate max-w-[40%]">{f.note}</span>}
                    {f.analysisId && (open === f.file ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </button>
                  {open === f.file && f.analysisId && <div className="mt-2"><AnalysisCard id={f.analysisId} /></div>}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-antique">
              {job.state === 'finishing' ? (k === 'investigate' ? t('batch.comparing', 'All documents read: comparing them and checking the comparison…') : t('batch.summarising', 'All documents read: writing the summary…'))
                : job.state === 'done' ? (k === 'analyse' ? t('batch.finished', 'Finished. Each report is also in the matter folder.') : t('batch.finishedTool', 'Finished.'))
                  : job.state === 'running' ? t('batch.background', 'Runs in the background: you can keep working; Stop keeps what is done.')
                    : t('batch.stopped', 'Stopped. Resume goes on with the next document.')}
            </p>
          </>
        )}
        {error && <p className="text-xs text-red-400">✗ {error}</p>}
      </div>
      {job?.result?.kind === 'investigation' && <InvestigationCard id={job.result.id} />}
      {job?.result?.kind === 'diligence' && <DiligenceCard id={job.result.id} />}
    </div>
  )
}
