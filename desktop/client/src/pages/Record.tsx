// The AI record (the old Audit page, now the engine's record — the same
// one as /record in the chat, the terminal app and Word): what the AI did,
// when, which AI and where it ran, what was looked up online, never the
// content. This matter or all matters; export PDF or CSV for a client.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import { RecordList } from '../components/ChatCommands'
import { engine } from '../lib/commands'

export default function Record() {
  const { t } = useTranslation()
  const [all, setAll] = useState(false)
  const [matter, setMatter] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; kind: string } | null>(null)
  const [gen, setGen] = useState(0)
  useEffect(() => {
    const load = () => (window as any).lexvault?.matters?.list().then((r: any) => setMatter((r.matters || []).find((m: any) => m.id === r.active)?.title || null)).catch(() => setMatter(null))
    load()
    const on = () => { load(); setGen((g) => g + 1) }
    window.addEventListener('openlex:matter-changed', on)
    return () => window.removeEventListener('openlex:matter-changed', on)
  }, [])
  if (!engine()) return <div className="p-8 text-antique">{t('record.needsApp', 'The AI record is available in the desktop app.')}</div>
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4" data-testid="record-page">
      <div>
        <h1 className="font-serif text-2xl text-parchment flex items-center gap-2"><ClipboardList size={22} className="text-accent" /> {t('record.title', 'AI record')}</h1>
        <p className="text-antique text-sm">{t('record.intro', 'What the AI did — each question and each larger piece of work: when, which AI and where it ran, what was looked up online. Never the content. The same record as /record in the chat, the terminal app and Word.')}</p>
      </div>
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={() => setAll(false)} className={!all ? 'btn-primary !py-1.5' : 'btn-secondary !py-1.5'} disabled={!matter}>{matter ? t('record.thisMatter', 'This matter: {{title}}', { title: matter }) : t('record.noMatter', 'No matter chosen')}</button>
        <button type="button" onClick={() => setAll(true)} className={all || !matter ? 'btn-primary !py-1.5' : 'btn-secondary !py-1.5'}>{t('record.all', 'All matters')}</button>
      </div>
      {note && <p className={`text-sm ${note.kind === 'bad' ? 'text-red-400' : 'text-forest'}`} role="status">{note.text}</p>}
      <div className="rounded-card border border-tobacco bg-leather p-4 text-sm">
        <RecordList key={`${all || !matter}-${gen}`} all={all || !matter} recent={false} say={(text, kind = 'ok') => setNote({ text, kind })} />
      </div>
    </div>
  )
}
