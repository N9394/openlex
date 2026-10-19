import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ClipboardList, Search, ChevronDown, ChevronRight,
  X, Shield, ShieldCheck, ShieldAlert, Clock, Database,
  Brain, AlertTriangle, CheckCircle2, XCircle, Minus, FileText,
  Loader2, Globe, Scale, RefreshCw, ShieldX, FileDown, Compass, MessageSquare, Download
} from 'lucide-react'
import { api, apiBase } from '../lib/api'

// ── Types ──────────────────────────────────────────────────────

interface RAGSearchAudit {
  query: string
  expandedQueries?: string[]
  jurisdiction: string
  sourceTypes?: string[]
  resultsCount: number
  results: Array<{
    id: string
    sourceName: string
    relevanceScore: number
    rerankerScore?: number
    wasUsed: boolean
  }>
  searchDurationMs: number
}

interface NLIVerificationAudit {
  claim: string
  sourceText: string
  sourceRef: string
  result: 'entailment' | 'contradiction' | 'neutral' | 'llm_supported' | 'judge_flagged' | 'judge_regenerated' | 'judge_removed' | 'verified_by_regen' | 'not_checked'
  confidence: number
  verificationDurationMs: number
  judgeReason?: string
}

interface LLMCallAudit {
  model: string
  provider: string
  taskType: string
  inputTokens?: number
  outputTokens?: number
  temperature: number
  durationMs: number
  usedFallback: boolean
}

interface SourceUsed {
  id: string
  sourceName: string
  citation?: string
  excerpt?: string
}

interface ClaimOutcome {
  claim: string
  originalClaim?: string | null
  status: 'verified' | 'regenerated' | 'removed' | 'unverified'
  confidence: number
  sourceRef?: string | null
  nliLabel?: string | null
  judgeReason?: string | null
}

interface AuditEntry {
  id: string
  requestType: string
  userQuery: string
  response: string
  overallConfidence: string
  jurisdiction?: string | null
  jurisdictionSource?: string | null
  createdAt: string
  userId: string
  user?: { id?: string; username?: string; email?: string }
  ragSearches: RAGSearchAudit[]
  nliVerifications: NLIVerificationAudit[]
  llmCalls: LLMCallAudit[]
  sourcesUsed: SourceUsed[]
  nliVerifiedClaims: number
  totalClaims: number
  quotesVerified: number  // repurposed: claims regenerated
  totalQuotes: number     // repurposed: claims removed
  quoteVerifications: ClaimOutcome[] // repurposed: per-claim outcomes
  totalDurationMs: number
  conversationId?: string | null
}

type Tab = 'dashboard' | 'trail'

// ── Helpers ────────────────────────────────────────────────────

