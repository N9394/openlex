/**
 * The terminal app: starts the engine if needed, then moves between screens
 * (setup, tour, folder check, home, matter, actions, settings, help) on a
 * simple stack — Enter goes forward, Esc goes back (Esc never quits).
 * Everything a screen needs comes from the app context: the engine calls,
 * what is set up, the working folder, and navigation.
 *
 * Keys that work everywhere: ? help (when nothing is typed), Ctrl+C stops
 * a running answer — a second Ctrl+C within two seconds quits (the footer
 * says so) — and Ctrl+L redraws the screen.
 *
 * The working folder: `openlex` started in ~/Clients/Alpine works there
 * (`--folder` or /folder change it). The whole home folder or the whole
 * computer must be confirmed first; the first time OpenLex works in a
 * folder it says that it can read the files there (folder.mjs).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { html, Frame, Spinner, Note, color, sym, configure } from './ui.mjs'
import { createApi, describeModel, describeRule, needsSetup, loadPrefs, savePrefs, log, friendly } from './api.mjs'
import { Setup } from './setup.mjs'
import { Home, NewMatter } from './home.mjs'
import { Matter } from './matter.mjs'
import { Action } from './actions.mjs'
import { Settings } from './settings.mjs'
import { RecentActivity } from './activity.mjs'
import { RecordView } from './record.mjs'
import { Tour } from './tour.mjs'
import { FolderCheck } from './folder.mjs'
import { AppContext, useAppCtx, TypingContext } from './context.mjs'

export { AppContext, useAppCtx, TypingContext }

const HUB_REFRESH = new Set(['provider-changed', 'policy-changed', 'matter-changed', 'permissions-changed'])

const SCREENS = { setup: Setup, home: Home, newMatter: NewMatter, matter: Matter, action: Action, settings: Settings, help: Help, activity: RecentActivity, record: RecordView, tour: Tour, folderCheck: FolderCheck }

/**
 * @param {{ api?, folder?: string|null, startTimeoutMs?: number }} props
 *   folder: the folder the app was started in (index.mjs: --folder or the current folder); null = none.
 */
