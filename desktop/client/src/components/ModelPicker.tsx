// Which AI answers, in the App's chat: the label above the question field
// ("Claude · AWS Bedrock (EU) ▾", "On this computer · Qwen3 8B ▾") with this
// month's spending next to it, and the picker it opens (also /model).
//
// The picker lists the choices in the recommended order, each with one plain
// line (the engine's words, GET /api/providers): on this computer; Claude on
// AWS Bedrock in the EU (recommended for fast, high-quality work); EU
// providers without a US parent; the firm's own Azure / Google cloud;
// OpenRouter with its strict settings; the model makers directly. A key is
// added here (it goes to the computer's keychain) and checked without
// sending any text. The first time a cloud service is chosen, a short
// notice says who receives the data (once per service; "About data" shows
// it again). Under "On this computer": the models already there (one click
// switches), a download sized to this computer through Ollama, or plain
// install steps — OpenLex installs nothing itself.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Cloud, Cpu, Download, Settings2, Trash2, X } from 'lucide-react'
import { engine } from '../lib/commands'
import { hubBridge } from '../lib/hub'
import { friendly } from '../lib/turn'

type Two = { en: string; de: string }
type Lang = 'en' | 'de'

export interface PickerProvider {
  id: string
  label: string
  labels?: Two
  kind: string
  local: boolean
  needsKey: boolean
  hasKey: boolean | null
  model: string | null
  models?: string[]
  baseUrl: string | null
  region: string | null
  project: string | null
  group: string
  about: Two | null
  company: Two | null
  keyHelp: Two | null
  usParent: boolean
  noticeSeen: boolean | null
  plan?: 'standard' | 'business'
  euProviders?: boolean
  retention?: { mode: string | null; confirmed: boolean; checkedAt: string } | null
  blocked?: Two | null
  display: Two & { local: boolean; viaUs: boolean }
}

interface NoticeText { title: string; summary: string; usGateway: string | null; details: string[]; checksIntro: string; checks: string[]; closing: string; accept: string }
interface Notice { provider: string; version: number; en: NoticeText; de: NoticeText }
interface Spend {
  month: string; total: number; cap: number | null; warnAt: number; locked: boolean; ratio: number; level: 'ok' | 'warn' | 'stop'
  byModel: { provider: string; model: string | null; calls: number; inTokens: number; outTokens: number; cost: number; estimatedTokens: boolean; priceKnown: boolean; reported: boolean }[]
  byMatter: { matterId: string | null; cost: number }[]
  estimates: { note: string; usdToEur: number; asOf: string }
}
interface LocalModel { id: string; runtime: 'ollama' | 'gguf'; name: string; title: string; sizeGb: number | null; goodFor: Two; active: boolean }
export interface Detect {
  ollama: { installed: boolean; running: boolean; version: string | null; models: { name: string }[] }
  llamacpp: { installed: boolean; running: boolean; command: string }
  ramGb: number
  recommended: { name: string; title: string; sizeGb: number; installed: boolean }
  options: { name: string; title: string; sizeGb: number; fits: boolean; installed: boolean }[]
  install: { platform: string; ollama: string; llamacpp: string; brew: string | null }
}

export function useLang(): Lang {
  const { i18n } = useTranslation()
  return /^de/i.test(i18n.language || '') ? 'de' : 'en'
}
const two = (v: Two | null | undefined, lang: Lang) => (v ? v[lang] || v.en : '')
const euro = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(n || 0)
const openLink = (url: string) => {
  const b = (window as any).lexvault?.openExternal
  if (b) b(url)
  else window.open(url, '_blank', 'noopener')
}
const call = (method: string, path: string, body?: unknown) => {
  const e = engine()
  if (!e) return Promise.reject(new Error('engine is not running'))
  return e.call(method, path, body)
}
const changed = () => window.dispatchEvent(new CustomEvent('openlex:setup-changed'))

// ── the label above the question field ────────────────────────────────────

