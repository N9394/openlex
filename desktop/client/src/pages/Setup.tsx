// First start (and Settings → AI → "Set up the AI step by step"): three
// ways to get an AI, without needing one to read this page.
//   1 On this computer: a model sized to this computer through Ollama
//     (detected, downloaded with progress, then used); plain steps when
//     Ollama is not installed. OpenLex installs no programs itself.
//   2 I brought my own key: the services in the recommended order (AWS
//     Bedrock in the EU first), paste the key, OpenLex tests it, Bedrock's
//     zero retention is checked; the cloud notice is shown once.
//   3 I need help: the step-by-step guide, or book a setup call.
// The page is shown when no AI is set up (see needsSetup); "Not now" hides
// it until the App is started again.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarClock, Check, ChevronDown, ChevronRight, Cpu, Download, KeyRound, LifeBuoy } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'
import { CLOUD_KEY_GUIDE_URL, SETUP_CALL_URL, openLink } from '../lib/links'
import { CloudNotice, Detect, PickerProvider, ProviderSetup, useLang } from '../components/ModelPicker'

const SKIP_KEY = 'openlex-setup-skipped'
/** The services offered for "my own key", in this order; the rest under "More services". */
const KEY_ORDER = ['bedrock', 'mistral', 'ionos', 'edenai', 'openrouter', 'anthropic', 'openai']

/** True when no AI can answer yet: the chosen service has no key, or nothing runs on this computer. */
export async function needsSetup(): Promise<boolean> {
  const e = engine()
  if (!e) return false
  try {
    const [pv, st, lm] = await Promise.all([
      e.call('GET', '/api/providers'),
      e.call('GET', '/api/status').catch(() => null),
      e.call('GET', '/api/local/models').catch(() => ({ models: [] })),
    ])
    const p = (pv.providers || []).find((x: PickerProvider) => x.id === pv.active) as PickerProvider | undefined
    if (!p) return true
    if (p.needsKey && !p.hasKey) return true
    if (p.id === 'local-server') return !p.model
    if (p.kind === 'local') return !st?.modelFile && !st?.model?.loaded && !(lm.models || []).length
    return false
  } catch { return false }
}

export const setupSkipped = () => { try { return sessionStorage.getItem(SKIP_KEY) === '1' } catch { return false } }

export default function Setup() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [way, setWay] = useState<'local' | 'key' | 'help' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const finish = (text: string) => { window.dispatchEvent(new CustomEvent('openlex:setup-changed')); setDone(text) }
  const skip = () => { try { sessionStorage.setItem(SKIP_KEY, '1') } catch { /* private window */ } navigate('/research') }

  const card = (id: 'local' | 'key' | 'help', Icon: any, title: string, text: string) => (
    <button type="button" onClick={() => setWay(way === id ? null : id)} aria-expanded={way === id} data-testid={`setup-${id}`}
      className={`card !p-4 text-left flex flex-col gap-1 ${way === id ? 'border-accent ring-1 ring-accent/40' : 'card-hover'}`}>
      <Icon size={22} className="text-accent" />
      <span className="text-parchment font-medium">{title}</span>
      <span className="text-sm text-antique">{text}</span>
    </button>
  )

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5" data-testid="setup">
      <div>
        <h1 className="font-serif text-3xl text-parchment">{t('setup.title', 'Set up the AI')}</h1>
        <p className="text-antique mt-1">{t('setup.intro', 'OpenLex needs an AI to answer. Choose one way; you can change it later in Settings → AI.')}</p>
      </div>
      {done ? (
        <div className="card !p-5 space-y-3" role="status">
          <p className="text-forest flex items-start gap-2"><Check size={18} className="mt-0.5 shrink-0" /> {done}</p>
          <button type="button" className="btn-primary !px-5 !py-2" onClick={() => navigate('/research')} data-testid="setup-done">{t('setup.start', 'Ask your first question')}</button>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            {card('local', Cpu, t('setup.local', 'On this computer'), t('setup.localText', 'Most private and free: nothing leaves this computer. Slower, needs a recent computer.'))}
            {card('key', KeyRound, t('setup.key', 'I brought my own key'), t('setup.keyText', 'Fast and strong: AWS Bedrock in the EU, Mistral, IONOS and others. You pay the service directly.'))}
            {card('help', LifeBuoy, t('setup.help', 'I need help getting a secure cloud key'), t('setup.helpText', 'A step-by-step guide, or we set it up with you.'))}
          </div>
          {way === 'local' && <LocalWay onDone={finish} />}
          {way === 'key' && <KeyWay onDone={finish} />}
          {way === 'help' && (
            <div className="card !p-5 space-y-3">
              <p className="text-parchment">{t('setup.helpIntro', 'The recommended way for client work is Claude in your firm\'s own AWS account in Frankfurt, with nothing stored. The guide takes about 20 minutes.')}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary !px-4 !py-2 text-sm inline-flex items-center gap-2" onClick={() => openLink(CLOUD_KEY_GUIDE_URL)}><BookOpen size={16} /> {t('setup.guide', 'Read the step-by-step guide')}</button>
                <button type="button" className="btn-primary !px-4 !py-2 text-sm inline-flex items-center gap-2" onClick={() => openLink(SETUP_CALL_URL)} data-testid="setup-call"><CalendarClock size={16} /> {t('setup.call', 'Set it up for me (book a call)')}</button>
              </div>
              <p className="text-xs text-antique">{t('setup.helpLocal', 'Meanwhile you can use the AI on this computer.')}</p>
            </div>
          )}
          <button type="button" onClick={skip} className="text-sm text-antique underline hover:text-cream px-1 py-1" data-testid="setup-skip">{t('setup.notNow', 'Not now')}</button>
        </>
      )}
    </div>
  )
}

