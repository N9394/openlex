// Help: the chat commands in plain words, the guides, and "Something is
// wrong" → Diagnostics (the technical status page that used to be the
// Dependencies tab in Settings).
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarClock, ChevronDown, ChevronRight, LifeBuoy, Slash, Stethoscope } from 'lucide-react'
import { ChatCommand, engine, loadCommands } from '../lib/commands'
import { GUIDES_URL, SETUP_CALL_URL, TROUBLESHOOTING_URL, openLink } from '../lib/links'
import DependenciesTab from '../components/DependenciesTab'

export default function Help() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [cmds, setCmds] = useState<ChatCommand[]>([])
  const location = useLocation()
  const [diag, setDiag] = useState(location.hash === '#diagnostics')
  useEffect(() => { if (location.hash === '#diagnostics') setDiag(true) }, [location.hash])
  const isElectron = typeof window !== 'undefined' && !!(window as any).lexvault?.isElectron
  useEffect(() => { if (engine()) loadCommands(/^de/i.test(i18n.language || '') ? 'de' : 'en').then(setCmds).catch(() => {}) }, [i18n.language])
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '')
  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5">
      <h1 className="font-serif text-3xl text-parchment">{t('nav.help', 'Help')}</h1>
      <div className="grid sm:grid-cols-3 gap-3">
        <button type="button" className="card card-hover !p-4 text-left" onClick={() => openLink(GUIDES_URL)}>
          <BookOpen size={20} className="text-accent mb-1" />
          <span className="block text-parchment font-medium">{t('help.guides', 'Guides')}</span>
          <span className="block text-sm text-antique">{t('help.guidesText', 'Step by step, in plain words.')}</span>
        </button>
        <button type="button" className="card card-hover !p-4 text-left" onClick={() => openLink(SETUP_CALL_URL)}>
          <CalendarClock size={20} className="text-accent mb-1" />
          <span className="block text-parchment font-medium">{t('help.call', 'Book a setup call')}</span>
          <span className="block text-sm text-antique">{t('help.callText', 'We set it up with you.')}</span>
        </button>
        <button type="button" className="card card-hover !p-4 text-left" onClick={() => setDiag(true)} data-testid="help-diagnostics">
          <LifeBuoy size={20} className="text-accent mb-1" />
          <span className="block text-parchment font-medium">{t('help.wrong', 'Something is wrong')}</span>
          <span className="block text-sm text-antique">{t('help.wrongText', 'Diagnostics and what to send to support.')}</span>
        </button>
      </div>

      <section className="card !p-4">
        <h2 className="font-serif text-xl text-parchment flex items-center gap-2 mb-1"><Slash size={18} /> {t('help.commands', 'Commands in the chat')}</h2>
        <p className="text-sm text-antique mb-3">{t('help.commandsIntro', 'Type / in the question field, or press {{key}} to search everything. Click a command to run it.', { key: isMac ? '⌘K' : 'Ctrl+K' })}</p>
        {!cmds.length && <p className="text-sm text-antique">{t('help.noCommands', 'The commands appear when the OpenLex engine runs.')}</p>}
        <ul className="grid md:grid-cols-2 gap-x-6">
          {cmds.map((c) => (
            <li key={c.name}>
              <button type="button" onClick={() => navigate('/research', { state: { command: c.name } })} className="w-full flex items-baseline gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-leather/60">
                <span className="font-mono text-accent w-24 shrink-0">/{c.name}</span>
                <span className="text-parchment min-w-0">{c.help}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card !p-4" id="diagnostics">
        <button type="button" onClick={() => setDiag(!diag)} aria-expanded={diag} className="w-full flex items-center gap-2 text-left">
          {diag ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Stethoscope size={18} className="text-accent" />
          <span className="font-serif text-xl text-parchment">{t('help.diagnostics', 'Diagnostics')}</span>
        </button>
        {diag && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-antique">{t('help.diagIntro', 'The technical state of this computer\'s OpenLex parts. Support may ask you for it.')} <button type="button" className="underline hover:text-cream" onClick={() => openLink(TROUBLESHOOTING_URL)}>{t('help.troubleshooting', 'Troubleshooting guide')}</button></p>
            {isElectron ? <DependenciesTab /> : <p className="text-sm text-antique">{t('help.diagAppOnly', 'Diagnostics are part of the desktop app.')}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