/** "Claude · AWS Bedrock (EU) ▾" + this month's spending + "About data"; one click opens the picker. */
export function ModelLabel({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [info, setInfo] = useState<{ display: PickerProvider['display']; active: string; spend: Spend | null } | null>(null)
  const [about, setAbout] = useState(false)
  const [spendOpen, setSpendOpen] = useState(false)
  const warned = useRef<string>('')

  const load = useCallback(async () => {
    if (!engine()) return
    const [st, pv, sp] = await Promise.all([
      call('GET', '/api/status').catch(() => null),
      call('GET', '/api/providers').catch(() => null),
      call('GET', '/api/spend').catch(() => null),
    ])
    const display = st?.model?.display || pv?.display
    if (display) setInfo({ display, active: pv?.active || st?.model?.provider || 'local', spend: sp })
  }, [])

  useEffect(() => {
    load()
    const on = () => load()
    window.addEventListener('openlex:setup-changed', on)
    window.addEventListener('focus', on)
    hubBridge()?.onEvent((ev) => { if (ev.type === 'provider-changed') load() })
    const timer = setInterval(load, 60000)
    return () => { window.removeEventListener('openlex:setup-changed', on); window.removeEventListener('focus', on); clearInterval(timer) }
  }, [load])

  if (!info) return null
  const { display, spend } = info
  const local = display.local
  const level = spend?.level || 'ok'
  // The 80 % notice, once per month and level.
  const warnKey = spend && level !== 'ok' ? `${spend.month}:${level}` : ''
  const showWarn = !local && warnKey && warned.current !== warnKey
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        title={t('modelPicker.labelHint', 'Which AI answers, and where it runs. Click to change (/model).')}
        className="inline-flex items-center gap-1.5 rounded-button border border-tobacco px-2.5 py-1 text-parchment hover:border-accent hover:text-cream"
      >
        {local ? <Cpu size={12} className="text-forest" /> : display.viaUs ? <AlertTriangle size={12} className="text-amber-400" /> : <Cloud size={12} className="text-antique" />}
        <span>{display[lang] || display.en}</span>
        <ChevronDown size={12} />
      </button>
      <button type="button" onClick={() => setSpendOpen(true)} className={`py-1 underline-offset-2 hover:underline ${level === 'stop' ? 'text-red-400' : level === 'warn' ? 'text-amber-400' : 'text-antique'}`}>
        {local
          ? t('modelPicker.free', 'free (on this computer)')
          : spend?.cap
            ? t('modelPicker.spendOfCap', '{{spent}} of {{cap}} this month', { spent: euro(spend.total, lang), cap: euro(spend.cap, lang) })
            : t('modelPicker.spendNoCap', '{{spent}} this month', { spent: euro(spend?.total || 0, lang) })}
      </button>
      {!local && <button type="button" onClick={() => setAbout(true)} className="py-1 text-antique underline hover:text-cream">{t('modelPicker.aboutData', 'About data')}</button>}
      {showWarn && (
        <span role="status" className={level === 'stop' ? 'text-red-400' : 'text-amber-400'}>
          {level === 'stop'
            ? t('modelPicker.capReached', 'This month\'s limit for online AI is reached: online AI is paused. Use the AI on this computer, or raise the limit.')
            : t('modelPicker.capNear', 'Most of this month\'s limit for online AI is used.')}{' '}
          <button type="button" className="underline" onClick={() => { warned.current = warnKey; setSpendOpen(true) }}>{t('modelPicker.details', 'Details')}</button>
        </span>
      )}
      {about && (
        <Modal title={t('modelPicker.aboutTitle', 'About data')} onClose={() => setAbout(false)}>
          <CloudNotice provider={info.active} />
        </Modal>
      )}
      {spendOpen && (
        <Modal title={t('modelPicker.spendTitle', 'Spending on online AI')} onClose={() => { setSpendOpen(false); load() }}>
          <SpendDetails onLocal={() => { setSpendOpen(false); onOpen() }} />
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    box.current?.querySelector<HTMLElement>('button, input')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // A portal: the label sits inside the question form, the dialog must not.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]" onSubmit={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 bg-ink/70" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-lg rounded-card border border-tobacco bg-deep-brown shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-tobacco">
          <h2 className="font-serif text-lg text-parchment">{title}</h2>
          <button type="button" onClick={onClose} className="text-antique hover:text-cream" aria-label={t('common.close', 'Close')}><X size={18} /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-4 text-sm">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ── the cloud notice ───────────────────────────────────────────────────────

/** Who receives the data, in short; the rest behind "Details". With onAccept: the once-per-service question. */
export function CloudNotice({ provider, onAccept, onCancel }: { provider: string; onAccept?: () => void; onCancel?: () => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [n, setN] = useState<Notice | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    call('GET', `/api/providers/notice?provider=${encodeURIComponent(provider)}`).then((r) => setN(r.notice)).catch((err) => setError(friendly(err)))
  }, [provider])
  if (error) return <p className="text-red-400">{error}</p>
  if (n === undefined) return <p className="text-antique">{t('common.loading', 'Loading…')}</p>
  if (n === null) return <p className="text-parchment">{t('modelPicker.staysHere', 'The AI runs on this computer. Nothing is sent anywhere.')}</p>
  const x = n[lang] || n.en
  const accept = async () => {
    try { await call('POST', '/api/providers/notice', { provider }); onAccept?.() } catch (err) { setError(friendly(err)) }
  }
  return (
    <div className="space-y-3">
      <h3 className="text-cream font-medium">{x.title}</h3>
      <p className="text-parchment">{x.summary}</p>
      {x.usGateway && <p className="flex gap-2 text-amber-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {x.usGateway}</p>}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-antique hover:text-cream">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {t('modelPicker.noticeDetails', 'Details: settings, CLOUD Act, professional rules')}
      </button>
      {open && (
        <div className="space-y-2 text-xs text-parchment/90 border-l border-tobacco pl-3">
          {x.details.map((d, i) => <p key={i}>{d}</p>)}
          <p>{x.checksIntro}</p>
          <ul className="list-disc pl-5 space-y-0.5">{x.checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <p>{x.closing}</p>
        </div>
      )}
      {onAccept && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-primary !py-1.5 text-sm" onClick={accept}>{x.accept}</button>
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={onCancel}>{t('common.cancel', 'Cancel')}</button>
        </div>
      )}
    </div>
  )
}

// ── spending ───────────────────────────────────────────────────────────────

function SpendDetails({ onLocal }: { onLocal: () => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [s, setS] = useState<Spend | null>(null)
  const [cap, setCap] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [matters, setMatters] = useState<Record<string, string>>({})
  const load = useCallback(() => {
    call('GET', '/api/spend').then((r: Spend) => { setS(r); setCap(r.cap ? String(r.cap) : '') }).catch((err) => setMsg({ text: friendly(err), bad: true }))
    call('GET', '/api/matters').then((r) => setMatters(Object.fromEntries((r.matters || []).map((m: any) => [m.id, m.title])))).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])
  if (!s) return <p className="text-antique">{msg?.text || t('common.loading', 'Loading…')}</p>
  const save = async (value: number | null) => {
    try {
      const r = await call('POST', '/api/spend/cap', { cap: value })
      if (r?.error) return setMsg({ text: r.error, bad: true })
      setS(r); setMsg({ text: value ? t('modelPicker.capSaved', 'Limit saved: {{cap}} a month.', { cap: euro(value, lang) }) : t('modelPicker.capRemoved', 'No monthly limit.') }); changed()
    } catch (err) { setMsg({ text: friendly(err), bad: true }) }
  }
  const submitCap = () => { const v = parseFloat(cap.replace(',', '.')); save(cap.trim() ? v : null) }
  return (
    <div className="space-y-4">
      <div>
        <div className="text-cream text-base">{s.cap ? t('modelPicker.spendOfCap', '{{spent}} of {{cap}} this month', { spent: euro(s.total, lang), cap: euro(s.cap, lang) }) : t('modelPicker.spendNoCap', '{{spent}} this month', { spent: euro(s.total, lang) })}</div>
        {s.cap ? (
          <div className="mt-1 h-2 rounded bg-tobacco/40 overflow-hidden" aria-hidden="true">
            <div className={`h-full ${s.level === 'stop' ? 'bg-red-500' : s.level === 'warn' ? 'bg-amber-500' : 'bg-forest'}`} style={{ width: `${Math.min(100, Math.round(s.ratio * 100))}%` }} />
          </div>
        ) : null}
        {s.level === 'stop' && (
          <p className="mt-2 text-red-400">
            {t('modelPicker.capStopped', 'Online AI is paused until next month or until the limit is raised.')}{' '}
            <button type="button" className="underline" onClick={onLocal}>{t('modelPicker.useLocal', 'Use the AI on this computer')}</button>
          </p>
        )}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-antique/80 mb-1">{t('modelPicker.byModel', 'By AI service')}</div>
        {!s.byModel.length && <p className="text-antique">{t('modelPicker.nothingSpent', 'Nothing spent this month. The AI on this computer is free.')}</p>}
        <ul className="space-y-0.5">
          {s.byModel.map((m) => (
            <li key={`${m.provider}|${m.model}`} className="flex gap-2">
              <span className="flex-1 text-parchment">{m.provider}{m.model ? <span className="text-antique"> · {m.model}</span> : null}</span>
              <span className="text-antique tabular-nums">{t('modelPicker.calls', '{{n}} calls', { n: m.calls })}</span>
              <span className="text-cream tabular-nums w-20 text-right">{euro(m.cost, lang)}{m.estimatedTokens || !m.priceKnown ? '*' : ''}</span>
            </li>
          ))}
        </ul>
      </div>

      {s.byMatter.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-antique/80 mb-1">{t('modelPicker.byMatter', 'By matter')}</div>
          <ul className="space-y-0.5">
            {s.byMatter.map((m) => (
              <li key={m.matterId || '-'} className="flex gap-2">
                <span className="flex-1 text-parchment">{m.matterId ? matters[m.matterId] || m.matterId : t('modelPicker.noMatter', 'Without a matter')}</span>
                <span className="text-cream tabular-nums w-20 text-right">{euro(m.cost, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-cream" htmlFor="spend-cap">{t('modelPicker.capLabel', 'Monthly limit for online AI (euros)')}</label>
        {s.locked ? (
          <p className="text-antique">{s.cap ? t('modelPicker.capLockedAt', 'Your firm has set the limit to {{cap}}.', { cap: euro(s.cap, lang) }) : t('modelPicker.capLocked', 'Your firm manages this limit.')}</p>
        ) : (
          <div className="flex gap-2">
            <input id="spend-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCap() } }} placeholder={t('modelPicker.capNone', 'no limit')} className="input w-32" />
            <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={submitCap}>{t('modelPicker.capSave', 'Save the limit')}</button>
          </div>
        )}
        <p className="text-xs text-antique">{t('modelPicker.capHelp', 'At 80 % you see a notice; at 100 % online AI stops until next month. The AI on this computer always works.')}</p>
      </div>
      {msg && <p className={msg.bad ? 'text-red-400' : 'text-forest'}>{msg.text}</p>}
      <p className="text-[11px] text-antique/80">* {t('modelPicker.estimates', 'Estimates from the providers\' published prices (dated, in the engine\'s price list), not a bill. Your invoice decides.')}</p>
    </div>
  )
}

// ── the picker ─────────────────────────────────────────────────────────────

const GROUP_WORDS: Record<string, [string, string]> = {
  local: ['On this computer', 'Most private: nothing leaves this computer.'],
  recommended: ['Recommended for fast, high-quality work', 'Claude in your firm\'s own AWS account, EU data centres only, storage switched off.'],
  eu: ['EU providers without a US parent company', 'Your text goes to a European company.'],
  'firm-cloud': ['Your firm\'s own cloud, EU region', 'Microsoft or Google; US companies.'],
  gateway: ['OpenRouter', 'Many models with one key; strict settings are always on.'],
  direct: ['Directly from the model makers', 'US companies; data may leave the EU.'],
  other: ['Other', 'A server your firm runs.'],
}

/** /model: choose where the AI runs. `pick`: a provider to go straight to (e.g. "/model scaleway"). */
export function ModelPicker({ onDone, pick }: { onDone: (text: string) => void; pick?: string }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [list, setList] = useState<PickerProvider[] | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [active, setActive] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [notice, setNotice] = useState<PickerProvider | null>(null)
  const [error, setError] = useState('')
  const picked = useRef(false)

  const load = useCallback(async () => {
    const r = await call('GET', '/api/providers')
    setList(r.providers || [])
    setGroups(r.groups || ['local', 'recommended', 'eu', 'firm-cloud', 'gateway', 'direct', 'other'])
    setActive(r.active)
    return r.providers as PickerProvider[]
  }, [])

  const nameOf = (p: PickerProvider) => (p.kind === 'local' ? t('modelPicker.builtin', 'OpenLex\'s own AI') : two(p.labels, lang) || p.label)

  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const activate = async (p: PickerProvider) => {
    try {
      await call('POST', '/api/providers', { active: p.id })
      changed()
      doneRef.current(t('commands.nowUsing', 'Now using {{name}}. This applies from your next question.', { name: p.local ? t('commands.thisComputer', 'the AI on this computer') : two(p.labels, lang) || p.label }))
    } catch (err) { setError(friendly(err)) }
  }

  const needsSetup = (p: PickerProvider) => (p.needsKey && !p.hasKey) || ((p.id === 'azure' || p.id === 'custom') && !p.baseUrl) || (p.id === 'vertex' && !p.project) || (p.id === 'local-server' && !p.model)

  const choose = (p: PickerProvider) => {
    setError('')
    if (p.blocked || needsSetup(p)) { setOpen(p.id); return }
    if (!p.local && !p.noticeSeen) { setNotice(p); return }
    activate(p)
  }
  const chooseRef = useRef(choose)
  chooseRef.current = choose

  useEffect(() => {
    load().then((ps) => {
      if (pick && !picked.current) {
        picked.current = true
        const p = ps.find((x) => x.id === pick)
        if (p) chooseRef.current(p)
      }
    }).catch((err) => setError(friendly(err)))
  }, [load, pick])

  if (!list) return <p className={error ? 'text-red-400' : 'text-antique'}>{error || t('common.loading', 'Loading…')}</p>
  if (notice) {
    return <CloudNotice provider={notice.id} onAccept={() => { const p = notice; setNotice(null); activate({ ...p, noticeSeen: true }) }} onCancel={() => setNotice(null)} />
  }
  const inUse = list.find((p) => p.id === active)
  return (
    <div className="space-y-4">
      {inUse && (
        <div className="flex items-center gap-2 rounded-button border border-forest/40 bg-forest/5 px-3 py-2" data-testid="model-in-use">
          <Check size={16} className="text-forest shrink-0" />
          <span className="flex-1 min-w-0 text-cream">{t('modelPicker.inUseNow', 'In use: {{name}}', { name: inUse.display ? (inUse.display[lang] || inUse.display.en) : nameOf(inUse) })}</span>
          <span className="text-xs text-antique">{t('modelPicker.changeBelow', 'choose another below')}</span>
        </div>
      )}
      {groups.map((g) => {
        const items = list.filter((p) => p.group === g)
        if (!items.length) return null
        const [title, sub] = GROUP_WORDS[g] || [g, '']
        return (
          <section key={g} aria-label={t(`modelPicker.group.${g}`, title)}>
            <div className="mb-1">
              <div className="text-xs uppercase tracking-wide text-accent/90">{t(`modelPicker.group.${g}`, title)}</div>
              {sub && <div className="text-[11px] text-antique">{t(`modelPicker.groupSub.${g}`, sub)}</div>}
            </div>
            <ul className="space-y-0.5">
              {items.map((p) => {
                const isActive = p.id === active
                const noKey = p.needsKey && !p.hasKey
                return (
                  <li key={p.id} className={`rounded ${isActive ? 'bg-accent/10' : ''}`}>
                    <div className="flex items-start gap-2 px-2 py-1.5">
                      <button type="button" onClick={() => choose(p)} className="flex-1 flex items-start gap-2 text-left outline-none focus:underline">
                        {p.local ? <Cpu size={15} className="text-forest mt-0.5 shrink-0" /> : <Cloud size={15} className="text-antique mt-0.5 shrink-0" />}
                        <span className="flex-1">
                          <span className="text-cream">{nameOf(p)}</span>
                          {p.about && <span className="block text-xs text-antique">{two(p.about, lang)}</span>}
                          <span className="block text-[11px] text-antique/90">
                            {p.local ? (p.id === 'local-server' && p.model ? p.display[lang] : '') : noKey ? t('modelPicker.needsKey', 'Needs a key first') : p.needsKey ? t('modelPicker.keySaved', 'Key saved') : ''}
                            {p.id === 'bedrock' && p.hasKey ? ` · ${p.retention?.confirmed ? t('modelPicker.zdrOn', 'Zero retention: on') : t('modelPicker.zdrUnconfirmed', 'Zero retention: not confirmed')}` : ''}
                          </span>
                          {p.id === 'openrouter' && p.plan !== 'business' && <span className="block text-[11px] text-amber-400">{t('modelPicker.orUsNote', 'Requests pass through the US: use only for anonymised or public-law work.')}</span>}
                          {p.blocked && <span className="block text-[11px] text-red-400">{two(p.blocked, lang)}</span>}
                        </span>
                      </button>
                      {p.kind !== 'local' && (
                        <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="text-antique hover:text-cream p-1" title={t('modelPicker.setup', 'Key and settings')} aria-label={t('modelPicker.setupFor', 'Key and settings for {{name}}', { name: nameOf(p) })}>
                          <Settings2 size={14} />
                        </button>
                      )}
                      {isActive && <Check size={16} className="text-forest mt-0.5" aria-label={t('modelPicker.inUse', 'in use')} />}
                    </div>
                    {open === p.id && <ProviderSetup p={p} onChanged={load} onUse={async () => { const fresh = (await load()).find((x) => x.id === p.id); if (fresh) choose(fresh) }} />}
                  </li>
                )
              })}
            </ul>
            {g === 'local' && <LocalModels onDone={onDone} />}
          </section>
        )
      })}
      {error && <p className="text-red-400">{error}</p>}
      <p className="text-xs text-antique">{t('modelPicker.ruleNote', 'Client data still follows your rule for each matter (/data): a cloud service gets nothing until that rule allows it.')}</p>
    </div>
  )
}

// ── key and settings for one service ───────────────────────────────────────

export function ProviderSetup({ p, onChanged, onUse }: { p: PickerProvider; onChanged: () => Promise<unknown>; onUse: () => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(p.baseUrl || '')
  const [model, setModel] = useState(p.model || '')
  const [project, setProject] = useState(p.project || '')
  const [inside, setInside] = useState(false)
  const [business, setBusiness] = useState(p.plan === 'business')
  const [euOnly, setEuOnly] = useState(p.euProviders !== false)
  const [models, setModels] = useState<string[]>(p.models || [])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [manual, setManual] = useState<{ command: string; en: string; de: string } | null>(null)
  const [retention, setRetention] = useState(p.retention || null)
  const name = two(p.labels, lang) || p.label
  const showUrl = p.id === 'azure' || p.id === 'custom' || p.id === 'local-server'
  const showModel = p.id !== 'azure'
  const showKey = p.needsKey || p.id === 'custom' || p.id === 'vertex'

  const overrides = () => {
    const o: Record<string, unknown> = {}
    if (showUrl && baseUrl.trim()) o.baseUrl = baseUrl.trim()
    if (showModel && model.trim()) o.model = model.trim()
    if (p.id === 'vertex' && project.trim()) o.project = project.trim()
    if (p.id === 'custom') o.local = inside
    if (p.id === 'openrouter') { o.plan = business ? 'business' : 'standard'; o.euProviders = euOnly }
    return o
  }

  const save = async () => {
    const o = overrides()
    if (Object.keys(o).length) await call('POST', '/api/providers', { provider: p.id, overrides: o })
    if (key.trim()) {
      const r = await call('POST', '/api/providers/key', { provider: p.id, key: key.trim() })
      if (r?.error) throw new Error(r.error)
      setKey('')
    }
    await onChanged()
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null)
    try { await fn() } catch (err) { setMsg({ text: friendly(err), bad: true }) }
    setBusy('')
  }

  const test = () => run(t('modelPicker.testing', 'Checking…'), async () => {
    await save()
    const r = await call('POST', '/api/providers/test', { provider: p.id })
    if (!r?.ok) return setMsg({ text: friendly(r?.error || 'the check did not work'), bad: true })
    if (Array.isArray(r.models) && r.models.length) setModels(r.models)
    if (r.retention) setRetention(r.retention)
    setMsg({ text: r.models?.length ? t('modelPicker.testOkModels', 'Connected: the key works. {{n}} models are available.', { n: r.models.length }) : t('modelPicker.testOk', 'Connected: the key works.') })
  })

  const zdr = () => run(t('modelPicker.zdrSetting', 'Switching on zero retention…'), async () => {
    await save()
    const r = await call('POST', '/api/providers/retention', { provider: 'bedrock' })
    if (r?.mode !== undefined) setRetention({ mode: r.mode, confirmed: !!r.confirmed, checkedAt: r.checkedAt })
    if (r?.manual) setManual(r.manual)
    if (r?.ok) { setManual(null); setMsg({ text: t('modelPicker.zdrDone', 'Zero retention is on: AWS keeps nothing of what you send in {{region}}.', { region: p.region || 'eu-central-1' }) }) }
    else if (r?.error && !r.manual) setMsg({ text: friendly(r.error), bad: true })
    await onChanged()
  })

  const zdrCheck = () => run(t('modelPicker.testing', 'Checking…'), async () => {
    const r = await call('GET', '/api/providers/retention?provider=bedrock')
    if (!r?.ok) return setMsg({ text: friendly(r?.error || 'the check did not work'), bad: true })
    setRetention({ mode: r.mode, confirmed: !!r.confirmed, checkedAt: r.checkedAt })
    if (r.confirmed) setManual(null)
    await onChanged()
  })

  const removeKey = () => run('', async () => { await call('POST', '/api/providers/key', { provider: p.id, key: null }); await onChanged(); setMsg({ text: t('modelPicker.keyRemoved', 'Key removed from this computer\'s keychain.') }) })

  return (
    <form className="mx-2 mb-2 space-y-2 rounded border border-tobacco/70 bg-ink/20 p-3" onSubmit={(e) => { e.preventDefault(); run('', async () => { await save(); onUse() }) }}>
      {p.blocked && <p className="text-red-400 text-xs">{two(p.blocked, lang)}</p>}
      {p.id === 'bedrock' && (
        <ol className="list-decimal pl-5 text-xs text-parchment/90 space-y-0.5">
          <li>{t('modelPicker.bedrockStep1', 'In your firm\'s AWS account, choose the region Europe (Frankfurt), open Amazon Bedrock and submit the one-time form for Anthropic models.')}</li>
          <li>{t('modelPicker.bedrockStep2', 'Make a Bedrock API key in Frankfurt and paste it below.')}</li>
          <li>{t('modelPicker.bedrockStep3', 'Switch on zero retention (button below).')}</li>
          <li>{t('modelPicker.bedrockStep4', 'Set an AWS Budget too (Billing → Budgets: a monthly amount with alerts at 50, 80 and 100 %), so AWS warns you even outside OpenLex.')}</li>
        </ol>
      )}
      {p.id === 'bedrock' && <p className="text-xs text-antique">{t('modelPicker.bedrockRegion', 'Region: eu-central-1 (Frankfurt), fixed — called from there, Claude runs only in EU data centres.')}</p>}
      {showKey && (
        <div>
          <label className="block text-xs text-cream" htmlFor={`key-${p.id}`}>{p.id === 'vertex' ? t('modelPicker.vertexKey', 'Service-account key (JSON), optional') : p.id === 'custom' ? t('modelPicker.keyOptional', 'Key (optional)') : t('commands.yourKey', 'Your {{name}} key', { name })}</label>
          {p.id === 'vertex'
            ? <textarea id={`key-${p.id}`} rows={2} value={key} onChange={(e) => setKey(e.target.value)} className="input w-full text-xs font-mono" autoComplete="off" placeholder={p.hasKey ? t('modelPicker.keyKeep', 'saved — paste a new one to replace it') : ''} />
            : <input id={`key-${p.id}`} type="password" value={key} onChange={(e) => setKey(e.target.value)} className="input w-full" autoComplete="off" placeholder={p.hasKey ? t('modelPicker.keyKeep', 'saved — paste a new one to replace it') : ''} />}
          <p className="text-[11px] text-antique mt-0.5">{p.keyHelp ? `${two(p.keyHelp, lang)} ` : ''}{t('commands.keyKept', 'It is kept in this computer\'s keychain and only sent to {{name}}.', { name })}</p>
        </div>
      )}
      {showUrl && (
        <div>
          <label className="block text-xs text-cream" htmlFor={`url-${p.id}`}>{p.id === 'local-server' ? t('modelPicker.localAddress', 'Address of the AI program on this computer') : t('modelPicker.address', 'Address of the server')}</label>
          <input id={`url-${p.id}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="input w-full text-xs font-mono" placeholder={p.id === 'azure' ? 'https://NAME.openai.azure.com/openai/deployments/DEPLOYMENT' : 'http://127.0.0.1:11434/v1'} />
          {p.id === 'local-server' && (
            <div className="mt-1 flex gap-2 text-[11px]">
              <button type="button" className="underline text-antique hover:text-cream" onClick={() => setBaseUrl('http://127.0.0.1:11434/v1')}>Ollama</button>
              <button type="button" className="underline text-antique hover:text-cream" onClick={() => setBaseUrl('http://127.0.0.1:8080/v1')}>llama.cpp</button>
            </div>
          )}
        </div>
      )}
      {p.id === 'vertex' && (
        <div>
          <label className="block text-xs text-cream" htmlFor="vertex-project">{t('modelPicker.project', 'Google Cloud project name (ID)')}</label>
          <input id="vertex-project" value={project} onChange={(e) => setProject(e.target.value)} className="input w-full" />
        </div>
      )}
      {showModel && (
        <div>
          <label className="block text-xs text-cream" htmlFor={`model-${p.id}`}>{t('modelPicker.model', 'Model')}</label>
          <input id={`model-${p.id}`} list={`models-${p.id}`} value={model} onChange={(e) => setModel(e.target.value)} className="input w-full text-xs font-mono" />
          <datalist id={`models-${p.id}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
          {p.id === 'bedrock' && <p className="text-[11px] text-antique mt-0.5">{t('modelPicker.bedrockModels', 'eu.anthropic.claude-sonnet-5-5 for everyday work; eu.anthropic.claude-opus-5-5 for hard tasks.')}</p>}
        </div>
      )}
      {p.id === 'custom' && (
        <label className="flex items-start gap-2 text-xs text-parchment">
          <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} className="mt-0.5" />
          {t('modelPicker.inside', 'This server is run by my firm, inside the firm (nothing leaves the firm).')}
        </label>
      )}
      {p.id === 'openrouter' && (
        <div className="space-y-1 text-xs text-parchment">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={business} onChange={(e) => setBusiness(e.target.checked)} className="mt-0.5" />
            {t('modelPicker.orBusiness', 'My firm has an OpenRouter Business plan (requests stay in the EU).')}
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={euOnly} onChange={(e) => setEuOnly(e.target.checked)} className="mt-0.5" />
            {t('modelPicker.orEuHosts', 'Only model hosts in the EU (recommended).')}
          </label>
          <p className="text-antique">{t('modelPicker.orAlways', 'Always on: zero data retention, no providers that store or train on data, no switching to other providers.')}</p>
          {!business && <p className="text-amber-400">{t('modelPicker.orUsNote', 'Requests pass through the US: use only for anonymised or public-law work.')}</p>}
        </div>
      )}
      {p.id === 'bedrock' && p.hasKey && (
        <div className="space-y-1 text-xs">
          <p className={retention?.confirmed ? 'text-forest' : 'text-amber-400'}>
            {retention?.confirmed ? `✓ ${t('modelPicker.zdrOn', 'Zero retention: on')}` : `! ${t('modelPicker.zdrUnconfirmed', 'Zero retention: not confirmed')}`}
            {retention?.mode && !retention.confirmed ? ` (${retention.mode})` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {!retention?.confirmed && <button type="button" disabled={!!busy} className="btn-secondary !py-1 text-xs" onClick={zdr}>{t('modelPicker.zdrSet', 'Switch on zero retention')}</button>}
            <button type="button" disabled={!!busy} className="text-antique underline hover:text-cream" onClick={zdrCheck}>{t('modelPicker.checkAgain', 'Check again')}</button>
          </div>
          {manual && (
            <div className="space-y-1">
              <p className="text-parchment">{manual[lang] || manual.en}</p>
              <pre className="whitespace-pre-wrap break-all rounded bg-ink/60 p-2 text-[11px] text-cream select-all">{manual.command}</pre>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={!!busy || !!p.blocked} className="btn-primary !py-1.5 text-sm">{t('modelPicker.use', 'Use {{name}}', { name })}</button>
        <button type="button" disabled={!!busy} className="btn-secondary !py-1.5 text-sm" onClick={test}>{t('modelPicker.test', 'Test the connection')}</button>
        {p.needsKey && p.hasKey && <button type="button" disabled={!!busy} className="text-xs text-antique underline hover:text-cream" onClick={removeKey}>{t('modelPicker.removeKey', 'Remove the key')}</button>}
        {busy && <span className="text-xs text-antique">{busy}</span>}
      </div>
      <p className="text-[11px] text-antique">{t('modelPicker.testNote', 'The test sends no text from your documents: it only checks that the service accepts the key.')}</p>
      {msg && <p className={`text-xs ${msg.bad ? 'text-red-400' : 'text-forest'}`}>{msg.text}</p>}
    </form>
  )
}

// ── on this computer: the models there, a download, install steps ──────────

function LocalModels({ onDone }: { onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [models, setModels] = useState<LocalModel[] | null>(null)
  const [det, setDet] = useState<Detect | null>(null)
  const [showDownload, setShowDownload] = useState(false)
  const [busy, setBusy] = useState('')
  const [pull, setPull] = useState<{ model: string; percent: number | null; status: string; id: string } | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<LocalModel | null>(null)

  const load = useCallback(async () => {
    const [m, d] = await Promise.all([call('GET', '/api/local/models').catch(() => ({ models: [] })), call('GET', '/api/local/detect').catch(() => null)])
    setModels(m.models || [])
    setDet(d)
  }, [])
  useEffect(() => { load() }, [load])

  const use = async (m: LocalModel) => {
    setBusy(m.runtime === 'gguf' ? t('modelPicker.switchingSlow', 'Switching to {{name}}… about 20 s', { name: m.title }) : t('modelPicker.switching', 'Switching to {{name}}…', { name: m.title }))
    setMsg(null)
    try {
      const r = await call('POST', '/api/local/use', { id: m.id })
      if (r?.error) throw new Error(r.error)
      changed()
      onDone(t('modelPicker.nowLocal', 'Now using {{name}} on this computer. Nothing leaves this computer.', { name: m.title }))
    } catch (err) { setMsg({ text: friendly(err), bad: true }) }
    setBusy('')
  }

  const remove = async (m: LocalModel) => {
    setConfirmRemove(null)
    setBusy(t('modelPicker.removing', 'Removing {{name}}…', { name: m.title }))
    try {
      const r = await call('POST', '/api/local/remove', { id: m.id })
      if (r?.error) throw new Error(r.error)
      setMsg({ text: t('modelPicker.removed', '{{name}} removed{{freed}}.', { name: m.title, freed: r.freedGb ? t('modelPicker.freed', ' ({{gb}} GB freed)', { gb: r.freedGb }) : '' }) })
      await load()
    } catch (err) { setMsg({ text: friendly(err), bad: true }) }
    setBusy('')
  }

  const download = async (name: string) => {
    const e = engine()
    if (!e?.stream) return
    const id = `pull-${Date.now().toString(36)}`
    setPull({ model: name, percent: 0, status: '', id })
    setMsg(null)
    let done: string | null = null
    let failed = ''
    try {
      await e.stream('/api/local/pull', { model: name }, (ev: any) => {
        if (ev.type === 'progress') setPull((p) => (p ? { ...p, percent: ev.percent ?? p.percent, status: ev.status || '' } : p))
        else if (ev.type === 'done') done = ev.model
        else if (ev.type === 'error') failed = ev.message
      }, id)
    } catch (err) { failed = friendly(err) }
    setPull(null)
    if (done) {
      changed()
      onDone(t('modelPicker.downloaded', '{{name}} is downloaded and in use. Nothing leaves this computer.', { name: done }))
      return
    }
    setMsg({ text: failed || t('modelPicker.downloadStopped', 'Download stopped.'), bad: !!failed })
    load()
  }
  const stopPull = () => { if (pull) engine()?.stop?.(pull.id) }

  if (!models) return null
  return (
    <div className="mt-2 ml-2 space-y-2">
      {models.length > 0 && (
        <div>
          <div className="text-[11px] text-antique mb-0.5">{t('modelPicker.installed', 'Models on this computer')}</div>
          <ul className="space-y-0.5">
            {models.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-xs">
                <button type="button" disabled={!!busy || m.active} onClick={() => use(m)} className="flex-1 text-left disabled:cursor-default">
                  <span className="text-cream">{m.title}</span>
                  <span className="text-antique"> · {m.sizeGb ? `${m.sizeGb} GB` : ''} {m.runtime === 'ollama' ? '(Ollama)' : '(llama.cpp)'}</span>
                  <span className="block text-antique/90">{two(m.goodFor, lang)}</span>
                </button>
                {m.active
                  ? <span className="text-forest inline-flex items-center gap-1"><Check size={13} /> {t('modelPicker.inUse', 'in use')}</span>
                  : (
                    <>
                      <button type="button" disabled={!!busy} onClick={() => use(m)} className="underline text-antique hover:text-cream">{t('modelPicker.switchTo', 'Use')}</button>
                      <button type="button" disabled={!!busy} onClick={() => setConfirmRemove(m)} className="text-antique hover:text-red-400" aria-label={t('modelPicker.removeModel', 'Remove {{name}}', { name: m.title })} title={t('modelPicker.removeModel', 'Remove {{name}}', { name: m.title })}><Trash2 size={13} /></button>
                    </>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmRemove && (
        <div role="alertdialog" className="rounded border border-red-500/40 bg-red-500/5 p-2 text-xs space-y-1">
          <p className="text-parchment">{t('modelPicker.removeAsk', 'Remove {{name}} from this computer to free {{gb}} GB? You can download it again later.', { name: confirmRemove.title, gb: confirmRemove.sizeGb ?? '?' })}</p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => remove(confirmRemove)}>{t('modelPicker.removeYes', 'Remove')}</button>
            <button type="button" className="text-antique underline" onClick={() => setConfirmRemove(null)}>{t('common.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}
      {pull ? (
        <div className="text-xs space-y-1" aria-live="polite">
          <div className="text-parchment">{t('modelPicker.downloading', 'Downloading {{name}}…', { name: pull.model })} {pull.percent != null ? `${pull.percent} %` : ''}</div>
          <div className="h-2 rounded bg-tobacco/40 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pull.percent || 0}%` }} /></div>
          <button type="button" onClick={stopPull} className="underline text-antique hover:text-cream">{t('modelPicker.stop', 'Stop')}</button>
        </div>
      ) : (
        <button type="button" disabled={!!busy} onClick={() => { setShowDownload(!showDownload); if (!showDownload) load() }} aria-expanded={showDownload} className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-cream">
          <Download size={13} /> {t('modelPicker.downloadLocal', 'Download a local model')}
        </button>
      )}
      {showDownload && !pull && det && <LocalDownload det={det} onDownload={download} onRecheck={load} />}
      {busy && <p className="text-xs text-antique" aria-live="polite">{busy}</p>}
      {msg && <p className={`text-xs ${msg.bad ? 'text-red-400' : 'text-forest'}`}>{msg.text}</p>}
    </div>
  )
}

function LocalDownload({ det, onDownload, onRecheck }: { det: Detect; onDownload: (name: string) => void; onRecheck: () => void }) {
  const { t } = useTranslation()
  const rec = det.recommended
  const others = det.options.filter((o) => o.name !== rec.name && o.fits && !o.installed)
  return (
    <div className="rounded border border-tobacco/70 bg-ink/20 p-3 text-xs space-y-2">
      <p className="text-parchment">{t('modelPicker.memory', 'This computer has {{gb}} GB of memory. Suggested: {{name}} ({{size}} GB download).', { gb: det.ramGb, name: rec.title, size: rec.sizeGb })}</p>
      {det.ollama.running ? (
        <>
          <p className="text-forest">✓ {t('modelPicker.ollamaRunning', 'Ollama is running on this computer.')}</p>
          {rec.installed
            ? <p className="text-antique">{t('modelPicker.recInstalled', '{{name}} is already downloaded: choose it in the list above.', { name: rec.title })}</p>
            : <button type="button" className="btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5" onClick={() => onDownload(rec.name)}><Download size={14} /> {t('modelPicker.downloadRec', 'Download {{name}}', { name: rec.title })}</button>}
          {others.length > 0 && (
            <p className="text-antique">
              {t('modelPicker.orSmaller', 'Or:')}{' '}
              {others.map((o, i) => <span key={o.name}>{i ? ', ' : ''}<button type="button" className="underline hover:text-cream" onClick={() => onDownload(o.name)}>{o.title} ({o.sizeGb} GB)</button></span>)}
            </p>
          )}
        </>
      ) : det.ollama.installed ? (
        <p className="text-amber-400">{t('modelPicker.ollamaStopped', 'Ollama is installed but not running. Open the Ollama app, then click "Check again".')}</p>
      ) : null}
      {det.llamacpp.installed && (
        <div className="space-y-1">
          <p className="text-forest">✓ {t('modelPicker.llamaInstalled', 'llama.cpp is installed. Start it in a terminal with this line, then choose "Ollama or llama.cpp on this computer" above and its llama.cpp address:')}</p>
          <pre className="whitespace-pre-wrap break-all rounded bg-ink/60 p-2 text-[11px] text-cream select-all">{det.llamacpp.command}</pre>
        </div>
      )}
      {!det.ollama.installed && !det.llamacpp.installed && (
        <div className="space-y-1">
          <p className="text-parchment">{t('modelPicker.installIntro', 'To run an AI on this computer, install a free AI program first. OpenLex does not install programs itself.')}</p>
          <ol className="list-decimal pl-5 space-y-0.5 text-parchment/90">
            <li>{t('modelPicker.install1', 'Download Ollama from')} <button type="button" className="underline text-accent hover:text-cream" onClick={() => openLink(det.install.ollama)}>ollama.com/download</button> {t('modelPicker.install1b', 'and install it.')}</li>
            <li>{t('modelPicker.install2', 'Open Ollama once, so it runs in the background.')}</li>
            <li>{t('modelPicker.install3', 'Come back here and click "Check again".')}</li>
          </ol>
          {det.install.brew && <p className="text-antique">{t('modelPicker.installBrew', 'If you use Homebrew, llama.cpp works too:')} <code className="text-cream select-all">{det.install.brew}</code></p>}
        </div>
      )}
      <button type="button" className="underline text-antique hover:text-cream" onClick={onRecheck}>{t('modelPicker.checkAgain', 'Check again')}</button>
    </div>
  )
}
