// OpenLex hub — offline link between the desktop App and the Word plugin.
// The Electron preload exposes window.lexvault.hub (main/hub-client.js);
// in a plain browser build it doesn't exist and everything here is a no-op.
import { useEffect, useState } from 'react'

export interface HubEvent {
  id?: string
  type: 'insert-text' | 'open-in-app' | 'provider-changed' | 'policy-changed' | 'matter-changed' | 'hello'
  from?: string
  data?: { text?: string; view?: string; query?: string; docId?: string | null; matterId?: string | null }
}

interface HubBridge {
  status: () => Promise<{ connected: boolean }>
  sendToWord: (text: string, meta?: Record<string, unknown>) => Promise<{ ok: boolean }>
  onEvent: (cb: (ev: HubEvent) => void) => void
  onStatus: (cb: (st: { connected: boolean }) => void) => void
}

export function hubBridge(): HubBridge | null {
  if (typeof window === 'undefined') return null
  return ((window as any).lexvault?.hub as HubBridge) || null
}

/** Is the Word plugin reachable right now? Updates live. */
export function useWordLink() {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const hub = hubBridge()
    if (!hub) return
    let alive = true
    hub.status().then((st) => { if (alive) setConnected(!!st?.connected) }).catch(() => {})
    hub.onStatus((st) => { if (alive) setConnected(!!st?.connected) })
    return () => { alive = false }
  }, [])
  return {
    connected,
    sendToWord: async (text: string, meta?: Record<string, unknown>) => {
      const hub = hubBridge()
      if (!hub) throw new Error('Word link is only available in the desktop app')
      return hub.sendToWord(text, meta)
    },
  }
}
