// In the Electron App, the supervisor exposes the local backend at a known
// port and the preload bridge stashes that URL on window.lexvault.backendUrl.
// Pick that up first so the SPA — loaded from file:// — knows to call
// http://127.0.0.1:18000 instead of trying to fetch relative URLs (which
// would attempt file:// requests and 404).
declare global {
  interface Window {
    lexvault?: { isElectron?: boolean; getIdentity?: () => Promise<{ backendUrl?: string }> }
  }
}

function resolveApiBase(): string {
  // 1. Build-time env (existing cloud builds keep using this)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  // 2. Electron App: main process appends ?backend=http://127.0.0.1:18000 to
  //    the loaded URL/file so the SPA knows where the supervisor put the
  //    local backend. Resolved synchronously at module load.
  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('backend')
    if (fromQuery) return fromQuery
  }
  // 3. Fallback: same-origin (current production cloud deployment)
  return ''
}

const API_BASE = resolveApiBase()
/** Base URL for direct fetch() calls (streams) — never hard-code a host. */
export const apiUrl = (path: string) => `${API_BASE}/api${path}`
/** Backend origin ('' on the same-origin web build, the local backend in the App). */
export const apiBase = () => API_BASE

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let isRefreshing = false
let refreshPromise: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return false

  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken }),
    })
    if (!response.ok) return false
    const data = await response.json()
    if (data.token) {
      // Cookie is set by server; keep localStorage for backward compat during rollout
      localStorage.setItem('token', data.token)
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken)
      }
      return true
    }
  } catch {
    // refresh failed
  }
  return false
}

async function refreshIfNeeded(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise
  isRefreshing = true
  refreshPromise = tryRefreshToken().finally(() => {
    isRefreshing = false
    refreshPromise = null
  })
  return refreshPromise
}

async function request(endpoint: string, options: RequestInit = {}) {
  const config: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }

  let response = await fetch(`${API_BASE}/api${endpoint}`, config)

  // 401 → attempt token refresh and retry once
  if (response.status === 401 && !endpoint.includes('/auth/')) {
    const refreshed = await refreshIfNeeded()
    if (refreshed) {
      response = await fetch(`${API_BASE}/api${endpoint}`, config)
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Token expired and refresh failed — clear auth
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      window.dispatchEvent(new CustomEvent('auth:logout'))
    }
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new ApiError(error.message || error.error || 'Request failed', response.status)
  }

  return response.json()
}

export const api = {
  get: (endpoint: string) => request(endpoint),
  post: (endpoint: string, body: unknown) =>
    request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint: string, body: unknown) =>
    request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (endpoint: string, body: unknown) =>
    request(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint: string) =>
    request(endpoint, { method: 'DELETE' }),
}

export interface VerificationClaim {
  claim: string
  originalClaim?: string
  status: 'verified' | 'regenerated' | 'removed' | 'unverified'
  confidence: number
  sourceRef?: string
  nliLabel?: string
}

export interface VerificationResult {
  verified: number
  total: number
  regenerated: number
  removed: number
  confidence: 'high' | 'medium' | 'low' | 'unverified' | 'none'
  claims: VerificationClaim[]
}

