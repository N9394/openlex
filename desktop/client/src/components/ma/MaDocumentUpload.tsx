import { useState, useCallback } from 'react'
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { maApi, type DealDocumentSummary } from '../../lib/api'

interface Props {
  dealId: string
  documents: DealDocumentSummary[]
  onUpdate: () => void
}

const DOC_TYPE_LABELS: Record<string, string> = {
  spa: 'SPA',
  disclosure_letter: 'Disclosure Letter',
  financial_statement: 'Financial Statement',
  corporate_docs: 'Corporate',
  regulatory: 'Regulatory',
  ip_schedule: 'IP Schedule',
  employment: 'Employment',
  real_estate: 'Real Estate',
  tax: 'Tax',
  insurance: 'Insurance',
  litigation: 'Litigation',
  environmental: 'Environmental',
  other: 'Other',
}

const STATUS_ICONS: Record<string, JSX.Element> = {
  uploaded: <Loader2 size={14} className="text-amber-400 animate-spin" />,
  parsing: <Loader2 size={14} className="text-amber-400 animate-spin" />,
  parsed: <CheckCircle size={14} className="text-green-400" />,
  classified: <CheckCircle size={14} className="text-emerald-400" />,
  analyzing: <Loader2 size={14} className="text-blue-400 animate-spin" />,
  analyzed: <CheckCircle size={14} className="text-accent" />,
  failed: <AlertCircle size={14} className="text-red-400" />,
}

export default function MaDocumentUpload({ dealId, documents, onUpdate }: Props) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string[]>([])

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setUploading(true)
    setUploadProgress([])

    // Upload in batches of 10
    for (let i = 0; i < fileArray.length; i += 10) {
      const batch = fileArray.slice(i, i + 10)
      const batchNames = batch.map(f => f.name)
      setUploadProgress(prev => [...prev, `Uploading ${batchNames.join(', ')}...`])

      try {
        await maApi.uploadDocuments(dealId, batch)
        setUploadProgress(prev => [...prev, `Batch ${Math.floor(i / 10) + 1} complete`])
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setUploadProgress(prev => [...prev, `Batch failed: ${message}`])
      }
    }

    setUploading(false)
    onUpdate()
  }, [dealId, onUpdate])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDelete = async (docId: string) => {
    try {
      await maApi.deleteDocument(dealId, docId)
      onUpdate()
    } catch (err) {
      console.error('Failed to delete document:', err)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div>
      <h3 className="font-serif text-lg text-parchment mb-4">Documents</h3>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        className={`
          border-2 border-dashed rounded-card p-8 text-center mb-4 transition-colors cursor-pointer
          ${dragOver ? 'border-accent bg-accent/5' : 'border-tobacco hover:border-accent/30'}
        `}
        onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.accept = '.pdf,.docx,.doc,.txt'
          input.onchange = () => { if (input.files) handleFiles(input.files) }
          input.click()
        }}
      >
        <Upload size={32} className="mx-auto text-antique mb-2" />
        <p className="text-cream">Drop files here or click to upload</p>
        <p className="text-antique text-sm mt-1">PDF, DOCX, DOC, TXT (max 50MB each)</p>
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="card mb-4 bg-accent/5 border-accent/20">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span className="text-cream text-sm">Uploading and parsing...</span>
          </div>
          {uploadProgress.map((msg, i) => (
            <p key={i} className="text-antique text-xs">{msg}</p>
          ))}
        </div>
      )}

      {/* Document list */}
      {documents.length > 0 && (
        <div className="space-y-1">
          <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-1 text-xs text-antique uppercase tracking-wider">
            <div className="col-span-5">File</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-1">Juris.</div>
            <div className="col-span-1">Size</div>
            <div className="col-span-1">Chunks</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1"></div>
          </div>
          {documents.map(doc => (
            <div key={doc.id} className="flex flex-col md:grid md:grid-cols-12 gap-1 md:gap-2 px-3 py-2 rounded-button hover:bg-leather/50 md:items-center">
              <div className="md:col-span-5 flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-antique flex-shrink-0" />
                <span className="text-cream text-sm truncate">{doc.filename}</span>
                <div className="md:hidden ml-auto flex items-center gap-2">
                  {STATUS_ICONS[doc.status] || null}
                  <button onClick={() => handleDelete(doc.id)} className="text-antique hover:text-red-400 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="md:col-span-2 flex md:block items-center gap-2">
                {doc.docType && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                    {DOC_TYPE_LABELS[doc.docType] || doc.docType}
                  </span>
                )}
                <span className="md:hidden text-antique text-xs">{doc.jurisdiction || ''}</span>
                <span className="md:hidden text-antique text-xs">{formatSize(doc.filesize)}</span>
              </div>
              <div className="hidden md:block md:col-span-1 text-antique text-sm">{doc.jurisdiction || '-'}</div>
              <div className="hidden md:block md:col-span-1 text-antique text-sm">{formatSize(doc.filesize)}</div>
              <div className="hidden md:block md:col-span-1 text-antique text-sm">{doc._count?.sections || '-'}</div>
              <div className="hidden md:block md:col-span-1">{STATUS_ICONS[doc.status] || null}</div>
              <div className="hidden md:block md:col-span-1 text-right">
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="text-antique hover:text-red-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          <p className="text-antique text-xs px-3 pt-2">
            {documents.length} document{documents.length !== 1 ? 's' : ''} — {formatSize(documents.reduce((s, d) => s + d.filesize, 0))} total
          </p>
        </div>
      )}
    </div>
  )
}
