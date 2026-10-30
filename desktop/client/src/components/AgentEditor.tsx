// Make your own agent — or change one — with a small form, no JSON:
// its name, what it does (plain instructions), which sources it may use
// (checkboxes in plain words), where it runs (the AI services set up in
// /model) and how thorough it is. Saved in your openlex.json; with
// "for the whole firm" in the firm's (the firm can lock the list).
// Starts from a template (Claimant's side, Defendant's side, Devil's
// advocate, Drafter, Researcher, Compliance checker), from an existing
// agent (/agent edit NAME) or from this conversation (/agent from-chat).
//
// Engine: GET /api/agents (agents, templates, source groups),
// POST /api/agents/save | /api/agents/delete | /api/agents/propose.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Sparkles, Trash2 } from 'lucide-react'
import { agentDescription, agentTitle, engine } from '../lib/commands'
import { friendly } from '../lib/turn'

export interface AgentProfile { name: string; title: string; description?: string; instructions?: string; tools?: string[]; groups?: string[]; depth?: string | null; model?: string; source?: string; error?: string }
interface Template { name: string; title: string; description: string; instructions: string; groups: string[]; depth: string; de?: { title?: string; description?: string } }
interface Group { id: string; label: string }
interface AgentsInfo { agents: AgentProfile[]; templates: Template[]; groups: Group[]; where: { locked: boolean; firm: boolean } }
interface Provider { id: string; local: boolean; needsKey: boolean; hasKey: boolean | null; model: string | null; blocked?: unknown; display?: { en: string; de: string }; label: string }

export interface AgentForm { title: string; description: string; instructions: string; groups: string[]; model: string; depth: string }
const EMPTY: AgentForm = { title: '', description: '', instructions: '', groups: ['law', 'documents'], model: '', depth: 'balanced' }

