// "More tools": everything that is not the daily chat, on one page, so the
// sidebar stays short. The four chat tools start the chat with their
// command; the others are pages of their own. A firm can hide the Review
// grid and Plans (openlex.json features.grid / features.plans).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Briefcase, FileSearch, ListTodo, Network, Route, ScanSearch, Table2, Wrench } from 'lucide-react'
import { engine } from '../lib/commands'

interface Tool { key: string; icon: any; title: string; text: string; to: string; command?: string }

export default function More() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [features, setFeatures] = useState<Record<string, unknown>>({})
  useEffect(() => { engine()?.call('GET', '/api/features').then((r) => setFeatures(r?.features || {})).catch(() => {}) }, [])
  const on = (k: string) => features[k] !== false
  const inChat: Tool[] = [
    { key: 'analyse', icon: FileSearch, title: t('more.analyse', 'Analyse a document'), text: t('more.analyseText', 'Summary, key terms, dates, duties and risks of one contract, with quotes.'), to: '/research', command: 'analyse' },
    { key: 'investigate', icon: ScanSearch, title: t('more.investigate', 'Investigate several documents'), text: t('more.investigateText', 'One question across many documents: what they say, where they conflict.'), to: '/research', command: 'investigate' },
    { key: 'draft', icon: Wrench, title: t('more.draft', 'Write a draft'), text: t('more.draftText', 'A first draft from your instructions or precedents, checked against the law.'), to: '/research', command: 'draft' },
    { key: 'diligence', icon: Briefcase, title: t('more.diligence', 'Due diligence of a data room'), text: t('more.diligenceText', 'Red flags per document and an overview for the deal.'), to: '/research', command: 'diligence' },
  ]
  const pages: Tool[] = [
    ...(on('grid') ? [{ key: 'grid', icon: Table2, title: t('nav.grid', 'Review grid'), text: t('more.gridText', 'A table: one row per document, one column per question.'), to: '/grid' }] : []),
    ...(on('plans') ? [{ key: 'plans', icon: Route, title: t('nav.plans', 'Plans'), text: t('more.plansText', 'Longer pieces of work, step by step, with your approval.'), to: '/plans' }] : []),
    { key: 'desk', icon: ListTodo, title: t('nav.desk', 'Matter desk'), text: t('more.deskText', 'Checklists, trackers and watches on official sources for this matter.'), to: '/desk' },
    { key: 'hub', icon: Network, title: t('more.hub', 'Hub (for IT and power users)'), text: t('more.hubText', 'Firm library, workflows over a whole matter, firm clauses, connectors.'), to: '/hub' },
  ]
  const card = (x: Tool) => (
    <button key={x.key} type="button" onClick={() => navigate(x.to, x.command ? { state: { command: x.command } } : undefined)}
      className="card card-hover !p-4 text-left flex gap-3 items-start" data-testid={`more-${x.key}`}>
      <x.icon size={20} className="text-accent mt-0.5 shrink-0" />
      <span className="min-w-0"><span className="block text-parchment font-medium">{x.title}</span><span className="block text-sm text-antique">{x.text}</span></span>
    </button>
  )
  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="font-serif text-3xl text-parchment">{t('nav.more', 'More tools')}</h1>
      <section>
        <h2 className="text-xs uppercase tracking-wide text-antique mb-2">{t('more.inChat', 'In the chat')}</h2>
        <div className="grid sm:grid-cols-2 gap-3">{inChat.map(card)}</div>
      </section>
      <section>
        <h2 className="text-xs uppercase tracking-wide text-antique mb-2">{t('more.pages', 'Pages of their own')}</h2>
        <div className="grid sm:grid-cols-2 gap-3">{pages.map(card)}</div>
      </section>
    </div>
  )
}
