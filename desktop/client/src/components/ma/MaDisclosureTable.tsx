import { FileText, AlertTriangle, CheckCircle, MinusCircle } from 'lucide-react'
import type { DealDisclosure } from '../../lib/api'

interface Props {
  disclosures: DealDisclosure[]
  disclosureGaps?: string | null // JSON string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  adequate: { label: 'Adequate', color: 'text-green-400 bg-green-500/10', icon: CheckCircle },
  partial: { label: 'Partial', color: 'text-amber-400 bg-amber-500/10', icon: MinusCircle },
  missing: { label: 'Missing', color: 'text-red-400 bg-red-500/10', icon: AlertTriangle },
  general: { label: 'General', color: 'text-blue-400 bg-blue-500/10', icon: FileText },
  pending: { label: 'Pending', color: 'text-antique bg-leather', icon: FileText },
}

const safeStr = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'object' && v ? ((v as Record<string, string>).gap || (v as Record<string, string>).title || JSON.stringify(v)) : String(v ?? '')

export default function MaDisclosureTable({ disclosures, disclosureGaps }: Props) {
  let gaps: Record<string, unknown> | null = null
  if (disclosureGaps) { try { gaps = JSON.parse(disclosureGaps) } catch { /* malformed */ } }

  if (disclosures.length === 0 && !gaps) {
    return (
      <div className="text-center py-12 text-antique">
        <FileText size={48} className="mx-auto mb-4 opacity-30" />
        <p>No disclosures analyzed yet.</p>
      </div>
    )
  }

  // Count by status
  const statusCounts: Record<string, number> = {}
  for (const d of disclosures) {
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1
  }

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {['adequate', 'partial', 'missing', 'general'].map(status => {
          const config = STATUS_CONFIG[status]
          const count = statusCounts[status] || 0
          return (
            <div key={status} className="card text-center">
              <div className={`flex items-center justify-center gap-1 mb-1 ${config.color.split(' ')[0]}`}>
                <config.icon size={14} />
                <span className="text-xs">{config.label}</span>
              </div>
              <p className="text-parchment text-xl font-serif">{count}</p>
            </div>
          )
        })}
      </div>

      {/* Critical gaps alert */}
      {Array.isArray(gaps?.criticalGaps) && (gaps!.criticalGaps as unknown[]).length > 0 && (
        <div className="mb-4 p-3 rounded border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm font-medium mb-1">Critical Disclosure Gaps</p>
          <ul className="list-disc list-inside text-antique text-sm space-y-0.5">
            {(gaps!.criticalGaps as unknown[]).map((g, i) => <li key={i}>{safeStr(g)}</li>)}
          </ul>
        </div>
      )}

      {gaps?.overallCoverage ? (
        <p className="text-antique text-sm mb-4">Overall coverage: <span className="text-cream">{safeStr(gaps.overallCoverage)}</span></p>
      ) : null}

      {/* Disclosure list */}
      <div className="space-y-2">
        {disclosures.map(d => {
          const config = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending
          return (
            <div key={d.id} className="flex items-start gap-3 p-3 rounded hover:bg-leather/30">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${config.color}`}>
                <config.icon size={12} /> {config.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-cream text-sm font-medium">{d.warrantyName}</p>
                <p className="text-antique text-sm truncate">{d.content}</p>
                {d.assessment && <p className="text-antique/70 text-xs mt-1">{d.assessment}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
