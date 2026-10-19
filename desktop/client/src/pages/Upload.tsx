import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import {
  Upload as UploadIcon,
  FileText,
  X,
  AlertTriangle,
  CheckCircle,
  HardDrive,
  Clock,
  Sparkles,
  Globe,
  Loader2,
  ArrowRight,
} from 'lucide-react'

interface UploadProgress {
  phase: 'uploading' | 'processing' | 'analyzing' | 'done'
  progress: number
  message: string
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx']
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export default function Upload() {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [jurisdictions, setJurisdictions] = useState<string[]>(['US'])
  const [recentDocs, setRecentDocs] = useState<{id: string, filename: string, status: string, createdAt: string}[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/docs').then(data => {
      const docs = Array.isArray(data) ? data : data.documents || []
      setRecentDocs(docs.slice(0, 5))
    }).catch(() => {})
  }, [])

  const JURISDICTIONS = [
    { code: 'US', label: 'US Federal' },
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
  ] as const

  const toggleJurisdiction = (code: string) => {
    setJurisdictions(prev =>
      prev.includes(code) ? prev.filter(j => j !== code) : [...prev, code]
    )
  }

  const validateFile = (file: File): { valid: boolean; warnings: string[] } => {
    const warnings: string[] = []

    // Check file type
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    const validType = ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext)

    if (!validType) {
      return { valid: false, warnings: [`Unsupported file type: ${file.type || ext}. Please upload PDF or Word documents.`] }
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, warnings: [`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum size is 50MB.`] }
    }

    // Warnings (non-blocking)
    if (file.size < 1024) {
      warnings.push('File is very small. Make sure it contains readable text.')
    }

    if (file.size > 10 * 1024 * 1024) {
      warnings.push('Large file. Analysis may take longer.')
    }

    return { valid: true, warnings }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    setError('')
    setWarnings([])

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      const { valid, warnings } = validateFile(droppedFile)
      if (valid) {
        setFile(droppedFile)
        setWarnings(warnings)
      } else {
        setError(warnings[0])
      }
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('')
    setWarnings([])

    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      const { valid, warnings } = validateFile(selectedFile)
      if (valid) {
        setFile(selectedFile)
        setWarnings(warnings)
      } else {
        setError(warnings[0])
      }
    }
  }

  const handleUpload = async () => {
    if (!file || uploading) return
    setUploading(true)
    setError('')
    setProgress({ phase: 'uploading', progress: 0, message: 'Uploading document...' })

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (jurisdictions.length > 0) {
        formData.append('jurisdictions', JSON.stringify(jurisdictions))
      }

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (!prev) return prev
          if (prev.phase === 'uploading' && prev.progress < 90) {
            return { ...prev, progress: prev.progress + 10 }
          }
          return prev
        })
      }, 200)

      const response = await fetch('/api/docs/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      clearInterval(progressInterval)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || data.error || 'Upload failed')
      }

      const data = await response.json()

      setProgress({ phase: 'analyzing', progress: 100, message: 'Document uploaded — redirecting to analysis...' })

      await new Promise((r) => setTimeout(r, 300))
      navigate(`/documents/${data.id || data.documentId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setProgress(null)
    } finally {
      setUploading(false)
    }
  }

  const removeFile = () => {
    setFile(null)
    setWarnings([])
    setError('')
    setProgress(null)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-parchment mb-2">{t('upload.title')}</h1>
        <p className="text-antique">{t('upload.subtitle')}</p>
      </div>

      {/* Jurisdiction selector */}
      <div className="mb-6 card">
        <div className="flex items-center gap-2 mb-3">
          <Globe size={16} className="text-accent" />
          <span className="text-cream text-sm font-medium">{t('upload.jurisdictionLabel')}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {JURISDICTIONS.map(jur => (
            <button
              key={jur.code}
              onClick={() => toggleJurisdiction(jur.code)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                jurisdictions.includes(jur.code)
                  ? 'bg-accent/20 border-accent/50 text-accent'
                  : 'bg-deep-brown border-tobacco text-antique hover:border-accent/30'
              }`}
            >
              {jur.label}
            </button>
          ))}
        </div>
        {jurisdictions.length === 0 && (
          <p className="text-amber-400 text-xs mt-2">Select at least one jurisdiction for statute-grounded analysis</p>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !file && document.getElementById('file-input')?.click()}
        className={`
          border-2 border-dashed rounded-card p-12 text-center
          transition-all duration-200 cursor-pointer
          ${
            dragOver
              ? 'border-accent bg-accent/5 scale-[1.02]'
              : file
              ? 'border-forest/50 bg-forest/5'
              : 'border-tobacco hover:border-accent/50'
          }
          ${file ? 'cursor-default' : ''}
        `}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.docx"
          onChange={handleFileChange}
          className="hidden"
          disabled={uploading}
        />

        {!file ? (
          <>
            <UploadIcon
              size={48}
              className={`mx-auto mb-4 transition-colors ${
                dragOver ? 'text-accent' : 'text-antique'
              }`}
            />
            <div className="text-parchment text-lg mb-2">
              {t('upload.dropFile')}
            </div>
            <div className="text-antique text-sm mb-4">
              Supports PDF and DOCX files up to 50MB
            </div>
            <div className="flex items-center justify-center gap-4 text-xs text-antique">
              <span className="flex items-center gap-1">
                <FileText size={12} />
                PDF
              </span>
              <span className="flex items-center gap-1">
                <FileText size={12} />
                DOCX
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText size={28} className="text-accent" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-parchment font-medium truncate">{file.name}</div>
              <div className="flex items-center gap-3 text-antique text-sm mt-1">
                <span className="flex items-center gap-1">
                  <HardDrive size={12} />
                  {formatFileSize(file.size)}
                </span>
                <span className="text-tobacco">•</span>
                <span>{file.type || 'document'}</span>
              </div>
            </div>
            {!uploading && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeFile()
                }}
                className="p-2 text-antique hover:text-red-400 transition-colors"
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mt-4 bg-amber-900/20 border border-amber-700/50 rounded-card px-4 py-3">
          {warnings.map((warning, i) => (
            <div key={i} className="flex items-start gap-2 text-amber-300 text-sm">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              {warning}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 bg-burgundy/20 border border-burgundy/50 rounded-card px-4 py-3 flex items-start gap-2">
          <X size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-red-300 text-sm">{error}</div>
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="mt-6 card">
          <div className="flex items-center gap-3 mb-4">
            {progress.phase === 'done' ? (
              <CheckCircle size={20} className="text-forest" />
            ) : (
              <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            )}
            <span className="text-cream">{progress.message}</span>
          </div>

          <div className="h-2 bg-deep-brown rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                progress.phase === 'done' ? 'bg-forest' : 'bg-accent'
              }`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-antique">
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {progress.phase === 'uploading' && 'Uploading...'}
              {progress.phase === 'processing' && 'Processing...'}
              {progress.phase === 'analyzing' && 'Analyzing...'}
              {progress.phase === 'done' && 'Complete'}
            </span>
            <span>{progress.progress}%</span>
          </div>
        </div>
      )}


      {/* Upload button */}
      {file && !uploading && !progress && (
        <button
          onClick={handleUpload}
          disabled={jurisdictions.length === 0 || uploading}
          className="btn-primary w-full mt-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles size={18} />
          Analyse Document
        </button>
      )}

      {/* Recent documents */}
      {recentDocs.length > 0 && (
        <div className="mt-8">
          <h3 className="text-cream text-sm font-medium mb-3">Recent Documents</h3>
          <div className="space-y-2">
            {recentDocs.map(d => (
              <button
                key={d.id}
                onClick={() => navigate(`/documents/${d.id}`)}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-deep-brown border border-tobacco rounded-card hover:border-accent/30 transition-colors text-left"
              >
                {d.status === 'processing' ? (
                  <Loader2 size={14} className="text-accent animate-spin flex-shrink-0" />
                ) : d.status === 'completed' ? (
                  <CheckCircle size={14} className="text-forest flex-shrink-0" />
                ) : d.status === 'failed' ? (
                  <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                ) : (
                  <FileText size={14} className="text-antique flex-shrink-0" />
                )}
                <span className="text-cream text-sm truncate flex-1">{d.filename}</span>
                <span className="text-[10px] text-antique">
                  {d.status === 'processing' ? 'Analysing...' : d.status === 'completed' ? 'Ready' : d.status}
                </span>
                <ArrowRight size={12} className="text-antique flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card text-center">
          <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center mx-auto mb-3">
            <FileText size={20} className="text-accent" />
          </div>
          <h3 className="text-cream font-medium mb-1">Clause Extraction</h3>
          <p className="text-antique text-sm">Automatically identifies key clauses and provisions</p>
        </div>
        <div className="card text-center">
          <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <h3 className="text-cream font-medium mb-1">Risk Analysis</h3>
          <p className="text-antique text-sm">Highlights potential risks and unusual terms</p>
        </div>
        <div className="card text-center">
          <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
            <Sparkles size={20} className="text-blue-400" />
          </div>
          <h3 className="text-cream font-medium mb-1">AI Summary</h3>
          <p className="text-antique text-sm">Get a comprehensive summary of the document</p>
        </div>
      </div>
    </div>
  )
}
