import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Upload as UploadIcon,
  FileText,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  Check,
  Pencil,
  Download,
  RefreshCw,
  Eye,
  Sparkles,
  Search,
  Cpu,
  CheckCircle,
  FileSearch,
  Braces,
  ArrowRight,
  Shield,
  Scale,
  Plus,
  AlertTriangle,
  Archive,
} from 'lucide-react'
import { api, apiBase } from '../lib/api'

const API_BASE = apiBase()

const SELECT_STYLE: React.CSSProperties = { colorScheme: 'dark' }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Variable {
  name: string
  type: string
  currentValue: string
  isPlaceholder: boolean
  occurrences?: number
  newValue?: string
}

interface Section {
  title: string
  offset: number
}

interface JudgeVerdict {
  illegal: boolean
  severity: 'critical' | 'moderate' | 'minor' | 'none'
  judgeNote: string
}

interface CheckResult {
  status: 'supported' | 'issue' | 'no_match'
  sources: { name: string; excerpt: string; score: number }[]
  explanation: string
  clauseText: string
  jurisdiction: string
  timestamp: number
  searchQuery?: string
  judge?: JudgeVerdict | null
  savedToVault?: boolean
}

type Tab = 'variables' | 'redline' | 'check' | 'export'
type Phase = 'upload' | 'workstation'

interface ProgressStage {
  id: string
  label: string
  icon: React.ElementType
  status: 'pending' | 'active' | 'done'
  detail?: string
}

const JURISDICTIONS = [
  { code: '', label: 'Select jurisdiction...' },
  { code: 'US', label: 'US (Federal)' },
  { code: 'US-CA', label: 'California' },
  { code: 'EW', label: 'England & Wales' },
  { code: 'SC', label: 'Scotland' },
  { code: 'NI', label: 'Northern Ireland' },
  { code: 'DE', label: 'Germany' },
  { code: 'AT', label: 'Austria (Federal)' },
  { code: 'SK', label: 'Slovakia' },
  { code: 'CZ', label: 'Czech Republic' },
  { code: 'RO', label: 'Romania' },
  { code: 'CY', label: 'Cyprus' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'FR', label: 'France' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'EU', label: 'European Union' },
]

const TYPE_LABELS: Record<string, string> = {
  name: 'Names',
  company: 'Companies',
  date: 'Dates',
  address: 'Addresses',
  amount: 'Amounts',
  jurisdiction: 'Jurisdictions',
  duration: 'Durations',
  other: 'Other',
}

