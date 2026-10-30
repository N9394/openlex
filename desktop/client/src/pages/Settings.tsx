// Settings: one short screen of seven rows (UI audit 2026-10-30). Each row
// says in one line what is set now and opens a small dialog:
//   1 AI · 2 Where client data may go · 3 Law sources · 4 Permissions ·
//   5 Language · 6 Appearance · 7 Licence and updates
// Everything else has a sensible default (thoroughness "balanced", memory
// for the local AI automatic, files in the matter folder) or is set by the
// firm in openlex.json. Diagnostics live under Help.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronRight, Cpu, KeyRound, Languages, Lock, Palette, ShieldCheck, Sparkles } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'
import { setUiLanguage } from '../i18n'
import { ModelPicker } from '../components/ModelPicker'
import DataRule from '../components/DataRule'
import LawSources from '../components/LawSources'
import { PermissionRules } from '../components/ChatCommands'
import JudgeSetting from '../components/JudgeSetting'
import LocalMemorySetting from '../components/LocalMemorySetting'
import { SmallDialog, mattersBridge } from '../components/MatterPicker'
import { TextSize, ThemePref, setTextSize, setThemePref, textSize, themePref } from '../lib/theme'

type Item = 'ai' | 'data' | 'law' | 'permissions' | 'language' | 'appearance' | 'licence'
type Lang = 'en' | 'de'
type AnswerLang = 'auto' | 'en' | 'de'

const activeMatter = async () => {
  const b = mattersBridge()
  if (!b) return null
  const r = await b.list()
  return (r.matters || []).find((m) => m.id === r.active) || null
}

const choiceClass = (on: boolean) => `rounded-button border px-3 py-2 text-sm ${on ? 'border-accent bg-accent/10 text-accent' : 'border-tobacco text-cream hover:border-accent/40'}`

export default function Settings() {
  const { t, i18n } = useTranslation()
  const lang: Lang = /^de/i.test(i18n.language || '') ? 'de' : 'en'
  const [open, setOpen] = useState<Item | null>(null)
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'warn' | 'bad' } | null>(null)
  const [sum, setSum] = useState<Record<string, string>>({})
  const say = useCallback((text: string, kind: 'ok' | 'warn' | 'bad' = 'ok') => setNotice({ text, kind }), [])

  // One line per row: what is set now.
  const load = useCallback(async () => {
    const e = engine()
    if (!e) return
    const [pv, pol, cfg, src, perms] = await Promise.all([
      e.call('GET', '/api/providers').catch(() => null),
      e.call('GET', '/api/policy').catch(() => null),
      e.call('GET', '/api/config/agent').catch(() => null),
      e.call('GET', '/api/sources/law').catch(() => null),
      e.call('GET', '/api/permissions').catch(() => null),
    ])
    const rule = pol?.default || { mode: 'local-only' }
    const sources: any[] = Array.isArray(src?.sources) ? src.sources : []
    const on = sources.filter((s) => s.enabled).length
    const u = perms?.user || {}
    const allowed = (u.allow || []).length + Object.values(u.matters || {}).reduce((n: number, m: any) => n + ((m && m.allow) || []).length, 0)
    const answers = (cfg?.answerLang || 'auto') as AnswerLang
    setSum({
      ai: pv?.display ? (pv.display[lang] || pv.display.en) : '',
      data: rule.mode === 'local-only'
        ? t('data.local', 'Only this computer')
        : t('settings.sum.services', '{{n}} services allowed', { n: (rule.providers || []).length }) + (rule.redact ? ` · ${t('settings.sum.names', 'names hidden')}` : '') + ((rule.regions || []).includes('eu') ? ' · EU' : ''),
      law: sources.length ? t('settings.sum.law', '{{n}} of {{total}} on', { n: on, total: sources.length }) : '',
      permissions: allowed ? t('settings.sum.perms', '{{n}} things allowed without asking', { n: allowed }) : t('settings.sum.permsNone', 'OpenLex asks every time'),
      answers: answers === 'auto' ? t('settings.lang.same', 'same as my question') : answers === 'de' ? 'Deutsch' : 'English',
    })
  }, [lang, t])
  useEffect(() => { load() }, [load])
  const close = useCallback(() => { setOpen(null); load() }, [load])

  const themeWord = { system: t('settings.theme.system', 'Same as this computer'), light: t('settings.theme.lightWord', 'Light'), dark: t('settings.theme.darkWord', 'Dark') }
  const sizeWord = { s: t('settings.size.s', 'small text'), m: t('settings.size.m', 'normal text'), l: t('settings.size.l', 'large text') }
  const rows: { id: Item; icon: any; title: string; line: string }[] = [
    { id: 'ai', icon: Cpu, title: t('settings.items.ai', 'AI'), line: sum.ai || t('settings.sum.aiNone', 'Not set up yet') },
    { id: 'data', icon: ShieldCheck, title: t('data.title', 'Where client data may go'), line: sum.data || '' },
    { id: 'law', icon: BookOpen, title: t('settings.items.law', 'Law sources'), line: sum.law || '' },
    { id: 'permissions', icon: Lock, title: t('settings.items.permissions', 'Permissions'), line: sum.permissions || '' },
    { id: 'language', icon: Languages, title: t('settings.items.language', 'Language'), line: `${lang === 'de' ? 'Deutsch' : 'English'} · ${t('settings.lang.answersShort', 'answers: {{x}}', { x: sum.answers || t('settings.lang.same', 'same as my question') })}` },
    { id: 'appearance', icon: Palette, title: t('settings.items.appearance', 'Appearance'), line: `${themeWord[themePref()]} · ${sizeWord[textSize()]}` },
    { id: 'licence', icon: KeyRound, title: t('settings.items.licence', 'Licence and updates'), line: '' },
  ]
  const titleOf = (id: Item) => rows.find((r) => r.id === id)!.title

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <h1 className="font-serif text-3xl text-parchment mb-4">{t('settings.title', 'Settings')}</h1>
      {notice && <p role="status" className={`mb-3 text-sm ${notice.kind === 'bad' ? 'text-red-400' : notice.kind === 'warn' ? 'text-amber-400' : 'text-forest'}`}>{notice.text}</p>}
      <ul className="card !p-0 divide-y divide-tobacco/70" data-testid="settings-list">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => { setNotice(null); setOpen(r.id) }} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-deep-brown/60 rounded-card" data-testid={`settings-${r.id}`}>
              <r.icon size={18} className="text-accent shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-parchment font-medium">{r.title}</span>
                {r.line && <span className="block text-sm text-antique truncate">{r.line}</span>}
              </span>
              <ChevronRight size={16} className="text-antique shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <SmallDialog title={titleOf(open)} onClose={close} wide={open === 'ai' || open === 'law'}>
          {open === 'ai' && <AiPanel onDone={(text) => { say(text); close() }} />}
          {open === 'data' && <DataRule say={say} />}
          {open === 'law' && <LawSources say={say} matter={activeMatter} />}
          {open === 'permissions' && <PermissionRules say={say} />}
          {open === 'language' && <LanguagePanel say={say} />}
          {open === 'appearance' && <AppearancePanel themeWord={themeWord} sizeWord={sizeWord} />}
          {open === 'licence' && <LicencePanel />}
        </SmallDialog>
      )}
    </div>
  )
}

