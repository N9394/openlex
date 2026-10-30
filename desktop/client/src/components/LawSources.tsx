// /law: where OpenLex looks up the law (engine connectors), in the App's
// language. Three sections: Ready, Needs your key (or a sign-in), Off.
// In each: the gateways first (they cover many countries), then the
// countries this matter used (or the ones with a ready source), the other
// countries folded away; "used N times in this matter" from the AI record. Online by default: every source answers
// per question. Per source: switch on or off, paste a key, sign in with
// the browser (Ansvar's free plan, suggested first where it covers the
// country), keep it on this computer (size shown first), remove it. One
// switch for "Work fully offline" (it says what it will download). The
// engine decides the words (GET /api/sources/law: status / statusDe).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'

export interface LawSource {
  id: string; label: string; labelDe?: string; status: string; statusDe?: string; description?: string; descriptionDe?: string | null
  state: string; enabled: boolean; needsKey: boolean; optionalKey: boolean; hasKey: boolean; keyHelp?: string | null; keyHelpDe?: string | null
  managedByFirm: boolean; licence?: string; country: string; jurisdictions?: string[]; kind?: string; guide?: string; signIn?: boolean
  recommended?: boolean; manual?: boolean; pages?: { label: string; url: string }[]
  gateway?: boolean; uses?: number | null
  local?: { items: LocalItem[]; parts: { part: string; label: string; labelDe?: string; updated?: string | null; stale?: boolean }[]; jobs: Job[] } | null
}
interface LocalItem { part: string; label: string; bytes: number; updated?: string | null; stale?: boolean; licence?: string; history?: boolean }
interface Job { source: string; part: string | null; state: string; done?: number; total?: number | null; message?: string; error?: string }
interface Plan { source: string; part: string | null; label: string; size: string; from?: string; note?: string; licence?: string; updated?: string; stale?: boolean }
interface Offline { on: boolean; countries: string[]; downloads?: (Plan & { error?: string })[]; total?: { size: string } }