function detectSections(text: string): Section[] {
  const sections: Section[] = []
  const headingRe = /^(?:(?:ARTICLE|SECTION|PART)\s+[IVXLCDM\d]+[.:]\s*|(?:\d+\.)+\s+)[A-Z].*/gm
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(text)) !== null) {
    sections.push({ title: m[0].trim(), offset: m.index })
  }
  const capsRe = /^[A-Z][A-Z ]{3,}$/gm
  while ((m = capsRe.exec(text)) !== null) {
    if (!sections.some(s => Math.abs(s.offset - m!.index) < 5)) {
      sections.push({ title: m[0].trim(), offset: m.index })
    }
  }
  sections.sort((a, b) => a.offset - b.offset)
  return sections
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Workshop() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('upload')
  const [activeTab, setActiveTab] = useState<Tab>('variables')

  const [sessionId, setSessionId] = useState('')
  const [filename, setFilename] = useState('')
  const [docText, setDocText] = useState('')
  const [, setOriginalText] = useState('')
  const [variables, setVariables] = useState<Variable[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [stages, setStages] = useState<ProgressStage[]>([])
  const [progressPct, setProgressPct] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [estimatedChunks, setEstimatedChunks] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [editJurisdiction, setEditJurisdiction] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewriteResult, setRewriteResult] = useState<{ original: string; rewritten: string } | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [rewriteCount, setRewriteCount] = useState(0)

  const [checkText, setCheckText] = useState('')
  const [checkJurisdiction, setCheckJurisdiction] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])

  const [pendingRedline, setPendingRedline] = useState<{ sectionIdx: number; instruction: string } | null>(null)

  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState('')

  // Vault save states
  const [savingVault, setSavingVault] = useState<number | 'all' | null>(null)
  const [vaultSuccess, setVaultSuccess] = useState('')

  const previewText = useCallback(() => {
    let text = docText
    for (const v of variables) {
      if (v.newValue && v.newValue !== v.currentValue) {
        text = text.split(v.currentValue).join(v.newValue)
      }
    }
    return text
  }, [docText, variables])

  const filledCount = variables.filter(v => v.newValue && v.newValue !== v.currentValue).length
  const totalVars = variables.length

  useEffect(() => {
    if (docText && phase === 'workstation') {
      setSections(detectSections(docText))
    }
  }, [docText, phase])

  // Progress helpers
  function initStages(): ProgressStage[] {
    return [
      { id: 'upload', label: 'Uploading document', icon: UploadIcon, status: 'pending' },
      { id: 'parse', label: 'Parsing content', icon: FileSearch, status: 'pending' },
      { id: 'regex', label: 'Scanning for placeholders', icon: Search, status: 'pending' },
      { id: 'llm', label: 'AI analyzing variables', icon: Cpu, status: 'pending' },
      { id: 'verify', label: 'Verifying & deduplicating', icon: Braces, status: 'pending' },
      { id: 'done', label: 'Complete', icon: CheckCircle, status: 'pending' },
    ]
  }

  function advanceStage(stageId: string, detail?: string) {
    setStages(prev => prev.map(s => {
      if (s.id === stageId) return { ...s, status: 'active', detail }
      if (s.status === 'active' && s.id !== stageId) return { ...s, status: 'done' }
      return s
    }))
  }

  function startTimer() {
    setElapsedSec(0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000)
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  useEffect(() => {
    if (pendingRedline && activeTab === 'redline') {
      setEditingSection(pendingRedline.sectionIdx)
      setEditInstruction(pendingRedline.instruction)
      setPendingRedline(null)
    }
  }, [pendingRedline, activeTab])

  // Clear vault success after 3s
  useEffect(() => {
    if (vaultSuccess) {
      const t = setTimeout(() => setVaultSuccess(''), 3000)
      return () => clearTimeout(t)
    }
  }, [vaultSuccess])

  // ---------------------------------------------------------------------------
  // Upload + Extract (all fetch calls use credentials: 'include')
  // ---------------------------------------------------------------------------
  async function handleFile(file: File) {
    setError('')
    const allowed = ['application/pdf', 'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword']
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|docx?|txt)$/i)) {
      setError('Please upload a PDF, DOCX, or TXT file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Maximum 10MB.')
      return
    }

    setLoading(true)
    setStages(initStages())
    setProgressPct(0)
    startTimer()

    try {
      advanceStage('upload')
      setProgressPct(5)
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_BASE}/api/workshop/upload`, { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(err.error || 'Upload failed')
      }
      const data = await res.json()
      setSessionId(data.sessionId)
      setFilename(data.filename)
      setDocText(data.text)
      setOriginalText(data.text)

      advanceStage('parse', `${data.charCount.toLocaleString()} characters extracted`)
      setProgressPct(15)

      const chunkSize = 20000, overlap = 2000
      const numChunks = Math.min(12, Math.max(1, Math.ceil(data.charCount / (chunkSize - overlap))))
      setEstimatedChunks(numChunks)

      await new Promise(r => setTimeout(r, 400))
      advanceStage('regex', 'Finding bracket placeholders, underscores...')
      setProgressPct(20)

      await new Promise(r => setTimeout(r, 300))
      advanceStage('llm', `Chunk 1 of ${numChunks}...`)
      setProgressPct(25)

      const estTimeMs = numChunks * 8000
      const interval = 500
      const steps = estTimeMs / interval
      const pctPerStep = 60 / steps
      let simPct = 25
      let simChunk = 1
      const simTimer = setInterval(() => {
        simPct = Math.min(simPct + pctPerStep, 85)
        setProgressPct(simPct)
        const newChunk = Math.min(numChunks, Math.floor(((simPct - 25) / 60) * numChunks) + 1)
        if (newChunk !== simChunk) {
          simChunk = newChunk
          setStages(prev => prev.map(s =>
            s.id === 'llm' ? { ...s, detail: `Chunk ${simChunk} of ${numChunks}...` } : s
          ))
        }
      }, interval)

      const extractRes = await fetch(`${API_BASE}/api/workshop/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId: data.sessionId }),
      })

      clearInterval(simTimer)

      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({ error: 'Extraction failed' }))
        throw new Error(err.error || 'Extraction failed')
      }
      const extractData = await extractRes.json()

      advanceStage('verify', 'Checking values against document text...')
      setProgressPct(90)
      await new Promise(r => setTimeout(r, 500))

      const vars = (extractData.variables || []).map((v: Variable) => ({
        ...v, newValue: v.isPlaceholder ? '' : v.currentValue
      }))
      setVariables(vars)
      setSections(extractData.sections || [])

      advanceStage('done', `${vars.length} variables, ${(extractData.sections || []).length} sections`)
      setProgressPct(100)
      await new Promise(r => setTimeout(r, 600))

      setPhase('workstation')
      setActiveTab('variables')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
      stopTimer()
      setStages([])
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function updateVariable(idx: number, newValue: string) {
    setVariables(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], newValue }
      return next
    })
  }

  function getSectionText(idx: number): string {
    const start = sections[idx].offset
    const end = idx + 1 < sections.length ? sections[idx + 1].offset : docText.length
    return docText.substring(start, end)
  }

  async function handleRewrite(clauseText: string) {
    if (!editInstruction.trim()) return
    setRewriting(true)
    setRewriteResult(null)
    try {
      const data = await api.post('/workshop/rewrite', {
        sessionId,
        clauseText,
        instruction: editInstruction,
        jurisdiction: editJurisdiction || undefined,
      })
      setRewriteResult({ original: clauseText, rewritten: data.rewritten })
    } catch {
      setError('Clause rewriting failed. Try again.')
    } finally {
      setRewriting(false)
    }
  }

  function acceptRewrite() {
    if (!rewriteResult) return
    setDocText(prev => prev.split(rewriteResult.original).join(rewriteResult.rewritten))
    setRewriteResult(null)
    setEditingSection(null)
    setEditInstruction('')
    setRewriteCount(c => c + 1)
  }

  async function handleSuggest(sectionText: string) {
    setSuggesting(true)
    setSuggestions([])
    try {
      const data = await api.post('/workshop/suggest', { sessionId, sectionText })
      setSuggestions(data.suggestions || [])
    } catch {
      setError('Suggestion generation failed. Try again.')
    } finally {
      setSuggesting(false)
    }
  }

  async function handleCheck() {
    if (!checkText.trim() || !checkJurisdiction) return
    setChecking(true)
    try {
      const data = await api.post('/workshop/check', {
        sessionId,
        clauseText: checkText,
        jurisdiction: checkJurisdiction,
      }) as CheckResult
      setCheckResults(prev => [data, ...prev])
    } catch {
      setError('Legal check failed. Try again.')
    } finally {
      setChecking(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Save to Vault
  // ---------------------------------------------------------------------------
  async function saveCheckToVault(idx: number) {
    const r = checkResults[idx]
    if (!r || r.savedToVault) return
    setSavingVault(idx)
    try {
      const sourcesText = r.sources.map(s => `- ${s.name}: ${s.excerpt}`).join('\n')
      const judgeText = r.judge ? `\n\nJudge: ${r.judge.illegal ? 'ILLEGAL' : 'Compliant'} (${r.judge.severity})${r.judge.judgeNote ? ' — ' + r.judge.judgeNote : ''}` : ''
      const content = `**Clause:** ${r.clauseText}\n\n**Jurisdiction:** ${r.jurisdiction}\n**Status:** ${r.status}${judgeText}\n\n**Analysis:** ${r.explanation}\n\n**Sources:**\n${sourcesText || 'None found'}`

      await api.post('/workshop/save-to-vault', {
        type: 'clause',
        title: `Legal Check: ${r.clauseText.substring(0, 60)}...`,
        content,
        category: 'Legal Check',
        tags: ['workshop', 'legal-check', r.jurisdiction, r.status],
        sourceType: 'workshop',
      })

      setCheckResults(prev => prev.map((cr, i) => i === idx ? { ...cr, savedToVault: true } : cr))
      setVaultSuccess('Saved to Vault')
    } catch {
      setError('Failed to save to vault.')
    } finally {
      setSavingVault(null)
    }
  }

  async function saveAllChecksToVault() {
    const unsaved = checkResults.filter(r => !r.savedToVault)
    if (unsaved.length === 0) return
    setSavingVault('all')
    try {
      const content = checkResults.map((r, i) => {
        const sourcesText = r.sources.map(s => `- ${s.name}`).join('\n')
        const judgeText = r.judge ? ` | Judge: ${r.judge.illegal ? 'ILLEGAL' : 'Compliant'}` : ''
        return `### Check ${i + 1} (${r.jurisdiction} — ${r.status}${judgeText})\n**Clause:** ${r.clauseText}\n**Analysis:** ${r.explanation}\n${sourcesText ? `**Sources:**\n${sourcesText}` : ''}`
      }).join('\n\n---\n\n')

      await api.post('/workshop/save-to-vault', {
        type: 'clause',
        title: `Workshop Checks: ${filename} (${checkResults.length} checks)`,
        content,
        category: 'Legal Check',
        tags: ['workshop', 'legal-check', 'batch'],
        sourceType: 'workshop',
      })

      setCheckResults(prev => prev.map(cr => ({ ...cr, savedToVault: true })))
      setVaultSuccess(`${checkResults.length} checks saved to Vault`)
    } catch {
      setError('Failed to save to vault.')
    } finally {
      setSavingVault(null)
    }
  }

  async function saveDocumentToVault() {
    setSavingVault('all')
    try {
      const finalText = previewText()
      await api.post('/workshop/save-to-vault', {
        type: 'template',
        title: filename.replace(/\.[^.]+$/, '') || 'Workshop Document',
        content: finalText,
        category: 'Workshop',
        tags: ['workshop', 'edited'],
        notes: `${filledCount} variables filled, ${rewriteCount} clauses rewritten, ${checkResults.length} legal checks`,
        sourceType: 'workshop',
      })
      setVaultSuccess('Document saved to Vault')
    } catch {
      setError('Failed to save to vault.')
    } finally {
      setSavingVault(null)
    }
  }

  async function handleExport(format: 'docx' | 'pdf') {
    setExporting(true)
    setExportFormat(format.toUpperCase())
    try {
      const finalText = previewText()
      const res = await fetch(`${API_BASE}/api/workshop/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: filename.replace(/\.[^.]+$/, '') || 'Workshop Document',
          text: finalText,
          format,
        }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename.replace(/\.[^.]+$/, '') || 'document'}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Export failed. Try again.')
    } finally {
      setExporting(false)
      setExportFormat('')
    }
  }

  function reset() {
    setPhase('upload')
    setActiveTab('variables')
    setSessionId('')
    setFilename('')
    setDocText('')
    setOriginalText('')
    setVariables([])
    setSections([])
    setError('')
    setEditingSection(null)
    setRewriteResult(null)
    setSuggestions([])
    setCheckResults([])
    setCheckText('')
    setRewriteCount(0)
  }

  function fixInRedline(clauseText: string, explanation: string) {
    let bestIdx = 0
    let bestOverlap = 0
    const words = clauseText.toLowerCase().split(/\s+/).slice(0, 10)
    for (let i = 0; i < sections.length; i++) {
      const sText = getSectionText(i).toLowerCase()
      const overlap = words.filter(w => sText.includes(w)).length
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIdx = i }
    }
    setPendingRedline({ sectionIdx: bestIdx, instruction: `Fix: ${explanation.substring(0, 150)}` })
    setActiveTab('redline')
  }

  const groupedVars = variables.reduce<Record<string, { vars: Variable[]; indices: number[] }>>((acc, v, i) => {
    const type = v.type || 'other'
    if (!acc[type]) acc[type] = { vars: [], indices: [] }
    acc[type].vars.push(v)
    acc[type].indices.push(i)
    return acc
  }, {})

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="h-full bg-obsidian text-cream flex flex-col">
      {/* Sub-header (inside Layout) */}
      <div className="border-b border-tobacco bg-deep-brown shrink-0">
        <div className="px-5 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-parchment tracking-wide">{t('workshop.title')}</h1>
              <span className="text-[9px] bg-accent/20 text-accent px-1.5 py-0.5 rounded font-semibold tracking-wider">BETA</span>
            {phase === 'workstation' && filename && (
              <>
                <span className="text-tobacco/40">|</span>
                <span className="text-antique text-sm truncate max-w-[250px]">{filename}</span>
                <span className="text-antique/40 text-xs">{docText.length.toLocaleString()} chars</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Vault success toast */}
            {vaultSuccess && (
              <span className="text-xs text-green-400 flex items-center gap-1 bg-green-900/20 px-2 py-1 rounded">
                <Check size={12} /> {vaultSuccess}
              </span>
            )}
            {phase === 'workstation' && (
              <button onClick={reset} className="flex items-center gap-1.5 text-antique hover:text-cream transition-colors text-xs bg-leather/40 hover:bg-leather/70 px-3 py-1.5 rounded-lg border border-tobacco/50">
                <Plus size={12} /> {t('common.create')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-5 pt-3 shrink-0">
          <div className="bg-burgundy/20 border border-burgundy/40 rounded-lg px-4 py-2.5 flex items-center justify-between">
            <span className="text-red-300 text-sm">{error}</span>
            <button onClick={() => setError('')} className="text-red-300 hover:text-red-200"><X size={16} /></button>
          </div>
        </div>
      )}

      {/* Progress overlay */}
      {loading && stages.length > 0 && (
        <div className="fixed inset-0 bg-obsidian/90 z-50 flex items-center justify-center">
          <div className="bg-deep-brown border border-tobacco rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-parchment font-serif text-xl font-bold">{t('workshop.processing')}</h3>
                {filename && <p className="text-antique text-sm mt-0.5 truncate max-w-[280px]">{filename}</p>}
              </div>
              <div className="text-right">
                <div className="text-2xl font-mono text-accent font-bold">{Math.round(progressPct)}%</div>
                <div className="text-xs text-antique">{formatElapsed(elapsedSec)}</div>
              </div>
            </div>
            <div className="h-2 bg-obsidian rounded-full overflow-hidden mb-6">
              <div className="h-full bg-gradient-to-r from-accent to-accent-hover rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="space-y-2.5 mb-6">
              {stages.map((s) => (
                <div key={s.id} className={`flex items-center gap-3 py-1.5 transition-all duration-300 ${
                  s.status === 'active' ? 'opacity-100' : s.status === 'done' ? 'opacity-50' : 'opacity-30'
                }`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    s.status === 'active' ? 'bg-accent/20' : s.status === 'done' ? 'bg-green-900/30' : 'bg-leather/30'
                  }`}>
                    {s.status === 'done' ? <Check size={14} className="text-green-400" /> :
                     s.status === 'active' ? <Loader2 size={14} className="text-accent animate-spin" /> :
                     <s.icon size={14} className="text-antique/50" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${s.status === 'active' ? 'text-parchment font-medium' : s.status === 'done' ? 'text-antique line-through' : 'text-antique/60'}`}>{s.label}</span>
                    {s.detail && (s.status === 'active' || s.status === 'done') && (
                      <p className={`text-xs mt-0.5 truncate ${s.status === 'active' ? 'text-accent/80' : 'text-antique/40'}`}>{s.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {estimatedChunks > 1 && elapsedSec < 5 && (
              <p className="text-center text-xs text-antique/40 mt-4">Large document — estimated {estimatedChunks > 6 ? '60-90' : estimatedChunks > 3 ? '30-60' : '15-30'}s</p>
            )}
          </div>
        </div>
      )}

      {/* ============ UPLOAD PHASE ============ */}
      {phase === 'upload' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-2xl w-full px-6">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif text-parchment font-bold mb-3">{t('workshop.title')}</h2>
              <p className="text-antique text-lg">{t('workshop.subtitle')}</p>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                dragOver ? 'border-accent bg-accent/10' : 'border-tobacco hover:border-accent/50 hover:bg-leather/30'
              }`}
            >
              <UploadIcon size={48} className={`mx-auto mb-4 ${dragOver ? 'text-accent' : 'text-antique'}`} />
              <p className="text-parchment text-lg mb-2">{t('workshop.dropDocument')}</p>
              <p className="text-antique text-sm">{t('workshop.fileFormats')}</p>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" onChange={onFileSelect} className="hidden" />
            </div>

            <div className="mt-8 grid grid-cols-4 gap-3 text-center text-sm text-antique">
              {[
                { icon: Sparkles, title: t('workshop.feature.variables'), desc: t('workshop.feature.variablesDesc') },
                { icon: Pencil, title: t('workshop.feature.redline'), desc: t('workshop.feature.redlineDesc') },
                { icon: Shield, title: t('workshop.feature.check'), desc: t('workshop.feature.checkDesc') },
                { icon: Archive, title: t('workshop.feature.save'), desc: t('workshop.feature.saveDesc') },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-deep-brown rounded-lg p-4 border border-tobacco">
                  <Icon size={20} className="mx-auto mb-2 text-accent" />
                  <p className="text-parchment font-medium mb-1">{title}</p>
                  <p className="text-xs">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ WORKSTATION PHASE ============ */}
      {phase === 'workstation' && (
        <div className="flex flex-1 min-h-0">
          {/* LEFT: Tab Panel (50%) */}
          <div className="w-1/2 flex flex-col border-r border-tobacco min-h-0">
            <div className="border-b border-tobacco bg-deep-brown flex shrink-0">
              {([
                { id: 'variables' as Tab, label: t('workshop.feature.variables'), icon: Braces, badge: totalVars > 0 ? `${filledCount}/${totalVars}` : undefined },
                { id: 'redline' as Tab, label: t('workshop.feature.redline'), icon: Pencil, badge: rewriteCount > 0 ? `${rewriteCount}` : undefined },
                { id: 'check' as Tab, label: t('workshop.feature.check'), icon: Shield, badge: checkResults.length > 0 ? `${checkResults.length}` : undefined },
                { id: 'export' as Tab, label: t('common.export'), icon: Download },
              ]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? 'border-accent text-accent bg-accent/5'
                      : 'border-transparent text-antique hover:text-cream hover:bg-leather/20'
                  }`}
                >
                  <tab.icon size={14} />
                  {tab.label}
                  {tab.badge && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      activeTab === tab.id ? 'bg-accent/20 text-accent' : 'bg-leather text-antique'
                    }`}>{tab.badge}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === 'variables' && (
                <VariablesTab groupedVars={groupedVars} filledCount={filledCount} totalVars={totalVars} onUpdate={updateVariable} />
              )}
              {activeTab === 'redline' && (
                <RedlineTab
                  sections={sections} editingSection={editingSection} setEditingSection={setEditingSection}
                  editInstruction={editInstruction} setEditInstruction={setEditInstruction}
                  editJurisdiction={editJurisdiction} setEditJurisdiction={setEditJurisdiction}
                  rewriting={rewriting} rewriteResult={rewriteResult} suggesting={suggesting} suggestions={suggestions}
                  getSectionText={getSectionText} onRewrite={handleRewrite} onAcceptRewrite={acceptRewrite}
                  onRejectRewrite={() => setRewriteResult(null)} onSuggest={handleSuggest} onUseSuggestion={(s) => setEditInstruction(s)}
                />
              )}
              {activeTab === 'check' && (
                <CheckTab
                  checkText={checkText} setCheckText={setCheckText}
                  checkJurisdiction={checkJurisdiction} setCheckJurisdiction={setCheckJurisdiction}
                  checking={checking} checkResults={checkResults} onCheck={handleCheck}
                  onFixInRedline={fixInRedline} sections={sections}
                  onSaveToVault={saveCheckToVault} onSaveAllToVault={saveAllChecksToVault}
                  savingVault={savingVault}
                />
              )}
              {activeTab === 'export' && (
                <ExportTab filename={filename} filledCount={filledCount} rewriteCount={rewriteCount}
                  checkCount={checkResults.length} charCount={previewText().length}
                  exporting={exporting} exportFormat={exportFormat} onExport={handleExport}
                  onSaveToVault={saveDocumentToVault} savingVault={savingVault === 'all'}
                />
              )}
            </div>
          </div>

          {/* RIGHT: Document Preview (50%) */}
          <div className="w-1/2 flex flex-col bg-obsidian/50 min-h-0">
            <div className="px-4 py-2 border-b border-tobacco bg-deep-brown/30 flex items-center gap-2 shrink-0">
              <Eye size={14} className="text-antique/60" />
              <span className="text-xs font-medium text-antique/80">{t('common.preview')}</span>
              <span className="text-[10px] text-antique/40 ml-auto">{previewText().length.toLocaleString()} chars</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <DocPane text={previewText()} variables={variables} activeTab={activeTab}
                editingSection={editingSection} sections={sections} checkResults={checkResults} docText={docText} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// DocPane
// ===========================================================================
function DocPane({ text, variables, activeTab, editingSection, sections, checkResults, docText }: {
  text: string; variables: Variable[]; activeTab: Tab; editingSection: number | null
  sections: Section[]; checkResults: CheckResult[]; docText: string
}) {
  const highlightedHtml = useMemo(() => {
    let html = escapeHtml(text)

    if (activeTab === 'variables') {
      for (const v of variables) {
        if (v.newValue && v.newValue !== v.currentValue) {
          const escaped = escapeHtml(v.newValue)
          html = html.split(escaped).join(`<mark class="bg-green-800/40 text-green-300 px-0.5 rounded">${escaped}</mark>`)
        }
      }
      for (const v of variables) {
        if (v.isPlaceholder && (!v.newValue || v.newValue === v.currentValue)) {
          const escaped = escapeHtml(v.currentValue)
          html = html.split(escaped).join(`<mark class="bg-amber-800/40 text-amber-300 px-0.5 rounded">${escaped}</mark>`)
        }
      }
    } else if (activeTab === 'redline' && editingSection !== null && sections[editingSection]) {
      const sec = sections[editingSection]
      const titleEscaped = escapeHtml(sec.title)
      const titleIdx = html.indexOf(titleEscaped)
      if (titleIdx !== -1) {
        let endIdx = html.length
        if (editingSection + 1 < sections.length) {
          const nextTitleEscaped = escapeHtml(sections[editingSection + 1].title)
          const nextIdx = html.indexOf(nextTitleEscaped, titleIdx + titleEscaped.length)
          if (nextIdx !== -1) endIdx = nextIdx
        }
        const before = html.substring(0, titleIdx)
        const sectionHtml = html.substring(titleIdx, endIdx)
        const after = html.substring(endIdx)
        html = before + `<div class="border-l-[3px] border-blue-400 pl-3 bg-blue-900/10 -ml-3">${sectionHtml}</div>` + after
      }
    } else if (activeTab === 'check' && checkResults.length > 0) {
      const latest = checkResults[0]
      if (latest) {
        const clauseEscaped = escapeHtml(latest.clauseText)
        const colorClass = latest.status === 'supported' ? 'bg-green-800/30 text-green-300' :
          latest.status === 'issue' ? 'bg-red-800/30 text-red-300' : 'bg-gray-700/30 text-gray-300'
        const idx = html.indexOf(clauseEscaped)
        if (idx !== -1) {
          html = html.substring(0, idx) + `<mark class="${colorClass} px-0.5 rounded">${clauseEscaped}</mark>` + html.substring(idx + clauseEscaped.length)
        }
      }
    }

    return html
  }, [text, variables, activeTab, editingSection, sections, checkResults, docText])

  return (
    <div className="px-6 py-5 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap text-cream/75 selection:bg-accent/30"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  )
}

// ===========================================================================
// Variables Tab
// ===========================================================================
function VariablesTab({ groupedVars, filledCount, totalVars, onUpdate }: {
  groupedVars: Record<string, { vars: Variable[]; indices: number[] }>
  filledCount: number; totalVars: number; onUpdate: (idx: number, value: string) => void
}) {
  if (totalVars === 0) {
    return (
      <div className="text-antique text-sm bg-deep-brown rounded-lg p-6 border border-tobacco text-center">
        <Braces size={32} className="mx-auto mb-3 text-antique/40" />
        <p className="text-parchment font-medium mb-1">No variables detected</p>
        <p>Your document may not have placeholders or fill-in values.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-parchment">
          Variables <span className="ml-2 text-sm font-normal text-antique">{filledCount}/{totalVars} filled</span>
        </h3>
        <div className="w-24 h-1.5 bg-obsidian rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${totalVars > 0 ? (filledCount / totalVars) * 100 : 0}%` }} />
        </div>
      </div>
      {Object.entries(groupedVars).map(([type, { vars, indices }]) => (
        <VarGroup key={type} type={type} variables={vars} indices={indices} onUpdate={onUpdate} />
      ))}
    </div>
  )
}

function VarGroup({ type, variables, indices, onUpdate }: {
  type: string; variables: Variable[]; indices: number[]; onUpdate: (idx: number, value: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const label = TYPE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1)
  return (
    <div className="mb-3">
      <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-sm font-medium text-antique hover:text-cream w-full py-1">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {label} ({variables.length})
      </button>
      {!collapsed && (
        <div className="ml-4 space-y-2 mt-1">
          {variables.map((v, i) => (
            <div key={indices[i]} className="bg-deep-brown border border-tobacco rounded-lg px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-parchment font-medium truncate max-w-[200px]" title={v.name}>{v.name}</span>
                <div className="flex items-center gap-2">
                  {v.newValue && v.newValue !== v.currentValue && v.newValue !== '' && <Check size={12} className="text-green-400" />}
                  {v.occurrences && v.occurrences > 1 && <span className="text-xs text-antique/60">{v.occurrences}x</span>}
                </div>
              </div>
              <input
                value={v.isPlaceholder ? (v.newValue || '') : (v.newValue ?? v.currentValue)}
                onChange={(e) => onUpdate(indices[i], e.target.value)}
                placeholder={v.isPlaceholder ? v.currentValue : undefined}
                className={`w-full bg-obsidian border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent ${
                  v.isPlaceholder ? 'border-tobacco text-cream placeholder-antique/40'
                    : v.newValue && v.newValue !== v.currentValue ? 'border-green-700/50 text-green-300' : 'border-tobacco text-cream'
                }`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Redline Tab
// ===========================================================================
function RedlineTab({ sections, editingSection, setEditingSection, editInstruction, setEditInstruction,
  editJurisdiction, setEditJurisdiction, rewriting, rewriteResult, suggesting, suggestions,
  getSectionText, onRewrite, onAcceptRewrite, onRejectRewrite, onSuggest, onUseSuggestion }: {
  sections: Section[]; editingSection: number | null; setEditingSection: (idx: number | null) => void
  editInstruction: string; setEditInstruction: (s: string) => void
  editJurisdiction: string; setEditJurisdiction: (s: string) => void
  rewriting: boolean; rewriteResult: { original: string; rewritten: string } | null
  suggesting: boolean; suggestions: string[]
  getSectionText: (idx: number) => string; onRewrite: (clauseText: string) => void
  onAcceptRewrite: () => void; onRejectRewrite: () => void
  onSuggest: (sectionText: string) => void; onUseSuggestion: (s: string) => void
}) {
  if (sections.length === 0) {
    return (
      <div className="text-antique text-sm bg-deep-brown rounded-lg p-6 border border-tobacco text-center">
        <Pencil size={32} className="mx-auto mb-3 text-antique/40" />
        <p className="text-parchment font-medium mb-1">No sections detected</p>
        <p>Your document doesn't have recognizable section headings.</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-parchment mb-4">
        Sections <span className="text-sm font-normal text-antique">({sections.length})</span>
      </h3>
      <div className="space-y-1.5">
        {sections.map((sec, i) => (
          <div key={`${sec.title}-${sec.offset}`}>
            <button
              onClick={() => { setEditingSection(editingSection === i ? null : i); if (editingSection !== i) setEditInstruction('') }}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-2 ${
                editingSection === i ? 'bg-blue-900/15 border-blue-500/30 text-blue-300' : 'bg-deep-brown border-tobacco/60 hover:border-accent/30 text-parchment'
              }`}
            >
              {editingSection === i ? <ChevronDown size={14} /> : <ChevronRight size={14} className="text-antique/50" />}
              <span className="flex-1 truncate text-sm">{sec.title}</span>
              <Pencil size={12} className="text-antique/40 flex-shrink-0" />
            </button>

            {editingSection === i && (
              <div className="mt-1.5 ml-3 p-4 bg-deep-brown border border-tobacco/60 rounded-lg space-y-3">
                <div className="text-[11px] text-antique/80 max-h-36 overflow-y-auto font-mono whitespace-pre-wrap bg-obsidian/60 rounded-lg p-3 border border-tobacco/30">
                  {getSectionText(i).substring(0, 2000)}
                  {getSectionText(i).length > 2000 && <span className="text-antique/40">...</span>}
                </div>
                <input value={editInstruction} onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder='e.g. "Adapt to Austrian law" or "Add liability cap"'
                  className="w-full bg-obsidian border border-tobacco/60 rounded-lg px-3 py-2 text-sm text-cream placeholder-antique/40 focus:outline-none focus:border-accent"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !rewriting) onRewrite(getSectionText(i)) }}
                />
                <div className="flex gap-2">
                  <select value={editJurisdiction} onChange={(e) => setEditJurisdiction(e.target.value)}
                    className="bg-obsidian border border-tobacco/60 rounded-lg px-2 py-1.5 text-sm text-cream focus:outline-none focus:border-accent flex-1" style={SELECT_STYLE}>
                    <option value="">No jurisdiction</option>
                    {JURISDICTIONS.filter(j => j.code).map(j => <option key={j.code} value={j.code}>{j.label}</option>)}
                  </select>
                  <button onClick={() => onRewrite(getSectionText(i))} disabled={rewriting || !editInstruction.trim()}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-40 text-obsidian font-medium px-4 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5">
                    {rewriting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {rewriting ? 'Rewriting...' : 'Rewrite'}
                  </button>
                  <button onClick={() => onSuggest(getSectionText(i))} disabled={suggesting}
                    className="bg-leather/60 hover:bg-leather text-parchment font-medium px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1 border border-tobacco/40">
                    {suggesting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Suggest
                  </button>
                </div>
                {rewriting && <RewriteProgress jurisdiction={editJurisdiction} />}
                {suggestions.length > 0 && !rewriteResult && (
                  <div>
                    <p className="text-xs text-antique/70 mb-2">Click to use as instruction:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((s, idx) => (
                        <button key={idx} onClick={() => onUseSuggestion(s)}
                          className="text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-lg px-2.5 py-1.5 text-left transition-colors leading-tight">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {rewriteResult && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-red-400 flex items-center gap-1"><X size={12} /> Original</div>
                    <div className="text-[11px] text-antique max-h-40 overflow-y-auto font-mono whitespace-pre-wrap bg-red-950/20 border border-red-800/20 rounded-lg p-3">{rewriteResult.original.substring(0, 3000)}</div>
                    <div className="text-xs font-medium text-green-400 flex items-center gap-1"><Check size={12} /> Rewritten</div>
                    <div className="text-[11px] text-cream max-h-40 overflow-y-auto font-mono whitespace-pre-wrap bg-green-950/20 border border-green-800/20 rounded-lg p-3">{rewriteResult.rewritten.substring(0, 3000)}</div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={onAcceptRewrite} className="flex-1 bg-green-700 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5"><Check size={14} /> Accept</button>
                      <button onClick={onRejectRewrite} className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-300 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5"><X size={14} /> Reject</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// Check Tab — with Save to Vault
// ===========================================================================
function CheckTab({ checkText, setCheckText, checkJurisdiction, setCheckJurisdiction,
  checking, checkResults, onCheck, onFixInRedline, sections, onSaveToVault, onSaveAllToVault, savingVault }: {
  checkText: string; setCheckText: (s: string) => void
  checkJurisdiction: string; setCheckJurisdiction: (s: string) => void
  checking: boolean; checkResults: CheckResult[]
  onCheck: () => void; onFixInRedline: (clauseText: string, explanation: string) => void
  sections: Section[]; onSaveToVault: (idx: number) => void; onSaveAllToVault: () => void
  savingVault: number | 'all' | null
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-parchment mb-1">Legal Compliance Check</h3>
      <p className="text-xs text-antique/70 mb-4">Verify any clause against the legal database. AI generates a search query in the target language, searches statutes, and a judge verifies legality.</p>

      <div className="bg-deep-brown border border-tobacco/60 rounded-lg p-4 mb-4">
        <textarea value={checkText} onChange={(e) => setCheckText(e.target.value)}
          placeholder="Paste or type a clause to check against the legal database..."
          rows={4} className="w-full bg-obsidian border border-tobacco/60 rounded-lg px-3 py-2 text-sm text-cream placeholder-antique/40 focus:outline-none focus:border-accent resize-none mb-3" />
        <div className="flex gap-2">
          <select value={checkJurisdiction} onChange={(e) => setCheckJurisdiction(e.target.value)}
            className="bg-obsidian border border-tobacco/60 rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-accent flex-1" style={SELECT_STYLE}>
            {JURISDICTIONS.map(j => <option key={j.code} value={j.code}>{j.label}</option>)}
          </select>
          <button onClick={onCheck} disabled={checking || !checkText.trim() || !checkJurisdiction}
            className="bg-accent hover:bg-accent-hover disabled:opacity-40 text-obsidian font-semibold px-6 py-2 rounded-lg text-sm transition-colors flex items-center gap-2">
            {checking ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
            {checking ? 'Checking...' : 'Check'}
          </button>
        </div>
      </div>

      {checking && <CheckProgress jurisdiction={checkJurisdiction} />}

      {checkResults.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-antique">Results ({checkResults.length})</h4>
            <button onClick={onSaveAllToVault} disabled={savingVault !== null || checkResults.every(r => r.savedToVault)}
              className="text-xs text-accent hover:text-accent-hover disabled:opacity-40 transition-colors flex items-center gap-1">
              {savingVault === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
              Save all to Vault
            </button>
          </div>
          <div className="space-y-3">
            {checkResults.map((r, i) => (
              <div key={i} className={`border rounded-lg overflow-hidden ${
                r.status === 'supported' ? 'border-green-700/30' : r.status === 'issue' ? 'border-red-700/30' : 'border-tobacco/60'
              }`}>
                <div className={`px-4 py-2 flex items-center justify-between ${
                  r.status === 'supported' ? 'bg-green-900/15' : r.status === 'issue' ? 'bg-red-900/15' : 'bg-deep-brown'
                }`}>
                  <span className={`text-xs font-semibold flex items-center gap-1.5 ${
                    r.status === 'supported' ? 'text-green-400' : r.status === 'issue' ? 'text-red-400' : 'text-antique/60'
                  }`}>
                    {r.status === 'supported' ? <CheckCircle size={13} /> : r.status === 'issue' ? <AlertTriangle size={13} /> : <Search size={13} />}
                    {r.status === 'supported' ? 'Supported' : r.status === 'issue' ? 'Issue Found' : 'No Match'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-antique/40">{r.jurisdiction}</span>
                    {r.savedToVault ? (
                      <span className="text-[10px] text-green-400 flex items-center gap-0.5"><Check size={10} /> Saved</span>
                    ) : (
                      <button onClick={() => onSaveToVault(i)} disabled={savingVault !== null}
                        className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-40 flex items-center gap-0.5 transition-colors">
                        {savingVault === i ? <Loader2 size={10} className="animate-spin" /> : <Archive size={10} />} Save
                      </button>
                    )}
                  </div>
                </div>

                <div className="px-4 py-3">
                  <p className="text-[11px] text-antique/70 font-mono mb-2 line-clamp-2">{r.clauseText}</p>
                  <p className="text-sm text-cream/85 mb-2 leading-relaxed">{r.explanation}</p>

                  {r.judge && (
                    <div className={`text-xs rounded-lg px-3 py-2 mb-2 flex items-start gap-2 ${
                      r.judge.illegal ? 'bg-red-950/30 border border-red-800/20' : 'bg-green-950/20 border border-green-800/20'
                    }`}>
                      <Shield size={13} className={`mt-0.5 flex-shrink-0 ${r.judge.illegal ? 'text-red-400' : 'text-green-400'}`} />
                      <div>
                        <span className={`font-medium ${r.judge.illegal ? 'text-red-300' : 'text-green-300'}`}>
                          Judge: {r.judge.illegal ? `Illegal (${r.judge.severity})` : 'Compliant'}
                        </span>
                        {r.judge.judgeNote && <p className="text-antique/70 mt-0.5">{r.judge.judgeNote}</p>}
                      </div>
                    </div>
                  )}

                  {r.searchQuery && <p className="text-[10px] text-antique/40 mb-2 italic">Search: "{r.searchQuery}"</p>}

                  {r.sources.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-antique/50 mb-1 uppercase tracking-wider">Sources</p>
                      <div className="space-y-1">
                        {r.sources.map((s, j) => (
                          <div key={j} className="text-xs bg-obsidian/40 rounded-lg px-2.5 py-1.5 border border-tobacco/20">
                            <span className="text-parchment/90 font-medium">{s.name}</span>
                            <p className="text-antique/50 mt-0.5 line-clamp-2">{s.excerpt}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {r.status === 'issue' && sections.length > 0 && (
                    <button onClick={() => onFixInRedline(r.clauseText, r.explanation)}
                      className="text-xs text-accent hover:text-accent-hover transition-colors flex items-center gap-1 mt-1">
                      <ArrowRight size={12} /> Fix in Redline
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Export Tab — with Save to Vault
// ===========================================================================
function ExportTab({ filename, filledCount, rewriteCount, checkCount, charCount, exporting, exportFormat, onExport, onSaveToVault, savingVault }: {
  filename: string; filledCount: number; rewriteCount: number; checkCount: number; charCount: number
  exporting: boolean; exportFormat: string; onExport: (format: 'docx' | 'pdf') => void
  onSaveToVault: () => void; savingVault: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="max-w-md mx-auto text-center pt-8">
      <FileText size={44} className="mx-auto mb-4 text-accent" />
      <h3 className="text-xl font-serif text-parchment font-bold mb-2">{t('workshop.exportDocument')}</h3>
      <p className="text-antique text-sm mb-6">{filename} &middot; {charCount.toLocaleString()} characters</p>

      <div className="bg-deep-brown border border-tobacco/60 rounded-lg p-4 mb-6 text-left">
        <h4 className="text-xs font-medium text-antique/60 uppercase tracking-wider mb-2">Changes Applied</h4>
        <div className="space-y-1.5 text-sm text-antique">
          <div className="flex items-center gap-2"><Braces size={13} className="text-accent" /><span>{filledCount} variable{filledCount !== 1 ? 's' : ''} filled</span></div>
          <div className="flex items-center gap-2"><Pencil size={13} className="text-accent" /><span>{rewriteCount} clause{rewriteCount !== 1 ? 's' : ''} rewritten</span></div>
          <div className="flex items-center gap-2"><Shield size={13} className="text-accent" /><span>{checkCount} legal check{checkCount !== 1 ? 's' : ''} performed</span></div>
        </div>
      </div>

      <div className="flex gap-3 justify-center mb-4">
        <button onClick={() => onExport('docx')} disabled={exporting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-obsidian font-semibold px-8 py-3 rounded-lg transition-colors flex items-center gap-2">
          {exporting && exportFormat === 'DOCX' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          {exporting && exportFormat === 'DOCX' ? 'Generating...' : 'DOCX'}
        </button>
        <button onClick={() => onExport('pdf')} disabled={exporting}
          className="bg-leather/60 hover:bg-leather text-parchment font-semibold px-8 py-3 rounded-lg transition-colors flex items-center gap-2 border border-tobacco/50">
          {exporting && exportFormat === 'PDF' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          {exporting && exportFormat === 'PDF' ? 'Generating...' : 'PDF'}
        </button>
      </div>

      <button onClick={onSaveToVault} disabled={savingVault}
        className="text-sm text-accent hover:text-accent-hover disabled:opacity-50 transition-colors flex items-center gap-1.5 mx-auto">
        {savingVault ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
        Save to Vault
      </button>
    </div>
  )
}

// ===========================================================================
// Progress indicators
// ===========================================================================
function RewriteProgress({ jurisdiction }: { jurisdiction: string }) {
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 2500); return () => clearInterval(t) }, [])
  const messages = jurisdiction
    ? ['Reading clause...', `Searching ${jurisdiction} legal database...`, 'Analyzing legal requirements...', 'Drafting rewrite...', 'Almost there...']
    : ['Reading clause...', 'Analyzing structure...', 'Drafting rewrite...', 'Polishing language...', 'Almost there...']
  return (
    <div className="bg-obsidian/40 rounded-lg px-3 py-2.5 flex items-center gap-3">
      <div className="relative w-4 h-4 flex-shrink-0">
        <div className="absolute inset-0 border-2 border-accent/30 rounded-full" />
        <div className="absolute inset-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
      <span className="text-xs text-antique/80 animate-pulse">{messages[Math.min(tick, messages.length - 1)]}</span>
    </div>
  )
}

function CheckProgress({ jurisdiction }: { jurisdiction: string }) {
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 3000); return () => clearInterval(t) }, [])
  const messages = [
    `Generating ${jurisdiction} search query...`, 'Searching legal database...', 'Reranking results...',
    'Comparing clause against statutes...', 'Judge reviewing legality...', 'Finalizing analysis...',
  ]
  return (
    <div className="bg-deep-brown border border-tobacco/40 rounded-lg px-4 py-3 mb-4 flex items-center gap-3">
      <div className="relative w-4 h-4 flex-shrink-0">
        <div className="absolute inset-0 border-2 border-accent/30 rounded-full" />
        <div className="absolute inset-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
      <span className="text-sm text-antique/80 animate-pulse">{messages[Math.min(tick, messages.length - 1)]}</span>
    </div>
  )
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
