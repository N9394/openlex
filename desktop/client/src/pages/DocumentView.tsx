import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  ArrowLeft,
  Download,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Loader2,
  Archive,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  XCircle,
  ChevronDown,
  ChevronRight,
  Calendar,
  AlertOctagon,
  BookOpen,
  Upload,
  Search,
  Brain,
  Scale,
  CircleDot,
} from 'lucide-react'
// Answers render through the safe Markdown component (no images load, links need a click).
import ReactMarkdown from '../components/Markdown'
import { api, apiUrl, apiBase } from '../lib/api'

interface KeyClause {
  title?: string
  content?: string
  clause?: string
  importance?: string
  category?: string
  citation?: string
  location?: string
  sourceRef?: string
  nliVerified?: boolean
  nliLabel?: string
  nliConfidence?: number
}

interface RiskFlag {
  level?: string
  severity?: string
  flag?: string
  category?: string
  explanation?: string
  recommendation?: string
  location?: string
  sourceRef?: string
  nliVerified?: boolean
  nliLabel?: string
  nliConfidence?: number
}

interface ImportantDate {
  date: string
  description: string
  isDeadline?: boolean
  importance?: string
}

interface MissingElement {
  element: string
  importance: string
  explanation: string
}

interface RiskScore {
  score: number
  level: string
  explanation: string
}

interface ClarityScore {
  overall: number
  grade: string
  breakdown?: { completeness: number; fairness: number; structure: number; precision: number }
  strengths?: string[]
  weaknesses?: string[]
  recommendation?: string
}

interface ProcessingProgress {
  stage: 'upload' | 'parsing' | 'scanning' | 'analyzing' | 'verifying' | 'done'
  progress: number
  detail: string
  startedAt?: number
  extractedPreview?: string
  chunks?: { current: number; total: number }
}

interface DocumentAnalysis {
  id: string
  filename: string
  analysis?: {
    summary?: string | { title?: string; content?: string }
    risks?: Array<{ risk: string; severity: string }>
    clauses?: Array<{ type: string; text: string }>
    recommendations?: string[]
    keyClauses?: KeyClause[]
    riskFlags?: RiskFlag[]
    missingElements?: MissingElement[]
    importantDates?: ImportantDate[]
    overallRiskScore?: RiskScore | number
    clarityScore?: ClarityScore | number
    readabilityScore?: { score: number; grade: string; explanation: string } | number
  }
  status: string
  createdAt?: string
  uploadedAt?: string
  filesize?: number
  message?: string
  progress?: ProcessingProgress
}