// SSE streaming for investigate (parallel document analysis)
export function streamInvestigate(
  params: {
    documentIds: string[]
    vaultItemIds: string[]
    query: string
    jurisdictions: string[]
    includeRag: boolean
  },
  callbacks: {
    onStatus: (msg: string, progress: number) => void
    onRagSources: (sources: { sourceName: string; score: number; jurisdiction?: string }[]) => void
    onDocStart: (id: string, name: string) => void
    onFinding: (finding: { id: string; name: string; sourceType: string; analysis: string }) => void
    onDocComplete: (id: string, completed: number, total: number, progress: number) => void
    onDocError: (id: string, name: string, error: string) => void
    onDocProgress?: (data: { id: string; chunk: number; totalChunks: number }) => void
    onScanComplete?: (data: { docId: string; docName: string; totalSections: number; selectedSections: number[]; selectedHeadings: string[]; skippedCount: number; reasoning: string; ragQueries: string[] }) => void
    onRagQuery?: (data: { query: string; resultCount: number; triggeredBy: string }) => void
    onComparison?: (data: { analysis: string }) => void
    onAggregation: (data: { totalItems: number; completed: number; ragSourceCount: number }) => void
    onError: (message: string) => void
    onDone: () => void
  },
): AbortController {
  const controller = new AbortController()

  fetch(`${API_BASE}/api/research/investigate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Request failed' }))
        callbacks.onError(err.message || 'Investigation failed')
        callbacks.onDone()
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''
      let finished = false
      const finish = () => {
        if (!finished) {
          finished = true
          callbacks.onDone()
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              switch (eventType) {
                case 'status':
                  callbacks.onStatus(data.message, data.progress)
                  break
                case 'rag_sources':
                  callbacks.onRagSources(data.sources)
                  break
                case 'doc_start':
                  callbacks.onDocStart(data.id, data.name)
                  break
                case 'finding':
                  callbacks.onFinding(data)
                  break
                case 'doc_complete':
                  callbacks.onDocComplete(data.id, data.completed, data.total, data.progress)
                  break
                case 'doc_error':
                  callbacks.onDocError(data.id, data.name, data.error)
                  break
                case 'doc_progress':
                  callbacks.onDocProgress?.(data)
                  break
                case 'scan_complete':
                  callbacks.onScanComplete?.(data)
                  break
                case 'rag_query':
                  callbacks.onRagQuery?.(data)
                  break
                case 'comparison':
                  callbacks.onComparison?.(data)
                  break
                case 'aggregation':
                  callbacks.onAggregation(data)
                  break
                case 'error':
                  callbacks.onError(data.message)
                  break
                case 'done':
                  finish()
                  break
              }
            } catch {
              // ignore parse errors
            }
            eventType = ''
          }
        }
      }
      finish()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        console.error('Investigate stream error:', err)
        callbacks.onError(err.message || 'Connection failed')
      }
      callbacks.onDone()
    })

  return controller
}

// ============================================================================
// M&A API
// ============================================================================

export interface Deal {
  id: string
  name: string
  description?: string
  perspective: string
  dealType: string
  industry?: string
  status: string
  riskSummary?: string
  executiveSummary?: string
  warrantyCoverage?: string
  disclosureGaps?: string
  wniReadiness?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  parties?: DealParty[]
  documents?: DealDocumentSummary[]
  risks?: DealRisk[]
  warranties?: DealWarranty[]
  disclosures?: DealDisclosure[]
  checkpoints?: DealCheckpoint[]
  job?: DealJob
  _count?: { documents: number; risks: number; warranties: number; auditEvents: number }
}

export interface DealParty {
  id: string
  name: string
  role: string
  jurisdiction: string
  entityType?: string
  registeredIn?: string
  notes?: string
}

export interface DealDocumentSummary {
  id: string
  filename: string
  filesize: number
  mimetype: string
  docType?: string
  jurisdiction?: string
  language?: string
  confidence?: number
  textLength: number
  pageCount: number
  status: string
  partyId?: string
  createdAt: string
  _count?: { sections: number }
}

export interface DealRisk {
  id: string
  title: string
  description: string
  severity: string
  category: string
  jurisdiction?: string
  documentId?: string
  location?: string
  clauseText?: string
  verified: boolean
  statutoryBasis?: string
  humanOverride: boolean
  humanSeverity?: string
  humanNotes?: string
}

export interface DealWarranty {
  id: string
  name: string
  clauseText: string
  documentId?: string
  location?: string
  breadthScore?: number
  disclosureScore?: number
  exposureScore?: number
  wniScore?: number
  playbookPositions?: string
  redlineText?: string
}

export interface DealDisclosure {
  id: string
  warrantyName: string
  content: string
  status: string
  documentId?: string
  location?: string
  assessment?: string
}

export interface DealCheckpoint {
  id: string
  stage: string
  status: string
  proposal?: string
  feedback?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
}

export interface DealJob {
  currentStage: string
  stageProgress: string
  totalLLMCalls: number
  totalTokens: number
  totalDurationMs: number
  startedAt?: string
  pausedAt?: string
  completedAt?: string
}

export const maApi = {
  // Deals
  createDeal: (data: { name: string; description?: string; perspective?: string; dealType?: string; industry?: string }) =>
    api.post('/ma/deals', data) as Promise<Deal>,
  listDeals: () => api.get('/ma/deals') as Promise<Deal[]>,
  getDeal: (id: string) => api.get(`/ma/deals/${id}`) as Promise<Deal>,
  updateDeal: (id: string, data: Partial<Deal>) => api.put(`/ma/deals/${id}`, data),
  deleteDeal: (id: string) => api.delete(`/ma/deals/${id}`),

  // Parties
  addParty: (dealId: string, data: { name: string; role: string; jurisdiction: string; entityType?: string }) =>
    api.post(`/ma/deals/${dealId}/parties`, data) as Promise<DealParty>,
  updateParty: (dealId: string, partyId: string, data: Partial<DealParty>) =>
    api.put(`/ma/deals/${dealId}/parties/${partyId}`, data),
  deleteParty: (dealId: string, partyId: string) =>
    api.delete(`/ma/deals/${dealId}/parties/${partyId}`),

  // Documents
  uploadDocuments: async (dealId: string, files: File[], partyId?: string) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    if (partyId) formData.append('partyId', partyId)

    const response = await fetch(`${API_BASE}/api/ma/deals/${dealId}/documents`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }))
      throw new ApiError(err.error || 'Upload failed', response.status)
    }
    return response.json()
  },
  deleteDocument: (dealId: string, docId: string) =>
    api.delete(`/ma/deals/${dealId}/documents/${docId}`),

  // Pipeline control
  startPipeline: (dealId: string) => api.post(`/ma/deals/${dealId}/start`, {}),
  pausePipeline: (dealId: string) => api.post(`/ma/deals/${dealId}/pause`, {}),
  resumePipeline: (dealId: string) => api.post(`/ma/deals/${dealId}/resume`, {}),

  // Checkpoints
  approveCheckpoint: (dealId: string, checkpointId: string) =>
    api.post(`/ma/deals/${dealId}/checkpoints/${checkpointId}/approve`, {}),
  rejectCheckpoint: (dealId: string, checkpointId: string, feedback: string) =>
    api.post(`/ma/deals/${dealId}/checkpoints/${checkpointId}/reject`, { feedback }),

  // Risk override
  overrideRisk: (dealId: string, riskId: string, severity: string, notes?: string) =>
    api.put(`/ma/deals/${dealId}/risks/${riskId}`, { severity, notes }),

  // Playbook (on-demand per warranty)
  generatePlaybook: (dealId: string, warrantyId: string) =>
    api.post(`/ma/deals/${dealId}/warranties/${warrantyId}/playbook`, {}) as Promise<{ positions: PlaybookPosition[] }>,

  // Audit
  getAuditLog: (dealId: string, params?: { stage?: string; limit?: number }) =>
    api.get(`/ma/deals/${dealId}/audit${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`),

  // Export
  exportDeal: async (dealId: string, format: 'docx' | 'pdf' | 'csv') => {
    const token = localStorage.getItem('token')
    const res = await fetch(`${API_BASE}/api/ma/deals/${dealId}/export/${format}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ext = format === 'csv' ? 'csv' : format === 'pdf' ? 'pdf' : 'docx'
    a.download = `deal_report.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  },

  // Clone + cleanup
  cloneDeal: (dealId: string) => api.post(`/ma/deals/${dealId}/clone`, {}) as Promise<Deal>,
  cleanupFiles: (dealId: string) => api.delete(`/ma/deals/${dealId}/cleanup`) as Promise<{ success: boolean; freedBytes: number; freedMB: string }>,

  // Templates & Industries
  getTemplates: () => api.get('/ma/templates') as Promise<DealTemplate[]>,
  getIndustries: () => api.get('/ma/industries') as Promise<string[]>,

  // Scheduler
  getSchedulerStatus: () => api.get('/ma/scheduler/status'),
}

export interface DealTemplate {
  id: string
  name: string
  perspective: string
  dealType: string
  parties: { name: string; role: string; jurisdiction: string; entityType?: string }[]
}

export interface PlaybookPosition {
  level: string
  position: string
  rationale: string
  statutoryRef?: string
  redlineText?: string
}

// SSE stream for M&A pipeline
export function streamMaPipeline(
  dealId: string,
  callbacks: {
    onState?: (data: { stage: string; progress: Record<string, unknown>; dealStatus: string }) => void
    onStageStart?: (data: { stage: string; totalItems: number }) => void
    onStageComplete?: (data: { stage: string; [key: string]: unknown }) => void
    onDocClassified?: (data: { docId: string; docName: string; type: string; jurisdiction: string; confidence: number; estimatedSeconds?: number }) => void
    onDocAnalyzing?: (data: { docId: string; docName: string; chunk: number; totalChunks: number; estimatedSeconds?: number }) => void
    onDocAnalyzed?: (data: { docId: string; docName: string; clauseCount: number; riskCount: number; warrantyCount: number }) => void
    onDocIngested?: (data: { docId: string; textLength: number; sectionCount: number }) => void
    onRiskVerified?: (data: { riskId: string; title: string; verified: boolean; statutoryBasis?: string; adjustedSeverity?: string; estimatedSeconds?: number }) => void
    onSynthesisProgress?: (data: { substage: string; progress: number }) => void
    onCheckpoint?: (data: { stage: string; proposal: Record<string, unknown> }) => void
    onError?: (data: { message: string; stage?: string; recoverable?: boolean }) => void
    onPaused?: (data: { stage: string }) => void
    onDone?: (data: { totalDuration: number }) => void
  },
): AbortController {
  const controller = new AbortController()

  fetch(`${API_BASE}/api/ma/deals/${dealId}/stream`, {
    credentials: 'include',
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      callbacks.onError?.({ message: 'Failed to connect to pipeline stream' })
      return
    }
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventType = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6))
            switch (eventType) {
              case 'state': callbacks.onState?.(data); break
              case 'stage_start': callbacks.onStageStart?.(data); break
              case 'stage_complete': callbacks.onStageComplete?.(data); break
              case 'doc_classified': callbacks.onDocClassified?.(data); break
              case 'doc_analyzing': callbacks.onDocAnalyzing?.(data); break
              case 'doc_analyzed': callbacks.onDocAnalyzed?.(data); break
              case 'doc_ingested': callbacks.onDocIngested?.(data); break
              case 'risk_verified': callbacks.onRiskVerified?.(data); break
              case 'synthesis_progress': callbacks.onSynthesisProgress?.(data); break
              case 'checkpoint': callbacks.onCheckpoint?.(data); break
              case 'error': callbacks.onError?.(data); break
              case 'paused': callbacks.onPaused?.(data); break
              case 'done': callbacks.onDone?.(data); break
            }
          } catch { /* ignore */ }
          eventType = ''
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      callbacks.onError?.({ message: err.message || 'Stream connection failed' })
    }
  })

  return controller
}

// SSE streaming for research chat
export function streamChat(
  conversationId: string,
  message: string,
  jurisdictions: string[],
  onChunk: (text: string) => void,
  onSources: (sources: unknown[]) => void,
  onDone: () => void,
  onContentReplace?: (content: string) => void,
  onVerification?: (result: VerificationResult) => void,
  onStatus?: (status: string) => void,
  file?: File,
  options?: { sourceOffset?: number, onRemainingSources?: (data: { remaining: number, nextOffset: number, total: number }) => void },
): AbortController {
  const controller = new AbortController()

  // Build FormData to support optional file attachment
  const formData = new FormData()
  formData.append('conversationId', conversationId)
  formData.append('message', message)
  formData.append('jurisdictions', JSON.stringify(jurisdictions))
  formData.append('ragOnly', localStorage.getItem('ragOnly') === 'true' ? 'true' : 'false')
  if (file) {
    formData.append('file', file)
  }
  if (options?.sourceOffset) {
    formData.append('sourceOffset', String(options.sourceOffset))
  }

  fetch(`${API_BASE}/api/research/chat/stream`, {
    method: 'POST',
    headers: {
      // No Content-Type — browser sets multipart boundary automatically for FormData
    },
    credentials: 'include',
    body: formData,
    signal: controller.signal,
  }).then(async (response) => {
    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (currentEvent === 'token') {
              onChunk(data.token || data.text || data.content || '')
            } else if (currentEvent === 'content') {
              // Post-NLI verified content replaces streamed tokens
              if (onContentReplace && data.content) {
                onContentReplace(data.content)
              }
            } else if (currentEvent === 'verification') {
              if (onVerification) {
                onVerification(data as VerificationResult)
              }
            } else if (currentEvent === 'sources') {
              onSources(data.sources || [])
              // If totalSourceCount is present, compute remaining sources
              if (data.totalSourceCount && data.totalSourceCount > (data.sources || []).length && options?.onRemainingSources) {
                const nextOff = (data.sourceOffset || 0) + (data.sources || []).length
                const rem = data.totalSourceCount - nextOff
                if (rem > 0) {
                  options.onRemainingSources({ remaining: rem, nextOffset: nextOff, total: data.totalSourceCount })
                }
              }
            } else if (currentEvent === 'status') {
              if (onStatus && data.message) {
                onStatus(data.message)
              }
            } else if (currentEvent === 'remaining_sources') {
              if (options?.onRemainingSources) {
                options.onRemainingSources(data)
              }
            } else if (currentEvent === 'done' || currentEvent === 'complete') {
              // Extract remaining sources from complete event as backup
              if (data.remainingSources && options?.onRemainingSources) {
                options.onRemainingSources(data.remainingSources)
              }
            } else if (data.text || data.content) {
              onChunk(data.text || data.content || '')
            } else if (data.sources) {
              onSources(data.sources)
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
    onDone()
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      console.error('Stream chat error:', err)
    }
    onDone()
  })

  return controller
}