// ── 1 On this computer ─────────────────────────────────────────────────────

function LocalWay({ onDone }: { onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const [det, setDet] = useState<Detect | null | undefined>(undefined)
  const [pull, setPull] = useState<{ name: string; percent: number | null; id: string } | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const check = useCallback(() => {
    setDet(undefined)
    engine()?.call('GET', '/api/local/detect').then(setDet).catch(() => setDet(null))
  }, [])
  useEffect(() => { check() }, [check])

  const use = async (name: string, title: string) => {
    try {
      const r = await engine()!.call('POST', '/api/local/use', { name })
      if (r?.error) throw new Error(r.error)
      onDone(t('modelPicker.nowLocal', 'Now using {{name}} on this computer. Nothing leaves this computer.', { name: title }))
    } catch (err) { setMsg({ text: friendly(err), bad: true }) }
  }
  const download = async (name: string) => {
    const e = engine()
    if (!e?.stream) return
    const id = `pull-${Date.now().toString(36)}`
    setPull({ name, percent: 0, id }); setMsg(null)
    let ok: string | null = null
    let failed = ''
    try {
      await e.stream('/api/local/pull', { model: name }, (ev: any) => {
        if (ev.type === 'progress') setPull((p) => (p ? { ...p, percent: ev.percent ?? p.percent } : p))
        else if (ev.type === 'done') ok = ev.model
        else if (ev.type === 'error') failed = ev.message
      }, id)
    } catch (err) { failed = friendly(err) }
    setPull(null)
    if (ok) return onDone(t('modelPicker.downloaded', '{{name}} is downloaded and in use. Nothing leaves this computer.', { name: ok }))
    setMsg({ text: failed || t('modelPicker.downloadStopped', 'Download stopped.'), bad: !!failed })
  }

  if (det === undefined) return <div className="card !p-5 text-antique">{t('setup.checking', 'Looking at this computer…')}</div>
  if (det === null) return <div className="card !p-5 text-red-400">{t('setup.noDetect', 'OpenLex could not look at this computer. Try again in a moment.')}</div>
  const rec = det.recommended
  return (
    <div className="card !p-5 space-y-3" data-testid="setup-local-panel">
      <p className="text-parchment">{t('modelPicker.memory', 'This computer has {{gb}} GB of memory. Suggested: {{name}} ({{size}} GB download).', { gb: det.ramGb, name: rec.title, size: rec.sizeGb })}</p>
      {det.ollama.running ? (
        pull ? (
          <div className="space-y-1" aria-live="polite">
            <div className="text-parchment text-sm">{t('modelPicker.downloading', 'Downloading {{name}}…', { name: pull.name })} {pull.percent != null ? `${pull.percent} %` : ''}</div>
            <div className="h-2 rounded bg-tobacco/40 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${pull.percent || 0}%` }} /></div>
            <button type="button" className="text-sm text-antique underline hover:text-cream" onClick={() => engine()?.stop?.(pull.id)}>{t('modelPicker.stop', 'Stop')}</button>
          </div>
        ) : rec.installed ? (
          <button type="button" className="btn-primary !px-5 !py-2 inline-flex items-center gap-2" onClick={() => use(rec.name, rec.title)}><Check size={16} /> {t('setup.useRec', 'Use {{name}}', { name: rec.title })}</button>
        ) : (
          <button type="button" className="btn-primary !px-5 !py-2 inline-flex items-center gap-2" onClick={() => download(rec.name)} data-testid="setup-download"><Download size={16} /> {t('setup.downloadRec', 'Download and use {{name}}', { name: rec.title })}</button>
        )
      ) : det.ollama.installed ? (
        <p className="text-amber-400">{t('modelPicker.ollamaStopped', 'Ollama is installed but not running. Open the Ollama app, then click "Check again".')}</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="text-parchment">{t('setup.needOllama', 'To run an AI on this computer, OpenLex uses the free program Ollama. It takes three steps:')}</p>
          <ol className="list-decimal pl-5 space-y-0.5 text-parchment/90">
            <li>{t('modelPicker.install1', 'Download Ollama from')} <button type="button" className="underline text-accent hover:text-cream" onClick={() => openLink(det.install.ollama)}>ollama.com/download</button> {t('modelPicker.install1b', 'and install it.')}</li>
            <li>{t('modelPicker.install2', 'Open Ollama once, so it runs in the background.')}</li>
            <li>{t('modelPicker.install3', 'Come back here and click "Check again".')}</li>
          </ol>
        </div>
      )}
      <button type="button" className="text-sm text-antique underline hover:text-cream px-1 py-1" onClick={check}>{t('modelPicker.checkAgain', 'Check again')}</button>
      {msg && <p className={`text-sm ${msg.bad ? 'text-red-400' : 'text-forest'}`}>{msg.text}</p>}
    </div>
  )
}

// ── 2 I brought my own key ─────────────────────────────────────────────────

function KeyWay({ onDone }: { onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const [list, setList] = useState<PickerProvider[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [notice, setNotice] = useState<PickerProvider | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const load = useCallback(async () => {
    const r = await engine()!.call('GET', '/api/providers')
    const ps = (r.providers || []).filter((p: PickerProvider) => !p.local && p.kind !== 'local') as PickerProvider[]
    setList(ps)
    return ps
  }, [])
  useEffect(() => { load().catch((err) => setMsg({ text: friendly(err), bad: true })) }, [load])
  const nameOf = (p: PickerProvider) => (p.labels ? p.labels[lang] || p.labels.en : p.label)

  const activate = async (p: PickerProvider) => {
    try {
      await engine()!.call('POST', '/api/providers', { active: p.id })
      onDone(t('setup.keyDone', '{{name}} is set up and tested. Client data still follows your rule (Settings → Where client data may go).', { name: nameOf(p) }))
    } catch (err) { setMsg({ text: friendly(err), bad: true }) }
  }
  // "Use": test the key first (no document text is sent), then the cloud notice once, then switch.
  const useIt = async (id: string) => {
    setMsg({ text: t('modelPicker.testing', 'Checking…') })
    try {
      const r = await engine()!.call('POST', '/api/providers/test', { provider: id })
      if (!r?.ok) return setMsg({ text: friendly(r?.error || 'the check did not work'), bad: true })
      const p = (await load()).find((x) => x.id === id)
      if (!p) return
      setMsg(null)
      if (!p.noticeSeen) return setNotice(p)
      activate(p)
    } catch (err) { setMsg({ text: friendly(err), bad: true }) }
  }

  if (!list) return <div className="card !p-5 text-antique">{msg?.text || t('common.loading', 'Loading…')}</div>
  if (notice) return <div className="card !p-5"><CloudNotice provider={notice.id} onAccept={() => { const p = notice; setNotice(null); activate(p) }} onCancel={() => setNotice(null)} /></div>
  const main = KEY_ORDER.map((id) => list.find((p) => p.id === id)).filter(Boolean) as PickerProvider[]
  const rest = list.filter((p) => !KEY_ORDER.includes(p.id))
  const row = (p: PickerProvider) => (
    <li key={p.id} className={`rounded ${pick === p.id ? 'bg-accent/5' : ''}`}>
      <button type="button" onClick={() => setPick(pick === p.id ? null : p.id)} aria-expanded={pick === p.id} className="w-full flex items-start gap-2 px-2 py-2 text-left hover:bg-leather/60 rounded" data-testid={`setup-provider-${p.id}`}>
        {pick === p.id ? <ChevronDown size={15} className="mt-0.5 text-antique shrink-0" /> : <ChevronRight size={15} className="mt-0.5 text-antique shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="text-cream">{nameOf(p)}</span>
          {p.id === 'bedrock' && <span className="ml-2 text-[11px] text-forest border border-forest/40 rounded px-1 py-px">{t('setup.recommended', 'recommended')}</span>}
          {p.hasKey && <span className="ml-2 text-[11px] text-antique">{t('modelPicker.keySaved', 'Key saved')}</span>}
          {p.about && <span className="block text-xs text-antique">{p.about[lang] || p.about.en}</span>}
        </span>
      </button>
      {pick === p.id && <ProviderSetup p={p} onChanged={load} onUse={() => useIt(p.id)} />}
    </li>
  )
  return (
    <div className="card !p-5 space-y-3" data-testid="setup-key-panel">
      <p className="text-sm text-antique">{t('setup.keyIntro', 'Choose the service your key is from, paste the key and press "Use". OpenLex tests it first (without sending any of your documents). The key stays in this computer\'s keychain.')}</p>
      <ul className="space-y-0.5">{main.map(row)}</ul>
      {rest.length > 0 && (
        <div>
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="text-sm text-antique hover:text-cream inline-flex items-center gap-1 px-1 py-1">
            {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t('setup.more', 'More services ({{n}})', { n: rest.length })}
          </button>
          {more && <ul className="space-y-0.5 mt-1">{rest.map(row)}</ul>}
        </div>
      )}
      {msg && <p className={`text-sm ${msg.bad ? 'text-red-400' : 'text-antique'}`} role="status">{msg.text}</p>}
    </div>
  )
}
