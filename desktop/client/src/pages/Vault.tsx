import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Plus,
  Search,
  Trash2,
  Copy,
  FolderOpen,
  FileText,
  Tag,
  Upload,
  ExternalLink,
  Loader2,
  X,
  Edit2,
  Save,
  Filter,
  BarChart2,
  Clock,
  Sparkles,
  Download,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { api, apiBase } from '../lib/api'

interface VaultItem {
  id: string
  title: string
  content: string
  type: 'clause' | 'template' | 'note' | 'document'
  folder?: string
  tags?: string[]
  createdAt: string
  updatedAt?: string
  sourceDocumentId?: string
  href?: string
}

interface VaultStats {
  total: number
  clauses: number
  templates: number
  notes: number
  documents: number
}

interface Folder {
  name: string
  count: number
}

/** Strip markdown syntax for plain-text previews */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/__(.+?)__/g, '$1')        // __bold__
    .replace(/_(.+?)_/g, '$1')          // _italic_
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/^#{1,6}\s+/gm, '')        // # headings
    .replace(/^[-*+]\s+/gm, '')         // - list items
    .replace(/^\d+\.\s+/gm, '')         // 1. ordered list
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url)
}

/** Extract readable preview text from content (may be raw JSON from document analysis) */
function getContentPreview(content: string): string {
  let text = content
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.content) {
      text = parsed.content
    }
  } catch { /* not JSON */ }
  return stripMarkdown(text)
}

