import { useEffect, useState } from 'react'
import { RefreshCw, Download, CheckCircle, AlertTriangle, X } from 'lucide-react'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; remoteVersion: string; localVersion: string }
  | { kind: 'downloading'; remoteVersion: string; pct: number; received: number; total: number }
  | { kind: 'ready'; remoteVersion: string }
  | { kind: 'installing'; remoteVersion: string }
  | { kind: 'error'; error: string }

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const w = window as any
    if (!w.lexvault?.onUpdateEvent) return
    w.lexvault.onUpdateEvent((payload: UpdateState) => {
      setState(payload)
      // Reset dismissed flag on a fresh cycle so a new update doesn't stay hidden.
      if (payload.kind === 'available' || payload.kind === 'downloading') setDismissed(false)
    })
  }, [])

  const isElectron = typeof window !== 'undefined' && (window as any).lexvault?.isElectron
  if (!isElectron) return null
  if (dismissed) return null
  // Idle / checking transient states get suppressed unless something happens
  // that requires the user's attention. Keep it quiet most of the time.
  if (state.kind === 'idle') return null
  if (state.kind === 'checking') return null

  const restart = async () => {
    try { await (window as any).lexvault.installPendingUpdate() } catch {}
  }

  let body: React.ReactNode = null
  let tone = 'bg-tobacco/30 border-tobacco/60'
  if (state.kind === 'available') {
    body = (
      <span className="flex items-center gap-2">
        <Download size={16} className="text-accent" />
        Update available — OpenLex {state.remoteVersion}. Downloading…
      </span>
    )
  } else if (state.kind === 'downloading') {
    body = (
      <span className="flex items-center gap-2 w-full">
        <Download size={16} className="text-accent" />
        Downloading {state.remoteVersion} — {state.pct}%{' '}
        ({(state.received / 1e6).toFixed(1)} / {(state.total / 1e6).toFixed(1)} MB)
        <span className="ml-2 inline-block w-32 h-1.5 bg-obsidian/40 rounded overflow-hidden">
          <span className="block h-full bg-accent transition-all" style={{ width: `${state.pct}%` }} />
        </span>
      </span>
    )
  } else if (state.kind === 'ready') {
    tone = 'bg-forest/20 border-forest/60'
    body = (
      <span className="flex items-center gap-2">
        <CheckCircle size={16} className="text-forest" />
        Update {state.remoteVersion} downloaded.
        <button
          onClick={restart}
          className="ml-2 px-3 py-1 bg-forest text-obsidian rounded text-xs font-medium hover:opacity-90"
        >
          Restart now
        </button>
      </span>
    )
  } else if (state.kind === 'installing') {
    tone = 'bg-forest/20 border-forest/60'
    body = (
      <span className="flex items-center gap-2">
        <RefreshCw size={16} className="text-forest animate-spin" />
        Installing {state.remoteVersion} — OpenLex will restart…
      </span>
    )
  } else if (state.kind === 'error') {
    tone = 'bg-red-900/30 border-red-700/60'
    body = (
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-400" />
        Update failed: {state.error}
      </span>
    )
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-md flex items-center gap-3 px-4 py-2 border rounded-lg shadow-lg backdrop-blur ${tone} text-cream text-sm`}
    >
      {body}
      {state.kind !== 'installing' && state.kind !== 'downloading' && state.kind !== 'available' && (
        <button
          onClick={() => setDismissed(true)}
          className="text-antique hover:text-cream"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
