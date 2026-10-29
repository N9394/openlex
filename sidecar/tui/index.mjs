/**
 * Entry point of the terminal app (`openlex` with no arguments, or
 * `openlex tui`). Full screen in the terminal's alternate screen (no mouse
 * capture: selecting text with the mouse keeps working), so the shell's
 * scrollback is left as it was when the app quits; /transcript prints the
 * conversation there on the way out. An engine this app started in the
 * background is stopped again on quit (frees memory);
 * OPENLEX_KEEP_ENGINE=1 leaves it running.
 *
 * Drawing: at most 30 frames a second, only the lines that changed
 * (OPENLEX_FULL_REPAINT=1 redraws everything — for terminals that garble
 * partial updates). Accessible mode (theme.mjs) tells Ink a screen reader
 * is in use and skips the alternate screen.
 */

import { render } from 'ink'
import { html, look, configure } from './ui.mjs'
import { App } from './app.mjs'
import { createApi, client, log, loadPrefs } from './api.mjs'
import { onExit } from './clip.mjs'

/** @param {{ folder?: string|null }} opts  folder: the working folder (--folder or the current folder) */
export async function run({ stdout = process.stdout, stdin = process.stdin, folder = null } = {}) {
  configure(loadPrefs(), { tty: !!stdout.isTTY })
  const alt = stdout.isTTY && process.env.OPENLEX_NO_ALT_SCREEN !== '1' && !look.accessible
  // Bracketed paste: a pasted block (or dropped files) arrives marked, so
  // its line breaks never send the question half-typed (ui.mjs TextField).
  const restore = () => { if (stdout.isTTY) stdout.write('\x1b[?2004l'); if (alt) stdout.write('\x1b[?1049l\x1b[?25h') }
  if (alt) stdout.write('\x1b[?1049h\x1b[H')
  if (stdout.isTTY) stdout.write('\x1b[?2004h')
  process.on('exit', restore)
  // Anything unexpected goes to the log, never a stack trace on screen.
  const onCrash = (err) => {
    log('unexpected error:', err)
    restore()
    process.stderr.write(`openlex: something went wrong (${String(err?.message || err).split('\n')[0]}). Details: ~/.lexvault/logs/tui.log\n`)
    process.exit(1)
  }
  process.on('uncaughtException', onCrash)
  process.on('unhandledRejection', onCrash)

  client.setClientName('tui')
  const api = createApi()
  let started = false
  const ensure = api.ensureEngine
  api.ensureEngine = async (opts) => { const r = await ensure(opts); started = started || r.started; return r }
  const stopStarted = () => { if (started && process.env.OPENLEX_KEEP_ENGINE !== '1') client.stopEngine() }
  // Terminal window closed (Windows: the console's close button) instead of quitting.
  process.on('SIGHUP', () => { stopStarted(); process.exit(129) })

  const app = render(html`<${App} api=${api} folder=${folder} />`, {
    stdout, stdin,
    // Ctrl+C is handled by the app: it stops a running answer first; twice quits.
    exitOnCtrlC: false,
    patchConsole: true,
    maxFps: 30,
    incrementalRendering: process.env.OPENLEX_FULL_REPAINT !== '1',
    isScreenReaderEnabled: look.accessible,
  })
  await app.waitUntilExit()
  restore()
  if (onExit.lines?.length) stdout.write(`${onExit.lines.join('\n')}\n`)
  stopStarted()
}