export default function Vault() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<VaultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedFolder, setSelectedFolder] = useState<string>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null)
  const [newItem, setNewItem] = useState({
    title: '',
    content: '',
    type: 'clause' as const,
    folder: '',
    tags: [] as string[],
  })
  const [newTag, setNewTag] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewingItem, setViewingItem] = useState<VaultItem | null>(null)
  const [uploading, setUploading] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stats
  const [stats, setStats] = useState<VaultStats>({
    total: 0,
    clauses: 0,
    templates: 0,
    notes: 0,
    documents: 0,
  })

  // Folders and tags from items
  const [folders, setFolders] = useState<Folder[]>([])
  const [allTags, setAllTags] = useState<string[]>([])

  useEffect(() => {
    loadItems()
  }, [])

  useEffect(() => {
    // Calculate stats, folders, and tags from items
    const statsCalc: VaultStats = {
      total: items.length,
      clauses: items.filter((i) => i.type === 'clause').length,
      templates: items.filter((i) => i.type === 'template').length,
      notes: items.filter((i) => i.type === 'note').length,
      documents: items.filter((i) => i.type === 'document').length,
    }
    setStats(statsCalc)

    // Get unique folders
    const folderMap = new Map<string, number>()
    items.forEach((item) => {
      if (item.folder) {
        folderMap.set(item.folder, (folderMap.get(item.folder) || 0) + 1)
      }
    })
    setFolders(
      Array.from(folderMap.entries()).map(([name, count]) => ({ name, count }))
    )

    // Get unique tags
    const tagSet = new Set<string>()
    items.forEach((item) => {
      item.tags?.forEach((tag) => tagSet.add(tag))
    })
    setAllTags(Array.from(tagSet))
  }, [items])

  const loadItems = async () => {
    try {
      const data = await api.get('/vault')
      const itemsArray = Array.isArray(data) ? data : data.items || []
      setItems(itemsArray)
    } catch (err) {
      console.error('Failed to load vault items:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!newItem.title.trim() || !newItem.content.trim()) return

    try {
      await api.post('/vault', {
        ...newItem,
        tags: newItem.tags.length > 0 ? newItem.tags : undefined,
        folder: newItem.folder || undefined,
      })
      setNewItem({ title: '', content: '', type: 'clause', folder: '', tags: [] })
      setShowAdd(false)
      loadItems()
    } catch (err) {
      console.error('Failed to add item:', err)
    }
  }

  const handleUpdate = async () => {
    if (!editingItem) return

    try {
      await api.put(`/vault/${editingItem.id}`, {
        title: editingItem.title,
        content: editingItem.content,
        type: editingItem.type,
        folder: editingItem.folder || undefined,
        tags: editingItem.tags,
      })
      setEditingItem(null)
      loadItems()
    } catch (err) {
      console.error('Failed to update item:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('vault.deleteConfirm'))) return

    try {
      await api.delete(`/vault/${id}`)
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      console.error('Failed to delete item:', err)
    }
  }

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const handleExportVaultItem = useCallback(async (itemId: string, title: string, format: 'docx' | 'pdf') => {
    try {
      const API_BASE = apiBase()
      // Documents use the analysis export endpoint (same as DocumentView)
      let exportUrl: string
      if (itemId.startsWith('doc-')) {
        const docId = itemId.slice(4)
        exportUrl = format === 'pdf'
          ? `${API_BASE}/api/research/export/analysis/${docId}/pdf`
          : `${API_BASE}/api/research/export/analysis/${docId}`
      } else {
        exportUrl = `${API_BASE}/api/research/export/vault/${itemId}?format=${format}`
      }
      const response = await fetch(exportUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_')}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(`${format.toUpperCase()} export failed:`, err)
    }
  }, [])

  const addTagToNew = () => {
    if (newTag.trim() && !newItem.tags.includes(newTag.trim())) {
      setNewItem({ ...newItem, tags: [...newItem.tags, newTag.trim()] })
      setNewTag('')
    }
  }

  const removeTagFromNew = (tag: string) => {
    setNewItem({ ...newItem, tags: newItem.tags.filter((t) => t !== tag) })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const defaultTitle = file.name.replace(/\.[^/.]+$/, '')
    const title = prompt(t('vault.uploadTitlePrompt'), defaultTitle)
    if (!title) {
      // Reset input so the same file can be re-selected
      e.target.value = ''
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', title)

      const API_BASE = apiBase()
      const res = await fetch(`${API_BASE}/api/vault/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: t('vault.uploadFailed') }))
        throw new Error(err.message || t('vault.uploadFailed'))
      }

      loadItems()
    } catch (err) {
      console.error('Upload failed:', err)
      alert(err instanceof Error ? err.message : t('vault.uploadFailed'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleAnalyseVaultItem = async (item: VaultItem) => {
    setAnalyzingId(item.id)
    try {
      // Create a text blob from the vault item and upload it as a document for analysis
      const blob = new Blob([item.content], { type: 'text/plain' })
      const file = new File([blob], `${item.title}.txt`, { type: 'text/plain' })
      const formData = new FormData()
      formData.append('file', file)
      const API_BASE = apiBase()
      const res = await fetch(`${API_BASE}/api/docs/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setViewingItem(null)
      navigate(`/documents/${data.id}`)
    } catch (err) {
      console.error('Analysis failed:', err)
      alert(t('vault.analysisFailed'))
    } finally {
      setAnalyzingId(null)
    }
  }

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.content.toLowerCase().includes(search.toLowerCase())
    const matchesType = selectedType === 'all' || item.type === selectedType
    const matchesFolder =
      selectedFolder === 'all' || item.folder === selectedFolder
    const matchesTags =
      selectedTags.length === 0 ||
      selectedTags.every((tag) => item.tags?.includes(tag))

    return matchesSearch && matchesType && matchesFolder && matchesTags
  })

  const typeColors: Record<string, string> = {
    clause: 'text-accent',
    template: 'text-emerald-400',
    note: 'text-amber-400',
    document: 'text-blue-400',
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-3xl text-parchment mb-2">{t('vault.title')}</h1>
            <p className="text-antique">{t('vault.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-secondary flex items-center gap-2"
            >
              {uploading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Upload size={18} />
              )}
              {uploading ? t('upload.uploading') : t('common.upload')}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={18} />
              {t('vault.addItem')}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <BarChart2 size={20} className="text-accent" />
            </div>
            <div>
              <div className="text-2xl font-bold text-parchment">
                {stats.total}
              </div>
              <div className="text-antique text-sm">{t('vault.stats.total')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FileText size={20} className="text-accent" />
            </div>
            <div>
              <div className="text-2xl font-bold text-parchment">
                {stats.clauses}
              </div>
              <div className="text-antique text-sm">{t('vault.stats.clauses')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <FolderOpen size={20} className="text-emerald-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-parchment">
                {stats.templates}
              </div>
              <div className="text-antique text-sm">{t('vault.stats.templates')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Edit2 size={20} className="text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-parchment">
                {stats.notes}
              </div>
              <div className="text-antique text-sm">{t('vault.stats.notes')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Archive size={20} className="text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-parchment">
                {stats.documents}
              </div>
              <div className="text-antique text-sm">{t('vault.stats.documents')}</div>
            </div>
          </div>
        </div>

        {/* Search and filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="search-input-wrapper flex-1">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('vault.searchVault')}
              className="input w-full"
            />
          </div>

          <div className="flex gap-3">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="input"
            >
              <option value="all">{t('vault.filters.allTypes')}</option>
              <option value="clause">{t('vault.stats.clauses')}</option>
              <option value="template">{t('vault.stats.templates')}</option>
              <option value="note">{t('vault.stats.notes')}</option>
              <option value="document">{t('vault.stats.documents')}</option>
            </select>

            {folders.length > 0 && (
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                className="input"
              >
                <option value="all">{t('vault.filters.allFolders')}</option>
                {folders.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.count})
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary flex items-center gap-2 ${
                showFilters || selectedTags.length > 0 ? 'border-accent' : ''
              }`}
            >
              <Filter size={18} />
              {t('vault.tags')}
              {selectedTags.length > 0 && (
                <span className="bg-accent text-ink text-xs px-1.5 rounded-full">
                  {selectedTags.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Tags filter */}
        {showFilters && allTags.length > 0 && (
          <div className="mb-6 p-4 bg-leather rounded-card border border-tobacco">
            <div className="text-cream text-sm mb-3">{t('vault.filters.filterByTags')}</div>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() =>
                    setSelectedTags((prev) =>
                      prev.includes(tag)
                        ? prev.filter((t) => t !== tag)
                        : [...prev, tag]
                    )
                  }
                  className={`px-3 py-1 rounded-full text-sm transition-all ${
                    selectedTags.includes(tag)
                      ? 'bg-accent text-ink'
                      : 'bg-deep-brown text-cream hover:bg-tobacco'
                  }`}
                >
                  <Tag size={12} className="inline mr-1" />
                  {tag}
                </button>
              ))}
              {selectedTags.length > 0 && (
                <button
                  onClick={() => setSelectedTags([])}
                  className="px-3 py-1 text-sm text-antique hover:text-cream"
                >
                  {t('vault.filters.clearAll')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Add modal */}
        {showAdd && (
          <div className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50 p-6">
            <div className="card max-w-lg w-full animate-fade-in max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-xl text-parchment">
                  {t('vault.addToVault')}
                </h2>
                <button
                  onClick={() => setShowAdd(false)}
                  className="text-antique hover:text-cream"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-cream text-sm mb-2">{t('common.type')}</label>
                    <select
                      value={newItem.type}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          type: e.target.value as 'clause',
                        })
                      }
                      className="input w-full"
                    >
                      <option value="clause">{t('vault.types.clause')}</option>
                      <option value="template">{t('vault.types.template')}</option>
                      <option value="note">{t('vault.types.note')}</option>
                      <option value="document">{t('vault.types.document')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-cream text-sm mb-2">
                      {t('vault.folderOptional')}
                    </label>
                    <input
                      type="text"
                      value={newItem.folder}
                      onChange={(e) =>
                        setNewItem({ ...newItem, folder: e.target.value })
                      }
                      className="input w-full"
                      placeholder={t('vault.folderPlaceholder')}
                      list="folders-list"
                    />
                    <datalist id="folders-list">
                      {folders.map((f) => (
                        <option key={f.name} value={f.name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('common.title')}</label>
                  <input
                    type="text"
                    value={newItem.title}
                    onChange={(e) =>
                      setNewItem({ ...newItem, title: e.target.value })
                    }
                    className="input w-full"
                    placeholder={t('vault.titlePlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('common.description')}</label>
                  <textarea
                    value={newItem.content}
                    onChange={(e) =>
                      setNewItem({ ...newItem, content: e.target.value })
                    }
                    className="input w-full h-40 resize-none"
                    placeholder={t('vault.contentPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('vault.tags')}</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTagToNew())}
                      className="input flex-1"
                      placeholder={t('vault.addTagPlaceholder')}
                    />
                    <button
                      onClick={addTagToNew}
                      className="btn-secondary px-4"
                    >
                      {t('common.add')}
                    </button>
                  </div>
                  {newItem.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {newItem.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-accent/20 text-accent text-sm px-3 py-1 rounded-full flex items-center gap-1"
                        >
                          {tag}
                          <button
                            onClick={() => removeTagFromNew(tag)}
                            className="hover:text-red-400"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAdd(false)}
                  className="btn-secondary flex-1"
                >
                  {t('common.cancel')}
                </button>
                <button onClick={handleAdd} className="btn-primary flex-1">
                  <Save size={18} className="mr-2" />
                  {t('vault.saveToVault')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit modal */}
        {editingItem && (
          <div className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50 p-6">
            <div className="card max-w-lg w-full animate-fade-in max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-xl text-parchment">{t('common.edit')}</h2>
                <button
                  onClick={() => setEditingItem(null)}
                  className="text-antique hover:text-cream"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-cream text-sm mb-2">{t('common.title')}</label>
                  <input
                    type="text"
                    value={editingItem.title}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, title: e.target.value })
                    }
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('common.description')}</label>
                  <textarea
                    value={editingItem.content}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, content: e.target.value })
                    }
                    className="input w-full h-40 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setEditingItem(null)}
                  className="btn-secondary flex-1"
                >
                  {t('common.cancel')}
                </button>
                <button onClick={handleUpdate} className="btn-primary flex-1">
                  {t('vault.saveChanges')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View overlay */}
        {viewingItem && (
          <div className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50 p-6" onClick={() => setViewingItem(null)}>
            <div className="card max-w-2xl w-full animate-fade-in max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  {viewingItem.folder && (
                    <div className="flex items-center gap-1 text-xs text-antique mb-1">
                      <FolderOpen size={12} />
                      {viewingItem.folder}
                    </div>
                  )}
                  <span
                    className={`text-xs uppercase tracking-wide ${
                      typeColors[viewingItem.type] || 'text-accent'
                    }`}
                  >
                    {viewingItem.type}
                  </span>
                  <h2 className="font-serif text-xl text-parchment">
                    {viewingItem.title}
                  </h2>
                </div>
                <button
                  onClick={() => setViewingItem(null)}
                  className="text-antique hover:text-cream ml-4 flex-shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 mb-4">
                {(() => {
                  // Try to parse JSON content (document analysis summaries)
                  try {
                    const parsed = JSON.parse(viewingItem.content)
                    if (parsed && typeof parsed === 'object' && (parsed.content || parsed.title)) {
                      return (
                        <div className="space-y-3">
                          {parsed.content && (
                            <div className="prose-custom max-w-none">
                              <ReactMarkdown>{parsed.content}</ReactMarkdown>
                            </div>
                          )}
                          {parsed.keyPoints && parsed.keyPoints.length > 0 && (
                            <div>
                              <h4 className="text-parchment text-xs font-semibold uppercase tracking-wide mb-1.5">{t('vault.keyPoints')}</h4>
                              <ul className="space-y-1">
                                {parsed.keyPoints.map((point: string, i: number) => (
                                  <li key={i} className="text-cream-dark text-sm leading-relaxed flex gap-2">
                                    <span className="text-accent mt-0.5 flex-shrink-0">-</span>
                                    <span className="prose-custom-xs max-w-none [&_p]:inline"><ReactMarkdown>{point}</ReactMarkdown></span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    }
                  } catch { /* not JSON, render as plain text */ }
                  return (
                    <div className="prose-custom max-w-none [&_h1]:text-parchment [&_h2]:text-parchment [&_h3]:text-parchment">
                      <ReactMarkdown>{viewingItem.content}</ReactMarkdown>
                    </div>
                  )
                })()}
              </div>

              {viewingItem.tags && viewingItem.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {viewingItem.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-deep-brown text-antique px-2 py-0.5 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-tobacco/50">
                <div className="flex items-center text-xs text-antique">
                  <Clock size={12} className="mr-1" />
                  {new Date(viewingItem.createdAt).toLocaleDateString()}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(viewingItem.sourceDocumentId || viewingItem.href) && (
                    <button
                      onClick={() => {
                        if (viewingItem.sourceDocumentId) navigate(`/documents/${viewingItem.sourceDocumentId}`)
                        else if (viewingItem.href) navigate(viewingItem.href)
                      }}
                      className="btn-secondary flex items-center gap-1.5 text-sm"
                    >
                      <ExternalLink size={14} />
                      {t('vault.openAnalysis')}
                    </button>
                  )}
                  <button
                    onClick={() => handleAnalyseVaultItem(viewingItem)}
                    disabled={analyzingId === viewingItem.id}
                    className="btn-secondary flex items-center gap-1.5 text-sm"
                  >
                    {analyzingId === viewingItem.id ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {t('vault.analysing')}
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        {t('vault.analyse')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleCopy(viewingItem.id, viewingItem.content)}
                    className="btn-secondary flex items-center gap-1.5 text-sm"
                  >
                    {copiedId === viewingItem.id ? (
                      <span className="text-forest">{t('common.copied')}</span>
                    ) : (
                      <>
                        <Copy size={14} />
                        {t('common.copy')}
                      </>
                    )}
                  </button>
                  <div className="relative group">
                    <button className="btn-secondary flex items-center gap-1.5 text-sm">
                      <Download size={14} />
                      {t('common.export')}
                    </button>
                    <div className="absolute right-0 bottom-full mb-2 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[140px]">
                      <button
                        onClick={() => handleExportVaultItem(viewingItem.id, viewingItem.title, 'docx')}
                        className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                      >
                        {t('vault.exportDocx')}
                      </button>
                      <button
                        onClick={() => handleExportVaultItem(viewingItem.id, viewingItem.title, 'pdf')}
                        className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                      >
                        {t('vault.exportPdf')}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setViewingItem(null)
                      setEditingItem(viewingItem)
                    }}
                    className="btn-secondary flex items-center gap-1.5 text-sm"
                  >
                    <Edit2 size={14} />
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => {
                      handleDelete(viewingItem.id)
                      setViewingItem(null)
                    }}
                    className="btn-secondary flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Items grid */}
        {loading ? (
          <div className="text-center py-12 text-antique">{t('common.loading')}</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-16">
            <Archive size={64} className="mx-auto text-tobacco mb-4" />
            <div className="text-cream-dark text-lg mb-2">
              {t('vault.noItems')}
            </div>
            <p className="text-antique text-sm max-w-md mx-auto">
              {t('vault.noItemsHint')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="card group hover:border-accent/30 transition-colors cursor-pointer"
                onClick={() => setViewingItem(item)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    {item.folder && (
                      <div className="flex items-center gap-1 text-xs text-antique mb-1">
                        <FolderOpen size={12} />
                        {item.folder}
                      </div>
                    )}
                    <span
                      className={`text-xs uppercase tracking-wide ${
                        typeColors[item.type] || 'text-accent'
                      }`}
                    >
                      {item.type}
                    </span>
                    <h3 className="font-serif text-lg text-parchment truncate">
                      {item.title}
                    </h3>
                  </div>
                </div>

                <p className="text-cream-dark text-sm mb-3 line-clamp-4">
                  {getContentPreview(item.content)}
                </p>

                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs bg-deep-brown text-antique px-2 py-0.5 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center text-xs text-antique pt-2 border-t border-tobacco/50">
                  <Clock size={12} className="mr-1" />
                  {new Date(item.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
