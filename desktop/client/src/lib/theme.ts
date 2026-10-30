// Colours (same as this computer / light / dark) and text size (S / M / L).
// Kept in this computer's browser storage: a per-person convenience.
export type ThemePref = 'system' | 'light' | 'dark'
export type TextSize = 's' | 'm' | 'l'

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window */ } }

export const themePref = (): ThemePref => { const v = get('theme'); return v === 'light' || v === 'dark' ? v : 'system' }
export const textSize = (): TextSize => { const v = get('openlex-text-size'); return v === 's' || v === 'l' ? v : 'm' }

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)

function paint() {
  const p = themePref()
  const dark = p === 'dark' || (p === 'system' && !!media()?.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.fontSize = { s: '14px', m: '16px', l: '18px' }[textSize()]
}

export function setThemePref(p: ThemePref) { set('theme', p); paint() }
export function setTextSize(s: TextSize) { set('openlex-text-size', s); paint() }

let started = false
/** Once, at start: paint, and follow the computer when "same as this computer" is chosen. */
export function initTheme() {
  paint()
  if (started) return
  started = true
  media()?.addEventListener?.('change', paint)
}
