import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import {
  Send,
  Globe,
  Plus,
  MessageSquare,
  Trash2,
  Save,
  Copy,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Clock,
  Sparkles,
  BookOpen,
  ExternalLink,
  ChevronsDownUp,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  Download,
  Paperclip,
  Square,
  FileText,
} from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { api, streamChat, apiBase } from '../lib/api'
import { useWordLink } from '../lib/hub'
import type { VerificationResult, VerificationClaim } from '../lib/api'

interface Source {
  source_name?: string
  title?: string
  text?: string
  content?: string
  excerpt?: string
  score?: number
}

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  createdAt?: string
  verificationPending?: boolean
  streamingDone?: boolean
  verifyStatus?: string
  verifyStartTime?: number
  verification?: VerificationResult
  verificationExpanded?: boolean
  remainingSources?: { remaining: number, nextOffset: number, total: number }
}

interface Conversation {
  id: string
  title: string
  jurisdiction?: string
  createdAt: string
  updatedAt?: string
  messageCount?: number
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

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 100) / 10), 100)
    return () => clearInterval(id)
  }, [startTime])
  return <span className="tabular-nums font-mono text-amber-400/70 text-xs">{elapsed.toFixed(1)}s</span>
}

function VerificationBadge({ verification, expanded, onToggle }: {
  verification: VerificationResult
  expanded: boolean
  onToggle: () => void
}) {
  const { verified, total, regenerated, removed, confidence, claims } = verification
  const passed = verified + regenerated

  const badgeColor = confidence === 'high' ? 'text-forest bg-forest/10 border-forest/30'
    : confidence === 'medium' ? 'text-amber-400 bg-amber-400/10 border-amber-400/30'
    : confidence === 'low' ? 'text-amber-500 bg-amber-500/10 border-amber-500/30'
    : 'text-red-400 bg-red-400/10 border-red-400/30'

  const iconColor = confidence === 'high' ? 'text-forest'
    : confidence === 'medium' ? 'text-amber-400'
    : 'text-red-400'

  const BadgeIcon = confidence === 'high' ? ShieldCheck
    : confidence === 'medium' ? ShieldAlert
    : ShieldX

  return (
    <div className="mt-3 border-t border-tobacco/50 pt-3">
      <button
        onClick={onToggle}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-button border text-xs font-medium transition-all ${badgeColor} hover:opacity-80`}
      >
        <BadgeIcon size={14} className={iconColor} />
        <span>{passed}/{total} verified</span>
        {regenerated > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <RefreshCw size={10} />
            {regenerated}
          </span>
        )}
        {removed > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <X size={10} />
            {removed}
          </span>
        )}
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 animate-fade-in">
          {claims.map((claim, i) => (
            <ClaimRow key={i} claim={claim} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClaimRow({ claim }: { claim: VerificationClaim }) {
  const statusConfig = {
    verified: { icon: ShieldCheck, color: 'text-forest', bg: 'bg-forest/5', label: 'Verified' },
    regenerated: { icon: RefreshCw, color: 'text-amber-400', bg: 'bg-amber-400/5', label: 'Rewritten' },
    removed: { icon: ShieldX, color: 'text-red-400', bg: 'bg-red-400/5', label: 'Removed' },
    unverified: { icon: AlertTriangle, color: 'text-antique', bg: 'bg-tobacco/10', label: 'Unverified' },
  }

  const config = statusConfig[claim.status] || statusConfig.unverified
  const Icon = config.icon

  return (
    <div className={`flex items-start gap-3 px-3 py-2 rounded-button ${config.bg} border border-tobacco/20`}>
      <Icon size={14} className={`${config.color} mt-0.5 flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
          {claim.confidence > 0 && (
            <span className="text-xs text-antique">{(claim.confidence * 100).toFixed(0)}%</span>
          )}
          {claim.sourceRef && (
            <span className="text-xs text-accent truncate">{claim.sourceRef}</span>
          )}
        </div>
        {claim.status === 'regenerated' && claim.originalClaim && (
          <p className="text-xs text-antique line-through mb-1">{claim.originalClaim}</p>
        )}
        <p className="text-xs text-cream-dark line-clamp-2">{claim.claim}</p>
      </div>
    </div>
  )
}

