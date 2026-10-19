import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Send,
  FileText,
  Globe,
  Download,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  HelpCircle,
  X,
  ArrowLeft,
} from 'lucide-react'
import { api, apiBase } from '../lib/api'

interface Question {
  id: string
  text?: string
  question?: string
  type: 'text' | 'select' | 'multiselect'
  options?: (string | { value: string; label: string })[]
  required?: boolean
}

interface DetectionResult {
  documentType: string
  name?: string
  reasoning: string
  suggestions?: string[]
  questions?: Question[]
  confidence?: number | string
}

interface DraftResult {
  content: string
  warnings?: string[]
  sections?: string[]
}

const jurisdictions = [
  { code: 'US', label: 'US (Federal)', flag: '🇺🇸' },
  { code: 'US-CA', label: 'California', flag: '🇺🇸' },
  { code: 'EW', label: 'England & Wales', flag: '🇬🇧' },
  { code: 'SC', label: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { code: 'NI', label: 'Northern Ireland', flag: '🇬🇧' },
  { code: 'DE', label: 'Germany', flag: '🇩🇪' },
  { code: 'AT', label: 'Austria (Federal)', flag: '🇦🇹' },
  { code: 'SK', label: 'Slovakia', flag: '🇸🇰' },
  { code: 'CZ', label: 'Czech Republic', flag: '🇨🇿' },
  { code: 'RO', label: 'Romania', flag: '🇷🇴' },
  { code: 'CY', label: 'Cyprus', flag: '🇨🇾' },
  { code: 'ZA', label: 'South Africa', flag: '🇿🇦' },
]

const languages = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'sk', label: 'Slovak' },
]

type Step = 'input' | 'detection' | 'questions' | 'generating' | 'draft'

