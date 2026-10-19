import { useEffect, useState } from 'react'
import { Database, CheckCircle, AlertTriangle, X, Loader2 } from 'lucide-react'

// Mirrors the events emitted by pack-fetcher.js → main.js → webContents.send('lexvault:pack-event').
type PackEvent =
  | { kind: 'no-entitlements' }
  | { kind: 'pack-up-to-date'; code: string; version: string }
  | { kind: 'pack-download-start'; code: string; version: string }
  | { kind: 'pack-download-progress'; code: string; version: string; pct: number }
  | { kind: 'pack-download-done'; code: string; version: string }
  | { kind: 'pack-ingest-start'; code: string; version: string }
  | { kind: 'pack-ingest-done'; code: string; version: string; chunk_count: number }
  | { kind: 'pack-error'; code: string; version: string; error: string }
  | { kind: 'sync-complete'; synced: number; skipped: number; failed: number }

const JURISDICTION_NAMES: Record<string, string> = {
  AT: 'Austria', DE: 'Germany', SK: 'Slovakia', CZ: 'Czech Republic',
  RO: 'Romania', CY: 'Cyprus', UK: 'United Kingdom', US: 'United States',
  'US-CA': 'California', ZA: 'South Africa', GR: 'Greece', FR: 'France',
}

function prettyName(code: string) {
  return JURISDICTION_NAMES[code] || code
}

export default function PackBanner() {
  const [state, setState] = useState<PackEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // Auto-clear "ready" banner after a few seconds so it doesn't linger.
  const [autoHide, setAutoHide] = useState(false)

  useEffect(() => {
    const w = window as any
    if (!w.lexvault?.onPackEvent) return
    w.lexvault.onPackEvent((payload: PackEvent) => {
      setDismissed(false)
      setAutoHide(false)
      setState(payload)
      if (payload.kind === 'pack-ingest-done' || payload.kind === 'sync-complete') {
        // Self-dismiss success banners after 6 seconds.
        setTimeout(() => setAutoHide(true), 6000)
      }
    })
  }, [])

  const isElectron = typeof window !== 'undefined' && (window as any).lexvault?.isElectron
  if (!isElectron) return null
  if (!state || dismissed || autoHide) return null
  // Suppress the quietest no-op events so the corner doesn't blink.
  if (state.kind === 'no-entitlements') return null
  if (state.kind === 'pack-up-to-date') return null
  if (state.kind === 'pack-download-done') return null  // covered by the next ingest-start
  if (state.kind === 'sync-complete' && state.synced === 0 && state.failed === 0) return null

  let body: React.ReactNode = null
  let tone = 'bg-tobacco/30 border-tobacco/60'

  if (state.kind === 'pack-download-start') {
    body = (
      <span className="flex items-center gap-2">
        <Database size={16} className="text-accent" />
        Downloading {prettyName(state.code)} legal database — preparing…
      </span>
    )
  } else if (state.kind === 'pack-download-progress') {
    body = (
      <span className="flex items-center gap-2 w-full">
        <Database size={16} className="text-accent" />
        Downloading {prettyName(state.code)} legal database — {state.pct}%
        <span className="ml-2 inline-block w-32 h-1.5 bg-obsidian/40 rounded overflow-hidden">
          <span className="block h-full bg-accent transition-all" style={{ width: `${state.pct}%` }} />
        </span>
      </span>
    )
  } else if (state.kind === 'pack-ingest-start') {
    body = (
      <span className="flex items-center gap-2">
        <Loader2 size={16} className="text-accent animate-spin" />
        Indexing {prettyName(state.code)} legal database — your research will use it shortly.
      </span>
    )
  } else if (state.kind === 'pack-ingest-done') {
    tone = 'bg-forest/20 border-forest/60'
    body = (
      <span className="flex items-center gap-2">
        <CheckCircle size={16} className="text-forest" />
        {prettyName(state.code)} ready — {state.chunk_count.toLocaleString()} legal sections indexed.
      </span>
    )
  } else if (state.kind === 'pack-error') {
    tone = 'bg-red-900/30 border-red-700/60'
    body = (
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-400" />
        {prettyName(state.code)} download failed: {state.error}
      </span>
    )
  } else if (state.kind === 'sync-complete') {
    tone = 'bg-forest/20 border-forest/60'
    body = (
      <span className="flex items-center gap-2">
        <CheckCircle size={16} className="text-forest" />
        Legal databases ready — {state.synced} updated, {state.skipped} already current
        {state.failed > 0 ? `, ${state.failed} failed` : ''}.
      </span>
    )
  }

  if (!body) return null

  // Bottom-right corner, stacked above the UpdateBanner with a different
  // y-offset so the two never overlap when both fire on the same boot.
  return (
    <div
      className={`fixed bottom-16 right-4 z-50 max-w-md flex items-center gap-3 px-4 py-2 border rounded-lg shadow-lg backdrop-blur ${tone} text-cream text-sm`}
    >
      {body}
      {(state.kind === 'pack-ingest-done' ||
        state.kind === 'pack-error' ||
        state.kind === 'sync-complete') && (
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