export default function DocumentView() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [doc, setDoc] = useState<DocumentAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reanalyzing, setReanalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<string[]>([])
  const [savingToVault, setSavingToVault] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    clauses: false,
    risks: false,
  })
  const [expandedClause, setExpandedClause] = useState<number | null>(null)
  const [expandedRisk, setExpandedRisk] = useState<number | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [processingElapsed, setProcessingElapsed] = useState(0)
  const [serverProgress, setServerProgress] = useState<ProcessingProgress | null>(null)
  const [displayProgress, setDisplayProgress] = useState(0)
  const lastServerProgress = useRef(0)

  // Timer for processing state — uses document upload time so it persists across navigation
  useEffect(() => {
    if (!doc || doc.status !== 'processing') {
      return
    }
    const start = doc.uploadedAt ? new Date(doc.uploadedAt).getTime() : (doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now())
    const update = () => setProcessingElapsed(Math.floor((Date.now() - start) / 1000))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [doc?.status, doc?.uploadedAt, doc?.createdAt])

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Restore progress from sessionStorage on mount
  useEffect(() => {
    if (id) {
      try {
        const stored = sessionStorage.getItem(`doc-progress-${id}`)
        if (stored) {
          const parsed = JSON.parse(stored) as ProcessingProgress & { lastUpdated?: number }
          // Only restore if less than 5 minutes old
          if (parsed.lastUpdated && Date.now() - parsed.lastUpdated < 300000) {
            setServerProgress(parsed)
            setDisplayProgress(parsed.progress)
            lastServerProgress.current = parsed.progress
          } else {
            sessionStorage.removeItem(`doc-progress-${id}`)
          }
        }
      } catch { /* ignore corrupt data */ }
      loadDocument()
    }
  }, [id])

  // Poll for progress every 2s when processing
  useEffect(() => {
    if (!doc || doc.status !== 'processing') {
      // Clean up sessionStorage when done
      if (doc && doc.status !== 'processing' && id) {
        sessionStorage.removeItem(`doc-progress-${id}`)
      }
      return
    }
    const interval = setInterval(async () => {
      try {
        const data = await api.get(`/docs/${id}`)
        setDoc(data)
        if (data.progress) {
          setServerProgress(data.progress)
          lastServerProgress.current = data.progress.progress
          // Persist to sessionStorage
          sessionStorage.setItem(`doc-progress-${id}`, JSON.stringify({ ...data.progress, lastUpdated: Date.now() }))
        }
        if (data.status !== 'processing') {
          clearInterval(interval)
          sessionStorage.removeItem(`doc-progress-${id}`)
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [doc?.status, id])

  // Smooth progress interpolation between server polls
  useEffect(() => {
    if (!serverProgress || serverProgress.stage === 'done') {
      if (serverProgress?.stage === 'done') setDisplayProgress(100)
      return
    }
    // Jump to server value immediately if behind
    setDisplayProgress(prev => Math.max(prev, serverProgress.progress))
    // Gently creep forward between polls
    const creepInterval = setInterval(() => {
      setDisplayProgress(prev => {
        const target = lastServerProgress.current
        // Don't creep past the next stage boundary or more than 3% ahead of server
        const maxCreep = Math.min(target + 3, 99)
        if (prev >= maxCreep) return prev
        return prev + 0.3
      })
    }, 600)
    return () => clearInterval(creepInterval)
  }, [serverProgress])

  const loadDocument = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get(`/docs/${id}`)
      setDoc(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document')
    } finally {
      setLoading(false)
    }
  }

  const reanalyze = async () => {
    if (!id) return
    setReanalyzing(true)
    setAnalyzeProgress([])
    try {
      const response = await fetch(apiUrl(`/docs/${id}/reanalyze/stream`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Failed to start re-analysis')
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response stream')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.stage) setAnalyzeProgress(prev => [...prev, data.stage])
              if (data.status === 'complete' || data.analysis) {
                await loadDocument()
                setReanalyzing(false)
                try {
                  const lv = (window as any).lexvault
                  if (lv?.notify) lv.notify('Document analysis complete', `${doc?.filename || 'Your document'} is ready to review.`)
                } catch {}
                return
              }
              if (data.error) throw new Error(data.error)
            } catch { /* skip */ }
          }
        }
      }
      await loadDocument()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-analysis failed')
    } finally {
      setReanalyzing(false)
    }
  }

  // === Normalize data ===
  const analysis = doc?.analysis || {}

  const summaryText: string = (() => {
    const s = analysis.summary
    if (!s) return ''
    if (typeof s === 'string') return s
    if (typeof s === 'object' && s.content) return s.content
    return JSON.stringify(s)
  })()

  const clauses: KeyClause[] = analysis.keyClauses || []
  const highClauses = clauses.filter(c => c.importance === 'high')
  const medClauses = clauses.filter(c => c.importance === 'medium')
  const lowClauses = clauses.filter(c => c.importance === 'low' || (!c.importance))

  const riskFlags: RiskFlag[] = analysis.riskFlags || []
  const redRisks = riskFlags.filter(r => r.level === 'red')
  const yellowRisks = riskFlags.filter(r => r.level === 'yellow')
  const greenRisks = riskFlags.filter(r => r.level === 'green')

  const importantDates: ImportantDate[] = analysis.importantDates || []
  const missingElements: MissingElement[] = analysis.missingElements || []
  const criticalMissing = missingElements.filter(m => m.importance === 'critical')

  const riskScore: RiskScore | null = (() => {
    const r = analysis.overallRiskScore
    if (!r) return null
    if (typeof r === 'number') return { score: r, level: r > 70 ? 'high' : r > 40 ? 'medium' : 'low', explanation: '' }
    return r
  })()

  // clarityScore available but not displayed (placeholder data)
  void analysis.clarityScore

  const hasAnalysis = summaryText || clauses.length > 0

  const saveToVault = async () => {
    if (!doc || !doc.analysis) return
    setSavingToVault(true)
    try {
      await api.post('/vault', {
        type: 'document',
        title: doc.filename,
        content: summaryText || 'Document analysis',
        notes: `Analyzed on ${new Date(doc.uploadedAt || doc.createdAt || Date.now()).toLocaleDateString()}`,
        sourceDocumentId: doc.id,
      })
      alert('Saved to vault!')
    } catch { alert('Failed to save to vault') }
    finally { setSavingToVault(false) }
  }

  // === Render ===
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    )
  }

  if (error && !doc) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="card text-center py-12">
          <AlertTriangle size={48} className="mx-auto text-burgundy mb-4" />
          <div className="text-parchment mb-2">{t('documentView.noAnalysis')}</div>
          <p className="text-antique text-sm mb-4">{error}</p>
          <Link to="/upload" className="btn-secondary">Upload a new document</Link>
        </div>
      </div>
    )
  }

  if (!doc) return null

  const isProcessing = doc.status === 'processing'
  const isFailed = doc.status === 'failed' || doc.status === 'error'

  const importanceBadge = (imp: string) => {
    const cls = imp === 'high' ? 'bg-red-500/20 text-red-400' :
      imp === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
      'bg-obsidian text-antique'
    const label = imp === 'high' ? 'Very Important' : imp === 'medium' ? 'Important' : 'Less Important'
    return <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
  }

  const categoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      liability: 'Liability', warranty: 'Warranty', confidentiality: 'Confidentiality',
      indemnity: 'Indemnity', termination: 'Termination', other: 'General',
    }
    return labels[cat] || cat
  }

  const VerificationBadge = ({ nliVerified, nliLabel, nliConfidence }: { nliVerified?: boolean; nliLabel?: string; nliConfidence?: number }) => {
    if (nliLabel === undefined && nliVerified === undefined) return null
    const pct = nliConfidence !== undefined ? `${Math.round(nliConfidence * 100)}%` : ''
    if (nliLabel === 'entailment' || nliVerified === true) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400" title={`Verified by NLI (${pct} confidence)`}>
          <ShieldCheck size={11} /> Verified
        </span>
      )
    }
    if (nliLabel === 'contradiction') {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-red-400" title={`Contradicted by NLI (${pct} confidence)`}>
          <ShieldAlert size={11} /> Contradicted
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-antique" title={`Unverified (${nliLabel || 'neutral'}${pct ? ', ' + pct : ''})`}>
        <ShieldQuestion size={11} /> Unverified
      </span>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button onClick={() => navigate(-1)} className="text-antique hover:text-accent transition-colors flex items-center gap-2 mb-3 text-sm">
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex items-center gap-3">
            <FileText size={24} className="text-accent" />
            <div>
              <h1 className="font-serif text-xl text-parchment">{doc.filename}</h1>
              <div className="flex items-center gap-3 text-antique text-xs mt-0.5">
                <span>{new Date(doc.uploadedAt || doc.createdAt || Date.now()).toLocaleDateString()}</span>
                <span className={`px-2 py-0.5 rounded ${
                  doc.status === 'completed' ? 'bg-forest/20 text-emerald-400' :
                  isProcessing ? 'bg-amber-500/20 text-amber-400' :
                  isFailed ? 'bg-burgundy/20 text-red-400' :
                  'bg-obsidian text-antique'
                }`}>{doc.status}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasAnalysis && (
            <button onClick={saveToVault} disabled={savingToVault} className="btn-secondary flex items-center gap-2 text-sm">
              {savingToVault ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}
              Vault
            </button>
          )}
          <div className="relative group">
            <button className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={16} /> Export
            </button>
            <div className="absolute right-0 top-full mt-2 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[150px]">
              <button
                onClick={async () => {
                  if (!doc?.id) return
                  try {
                    const response = await fetch(`${apiBase()}/api/research/export/analysis/${doc.id}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                    })
                    if (!response.ok) throw new Error('Export failed')
                    const blob = await response.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${(doc.filename || 'analysis').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_')}_analysis.docx`
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch (err) { console.error('Export failed:', err) }
                }}
                className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
              >
                Export as .docx
              </button>
              <button
                onClick={async () => {
                  if (!doc?.id) return
                  try {
                    const response = await fetch(`${apiBase()}/api/research/export/analysis/${doc.id}/pdf`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                    })
                    if (!response.ok) throw new Error('Export failed')
                    const blob = await response.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${(doc.filename || 'analysis').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_')}_analysis.pdf`
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch (err) { console.error('Export failed:', err) }
                }}
                className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
              >
                Export as .pdf
              </button>
            </div>
          </div>
          {!reanalyzing && hasAnalysis && (
            <button onClick={reanalyze} className="btn-secondary flex items-center gap-2 text-sm" title="Re-analyze">
              <RefreshCw size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Re-analyzing */}
      {reanalyzing && (
        <div className="card mb-6" ref={progressRef}>
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={18} className="animate-spin text-accent" />
            <span className="text-parchment font-medium text-sm">Re-analyzing...</span>
          </div>
          <div className="space-y-1.5">
            {analyzeProgress.map((stage, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-cream-dark">
                <CheckCircle size={12} className="text-forest" /> {stage}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processing / Failed */}
      {isFailed && !reanalyzing && (
        <div className="card mb-6 border-burgundy/30">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-medium text-parchment text-sm mb-1">{t('common.failed')}</h3>
              <p className="text-xs text-antique mb-2">Click below to retry.</p>
              <button onClick={reanalyze} className="btn-primary flex items-center gap-2 text-sm mt-2">
                <RefreshCw size={14} /> Re-analyze
              </button>
            </div>
          </div>
        </div>
      )}
      {isProcessing && !reanalyzing && (() => {
        const STAGES = [
          { key: 'upload', label: 'Upload', icon: Upload },
          { key: 'parsing', label: 'Parse', icon: FileText },
          { key: 'scanning', label: 'Regex Scan', icon: Search },
          { key: 'analyzing', label: 'AI Analysis', icon: Brain },
          { key: 'verifying', label: 'Verify', icon: Scale },
          { key: 'done', label: 'Done', icon: CheckCircle },
        ] as const
        const stageIndex = serverProgress ? STAGES.findIndex(s => s.key === serverProgress.stage) : -1
        const activeIdx = Math.max(0, stageIndex)
        const pct = Math.round(displayProgress)
        const mins = Math.floor(processingElapsed / 60)
        const secs = processingElapsed % 60
        const elapsed = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `0:${secs.toString().padStart(2, '0')}`
        const isLargeDoc = serverProgress?.extractedPreview && serverProgress.extractedPreview.length > 400
        const showPreview = serverProgress?.extractedPreview && activeIdx >= 1
        return (
          <div className="card mb-6 border-accent/30 overflow-hidden">
            {/* Header: percentage + elapsed */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Loader2 size={18} className="text-accent animate-spin" />
                <h3 className="font-medium text-parchment text-sm">{t('common.processing')}</h3>
              </div>
              <div className="flex items-center gap-2 text-xs text-antique font-mono">
                <span className="text-accent font-semibold">{pct}%</span>
                <span className="text-tobacco">·</span>
                <span>{elapsed} elapsed</span>
              </div>
            </div>

            {/* Animated gradient progress bar */}
            <div className="h-2 bg-deep-brown rounded-full overflow-hidden mb-4">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-accent via-forest to-accent bg-[length:200%_100%] animate-shimmer"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>

            {/* Estimated time hint */}
            <p className="text-[10px] text-antique/40 mb-4">
              {isLargeDoc ? 'Large document — may take 1-2 minutes' : 'Usually takes 30-60 seconds'}
            </p>

            {/* 6-stage checklist */}
            <div className="space-y-2.5 mb-4">
              {STAGES.map((stage, i) => {
                const Icon = stage.icon
                const isDone = i < activeIdx || (i === activeIdx && serverProgress?.stage === 'done')
                const isActive = i === activeIdx && serverProgress?.stage !== 'done'
                return (
                  <div key={stage.key} className="flex items-start gap-2.5">
                    {/* Stage icon */}
                    {isDone ? (
                      <CheckCircle size={16} className="text-forest flex-shrink-0 mt-0.5" />
                    ) : isActive ? (
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0 mt-0.5" />
                    ) : (
                      <CircleDot size={16} className="text-tobacco/40 flex-shrink-0 mt-0.5" />
                    )}
                    {/* Stage text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon size={12} className={isDone ? 'text-forest' : isActive ? 'text-accent' : 'text-tobacco/40'} />
                        <span className={`text-xs ${isDone ? 'text-cream-dark' : isActive ? 'text-cream font-medium' : 'text-antique/40'}`}>
                          {stage.label}
                        </span>
                      </div>
                      {/* Detail text for active or completed stages */}
                      {(isDone || isActive) && serverProgress && i <= activeIdx && (
                        <p className="text-[10px] text-antique/60 ml-5 mt-0.5 truncate">
                          {i === activeIdx ? serverProgress.detail : (
                            i === 0 ? 'Document received' :
                            i === 1 && serverProgress.extractedPreview ? `${Math.round((serverProgress.extractedPreview.length > 400 ? 50 : 10))}K+ characters extracted` :
                            'Complete'
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Faded document text preview */}
            {showPreview && (
              <div className="relative mt-3 mb-3 max-h-24 overflow-hidden rounded-button bg-deep-brown px-3 py-2">
                <p className="text-[10px] text-antique/30 leading-relaxed whitespace-pre-wrap font-mono">
                  {serverProgress.extractedPreview}
                </p>
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-deep-brown pointer-events-none" />
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-3">
              <p className="text-[10px] text-antique/40">Live progress · updates every 2s</p>
              <button
                onClick={async () => {
                  try {
                    await api.delete(`/docs/${id}`)
                  } catch {
                    // best-effort delete
                  }
                  sessionStorage.removeItem(`doc-progress-${id}`)
                  navigate('/upload')
                }}
                className="text-xs text-antique hover:text-red-400 transition-colors"
              >
                Cancel &amp; go back
              </button>
            </div>
          </div>
        )
      })()}

      {/* === Analysis Content === */}
      {hasAnalysis && (
        <div className="space-y-4">

          {/* Metrics Row */}
          <div className="grid grid-cols-3 gap-3">
            {riskScore && (
              <div className={`card py-3 px-4 border ${
                riskScore.level === 'high' ? 'border-burgundy/40' :
                riskScore.level === 'medium' ? 'border-yellow-500/40' :
                'border-forest/40'
              }`}>
                <div className="text-xs text-antique mb-1">Risk Level</div>
                <div className={`text-lg font-bold uppercase ${
                  riskScore.level === 'high' ? 'text-red-400' :
                  riskScore.level === 'medium' ? 'text-yellow-400' :
                  'text-emerald-400'
                }`}>{riskScore.level}</div>
                <div className="text-[10px] text-antique">{riskScore.explanation}</div>
              </div>
            )}
            <div className="card py-3 px-4">
              <div className="text-xs text-antique mb-1">Clauses</div>
              <div className="text-2xl font-bold text-parchment">{clauses.length}</div>
              <div className="text-[10px] text-antique">{highClauses.length} very important</div>
            </div>
            <div className="card py-3 px-4">
              <div className="text-xs text-antique mb-1">{t('documentView.risks')}</div>
              <div className="text-2xl font-bold text-parchment">{riskFlags.length}</div>
              <div className="text-[10px]">
                {redRisks.length > 0 && <span className="text-red-400">{redRisks.length} critical </span>}
                {yellowRisks.length > 0 && <span className="text-yellow-400">{yellowRisks.length} moderate</span>}
              </div>
            </div>
          </div>

          {/* Important Dates */}
          {importantDates.length > 0 && (
            <div className="card py-3 px-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={16} className="text-accent" />
                <h3 className="text-sm font-medium text-parchment">{t('documentView.importantDates')}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {importantDates.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="font-mono text-accent text-xs bg-accent/10 px-2 py-0.5 rounded flex-shrink-0">{d.date}</span>
                    <span className="prose-custom-xs max-w-none [&_p]:inline"><ReactMarkdown>{d.description || ''}</ReactMarkdown></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Critical Missing Elements */}
          {criticalMissing.length > 0 && (
            <div className="card py-3 px-4 border border-burgundy/40">
              <div className="flex items-center gap-2 mb-2">
                <AlertOctagon size={16} className="text-red-400" />
                <h3 className="text-sm font-medium text-red-400">{t('documentView.missingElements')}</h3>
              </div>
              {criticalMissing.map((m, i) => (
                <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
                  <XCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-cream text-xs font-medium">{m.element}</span>
                    <span className="text-antique text-xs ml-1">— {m.explanation}</span>
                  </div>
                </div>
              ))}
              {missingElements.filter(m => m.importance !== 'critical').length > 0 && (
                <>
                  <button
                    onClick={() => toggleSection('missing')}
                    className="text-[10px] text-antique mt-2 flex items-center gap-1 hover:text-cream transition-colors"
                  >
                    {expandedSections.missing ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    + {missingElements.filter(m => m.importance !== 'critical').length} recommended/optional elements
                  </button>
                  {expandedSections.missing && (
                    <div className="mt-2 space-y-1.5">
                      {missingElements.filter(m => m.importance !== 'critical').map((m, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <XCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="text-cream text-xs font-medium">{m.element}</span>
                            <span className="text-antique text-xs ml-1">— {m.explanation}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Main column */}
            <div className="lg:col-span-2 space-y-4">

              {/* Summary — collapsible */}
              <div className="card py-3 px-4">
                <button onClick={() => toggleSection('summary')} className="flex items-center justify-between w-full text-left">
                  <h2 className="font-serif text-base text-parchment">{t('documentView.summary')}</h2>
                  {expandedSections.summary ? <ChevronDown size={16} className="text-antique" /> : <ChevronRight size={16} className="text-antique" />}
                </button>
                {expandedSections.summary && (
                  <div className="prose-custom max-w-none mt-3">
                    <ReactMarkdown>{summaryText || 'No summary available'}</ReactMarkdown>
                  </div>
                )}
              </div>

              {/* Key Clauses — compact list, expandable */}
              {clauses.length > 0 && (
                <div className="card py-3 px-4">
                  <button onClick={() => toggleSection('clauses')} className="flex items-center justify-between w-full text-left">
                    <h2 className="font-serif text-base text-parchment">{t('documentView.keyClauses')} <span className="text-antique text-xs font-sans ml-1">({clauses.length})</span></h2>
                    {expandedSections.clauses ? <ChevronDown size={16} className="text-antique" /> : <ChevronRight size={16} className="text-antique" />}
                  </button>

                  {/* Always show high-importance clauses as compact list */}
                  {highClauses.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {highClauses.map((c) => {
                        const idx = clauses.indexOf(c)
                        const isOpen = expandedClause === idx
                        const matchingRisks = riskFlags.filter(r => r.category && c.category && r.category.toLowerCase() === c.category.toLowerCase())
                        const worstRisk = matchingRisks.find(r => r.level === 'red') || matchingRisks.find(r => r.level === 'yellow') || matchingRisks[0]
                        return (
                          <div key={idx} id={`clause-${idx}`} className="bg-deep-brown rounded-button">
                            <button
                              onClick={() => setExpandedClause(isOpen ? null : idx)}
                              className="flex items-center gap-2 w-full text-left px-3 py-2"
                            >
                              {isOpen ? <ChevronDown size={12} className="text-antique flex-shrink-0" /> : <ChevronRight size={12} className="text-antique flex-shrink-0" />}
                              <span className="text-cream text-sm flex-1">{c.title || 'Clause'}</span>
                              {worstRisk && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const riskIdx = riskFlags.indexOf(worstRisk)
                                    document.getElementById(`risk-${riskIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    setExpandedRisk(riskIdx)
                                  }}
                                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                    worstRisk.level === 'red' ? 'bg-red-400' : worstRisk.level === 'yellow' ? 'bg-yellow-400' : 'bg-emerald-400'
                                  }`}
                                  title={`${matchingRisks.length} risk${matchingRisks.length > 1 ? 's' : ''} — click to view`}
                                />
                              )}
                              <VerificationBadge nliVerified={c.nliVerified} nliLabel={c.nliLabel} nliConfidence={c.nliConfidence} />
                              {importanceBadge('high')}
                              <span className="text-[10px] text-antique uppercase">{categoryLabel(c.category || '')}</span>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 pt-0">
                                <div className="prose-custom-xs max-w-none ml-5"><ReactMarkdown>{c.content || c.clause || ''}</ReactMarkdown></div>
                                {(c.location || c.sourceRef) && (
                                  <div className="ml-5 mt-2 flex flex-wrap gap-3">
                                    {c.location && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-antique">
                                        <FileText size={10} /> {c.location}
                                      </span>
                                    )}
                                    {c.sourceRef && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                                        <BookOpen size={10} /> {c.sourceRef}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {matchingRisks.length > 0 && (
                                  <div className="ml-5 mt-2 flex flex-wrap gap-1">
                                    {matchingRisks.map((r, ri) => (
                                      <button
                                        key={ri}
                                        onClick={() => {
                                          const riskIdx = riskFlags.indexOf(r)
                                          document.getElementById(`risk-${riskIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                          setExpandedRisk(riskIdx)
                                        }}
                                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                                          r.level === 'red' ? 'bg-red-500/20 text-red-400' : r.level === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-forest/20 text-emerald-400'
                                        } hover:opacity-80 transition-opacity`}
                                      >
                                        {r.category}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Medium + low clauses only when section expanded */}
                  {expandedSections.clauses && (
                    <div className="mt-2 space-y-1.5">
                      {[...medClauses, ...lowClauses].map((c) => {
                        const idx = clauses.indexOf(c)
                        const isOpen = expandedClause === idx
                        const matchingRisks = riskFlags.filter(r => r.category && c.category && r.category.toLowerCase() === c.category.toLowerCase())
                        const worstRisk = matchingRisks.find(r => r.level === 'red') || matchingRisks.find(r => r.level === 'yellow') || matchingRisks[0]
                        return (
                          <div key={idx} id={`clause-${idx}`} className="bg-deep-brown rounded-button">
                            <button
                              onClick={() => setExpandedClause(isOpen ? null : idx)}
                              className="flex items-center gap-2 w-full text-left px-3 py-2"
                            >
                              {isOpen ? <ChevronDown size={12} className="text-antique flex-shrink-0" /> : <ChevronRight size={12} className="text-antique flex-shrink-0" />}
                              <span className="text-cream text-sm flex-1">{c.title || 'Clause'}</span>
                              {worstRisk && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const riskIdx = riskFlags.indexOf(worstRisk)
                                    document.getElementById(`risk-${riskIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    setExpandedRisk(riskIdx)
                                  }}
                                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                    worstRisk.level === 'red' ? 'bg-red-400' : worstRisk.level === 'yellow' ? 'bg-yellow-400' : 'bg-emerald-400'
                                  }`}
                                  title={`${matchingRisks.length} risk${matchingRisks.length > 1 ? 's' : ''} — click to view`}
                                />
                              )}
                              <VerificationBadge nliVerified={c.nliVerified} nliLabel={c.nliLabel} nliConfidence={c.nliConfidence} />
                              {importanceBadge(c.importance || 'low')}
                              <span className="text-[10px] text-antique uppercase">{categoryLabel(c.category || '')}</span>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 pt-0">
                                <div className="prose-custom-xs max-w-none ml-5"><ReactMarkdown>{c.content || c.clause || ''}</ReactMarkdown></div>
                                {(c.location || c.sourceRef) && (
                                  <div className="ml-5 mt-2 flex flex-wrap gap-3">
                                    {c.location && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-antique">
                                        <FileText size={10} /> {c.location}
                                      </span>
                                    )}
                                    {c.sourceRef && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                                        <BookOpen size={10} /> {c.sourceRef}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {matchingRisks.length > 0 && (
                                  <div className="ml-5 mt-2 flex flex-wrap gap-1">
                                    {matchingRisks.map((r, ri) => (
                                      <button
                                        key={ri}
                                        onClick={() => {
                                          const riskIdx = riskFlags.indexOf(r)
                                          document.getElementById(`risk-${riskIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                          setExpandedRisk(riskIdx)
                                        }}
                                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                                          r.level === 'red' ? 'bg-red-500/20 text-red-400' : r.level === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-forest/20 text-emerald-400'
                                        } hover:opacity-80 transition-opacity`}
                                      >
                                        {r.category}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {!expandedSections.clauses && (medClauses.length + lowClauses.length) > 0 && (
                    <div className="text-[10px] text-antique mt-2 ml-1">
                      + {medClauses.length + lowClauses.length} more clauses
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Risks sidebar */}
            <div>
              <div className="card py-3 px-4 sticky top-6">
                <button onClick={() => toggleSection('risks')} className="flex items-center justify-between w-full text-left mb-2">
                  <h2 className="font-serif text-base text-parchment">{t('documentView.risks')}</h2>
                  {expandedSections.risks ? <ChevronDown size={16} className="text-antique" /> : <ChevronRight size={16} className="text-antique" />}
                </button>

                {riskScore && (
                  <div className="text-xs text-antique mb-3">{riskScore.explanation}</div>
                )}

                {riskFlags.length > 0 ? (
                  <div className="space-y-1.5">
                    {/* Always show red risks */}
                    {redRisks.map((r) => {
                      const idx = riskFlags.indexOf(r)
                      const isOpen = expandedRisk === idx
                      const matchingClauseIdx = clauses.findIndex(c => c.category && r.category && c.category.toLowerCase() === r.category.toLowerCase())
                      return (
                        <div key={idx} id={`risk-${idx}`} className="rounded-button border bg-burgundy/10 border-burgundy/30">
                          <button onClick={() => setExpandedRisk(isOpen ? null : idx)} className="flex items-start gap-2 w-full text-left px-3 py-2">
                            <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                            <span className="text-cream text-xs flex-1 line-clamp-2">{r.category}</span>
                            <VerificationBadge nliVerified={r.nliVerified} nliLabel={r.nliLabel} nliConfidence={r.nliConfidence} />
                          </button>
                          {isOpen && (
                            <div className="px-3 pb-2">
                              <div className="prose-custom-xs max-w-none ml-5"><ReactMarkdown>{r.explanation || ''}</ReactMarkdown></div>
                              {r.recommendation && <p className="text-antique text-[10px] ml-5 mt-1">Recommendation: {r.recommendation}</p>}
                              {(r.location || r.sourceRef) && (
                                <div className="ml-5 mt-1 flex flex-wrap gap-3">
                                  {r.location && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-antique">
                                      <FileText size={10} /> {r.location}
                                    </span>
                                  )}
                                  {r.sourceRef && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                                      <BookOpen size={10} /> {r.sourceRef}
                                    </span>
                                  )}
                                </div>
                              )}
                              {matchingClauseIdx >= 0 && (
                                <button
                                  onClick={() => {
                                    document.getElementById(`clause-${matchingClauseIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    setExpandedClause(matchingClauseIdx)
                                  }}
                                  className="text-[10px] text-accent ml-5 mt-1 hover:underline"
                                >
                                  View related clause
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Yellow risks */}
                    {yellowRisks.slice(0, expandedSections.risks ? yellowRisks.length : 3).map((r) => {
                      const idx = riskFlags.indexOf(r)
                      const isOpen = expandedRisk === idx
                      const matchingClauseIdx = clauses.findIndex(c => c.category && r.category && c.category.toLowerCase() === r.category.toLowerCase())
                      return (
                        <div key={idx} id={`risk-${idx}`} className="rounded-button border bg-yellow-500/10 border-yellow-500/30">
                          <button onClick={() => setExpandedRisk(isOpen ? null : idx)} className="flex items-start gap-2 w-full text-left px-3 py-2">
                            <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                            <span className="text-cream text-xs flex-1 line-clamp-2">{r.category}</span>
                            <VerificationBadge nliVerified={r.nliVerified} nliLabel={r.nliLabel} nliConfidence={r.nliConfidence} />
                          </button>
                          {isOpen && (
                            <div className="px-3 pb-2">
                              <div className="prose-custom-xs max-w-none ml-5"><ReactMarkdown>{r.explanation || ''}</ReactMarkdown></div>
                              {r.recommendation && <p className="text-antique text-[10px] ml-5 mt-1">Recommendation: {r.recommendation}</p>}
                              {(r.location || r.sourceRef) && (
                                <div className="ml-5 mt-1 flex flex-wrap gap-3">
                                  {r.location && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-antique">
                                      <FileText size={10} /> {r.location}
                                    </span>
                                  )}
                                  {r.sourceRef && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                                      <BookOpen size={10} /> {r.sourceRef}
                                    </span>
                                  )}
                                </div>
                              )}
                              {matchingClauseIdx >= 0 && (
                                <button
                                  onClick={() => {
                                    document.getElementById(`clause-${matchingClauseIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    setExpandedClause(matchingClauseIdx)
                                  }}
                                  className="text-[10px] text-accent ml-5 mt-1 hover:underline"
                                >
                                  View related clause
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {!expandedSections.risks && yellowRisks.length > 3 && (
                      <div className="text-[10px] text-antique px-1">+ {yellowRisks.length - 3} more moderate risks</div>
                    )}

                    {/* Green risks only when expanded */}
                    {expandedSections.risks && greenRisks.map((r) => {
                      const idx = riskFlags.indexOf(r)
                      const isOpen = expandedRisk === idx
                      const matchingClauseIdx = clauses.findIndex(c => c.category && r.category && c.category.toLowerCase() === r.category.toLowerCase())
                      return (
                        <div key={idx} id={`risk-${idx}`} className="rounded-button border bg-forest/10 border-forest/30">
                          <button onClick={() => setExpandedRisk(isOpen ? null : idx)} className="flex items-start gap-2 w-full text-left px-3 py-2">
                            <AlertTriangle size={12} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                            <span className="text-cream text-xs flex-1 line-clamp-2">{r.category}</span>
                            <VerificationBadge nliVerified={r.nliVerified} nliLabel={r.nliLabel} nliConfidence={r.nliConfidence} />
                          </button>
                          {isOpen && (
                            <div className="px-3 pb-2">
                              <div className="prose-custom-xs max-w-none ml-5"><ReactMarkdown>{r.explanation || ''}</ReactMarkdown></div>
                              {(r.location || r.sourceRef) && (
                                <div className="ml-5 mt-1 flex flex-wrap gap-3">
                                  {r.location && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-antique">
                                      <FileText size={10} /> {r.location}
                                    </span>
                                  )}
                                  {r.sourceRef && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                                      <BookOpen size={10} /> {r.sourceRef}
                                    </span>
                                  )}
                                </div>
                              )}
                              {matchingClauseIdx >= 0 && (
                                <button
                                  onClick={() => {
                                    document.getElementById(`clause-${matchingClauseIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    setExpandedClause(matchingClauseIdx)
                                  }}
                                  className="text-[10px] text-accent ml-5 mt-1 hover:underline"
                                >
                                  View related clause
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {!expandedSections.risks && greenRisks.length > 0 && (
                      <div className="text-[10px] text-antique px-1">+ {greenRisks.length} low risks</div>
                    )}
                  </div>
                ) : (
                  <p className="text-antique text-xs">No significant risks identified</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No analysis fallback */}
      {!hasAnalysis && !isFailed && !isProcessing && !reanalyzing && (
        <div className="card text-center py-12">
          <FileText size={48} className="mx-auto text-antique mb-4" />
          <p className="text-parchment mb-4">No analysis available</p>
          <button onClick={reanalyze} className="btn-primary flex items-center gap-2 mx-auto">
            <RefreshCw size={18} /> Analyze Document
          </button>
        </div>
      )}
    </div>
  )
}