export function App({ api: apiIn, folder: startFolder = null, startTimeoutMs = 20000 }) {
  const api = useRef(apiIn || createApi()).current
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [phase, setPhase] = useState('starting') // starting | waiting | ready | failed
  const [error, setError] = useState(null)
  const [info, setInfo] = useState({})
  const [stack, setStack] = useState([])
  const [prefs, setPrefsState] = useState(() => { const p = loadPrefs(); configure(p, { tty: !!stdout?.isTTY }); return p })
  const [hubTick, setHubTick] = useState(0)
  const [folder, setFolderState] = useState(null) // { path, short, documents, confirmed }
  const [quitArmed, setQuitArmed] = useState(false)
  const [, setRedraw] = useState(0)
  const typing = useRef(0)
  const interrupt = useRef(null) // a running answer registers how to stop it (Ctrl+C)
  const armTimer = useRef(null)

  const refresh = useCallback(async () => {
    const [status, providers, policy, agents] = await Promise.all([
      api.status().catch((err) => { log('status:', err); return null }),
      api.providers().catch((err) => { log('providers:', err); return null }),
      api.policy().catch((err) => { log('policy:', err); return null }),
      api.agents().catch(() => ({ agents: [] })),
    ])
    const next = { status, providers, policy, agents: (agents?.agents || []).filter((a) => !a.error) }
    setInfo(next)
    return next
  }, [api])

  /** Look at a folder before working in it: { ok, path, short, broad, documents, error }. */
  const inspectFolder = useCallback(async (p) => {
    if (!p) return { ok: false, error: 'No folder given.' }
    try { return await api.folderInfo(p) } catch (err) { return { ok: false, error: err.message } }
  }, [api])

  /** What comes after setup and the tour: the folder check (when needed) or the matters. */
  const firstScreen = useCallback(async (p = loadPrefs()) => {
    if (!startFolder) return { name: 'home', props: {} }
    const f = await inspectFolder(startFolder)
    if (!f.ok) return { name: 'home', props: { note: { kind: 'warn', text: `Not working in a folder: ${f.error}` } } }
    const known = (p.folders || {})[f.path]
    if (known === 'forbidden') return { name: 'home', props: { note: { kind: 'info', text: `You asked OpenLex not to read ${f.short}. /folder chooses another folder.` } } }
    if (f.broad) return { name: 'folderCheck', props: { info: f, reason: 'broad' } }
    if (known !== 'ok') return { name: 'folderCheck', props: { info: f, reason: 'new' } }
    setFolderState({ path: f.path, short: f.short, documents: f.documents })
    return { name: 'home', props: {} }
  }, [startFolder, inspectFolder])

  const start = useCallback(async () => {
    setPhase('starting')
    setError(null)
    try {
      await api.ensureEngine({ timeoutMs: startTimeoutMs, onWaiting: () => setPhase('waiting') })
      const i = await refresh()
      const p = loadPrefs()
      setStack([needsSetup(i, p) ? { name: 'setup', props: { firstRun: true } } : await firstScreen(p)])
      setPhase('ready')
    } catch (err) {
      log('engine start failed:', err)
      setError(friendly(err))
      setPhase('failed')
    }
  }, [api, refresh, startTimeoutMs, firstScreen])

  useEffect(() => { start() }, [])

  // Another front end (Word, the CLI, the desktop app) changed the model,
  // a key, the client-data rule, a matter or the permissions: refresh the
  // status bar at once.
  useEffect(() => {
    if (phase !== 'ready') return undefined
    const ac = new AbortController()
    api.followHub?.((ev) => {
      if (!HUB_REFRESH.has(ev.type)) return
      refresh().catch(() => {})
      setHubTick((t) => t + 1)
    }, ac.signal).catch((err) => log('hub:', err))
    return () => ac.abort()
  }, [phase])

  const setPrefs = (patch) => {
    const next = savePrefs(patch)
    configure(next, { tty: !!stdout?.isTTY })
    setPrefsState(next)
    return next
  }

  const ctx = {
    api,
    info,
    refresh,
    /** Bumps when another front end changed something (screens reload what they show). */
    hubTick,
    prefs,
    setPrefs,
    go: (name, props = {}) => setStack((s) => [...s, { name, props }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (name, props = {}) => setStack((s) => [...s.slice(0, -1), { name, props }]),
    home: () => setStack([{ name: 'home', props: {} }]),
    quit: () => exit(),
    openHelp: () => setStack((s) => (s[s.length - 1]?.name === 'help' ? s : [...s, { name: 'help', props: {} }])),
    /** After the first-run setup: the tour (once), then the folder check or the matters. */
    afterSetup: async () => {
      if (!loadPrefs().tourDone) return setStack([{ name: 'tour', props: { firstRun: true } }])
      setStack([await firstScreen()])
    },
    afterTour: async () => setStack([await firstScreen()]),
    // ── the working folder ──
    folder,
    inspectFolder,
    /** Work in a folder (already inspected and, if broad, confirmed); remembered as known. */
    useFolder: (f, { confirmed = false } = {}) => {
      if (!f) { setFolderState(null); return }
      setFolderState({ path: f.path, short: f.short, documents: f.documents, confirmed: confirmed || !!f.broad })
      if (!f.broad) setPrefs({ folders: { ...(loadPrefs().folders || {}), [f.path]: 'ok' } })
    },
    /** Don't let OpenLex read a folder: a deny rule for everything in it, remembered. */
    forbidFolder: async (f) => {
      setFolderState(null)
      setPrefs({ folders: { ...(loadPrefs().folders || {}), [f.path]: 'forbidden' } })
      await api.permissionRule('deny', `*:${f.short}/**`).catch((err) => log('deny folder:', err))
    },
    /** What chat and action requests carry for the working folder. */
    folderBody: () => (folder ? { folder: folder.path, ...(folder.confirmed ? { folderConfirmed: true } : {}) } : {}),
    // ── keys that work everywhere ──
    interrupt,
    quitArmed,
    /** Status-bar lines for a screen (matter optional). */
    status: (matter, agentTitle, extra = {}) => ({
      matter: matter ? `${matter.title}${matter.privileged ? `  ${sym.lock}` : ''}` : 'none',
      folder: folder?.short || '',
      model: describeModel(info),
      data: describeRule(matter ? matter.policy || info.policy?.default : info.policy?.default, matter),
      agent: agentTitle,
      ...extra,
    }),
  }

  const top = stack[stack.length - 1]
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      // A running answer stops first; then a second Ctrl+C quits.
      if (interrupt.current && interrupt.current()) return
      if (quitArmed) return exit()
      setQuitArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setQuitArmed(false), 2000)
      armTimer.current.unref?.()
      return
    }
    if (key.ctrl && input === 'l') { if (stdout?.isTTY) stdout.write('\x1b[2J\x1b[H'); return setRedraw((x) => x + 1) }
    if (phase === 'failed' && key.return) start()
    if (input === '?' && phase === 'ready' && !typing.current && top?.name !== 'help') ctx.openHelp()
  })
  useEffect(() => () => clearTimeout(armTimer.current), [])

  let body
  if (phase !== 'ready') {
    body = html`<${Frame} title="Starting" status=${{}} keys="Enter try again">
      ${phase === 'failed'
        ? html`<${Box} flexDirection="column">
            <${Note} kind="bad">${error}<//>
            <${Text} dimColor>Details are in ~/.lexvault/logs/tui.log and engine.log. Press Enter to try again.<//>
          <//>`
        : html`<${Spinner} label=${phase === 'waiting' ? 'Starting OpenLex in the background… (a few seconds the first time)' : 'Connecting to OpenLex…'} />`}
    <//>`
  } else {
    const Screen = SCREENS[top.name] || Home
    body = html`<${Screen} key=${stack.length + top.name} ...${top.props} />`
  }
  return html`<${AppContext.Provider} value=${ctx}><${TypingContext.Provider} value=${typing}>${body}<//><//>`
}

