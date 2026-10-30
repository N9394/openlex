// A law source's free key, asked for by the AI (engine event key_request):
// the steps to get it and a hidden field. The key goes from this field
// straight to the engine (POST /api/sources/key → the OS keychain); it is
// never part of the conversation and never shown again.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Check } from 'lucide-react'
import { engine } from '../lib/commands'
import type { KeyRequest } from '../lib/turn'

export default function SourceKeyCard({ req }: { req: KeyRequest }) {
  const { t, i18n } = useTranslation()
  const de = i18n.language?.startsWith('de')
  const label = (de && req.labelDe) || req.label
  const help = (de && req.keyHelpDe) || req.keyHelp
  const [secret, setSecret] = useState('')
  const [state, setState] = useState<'ask' | 'busy' | 'saved' | 'bad'>('ask')
  const [error, setError] = useState('')
  const [signin, setSignin] = useState<{ userCode?: string | null; pageUrl?: string; url?: string } | null>(null)
  // Browser sign-in (Ansvar's free plan): the engine opens the page and waits; poll until done.
  useEffect(() => {
    if (!signin) return undefined
    const timer = setInterval(() => {
      engine()!.call('GET', `/api/sources/law/signin?name=${encodeURIComponent(req.source)}`).then((r: any) => {
        if (r.state === 'pending') return
        setSignin(null)
        if (r.state === 'done') setState('saved')
        else { setError(r.error || t('keyCard.signinFailed', 'The sign-in did not finish.')); setState('bad') }
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [signin, req.source, t])
  const startSignIn = async () => {
    setState('busy')
    try { setSignin(await engine()!.call('POST', '/api/sources/law/signin', { name: req.source })); setState('ask') } catch (err) { setError(err instanceof Error ? err.message : String(err)); setState('bad') }
  }
  const save = async () => {
    if (!secret.trim()) return
    setState('busy')
    try {
      await engine()!.call('POST', '/api/sources/key', { name: req.source, key: secret.trim() })
      setSecret('')
      setState('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('bad')
    }
  }
  if (state === 'saved') {
    return (
      <div className="rounded-button border border-forest/40 bg-forest/5 px-4 py-3 text-sm text-parchment flex gap-2 items-center">
        <Check size={14} className="text-forest" aria-hidden="true" />
        {t('keyCard.saved', 'Saved the {{name}} key in this computer\'s keychain. Ask your question again to use it.', { name: label })}
      </div>
    )
  }
  return (
    <form className="rounded-button border border-accent/40 bg-accent/5 px-4 py-3 text-sm space-y-2" onSubmit={(e) => { e.preventDefault(); save() }}>
      <div className="flex gap-2 items-center text-cream font-medium"><KeyRound size={14} aria-hidden="true" />{t('keyCard.title', 'Your free key for {{name}}', { name: label })}</div>
      {help && <p className="text-xs text-parchment/90">{help}</p>}
      {req.signIn && !signin && <button type="button" disabled={state === 'busy'} onClick={startSignIn} className="btn-primary">{t('keyCard.signIn', 'Sign in with your browser (free plan)')}</button>}
      {signin && <p className="text-xs text-cream">{signin.userCode ? t('keyCard.typeCode', 'On the page that opened, type this code: {{code}}', { code: signin.userCode }) : t('keyCard.signInPage', 'Sign in on the page that opened, then come back here.')} <a href={signin.pageUrl || signin.url} target="_blank" rel="noreferrer" className="underline">{t('keyCard.openPage', 'Open the page')}</a></p>}
      {req.guide && <a href={req.guide} target="_blank" rel="noreferrer" className="text-xs text-antique underline hover:text-cream">{t('keyCard.guide', 'How to get it, step by step')}</a>}
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className="input flex-1" aria-label={t('keyCard.field', 'Paste the key here')} placeholder={t('keyCard.field', 'Paste the key here')} />
        <button type="submit" disabled={state === 'busy' || !secret.trim()} className="btn-primary">{t('keyCard.save', 'Save')}</button>
      </div>
      <p className="text-xs text-antique">{t('keyCard.kept', 'The key goes straight into this computer\'s keychain. It is not part of the conversation and the AI never sees it.')}</p>
      {state === 'bad' && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