/** 1 AI: the guided setup, the picker (keys, local models, spending), the second pass; memory under "Advanced". */
function AiPanel({ onDone }: { onDone: (text: string) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <button type="button" className="w-full flex items-center gap-2 rounded-button border border-accent/50 px-3 py-2 text-left text-sm text-accent hover:bg-accent/10" onClick={() => navigate('/setup')} data-testid="settings-setup">
        <Sparkles size={16} /> {t('settings.ai.guided', 'Set up the AI step by step (on this computer, your own key, or with help)')}
      </button>
      <ModelPicker onDone={onDone} />
      <div className="border-t border-tobacco pt-3"><JudgeSetting /></div>
      <details className="border-t border-tobacco pt-3">
        <summary className="cursor-pointer text-sm text-antique hover:text-cream py-1">{t('settings.advanced', 'Advanced')}</summary>
        <div className="mt-2"><LocalMemorySetting /></div>
      </details>
    </div>
  )
}

/** 5 Language: the App's language, and the language of the answers (in the engine: Word and the terminal follow). */
function LanguagePanel({ say }: { say: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
  const { t, i18n } = useTranslation()
  const ui: Lang = /^de/i.test(i18n.language || '') ? 'de' : 'en'
  const [answers, setAnswers] = useState<AnswerLang | null>(null)
  useEffect(() => { engine()?.call('GET', '/api/config/agent').then((c) => setAnswers((c?.answerLang || 'auto') as AnswerLang)).catch(() => setAnswers('auto')) }, [])
  const setUi = async (l: Lang) => {
    setUiLanguage(l)
    try { await engine()?.call('POST', '/api/config/agent', { uiLang: l }) } catch { /* older engine: kept on this computer */ }
  }
  const setAns = async (a: AnswerLang) => {
    setAnswers(a)
    try { await engine()?.call('POST', '/api/config/agent', { answerLang: a }); say(t('settings.lang.saved', 'Saved. Word and the terminal app follow.')) } catch (err) { say(friendly(err), 'bad') }
  }
  return (
    <div className="space-y-5">
      <div>
        <div className="text-cream mb-2">{t('settings.lang.ui', 'OpenLex in')}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={choiceClass(ui === 'de')} onClick={() => setUi('de')} aria-pressed={ui === 'de'}>Deutsch</button>
          <button type="button" className={choiceClass(ui === 'en')} onClick={() => setUi('en')} aria-pressed={ui === 'en'}>English</button>
        </div>
      </div>
      <div>
        <div className="text-cream mb-2">{t('settings.lang.answers', 'Answers in')}</div>
        {answers && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={choiceClass(answers === 'auto')} onClick={() => setAns('auto')} aria-pressed={answers === 'auto'}>{t('settings.lang.same', 'same as my question')}</button>
            <button type="button" className={choiceClass(answers === 'de')} onClick={() => setAns('de')} aria-pressed={answers === 'de'}>Deutsch</button>
            <button type="button" className={choiceClass(answers === 'en')} onClick={() => setAns('en')} aria-pressed={answers === 'en'}>English</button>
          </div>
        )}
        <p className="text-xs text-antique mt-2">{t('settings.lang.hint', 'Quotes from documents and the law stay in their own language.')}</p>
      </div>
    </div>
  )
}