/**
 * Help (the "?" key), grouped by what you want to do; on a second page
 * what OpenLex is doing while it works and why (→ or Tab). t: the tour.
 */
export function Help() {
  const ctx = useAppCtx()
  const [page, setPage] = useState(0)
  useInput((input, key) => {
    if (key.rightArrow || key.tab || key.leftArrow) return setPage((p) => (p ? 0 : 1))
    if (input === 't') return ctx.replace('tour', {})
    if (key.escape || key.return || input === 'q' || input === '?') ctx.back()
  })
  const row = (k, what) => html`<${Box} key=${k}><${Box} width=${12} flexShrink=${0}><${Text} color=${color.accent} bold>${k}<//><//><${Text} wrap="truncate-end">${what}<//><//>`
  const head = (t) => html`<${Text} key=${t} bold>${t}<//>`
  const keys = `→ ${page ? 'keys' : 'what OpenLex is doing'} ${sym.sep} t tour ${sym.sep} Esc back`
  if (page === 1) {
    const point = (k, what) => html`<${Box} key=${k}><${Box} width=${2} flexShrink=${0}><${Text} color=${color.accent}>${sym.bullet}<//><//><${Box} flexGrow=${1}><${Text} wrap="wrap">${what}<//><//><//>`
    return html`<${Frame} title="What OpenLex is doing and why" crumbs=${['Help']} status=${ctx.status()} keys=${keys}>
      <${Box} flexDirection="column">
        ${point(1, 'While it works you see each step in plain words — what it reads, what it searches — and how long it has taken.')}
        ${point(2, 'It reads your documents and searches the law on this computer first.')}
        ${point(3, '"Sent to:" names every AI service outside this computer that got your question or documents, and whether names were hidden. "Stayed on this computer" means nothing left.')}
        ${point(4, '"Looked up online" means only search words or a web address went to a public law database (RIS, EUR-Lex) or a website.')}
        ${point(5, '"Based on:" lists the law and the passages the answer used. Ctrl+B shows them in full. Check them before relying on the answer.')}
        ${point(6, 'Each proposed change says whether it was checked. "Could not be verified" means: review it yourself.')}
        ${point(7, 'Esc stops at any time. What was written so far is kept; nothing more is sent.')}
        ${point(8, 'Recent activity (matter menu) lists each request: what was asked, looked at and sent. /record: the AI record, to show a client.')}
      <//>
    <//>`
  }
  // Fits 80×24: grouped by task, short lines.
  return html`<${Frame} title="Help" status=${ctx.status()} keys=${keys}>
    <${Box} flexDirection="column">
      ${head('Ask a question')}
      ${row('Enter', 'send · Ctrl+J a new line · ↑ your earlier questions')}
      ${row('Esc', 'stop the answer (what is written is kept) · go back')}
      ${row('Ctrl+B', 'what the last answer is based on, in full')}
      ${row('Ctrl+K', 'all actions and commands (/model /data /folder …)')}
      ${head('Work with files')}
      ${row('/folder', 'the folder OpenLex works in: it reads there, asks before changing')}
      ${row('drag files', 'into the question to ask about them, or Add documents')}
      ${row('/save /copy', 'save the last answer in the folder · copy it')}
      ${head('Move around')}
      ${row('↑ ↓  1-9', 'move through a list · pick a numbered choice')}
      ${row('PgUp PgDn', `scroll the conversation${process.platform === 'darwin' ? ' (Fn+↑ / Fn+↓ on a Mac)' : ''}`)}
      ${row('Ctrl+C', 'stop · twice: quit       ? this help (when nothing is typed)')}
    <//>
  <//>`
}

export default App
