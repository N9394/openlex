// Due diligence as a card in the chat (/diligence — the old M&A pages, now
// on the engine): red flags by tier with their quote, what the data room
// lacks, a short summary, the review grid per document (also on the Review
// grid page). Export Excel, CSV, Word, PDF.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Table2 } from 'lucide-react'
import { engine } from '../lib/commands'
import { clip, friendly } from '../lib/turn'
import ExportButtons from './ExportButtons'

const TIERS = ['deal_breaker', 'price_affecting', 'standard', 'informational'] as const
const TIER_CLASS: Record<string, string> = { deal_breaker: 'text-red-400 border-red-400/60', price_affecting: 'text-amber-400 border-amber-400/50', standard: 'text-parchment border-tobacco', informational: 'text-antique border-tobacco/60' }
const CELL_MARK: Record<string, string> = { ok: '', unverified: ' ?', invalid: ' !', edited: ' ✎' }

export default function DiligenceCard({ id }: { id: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [x, setX] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [quote, setQuote] = useState<string | null>(null)

  useEffect(() => {
    engine()?.call('GET', `/api/diligence?id=${encodeURIComponent(id)}`).then((r) => setX(r.diligence)).catch((err) => setError(friendly(err)))
  }, [id])
  if (error) return <div className="text-xs text-antique">{t('tools.gone', 'The result could not be opened')}: {error}</div>
  if (!x) return <div className="text-xs text-antique">{t('common.loading', 'Loading…')}</div>
  const tierWord = (k: string) => String(t(`diligence.tier.${k}`, ({ deal_breaker: 'Deal breaker', price_affecting: 'Price-affecting', standard: 'Standard', informational: 'For information' } as any)[k] || k))
  const flags = x.documents.flatMap((d: any) => d.flags.map((f: any) => ({ ...f, document: d.name })))
  const columns: { id: string; label: string }[] = [
    { id: 'doc_type', label: t('diligence.col.doc_type', 'Kind') }, { id: 'change_of_control', label: t('diligence.col.change_of_control', 'Change of control') },
    { id: 'assignment', label: t('diligence.col.assignment', 'Assignment needs consent') }, { id: 'termination', label: t('diligence.col.termination', 'Termination') },
    { id: 'liability', label: t('diligence.col.liability', 'Liability and caps') }, { id: 'governing_law', label: t('diligence.col.governing_law', 'Governing law') },
    { id: 'term', label: t('diligence.col.term', 'Term and renewal') }, { id: 'exclusivity', label: t('diligence.col.exclusivity', 'Exclusivity / non-compete') },
    { id: 'ip', label: t('diligence.col.ip', 'IP') }, { id: 'data_protection', label: t('diligence.col.data_protection', 'Data protection') },
    { id: 'guarantees', label: t('diligence.col.guarantees', 'Guarantees and security') }, { id: 'disputes', label: t('diligence.col.disputes', 'Disputes and claims') },
  ]
  const readiness = x.overview?.readiness ? String(t(`diligence.ready.${x.overview.readiness}`, ({ ready: 'ready to sign', conditional: 'ready with conditions', not_ready: 'not ready' } as any)[x.overview.readiness])) : ''

  return (
    <div className="rounded-card border border-accent/40 bg-deep-brown/60 p-4 space-y-3 text-sm" data-testid="diligence-card">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <div className="text-xs uppercase tracking-wide text-accent">{t('diligence.title', 'Due diligence')}</div>
          <div className="font-serif text-lg text-parchment">{t('diligence.headline', '{{flags}} red flags in {{docs}} documents', { flags: x.stats.flags, docs: x.stats.documents })}</div>
          <div className="text-xs text-antique">{t('diligence.for', 'For the {{side}}', { side: String(t(`diligence.side.${x.perspective}`, String(x.perspective))) })} · {String(t(`diligence.deal.${x.dealType}`, String(x.dealType).replace('_', ' ')))}{readiness ? ` · ${readiness}` : ''}</div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {TIERS.map((k) => <span key={k} className={`rounded-button border px-2 py-0.5 ${TIER_CLASS[k]}`} title={tierWord(k)}>{x.byTier[k]} {tierWord(k)}</span>)}
        </div>
      </div>
      {x.overview?.summary && <p className="text-parchment/90">{x.overview.summary}</p>}
      {!!x.overview?.priorities?.length && <ol className="list-decimal ml-5 text-xs text-parchment/90 space-y-0.5">{x.overview.priorities.map((p: string, i: number) => <li key={i}>{p}</li>)}</ol>}
      {!!x.missing.length && <p className="text-xs text-amber-400">! {t('diligence.missing', 'Not in the data room (usual for this kind of deal)')}: {x.missing.join(', ')}</p>}

      <div className="border-t border-tobacco/50 pt-2">
        <div className="text-sm font-medium text-parchment mb-1">{t('diligence.flags', 'Red flags')}</div>
        {!flags.length && <div className="text-xs text-antique">{t('diligence.noFlags', 'No red flags found.')}</div>}
        <ul className="space-y-1.5">
          {flags.map((f: any, i: number) => (
            <li key={i} className={`border-l-2 pl-3 ${TIER_CLASS[f.tier]}`}>
              <div className="text-xs"><span className="uppercase font-semibold">{tierWord(f.tier)}</span> <span className="text-parchment">{f.title}</span> <span className="text-antique">· {f.document}{f.location ? ` · ${f.location}` : ''}</span></div>
              {f.why && <div className="text-xs text-parchment/80">{f.why}</div>}
              {f.action && <div className="text-xs text-forest">→ {f.action}</div>}
              <button type="button" className="text-[11px] text-antique underline" onClick={() => setQuote(quote === `${i}` ? null : `${i}`)}>{quote === `${i}` ? t('diligence.hideQuote', 'hide the quote') : t('diligence.showQuote', 'show the quote')}</button>
              {quote === `${i}` && <div className="text-xs text-antique italic">“{clip(f.quote, 400)}”</div>}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-tobacco/50 pt-2 space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-parchment">{t('diligence.grid', 'Review grid per document')}</div>
          {x.gridId && <button type="button" onClick={() => navigate('/grid', { state: { gridId: x.gridId } })} className="text-xs text-antique underline inline-flex items-center gap-1"><Table2 size={12} /> {t('diligence.openGrid', 'open on the Review grid page')}</button>}
        </div>
        {x.documents.map((d: any) => (
          <div key={d.name}>
            <button type="button" onClick={() => setOpen(open === d.name ? null : d.name)} aria-expanded={open === d.name} className="w-full flex items-center gap-2 text-left text-xs text-parchment/90 hover:text-cream">
              <span className="flex-1 truncate">{d.name}{d.docType ? <span className="text-antique"> · {d.docType}</span> : null}</span>
              <span className="text-antique">{t('diligence.flagCount', '{{count}} flags', { count: d.flags.length })}</span>
              {open === d.name ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {open === d.name && (
              <div className="ml-4 mt-1 mb-2 space-y-1">
                {d.summary && <p className="text-xs text-parchment/80">{d.summary}</p>}
                <table className="w-full text-xs"><tbody>
                  {columns.map((c) => {
                    const cell = d.row?.[c.id]
                    return (
                      <tr key={c.id} className="align-top border-b border-tobacco/30">
                        <td className="py-1 pr-2 text-antique whitespace-nowrap">{c.label}</td>
                        <td className="py-1 text-parchment/90" title={cell?.quote || ''}>{!cell || cell.status === 'not_found' ? <span className="text-antique">—</span> : <>{clip(cell.value, 200)}<span className="text-amber-400">{CELL_MARK[cell.status] || ''}</span>{cell.location ? <span className="text-antique"> ({cell.location})</span> : null}</>}</td>
                      </tr>
                    )
                  })}
                </tbody></table>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-[11px] text-antique border-t border-tobacco/50 pt-2 space-y-0.5">
        <div>✓ {t('diligence.checked', 'Every red flag and grid answer quotes its document; {{n}} flags removed because their quote was not found. “?” = quote not found, check it.', { n: x.stats.dropped })}</div>
        {x.skipped.map((s: any, i: number) => <div key={i} className="text-amber-400">! {t('investigation.notRead', 'Not read')}: {s.name}{s.note ? ` — ${s.note}` : ''}</div>)}
        <div>{t('diligence.noCitations', 'No statutes were cited from memory. Written by AI — check before relying on it.')}</div>
      </div>
      <ExportButtons path="/api/diligence/export" id={x.id} formats={['xlsx', 'csv', 'docx', 'pdf']}
        save={{ matterId: x.matterId, kind: 'diligence', title: t('diligence.savedTitle', 'Due diligence {{date}}', { date: x.createdAt.slice(0, 10) }), content: [x.overview?.summary || '', ...flags.filter((f: any) => f.tier !== 'informational').map((f: any) => `- ${tierWord(f.tier)}: ${f.title} (${f.document})`)].join('\n\n'), source: { kind: 'diligence', id: x.id } }} />
    </div>
  )
}