const openLink = (url: string) => {
  const b = (window as any).lexvault?.openExternal
  if (b) b(url)
  else window.open(url, '_blank', 'noopener')
}

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`)

/** Country name in the App's language ("INT" = several countries). */
function countryName(code: string, lang: string, several: string) {
  if (code === 'INT') return several
  if (code === 'EU') return lang.startsWith('de') ? 'Europäische Union' : 'European Union'
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code === 'UK' ? 'GB' : code) || code } catch { return code }
}

export default function LawSources({ say, matter }: { say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void; matter?: () => Promise<{ id: string } | null> }) {
  const { t, i18n } = useTranslation()
  const de = i18n.language?.startsWith('de')
  const lang = i18n.language || 'en'
  const [list, setList] = useState<LawSource[] | null>(null)
  const [offline, setOffline] = useState<Offline | null>(null)
  const [error, setError] = useState('')
  const [keyFor, setKeyFor] = useState<LawSource | null>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [country, setCountry] = useState('')
  const [plan, setPlan] = useState<{ src: LawSource; part: string | null; plan: Plan } | null>(null)
  const [offlinePlan, setOfflinePlan] = useState<Offline | null>(null)

  const load = useCallback(() => {
    (async () => {
      const m = matter ? await matter().catch(() => null) : null
      const r = await engine()!.call('GET', `/api/sources/law${m ? `?matterId=${encodeURIComponent(m.id)}` : ''}`)
      setList(r.sources || [])
      setOffline(r.offline || null)
    })().catch((err) => setError(friendly(err)))
  }, [matter])
  useEffect(() => { load() }, [load])
  // While something downloads, refresh the list for its progress.
  const running = (list || []).some((s) => (s.local?.jobs || []).some((j) => j.state === 'running'))
  useEffect(() => { if (!running) return undefined; const x = setInterval(load, 2000); return () => clearInterval(x) }, [running, load])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try { await fn(); say(done) } catch (err) { say(friendly(err), 'bad') }
    setBusy(false); setKeyFor(null); setSecret(''); setPlan(null); setOfflinePlan(null); load()
  }

  const words = (s: LawSource) => (de && s.statusDe) || s.status
  const name = (s: LawSource) => (de && s.labelDe) || s.label
  const several = t('law.several', 'Several countries')

  // Sections by state; inside, gateways first, then this matter's countries, the rest folded.
  const sections = useMemo(() => {
    const shown = (list || []).filter((s) => !country || s.country === country || (s.jurisdictions || []).includes(country))
    const used = new Set(shown.filter((s) => (s.uses || 0) > 0).flatMap((s) => [s.country, ...(s.jurisdictions || [])]))
    const main = used.size ? used : new Set(shown.filter((s) => s.state === 'ready').map((s) => s.country))
    const isGateway = (s: LawSource) => !!s.gateway || s.country === 'INT'
    const stateOf = (s: LawSource) => (s.state === 'ready' ? 'ready' : s.state === 'off' || !s.enabled ? 'off' : 'key')
    const rank = (s: LawSource) => (isGateway(s) ? 0 : s.country === 'EU' ? 1 : 2) - (s.recommended ? 0.5 : 0) - Math.min(0.4, (s.uses || 0) / 1000)
    const byName = (a: LawSource, b: LawSource) => rank(a) - rank(b) || countryName(a.country, lang, several).localeCompare(countryName(b.country, lang, several))
    return (['ready', 'key', 'off'] as const).map((k) => {
      const items = shown.filter((s) => stateOf(s) === k).sort(byName)
      const top = items.filter((s) => country || isGateway(s) || s.country === 'EU' || main.has(s.country) || (s.uses || 0) > 0)
      const rest = items.filter((s) => !top.includes(s))
      return { key: k, top, rest }
    }).filter((x) => x.top.length || x.rest.length)
  }, [list, country, lang, several])
  const countries = useMemo(() => [...new Set((list || []).map((s) => s.country).filter((c) => c !== 'INT'))].sort((a, b) => countryName(a, lang, several).localeCompare(countryName(b, lang, several))), [list, lang, several])

  if (error) return <p className="text-red-400">{error}</p>
  if (!list) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>

  if (keyFor) {
    const help = (de && keyFor.keyHelpDe) || keyFor.keyHelp
    return (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (secret.trim()) act(() => engine()!.call('POST', '/api/sources/key', { name: keyFor.id, key: secret.trim() }), t('commands.keySavedFor', 'Saved the {{name}} key.', { name: name(keyFor) })) }}>
        <label className="block text-cream">{t('commands.yourKey', 'Your {{name}} key', { name: name(keyFor) })}</label>
        <input type="password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className="input w-full" autoComplete="off" />
        <p className="text-xs text-antique">{help ? `${help} ` : ''}{t('commands.keyKept', 'It is kept in this computer\'s keychain and only sent to {{name}}.', { name: name(keyFor) })}</p>
        {keyFor.guide && <button type="button" className="text-xs text-antique underline hover:text-cream" onClick={() => openLink(keyFor.guide!)}>{t('law.howToGet', 'How to get it')}</button>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !secret.trim()} className="btn-primary flex-1">{t('commands.saveKey', 'Save the key')}</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => { setKeyFor(null); setSecret('') }}>{t('common.cancel', 'Cancel')}</button>
        </div>
      </form>
    )
  }

  if (plan) {
    return (
      <div className="space-y-3">
        <p className="text-cream">{t('law.downloadAsk', 'Keep {{what}} on this computer?', { what: plan.plan.label })}</p>
        <p className="text-sm text-parchment">{t('law.downloadSize', 'Size: {{size}}, from {{from}}.', { size: plan.plan.size, from: plan.plan.from || name(plan.src) })} {plan.plan.note || ''}</p>
        {plan.plan.updated && <p className="text-xs text-antique">{t('law.lastUpdated', 'Last updated {{date}}', { date: plan.plan.updated })}{plan.plan.stale ? ` — ${t('law.stale', 'over 60 days ago: may be out of date')}` : ''}</p>}
        <p className="text-xs text-antique">{t('law.downloadNote', 'Downloaded from the source itself, kept in OpenLex\'s data folder, updated once a day. You can remove it here at any time.')}</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} className="btn-primary flex-1" onClick={() => act(() => engine()!.call('POST', '/api/sources/law/download', { name: plan.src.id, part: plan.part, confirm: true }), t('law.downloadStarted', 'Downloading {{what}}…', { what: plan.plan.label }))}>{t('law.download', 'Download')}</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => setPlan(null)}>{t('common.cancel', 'Cancel')}</button>
        </div>
      </div>
    )
  }

  if (offlinePlan) {
    return (
      <div className="space-y-3">
        <p className="text-cream">{t('law.offlineAsk', 'Work fully offline: OpenLex will download these and then answer only from this computer.')}</p>
        <ul className="text-sm text-parchment space-y-1">
          {(offlinePlan.downloads || []).map((d, i) => <li key={i}>· {d.label}: {d.error ? <span className="text-amber-400">{d.error}</span> : d.size}</li>)}
        </ul>
        {offlinePlan.total && <p className="text-sm text-cream">{t('law.offlineTotal', 'Together: {{size}}', { size: offlinePlan.total.size })}</p>}
        <p className="text-xs text-antique">{t('law.offlineCountries', 'Countries: {{list}}', { list: offlinePlan.countries.map((c) => countryName(c, lang, several)).join(', ') })}</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} className="btn-primary flex-1" onClick={() => act(() => engine()!.call('POST', '/api/sources/law/offline', { on: true, confirm: true, countries: offlinePlan.countries }), t('law.offlineOn', 'OpenLex now works fully offline; the downloads are running.'))}>{t('law.offlineGo', 'Download and work offline')}</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => setOfflinePlan(null)}>{t('common.cancel', 'Cancel')}</button>
        </div>
      </div>
    )
  }

  const offlineRule = list.some((s) => s.state === 'offline')
  const askPlan = (s: LawSource, part: string | null) => act(async () => {
    const r = await engine()!.call('POST', '/api/sources/law/download', { name: s.id, part })
    setPlan({ src: s, part, plan: r.plan })
  }, t('law.sizeShown', 'Here is what it would download.'))

  const item = (s: LawSource) => (
                <li key={s.id} className="rounded px-2 py-1.5 hover:bg-leather/30">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span aria-hidden="true" className={s.state === 'ready' ? 'text-forest' : s.state === 'off' ? 'text-antique' : 'text-amber-400'}>{s.state === 'ready' ? '✓' : s.state === 'off' ? '–' : '!'}</span>
                    <span className="flex-1 min-w-[12rem] text-cream">{words(s)}{s.recommended && s.state !== 'ready' ? <span className="ml-1 text-xs text-accent">{t('law.suggested', '(suggested: free plan, 100 searches a day)')}</span> : null}
                      <span className="block text-[11px] text-antique">{s.gateway ? t('law.gateway', 'Gateway: many countries') : countryName(s.country, lang, several)}{(s.uses || 0) > 0 ? ` · ${t('law.used', 'used {{count}} times in this matter', { count: s.uses || 0 })}` : ''}</span></span>
                    {s.signIn && <button type="button" disabled={busy} className="text-xs text-antique underline hover:text-cream" onClick={() => act(() => engine()!.call('POST', '/api/sources/law/signin', { name: s.id }), t('law.signInOpened', 'The sign-in page is open: type the code shown there, then come back.'))}>{s.hasKey ? t('law.signInAgain', 'Sign in again') : t('law.signIn', 'Sign in (free)')}</button>}
                    {(s.needsKey || s.optionalKey) && <button type="button" disabled={busy} className="text-xs text-antique underline hover:text-cream" onClick={() => setKeyFor(s)}>{s.hasKey ? t('commands.replaceKey', 'Replace the key') : t('commands.pasteKey', 'Paste your key')}</button>}
                    {s.manual && (s.pages || []).map((p) => <button key={p.url} type="button" className="text-xs text-antique underline hover:text-cream" onClick={() => openLink(p.url)}>{p.label}</button>)}
                    {s.manual && s.guide && <button type="button" className="text-xs text-antique underline hover:text-cream" onClick={() => openLink(s.guide!)}>{t('law.askPermission', 'Ask for permission (template)')}</button>}
                    {!s.manual && !s.managedByFirm && (
                      <button type="button" disabled={busy} className="text-xs text-antique underline hover:text-cream" onClick={() => act(() => engine()!.call('POST', '/api/sources/enable', { name: s.id, on: !s.enabled }), s.enabled ? t('commands.nowOff', '{{name}} is now off.', { name: name(s) }) : t('commands.nowOn', '{{name}} is now on.', { name: name(s) }))}>
                        {s.enabled ? t('commands.switchOff', 'Switch off') : t('commands.switchOn', 'Switch on')}
                      </button>
                    )}
                  </div>
                  {((de && s.descriptionDe) || s.description) && <div className="ml-6 text-xs text-antique">{(de && s.descriptionDe) || s.description}</div>}
                  {/* On this computer: what is there, last updated, remove; progress while downloading */}
                  {s.local && (
                    <div className="ml-6 mt-1 space-y-0.5 text-xs">
                      {s.local.items.map((it) => (
                        <div key={it.part} className="flex gap-2 items-center">
                          <span className={it.stale ? 'text-amber-400' : 'text-parchment'}>{t('law.onComputer', 'On this computer: {{what}}, {{size}}', { what: it.label, size: mb(it.bytes) })}{it.updated ? ` · ${t('law.lastUpdated', 'Last updated {{date}}', { date: it.updated })}` : ''}{it.stale ? ` — ${t('law.stale', 'over 60 days ago: may be out of date')}` : ''}</span>
                          <button type="button" disabled={busy} className="text-antique underline hover:text-cream" onClick={() => act(() => engine()!.call('POST', '/api/sources/law/download/remove', { name: s.id, part: s.local!.parts.length ? it.part : null }), t('law.removed', 'Removed from this computer.'))}>{t('law.remove', 'Remove')}</button>
                        </div>
                      ))}
                      {s.local.jobs.filter((j) => j.state === 'running' || j.state === 'failed').map((j, i) => <div key={i} className={j.state === 'failed' ? 'text-amber-400' : 'text-parchment'}>{j.state === 'failed' ? j.error : `${j.message || ''}${j.total ? ` (${Math.round(((j.done || 0) / j.total) * 100)}%)` : ''}`}</div>)}
                      {s.local.parts.length > 0 ? (
                        <select className="input text-xs" value="" disabled={busy} onChange={(e) => e.target.value && askPlan(s, e.target.value)} aria-label={t('law.keepCountry', 'Keep a country on this computer…')}>
                          <option value="">{t('law.keepCountry', 'Keep a country on this computer…')}</option>
                          {s.local.parts.filter((p) => !s.local!.items.some((it) => it.part === p.part)).map((p) => <option key={p.part} value={p.part}>{(de && p.labelDe) || p.label}{p.updated ? ` (${p.updated}${p.stale ? ', !' : ''})` : ''}</option>)}
                        </select>
                      ) : !s.local.items.length && (
                        <button type="button" disabled={busy} className="text-antique underline hover:text-cream" onClick={() => askPlan(s, null)}>{t('law.keepLocal', 'Keep it on this computer…')}</button>
                      )}
                    </div>
                  )}
                </li>
  )

  return (
    <div className="space-y-3">
      {/* The one offline switch */}
      <div className="rounded border border-leather/50 px-3 py-2 flex items-center gap-2">
        <span className="flex-1 text-sm text-cream">{offline?.on ? t('law.offlineIsOn', 'Working fully offline: answers come only from this computer.') : t('law.offlineIsOff', 'Online: sources answer per question; nothing to install.')}</span>
        <button type="button" disabled={busy} className="text-xs text-antique underline hover:text-cream" onClick={() => (offline?.on
          ? act(() => engine()!.call('POST', '/api/sources/law/offline', { on: false }), t('law.offlineOff', 'OpenLex looks things up online again.'))
          : act(async () => setOfflinePlan(await engine()!.call('POST', '/api/sources/law/offline', { plan: true, countries: country ? [country] : undefined })), t('law.sizeShown', 'Here is what it would download.')))}>
          {offline?.on ? t('law.goOnline', 'Go back online') : t('law.workOffline', 'Work fully offline…')}
        </button>
      </div>

      {countries.length > 6 && (
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="input w-full text-sm" aria-label={t('law.country', 'Country')}>
          <option value="">{t('law.allCountries', 'All countries')}</option>
          {countries.map((c) => <option key={c} value={c}>{countryName(c, lang, several)}</option>)}
        </select>
      )}

      <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1" data-testid="law-sections">
        {sections.map((sec) => (
          <section key={sec.key} data-testid={`law-${sec.key}`}>
            <h3 className={`text-xs uppercase tracking-wide mb-1 ${sec.key === 'ready' ? 'text-forest' : sec.key === 'key' ? 'text-amber-400' : 'text-antique'}`}>
              {sec.key === 'ready' ? t('law.secReady', 'Ready') : sec.key === 'key' ? t('law.secKey', 'Needs your key or a sign-in') : t('law.secOff', 'Off')} <span className="text-antique normal-case">({sec.top.length + sec.rest.length})</span>
            </h3>
            <ul className="space-y-1">{sec.top.map(item)}</ul>
            {sec.rest.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-antique hover:text-cream px-2 py-1">{t('law.otherCountries', 'Other countries ({{n}})', { n: sec.rest.length })}</summary>
                <ul className="space-y-1 mt-1">{sec.rest.map(item)}</ul>
              </details>
            )}
          </section>
        ))}
      </div>
      <p className="text-xs text-antique">
        {t('commands.lawNote', 'Only your search words are sent, never your documents.')} {offlineRule ? t('commands.lawOffline', 'Online look-ups are off in your client-data rule (/data).') : ''} {list[0]?.managedByFirm ? t('commands.lawFirm', 'Your firm manages this list.') : ''}
      </p>
    </div>
  )
}
