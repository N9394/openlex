import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import {
  Search,
  FileText,
  LayoutDashboard,
  Upload,
  Archive,
  Settings,
  Sparkles,
  ClipboardList,
  FilePlus,
  ScanSearch,
} from 'lucide-react'

interface CommandItem {
  id: string
  type: 'action' | 'navigation' | 'document' | 'vault'
  title: string
  subtitle?: string
  icon: React.ReactNode
  href?: string
}

// Ordered by visual group: navigation first, then actions (matches rendering order)
const defaultCommands: CommandItem[] = [
  { id: 'nav-dashboard', type: 'navigation', title: 'Go to Dashboard', subtitle: 'View your overview', icon: <LayoutDashboard size={16} />, href: '/dashboard' },
  { id: 'nav-research', type: 'navigation', title: 'Research', subtitle: 'Legal research assistant', icon: <Sparkles size={16} />, href: '/research' },
  { id: 'nav-vault', type: 'navigation', title: 'Vault', subtitle: 'Saved clauses & templates', icon: <Archive size={16} />, href: '/vault' },
  { id: 'nav-audit', type: 'navigation', title: 'Audit Log', subtitle: 'View AI activity', icon: <ClipboardList size={16} />, href: '/audit' },
  { id: 'nav-settings', type: 'navigation', title: 'Settings', subtitle: 'Configure your account', icon: <Settings size={16} />, href: '/settings' },
  { id: 'nav-upload', type: 'action', title: 'Analyse Document', subtitle: 'Upload and analyze', icon: <Upload size={16} />, href: '/upload' },
  { id: 'nav-create', type: 'action', title: 'Create Document', subtitle: 'Draft with AI guidance', icon: <FilePlus size={16} />, href: '/navigator' },
  { id: 'nav-investigate', type: 'action', title: 'Investigate', subtitle: 'Deep search for case-critical details', icon: <ScanSearch size={16} />, href: '/investigate' },
]

export default function CommandPalette() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [results, setResults] = useState<CommandItem[]>(defaultCommands)
  const [isSearching, setIsSearching] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter commands by query
  const filterCommands = useCallback((searchQuery: string): CommandItem[] => {
    if (!searchQuery.trim()) return defaultCommands
    const lowerQuery = searchQuery.toLowerCase()
    return defaultCommands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(lowerQuery) ||
        cmd.subtitle?.toLowerCase().includes(lowerQuery)
    )
  }, [])

  // Search vault items from backend
  const searchBackend = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim() || searchQuery.length < 2) return
      setIsSearching(true)
      try {
        // Search vault items
        const vaultData = await api.get(`/vault?search=${encodeURIComponent(searchQuery)}&limit=5`).catch(() => [])
        const vaultItems = Array.isArray(vaultData) ? vaultData : vaultData.items || []

        // Search documents
        const docsData = await api.get(`/docs?limit=5`).catch(() => ({ documents: [] }))
        const docs = docsData.documents || docsData || []

        const newResults: CommandItem[] = []

        // Add vault items
        vaultItems.slice(0, 3).forEach((item: { id: string; title: string; type: string }) => {
          newResults.push({
            id: `vault-${item.id}`,
            type: 'vault',
            title: item.title,
            subtitle: `Vault - ${item.type}`,
            icon: <Archive size={16} />,
            href: '/vault',
          })
        })

        // Add documents
        if (Array.isArray(docs)) {
          docs
            .filter((doc: { filename: string }) =>
              doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .slice(0, 3)
            .forEach((doc: { id: string; filename: string; status: string }) => {
              newResults.push({
                id: `doc-${doc.id}`,
                type: 'document',
                title: doc.filename,
                subtitle: `Document - ${doc.status}`,
                icon: <FileText size={16} />,
                href: `/documents/${doc.id}`,
              })
            })
        }

        const typeOrder = ['navigation', 'action', 'vault', 'document']
        const merged = [...filterCommands(searchQuery), ...newResults]
        merged.sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type))
        setResults(merged)
      } catch (error) {
        console.error('[CommandPalette] Search error:', error)
      } finally {
        setIsSearching(false)
      }
    },
    [filterCommands]
  )

  // Keyboard shortcut to open/close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault()
        setIsOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResults(defaultCommands)
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Update results on query change
  useEffect(() => {
    setResults(filterCommands(query))
    setSelectedIndex(0)
    const timeoutId = setTimeout(() => searchBackend(query), 300)
    return () => clearTimeout(timeoutId)
  }, [query, filterCommands, searchBackend])

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[selectedIndex]
      if (item?.href) {
        navigate(item.href)
        setIsOpen(false)
      }
    }
  }

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!user || !isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/70 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      {/* Modal */}
      <div className="flex items-start justify-center min-h-screen p-4 pt-[15vh]">
        <div className="relative w-full max-w-xl rounded-card shadow-2xl overflow-hidden bg-deep-brown border border-tobacco animate-fade-in">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-4 border-b border-tobacco">
            <Search size={20} className="text-antique flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('common.search')}
              className="flex-1 bg-transparent text-cream outline-none text-base placeholder:text-antique"
            />
            {isSearching && (
              <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            )}
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
            {results.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-antique">
                No results found for "{query}"
              </div>
            ) : (
              <>
                {/* Group by type */}
                {['navigation', 'action', 'vault', 'document'].map((type) => {
                  const typeResults = results.filter((r) => r.type === type)
                  if (typeResults.length === 0) return null

                  const typeLabels: Record<string, string> = {
                    navigation: 'Navigate',
                    action: 'Actions',
                    vault: 'Vault Items',
                    document: 'Documents',
                  }

                  return (
                    <div key={type}>
                      <div className="px-4 py-1.5 text-xs font-medium text-antique/60 uppercase tracking-wider">
                        {typeLabels[type]}
                      </div>
                      {typeResults.map((item) => {
                        const globalIndex = results.indexOf(item)
                        return (
                          <button
                            key={item.id}
                            data-index={globalIndex}
                            onClick={() => {
                              if (item.href) {
                                navigate(item.href)
                                setIsOpen(false)
                              }
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              globalIndex === selectedIndex
                                ? 'bg-accent/10'
                                : 'hover:bg-leather/30'
                            }`}
                          >
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                                globalIndex === selectedIndex
                                  ? 'bg-accent/20 text-accent'
                                  : 'bg-obsidian text-antique'
                              }`}
                            >
                              {item.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-cream truncate">
                                {item.title}
                              </div>
                              {item.subtitle && (
                                <div className="text-xs text-antique truncate">
                                  {item.subtitle}
                                </div>
                              )}
                            </div>
                            {globalIndex === selectedIndex && (
                              <kbd className="px-2 py-1 text-xs rounded bg-obsidian/60 text-antique">
                                ↵
                              </kbd>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-tobacco bg-obsidian/30">
            <div className="flex items-center justify-between text-xs text-antique/60">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 rounded bg-obsidian/50 text-antique/80">↑↓</kbd>
                  <span>navigate</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 rounded bg-obsidian/50 text-antique/80">↵</kbd>
                  <span>select</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 rounded bg-obsidian/50 text-antique/80">esc</kbd>
                  <span>close</span>
                </span>
              </div>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-obsidian/50 text-antique/80">⌘K</kbd>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
