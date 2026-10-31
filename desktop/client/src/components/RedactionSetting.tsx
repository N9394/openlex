// "Redaction check before cloud use (recommended)" — the one row under
// "Where client data may go", plus what belongs to it: the optional name
// finder (downloaded on request, never bundled; offered only where the ONNX
// runtime loads — the desktop app, not the CLI) and the active matter's
// lists (what is always hidden, what stays as it is). The firm can lock the
// check in openlex.json ("lock": ["redaction"]).
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'
import { mattersBridge } from './MatterPicker'

export default function RedactionSetting({ allow, say }: { allow: boolean; say?: (text: string, kind?: 'ok' | 'warn' | 'bad') => void }) {
  const { t } = useTranslation()
  const [st, setSt] = useState<any>(null)
  const [error, setError] = useState('')
  const [matter, setMatter] = useState<any>(null)
  const [terms, setTerms] = useState('')
  const [keep, setKeep] = useState('')

  const load = useCallback(async () => {
    const e = engine()
    if (!e) return
    try {
      const b = mattersBridge()
      let m: any = null
      if (b) { const r = await b.list(); m = (r.matters || []).find((x: any) => x.id === r.active) || null }
      setMatter(m)
      setTerms((m?.redactTerms || []).join('\n'))
      setKeep((m?.redactKeep || []).join('\n'))
      setSt(await e.call('GET', `/api/redaction${m ? `?matterId=${encodeURIComponent(m.id)}` : ''}`))
    } catch (err) { setError(friendly(err)) }
  }, [])
  useEffect(() => { load() }, [load])
  // While the name finder downloads: show the progress.
  useEffect(() => {
    if (!st?.model?.downloading) return
    const id = setTimeout(load, 1500)
    return () => clearTimeout(id)
  }, [st, load])

  if (error) return <p className="text-red-400 text-sm">{error}</p>
  if (!st) return null
  const locked = !!st.settings?.locked
  const on = st.settings?.check !== false
  const model = st.model || {}
  // available: the ONNX runtime loads here (the desktop app); installed: the files are on disk.
  const canRun = model.available !== false
  const needsApp = !canRun && model.runtime?.reason === 'not-bundled'
  const setCheck = async (v: boolean) => {
    try { await engine()!.call('POST', '/api/redaction/settings', { check: v }); await load(); say?.(v ? t('redaction.setOn', 'Redaction check is on: before anything goes to an online AI, you see what is hidden.') : t('redaction.setOff', 'Redaction check is off.'), v ? 'ok' : 'warn') } catch (err) { setError(friendly(err)) }
  }
  const modelAction = async (action: 'install' | 'remove') => {
    try { await engine()!.call('POST', '/api/redaction/model', { action }); await load() } catch (err) { setError(friendly(err)) }
  }
  const saveLists = async () => {
    try {
      await mattersBridge()?.update?.(matter.id, { redactTerms: terms, redactKeep: keep })
      say?.(t('redaction.listsSaved', 'Saved for this matter.'), 'ok')
      await load()
    } catch (err) { setError(friendly(err)) }
  }
  return (
    <div className="space-y-2" data-testid="redaction-setting">
      <label className={`flex items-start gap-2 ${allow ? 'text-cream' : 'text-antique'}`}>
        <input type="checkbox" className="mt-0.5" disabled={locked} checked={on} onChange={(ev) => setCheck(ev.target.checked)} data-testid="redaction-toggle" />
        <span>{t('redaction.setting', 'Redaction check before cloud use (recommended)')}
          {locked && <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-antique"><Lock size={11} /> {t('data.locked', 'Set by your firm.')}</span>}
          <span className="block text-xs text-antique">{allow
            ? t('redaction.settingHint', 'Before a question or a document goes to an online AI, you see what OpenLex hides (names, numbers, addresses) and can change it. A help, not a guarantee: it can miss things.')
            : t('redaction.settingLocal', 'Not needed now: client data stays on this computer.')}</span></span>
      </label>
      <div className="ml-6 text-xs text-antique space-y-1">
        <p>
          {!canRun
            ? (model.installed
              ? t('redaction.modelBroken', 'The name finder is downloaded but cannot run on this computer, so detection stays basic: {{error}}', { error: model.runtime?.error || '' })
              : needsApp
                ? t('redaction.modelNeedsApp', 'Basic detection (patterns, your lists, titles and company forms). The name finder needs the desktop app.')
                : t('redaction.modelCannotRun', 'Basic detection (patterns, your lists, titles and company forms). The name finder cannot run on this computer: {{error}}', { error: model.runtime?.error || '' }))
            : model.installed
            ? t('redaction.modelOn', 'Name finder installed ({{name}}, {{mb}} MB, licence {{licence}}). It runs on this computer.', { name: model.name, mb: model.sizeMB, licence: model.license })
            : model.downloading
              ? t('redaction.modelLoading', 'Downloading the name finder… {{pct}} %', { pct: model.downloading.pct })
              : t('redaction.modelOff', 'Basic detection (patterns, your lists, titles and company forms). Optional: a name finder that also finds names without a title — {{mb}} MB download from Hugging Face, licence {{licence}}, runs on this computer.', { mb: model.sizeMB, licence: model.license })}
          {' '}
          {!model.downloading && (model.installed
            ? <button type="button" className="underline hover:text-cream" onClick={() => modelAction('remove')}>{t('redaction.modelRemove', 'Remove')}</button>
            : canRun && <button type="button" className="underline hover:text-cream" onClick={() => modelAction('install')} data-testid="redaction-model-install">{t('redaction.modelInstall', 'Download')}</button>)}
        </p>
        {model.error && <p className="text-red-400">{model.error}</p>}
      </div>
      {matter && (
        <details className="ml-6 text-xs">
          <summary className="cursor-pointer text-antique hover:text-cream">{t('redaction.lists', 'Lists for “{{title}}”', { title: matter.title })}</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-antique">{t('redaction.alwaysHide', 'Always hide (one per line)')}
              <textarea className="input mt-1 w-full !py-1 !px-2 text-xs h-28" value={terms} onChange={(e) => setTerms(e.target.value)} data-testid="redaction-terms" />
            </label>
            <label className="text-antique">{t('redaction.keepAsIs', 'Keep as it is (one per line)')}
              <textarea className="input mt-1 w-full !py-1 !px-2 text-xs h-28" value={keep} onChange={(e) => setKeep(e.target.value)} />
            </label>
          </div>
          <button type="button" className="btn-secondary !px-3 !py-1 text-xs mt-2" onClick={saveLists}>{t('common.save', 'Save')}</button>
        </details>
      )}
    </div>
  )
}
