import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api, streamInvestigate, apiBase } from '../lib/api'
// Answers render through the safe Markdown component (no images load, links need a click).
import ReactMarkdown from '../components/Markdown'
import {
  Search,
  FileText,
  Archive,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Scale,
  Target,
  Lightbulb,
  BookOpen,
  Filter,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Download,
  Save,
  CheckCheck,
} from 'lucide-react'

interface Document {
  id: string
  filename: string
  status: string
  createdAt: string
  summary?: string
}

interface VaultItem {
  id: string
  title: string
  type: string
  content: string
  createdAt: string
}

interface Verification {
  verified: number
  total: number
  regenerated: number
  removed: number
  confidence: string
}

interface Finding {
  id: string
  type: 'clause' | 'risk' | 'opportunity' | 'precedent'
  title: string
  excerpt: string
  source: string
  sourceType: 'document' | 'rag'
  relevance: number
  analysis?: string
  verification?: Verification
}

interface SearchPreset {
  id: string
  name: string
  description: string
  prompt: string
  icon: React.ReactNode
}

const smartExcerpt = (text: string, maxLen = 500): string => {
  if (text.length <= maxLen) return text
  const slice = text.slice(0, maxLen)
  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('?\n'),
    slice.lastIndexOf('!\n'),
  )
  if (lastSentence > maxLen * 0.6) return text.slice(0, lastSentence + 1)
  const lastSpace = slice.lastIndexOf(' ')
  if (lastSpace > maxLen * 0.6) return text.slice(0, lastSpace) + '...'
  return slice + '...'
}

const searchPresets: SearchPreset[] = [
  {
    id: 'liability',
    name: 'Liability Triggers',
    description: 'Find clauses that could expose parties to liability',
    prompt: 'Find all clauses related to liability, indemnification, damages, penalties, or breach consequences. Identify anything that could trigger financial or legal exposure.',
    icon: <AlertTriangle size={18} />,
  },
  {
    id: 'termination',
    name: 'Exit Conditions',
    description: 'Termination rights and exit strategies',
    prompt: 'Find all termination clauses, exit conditions, notice periods, and circumstances under which the agreement can be ended. Include any penalties for early termination.',
    icon: <Target size={18} />,
  },
  {
    id: 'obligations',
    name: 'Key Obligations',
    description: 'Critical duties and requirements',
    prompt: 'Identify all mandatory obligations, duties, and requirements for each party. Focus on deliverables, timelines, performance standards, and compliance requirements.',
    icon: <Scale size={18} />,
  },
  {
    id: 'opportunities',
    name: 'Strategic Advantages',
    description: 'Favorable terms and opportunities',
    prompt: 'Find clauses that provide strategic advantages, favorable terms, rights, or options. Include any provisions that could be leveraged in negotiations.',
    icon: <Lightbulb size={18} />,
  },
]