const formatRequestType = (type: string) =>
  (type || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const requestTypeIcon = (type: string) => {
  switch (type) {
    case 'document_export': return <FileDown size={12} />
    case 'document_analysis': return <FileText size={12} />
    case 'research_chat': return <MessageSquare size={12} />
    case 'navigator': return <Compass size={12} />
    default: return null
  }
}

/** Count verified claims — prefer quoteVerifications (new), fall back to nliVerifications (legacy) */
const countVerified = (entry: AuditEntry): number => {
  if (entry.quoteVerifications && entry.quoteVerifications.length > 0) {
    return entry.quoteVerifications.filter(c =>
      c.status === 'verified' || c.status === 'regenerated'
    ).length
  }
  if (entry.nliVerifications && entry.nliVerifications.length > 0) {
    return entry.nliVerifications.filter(v =>
      v.result === 'llm_supported' ||
      v.result === 'judge_regenerated' ||
      v.result === 'verified_by_regen' ||
      (v.result === 'entailment' && v.confidence >= 0.7)
    ).length
  }
  return entry.nliVerifiedClaims || 0
}

const confidenceColor = (c: string) => {
  switch (c) {
    case 'high': return 'text-emerald-400 bg-emerald-500/10'
    case 'medium': return 'text-amber-400 bg-amber-500/10'
    case 'low': return 'text-red-400 bg-red-500/10'
    default: return 'text-antique bg-deep-brown'
  }
}

const nliColor = (result: string) => {
  switch (result) {
    case 'entailment': case 'llm_supported': return 'text-emerald-400 bg-emerald-500/10'
    case 'neutral': return 'text-amber-400 bg-amber-500/10'
    case 'contradiction': return 'text-red-400 bg-red-500/10'
    case 'judge_flagged': case 'judge_regenerated': case 'judge_removed': return 'text-amber-400 bg-amber-500/10'
    default: return 'text-antique bg-deep-brown'
  }
}

const friendlyLabel = (label: string, t: (k: string) => string) => {
  switch (label) {
    case 'llm_supported': return t('audit.labels.verified')
    case 'entailment': return t('audit.labels.nliConfirmed')
    case 'neutral': return t('audit.labels.unconfirmed')
    case 'contradiction': return t('audit.labels.contradicted')
    case 'judge_flagged': return t('audit.labels.flagged')
    case 'judge_regenerated': return t('audit.labels.rewritten')
    case 'judge_removed': return t('audit.labels.removed')
    case 'not_checked': return t('audit.labels.notChecked')
    default: return label
  }
}

const nliIcon = (result: string) => {
  switch (result) {
    case 'entailment': return <CheckCircle2 size={14} className="text-emerald-400" />
    case 'neutral': return <Minus size={14} className="text-amber-400" />
    case 'contradiction': return <XCircle size={14} className="text-red-400" />
    default: return <AlertTriangle size={14} className="text-antique" />
  }
}

const formatDate = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const formatMs = (ms: number) => {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const claimStatusColor = (status: string) => {
  switch (status) {
    case 'verified': return 'text-emerald-400 bg-emerald-500/10'
    case 'regenerated': return 'text-amber-400 bg-amber-500/10'
    case 'removed': return 'text-red-400 bg-red-500/10'
    default: return 'text-antique bg-deep-brown'
  }
}

const claimStatusIcon = (status: string) => {
  switch (status) {
    case 'verified': return <ShieldCheck size={14} className="text-emerald-400" />
    case 'regenerated': return <RefreshCw size={14} className="text-amber-400" />
    case 'removed': return <ShieldX size={14} className="text-red-400" />
    default: return <AlertTriangle size={14} className="text-antique" />
  }
}

// ── Main Component ─────────────────────────────────────────────

export default function Audit() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [dashEntries, setDashEntries] = useState<AuditEntry[]>([])
  const [trailEntries, setTrailEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [trailLoading, setTrailLoading] = useState(false)

  // Trail state
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterConf, setFilterConf] = useState('all')
  const [filterJuris, setFilterJuris] = useState('all')

  // Detail overlay
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null)
  const [expandedQuery, setExpandedQuery] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    response: false, sources: true, nli: true, rag: false, llm: false,
  })

  // ── Data Loading ───────────────────────────────────────────

  useEffect(() => {
    loadDashboard()
  }, [])

  useEffect(() => {
    if (tab === 'trail') loadTrail()
  }, [tab, page, filterType, filterConf, filterJuris])

  const loadDashboard = async () => {
    try {
      const data = await api.get('/audit/ai?limit=200')
      const logs = Array.isArray(data) ? data : data.logs || []
      setDashEntries(logs)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadTrail = async () => {
    setTrailLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (filterType !== 'all') params.set('requestType', filterType)
      if (filterConf !== 'all') params.set('confidence', filterConf)
      if (filterJuris !== 'all') params.set('jurisdiction', filterJuris)
      const data = await api.get(`/audit/ai?${params}`)
      const logs = Array.isArray(data) ? data : data.logs || []
      setTrailEntries(logs)
      setTotalPages(data.pages || 1)
    } catch (err) {
      console.error('Failed to load trail:', err)
    } finally {
      setTrailLoading(false)
    }
  }

  // ── Dashboard Metrics ──────────────────────────────────────

  const stats = useMemo(() => {
    const entries = dashEntries
    const withClaims = entries.filter(e => (e.totalClaims || 0) > 0)
    const totalClaims = entries.reduce((s, e) => s + (e.totalClaims || 0), 0)
    const verified = entries.reduce((s, e) => s + countVerified(e), 0)
    const regenerated = entries.reduce((s, e) => s + (e.quoteVerifications || []).filter(c => c.status === 'regenerated').length, 0)
    const removed = entries.reduce((s, e) => s + (e.quoteVerifications || []).filter(c => c.status === 'removed').length, 0)
    const effectiveVerified = verified + regenerated
    const hallucinationRate = totalClaims > 0 ? (removed / totalClaims * 100) : 0
    const nliPassRate = totalClaims > 0 ? (effectiveVerified / totalClaims * 100) : 0

    // Duration stats
    const durations = entries.filter(e => e.totalDurationMs > 0).map(e => e.totalDurationMs)
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    const gpuCalls = entries.flatMap(e => (e.llmCalls || []).filter(c => !c.usedFallback))
    const cpuCalls = entries.flatMap(e => (e.llmCalls || []).filter(c => c.usedFallback))
    const avgGpu = gpuCalls.length > 0 ? gpuCalls.reduce((s, c) => s + c.durationMs, 0) / gpuCalls.length : 0
    const avgCpu = cpuCalls.length > 0 ? cpuCalls.reduce((s, c) => s + c.durationMs, 0) / cpuCalls.length : 0

    // Confidence distribution
    const confDist = { high: 0, medium: 0, low: 0, unverified: 0 }
    entries.forEach(e => {
      const c = e.overallConfidence as keyof typeof confDist
      if (c in confDist) confDist[c]++
      else confDist.unverified++
    })

    // Failure hotspots — group by jurisdiction
    const jurisFailures: Record<string, { low: number; total: number; removals: number }> = {}
    entries.forEach(e => {
      const j = e.jurisdiction || 'Unknown'
      if (!jurisFailures[j]) jurisFailures[j] = { low: 0, total: 0, removals: 0 }
      jurisFailures[j].total++
      if (e.overallConfidence === 'low' || !e.overallConfidence) jurisFailures[j].low++
      jurisFailures[j].removals += (e.totalQuotes || 0)
    })

    // Failure hotspots — group by request type
    const typeFailures: Record<string, { low: number; total: number; removals: number }> = {}
    entries.forEach(e => {
      const t = e.requestType || 'unknown'
      if (!typeFailures[t]) typeFailures[t] = { low: 0, total: 0, removals: 0 }
      typeFailures[t].total++
      if (e.overallConfidence === 'low' || !e.overallConfidence) typeFailures[t].low++
      typeFailures[t].removals += (e.totalQuotes || 0)
    })

    // Recent failures
    const recentFailures = entries
      .filter(e => e.overallConfidence === 'low' || !e.overallConfidence || e.overallConfidence === 'unverified')
      .slice(0, 5)

    return {
      totalEntries: entries.length, withClaims: withClaims.length,
      totalClaims, verified, regenerated, removed, effectiveVerified,
      hallucinationRate, nliPassRate,
      avgDuration, avgGpu, avgCpu, confDist,
      jurisFailures, typeFailures, recentFailures,
    }
  }, [dashEntries])

  // Unique filter values from dashboard data
  const requestTypes = useMemo(() => [...new Set(dashEntries.map(e => e.requestType).filter(Boolean))], [dashEntries])
  const jurisdictions = useMemo(() => [...new Set(dashEntries.map(e => e.jurisdiction).filter(Boolean) as string[])], [dashEntries])

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Client-side search filter for trail
  const filteredTrail = useMemo(() => {
    if (!search) return trailEntries
    const q = search.toLowerCase()
    return trailEntries.filter(e =>
      (e.userQuery || '').toLowerCase().includes(q) ||
      (e.requestType || '').toLowerCase().includes(q)
    )
  }, [trailEntries, search])

  // ── Export ──────────────────────────────────────────────────

  const mapEntries = (entries: AuditEntry[]) => entries.map(e => {
    // Enrich claim outcomes with judgeReason from nliVerifications (same logic as detail overlay)
    const rawQv: ClaimOutcome[] = e.quoteVerifications || []
    const nli: NLIVerificationAudit[] = e.nliVerifications || []
    const claims = rawQv.map(c => {
      if (c.judgeReason) return c
      const match = nli.find(v => v.judgeReason && v.claim && c.claim && (
        v.claim === c.claim || v.claim === c.originalClaim
      ))
      return match ? { ...c, judgeReason: match.judgeReason } : c
    })
    return {
      id: e.id,
      requestType: e.requestType,
      userQuery: e.userQuery,
      confidence: e.overallConfidence,
      jurisdiction: e.jurisdiction || '',
      totalClaims: e.totalClaims || 0,
      claimsVerified: countVerified(e),
      claimsRegenerated: e.quotesVerified || 0,
      claimsRemoved: e.totalQuotes || 0,
      sourcesCount: (e.sourcesUsed || []).length,
      durationMs: e.totalDurationMs,
      date: e.createdAt,
      claims,
    }
  })

  const handleExport = async (format: 'csv' | 'json' | 'docx' | 'pdf') => {
    const entries = tab === 'trail' ? filteredTrail : dashEntries
    if (!entries.length) return

    // Server-rendered formats
    if (format === 'docx' || format === 'pdf') {
      try {
        const url = `${apiBase()}/api/research/export/audit/${format}`
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ entries: mapEntries(entries) }),
        })
        if (!response.ok) throw new Error('Export failed')
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `lexvault-audit-${new Date().toISOString().split('T')[0]}.${format}`
        a.click()
        URL.revokeObjectURL(blobUrl)
      } catch (err) {
        console.error(`${format.toUpperCase()} export failed:`, err)
      }
      return
    }

    // Client-side formats
    let content: string
    let mime: string
    let ext: string

    if (format === 'json') {
      content = JSON.stringify(mapEntries(entries), null, 2)
      mime = 'application/json'
      ext = 'json'
    } else {
      const headers = ['Date', 'Type', 'Query', 'Confidence', 'Jurisdiction', 'Claims', 'Verified', 'Regenerated', 'Removed', 'Sources', 'Duration (ms)']
      const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`
      const rows = entries.map(e => [
        e.createdAt, e.requestType, escape(e.userQuery), e.overallConfidence,
        e.jurisdiction || '', e.totalClaims || 0, countVerified(e),
        e.quotesVerified || 0, e.totalQuotes || 0,
        (e.sourcesUsed || []).length, e.totalDurationMs,
      ].join(','))
      content = [headers.join(','), ...rows].join('\n')
      mime = 'text/csv'
      ext = 'csv'
    }

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lexvault-audit-${new Date().toISOString().split('T')[0]}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <Scale size={28} className="text-accent" />
            <h1 className="font-serif text-3xl text-parchment">{t('audit.title')}</h1>
          </div>
          <div className="relative group">
            <button className="btn-secondary flex items-center gap-2 !px-4 !py-2 text-sm">
              <Download size={16} />
              {t('common.export')}
            </button>
            <div className="absolute right-0 top-full mt-2 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[160px]">
              <button
                onClick={() => handleExport('csv')}
                className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
              >
                {t('audit.exportAs.csv')}
              </button>
              <button
                onClick={() => handleExport('json')}
                className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
              >
                {t('audit.exportAs.json')}
              </button>
              <button
                onClick={() => handleExport('docx')}
                className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
              >
                {t('audit.exportAs.docx')}
              </button>
              <button
                onClick={() => handleExport('pdf')}
                className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
              >
                {t('audit.exportAs.pdf')}
              </button>
            </div>
          </div>
        </div>
        <p className="text-antique">
          {t('audit.complianceTagline')}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-deep-brown rounded-button p-1 w-fit">
        <button
          onClick={() => setTab('dashboard')}
          className={`px-4 py-2 rounded-button text-sm font-medium transition-all ${
            tab === 'dashboard' ? 'bg-accent/15 text-accent' : 'text-antique hover:text-cream'
          }`}
        >
          <Shield size={14} className="inline mr-1.5 -mt-0.5" />
          {t('audit.tabs.dashboard')}
        </button>
        <button
          onClick={() => setTab('trail')}
          className={`px-4 py-2 rounded-button text-sm font-medium transition-all ${
            tab === 'trail' ? 'bg-accent/15 text-accent' : 'text-antique hover:text-cream'
          }`}
        >
          <FileText size={14} className="inline mr-1.5 -mt-0.5" />
          {t('audit.tabs.trail')}
        </button>
      </div>

      {tab === 'dashboard' ? renderDashboard() : renderTrail()}

      {/* Detail overlay */}
      {selectedEntry && renderDetailOverlay()}
    </div>
  )

  // ── Dashboard Tab ──────────────────────────────────────────

  function renderDashboard() {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Hero metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Hallucination Rate */}
          <div className={`card py-4 px-5 border ${
            stats.hallucinationRate <= 1 ? 'border-forest/40' :
            stats.hallucinationRate <= 5 ? 'border-amber-500/40' : 'border-burgundy/40'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {stats.hallucinationRate <= 1
                ? <ShieldCheck size={18} className="text-emerald-400" />
                : <ShieldAlert size={18} className="text-red-400" />}
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.metrics.removalRate')}</span>
            </div>
            <div className={`text-3xl font-bold ${
              stats.hallucinationRate <= 1 ? 'text-emerald-400' :
              stats.hallucinationRate <= 5 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {stats.totalClaims > 0 ? `${stats.hallucinationRate.toFixed(1)}%` : '—'}
            </div>
            <div className="mt-2 w-full bg-deep-brown rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  stats.hallucinationRate <= 1 ? 'bg-emerald-500' :
                  stats.hallucinationRate <= 5 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(stats.hallucinationRate, 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-antique mt-1">
              {t('audit.metrics.removalTarget', { removed: stats.removed, total: stats.totalClaims })}
            </div>
          </div>

          {/* NLI Pass Rate */}
          <div className="card py-4 px-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.metrics.verificationRate')}</span>
            </div>
            <div className="text-3xl font-bold text-parchment">
              {stats.totalClaims > 0 ? `${stats.nliPassRate.toFixed(1)}%` : '—'}
            </div>
            <div className="mt-2 w-full bg-deep-brown rounded-full h-2">
              <div className="h-2 rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(stats.nliPassRate, 100)}%` }} />
            </div>
            <div className="text-[10px] text-antique mt-1">
              {t('audit.metrics.verifiedBreakdown', { verified: stats.verified, regenerated: stats.regenerated, total: stats.totalClaims })}
            </div>
          </div>

          {/* Avg Duration */}
          <div className="card py-4 px-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={18} className="text-accent" />
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.metrics.avgResponseTime')}</span>
            </div>
            <div className="text-3xl font-bold text-parchment">
              {formatMs(stats.avgDuration)}
            </div>
            <div className="text-[10px] text-antique mt-3 space-y-0.5">
              {stats.avgGpu > 0 && <div>{t('audit.metrics.gpuCuda', { ms: formatMs(stats.avgGpu) })}</div>}
              {stats.avgCpu > 0 && <div>{t('audit.metrics.cpuFallback', { ms: formatMs(stats.avgCpu) })}</div>}
              <div>{t('audit.metrics.totalAudited', { count: stats.totalEntries })}</div>
            </div>
          </div>

          {/* Self-Correction */}
          <div className="card py-4 px-5">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw size={18} className="text-amber-400" />
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.metrics.selfCorrection')}</span>
            </div>
            <div className="text-3xl font-bold text-parchment">
              {stats.regenerated}
            </div>
            <div className="text-[10px] text-antique mt-3 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                {t('audit.metrics.claimsRewritten', { count: stats.regenerated })}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {t('audit.metrics.claimsRemoved', { count: stats.removed })}
              </div>
              {stats.totalClaims > 0 && (
                <div className="text-antique mt-1">
                  {t('audit.metrics.correctionPct', { pct: ((stats.regenerated + stats.removed) / stats.totalClaims * 100).toFixed(1) })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confidence distribution bar */}
        <div className="card py-4 px-5">
          <div className="text-xs text-antique uppercase tracking-wide mb-3">{t('audit.metrics.confidenceDistribution')}</div>
          <div className="flex rounded-full overflow-hidden h-4 bg-deep-brown">
            {stats.confDist.high > 0 && (
              <div className="bg-emerald-500 transition-all" title={`High: ${stats.confDist.high}`}
                style={{ width: `${(stats.confDist.high / stats.totalEntries) * 100}%` }} />
            )}
            {stats.confDist.medium > 0 && (
              <div className="bg-amber-500 transition-all" title={`Medium: ${stats.confDist.medium}`}
                style={{ width: `${(stats.confDist.medium / stats.totalEntries) * 100}%` }} />
            )}
            {stats.confDist.low > 0 && (
              <div className="bg-red-500 transition-all" title={`Low: ${stats.confDist.low}`}
                style={{ width: `${(stats.confDist.low / stats.totalEntries) * 100}%` }} />
            )}
            {stats.confDist.unverified > 0 && (
              <div className="bg-tobacco transition-all" title={`Unverified: ${stats.confDist.unverified}`}
                style={{ width: `${(stats.confDist.unverified / stats.totalEntries) * 100}%` }} />
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-cream-dark">{t('audit.confidence.high')}: {stats.confDist.high}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="text-cream-dark">{t('audit.confidence.medium')}: {stats.confDist.medium}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-cream-dark">{t('audit.confidence.low')}: {stats.confDist.low}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-tobacco" />
              <span className="text-cream-dark">{t('audit.confidence.unverified')}: {stats.confDist.unverified}</span>
            </span>
          </div>
        </div>

        {/* Failure hotspots */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* By jurisdiction */}
          <div className="card py-4 px-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe size={16} className="text-antique" />
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.hotspots.byJurisdiction')}</span>
            </div>
            <div className="space-y-2">
              {Object.entries(stats.jurisFailures)
                .sort((a, b) => (b[1].low + b[1].removals) - (a[1].low + a[1].removals))
                .slice(0, 5)
                .map(([j, d]) => (
                  <div key={j} className="flex items-center justify-between gap-3 bg-deep-brown rounded-button px-3 py-2">
                    <span className="text-cream text-sm font-medium truncate min-w-0">{j}</span>
                    <div className="flex items-center gap-3 text-xs flex-shrink-0">
                      {d.removals > 0 && (
                        <span className="text-red-400 whitespace-nowrap">{t('audit.hotspots.removedCount', { count: d.removals })}</span>
                      )}
                      <span className="text-antique whitespace-nowrap">
                        {t('audit.hotspots.lowTotal', { low: d.low, total: d.total })}
                      </span>
                      <span className={`font-medium whitespace-nowrap ${
                        d.total > 0 && (d.low / d.total) > 0.1 ? 'text-red-400' : 'text-cream-dark'
                      }`}>
                        {t('audit.hotspots.failPct', { pct: d.total > 0 ? `${((d.low / d.total) * 100).toFixed(0)}%` : '0%' })}
                      </span>
                    </div>
                  </div>
                ))}
              {Object.keys(stats.jurisFailures).length === 0 && (
                <div className="text-antique text-sm">{t('audit.noDataYet')}</div>
              )}
            </div>
          </div>

          {/* By request type */}
          <div className="card py-4 px-5">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} className="text-antique" />
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.hotspots.byRequestType')}</span>
            </div>
            <div className="space-y-2">
              {Object.entries(stats.typeFailures)
                .sort((a, b) => (b[1].low + b[1].removals) - (a[1].low + a[1].removals))
                .slice(0, 5)
                .map(([rt, d]) => (
                  <div key={rt} className="flex items-center justify-between gap-3 bg-deep-brown rounded-button px-3 py-2">
                    <span className="text-cream text-sm font-medium truncate min-w-0 inline-flex items-center gap-1.5">{requestTypeIcon(rt)}{formatRequestType(rt)}</span>
                    <div className="flex items-center gap-3 text-xs flex-shrink-0">
                      {d.removals > 0 && (
                        <span className="text-red-400 whitespace-nowrap">{t('audit.hotspots.removedCount', { count: d.removals })}</span>
                      )}
                      <span className="text-antique whitespace-nowrap">
                        {t('audit.hotspots.lowTotal', { low: d.low, total: d.total })}
                      </span>
                      <span className={`font-medium whitespace-nowrap ${
                        d.total > 0 && (d.low / d.total) > 0.1 ? 'text-red-400' : 'text-cream-dark'
                      }`}>
                        {t('audit.hotspots.failPct', { pct: d.total > 0 ? `${((d.low / d.total) * 100).toFixed(0)}%` : '0%' })}
                      </span>
                    </div>
                  </div>
                ))}
              {Object.keys(stats.typeFailures).length === 0 && (
                <div className="text-antique text-sm">{t('audit.noDataYet')}</div>
              )}
            </div>
          </div>
        </div>

        {/* Recent failures */}
        {stats.recentFailures.length > 0 && (
          <div className="card py-4 px-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-red-400" />
              <span className="text-xs text-antique uppercase tracking-wide">{t('audit.recentLowConfidence')}</span>
            </div>
            <div className="space-y-2">
              {stats.recentFailures.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => { setSelectedEntry(entry); setExpandedQuery(false); setExpandedSections({ response: false, sources: true, nli: true, rag: false, llm: false }) }}
                  className="w-full text-left bg-deep-brown rounded-button px-3 py-2 hover:border-accent/30 border border-transparent transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs bg-leather text-accent px-2 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1">{requestTypeIcon(entry.requestType)}{formatRequestType(entry.requestType)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${confidenceColor(entry.overallConfidence)}`}>
                        {entry.overallConfidence || t('audit.confidence.unverified')}
                      </span>
                      {entry.jurisdiction && <span className="text-xs text-antique flex-shrink-0">{entry.jurisdiction}</span>}
                    </div>
                    <span className="text-xs text-antique flex-shrink-0">{formatDate(entry.createdAt)}</span>
                  </div>
                  <p className="text-cream text-sm truncate">{entry.userQuery}</p>
                  <div className="text-[10px] text-antique mt-1">
                    {entry.totalClaims > 0
                      ? t('audit.claimsVerifiedRatio', { verified: countVerified(entry), total: entry.totalClaims })
                      : t('audit.noClaimsVerified')
                    } · {t('audit.sourcesCount', { count: (entry.sourcesUsed || []).length })} · {formatMs(entry.totalDurationMs)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Trail Tab ──────────────────────────────────────────────

  function renderTrail() {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="search-input-wrapper flex-1 min-w-[200px]">
            <Search size={18} className="search-icon" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('common.search')} className="input w-full"
            />
          </div>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1) }} className="input">
            <option value="all">{t('audit.filters.allTypes')}</option>
            {requestTypes.map(rt => <option key={rt} value={rt}>{formatRequestType(rt)}</option>)}
          </select>
          <select value={filterConf} onChange={e => { setFilterConf(e.target.value); setPage(1) }} className="input">
            <option value="all">{t('audit.filters.allConfidence')}</option>
            <option value="high">{t('audit.confidence.high')}</option>
            <option value="medium">{t('audit.confidence.medium')}</option>
            <option value="low">{t('audit.confidence.low')}</option>
          </select>
          <select value={filterJuris} onChange={e => { setFilterJuris(e.target.value); setPage(1) }} className="input">
            <option value="all">{t('audit.filters.allJurisdictions')}</option>
            {jurisdictions.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>

        {/* Entry list */}
        {trailLoading ? (
          <div className="text-center py-12">
            <Loader2 size={24} className="animate-spin text-accent mx-auto" />
          </div>
        ) : filteredTrail.length === 0 ? (
          <div className="text-center py-12">
            <ClipboardList size={48} className="mx-auto text-antique mb-4" />
            <div className="text-cream-dark mb-2">{t('audit.noEvents')}</div>
            <p className="text-antique text-sm">{t('audit.adjustFilters')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTrail.map(entry => (
              <button
                key={entry.id}
                onClick={() => { setSelectedEntry(entry); setExpandedQuery(false); setExpandedSections({ response: false, sources: true, nli: true, rag: false, llm: false }) }}
                className="card w-full text-left hover:border-accent/30 cursor-pointer py-4 transition-all"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="text-xs bg-deep-brown text-accent px-2 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1">{requestTypeIcon(entry.requestType)}{formatRequestType(entry.requestType)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${confidenceColor(entry.overallConfidence)}`}>
                      {entry.overallConfidence || t('audit.confidence.unverified')}
                    </span>
                    {entry.jurisdiction && (
                      <span className="text-xs text-antique bg-deep-brown px-2 py-0.5 rounded flex-shrink-0">{entry.jurisdiction}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-xs text-antique">
                    <span>{formatMs(entry.totalDurationMs)}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                </div>
                <p className="text-cream text-sm font-medium mb-1 truncate">{entry.userQuery}</p>
                <div className="flex items-center gap-3 text-[11px] text-antique">
                  <span>
                    {entry.totalClaims > 0
                      ? <>{t('audit.claimsVerifiedRatio', { verified: countVerified(entry), total: entry.totalClaims })}</>
                      : t('audit.noVerificationData')}
                  </span>
                  <span>·</span>
                  <span>{t('audit.sourcesCount', { count: (entry.sourcesUsed || []).length })}</span>
                  <span>·</span>
                  <span>{t('audit.aiVerified')}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 py-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-30"
            >
              {t('common.previous')}
            </button>
            <span className="text-antique text-sm">{t('audit.pageOf', { page, total: totalPages })}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-30"
            >
              {t('common.next')}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Detail Overlay ─────────────────────────────────────────

  function renderDetailOverlay() {
    const e = selectedEntry!
    const nliVers = e.nliVerifications || []
    const rawClaimOutcomes: ClaimOutcome[] = e.quoteVerifications || []
    // Enrich old entries: backfill judgeReason from nliVerifications if missing
    const claimOutcomes: ClaimOutcome[] = rawClaimOutcomes.map(c => {
      if (c.judgeReason) return c
      const match = nliVers.find((v: NLIVerificationAudit) => v.judgeReason && v.claim && c.claim && (
        v.claim === c.claim || v.claim === c.originalClaim
      ))
      return match ? { ...c, judgeReason: match.judgeReason } : c
    })
    const ragSearches = e.ragSearches || []
    const llmCalls = e.llmCalls || []
    const sources = e.sourcesUsed || []
    const claimsRegenerated = claimOutcomes.filter(c => c.status === 'regenerated').length
    const claimsRemoved = claimOutcomes.filter(c => c.status === 'removed').length
    const hasClaimOutcomes = claimOutcomes.length > 0

    return (
      <div
        className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto"
        onClick={() => setSelectedEntry(null)}
      >
        <div
          className="card max-w-3xl w-full animate-fade-in max-h-[90vh] flex flex-col my-auto"
          onClick={ev => ev.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4 flex-shrink-0">
            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="text-xs bg-deep-brown text-accent px-2 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1">{requestTypeIcon(e.requestType)}{formatRequestType(e.requestType)}</span>
                <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${confidenceColor(e.overallConfidence)}`}>
                  {e.overallConfidence || t('audit.confidence.unverified')}
                </span>
                {e.jurisdiction && <span className="text-xs text-antique bg-deep-brown px-2 py-0.5 rounded flex-shrink-0">{e.jurisdiction}</span>}
              </div>
              {e.userQuery && e.userQuery.length > 200 ? (
                <div>
                  <div className={expandedQuery ? 'max-h-32 overflow-y-auto rounded border border-tobacco/30 p-2' : ''}>
                    <p className={`font-serif text-sm text-parchment leading-snug break-words ${expandedQuery ? '' : 'line-clamp-3'}`}>
                      {e.userQuery}
                    </p>
                  </div>
                  <button
                    onClick={() => setExpandedQuery(!expandedQuery)}
                    className="text-[11px] text-accent hover:underline mt-1"
                  >
                    {expandedQuery ? t('common.showLess') : t('audit.showFullQuery', { chars: e.userQuery.length })}
                  </button>
                </div>
              ) : (
                <h2 className="font-serif text-lg text-parchment leading-snug break-words">{e.userQuery}</h2>
              )}
              <div className="text-xs text-antique mt-1">
                {formatDate(e.createdAt)}
                {e.user?.username && <> · {e.user.username}</>}
                {e.conversationId && <> · {t('audit.session', { id: e.conversationId.slice(0, 8) })}</>}
              </div>
            </div>
            <button onClick={() => setSelectedEntry(null)} className="text-antique hover:text-cream flex-shrink-0">
              <X size={20} />
            </button>
          </div>

          {/* Footer metrics bar */}
          <div className="flex items-center gap-4 text-xs bg-deep-brown rounded-button px-3 py-2 mb-4 flex-shrink-0 flex-wrap">
            <span className="text-cream-dark">
              {t('audit.detail.claims')}: <span className={e.totalClaims > 0 && countVerified(e) === e.totalClaims ? 'text-emerald-400' : 'text-amber-400'}>
                {t('audit.claimsVerifiedRatio', { verified: countVerified(e), total: e.totalClaims })}
              </span>
              {claimsRegenerated > 0 && <span className="text-amber-400 ml-1">{t('audit.detail.plusRewritten', { count: claimsRegenerated })}</span>}
              {claimsRemoved > 0 && <span className="text-red-400 ml-1">{t('audit.detail.minusRemoved', { count: claimsRemoved })}</span>}
            </span>
            <span className="text-cream-dark">{t('audit.detail.sources')}: {sources.length}</span>
            <span className="text-cream-dark">{t('audit.detail.duration')}: {formatMs(e.totalDurationMs)}</span>
            {llmCalls.length > 0 && llmCalls[0].usedFallback && (
              <span className="text-amber-400">{t('audit.detail.cpuFallback')}</span>
            )}
          </div>

          {/* Scrollable sections */}
          <div className="overflow-y-auto flex-1 space-y-3 pr-1">

            {/* Response */}
            <div className="bg-deep-brown rounded-button">
              <button onClick={() => toggleSection('response')} className="flex items-center gap-2 w-full text-left px-4 py-3">
                {expandedSections.response ? <ChevronDown size={14} className="text-antique" /> : <ChevronRight size={14} className="text-antique" />}
                <span className="text-cream text-sm font-medium">{t('audit.sections.response')}</span>
                <span className="text-[10px] text-antique ml-auto">{e.response ? t('audit.charsCount', { count: e.response.length }) : t('audit.empty')}</span>
              </button>
              {expandedSections.response && (
                <div className="px-4 pb-3">
                  <div className="max-h-60 overflow-y-auto rounded border border-tobacco/30 p-2">
                    <p className="text-cream-dark text-xs leading-relaxed whitespace-pre-wrap break-words">{e.response || t('audit.noResponse')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Claim Verification — the crown jewel */}
            <div className="bg-deep-brown rounded-button">
              <button onClick={() => toggleSection('nli')} className="flex items-center gap-2 w-full text-left px-4 py-3">
                {expandedSections.nli ? <ChevronDown size={14} className="text-antique" /> : <ChevronRight size={14} className="text-antique" />}
                <Shield size={14} className="text-accent" />
                <span className="text-cream text-sm font-medium">{t('audit.sections.claimVerification')}</span>
                <span className="text-[10px] text-antique ml-auto flex items-center gap-2">
                  {hasClaimOutcomes ? (
                    <>
                      <span className="text-emerald-400">{t('audit.summary.verifiedCount', { count: claimOutcomes.filter(c => c.status === 'verified').length })}</span>
                      {claimsRegenerated > 0 && <span className="text-amber-400">{t('audit.summary.rewrittenCount', { count: claimsRegenerated })}</span>}
                      {claimsRemoved > 0 && <span className="text-red-400">{t('audit.summary.removedCount', { count: claimsRemoved })}</span>}
                    </>
                  ) : nliVers.length > 0 ? (
                    t('audit.summary.verifiedRatio', { verified: nliVers.filter(v => v.result === 'llm_supported' || v.result === 'judge_regenerated' || v.result === 'verified_by_regen').length, total: nliVers.length })
                  ) : t('audit.summary.noVerifications')}
                </span>
              </button>
              {expandedSections.nli && (
                <div className="px-4 pb-3">
                  <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                  {/* Show enriched claim outcomes if available */}
                  {hasClaimOutcomes ? (
                    claimOutcomes.map((c, i) => (
                      <div key={i} className="border border-tobacco/50 rounded-button p-3">
                        <div className="flex items-start gap-2 mb-2">
                          {claimStatusIcon(c.status)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${claimStatusColor(c.status)}`}>
                                {c.status}
                              </span>
                              {c.confidence > 0 && (
                                <span className="text-[10px] text-antique">{t('audit.confidencePct', { pct: (c.confidence * 100).toFixed(0) })}</span>
                              )}
                              {c.nliLabel && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${nliColor(c.nliLabel)}`}>
                                  {friendlyLabel(c.nliLabel, t)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="ml-5 space-y-1.5">
                          {c.status === 'regenerated' && c.originalClaim && (
                            <div>
                              <div className="text-[10px] text-antique uppercase tracking-wide mb-0.5">{t('audit.fields.originalInaccurate')}</div>
                              <p className="text-red-400/70 text-xs leading-relaxed line-through break-words">{c.originalClaim}</p>
                            </div>
                          )}
                          <div>
                            <div className="text-[10px] text-antique uppercase tracking-wide mb-0.5">
                              {c.status === 'regenerated' ? t('audit.fields.rewrittenClaim') : t('audit.fields.claim')}
                            </div>
                            <p className="text-cream text-xs leading-relaxed break-words">{c.claim}</p>
                          </div>
                          {c.sourceRef && (
                            <div className="text-[10px] text-accent break-words">{t('audit.fields.source')}: {c.sourceRef}</div>
                          )}
                          {c.judgeReason && (
                            <div>
                              <div className="text-[10px] text-antique uppercase tracking-wide mb-0.5">{t('audit.fields.judgeReasoning')}</div>
                              <p className="text-amber-300/80 text-xs leading-relaxed break-words">{c.judgeReason}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : nliVers.length === 0 ? (
                    <p className="text-antique text-xs">{t('audit.noClaimVerifications')}</p>
                  ) : (
                    /* Fallback: show raw NLI verifications for older entries */
                    nliVers.map((v, i) => (
                      <div key={i} className="border border-tobacco/50 rounded-button p-3">
                        <div className="flex items-start gap-2 mb-2">
                          {nliIcon(v.result)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${nliColor(v.result)}`}>
                                {friendlyLabel(v.result, t)}
                              </span>
                              <span className="text-[10px] text-antique">{t('audit.confidencePct', { pct: (v.confidence * 100).toFixed(0) })}</span>
                              <span className="text-[10px] text-antique">{formatMs(v.verificationDurationMs)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="ml-5 space-y-1.5">
                          <div>
                            <div className="text-[10px] text-antique uppercase tracking-wide mb-0.5">{t('audit.fields.claim')}</div>
                            <p className="text-cream text-xs leading-relaxed break-words">{v.claim}</p>
                          </div>
                          <div>
                            <div className="text-[10px] text-antique uppercase tracking-wide mb-0.5">
                              {t('audit.fields.source')}: {v.sourceRef}
                            </div>
                            <p className="text-cream-dark text-xs leading-relaxed break-words max-h-20 overflow-y-auto">{v.sourceText}</p>
                          </div>
                          {v.judgeReason && (
                            <div>
                              <div className="text-[10px] text-antique uppercase tracking-wide mb-0.5">{t('audit.fields.judgeReasoning')}</div>
                              <p className="text-amber-300/80 text-xs leading-relaxed break-words">{v.judgeReason}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  </div>
                </div>
              )}
            </div>

            {/* Sources Used */}
            <div className="bg-deep-brown rounded-button">
              <button onClick={() => toggleSection('sources')} className="flex items-center gap-2 w-full text-left px-4 py-3">
                {expandedSections.sources ? <ChevronDown size={14} className="text-antique" /> : <ChevronRight size={14} className="text-antique" />}
                <Database size={14} className="text-accent" />
                <span className="text-cream text-sm font-medium">{t('audit.sections.sourcesUsed')}</span>
                <span className="text-[10px] text-antique ml-auto">{t('audit.sourcesCount', { count: sources.length })}</span>
              </button>
              {expandedSections.sources && (
                <div className="px-4 pb-3">
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                  {sources.length === 0 ? (
                    <p className="text-antique text-xs">{t('audit.noSourcesRecorded')}</p>
                  ) : (
                    sources.map((s, i) => (
                      <div key={i} className="border border-tobacco/50 rounded-button px-3 py-2">
                        <div className="text-cream text-xs font-medium break-words">{s.sourceName}</div>
                        {s.citation && <div className="text-[10px] text-antique mt-0.5 break-words">{s.citation}</div>}
                        {s.excerpt && <p className="text-cream-dark text-[10px] mt-1 break-words line-clamp-3">{s.excerpt}</p>}
                      </div>
                    ))
                  )}
                  </div>
                </div>
              )}
            </div>

            {/* RAG Searches */}
            <div className="bg-deep-brown rounded-button">
              <button onClick={() => toggleSection('rag')} className="flex items-center gap-2 w-full text-left px-4 py-3">
                {expandedSections.rag ? <ChevronDown size={14} className="text-antique" /> : <ChevronRight size={14} className="text-antique" />}
                <Search size={14} className="text-accent" />
                <span className="text-cream text-sm font-medium">{t('audit.sections.databaseSearches')}</span>
                <span className="text-[10px] text-antique ml-auto">{t('audit.searchesCount', { count: ragSearches.length })}</span>
              </button>
              {expandedSections.rag && (
                <div className="px-4 pb-3">
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {ragSearches.length === 0 ? (
                    <p className="text-antique text-xs">{t('audit.noSearchData')}</p>
                  ) : (
                    ragSearches.map((r, i) => (
                      <div key={i} className="border border-tobacco/50 rounded-button p-3">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="text-cream text-xs font-medium break-words">"{r.query}"</span>
                          <span className="text-[10px] text-antique">{r.jurisdiction}</span>
                          <span className="text-[10px] text-antique ml-auto whitespace-nowrap">{t('audit.resultsCount', { count: r.resultsCount })} · {formatMs(r.searchDurationMs)}</span>
                        </div>
                        {r.expandedQueries && r.expandedQueries.length > 0 && (
                          <div className="text-[10px] text-antique mb-2 break-words">
                            {t('audit.translated')}: {r.expandedQueries.join(', ')}
                          </div>
                        )}
                        {r.results && r.results.length > 0 && (
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {r.results.map((res, j) => (
                              <div key={j} className="flex items-center gap-2 text-[10px]">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${res.wasUsed ? 'bg-emerald-500' : 'bg-tobacco'}`} />
                                <span className="text-cream-dark truncate flex-1">{res.sourceName}</span>
                                {res.rerankerScore != null && (
                                  <span className="text-antique whitespace-nowrap">{res.rerankerScore.toFixed(3)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  </div>
                </div>
              )}
            </div>

            {/* LLM Calls */}
            <div className="bg-deep-brown rounded-button">
              <button onClick={() => toggleSection('llm')} className="flex items-center gap-2 w-full text-left px-4 py-3">
                {expandedSections.llm ? <ChevronDown size={14} className="text-antique" /> : <ChevronRight size={14} className="text-antique" />}
                <Brain size={14} className="text-accent" />
                <span className="text-cream text-sm font-medium">{t('audit.sections.llmCalls')}</span>
                <span className="text-[10px] text-antique ml-auto">{t('audit.callsCount', { count: llmCalls.length })}</span>
              </button>
              {expandedSections.llm && (
                <div className="px-4 pb-3">
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {llmCalls.length === 0 ? (
                    <p className="text-antique text-xs">{t('audit.noLlmData')}</p>
                  ) : (
                    llmCalls.map((c, i) => (
                      <div key={i} className="border border-tobacco/50 rounded-button px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-cream text-xs font-medium">{c.taskType}</span>
                          {c.usedFallback && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{t('audit.detail.cpuFallback')}</span>}
                          <span className="text-[10px] text-antique ml-auto whitespace-nowrap">{formatMs(c.durationMs)}</span>
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-antique flex-wrap">
                          {c.inputTokens != null && <span>{t('audit.fields.in')}: {c.inputTokens}</span>}
                          {c.outputTokens != null && <span>{t('audit.fields.out')}: {c.outputTokens}</span>}
                          <span>{t('audit.fields.temp')}: {c.temperature}</span>
                          <span>{c.provider}</span>
                        </div>
                      </div>
                    ))
                  )}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    )
  }
}