/** 6 Appearance: colours and text size. */
function AppearancePanel({ themeWord, sizeWord }: { themeWord: Record<ThemePref, string>; sizeWord: Record<TextSize, string> }) {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<ThemePref>(themePref())
  const [size, setSize] = useState<TextSize>(textSize())
  return (
    <div className="space-y-5">
      <div>
        <div className="text-cream mb-2">{t('settings.theme.colours', 'Colours')}</div>
        <div className="flex flex-wrap gap-2">
          {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
            <button key={p} type="button" aria-pressed={theme === p} className={choiceClass(theme === p)} onClick={() => { setThemePref(p); setTheme(p) }}>{themeWord[p]}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-cream mb-2">{t('settings.size.title', 'Text size')}</div>
        <div className="flex flex-wrap gap-2">
          {(['s', 'm', 'l'] as TextSize[]).map((s) => (
            <button key={s} type="button" aria-pressed={size === s} className={choiceClass(size === s)} onClick={() => { setTextSize(s); setSize(s) }}>{sizeWord[s]}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 7 Licence and updates: edition, activation, version, check for updates, Diagnostics. */
function LicencePanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const lv = (window as any).lexvault
  const [id, setId] = useState<any>(null)
  const [info, setInfo] = useState<any>(null)
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    lv?.getIdentity?.().then(setId).catch(() => {})
    lv?.getAppInfo?.().then(setInfo).catch(() => {})
  }, [lv])
  const activate = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await lv.activateToken(token.trim())
      setMsg(r?.ok ? { text: t('settings.licence.activated', 'Activated: OpenLex restarts…') } : { text: r?.error || t('settings.licence.failed', 'Activation did not work.'), bad: true })
    } catch (e) { setMsg({ text: friendly(e), bad: true }) }
    setBusy(false)
  }
  const check = async () => {
    setMsg({ text: t('settings.licence.checking', 'Checking for updates…') })
    try { await lv?.checkForUpdate?.(); setMsg({ text: t('settings.licence.checked', 'Checked. A new version shows at the top of the window when it is ready.') }) } catch (e) { setMsg({ text: friendly(e), bad: true }) }
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="text-parchment font-medium">{!id || id.community ? t('settings.licence.community', 'Community edition') : t('settings.licence.licensed', 'Licensed: {{tier}}', { tier: id.tier || '—' })}</div>
        <p className="text-xs text-antique mt-1">{t('settings.licence.communityText', 'OpenLex works fully without an account. A licence is only needed for your distributor\'s downloads and updates.')}</p>
        {id?.email && <p className="text-xs text-antique mt-1">{id.email}</p>}
      </div>
      {lv?.activateToken && (!id || id.canActivate !== false) && (
        <div className="space-y-1">
          <label className="block text-cream" htmlFor="licence-token">{t('settings.licence.activate', 'Activate a licence (optional)')}</label>
          <div className="flex gap-2">
            <input id="licence-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="lv_live_…" className="input flex-1 min-w-0 !py-2 font-mono text-xs" />
            <button type="button" disabled={busy || !token.trim()} onClick={activate} className="btn-secondary !px-4 !py-2 text-sm">{t('settings.licence.activateButton', 'Activate')}</button>
          </div>
        </div>
      )}
      <div className="border-t border-tobacco pt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-parchment">{t('settings.licence.version', 'Version {{v}}', { v: info?.version || '—' })}</span>
        {lv?.checkForUpdate && <button type="button" onClick={check} className="btn-secondary !px-4 !py-2 text-sm">{t('settings.licence.check', 'Check for updates')}</button>}
        <button type="button" onClick={() => navigate('/help#diagnostics')} className="text-sm text-antique underline hover:text-cream px-1 py-1">{t('settings.licence.diagnostics', 'Diagnostics…')}</button>
      </div>
      {msg && <p className={`text-xs ${msg.bad ? 'text-red-400' : 'text-forest'}`}>{msg.text}</p>}
    </div>
  )
}
