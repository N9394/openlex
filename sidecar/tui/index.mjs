/**
 * Entry point of the terminal app (`openlex` with no arguments, or
 * `openlex tui`). Full screen in the terminal's alternate screen, so the
 * shell's scrollback is left as it was when the app quits. An engine this
 * app started in the background is stopped again on quit (frees memory);
 * OPENLEX_KEEP_ENGINE=1 leaves it running.
 */

import { render } from 'ink'
import { html } from './ui.mjs'
import { App } from './app.mjs'
import { createApi, client, log } from './api.mjs'

export async function run({ stdout = process.stdout, stdin = process.stdin } = {}) {
  const alt = stdout.isTTY && process.env.OPENLEX_NO_ALT_SCREEN !== '1'
  const restore = () => { if (alt) stdout.write('\x1b[?1049l\x1b[?25h') }
  if (alt) stdout.write('\x1b[?1049h\x1b[H')
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

  const app = render(html`<${App} api=${api} />`, { stdout, stdin, exitOnCtrlC: true, patchConsole: true })
  await app.waitUntilExit()
  restore()
  if (started && process.env.OPENLEX_KEEP_ENGINE !== '1') client.stopEngine()
}
