// "Where client data may go" (/data, Settings): the client-data rule in plain
// words, translated. The engine's policy (GET/POST /api/policy) decides what
// may leave this computer: nothing (only this computer), or only the services
// ticked here; optionally only EU regions, the redaction check (on by default)
// and names and numbers hidden. Privileged
// matters always stay on this computer. The power-user view stays in More tools.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, Lock } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'
import RedactionSetting from './RedactionSetting'

interface Target { id: string; label: string }

export default function DataRule({ say }: { say?: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
  const { t, i18n } = useTranslation()
  const de = /^de/i.test(i18n.language || '')
  const [policy, setPolicy] = useState<any>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const e = engine()
    if (!e) return setError(t('commands.noEngine', 'Commands need the OpenLex engine, which runs with the desktop app.'))
    const [pol, pv, mcp] = await Promise.all([
      e.call('GET', '/api/policy'),
      e.call('GET', '/api/providers').catch(() => ({ providers: [] })),
      e.call('GET', '/api/mcp').catch(() => ({ servers: [] })),
    ])
    setPolicy(pol)
    setTargets([
      ...(pv.providers || []).filter((p: any) => !p.local).map((p: any) => ({ id: p.id, label: (de ? p.labels?.de : p.labels?.en) || p.label })),
      { id: 'web', label: t('data.web', 'Looking things up online (RIS, EUR-Lex, public pages)') },
      ...(mcp.servers || []).filter((s: any) => s.remote).map((s: any) => ({ id: `mcp:${s.name}`, label: t('data.connector', 'Connector: {{name}}', { name: s.name }) })),
    ])
  }, [de, t])
  useEffect(() => { load().catch((err) => setError(friendly(err))) }, [load])

  if (error) return <p className="text-red-400">{error}</p>
  if (!policy) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  const rule = policy.default || { mode: 'local-only' }
  const locked = !!policy.locked
  const allow = rule.mode === 'allow-list'
  const set = async (next: any) => {
    try {
      await engine()!.call('POST', '/api/policy', { rule: next })
      window.dispatchEvent(new CustomEvent('openlex:setup-changed'))
      await load()
      say?.(next.mode === 'local-only' ? t('data.nowLocal', 'Client data now stays on this computer.') : t('data.saved', 'Saved: client data may go only where you ticked.'))
    } catch (err) { setError(friendly(err)) }
  }
  const toggle = (id: string, on: boolean) => {
    const list = new Set<string>(rule.providers || [])
    if (on) list.add(id)
    else list.delete(id)
    set({ ...rule, mode: 'allow-list', providers: [...list] })
  }
  const radio = 'mt-0.5 shrink-0'
  return (
    <div className="space-y-3 text-sm" data-testid="data-rule">
      {locked && <p className="text-antique flex items-center gap-1"><Lock size={12} /> {t('data.locked', 'Set by your firm.')}</p>}
      <label className="flex items-start gap-2 text-cream cursor-pointer">
        <input type="radio" name="data-mode" className={radio} disabled={locked} checked={!allow} onChange={() => set({ mode: 'local-only' })} />
        <span><span className="inline-flex items-center gap-1"><Lock size={13} className="text-forest" /> {t('data.local', 'Only this computer')}</span>
          <span className="block text-xs text-antique">{t('data.localHint', 'Nothing about your clients leaves this computer. Online AI and online look-ups get nothing.')}</span></span>
      </label>
      <label className="flex items-start gap-2 text-cream cursor-pointer">
        <input type="radio" name="data-mode" className={radio} disabled={locked} checked={allow} onChange={() => set({ mode: 'allow-list', providers: rule.providers || [] })} />
        <span><span className="inline-flex items-center gap-1"><Cloud size={13} className="text-antique" /> {t('data.allow', 'Also these services:')}</span></span>
      </label>
      <div className="ml-6 grid gap-1">
        {targets.map((x) => (
          <label key={x.id} className={`flex items-center gap-2 text-sm ${allow ? 'text-parchment' : 'text-antique'}`}>
            <input type="checkbox" disabled={!allow || locked} checked={allow && (rule.providers || []).includes(x.id)} onChange={(ev) => toggle(x.id, ev.target.checked)} /> {x.label}
          </label>
        ))}
      </div>
      <div className="border-t border-tobacco/60 pt-3 space-y-2">
        <RedactionSetting allow={allow} say={say} />
        <label className={`flex items-start gap-2 ${allow ? 'text-cream' : 'text-antique'}`}>
          <input type="checkbox" className="mt-0.5" disabled={!allow || locked} checked={!!rule.redact} onChange={(ev) => set({ ...rule, redact: ev.target.checked })} />
          <span>{t('data.redact', 'Always hide names and numbers, also without the check')}<span className="block text-xs text-antique">{t('data.redactHint', 'Names on the matter\'s list, e-mail addresses, IBANs, ID and phone numbers are replaced (pseudonymised) before anything goes online, even when the redaction check is off.')}</span></span>
        </label>
        <label className={`flex items-start gap-2 ${allow ? 'text-cream' : 'text-antique'}`}>
          <input type="checkbox" className="mt-0.5" disabled={!allow || locked} checked={(rule.regions || []).includes('eu')} onChange={(ev) => set({ ...rule, regions: ev.target.checked ? ['eu'] : undefined })} />
          <span>{t('data.euOnly', 'Only data centres in the EU')}<span className="block text-xs text-antique">{t('data.euOnlyHint', 'AWS Bedrock in Frankfurt, Mistral, Azure or Google in an EU region.')}</span></span>
        </label>
      </div>
      <p className="text-xs text-antique">{t('data.privileged', 'Privileged matters always stay on this computer, whatever is ticked here.')}</p>
    </div>
  )
}
