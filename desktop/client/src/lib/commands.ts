// The chat commands ("/model", "/record", "/help" …) for the desktop App.
// The list comes from the OpenLex engine (GET /api/commands?surface=app,
// sidecar/src/commands.js) — the same list the terminal app and the Word
// pane use — so a lawyer meets the same commands in every window. This file
// is the plain logic (no React): load, filter, parse.

import i18n from '../i18n'

export interface ChatCommand {
  name: string
  args: string
  help: string
  description: { en: string; de: string }
  surfaces: string[]
}

export interface Engine {
  call: (method: string, path: string, body?: unknown) => Promise<any>
  /** SSE endpoint (POST): onEvent per event; resolves when the stream ends. `id` lets stop() end it. */
  stream?: (path: string, body: unknown, onEvent: (ev: any) => void, id?: string) => Promise<{ ok: boolean; stopped?: boolean }>
  stop?: (id: string) => Promise<{ ok: boolean }>
}

/** The engine bridge (Electron preload), or null in a plain browser build. */
export const engine = (): Engine | null => (typeof window !== 'undefined' && (window as any).lexvault?.engine) || null

/** The App's commands from the engine, described in `lang` (German or English). */
export async function loadCommands(lang: string): Promise<ChatCommand[]> {
  const e = engine()
  if (!e) return []
  const r = await e.call('GET', `/api/commands?surface=app&lang=${encodeURIComponent(lang || 'en')}`)
  return Array.isArray(r?.commands) ? r.commands : []
}

/** Is the "/" menu wanted for this composer text? Returns the typed word ('' right after "/"). */
export function menuQuery(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text)
  return m ? m[1].toLowerCase() : null
}

/** Commands matching what was typed after "/": name starts first, then a word of the description ("/kopi" finds /copy in German). */
export function filterCommands(list: ChatCommand[], query: string): ChatCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const starts = list.filter((c) => c.name.startsWith(q))
  const rest = list.filter((c) => !c.name.startsWith(q) && c.help.toLowerCase().split(/[^\p{L}\d]+/u).some((w) => w.startsWith(q)))
  return [...starts, ...rest]
}

/** "/model local" → { name: 'model', arg: 'local' }; anything else → null. */
export function parseCommand(text: string): { name: string; arg: string } | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? { name: m[1].toLowerCase(), arg: (m[2] || '').trim() } : null
}

/** The closest command name to a mistyped one, or null. */
export function didYouMean(word: string, names: string[]): string | null {
  const w = word.toLowerCase()
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 1; j <= b.length; j++) d[0][j] = j
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return d[a.length][b.length]
  }
  let best: { n: string; score: number } | null = null
  for (const n of names) {
    const score = n.startsWith(w) && w.length >= 2 ? 0 : dist(w, n)
    if (score <= Math.max(2, Math.floor(n.length / 3)) && (!best || score < best.score)) best = { n, score }
  }
  return best?.n || null
}

/** Everyday words for the AI services ("/model claude"). */
export const PROVIDER_WORDS: Record<string, string> = { claude: 'anthropic', computer: 'local', 'this-computer': 'local', gpt: 'openai', firm: 'custom' }

/** Folder name the engine uses for a matter's files (workspace.matterFolder). */
export const matterFolderName = (m: { number?: string; title: string } | null | undefined) =>
  String(m ? (m.number ? `${m.number} ${m.title}` : m.title) : 'default').replace(/[^\w\-.]/g, '_').slice(0, 80)

/** An agent as the engine describes it: built-in roles and templates carry a German name and description ("de"). */
export interface AgentNames { name: string; title: string; description?: string; de?: { title?: string; description?: string } | null; titleDe?: string }

const uiIsGerman = () => /^de/i.test(i18n.resolvedLanguage || i18n.language || '')

/**
 * An agent's name in the App's language. Built-in roles and the panel
 * templates have a German name from the engine; the firm's and the
 * lawyer's own agents keep the name they were given.
 */
export function agentTitle(a: AgentNames, t?: (k: string, d: string) => string): string {
  if (uiIsGerman()) {
    const de = a.titleDe || a.de?.title
    if (de) return de
    // An older engine without "de": the built-in names, only while the agent keeps its English name.
    const en = String(i18n.getFixedT('en')(`agents.${a.name}`, { defaultValue: '' }))
    if (t && en && en === a.title) return t(`agents.${a.name}`, a.title)
  }
  return a.title
}

/** An agent's one-line description in the App's language (same rule as agentTitle). */
export function agentDescription(a: AgentNames): string {
  return (uiIsGerman() && a.de?.description) || a.description || ''
}