export default function AgentEditor({ edit, proposal, sessionId, matterId, onDone, onCancel }: {
  /** The agent to change (its name), or nothing for a new one. */
  edit?: string | null
  /** Start from this conversation: the engine proposes, the lawyer confirms. */
  proposal?: boolean
  sessionId?: string | null
  matterId?: string | null
  onDone: (text: string, agent?: AgentProfile) => void
  onCancel: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = /^de/i.test(i18n.language || '') ? 'de' : 'en'
  const [info, setInfo] = useState<AgentsInfo | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [form, setForm] = useState<AgentForm>(EMPTY)
  const [firm, setFirm] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const editing = useMemo(() => (edit && info ? info.agents.find((a) => a.name === edit.toLowerCase() || a.title.toLowerCase() === edit.toLowerCase()) || null : null), [edit, info])

  useEffect(() => {
    const e = engine()
    if (!e) return
    e.call('GET', `/api/agents?lang=${lang}`).then(setInfo).catch((err) => setError(friendly(err)))
    e.call('GET', '/api/providers').then((r) => setProviders((r.providers || []).filter((p: Provider) => !p.blocked && (p.local || !p.needsKey || p.hasKey)))).catch(() => {})
  }, [lang])

  useEffect(() => {
    if (editing) setForm({ title: editing.title, description: editing.description || '', instructions: editing.instructions || '', groups: editing.groups || [], model: editing.model || '', depth: editing.depth === 'ultra' ? 'deep' : editing.depth || 'balanced' })
  }, [editing])

  useEffect(() => {
    if (!proposal || !sessionId) return
    setBusy('propose')
    engine()?.call('POST', '/api/agents/propose', { sessionId, matterId })
      .then((r) => { setForm({ ...EMPTY, ...r.proposal, model: '' }); setNote(r.note || t('agentEditor.proposed', 'Proposed from what you asked in this conversation. Check it, change what you like, then save.')) })
      .catch((err) => setError(friendly(err))).finally(() => setBusy(''))
  }, [proposal, sessionId, matterId, t])

  if (error && !info) return <p className="text-red-400 text-sm">{error}</p>
  if (!info) return <p className="text-antique text-sm">{t('common.loading', 'Loading…')}</p>
  if (edit && !editing) return <p className="text-amber-400 text-sm">{t('agentEditor.noSuch', 'There is no agent called “{{name}}”. Type /as to see them.', { name: edit })}</p>

  const set = (patch: Partial<AgentForm>) => setForm((f) => ({ ...f, ...patch }))
  const fromTemplate = (tp: Template) => { setForm({ title: agentTitle(tp), description: agentDescription(tp), instructions: tp.instructions, groups: tp.groups, model: form.model, depth: tp.depth }); setNote(t('agentEditor.fromTemplate', 'Started from the template “{{name}}”. Change anything, then save.', { name: agentTitle(tp) })) }
  const locked = info.where.locked
  const builtIn = editing?.source === 'built-in'

  const save = async () => {
    setBusy('save')
    setError('')
    try {
      const r = await engine()!.call('POST', '/api/agents/save', { agent: { ...form, ...(editing ? { name: editing.name } : {}) }, scope: firm ? 'firm' : 'user' })
      if (r?.error) throw new Error(r.error)
      onDone(editing ? t('agentEditor.saved', 'Saved “{{name}}”. It works from your next question.', { name: r.agent.title }) : t('agentEditor.created', 'Made “{{name}}”. Use it with /as, or in a panel (/team).', { name: r.agent.title }), r.agent)
    } catch (err) { setError(friendly(err)) } finally { setBusy('') }
  }
  const remove = async () => {
    if (!editing || !confirm(t('agentEditor.deleteAsk', 'Delete the agent “{{name}}”?', { name: editing.title }))) return
    setBusy('delete')
    try {
      const r = await engine()!.call('POST', '/api/agents/delete', { name: editing.name })
      if (r?.error) throw new Error(r.error)
      onDone(t('agentEditor.deleted', 'Deleted “{{name}}”.', { name: editing.title }))
    } catch (err) { setError(friendly(err)) } finally { setBusy('') }
  }
  const where = (p: Provider) => `${p.display?.[lang] || p.label}${p.local ? '' : ` — ${t('agentEditor.online', 'online')}`}`

  return (
    <form className="space-y-4 text-sm" onSubmit={(e) => { e.preventDefault(); save() }} data-testid="agent-editor">
      {locked && <p className="text-amber-400 flex items-center gap-1"><Lock size={12} /> {t('agentEditor.locked', 'Your firm has fixed the list of agents. Ask whoever looks after OpenLex at your firm.')}</p>}
      {busy === 'propose' && <p className="text-antique" role="status">{t('agentEditor.proposing', 'Reading what you asked in this conversation…')}</p>}
      {note && <p className="text-antique flex gap-1"><Sparkles size={13} className="mt-0.5 text-accent shrink-0" /> {note}</p>}
      {!editing && !proposal && (
        <div>
          <div className="text-xs text-antique mb-1">{t('agentEditor.start', 'Start from a template (or fill in the form):')}</div>
          <div className="flex flex-wrap gap-1.5">
            {info.templates.map((tp) => <button key={tp.name} type="button" onClick={() => fromTemplate(tp)} className="btn-secondary !px-2.5 !py-1 text-xs" title={agentDescription(tp)}>{agentTitle(tp)}</button>)}
          </div>
        </div>
      )}
      <label className="block">
        <span className="text-cream">{t('agentEditor.name', 'Name')}</span>
        <input className="input w-full mt-1" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('agentEditor.namePh', 'e.g. Tax desk')} maxLength={60} required data-testid="agent-name" />
      </label>
      <label className="block">
        <span className="text-cream">{t('agentEditor.what', 'What it does')}</span>
        <span className="block text-xs text-antique">{t('agentEditor.whatHelp', 'In your own words, as you would brief a colleague. The rules on sources and citations always apply.')}</span>
        <textarea className="input w-full mt-1 min-h-[110px]" value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} required data-testid="agent-instructions" />
      </label>
      <label className="block">
        <span className="text-cream">{t('agentEditor.short', 'One line for the list')}</span>
        <input className="input w-full mt-1" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} />
      </label>
      <fieldset>
        <legend className="text-cream">{t('agentEditor.sources', 'What it may use')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-1">
          {info.groups.map((g) => (
            <label key={g.id} className="flex items-start gap-2 text-parchment">
              <input type="checkbox" className="mt-0.5" checked={form.groups.includes(g.id)} onChange={(e) => set({ groups: e.target.checked ? [...form.groups, g.id] : form.groups.filter((x) => x !== g.id) })} />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-antique mt-1">{t('agentEditor.alwaysRead', 'Reading the document you work on is always allowed. Saving files and web pages still ask you first.')}</p>
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-cream">{t('agentEditor.where', 'Where it runs')}</span>
          <select className="input w-full mt-1" value={form.model} onChange={(e) => set({ model: e.target.value })} data-testid="agent-model">
            <option value="">{t('agentEditor.sameAsChat', 'Same as the chat (/model)')}</option>
            {providers.map((p) => { const v = p.model && !p.local ? `${p.id}:${p.model}` : p.id; return <option key={p.id} value={v}>{where(p)}</option> })}
            {form.model && !providers.some((p) => form.model === p.id || form.model === `${p.id}:${p.model}`) && <option value={form.model}>{form.model}</option>}
          </select>
          <span className="block text-xs text-antique mt-1">{t('agentEditor.whereHelp', 'Your client-data rule still decides: for a privileged matter an online AI is never used.')}</span>
        </label>
        <label className="block">
          <span className="text-cream">{t('agentEditor.depth', 'How thorough')}</span>
          <select className="input w-full mt-1" value={form.depth} onChange={(e) => set({ depth: e.target.value })}>
            <option value="fast">{t('agentEditor.fast', 'Fast — a quick answer')}</option>
            <option value="balanced">{t('agentEditor.balanced', 'Balanced')}</option>
            <option value="deep">{t('agentEditor.deep', 'Deep — looks up more, takes longer')}</option>
          </select>
        </label>
      </div>
      {info.where.firm && !editing && (
        <label className="flex items-center gap-2 text-parchment">
          <input type="checkbox" checked={firm} onChange={(e) => setFirm(e.target.checked)} /> {t('agentEditor.firm', 'For the whole firm (saved in the firm\'s openlex.json)')}
        </label>
      )}
      {builtIn && <p className="text-xs text-antique">{t('agentEditor.builtIn', 'A built-in agent: your changes are kept in your settings; deleting them brings back the original.')}</p>}
      {error && <p className="text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!!busy || (locked && !firm) || !form.title.trim() || !form.instructions.trim()} className="btn-primary flex-1" data-testid="agent-save">{busy === 'save' ? '…' : editing ? t('agentEditor.save', 'Save') : t('agentEditor.create', 'Make the agent')}</button>
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">{t('common.cancel', 'Cancel')}</button>
        {editing && editing.source !== 'built-in' && editing.source !== 'template' && <button type="button" onClick={remove} disabled={!!busy} className="btn-secondary !px-3" title={t('agentEditor.delete', 'Delete')}><Trash2 size={14} /></button>}
      </div>
    </form>
  )
}
