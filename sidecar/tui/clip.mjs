/**
 * Getting an answer out of the terminal app: copy it (the terminal's own
 * clipboard sequence, OSC 52, plus the system's copy program where there
 * is one), and print the conversation into the normal terminal window when
 * the app quits (/transcript), so it can be scrolled, selected and saved.
 */

import { spawn } from 'node:child_process'

/** Lines to print after leaving the full screen (index.mjs). */
export const onExit = { lines: null }

/** The system's copy program: pbcopy (macOS), clip (Windows), wl-copy or xclip (Linux). */
function copier(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['pbcopy', []]
  if (platform === 'win32') return ['clip', []]
  if (env.WAYLAND_DISPLAY) return ['wl-copy', []]
  if (env.DISPLAY) return ['xclip', ['-selection', 'clipboard']]
  return null
}

/**
 * Copy text. Writes OSC 52 to the terminal (works over SSH too) and feeds
 * the system's copy program when there is one. Resolves true when either
 * way was available.
 */
export function copyText(text, { stdout = process.stdout, run = spawn, platform = process.platform, env = process.env } = {}) {
  const s = String(text || '')
  let any = false
  if (stdout?.isTTY) {
    try { stdout.write(`\x1b]52;c;${Buffer.from(s, 'utf8').toString('base64')}\x07`); any = true } catch { /* closed */ }
  }
  const c = copier(platform, env)
  if (!c) return Promise.resolve(any)
  return new Promise((resolve) => {
    try {
      const p = run(c[0], c[1], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
      p.on('error', () => resolve(any))
      p.on('close', (code) => resolve(any || code === 0))
      p.stdin.end(s)
    } catch { resolve(any) }
  })
}