export default function Navigator() {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('input')
  const [situation, setSituation] = useState('')
  const [jurisdiction, setJurisdiction] = useState('US')
  const [language, setLanguage] = useState('en')

  // Detection
  const [loading, setLoading] = useState(false)
  const [detection, setDetection] = useState<DetectionResult | null>(null)

  // Questions
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

  // Draft
  const [draft, setDraft] = useState<DraftResult | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // Section regeneration
  const [regeneratingSection, setRegeneratingSection] = useState<number | null>(null)

  // UI
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const draftRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  // Track scroll position on the draft container — disable auto-scroll when user scrolls up
  useEffect(() => {
    const container = draftRef.current
    if (!container) return
    let userScrolled = false
    const handleWheel = () => { userScrolled = true }
    const handleScroll = () => {
      if (!userScrolled) return // ignore programmatic scrolls
      userScrolled = false
      const { scrollTop, scrollHeight, clientHeight } = container
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100
    }
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('touchmove', handleWheel, { passive: true })
    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchmove', handleWheel)
      container.removeEventListener('scroll', handleScroll)
    }
  }, [step]) // re-attach when step changes (new container may mount)

  // Parse streamed JSON into structured document
  const parsedDocument = (() => {
    const raw = streamingContent || draft?.content || ''
    if (!raw.trim()) return null
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.title && parsed.sections && Array.isArray(parsed.sections)) {
        return parsed as { title: string; sections: { title: string; content: string }[] }
      }
    } catch {
      // Not valid JSON yet (still streaming) or plain text
    }
    return null
  })()

  // Get clean text for copy/export
  const getFormattedText = () => {
    if (parsedDocument) {
      let text = parsedDocument.title.toUpperCase() + '\n\n'
      for (const section of parsedDocument.sections) {
        text += section.title.toUpperCase() + '\n\n'
        text += section.content + '\n\n'
      }
      return text.trim()
    }
    return streamingContent || draft?.content || ''
  }

  useEffect(() => {
    if (draftRef.current && isStreaming && isNearBottomRef.current) {
      draftRef.current.scrollTop = draftRef.current.scrollHeight
    }
  }, [streamingContent, isStreaming])

  const handleDetect = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!situation.trim() || loading) return

    setLoading(true)
    setError('')

    try {
      // If user pre-selected a document type, skip LLM detection — go straight to questions
      if (detection?.documentType && detection.confidence === 1.0) {
        const data = await api.post('/navigator/questions', {
          documentType: detection.documentType,
          situation: situation.trim(),
          jurisdiction,
        })
        setDetection(prev => prev ? { ...prev, questions: data.questions || [] } : prev)
        if (data.questions && data.questions.length > 0) {
          setStep('questions')
        } else {
          setStep('detection')
        }
      } else {
        // No pre-selection — let LLM detect the document type
        setDetection(null)
        const data = await api.post('/navigator/detect', {
          situation: situation.trim(),
          jurisdiction,
        })
        // After detection, also fetch questions for this document type
        let questions: Question[] = []
        try {
          const qData = await api.post('/navigator/questions', {
            documentType: data.documentType,
            situation: situation.trim(),
            jurisdiction,
          })
          questions = qData.questions || []
        } catch {
          // Questions fetch failed, continue without
        }
        setDetection({
          documentType: data.documentType,
          name: data.name,
          reasoning: data.reasoning,
          suggestions: data.suggestions || [],
          questions,
          confidence: data.confidence,
        })
        // Always show detection step first so user can confirm document type
        setStep('detection')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze situation')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateDraft = async () => {
    if (!detection?.documentType) return

    setStep('generating')
    setDraft(null)
    setStreamingContent('')
    setIsStreaming(true)
    isNearBottomRef.current = true
    setError('')

    // Resolve __other__ values to their custom text
    const resolvedAnswers: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(answers)) {
      if (key.endsWith('_custom')) continue // skip custom fields, handled below
      if (value === '__other__') {
        // select: replace __other__ with custom text
        resolvedAnswers[key] = (answers[`${key}_custom`] as string) || ''
      } else if (Array.isArray(value) && value.includes('__other__')) {
        // multiselect: replace __other__ entry with custom text
        const customText = (answers[`${key}_custom`] as string) || ''
        resolvedAnswers[key] = value
          .filter((v) => v !== '__other__')
          .concat(customText ? [customText] : [])
      } else {
        resolvedAnswers[key] = value
      }
    }

    try {
      // Try streaming first
      const response = await fetch('/api/navigator/draft/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          documentType: detection.documentType,
          situation,
          jurisdiction,
          language,
          answers: resolvedAnswers,
        }),
      })

      if (response.ok && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.text) {
                  setStreamingContent((prev) => prev + data.text)
                } else if (data.content) {
                  setStreamingContent((prev) => prev + data.content)
                } else if (data.done) {
                  // Stream complete
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        setDraft({ content: '' }) // Will use streamingContent
        setStep('draft')
      } else {
        // Fallback to non-streaming
        const data = await api.post('/navigator/draft', {
          documentType: detection.documentType,
          situation,
          jurisdiction,
          language,
          answers: resolvedAnswers,
        })

        setStreamingContent(data.content || data.document || '')
        setDraft({
          content: data.content || data.document || '',
          warnings: data.warnings,
          sections: data.sections,
        })
        setStep('draft')
      }
    } catch (err) {
      // Fallback to non-streaming on error
      try {
        const data = await api.post('/navigator/draft', {
          documentType: detection.documentType,
          situation,
          jurisdiction,
          language,
          answers: resolvedAnswers,
        })

        setStreamingContent(data.content || data.document || '')
        setDraft({
          content: data.content || data.document || '',
          warnings: data.warnings,
          sections: data.sections,
        })
        setStep('draft')
      } catch (err2) {
        setError(err2 instanceof Error ? err2.message : 'Failed to generate draft')
        setStep('detection')
      }
    } finally {
      setIsStreaming(false)
    }
  }

  const handleCopy = async () => {
    const content = getFormattedText()
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = content
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = async (format: 'txt' | 'md' | 'docx' | 'pdf') => {
    if (format === 'docx' || format === 'pdf') {
      try {
        const endpoint = format === 'pdf'
          ? `${apiBase()}/api/research/export/navigator/pdf`
          : `${apiBase()}/api/research/export/navigator`
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            title: parsedDocument?.title || detection?.name || detection?.documentType || 'Draft',
            sections: parsedDocument?.sections || [{ title: 'Content', content: getFormattedText() }],
            jurisdiction,
            language,
          }),
        })
        if (!response.ok) throw new Error('Export failed')
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${(detection?.name || detection?.documentType || 'draft').replace(/\s+/g, '_')}.${format}`
        a.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        console.error(`${format.toUpperCase()} export failed:`, err)
      }
      return
    }

    const content = getFormattedText()
    const filename = `${(detection?.name || detection?.documentType || 'draft').replace(/\s+/g, '_')}.${format}`

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveToVault = async () => {
    const content = getFormattedText()
    if (!content) return

    try {
      await api.post('/vault', {
        title: detection?.documentType || 'Legal Draft',
        content,
        type: 'template',
        tags: ['draft', jurisdiction.toLowerCase()],
      })
      alert('Saved to vault!')
    } catch (err) {
      console.error('Failed to save to vault:', err)
    }
  }

  const handleRegenerateSection = async (sectionIndex: number) => {
    if (!parsedDocument || !detection?.documentType || regeneratingSection !== null) return
    setRegeneratingSection(sectionIndex)
    try {
      const data = await api.post('/navigator/regenerate-section', {
        documentType: detection.documentType,
        situation,
        jurisdiction,
        language,
        answers,
        sectionTitle: parsedDocument.sections[sectionIndex].title,
        sectionIndex,
      })
      if (data.content) {
        setStreamingContent(prev => {
          try {
            const jsonMatch = prev.match(/\{[\s\S]*\}/)
            if (!jsonMatch) return prev
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.sections && parsed.sections[sectionIndex]) {
              parsed.sections[sectionIndex].content = data.content
              return JSON.stringify(parsed)
            }
          } catch { /* ignore */ }
          return prev
        })
      }
    } catch (err) {
      console.error('Section regeneration failed:', err)
    } finally {
      setRegeneratingSection(null)
    }
  }

  // Lightweight line-by-line parser for legal content: sub-clauses, bold, bullets
  const renderLegalContent = (text: string) => {
    if (!text) return null
    const lines = text.split('\n')
    const elements: React.ReactNode[] = []
    let paragraphBuffer: string[] = []
    let key = 0

    const parseBold = (line: string): React.ReactNode[] => {
      const parts: React.ReactNode[] = []
      const re = /\*\*(.+?)\*\*/g
      let lastIdx = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(line)) !== null) {
        if (match.index > lastIdx) {
          parts.push(<span key={`t${lastIdx}`}>{line.slice(lastIdx, match.index)}</span>)
        }
        parts.push(<strong key={`b${match.index}`} className="text-cream font-semibold">{match[1]}</strong>)
        lastIdx = re.lastIndex
      }
      if (lastIdx < line.length) {
        parts.push(<span key={`t${lastIdx}`}>{line.slice(lastIdx)}</span>)
      }
      return parts.length > 0 ? parts : [<span key="f">{line}</span>]
    }

    const flushParagraph = () => {
      if (paragraphBuffer.length > 0) {
        const text = paragraphBuffer.join(' ')
        elements.push(
          <p key={key++} className="text-cream-dark text-sm leading-relaxed mb-2">
            {parseBold(text)}
          </p>
        )
        paragraphBuffer = []
      }
    }

    for (const line of lines) {
      const trimmed = line.trim()

      // Blank line = paragraph break
      if (!trimmed) {
        flushParagraph()
        continue
      }

      // Sub-clause (e.g. "1.1 ...", "3.2.1 ...")
      if (/^\d+\.\d+/.test(trimmed)) {
        flushParagraph()
        const match = trimmed.match(/^([\d.]+)\s+(.*)/)
        if (match) {
          elements.push(
            <div key={key++} className="pl-6 mb-1.5 flex gap-2 text-sm leading-relaxed">
              <span className="text-accent font-semibold flex-shrink-0">{match[1]}</span>
              <span className="text-cream-dark">{parseBold(match[2])}</span>
            </div>
          )
        } else {
          elements.push(
            <div key={key++} className="pl-6 mb-1.5 text-cream-dark text-sm leading-relaxed">
              {parseBold(trimmed)}
            </div>
          )
        }
        continue
      }

      // Bullet point
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        flushParagraph()
        elements.push(
          <div key={key++} className="pl-6 mb-1 flex gap-2 text-sm leading-relaxed">
            <span className="text-antique flex-shrink-0">&bull;</span>
            <span className="text-cream-dark">{parseBold(trimmed.slice(2))}</span>
          </div>
        )
        continue
      }

      // Normal text — buffer into paragraph
      paragraphBuffer.push(trimmed)
    }
    flushParagraph()

    return <div>{elements}</div>
  }

  const reset = () => {
    setStep('input')
    setSituation('')
    setDetection(null)
    setDraft(null)
    setStreamingContent('')
    setAnswers({})
    setError('')
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {step !== 'input' && (
            <button
              onClick={() => setStep(step === 'draft' ? 'detection' : 'input')}
              className="text-antique hover:text-cream transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="font-serif text-3xl text-parchment">{t('navigator.title')}</h1>
        </div>
        <p className="text-antique">
          {step === 'input' && 'Describe your situation and I\'ll help draft the right document'}
          {step === 'detection' && 'Review the recommended document type'}
          {step === 'questions' && 'Answer a few questions to customize your document'}
          {step === 'generating' && 'Generating your document...'}
          {step === 'draft' && 'Your generated document'}
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-8">
        {['input', 'detection', 'questions', 'draft'].map((s, i) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step === s || ['input', 'detection', 'questions', 'draft'].indexOf(step) > i
                  ? 'bg-accent text-ink'
                  : 'bg-leather text-antique'
              }`}
            >
              {i + 1}
            </div>
            {i < 3 && (
              <div
                className={`w-12 h-0.5 ${
                  ['input', 'detection', 'questions', 'draft'].indexOf(step) > i
                    ? 'bg-accent'
                    : 'bg-leather'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-burgundy/20 border border-burgundy/50 rounded-card px-4 py-3 flex items-start gap-3">
          <X size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-red-300 text-sm">{error}</div>
            <button
              onClick={() => setError('')}
              className="text-xs text-red-400 hover:text-red-300 mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Step: Input */}
      {step === 'input' && (
        <div className="space-y-6">
          <form onSubmit={handleDetect}>
            <div className="card">
              {/* Optional: pre-select document type */}
              <label className="block text-cream text-sm mb-2">Document type (optional)</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
                {[
                  { type: 'nda', label: 'NDA', icon: '🔒' },
                  { type: 'service_agreement', label: 'Service Agreement', icon: '🤝' },
                  { type: 'employment_contract', label: 'Employment Contract', icon: '💼' },
                  { type: 'lease_agreement', label: 'Lease Agreement', icon: '🏠' },
                  { type: 'sales_contract', label: 'Sales Contract', icon: '📦' },
                  { type: 'partnership_agreement', label: 'Partnership Agreement', icon: '👥' },
                  { type: 'power_of_attorney', label: 'Power of Attorney', icon: '⚖️' },
                  { type: 'cease_and_desist', label: 'Cease & Desist', icon: '✋' },
                ].map((tmpl) => (
                  <button
                    key={tmpl.type}
                    type="button"
                    onClick={() => {
                      // Toggle: click again to deselect
                      setDetection(prev =>
                        prev?.documentType === tmpl.type ? null : {
                          documentType: tmpl.type,
                          name: tmpl.label,
                          reasoning: `Selected template: ${tmpl.label}`,
                          confidence: 1.0,
                        }
                      )
                    }}
                    className={`flex items-center gap-2 px-3 py-2 border rounded-card text-sm transition-all ${
                      detection?.documentType === tmpl.type
                        ? 'bg-accent/20 border-accent/50 text-accent'
                        : 'bg-leather/50 hover:bg-accent/10 border-tobacco text-cream'
                    }`}
                  >
                    <span>{tmpl.icon}</span>
                    <span className="text-left text-xs">{tmpl.label}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-cream text-sm mb-2">
                    <Globe size={14} className="inline mr-2" />
                    Jurisdiction
                  </label>
                  <select
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    className="input w-full"
                  >
                    {jurisdictions.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.flag} {j.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-cream text-sm mb-2">{t('common.language')}</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="input w-full"
                  >
                    {languages.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-cream text-sm mb-2">
                  {t('navigator.situation')}
                </label>
                <textarea
                  value={situation}
                  onChange={(e) => setSituation(e.target.value)}
                  placeholder={t('navigator.situation')}
                  className="input w-full h-32 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !situation.trim()}
                className="btn-primary w-full mt-6 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    {t('upload.analyzing')}
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    {detection?.documentType ? t('navigator.continueWith', { name: detection.name }) : t('navigator.analyzeDetect')}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step: Detection */}
      {step === 'detection' && detection && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileText size={24} className="text-accent" />
              </div>
              <div className="flex-1">
                <div className="text-antique text-sm mb-1">{t('navigator.recommendedDocument')}</div>
                <h2 className="font-serif text-2xl text-parchment mb-2">
                  {detection.documentType}
                </h2>
                {detection.confidence != null && (
                  <div className="inline-block px-2 py-1 bg-accent/10 text-accent text-xs rounded-full mb-3">
                    {typeof detection.confidence === 'number'
                      ? `${(detection.confidence * 100).toFixed(0)}% confidence`
                      : `${String(detection.confidence).charAt(0).toUpperCase() + String(detection.confidence).slice(1)} confidence`}
                  </div>
                )}
                <p className="text-cream-dark text-sm">{detection.reasoning}</p>
              </div>
            </div>

            {detection.suggestions && detection.suggestions.length > 0 && (
              <div className="mt-6 pt-6 border-t border-tobacco">
                <div className="text-antique text-sm mb-3">Related documents:</div>
                <div className="flex flex-wrap gap-2">
                  {detection.suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() =>
                        setDetection({ ...detection, documentType: s })
                      }
                      className="text-xs bg-deep-brown hover:bg-tobacco text-cream px-3 py-1.5 rounded-full transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep('input')}
                className="btn-secondary flex-1"
              >
                Back
              </button>
              {detection.questions && detection.questions.length > 0 ? (
                <button
                  onClick={() => setStep('questions')}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={18} className="rotate-180" />
                  Continue — Answer Questions
                </button>
              ) : (
                <button
                  onClick={handleGenerateDraft}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <Send size={18} />
                  Generate Draft
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step: Questions */}
      {step === 'questions' && detection?.questions && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <HelpCircle size={20} className="text-accent" />
              <h2 className="font-serif text-xl text-parchment">
                Additional Information
              </h2>
            </div>

            <div className="space-y-6">
              {detection.questions.map((q) => (
                <div key={q.id}>
                  <label className="block text-cream text-sm mb-2">
                    {q.text || q.question}
                    {q.required && <span className="text-red-400 ml-1">*</span>}
                  </label>

                  {q.type === 'text' && (
                    <input
                      type="text"
                      value={(answers[q.id] as string) || ''}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                      className="input w-full"
                    />
                  )}

                  {q.type === 'select' && q.options && (
                    <div className="space-y-2">
                      <select
                        value={
                          (answers[q.id] as string) || ''
                        }
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === '__other__') {
                            setAnswers({ ...answers, [q.id]: '__other__', [`${q.id}_custom`]: '' })
                          } else {
                            const { [`${q.id}_custom`]: _, ...rest } = answers
                            setAnswers({ ...rest, [q.id]: val })
                          }
                        }}
                        className="input w-full"
                      >
                        <option value="">—</option>
                        {q.options.map((opt) => {
                          const val = typeof opt === 'string' ? opt : opt.value
                          const label = typeof opt === 'string' ? opt : opt.label
                          return (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          )
                        })}
                        <option value="__other__">Other (specify)</option>
                      </select>
                      {(answers[q.id] as string) === '__other__' && (
                        <input
                          type="text"
                          value={(answers[`${q.id}_custom`] as string) || ''}
                          onChange={(e) =>
                            setAnswers({ ...answers, [`${q.id}_custom`]: e.target.value })
                          }
                          placeholder={t('navigator.pleaseSpecify')}
                          className="input w-full"
                          autoFocus
                        />
                      )}
                    </div>
                  )}

                  {q.type === 'multiselect' && q.options && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {q.options.map((opt) => {
                          const val = typeof opt === 'string' ? opt : opt.value
                          const label = typeof opt === 'string' ? opt : opt.label
                          const selected = (
                            (answers[q.id] as string[]) || []
                          ).includes(val)
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => {
                                const current = (answers[q.id] as string[]) || []
                                setAnswers({
                                  ...answers,
                                  [q.id]: selected
                                    ? current.filter((o) => o !== val)
                                    : [...current, val],
                                })
                              }}
                              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                                selected
                                  ? 'bg-accent text-ink'
                                  : 'bg-deep-brown text-cream hover:bg-tobacco'
                              }`}
                            >
                              {label}
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          onClick={() => {
                            const current = (answers[q.id] as string[]) || []
                            const hasOther = current.includes('__other__')
                            if (hasOther) {
                              const { [`${q.id}_custom`]: _, ...rest } = answers
                              setAnswers({
                                ...rest,
                                [q.id]: current.filter((o) => o !== '__other__'),
                              })
                            } else {
                              setAnswers({
                                ...answers,
                                [q.id]: [...current, '__other__'],
                                [`${q.id}_custom`]: '',
                              })
                            }
                          }}
                          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                            ((answers[q.id] as string[]) || []).includes('__other__')
                              ? 'bg-accent text-ink'
                              : 'bg-deep-brown text-cream hover:bg-tobacco'
                          }`}
                        >
                          Other
                        </button>
                      </div>
                      {((answers[q.id] as string[]) || []).includes('__other__') && (
                        <input
                          type="text"
                          value={(answers[`${q.id}_custom`] as string) || ''}
                          onChange={(e) =>
                            setAnswers({ ...answers, [`${q.id}_custom`]: e.target.value })
                          }
                          placeholder={t('navigator.pleaseSpecify')}
                          className="input w-full"
                          autoFocus
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep('detection')}
                className="btn-secondary flex-1"
              >
                Back
              </button>
              <button
                onClick={handleGenerateDraft}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Send size={18} />
                Generate Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Generating */}
      {step === 'generating' && (
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <RefreshCw size={32} className="text-accent animate-spin" />
          </div>
          <h2 className="font-serif text-xl text-parchment mb-2">
            Generating Your Document
          </h2>
          <p className="text-antique text-sm max-w-md mx-auto mb-6">
            Creating a {detection?.name || detection?.documentType} based on your situation...
          </p>

          {streamingContent && (
            <div
              ref={draftRef}
              className="text-left bg-deep-brown rounded-card p-6 max-h-64 overflow-y-auto"
            >
              {renderLegalContent(streamingContent)}
            </div>
          )}
        </div>
      )}

      {/* Step: Draft */}
      {step === 'draft' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-accent" />
                <h2 className="font-serif text-xl text-parchment">
                  {parsedDocument?.title || detection?.name || detection?.documentType}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="btn-secondary flex items-center gap-2"
                >
                  {copied ? (
                    <>
                      <Check size={16} className="text-forest" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      Copy
                    </>
                  )}
                </button>
                <div className="relative group">
                  <button className="btn-secondary flex items-center gap-2">
                    <Download size={16} />
                    Export
                  </button>
                  <div className="absolute right-0 top-full mt-2 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[150px]">
                    <button
                      onClick={() => handleExport('txt')}
                      className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                    >
                      Export as .txt
                    </button>
                    <button
                      onClick={() => handleExport('md')}
                      className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                    >
                      Export as .md
                    </button>
                    <button
                      onClick={() => handleExport('docx')}
                      className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                    >
                      Export as .docx
                    </button>
                    <button
                      onClick={() => handleExport('pdf')}
                      className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                    >
                      Export as .pdf
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Draft warnings */}
            {draft?.warnings && draft.warnings.length > 0 && (
              <div className="mb-4 bg-amber-900/20 border border-amber-700/50 rounded-button px-4 py-3">
                <div className="text-amber-400 text-sm font-medium mb-1">
                  Important Notes:
                </div>
                <ul className="text-amber-300 text-xs space-y-1">
                  {draft.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Draft content */}
            <div
              ref={draftRef}
              className="bg-deep-brown rounded-card p-6 max-h-[60vh] overflow-y-auto"
            >
              {parsedDocument ? (
                <div className="space-y-6">
                  {parsedDocument.sections.map((section, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-accent font-serif text-base font-semibold uppercase tracking-wide">
                          {/^\d+\.\s/.test(section.title) ? section.title : `${i + 1}. ${section.title}`}
                        </h3>
                        <button
                          onClick={() => handleRegenerateSection(i)}
                          disabled={regeneratingSection !== null}
                          className="text-antique hover:text-accent transition-colors p-1"
                          title={t('navigator.regenerateSection')}
                        >
                          <RefreshCw size={14} className={regeneratingSection === i ? 'animate-spin' : ''} />
                        </button>
                      </div>
                      {renderLegalContent(section.content)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-cream-dark text-sm leading-relaxed">
                  {streamingContent || draft?.content}
                </p>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={reset} className="btn-secondary flex-1">
                Start Over
              </button>
              <button
                onClick={handleSaveToVault}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <FileText size={18} />
                Save to Vault
              </button>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="text-center text-antique text-xs">
            <p>
              This document is AI-generated and should be reviewed by a legal
              professional before use.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