export default function Research() {
  const { t } = useTranslation()
  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(() => {
    try {
      const saved = sessionStorage.getItem('research_currentConv')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const [loadingConversations, setLoadingConversations] = useState(true)

  // Messages — wrapped so messagesRef is ALWAYS current (even before React renders)
  const [messages, _setMessages] = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem('research_messages')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const messagesRef = useRef<Message[]>(messages)
  const setMessages = useCallback((updater: Message[] | ((prev: Message[]) => Message[])) => {
    if (typeof updater === 'function') {
      messagesRef.current = updater(messagesRef.current)
    } else {
      messagesRef.current = updater
    }
    _setMessages(messagesRef.current)
  }, [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamConvIdRef = useRef<string | null>(null)
  const loadGenRef = useRef(0)
  const cancelledMsgsRef = useRef<Record<string, Message[]>>({})

  // Jurisdiction
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem('research_jurisdictions')
      return saved ? JSON.parse(saved) : ['US']
    } catch { return ['US'] }
  })
  const [showJurisdictionPicker, setShowJurisdictionPicker] = useState(false)

  // UI
  const jurisdictionRef = useRef<HTMLDivElement>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [summaryTitle, setSummaryTitle] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  // Word plugin link (desktop App only): send an answer into the open doc,
  // and accept questions handed over from Word (Layout routes them here).
  const wordLink = useWordLink()
  const [sentToWordIndex, setSentToWordIndex] = useState<number | null>(null)
  const location = useLocation()
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill
    if (prefill) setInput(prefill)
  }, [location.state])
  const handleSendToWord = useCallback(async (index: number, content: string) => {
    try {
      await wordLink.sendToWord(content, { source: 'Research' })
      setSentToWordIndex(index)
      setTimeout(() => setSentToWordIndex(null), 2000)
    } catch (err) {
      alert((err as Error).message)
    }
  }, [wordLink])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Source expansion state: { messageIndex: { expanded: Set<sourceIndex>, showAll: boolean } }
  const [sourceState, setSourceState] = useState<Record<number, { expanded: Set<number>; showAll: boolean }>>({})

  const toggleSourceExpanded = (msgIdx: number, srcIdx: number) => {
    setSourceState(prev => {
      const current = prev[msgIdx] || { expanded: new Set(), showAll: false }
      const newExpanded = new Set(current.expanded)
      if (newExpanded.has(srcIdx)) {
        newExpanded.delete(srcIdx)
      } else {
        newExpanded.add(srcIdx)
      }
      return { ...prev, [msgIdx]: { ...current, expanded: newExpanded } }
    })
  }

  const toggleShowAllSources = (msgIdx: number) => {
    setSourceState(prev => {
      const current = prev[msgIdx] || { expanded: new Set(), showAll: false }
      return { ...prev, [msgIdx]: { ...current, showAll: !current.showAll } }
    })
  }

  const collapseAllSources = (msgIdx: number) => {
    setSourceState(prev => {
      return { ...prev, [msgIdx]: { expanded: new Set(), showAll: false } }
    })
  }

  const isSourceExpanded = (msgIdx: number, srcIdx: number) => {
    return sourceState[msgIdx]?.expanded?.has(srcIdx) || false
  }

  const isShowingAllSources = (msgIdx: number) => {
    return sourceState[msgIdx]?.showAll || false
  }

  const hasAnyExpanded = (msgIdx: number) => {
    const state = sourceState[msgIdx]
    return (state?.expanded?.size || 0) > 0 || state?.showAll
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    loadConversations()
    // Restore cancelled messages from previous mount (page navigation)
    try {
      const saved = sessionStorage.getItem('research_cancelled')
      if (saved) {
        sessionStorage.removeItem('research_cancelled')
        Object.assign(cancelledMsgsRef.current, JSON.parse(saved))
      }
    } catch { /* ignore */ }

    // Cleanup on unmount: abort stream, persist cancelled state
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort()
        // Mark current messages as cancelled directly in sessionStorage
        const snap = messagesRef.current.map(m => ({
          role: m.role, content: m.content, sources: m.sources, verification: m.verification
        }))
        const last = snap[snap.length - 1]
        if (last?.role === 'assistant') {
          last.content = last.content ? last.content + '\n\n*Query cancelled.*' : 'Query cancelled.'
        } else if (snap.length > 0) {
          snap.push({ role: 'assistant' as const, content: 'Query cancelled.', sources: undefined, verification: undefined })
        }
        try { sessionStorage.setItem('research_messages', JSON.stringify(snap)) } catch {}
      }
      // Persist any pending cancelled conversation snapshots for sidebar switches
      if (Object.keys(cancelledMsgsRef.current).length > 0) {
        try { sessionStorage.setItem('research_cancelled', JSON.stringify(cancelledMsgsRef.current)) } catch {}
      }
    }
  }, [])

  // Track scroll position — distinguish user scroll from programmatic scroll
  const programmaticScrollRef = useRef(false)
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      // Ignore scroll events caused by our own scrollTop assignment
      if (programmaticScrollRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = container
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100
    }
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!isNearBottomRef.current) return
    const container = messagesContainerRef.current
    if (!container) return
    // Use instant scroll (no animation) so it doesn't fight with user scrolling
    programmaticScrollRef.current = true
    container.scrollTop = container.scrollHeight
    // Reset flag after current event loop so the scroll handler ignores this
    requestAnimationFrame(() => { programmaticScrollRef.current = false })
  }, [messages])

  // Persist messages to sessionStorage for page-level navigation resilience
  // NOTE: Per-conversation caches are written ONLY in loadConversation/startNewConversation/onDone
  // to avoid race conditions during conversation switches
  useEffect(() => {
    const serialized = messages.map(m => ({ role: m.role, content: m.content, sources: m.sources, verification: m.verification, remainingSources: m.remainingSources }))
    try {
      sessionStorage.setItem('research_messages', JSON.stringify(serialized))
    } catch { /* quota exceeded */ }
  }, [messages])

  useEffect(() => {
    try {
      if (currentConversation) {
        sessionStorage.setItem('research_currentConv', JSON.stringify(currentConversation))
      } else {
        sessionStorage.removeItem('research_currentConv')
      }
    } catch { /* ignore */ }
  }, [currentConversation])

  useEffect(() => {
    try {
      sessionStorage.setItem('research_jurisdictions', JSON.stringify(selectedJurisdictions))
    } catch { /* ignore */ }
  }, [selectedJurisdictions])

  // Close jurisdiction picker on click outside
  useEffect(() => {
    if (!showJurisdictionPicker) return
    const handleClickOutside = (e: MouseEvent) => {
      if (jurisdictionRef.current && !jurisdictionRef.current.contains(e.target as Node)) {
        setShowJurisdictionPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showJurisdictionPicker])

  const loadConversations = async () => {
    try {
      const data = await api.get('/research/conversations')
      const convs = Array.isArray(data) ? data : data.conversations || []
      setConversations(convs)
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      setLoadingConversations(false)
    }
  }

  const loadConversation = async (conv: Conversation) => {
    const thisLoad = ++loadGenRef.current

    // If there's an active stream, snapshot current messages + "Query cancelled."
    if (streamAbortRef.current && streamConvIdRef.current) {
      const cancelledId = streamConvIdRef.current
      const snap = messagesRef.current.map(m => ({ ...m }))
      const last = snap[snap.length - 1]
      if (last && last.role === 'assistant') {
        last.content = last.content ? last.content + '\n\n*Query cancelled.*' : 'Query cancelled.'
        last.verificationPending = false
      } else {
        snap.push({ role: 'assistant', content: 'Query cancelled.' })
      }
      cancelledMsgsRef.current[cancelledId] = snap
      streamAbortRef.current.abort()
      streamAbortRef.current = null
    }
    streamConvIdRef.current = null

    setLoading(false)
    setMessages([])
    setCurrentConversation(conv)
    setSelectedJurisdictions(conv.jurisdiction ? conv.jurisdiction.split(',') : ['US'])

    if (cancelledMsgsRef.current[conv.id]) {
      const msgs = cancelledMsgsRef.current[conv.id]
      delete cancelledMsgsRef.current[conv.id]
      setMessages(msgs)
      return
    }

    try {
      const data = await api.get(`/research/conversations/${conv.id}`)
      if (loadGenRef.current !== thisLoad) return
      const msgs = Array.isArray(data.messages) ? data.messages : []
      // Extract remainingSources from verification data (stored in DB)
      for (const msg of msgs) {
        if (msg.verification?.remainingSources) {
          msg.remainingSources = msg.verification.remainingSources
        }
      }
      setMessages(msgs)
    } catch {
      if (loadGenRef.current !== thisLoad) return
      setMessages([])
    }
  }

  const startNewConversation = () => {
    loadGenRef.current++

    // Snapshot cancelled messages if stream is active
    if (streamAbortRef.current && streamConvIdRef.current) {
      const cancelledId = streamConvIdRef.current
      const snap = messagesRef.current.map(m => ({ ...m }))
      const last = snap[snap.length - 1]
      if (last && last.role === 'assistant') {
        last.content = last.content ? last.content + '\n\n*Query cancelled.*' : 'Query cancelled.'
        last.verificationPending = false
      } else {
        snap.push({ role: 'assistant', content: 'Query cancelled.' })
      }
      cancelledMsgsRef.current[cancelledId] = snap
      streamAbortRef.current.abort()
      streamAbortRef.current = null
    }
    streamConvIdRef.current = null

    setCurrentConversation(null)
    setLoading(false)
    setMessages([])
    setInput('')
    inputRef.current?.focus()
  }

  const createConversation = async (title: string): Promise<string> => {
    const data = await api.post('/research/conversations', {
      title,
      jurisdiction: selectedJurisdictions.join(','),
    })
    const newConv = { id: data.id, title, jurisdiction: selectedJurisdictions.join(','), createdAt: new Date().toISOString() }
    setConversations((prev) => [newConv, ...prev])
    setCurrentConversation(newConv)
    return data.id
  }

  const deleteConversation = async (id: string) => {
    if (!confirm(t('research.deleteConversationConfirm'))) return

    try {
      await api.delete(`/research/conversations/${id}`)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (currentConversation?.id === id) {
        startNewConversation()
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    const fileToSend = attachedFile
    setInput('')
    setAttachedFile(null)
    setLoading(true)
    const submitGen = ++loadGenRef.current

    // Add user message (show attached filename if present)
    const displayMessage = fileToSend
      ? `${userMessage}\n\n📎 ${fileToSend.name}`
      : userMessage
    setMessages((prev) => [...prev, { role: 'user', content: displayMessage }])

    try {
      // Get or create conversation
      let convId = currentConversation?.id
      if (!convId) {
        const title = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '')
        convId = await createConversation(title)
      }

      // Guard: user switched away during createConversation await
      if (loadGenRef.current !== submitGen) {
        // Save user message so it's visible if they come back
        cancelledMsgsRef.current[convId!] = [
          { role: 'user', content: displayMessage },
          { role: 'assistant', content: 'Query cancelled.' },
        ]
        setLoading(false)
        return
      }

      // Add placeholder for assistant with pending verification state
      setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: [], verificationPending: true }])

      // Track which conversation this stream belongs to
      streamConvIdRef.current = convId!
      const thisStreamConv = convId!

      // Track whether verified content has replaced streamed tokens
      let contentReplaced = false

      // Safety timeout: clear verificationPending after 300s if no event arrives
      const verifyTimeout = setTimeout(() => {
        if (streamConvIdRef.current !== thisStreamConv) return
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant' && last.verificationPending) {
            last.verificationPending = false
          }
          return updated
        })
      }, 300000)

      // Stream response — all callbacks guarded by conv-id check
      streamAbortRef.current = streamChat(
        convId!,
        userMessage,
        selectedJurisdictions,
        // onChunk
        (text) => {
          if (streamConvIdRef.current !== thisStreamConv) return
          if (contentReplaced) return
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              last.content += text
            }
            return updated
          })
        },
        // onSources
        (sources) => {
          if (streamConvIdRef.current !== thisStreamConv) return
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              last.sources = [...(last.sources || []), ...(sources as Source[])]
            }
            return updated
          })
        },
        // onDone
        () => {
          clearTimeout(verifyTimeout)
          if (streamConvIdRef.current !== thisStreamConv) return // ghost callback from aborted stream
          streamConvIdRef.current = null
          streamAbortRef.current = null
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              last.verificationPending = false
            }
            return updated
          })
          setLoading(false)
          loadConversations()
          // Desktop notification — only fires when window unfocused (main
          // process gates this). Useful for queries that take 30+s and the
          // user has alt-tabbed away.
          try {
            const lv = (window as any).lexvault
            if (lv?.notify) lv.notify('Research answer ready', 'Your OpenLex question finished — click to view.')
          } catch {}
        },
        // onContentReplace
        (content) => {
          if (streamConvIdRef.current !== thisStreamConv) return
          contentReplaced = true
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              last.content = content
            }
            return updated
          })
        },
        // onVerification
        (result: VerificationResult & { remainingSources?: { remaining: number, nextOffset: number, total: number } }) => {
          if (streamConvIdRef.current !== thisStreamConv) return
          clearTimeout(verifyTimeout)
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              last.verification = result
              last.verificationPending = false
              last.verificationExpanded = true
              // Extract remaining sources info if bundled with verification
              if (result.remainingSources) {
                last.remainingSources = result.remainingSources
              }
            }
            return updated
          })
        },
        // onStatus
        (status) => {
          if (streamConvIdRef.current !== thisStreamConv) return
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              if (!last.content) last.content = ''
              if (status === 'Verifying claims...') {
                last.streamingDone = true
                last.verifyStartTime = Date.now()
              }
              // Update verify sub-status messages from ClaimVerifier
              if (last.streamingDone && last.verificationPending) {
                last.verifyStatus = status
              }
            }
            return updated
          })
        },
        fileToSend || undefined,
        {
          onRemainingSources: (data) => {
            if (streamConvIdRef.current !== thisStreamConv) return
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                last.remainingSources = data
              }
              return updated
            })
          },
        },
      )
    } catch (err) {
      setLoading(false)
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last.role === 'assistant') {
          last.content = 'Sorry, an error occurred. Please try again.'
        }
        return updated
      })
    }
  }

  const handleCancel = () => {
    streamConvIdRef.current = null
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
      streamAbortRef.current = null
    }
    setLoading(false)
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last?.role === 'assistant') {
        last.verificationPending = false
        if (!last.content) {
          // Remove empty assistant message
          return updated.slice(0, -1)
        }
      }
      return updated
    })
  }

  const handleLoadMoreSources = (nextOffset: number) => {
    if (!currentConversation?.id || loading) return
    setLoading(true)
    const thisStreamConv = currentConversation.id
    streamConvIdRef.current = thisStreamConv
    let contentReplaced = false

    // Add a new assistant message for the continuation
    setMessages((prev) => [
      ...prev,
      { role: 'assistant' as const, content: '', verificationPending: true },
    ])

    streamAbortRef.current = streamChat(
      currentConversation.id,
      '',
      selectedJurisdictions,
      (text) => {
        if (streamConvIdRef.current !== thisStreamConv) return
        if (contentReplaced) return
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') last.content += text
          return updated
        })
      },
      (sources) => {
        if (streamConvIdRef.current !== thisStreamConv) return
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') last.sources = [...(last.sources || []), ...(sources as Source[])]
          return updated
        })
      },
      () => {
        if (streamConvIdRef.current !== thisStreamConv) return
        streamConvIdRef.current = null
        streamAbortRef.current = null
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') last.verificationPending = false
          return updated
        })
        setLoading(false)
      },
      (content) => {
        if (streamConvIdRef.current !== thisStreamConv) return
        contentReplaced = true
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') last.content = content
          return updated
        })
      },
      (result: VerificationResult & { remainingSources?: { remaining: number, nextOffset: number, total: number } }) => {
        if (streamConvIdRef.current !== thisStreamConv) return
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            last.verification = result
            last.verificationPending = false
            last.verificationExpanded = true
            if (result.remainingSources) {
              last.remainingSources = result.remainingSources
            }
          }
          return updated
        })
      },
      (status) => {
        if (streamConvIdRef.current !== thisStreamConv) return
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            if (!last.content) last.content = ''
            if (status === 'Verifying claims...') {
              last.streamingDone = true
              last.verifyStartTime = Date.now()
            }
            if (last.streamingDone && last.verificationPending) {
              last.verifyStatus = status
            }
          }
          return updated
        })
      },
      undefined,
      {
        sourceOffset: nextOffset,
        onRemainingSources: (data) => {
          if (streamConvIdRef.current !== thisStreamConv) return
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') last.remainingSources = data
            return updated
          })
        },
      },
    )
    // Clear the button from the previous message
    setMessages((prev) => {
      const updated = [...prev]
      // Find the message before the new assistant message that had remainingSources
      for (let i = updated.length - 2; i >= 0; i--) {
        if (updated[i].remainingSources) {
          updated[i] = { ...updated[i], remainingSources: undefined }
          break
        }
      }
      return updated
    })
  }

  const handleExportConversation = useCallback(async (format: 'docx' | 'pdf') => {
    if (!currentConversation?.id) return
    try {
      const url = format === 'pdf'
        ? `${apiBase()}/api/research/export/conversation/${currentConversation.id}/pdf`
        : `${apiBase()}/api/research/export/conversation/${currentConversation.id}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const fname = `${(currentConversation.title || 'research').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_')}.${format}`
      // In Electron the browser a.download trick silently fails (contextIsolation
      // + no file:// permissions). Hand the bytes off to the main process which
      // shows a native save dialog and writes the file. Outside Electron (web),
      // fall back to the browser anchor pattern.
      const lv = (window as any).lexvault
      if (lv?.saveFile) {
        const bytes = await blob.arrayBuffer()
        const r = await lv.saveFile({ suggestedName: fname, bytes })
        if (!r?.ok && !r?.cancelled) console.warn('saveFile failed:', r?.error)
      } else {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = fname
        a.click()
        URL.revokeObjectURL(blobUrl)
      }
    } catch (err) {
      console.error(`${format.toUpperCase()} export failed:`, err)
    }
  }, [currentConversation])

  const handleCopy = useCallback(async (index: number, content: string) => {
    // Three-layer fallback. Some Electron + Windows combinations (looking at
    // you, file:// contexts and corporate AV policies) silently reject both
    // navigator.clipboard and execCommand. The Electron-clipboard IPC bridge
    // always works inside the App; outside the App it isn't there, and the
    // browser paths handle that.
    let ok = false
    try {
      await navigator.clipboard.writeText(content)
      ok = true
    } catch {}
    if (!ok) {
      try {
        const lv = (window as any).lexvault
        if (lv?.copyText) ok = !!(await lv.copyText(content))
      } catch {}
    }
    if (!ok) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = content
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        ok = document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {}
    }
    if (ok) {
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    }
  }, [])

  const toggleJurisdiction = (code: string) => {
    setSelectedJurisdictions((prev) => {
      if (prev.includes(code)) {
        return prev.length > 1 ? prev.filter((j) => j !== code) : prev
      }
      return [...prev, code]
    })
  }

  const handleSaveSummary = async () => {
    if (!summaryTitle.trim()) return

    try {
      // Save to vault
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop()
      if (lastAssistant) {
        await api.post('/vault', {
          title: summaryTitle,
          content: lastAssistant.content,
          type: 'note',
          tags: ['research', ...selectedJurisdictions.map((j) => j.toLowerCase())],
        })
      }
      setShowSaveModal(false)
      setSummaryTitle('')
    } catch (err) {
      console.error('Failed to save summary:', err)
    }
  }

  const formatTime = (dateStr: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ''
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="h-[calc(100vh-0px)] flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-0' : 'w-72'
        } border-r border-tobacco flex flex-col transition-all duration-200 overflow-hidden bg-deep-brown`}
      >
        {/* New conversation button */}
        <div className="h-[72px] px-4 border-b border-tobacco flex items-center">
          <button
            onClick={startNewConversation}
            className="w-full btn-primary flex items-center justify-center gap-2 !py-2"
          >
            <Plus size={18} />
            New Research
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          {loadingConversations ? (
            <div className="p-4 text-center text-antique">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-antique text-sm">
              No conversations yet
            </div>
          ) : (
            <div className="py-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group px-4 py-3 cursor-pointer transition-colors ${
                    currentConversation?.id === conv.id
                      ? 'bg-accent/10 border-l-2 border-accent'
                      : 'hover:bg-leather border-l-2 border-transparent'
                  }`}
                  onClick={() => loadConversation(conv)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-antique flex-shrink-0" />
                        <span className="text-cream text-sm font-medium truncate">
                          {conv.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-antique">
                        <Clock size={10} />
                        {formatTime(conv.createdAt || conv.updatedAt || '')}
                        {conv.jurisdiction && (
                          <>
                            <span className="text-tobacco">•</span>
                            <span>{conv.jurisdiction}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(conv.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-antique hover:text-red-400 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div className="h-[72px] border-b border-tobacco px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-antique hover:text-cream transition-colors flex-shrink-0"
            >
              <MessageSquare size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="font-serif text-lg text-parchment truncate">
                {currentConversation?.title || t('research.newConversation')}
              </h1>
              <p className="text-antique text-xs">
                {t('research.title')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Jurisdiction picker */}
            <div className="relative" ref={jurisdictionRef}>
              <button
                onClick={() => setShowJurisdictionPicker(!showJurisdictionPicker)}
                className="btn-secondary flex items-center gap-2 !px-4 !py-2 text-sm"
              >
                <Globe size={16} />
                {selectedJurisdictions.length === 1
                  ? jurisdictions.find((j) => j.code === selectedJurisdictions[0])?.label
                  : `${selectedJurisdictions.length} ${t('common.jurisdiction').toLowerCase()}`}
                <ChevronDown size={14} />
              </button>

              {showJurisdictionPicker && (
                <div className="absolute right-0 top-full mt-2 bg-deep-brown border border-tobacco rounded-card shadow-xl z-20 w-64 p-2">
                  <div className="text-xs text-antique mb-2 px-2">Select jurisdictions:</div>
                  {jurisdictions.map((j) => (
                    <button
                      key={j.code}
                      onClick={() => toggleJurisdiction(j.code)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-button transition-colors ${
                        selectedJurisdictions.includes(j.code)
                          ? 'bg-accent/10 text-accent'
                          : 'text-cream hover:bg-leather'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{j.flag}</span>
                        <span>{j.label}</span>
                      </span>
                      {selectedJurisdictions.includes(j.code) && (
                        <Check size={16} />
                      )}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowJurisdictionPicker(false)}
                    className="w-full mt-2 py-2 text-sm text-antique hover:text-cream"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>

            {/* Export + Save buttons */}
            {messages.some((m) => m.role === 'assistant' && m.content) && currentConversation?.id && (
              <div className="relative group">
                <button className="btn-secondary flex items-center gap-2 !px-4 !py-2 text-sm">
                  <Download size={16} />
                  Export
                </button>
                <div className="absolute right-0 top-full mt-2 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[160px]">
                  <button
                    onClick={() => handleExportConversation('docx')}
                    className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                  >
                    Export as .docx
                  </button>
                  <button
                    onClick={() => handleExportConversation('pdf')}
                    className="block w-full px-4 py-2 text-sm text-cream hover:bg-leather text-left"
                  >
                    Export as .pdf
                  </button>
                </div>
              </div>
            )}
            {messages.some((m) => m.role === 'assistant' && m.content) && (
              <button
                onClick={() => setShowSaveModal(true)}
                className="btn-secondary flex items-center gap-2 !px-4 !py-2 text-sm"
              >
                <Save size={16} />
                Save
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Sparkles size={32} className="text-accent" />
              </div>
              <div className="font-serif text-2xl text-parchment mb-3">
                Legal Research Assistant
              </div>
              <p className="text-antique text-sm max-w-lg mx-auto mb-8">
                Ask questions about laws, regulations, and legal concepts. I search
                through statutes, codes, and legal sources to provide accurate,
                sourced answers.
              </p>

              {/* Dynamic jurisdiction disclaimer */}
              <div className="max-w-xl mx-auto space-y-3">
                <div className="px-4 py-3 bg-leather/40 border border-tobacco/50 rounded-card text-sm text-antique">
                  <div className="flex items-center gap-2 mb-2 text-parchment text-xs font-medium uppercase tracking-wide">
                    <AlertTriangle size={12} className="text-amber-400/70" />
                    Before you search
                  </div>
                  <div className="mb-2">
                    <span className="text-cream">
                      {selectedJurisdictions.length === 0
                        ? 'No jurisdictions selected.'
                        : selectedJurisdictions.length === 1
                          ? `Searching in ${jurisdictions.find(j => j.code === selectedJurisdictions[0])?.label || selectedJurisdictions[0]}.`
                          : `Searching across ${selectedJurisdictions.length} jurisdictions: ${selectedJurisdictions.map(c => jurisdictions.find(j => j.code === c)?.label || c).join(', ')}.`}
                    </span>
                  </div>
                  <ul className="space-y-1 text-antique/80 text-xs list-disc list-inside">
                    {selectedJurisdictions.length > 1 && (
                      <li className="text-amber-400/80">
                        Multi-jurisdiction queries split search capacity. If your question is about one country, select only that jurisdiction for better results.
                      </li>
                    )}
                    {selectedJurisdictions.length === 0 && (
                      <li className="text-amber-400/80">
                        Select at least one jurisdiction to get relevant results.
                      </li>
                    )}
                    <li>Results are based on federal statutes and codes only — case law and state/regional law are not yet included.</li>
                    <li>Responses are AI-generated and verified against sources, but should not substitute professional legal advice.</li>
                    <li>Ask specific questions for better results — e.g. "What are the notice periods for terminating a commercial lease?" rather than "Tell me about lease law."</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-3xl ${
                  msg.role === 'user'
                    ? 'bg-accent/20 rounded-card rounded-br-sm px-5 py-4'
                    : 'w-full'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className={`bg-leather border rounded-card overflow-hidden transition-colors duration-500 ${
                    msg.verificationPending ? 'border-amber-500/40 verify-pulse'
                      : msg.verification && msg.verification.total > 0 ? 'border-forest/30 verify-complete'
                      : 'border-tobacco'
                  }`}>
                    {/* Response header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-tobacco/50 bg-deep-brown/50">
                      <div className="flex items-center gap-2 text-antique text-sm">
                        <BookOpen size={14} />
                        Research Response
                        {msg.verificationPending && msg.streamingDone && (
                          <span className="flex items-center gap-1.5 text-amber-400 text-xs">
                            <ShieldAlert size={12} className="animate-pulse" />
                            <span className="animate-pulse">{t('research.verifying')}</span>
                            {msg.verifyStartTime && <ElapsedTimer startTime={msg.verifyStartTime} />}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {currentConversation?.id && (
                          <div className="relative group">
                            <button
                              className="text-antique hover:text-accent transition-colors"
                              title={t('common.export')}
                            >
                              <Download size={14} />
                            </button>
                            <div className="absolute right-0 top-full mt-1 bg-deep-brown border border-tobacco rounded-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[130px]">
                              <button
                                onClick={() => handleExportConversation('docx')}
                                className="block w-full px-3 py-1.5 text-xs text-cream hover:bg-leather text-left"
                              >
                                {t('vault.exportDocx')}
                              </button>
                              <button
                                onClick={() => handleExportConversation('pdf')}
                                className="block w-full px-3 py-1.5 text-xs text-cream hover:bg-leather text-left"
                              >
                                {t('vault.exportPdf')}
                              </button>
                            </div>
                          </div>
                        )}
                        {wordLink.connected && msg.content && (
                          <button
                            onClick={() => handleSendToWord(idx, msg.content)}
                            className="text-antique hover:text-accent transition-colors"
                            title={t('research.sendToWord', 'Send to Word (insert at cursor)')}
                          >
                            {sentToWordIndex === idx ? (
                              <Check size={14} className="text-forest" />
                            ) : (
                              <FileText size={14} />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopy(idx, msg.content)}
                          className="text-antique hover:text-accent transition-colors"
                          title={t('research.copyResponse')}
                        >
                          {copiedIndex === idx ? (
                            <Check size={14} className="text-forest" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="px-5 py-4">
                      <div className="prose-custom max-w-none">
                        {msg.content ? (
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        ) : (
                          <p className="text-antique animate-pulse">{t('research.searchingDb')}</p>
                        )}
                      </div>
                      {/* Verification in-progress indicator — only after streaming completes */}
                      {msg.verificationPending && msg.streamingDone && msg.content && (
                        <div className="mt-3 flex items-center gap-3 px-4 py-2.5 rounded-button bg-amber-500/10 border border-amber-500/30">
                          <ShieldAlert size={16} className="text-amber-400 animate-pulse flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-amber-300 font-medium truncate">
                              {msg.verifyStatus || 'Verifying claims against sources...'}
                            </p>
                            <p className="text-xs text-amber-400/70 mt-0.5">
                              Cross-referencing response with legal sources
                              {msg.verifyStartTime && (
                                <> &middot; <ElapsedTimer startTime={msg.verifyStartTime} /></>
                              )}
                            </p>
                          </div>
                          <div className="w-4 h-4 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin flex-shrink-0" />
                        </div>
                      )}
                      {/* Verification Badge — auto-shown when verification completes */}
                      {msg.verification && (msg.verification.total > 0 || msg.verification.confidence !== 'none') && (
                        <VerificationBadge
                          verification={msg.verification}
                          expanded={msg.verificationExpanded ?? true}
                          onToggle={() => {
                            setMessages((prev) => {
                              const updated = [...prev]
                              updated[idx] = { ...updated[idx], verificationExpanded: !updated[idx].verificationExpanded }
                              return updated
                            })
                          }}
                        />
                      )}
                      {/* Analyse More Sources button — only on the last assistant message */}
                      {msg.remainingSources && msg.remainingSources.remaining > 0 && !loading && idx === messages.length - 1 && (
                        <button
                          onClick={() => handleLoadMoreSources(msg.remainingSources!.nextOffset)}
                          className="mt-3 ml-5 flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/30 text-accent text-sm rounded-lg hover:bg-accent/20 transition-colors"
                        >
                          <BookOpen size={14} />
                          Analyse {Math.min(msg.remainingSources.remaining, 10)} more sources
                          <span className="text-antique text-xs">({msg.remainingSources.remaining} remaining of {msg.remainingSources.total})</span>
                        </button>
                      )}
                    </div>

                    {/* Sources */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="px-5 py-4 border-t border-tobacco/50 bg-deep-brown/30">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-xs text-antique">
                            <ExternalLink size={12} />
                            Sources ({msg.sources.length})
                          </div>
                          {hasAnyExpanded(idx) && (
                            <button
                              onClick={() => collapseAllSources(idx)}
                              className="flex items-center gap-1 text-xs text-antique hover:text-accent transition-colors"
                            >
                              <ChevronsDownUp size={14} />
                              Collapse All
                            </button>
                          )}
                        </div>
                        <div className="space-y-2">
                          {(isShowingAllSources(idx) ? msg.sources : msg.sources.slice(0, 5)).map((src, i) => {
                            const sourceText = src.text || src.content || src.excerpt || ''
                            const sourceName = src.title || src.source_name || ''
                            const isExpanded = isSourceExpanded(idx, i)

                            return (
                              <div
                                key={i}
                                className="bg-deep-brown rounded-button border border-tobacco/30 overflow-hidden"
                              >
                                <button
                                  onClick={() => toggleSourceExpanded(idx, i)}
                                  className="w-full px-4 py-3 text-left cursor-pointer hover:bg-leather/30"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="font-medium text-accent text-sm flex-1">
                                      {sourceName}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      {src.score && (
                                        <span className="text-xs text-antique">
                                          {(src.score * 100).toFixed(0)}%
                                        </span>
                                      )}
                                      {isExpanded ? (
                                        <ChevronUp size={14} className="text-antique" />
                                      ) : (
                                        <ChevronDown size={14} className="text-antique" />
                                      )}
                                    </div>
                                  </div>
                                  <div className={`mt-2 text-xs text-cream-dark whitespace-pre-wrap ${isExpanded ? '' : 'line-clamp-3'}`}>
                                    {sourceText}
                                  </div>
                                </button>
                              </div>
                            )
                          })}
                          {msg.sources.length > 5 && (
                            <button
                              onClick={() => toggleShowAllSources(idx)}
                              className="w-full py-3 text-sm text-accent hover:text-accent/80 transition-colors flex items-center justify-center gap-2 bg-obsidian/30 rounded-button border border-tobacco/20"
                            >
                              {isShowingAllSources(idx) ? (
                                <>
                                  <ChevronUp size={16} />
                                  Show fewer sources
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={16} />
                                  Show {msg.sources.length - 5} more sources
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-parchment">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator removed — "Searching..." already shown inside the assistant message card */}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-tobacco p-4 bg-deep-brown">
          {/* File preview chip */}
          {attachedFile && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-tobacco/30 border border-tobacco rounded-button w-fit">
              <Paperclip size={14} className="text-antique" />
              <span className="text-xs text-parchment truncate max-w-[200px]">{attachedFile.name}</span>
              <span className="text-xs text-antique">({(attachedFile.size / 1024).toFixed(0)} KB)</span>
              <button
                type="button"
                onClick={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="text-antique hover:text-cream ml-1"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="flex gap-3">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setAttachedFile(file)
              }}
            />
            {/* Paperclip button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="text-antique hover:text-cream transition-colors px-2"
              title={t('research.attachFile')}
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('research.askAnything')}
              className="input flex-1"
              disabled={loading}
            />
            {loading ? (
              <button
                type="button"
                onClick={handleCancel}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-button transition-colors"
                title={t('research.stopGeneration')}
              >
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="btn-primary px-5"
              >
                <Send size={18} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-antique">
            <span className="flex items-center gap-1">
              <Globe size={10} />
              {selectedJurisdictions.join(', ')}
            </span>
            <span>•</span>
            <span>{t('research.multiJurisdictionDb')}</span>
          </div>
        </form>
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-ink/80 flex items-center justify-center z-50 p-6">
          <div className="card max-w-md w-full animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-xl text-parchment">{t('research.saveToVault')}</h2>
              <button
                onClick={() => setShowSaveModal(false)}
                className="text-antique hover:text-cream"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-antique text-sm mb-4">
              {t('research.saveDescription')}
            </p>

            <div>
              <label className="block text-cream text-sm mb-2">{t('common.title')}</label>
              <input
                type="text"
                value={summaryTitle}
                onChange={(e) => setSummaryTitle(e.target.value)}
                className="input w-full"
                placeholder={t('research.vaultTitlePlaceholder')}
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSaveModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSummary}
                disabled={!summaryTitle.trim()}
                className="btn-primary flex-1 inline-flex items-center justify-center"
              >
                <Save size={18} className="mr-2" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
