// The window's width, for layouts that change with it (sidebar collapses
// below 1100 px, the conversation list becomes an overlay below 1280 px).
import { useEffect, useState } from 'react'

export function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

export const NARROW_APP = 1100 // below: the app sidebar shows icons only
export const NARROW_CHAT = 1280 // below: the conversation list opens over the chat

export function useWindowHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return h
}