export default function Investigate() {
  const { t } = useTranslation()
  const [documents, setDocuments] = useState<Document[]>([])
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([])
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [selectedVault, setSelectedVault] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [findings, setFindings] = useState<Finding[]>([])
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<string[]>(['US'])
  const [includeRag, setIncludeRag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [activeDoc, setActiveDoc] = useState<string | null>(null)
  const [completedDocs, setCompletedDocs] = useState<Set<string>>(new Set())
  const [failedDocs, setFailedDocs] = useState<Set<string>>(new Set())
  const [noResults, setNoResults] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [scanResults, setScanResults] = useState<Map<string, { docName: string; totalSections: number; selectedHeadings: string[]; skippedCount: number; reasoning: string; ragQueries: string[] }>>(new Map())
  const [ragQueries, setRagQueries] = useState<{ query: string; resultCount: number; triggeredBy: string }[]>([])
  const [comparison, setComparison] = useState<string | null>(null)
  const [docProgress, setDocProgress] = useState<Map<string, { chunk: number; totalChunks: number }>>(new Map())
  const [currentStage, setCurrentStage] = useState<'loading' | 'scanning' | 'searching' | 'analyzing' | 'verifying' | 'comparing' | 'done'>('loading')
  const [stageDetail, setStageDetail] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const findingsRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (searching) {
      const start = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [searching])

  useEffect(() => {
    loadSources()
  }, [])

  const loadSources = async () => {
    setLoading(true)
    try {
      const [docsRes, vaultRes] = await Promise.all([
        api.get('/docs').catch(() => ({ documents: [] })),
        api.get('/vault').catch(() => []),
      ])

      const docList = docsRes.documents || docsRes || []
      setDocuments(Array.isArray(docList) ? docList : [])

      const vaultList = Array.isArray(vaultRes) ? vaultRes : vaultRes.items || []
      setVaultItems(vaultList)
    } catch (err) {
      console.error('Failed to load sources:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleDoc = (id: string) => {
    const newSet = new Set(selectedDocs)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedDocs(newSet)
  }

  const toggleVault = (id: string) => {
    const newSet = new Set(selectedVault)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedVault(newSet)
  }

  const selectPreset = (preset: SearchPreset) => {
    setActivePreset(preset.id)
    setSearchQuery(preset.prompt)
  }

  const clearSelection = () => {
    setSelectedDocs(new Set())
    setSelectedVault(new Set())
  }

  const totalSelected = selectedDocs.size + selectedVault.size

  const cancelInvestigation = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setSearching(false)
    setStageDetail('')
    setActiveDoc(null)
  }

  const runInvestigation = () => {
    if (!searchQuery.trim()) {
      setError('Please enter what you want to find')
      return
    }

    if (totalSelected === 0 && !includeRag) {
      setError('Select at least one document or enable RAG search')
      return
    }

    // Abort any previous investigation
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    setError(null)
    setSearching(true)
    setStageDetail('Starting investigation...')
    setFindings([])
    setProgress(0)
    setCompletedDocs(new Set())
    setFailedDocs(new Set())
    setActiveDoc(null)
    setNoResults(false)
    setScanResults(new Map())
    setRagQueries([])
    setComparison(null)
    setDocProgress(new Map())
    setCurrentStage('loading')
    setStageDetail('Loading documents...')

    const controller = streamInvestigate(
      {
        documentIds: Array.from(selectedDocs),
        vaultItemIds: Array.from(selectedVault),
        query: searchQuery,
        jurisdictions: selectedJurisdictions,
        includeRag,
      },
      {
        onStatus: (msg, pct) => {
          setProgress(pct)
          setStageDetail(msg)
          // Infer stage from status messages
          if (msg.includes('Scanning') || msg.includes('Smart scan')) setCurrentStage('scanning')
          else if (msg.includes('Searching legal') || msg.includes('Follow-up search')) setCurrentStage('searching')
          else if (msg.includes('Analyzing')) setCurrentStage('analyzing')
          else if (msg.includes('Verifying')) setCurrentStage('verifying')
          else if (msg.includes('Comparing') || msg.includes('Merging')) setCurrentStage('comparing')
        },
        onRagSources: (sources) => {
          if (sources.length > 0) {
            setStageDetail(`Found ${sources.length} relevant legal sources`)
            setCurrentStage('searching')
          }
        },
        onDocStart: (_id, name) => {
          setActiveDoc(name)
          setStageDetail(`Analyzing: ${name}`)
          setCurrentStage('analyzing')
        },
        onFinding: (f) => {
          setFindings((prev) => {
            const isFirst = prev.length === 0
            const updated = [
              ...prev,
              {
                id: `inv-${f.id}-${Date.now()}`,
                type: detectFindingType(f.analysis),
                title: `Finding in ${f.name}`,
                excerpt: smartExcerpt(f.analysis),
                source: f.name,
                sourceType: 'document' as const,
                relevance: 0.9,
                analysis: f.analysis,
              },
            ]
            // Scroll to findings only on first result
            if (isFirst) {
              setTimeout(() => {
                findingsRef.current?.scrollIntoView({ behavior: 'smooth' })
              }, 100)
            }
            return updated
          })
        },
        onDocComplete: (id, completed, total, pct) => {
          setCompletedDocs((prev) => new Set(prev).add(id))
          setProgress(pct)
          setStageDetail(`${completed}/${total} documents analyzed`)
        },
        onDocError: (id, _name, _error) => {
          setFailedDocs((prev) => new Set(prev).add(id))
        },
        onDocProgress: (data) => {
          setDocProgress((prev) => new Map(prev).set(data.id, { chunk: data.chunk, totalChunks: data.totalChunks }))
        },
        onScanComplete: (data) => {
          setScanResults((prev) => new Map(prev).set(data.docId, {
            docName: data.docName,
            totalSections: data.totalSections,
            selectedHeadings: data.selectedHeadings,
            skippedCount: data.skippedCount,
            reasoning: data.reasoning,
            ragQueries: data.ragQueries,
          }))
          setStageDetail(`Scanned ${data.docName}: ${data.selectedHeadings.length}/${data.totalSections} sections selected`)
        },
        onRagQuery: (data) => {
          setRagQueries((prev) => [...prev, data])
        },
        onComparison: (data) => {
          setComparison(data.analysis)
          setCurrentStage('comparing')
          setStageDetail('Cross-document comparison complete')
        },
        onAggregation: () => {
          setProgress(100)
          setCurrentStage('done')
        },
        onError: (message) => {
          setError(message)
        },
        onDone: () => {
          setSearching(false)
          setStageDetail('')
          setActiveDoc(null)
          abortRef.current = null
          // Defer noResults check — let React commit any pending finding state updates first
          setTimeout(() => {
            setFindings((prev) => {
              if (prev.length === 0) setNoResults(true)
              return prev
            })
          }, 100)
        },
      },
    )
    abortRef.current = controller
  }

  const detectFindingType = (text: string): Finding['type'] => {
    const lower = text.toLowerCase()
    if (lower.includes('liability') || lower.includes('risk') || lower.includes('penalty')) {
      return 'risk'
    }
    if (lower.includes('opportunity') || lower.includes('advantage') || lower.includes('favorable')) {
      return 'opportunity'
    }
    if (lower.includes('statute') || lower.includes('law') || lower.includes('regulation')) {
      return 'precedent'
    }
    return 'clause'
  }

  const getFindingIcon = (type: Finding['type']) => {
    switch (type) {
      case 'risk':
        return <AlertTriangle size={16} className="text-red-400" />
      case 'opportunity':
        return <Lightbulb size={16} className="text-emerald-400" />
      case 'precedent':
        return <BookOpen size={16} className="text-blue-400" />
      default:
        return <FileText size={16} className="text-amber-400" />
    }
  }

  const getFindingColor = (type: Finding['type']) => {
    switch (type) {
      case 'risk':
        return 'border-red-500/30 bg-red-500/5'
      case 'opportunity':
        return 'border-emerald-500/30 bg-emerald-500/5'
      case 'precedent':
        return 'border-blue-500/30 bg-blue-500/5'
      default:
        return 'border-amber-500/30 bg-amber-500/5'
    }
  }

  const [savedFindings, setSavedFindings] = useState<Set<string>>(new Set())
  const [savingAll, setSavingAll] = useState(false)

  const saveAllFindings = async () => {
    setSavingAll(true)
    try {
      const combined = findings.map(f =>
        `## ${f.title}\n**Source:** ${f.source}\n\n${f.analysis || f.excerpt}`
      ).join('\n\n---\n\n')
      await api.post('/vault', {
        type: 'clause',
        title: `Investigation: ${searchQuery}`,
        content: combined,
        notes: `${findings.length} findings from ${new Date().toLocaleDateString()}`,
      })
      setSavedFindings(new Set(findings.map(f => f.id)))
    } catch { alert(t('investigate.failedSaveVault')) }
    finally { setSavingAll(false) }
  }

  const exportFindings = async (format: 'docx' | 'pdf') => {
    try {
      const response = await fetch(`${apiBase()}/api/research/export/investigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query: searchQuery,
          findings: findings.map(f => ({ title: f.title, source: f.source, analysis: f.analysis || f.excerpt })),
          format,
        }),
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const slug = (searchQuery || 'investigation').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').slice(0, 50)
      a.download = `${slug}_findings.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { console.error('Export failed:', err) }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center">
            <Search size={24} className="text-purple-400" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-parchment">{t('investigate.title')}</h1>
            <p className="text-antique">{t('investigate.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Source Selection */}
        <div className="lg:col-span-1">
          <div className="card sticky top-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg text-parchment flex items-center gap-2">
                <Filter size={18} className="text-antique" />
                Sources
              </h2>
              {totalSelected > 0 && (
                <button
                  onClick={clearSelection}
                  className="text-xs text-antique hover:text-cream transition-colors"
                >
                  Clear ({totalSelected})
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-accent" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Documents */}
                <div>
                  <div className="flex items-center gap-2 text-sm text-antique mb-2">
                    <FileText size={14} />
                    <span>Documents ({documents.length})</span>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {documents.length === 0 ? (
                      <p className="text-xs text-antique/60 py-2">{t('investigate.noDocuments')}</p>
                    ) : (
                      documents.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => toggleDoc(doc.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-button text-left text-sm transition-colors ${
                            selectedDocs.has(doc.id)
                              ? 'bg-accent/10 text-accent border border-accent/30'
                              : 'bg-obsidian hover:bg-leather text-cream border border-transparent'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              selectedDocs.has(doc.id)
                                ? 'bg-accent border-accent'
                                : 'border-tobacco'
                            }`}
                          >
                            {selectedDocs.has(doc.id) && (
                              <CheckCircle2 size={12} className="text-obsidian" />
                            )}
                          </div>
                          <span className="truncate">{doc.filename}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Vault Items */}
                <div>
                  <div className="flex items-center gap-2 text-sm text-antique mb-2">
                    <Archive size={14} />
                    <span>Vault ({vaultItems.length})</span>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {vaultItems.length === 0 ? (
                      <p className="text-xs text-antique/60 py-2">No vault items</p>
                    ) : (
                      vaultItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => toggleVault(item.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-button text-left text-sm transition-colors ${
                            selectedVault.has(item.id)
                              ? 'bg-accent/10 text-accent border border-accent/30'
                              : 'bg-obsidian hover:bg-leather text-cream border border-transparent'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              selectedVault.has(item.id)
                                ? 'bg-accent border-accent'
                                : 'border-tobacco'
                            }`}
                          >
                            {selectedVault.has(item.id) && (
                              <CheckCircle2 size={12} className="text-obsidian" />
                            )}
                          </div>
                          <span className="truncate">{item.title}</span>
                          <span className="text-xs text-antique ml-auto">{item.type}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* RAG Toggle */}
                <div className="pt-4 border-t border-tobacco">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeRag}
                      onChange={(e) => setIncludeRag(e.target.checked)}
                    />
                    <div>
                      <div className="text-sm text-cream">Include Legal Database</div>
                      <div className="text-xs text-antique">
                        Search legal database for precedents
                      </div>
                    </div>
                  </label>
                </div>

                {/* Jurisdiction (multi-select) */}
                <div>
                  <label className="text-sm text-antique mb-1 block">{t('investigate.jurisdictions')}</label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { code: 'US', label: 'US' },
                      { code: 'US-CA', label: 'CA' },
                      { code: 'EW', label: 'E&W' },
                      { code: 'SC', label: 'Scot' },
                      { code: 'NI', label: 'NI' },
                      { code: 'DE', label: 'DE' },
                      { code: 'AT', label: 'AT' },
                      { code: 'SK', label: 'SK' },
                      { code: 'CZ', label: 'CZ' },
                      { code: 'RO', label: 'RO' },
                      { code: 'CY', label: 'CY' },
                      { code: 'ZA', label: 'ZA' },
                    ].map((j) => (
                      <button
                        key={j.code}
                        type="button"
                        onClick={() => {
                          setSelectedJurisdictions((prev) =>
                            prev.includes(j.code)
                              ? prev.length > 1 ? prev.filter((x) => x !== j.code) : prev
                              : [...prev, j.code]
                          )
                        }}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          selectedJurisdictions.includes(j.code)
                            ? 'bg-gold/20 border-gold text-gold'
                            : 'border-cream/20 text-cream/50 hover:border-cream/40'
                        }`}
                      >
                        {j.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Search & Findings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Search Presets */}
          <div className="card">
            <h2 className="font-serif text-lg text-parchment mb-4">{t('investigate.quickSearches')}</h2>
            <div className="grid grid-cols-2 gap-3">
              {searchPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => selectPreset(preset)}
                  className={`flex items-start gap-3 p-4 rounded-lg border transition-all text-left ${
                    activePreset === preset.id
                      ? 'border-accent bg-accent/10'
                      : 'border-tobacco hover:border-accent/30 hover:bg-leather/30'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activePreset === preset.id
                        ? 'bg-accent/20 text-accent'
                        : 'bg-obsidian text-antique'
                    }`}
                  >
                    {preset.icon}
                  </div>
                  <div>
                    <div className="font-medium text-cream text-sm">{preset.name}</div>
                    <div className="text-xs text-antique mt-0.5">{preset.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Search */}
          <div className="card">
            <h2 className="font-serif text-lg text-parchment mb-4 flex items-center gap-2">
              <Sparkles size={18} className="text-accent" />
              Investigation Query
            </h2>
            <textarea
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setActivePreset(null)
              }}
              disabled={searching}
              placeholder={t('investigate.askPlaceholder')}
              rows={5}
              className={`input w-full resize-none mb-4 ${searching ? 'opacity-50 cursor-not-allowed' : ''}`}
            />

            {error && (
              <div className="mb-4 p-3 rounded-button bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-sm text-antique">
                {totalSelected > 0 ? (
                  <span>
                    Searching {totalSelected} source{totalSelected !== 1 ? 's' : ''}
                    {includeRag && ' + Legal Database'}
                  </span>
                ) : includeRag ? (
                  <span>Searching Legal Database only</span>
                ) : (
                  <span className="text-red-400">No sources selected</span>
                )}
              </div>
              {searching ? (
                <button
                  onClick={cancelInvestigation}
                  className="btn-secondary flex items-center gap-2"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={runInvestigation}
                  disabled={!searchQuery.trim()}
                  className="btn-primary flex items-center gap-2"
                >
                  <Search size={18} />
                  Run Investigation
                </button>
              )}
            </div>
          </div>

          {/* Findings */}
          {(findings.length > 0 || searching || noResults) && (
            <div ref={findingsRef} className="card">
              <h2 className="font-serif text-lg text-parchment mb-4 flex items-center gap-2">
                <Target size={18} className="text-accent" />
                Findings
                {findings.length > 0 && (
                  <span className="text-sm font-normal text-antique">
                    ({findings.length} result{findings.length !== 1 ? 's' : ''})
                  </span>
                )}
              </h2>

              {searching && (() => {
                const mins = Math.floor(elapsed / 60)
                const secs = elapsed % 60

                const stageOrder = ['loading', 'scanning', 'searching', 'analyzing', 'verifying', 'comparing', 'done'] as const
                const stageLabels: Record<string, string> = {
                  loading: 'Loading documents',
                  scanning: 'Smart scan',
                  searching: 'Legal database search',
                  analyzing: activeDoc ? `Analyzing: ${activeDoc}` : 'Analyzing sections',
                  verifying: 'Verifying findings',
                  comparing: 'Cross-document comparison',
                  done: 'Complete',
                }
                // Build visible stages (skip 'searching' if RAG disabled, skip 'comparing' for single doc)
                const visibleStages = stageOrder.filter(s => {
                  if (s === 'searching' && !includeRag) return false
                  if (s === 'comparing' && totalSelected <= 1) return false
                  if (s === 'done') return false
                  return true
                })
                const currentIdx = visibleStages.indexOf(currentStage)

                return (
                  <div className="card mb-4 border-accent/30">
                    {/* Header: title + percentage + elapsed + cancel */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Loader2 size={18} className="text-accent animate-spin" />
                        <h3 className="font-medium text-parchment text-sm">{t('investigate.deepAnalyzing')}</h3>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-accent">{progress}%</span>
                        <span className="text-xs text-antique/60">·</span>
                        <span className="text-xs text-antique font-mono">
                          {mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`}
                        </span>
                        <button onClick={cancelInvestigation} className="text-xs text-red-400 hover:text-red-300 ml-1">
                          Cancel
                        </button>
                      </div>
                    </div>

                    {/* Animated gradient progress bar */}
                    <div className="w-full bg-obsidian rounded-full h-2 mb-4">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r from-accent via-forest to-accent bg-[length:200%_100%] animate-shimmer"
                        style={{ width: `${Math.max(progress, 3)}%` }}
                      />
                    </div>

                    {/* Stage checklist */}
                    <div className="space-y-2.5 mb-4">
                      {visibleStages.map((stage, i) => {
                        const isDone = i < currentIdx
                        const isActive = i === currentIdx

                        // Build detail text for active/done stages
                        let detail = ''
                        if (stage === 'scanning' && scanResults.size > 0) {
                          detail = Array.from(scanResults.values()).map(s => `${s.selectedHeadings.length}/${s.totalSections} sections`).join(', ')
                        } else if (stage === 'searching' && ragQueries.length > 0) {
                          detail = `${ragQueries.length} queries, ${ragQueries.reduce((s, q) => s + q.resultCount, 0)} results`
                        } else if (stage === 'analyzing' && docProgress.size > 0) {
                          const entries = Array.from(docProgress.values())
                          if (entries.length > 0) {
                            const latest = entries[entries.length - 1]
                            detail = `Section ${latest.chunk}/${latest.totalChunks}`
                          }
                        } else if (isActive) {
                          detail = stageDetail
                        }

                        return (
                          <div key={stage}>
                            <div className="flex items-center gap-2.5">
                              {isDone ? (
                                <CheckCircle2 size={14} className="text-forest flex-shrink-0" />
                              ) : isActive ? (
                                <div className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border border-tobacco/50 flex-shrink-0" />
                              )}
                              <span className={`text-xs ${isDone ? 'text-cream-dark' : isActive ? 'text-cream font-medium' : 'text-antique/40'}`}>
                                {stageLabels[stage]}
                              </span>
                            </div>
                            {(isDone || isActive) && detail && (
                              <p className="text-[11px] text-antique/60 ml-6 mt-0.5">{detail}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Scan results detail */}
                    {scanResults.size > 0 && (
                      <div className="mb-3 space-y-2">
                        {Array.from(scanResults.entries()).map(([docId, scan]) => (
                          <div key={docId} className="bg-obsidian/50 rounded-button p-2.5">
                            <div className="flex items-center gap-2 text-xs text-cream mb-1">
                              <Filter size={12} className="text-accent" />
                              <span className="font-medium">{scan.docName}</span>
                              <span className="text-antique">
                                {scan.selectedHeadings.length} of {scan.totalSections} sections selected
                                {scan.skippedCount > 0 && ` (${scan.skippedCount} skipped)`}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {scan.selectedHeadings.map((h, i) => (
                                <span key={i} className="text-xs bg-accent/10 text-accent/80 px-1.5 py-0.5 rounded">
                                  {h.length > 40 ? h.substring(0, 40) + '...' : h}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* RAG queries detail */}
                    {ragQueries.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-antique mb-1 flex items-center gap-1.5">
                          <Search size={12} />
                          Legal database searches:
                        </div>
                        <div className="space-y-1">
                          {ragQueries.map((q, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs bg-obsidian/50 rounded px-2 py-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${q.triggeredBy === 'scan' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                {q.triggeredBy === 'scan' ? 'scan' : 'follow-up'}
                              </span>
                              <span className="text-cream/80 flex-1 truncate">{q.query}</span>
                              <span className="text-antique">{q.resultCount} results</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Section progress per document */}
                    {docProgress.size > 0 && (
                      <div className="mb-3 space-y-1">
                        {Array.from(docProgress.entries()).map(([docId, dp]) => {
                          const docName = scanResults.get(docId)?.docName || docId
                          return (
                            <div key={docId} className="flex items-center gap-2 text-xs text-antique">
                              <span className="truncate max-w-[150px]">{docName}</span>
                              <div className="flex-1 bg-obsidian rounded-full h-1">
                                <div className="bg-accent/50 h-1 rounded-full transition-all duration-500" style={{ width: `${(dp.chunk / dp.totalChunks) * 100}%` }} />
                              </div>
                              <span>{dp.chunk}/{dp.totalChunks}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Stats row */}
                    {(completedDocs.size > 0 || failedDocs.size > 0 || findings.length > 0) && (
                      <div className="flex gap-4 text-xs text-antique">
                        {completedDocs.size > 0 && <span>{completedDocs.size} document{completedDocs.size !== 1 ? 's' : ''} done</span>}
                        {findings.length > 0 && <span className="text-accent">{findings.length} finding{findings.length !== 1 ? 's' : ''}</span>}
                        {failedDocs.size > 0 && <span className="text-red-400">{failedDocs.size} failed</span>}
                      </div>
                    )}

                    {/* Time estimate */}
                    {elapsed < 10 && (
                      <p className="text-[11px] text-antique/30 mt-2">Usually takes 1-3 minutes per document</p>
                    )}
                  </div>
                )
              })()}

              {noResults && !searching && findings.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <Search size={32} className="text-antique/40 mx-auto mb-3" />
                    <p className="text-sm text-antique">No findings for this query. Try different search terms or select different documents.</p>
                  </div>
                </div>
              )}

              {findings.length > 0 && !searching && (
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={saveAllFindings}
                    disabled={savingAll || savedFindings.size === findings.length}
                    className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {savedFindings.size === findings.length ? <CheckCheck size={14} /> : <Save size={14} />}
                    {savedFindings.size === findings.length ? 'All Saved' : savingAll ? 'Saving...' : 'Save All to Vault'}
                  </button>
                  <div className="relative group">
                    <button className="btn-secondary flex items-center gap-2 text-sm">
                      <Download size={14} /> Export
                    </button>
                    <div className="absolute left-0 top-full mt-2 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[150px]">
                      <button
                        onClick={() => exportFindings('docx')}
                        className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                      >
                        Export as .docx
                      </button>
                      <button
                        onClick={() => exportFindings('pdf')}
                        className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                      >
                        Export as .pdf
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {findings.map((finding) => (
                  <div
                    key={finding.id}
                    className={`rounded-lg border p-4 ${getFindingColor(finding.type)}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{getFindingIcon(finding.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-cream">{finding.title}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              finding.sourceType === 'rag'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-amber-500/20 text-amber-400'
                            }`}
                          >
                            {finding.sourceType === 'rag' ? 'Legal DB' : 'Document'}
                          </span>
                        </div>
                        <div className="text-sm text-cream-dark leading-relaxed prose-custom max-w-none">
                          <ReactMarkdown>{finding.excerpt}</ReactMarkdown>
                        </div>
                        <div className="flex items-center flex-wrap gap-4 mt-3 text-xs text-antique">
                          <span className="flex items-center gap-1">
                            <FileText size={12} />
                            {finding.source}
                          </span>
                          {finding.verification && finding.verification.total > 0 && (
                            <span className={`inline-flex items-center gap-1 ${
                              finding.verification.confidence === 'high' ? 'text-emerald-400' :
                              finding.verification.confidence === 'medium' ? 'text-amber-400' :
                              'text-antique'
                            }`}>
                              {finding.verification.confidence === 'high' ? <ShieldCheck size={12} /> :
                               finding.verification.removed > 0 ? <ShieldAlert size={12} /> :
                               <ShieldQuestion size={12} />}
                              {finding.verification.verified}/{finding.verification.total} verified
                            </span>
                          )}
                        </div>
                        {finding.analysis && finding.analysis.length > finding.excerpt.length && (
                          <details className="mt-3">
                            <summary className="text-sm text-accent cursor-pointer hover:underline">
                              View full analysis
                            </summary>
                            <div className="mt-2 p-3 bg-obsidian/50 rounded-button text-sm text-cream-dark prose-custom max-w-none">
                              <ReactMarkdown>{finding.analysis}</ReactMarkdown>
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Cross-document comparison */}
              {comparison && (
                <div className="mt-6 rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Scale size={18} className="text-purple-400" />
                    <h3 className="font-serif text-base text-parchment">{t('investigate.comparisonResult')}</h3>
                  </div>
                  <div className="text-sm text-cream-dark leading-relaxed prose-custom max-w-none">
                    <ReactMarkdown>{comparison}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
