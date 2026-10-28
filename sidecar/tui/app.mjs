/**
 * The terminal app: starts the engine if needed, then moves between screens
 * (setup, home, matter, actions, settings, help) on a simple stack — Enter
 * goes forward, Esc goes back. Everything a screen needs comes from the
 * app context: the engine calls, what is set up, and navigation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { html, Frame, Spinner, Note, color, sym } from './ui.mjs'
import { createApi, describeModel, describeRule, needsSetup, loadPrefs, savePrefs, log, friendly } from './api.mjs'
import { Setup } from './setup.mjs'
import { Home, NewMatter } from './home.mjs'
import { Matter } from './matter.mjs'
import { Action } from './actions.mjs'
import { Settings } from './settings.mjs'
import { RecentActivity } from './activity.mjs'
import { AppContext, useAppCtx, TypingContext } from './context.mjs'

export { AppContext, useAppCtx, TypingContext }

const HUB_REFRESH = new Set(['provider-changed', 'policy-changed', 'matter-changed', 'permissions-changed'])

const SCREENS = { setup: Setup, home: Home, newMatter: NewMatter, matter: Matter, action: Action, settings: Settings, help: Help, activity: RecentActivity }

export function App({ api: apiIn, startTimeoutMs = 20000 }) {
  const api = useRef(apiIn || createApi()).current
  const { exit } = useApp()
  const [phase, setPhase] = useState('starting') // starting | waiting | ready | failed
  const [error, setError] = useState(null)
  const [info, setInfo] = useState({})
  const [stack, setStack] = useState([])
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [hubTick, setHubTick] = useState(0)
  const typing = useRef(0)

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

  const start = useCallback(async () => {
    setPhase('starting')
    setError(null)
    try {
      await api.ensureEngine({ timeoutMs: startTimeoutMs, onWaiting: () => setPhase('waiting') })
      const i = await refresh()
      setStack([{ name: needsSetup(i, loadPrefs()) ? 'setup' : 'home', props: { firstRun: true } }])
      setPhase('ready')
    } catch (err) {
      log('engine start failed:', err)
      setError(friendly(err))
      setPhase('failed')
    }
  }, [api, refresh, startTimeoutMs])

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

  const ctx = {
    api,
    info,
    refresh,
    /** Bumps when another front end changed something (screens reload what they show). */
    hubTick,
    prefs,
    setPrefs: (patch) => setPrefsState(savePrefs(patch)),
    go: (name, props = {}) => setStack((s) => [...s, { name, props }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (name, props = {}) => setStack((s) => [...s.slice(0, -1), { name, props }]),
    home: () => setStack([{ name: 'home', props: {} }]),
    quit: () => exit(),
    /** Status-bar lines for a screen (matter optional). */
    status: (matter, agentTitle) => ({
      matter: matter ? `${matter.title}${matter.privileged ? `  ${sym.lock}` : ''}` : 'none',
      model: describeModel(info),
      data: describeRule(matter ? matter.policy || info.policy?.default : info.policy?.default, matter),
      agent: agentTitle,
    }),
  }

  const top = stack[stack.length - 1]
  useInput((input, key) => {
    if (phase === 'failed' && key.return) start()
    if (input === '?' && phase === 'ready' && !typing.current && top?.name !== 'help') ctx.go('help')
  })

  let body
  if (phase !== 'ready') {
    body = html`<${Frame} title="Starting" status=${{}} keys="Ctrl+C quit">
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
 * Help in plain language (the "?" key): the keys, and on a second page
 * what OpenLex is doing while it works and why (→ or Tab).
 */
export function Help() {
  const ctx = useAppCtx()
  const [page, setPage] = useState(0)
  useInput((input, key) => {
    if (key.rightArrow || key.tab || key.leftArrow) return setPage((p) => (p ? 0 : 1))
    if (key.escape || key.return || input === 'q' || input === '?') ctx.back()
  })
  const row = (k, what) => html`<${Box} key=${k}><${Box} width=${10} flexShrink=${0}><${Text} color=${color.accent}>${k}<//><//><${Text} wrap="truncate-end">${what}<//><//>`
  const keys = `→ ${page ? 'keys' : 'what OpenLex is doing and why'} ${sym.sep} Esc or Enter: back`
  if (page === 1) {
    const point = (k, what) => html`<${Box} key=${k}><${Box} width=${2} flexShrink=${0}><${Text} color=${color.accent}>${sym.bullet}<//><//><${Box} flexGrow=${1}><${Text} wrap="wrap">${what}<//><//><//>`
    return html`<${Frame} title="What OpenLex is doing and why" status=${ctx.status()} keys=${keys}>
      <${Box} flexDirection="column">
        ${point(1, 'While it works you see each step in plain words — what it reads, what it searches — and how long it has taken.')}
        ${point(2, 'It reads your documents and searches the law on this computer first.')}
        ${point(3, '"Sent to:" names every AI service outside this computer that got your question or documents, and whether names were hidden. "Stayed on this computer" means nothing left.')}
        ${point(4, '"Looked up online" means only search words or a web address went to a public law database (RIS, EUR-Lex) or a website.')}
        ${point(5, '"Based on:" lists the law and the passages the answer used. Ctrl+B shows them in full. Check them before relying on the answer.')}
        ${point(6, 'Each proposed change says whether it was checked. "Could not be verified" means: review it yourself.')}
        ${point(7, 'Esc stops at any time. What was written so far is kept; nothing more is sent.')}
        ${point(8, 'Recent activity (in the matter menu) lists each request: what was asked, looked at and sent.')}
      <//>
    <//>`
  }
  // Fits 80×24: short lines, nothing that wraps unexpectedly.
  return html`<${Frame} title="Help" status=${ctx.status()} keys=${keys}>
    <${Text} wrap="wrap">Pick a matter (a client file), ask about it, or let OpenLex do a larger piece of work. Results are saved as Word or Excel files in the matter's folder.<//>
    <${Box} flexDirection="column" marginTop=${1}>
      ${row('↑ ↓', 'move through a list')}
      ${row('Enter', 'choose / send your question')}
      ${row('Esc', 'go back one step (or stop the work; what is done is kept)')}
      ${row('Tab', 'choose who OpenLex works as · complete a file name')}
      ${row('Ctrl+B', 'what the last answer is based on, in full')}
      ${row('/', 'in a question: /model /key /data /as /activity /help')}
      ${row('?', 'this help (when you are not typing)')}
      ${row('Ctrl+C', 'quit')}
    <//>
    <${Box} flexDirection="column" marginTop=${1}>
      <${Text} wrap="truncate-end"><${Text} bold>Add documents:<//> drag files into this window — into a question to ask about them.<//>
      <${Text} wrap="truncate-end"><${Text} bold>Privileged<//> matters never leave this computer, whatever the settings say.<//>
      <${Text} wrap="truncate-end"><${Text} bold>Working as:<//> Associate (default), Researcher, Reviewer or Drafter.<//>
      <${Text} wrap="truncate-end"><${Text} bold>Client data:<//> where it may go is always shown below; change it in Settings.<//>
    <//>
  <//>`
}

export default App
