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
import { AppContext, useAppCtx, TypingContext } from './context.mjs'

export { AppContext, useAppCtx, TypingContext }

const SCREENS = { setup: Setup, home: Home, newMatter: NewMatter, matter: Matter, action: Action, settings: Settings, help: Help }

export function App({ api: apiIn, startTimeoutMs = 20000 }) {
  const api = useRef(apiIn || createApi()).current
  const { exit } = useApp()
  const [phase, setPhase] = useState('starting') // starting | waiting | ready | failed
  const [error, setError] = useState(null)
  const [info, setInfo] = useState({})
  const [stack, setStack] = useState([])
  const [prefs, setPrefsState] = useState(loadPrefs)
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

  const ctx = {
    api,
    info,
    refresh,
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

/** Help in plain language (the "?" key). */
export function Help() {
  const ctx = useAppCtx()
  useInput((input, key) => { if (key.escape || key.return || input === 'q' || input === '?') ctx.back() })
  const row = (k, what) => html`<${Box} key=${k}><${Box} width=${10} flexShrink=${0}><${Text} color=${color.accent}>${k}<//><//><${Text} wrap="truncate-end">${what}<//><//>`
  // Fits 80×24: short lines, nothing that wraps unexpectedly.
  return html`<${Frame} title="Help" status=${ctx.status()} keys="Esc or Enter: back">
    <${Text} wrap="wrap">Pick a matter (a client file), ask about it, or let OpenLex do a larger piece of work. Results are saved as Word or Excel files in the matter's folder.<//>
    <${Box} flexDirection="column" marginTop=${1}>
      ${row('↑ ↓', 'move through a list')}
      ${row('Enter', 'choose / send your question')}
      ${row('Esc', 'go back one step (or stop an answer being written)')}
      ${row('Tab', 'choose who OpenLex works as · complete a file name')}
      ${row('?', 'this help (when you are not typing)')}
      ${row('Ctrl+C', 'quit')}
    <//>
    <${Box} flexDirection="column" marginTop=${1}>
      <${Text} wrap="truncate-end"><${Text} bold>Add documents:<//> drag files from Finder or Explorer into this window.<//>
      <${Text} wrap="truncate-end"><${Text} bold>Privileged<//> matters never leave this computer, whatever the settings say.<//>
      <${Text} wrap="truncate-end"><${Text} bold>Working as:<//> Associate (default), Researcher, Reviewer or Drafter.<//>
      <${Text} wrap="truncate-end"><${Text} bold>Client data:<//> where it may go is always shown below; change it in Settings.<//>
    <//>
  <//>`
}

export default App
