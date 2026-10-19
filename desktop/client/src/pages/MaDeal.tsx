import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Briefcase, Loader2, Play, Pause, FileText, AlertTriangle,
  Shield, ScrollText, ArrowLeft, Settings2, ClipboardList, BookOpen, Download, PenTool,
} from 'lucide-react'
import { maApi, type Deal, type DealCheckpoint } from '../lib/api'
import MaPipelineProgress from '../components/ma/MaPipelineProgress'
import MaCheckpointDialog from '../components/ma/MaCheckpointDialog'
import MaDocumentUpload from '../components/ma/MaDocumentUpload'
import MaRiskDashboard from '../components/ma/MaRiskDashboard'
import MaWarrantyHeatmap from '../components/ma/MaWarrantyHeatmap'
import MaDisclosureTable from '../components/ma/MaDisclosureTable'
import MaWniReadiness from '../components/ma/MaWniReadiness'
import MaRedliner from '../components/ma/MaRedliner'
import MaAuditLog from '../components/ma/MaAuditLog'

type Tab = 'overview' | 'risks' | 'warranties' | 'disclosures' | 'wni' | 'redliner' | 'documents' | 'audit'

export default function MaDeal() {
  const { t } = useTranslation()
  const { dealId } = useParams<{ dealId: string }>()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [pendingCheckpoint, setPendingCheckpoint] = useState<DealCheckpoint | null>(null)
  const [pipelineAction, setPipelineAction] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const loadDeal = useCallback(async () => {
    if (!dealId) return
    try {
      const data = await maApi.getDeal(dealId)
      setDeal(data)

      // Check for pending checkpoint
      const pending = data.checkpoints?.find(c => c.status === 'pending')
      setPendingCheckpoint(pending || null)
    } catch (err) {
      console.error('Failed to load deal:', err)
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => {
    loadDeal()
  }, [loadDeal])

  const handlePause = async () => {
    if (!deal) return
    setPipelineAction(true)
    try {
      await maApi.pausePipeline(deal.id)
      await loadDeal()
    } catch (err) {
      console.error('Failed to pause:', err)
    } finally {
      setPipelineAction(false)
    }
  }

  const handleResume = async () => {
    if (!deal) return
    setPipelineAction(true)
    try {
      await maApi.resumePipeline(deal.id)
      await loadDeal()
    } catch (err) {
      console.error('Failed to resume:', err)
    } finally {
      setPipelineAction(false)
    }
  }

  const handleStart = async () => {
    if (!deal) return
    setPipelineAction(true)
    try {
      await maApi.startPipeline(deal.id)
      await loadDeal()
    } catch (err) {
      console.error('Failed to start:', err)
    } finally {
      setPipelineAction(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 size={24} className="mx-auto text-antique animate-spin" />
      </div>
    )
  }

  if (!deal) {
    return (
      <div className="p-8 text-center">
        <p className="text-antique">{t('ma.deal')} — {t('common.unavailable')}</p>
      </div>
    )
  }

  const isRunning = ['classifying', 'analyzing', 'rag_verifying', 'synthesizing', 'reporting'].includes(deal.status)
  const isComplete = deal.status === 'completed'
  const isPaused = deal.status === 'paused'
  const hasCheckpoint = ['plan_review', 'risk_review', 'playbook_pending', 'counsel_signoff'].includes(deal.status)

  const tabs: { key: Tab; label: string; icon: JSX.Element; count?: number }[] = [
    { key: 'overview', label: t('ma.overview'), icon: <Briefcase size={14} /> },
    { key: 'risks', label: t('ma.risks'), icon: <AlertTriangle size={14} />, count: deal.risks?.length },
    { key: 'warranties', label: t('ma.warranties'), icon: <Shield size={14} />, count: deal.warranties?.length },
    { key: 'disclosures', label: t('ma.disclosures'), icon: <ScrollText size={14} />, count: deal.disclosures?.length },
    { key: 'wni', label: t('ma.wi'), icon: <BookOpen size={14} /> },
    { key: 'redliner', label: t('ma.redliner'), icon: <PenTool size={14} /> },
    { key: 'documents', label: t('ma.documentsTab', 'Documents'), icon: <FileText size={14} />, count: deal.documents?.length },
    { key: 'audit', label: t('ma.audit'), icon: <ClipboardList size={14} />, count: deal._count?.auditEvents },
  ]

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/ma" className="text-antique hover:text-cream transition-colors flex-shrink-0">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0">
            <h1 className="font-serif text-2xl text-parchment truncate">{deal.name}</h1>
            <p className="text-antique text-sm truncate">
              {deal.perspective.charAt(0).toUpperCase() + deal.perspective.slice(1)} — {deal.dealType.replace('_', ' ')}{deal.industry ? ` — ${deal.industry.replace('_', ' ')}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          <Link to={`/ma/${deal.id}/setup`} className="btn-secondary text-sm flex items-center gap-1">
            <Settings2 size={14} /> Setup
          </Link>
          {isRunning && (
            <button onClick={handlePause} disabled={pipelineAction} className="btn-secondary text-sm flex items-center gap-1">
              <Pause size={14} /> Pause
            </button>
          )}
          {isPaused && !hasCheckpoint && (
            <button onClick={handleResume} disabled={pipelineAction} className="btn-primary text-sm flex items-center gap-1">
              <Play size={14} /> Resume
            </button>
          )}
          {(deal.status === 'created' || deal.status === 'failed') && (
            <button onClick={handleStart} disabled={pipelineAction} className="btn-primary text-sm flex items-center gap-1">
              <Play size={14} /> Start Analysis
            </button>
          )}
          {isComplete && (
            <div className="relative">
              <button onClick={() => setExportOpen(o => !o)} className="btn-secondary text-sm flex items-center gap-1">
                <Download size={14} /> Export
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-walnut border border-tobacco rounded-button shadow-lg z-20 min-w-[160px]">
                    <button onClick={() => { maApi.exportDeal(deal.id, 'docx'); setExportOpen(false) }} className="block w-full text-left px-4 py-2 text-sm text-cream hover:bg-leather/50 whitespace-nowrap">DOCX Report</button>
                    <button onClick={() => { maApi.exportDeal(deal.id, 'pdf'); setExportOpen(false) }} className="block w-full text-left px-4 py-2 text-sm text-cream hover:bg-leather/50 whitespace-nowrap">PDF Report</button>
                    <button onClick={() => { maApi.exportDeal(deal.id, 'csv'); setExportOpen(false) }} className="block w-full text-left px-4 py-2 text-sm text-cream hover:bg-leather/50 whitespace-nowrap">CSV Audit Log</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline progress */}
      {(isRunning || isPaused || hasCheckpoint) && deal.job && (
        <div className="mb-6">
          <MaPipelineProgress
            dealId={deal.id}
            currentStage={deal.job.currentStage}
            dealStatus={deal.status}
            onCheckpoint={() => loadDeal()}
            onUpdate={loadDeal}
          />
        </div>
      )}

      {/* Checkpoint dialog */}
      {pendingCheckpoint && (
        <div className="mb-6">
          <MaCheckpointDialog
            dealId={deal.id}
            checkpointId={pendingCheckpoint.id}
            stage={pendingCheckpoint.stage}
            proposal={(() => { try { return pendingCheckpoint.proposal ? JSON.parse(pendingCheckpoint.proposal) : {} } catch { return {} } })()}
            onResolved={loadDeal}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-tobacco">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-antique hover:text-cream'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-leather">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={<FileText size={16} />} label="Documents" value={deal.documents?.length || 0} color="text-blue-400" />
              <StatCard icon={<AlertTriangle size={16} />} label="Risks" value={deal.risks?.length || 0} color="text-red-400" />
              <StatCard icon={<Shield size={16} />} label="Warranties" value={deal.warranties?.length || 0} color="text-amber-400" />
              <StatCard icon={<ScrollText size={16} />} label="Disclosures" value={deal.disclosures?.length || 0} color="text-green-400" />
            </div>

            {/* Risk breakdown (if we have risks) */}
            {(deal.risks?.length || 0) > 0 && (
              <div className="card">
                <h3 className="font-serif text-lg text-parchment mb-4">Risk Summary</h3>
                <MaRiskDashboard risks={deal.risks || []} />
              </div>
            )}

            {deal.executiveSummary && (
              <div className="card">
                <h3 className="font-serif text-lg text-parchment mb-2">Executive Summary</h3>
                <p className="text-cream text-sm whitespace-pre-wrap">{deal.executiveSummary}</p>
              </div>
            )}

            {(deal.risks?.length || 0) === 0 && !deal.executiveSummary && (
              <div className="card text-center py-12">
                <Briefcase size={48} className="mx-auto text-antique/30 mb-4" />
                <p className="text-antique">
                  {deal.status === 'created'
                    ? 'Upload documents and start the analysis pipeline.'
                    : 'Analysis in progress. Results will appear here.'}
                </p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="card">
              <h4 className="text-cream font-medium mb-3">{t('common.details')}</h4>
              <div className="space-y-2 text-sm">
                <InfoRow label="Status" value={deal.status} />
                <InfoRow label="Perspective" value={deal.perspective} />
                <InfoRow label="Type" value={deal.dealType.replace('_', ' ')} />
                {deal.industry && <InfoRow label="Industry" value={deal.industry.replace('_', ' ')} />}
                <InfoRow label="Created" value={new Date(deal.createdAt).toLocaleDateString()} />
                {deal.completedAt && <InfoRow label="Completed" value={new Date(deal.completedAt).toLocaleDateString()} />}
              </div>
            </div>

            {(deal.parties?.length || 0) > 0 && (
              <div className="card">
                <h4 className="text-cream font-medium mb-3">{t('ma.parties', 'Parties')}</h4>
                <div className="space-y-2">
                  {(deal.parties || []).map(p => (
                    <div key={p.id} className="text-sm">
                      <span className="text-cream">{p.name}</span>
                      <span className="text-antique ml-2">{p.role} ({p.jurisdiction})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {deal.job && (
              <div className="card">
                <h4 className="text-cream font-medium mb-3">Pipeline Stats</h4>
                <div className="space-y-2 text-sm">
                  <InfoRow label="LLM Calls" value={String(deal.job.totalLLMCalls)} />
                  <InfoRow label="Tokens" value={formatTokens(deal.job.totalTokens)} />
                  <InfoRow label="Duration" value={formatDuration(deal.job.totalDurationMs)} />
                </div>
                {isComplete && (
                  <button
                    onClick={async () => {
                      try {
                        const result = await maApi.cleanupFiles(deal.id)
                        alert(`Freed ${result.freedMB} MB of raw files.`)
                      } catch { alert('Cleanup failed.') }
                    }}
                    className="mt-3 text-xs text-antique hover:text-cream transition-colors"
                  >
                    Cleanup raw files
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'risks' && (
        <MaRiskDashboard risks={deal.risks || []} />
      )}

      {activeTab === 'warranties' && (
        <MaWarrantyHeatmap
          dealId={deal.id}
          warranties={deal.warranties || []}
          onUpdate={loadDeal}
        />
      )}

      {activeTab === 'disclosures' && (
        <MaDisclosureTable
          disclosures={deal.disclosures || []}
          disclosureGaps={deal.disclosureGaps}
        />
      )}

      {activeTab === 'wni' && (
        <MaWniReadiness wniReadiness={deal.wniReadiness} />
      )}

      {activeTab === 'redliner' && (
        <MaRedliner
          dealId={deal.id}
          warranties={deal.warranties || []}
          onUpdate={loadDeal}
        />
      )}

      {activeTab === 'documents' && (
        <MaDocumentUpload
          dealId={deal.id}
          documents={deal.documents || []}
          onUpdate={loadDeal}
        />
      )}

      {activeTab === 'audit' && (
        <MaAuditLog dealId={deal.id} />
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: JSX.Element; label: string; value: number; color: string }) {
  return (
    <div className="card text-center">
      <div className={`${color} flex items-center justify-center gap-1 mb-1`}>
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-parchment text-2xl font-serif">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-antique">{label}</span>
      <span className="text-cream capitalize">{value}</span>
    </div>
  )
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1000000).toFixed(1)}M`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}
