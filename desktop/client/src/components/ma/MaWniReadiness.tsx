import { Shield, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'

interface WniData {
  readinessScore: number
  readinessLevel: string
  insurable: string[]
  excluded: string[]
  concerns: string[]
  estimatedPremiumRange: string
  recommendations: string[]
}

interface Props {
  wniReadiness?: string | null // JSON string
}

const LEVEL_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  strong: { label: 'Strong', color: 'text-green-400', icon: CheckCircle },
  moderate: { label: 'Moderate', color: 'text-amber-400', icon: AlertTriangle },
  weak: { label: 'Weak', color: 'text-red-400', icon: AlertTriangle },
  not_recommended: { label: 'Not Recommended', color: 'text-red-400', icon: XCircle },
}

export default function MaWniReadiness({ wniReadiness }: Props) {
  if (!wniReadiness) {
    return (
      <div className="text-center py-12 text-antique">
        <Shield size={48} className="mx-auto mb-4 opacity-30" />
        <p>W&I readiness not yet assessed.</p>
      </div>
    )
  }

  let data: WniData
  try { data = JSON.parse(wniReadiness) } catch {
    return <div className="text-center py-12 text-antique"><p>W&I data could not be loaded (malformed).</p></div>
  }
  const safeStr = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'object' && v ? JSON.stringify(v) : String(v ?? '')
  const level = LEVEL_CONFIG[data.readinessLevel] || LEVEL_CONFIG.not_recommended

  return (
    <div className="space-y-6">
      {/* Score card */}
      <div className="card text-center">
        <level.icon size={32} className={`mx-auto mb-2 ${level.color}`} />
        <p className={`text-3xl font-serif ${level.color}`}>{data.readinessScore}/100</p>
        <p className={`text-sm font-medium ${level.color}`}>{level.label}</p>
        {data.estimatedPremiumRange && data.estimatedPremiumRange !== 'N/A' && (
          <p className="text-antique text-xs mt-2">Est. premium: {data.estimatedPremiumRange}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Insurable */}
        {data.insurable?.length > 0 && (
          <div className="card">
            <h4 className="text-cream font-medium mb-2 flex items-center gap-2">
              <CheckCircle size={14} className="text-green-400" /> Likely Insurable
            </h4>
            <ul className="space-y-1">
              {data.insurable.map((item, i) => (
                <li key={i} className="text-antique text-sm flex items-start gap-1">
                  <span className="text-green-400 mt-1">+</span> {safeStr(item)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Excluded */}
        {data.excluded?.length > 0 && (
          <div className="card">
            <h4 className="text-cream font-medium mb-2 flex items-center gap-2">
              <XCircle size={14} className="text-red-400" /> Likely Excluded
            </h4>
            <ul className="space-y-1">
              {data.excluded.map((item, i) => (
                <li key={i} className="text-antique text-sm flex items-start gap-1">
                  <span className="text-red-400 mt-1">-</span> {safeStr(item)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Concerns */}
      {data.concerns?.length > 0 && (
        <div className="card border-amber-500/20">
          <h4 className="text-cream font-medium mb-2 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" /> Insurer Concerns
          </h4>
          <ul className="space-y-1">
            {data.concerns.map((c, i) => (
              <li key={i} className="text-antique text-sm">{safeStr(c)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <div className="card">
          <h4 className="text-cream font-medium mb-2">Recommendations</h4>
          <ol className="list-decimal list-inside space-y-1">
            {data.recommendations.map((r, i) => (
              <li key={i} className="text-antique text-sm">{safeStr(r)}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
