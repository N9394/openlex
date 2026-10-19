import { AlertOctagon, AlertTriangle, Info, Shield } from 'lucide-react'
import type { DealRisk } from '../../lib/api'

const SEVERITY_CONFIG: Record<string, { label: string; icon: JSX.Element; color: string; bg: string }> = {
  deal_breaker: {
    label: 'Deal Breaker',
    icon: <AlertOctagon size={16} />,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
  },
  price_affecting: {
    label: 'Price Affecting',
    icon: <AlertTriangle size={16} />,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
  standard: {
    label: 'Standard',
    icon: <Shield size={16} />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
  },
  informational: {
    label: 'Informational',
    icon: <Info size={16} />,
    color: 'text-antique',
    bg: 'bg-leather/50 border-tobacco',
  },
}

const SEVERITY_ORDER = ['deal_breaker', 'price_affecting', 'standard', 'informational']

interface Props {
  risks: DealRisk[]
}

export default function MaRiskDashboard({ risks }: Props) {
  const bySeverity = SEVERITY_ORDER.map(sev => ({
    severity: sev,
    config: SEVERITY_CONFIG[sev],
    risks: risks.filter(r => (r.humanOverride ? r.humanSeverity : r.severity) === sev),
  }))

  const totalRisks = risks.length

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {bySeverity.map(({ severity, config, risks: sevRisks }) => (
          <div key={severity} className={`p-4 rounded-card border ${config.bg}`}>
            <div className={`flex items-center gap-2 mb-1 ${config.color}`}>
              {config.icon}
              <span className="text-sm font-medium">{config.label}</span>
            </div>
            <p className={`text-2xl font-serif ${config.color}`}>{sevRisks.length}</p>
          </div>
        ))}
      </div>

      {totalRisks === 0 ? (
        <p className="text-antique text-center py-8">No risks found yet. Run the analysis pipeline to extract risks.</p>
      ) : (
        <div className="space-y-3">
          {bySeverity.filter(s => s.risks.length > 0).map(({ severity, config, risks: sevRisks }) => (
            <div key={severity}>
              <h4 className={`text-sm font-medium mb-2 ${config.color}`}>{config.label} ({sevRisks.length})</h4>
              <div className="space-y-2">
                {sevRisks.map(risk => (
                  <div key={risk.id} className={`p-3 rounded-button border ${config.bg}`}>
                    <div className="flex items-start gap-2">
                      <div className={`flex-shrink-0 mt-0.5 ${config.color}`}>{config.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h5 className="text-cream font-medium text-sm">{risk.title}</h5>
                          {risk.jurisdiction && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-leather text-antique">{risk.jurisdiction}</span>
                          )}
                          <span className="text-xs px-1.5 py-0.5 rounded bg-leather text-antique">{risk.category}</span>
                          {risk.verified && <span className="text-xs text-green-400">Verified</span>}
                          {risk.humanOverride && <span className="text-xs text-amber-400">Overridden</span>}
                        </div>
                        <p className="text-antique text-sm mt-1">{risk.description}</p>
                        {risk.location && <p className="text-antique/60 text-xs mt-1">{risk.location}</p>}
                        {risk.statutoryBasis && (
                          <p className="text-accent text-xs mt-1">{risk.statutoryBasis}</p>
                        )}
                        {risk.humanNotes && (
                          <p className="text-amber-400/80 text-xs mt-1 italic">{risk.humanNotes}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
