// "Check answers with a second pass (recommended)" — the judge (engine:
// GET/POST /api/config/judge, sidecar/src/judge.js). On by default; when the
// firm has fixed it in openlex.json ("lock": ["judge"]) the switch is shown
// but cannot be changed. Applies immediately, in every window (/judge too).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { engine } from '../lib/commands'
import { friendly } from '../lib/turn'

export default function JudgeSetting() {
  const { t } = useTranslation()
  const [st, setSt] = useState<{ enabled: boolean; locked: boolean } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { engine()?.call('GET', '/api/config/judge').then(setSt).catch(() => setSt(null)) }, [])
  if (!st) return null
  const toggle = async (on: boolean) => {
    setError('')
    try { setSt(await engine()!.call('POST', '/api/config/judge', { enabled: on })) } catch (err) { setError(friendly(err)) }
  }
  return (
    <div data-testid="judge-setting">
      <label className={`flex items-center justify-between gap-3 ${st.locked ? 'opacity-80' : 'cursor-pointer'}`}>
        <span className="text-cream text-sm">
          {t('settings.ai.judge', 'Check answers with a second pass (recommended)')}
          {st.locked && <span className="ml-2 inline-flex items-center gap-1 text-xs text-antique"><Lock size={11} /> {t('settings.ai.judgeLocked', 'set by your firm')}</span>}
        </span>
        <input type="checkbox" checked={st.enabled} disabled={st.locked} onChange={(e) => toggle(e.target.checked)} className="w-5 h-5 rounded border-tobacco bg-deep-brown text-accent focus:ring-accent/30" />
      </label>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
