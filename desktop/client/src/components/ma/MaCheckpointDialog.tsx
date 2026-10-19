import { useState } from 'react'
import { CheckCircle, XCircle, FileText, Globe, Clock, AlertTriangle, Shield, ScrollText, Gavel } from 'lucide-react'
import { maApi } from '../../lib/api'

interface Props {
  dealId: string
  checkpointId: string
  stage: string
  proposal: Record<string, unknown>
  onResolved: () => void
}

export default function MaCheckpointDialog({ dealId, checkpointId, stage, proposal, onResolved }: Props) {
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showReject, setShowReject] = useState(false)

  const handleApprove = async () => {
    setLoading(true)
    try {
      await maApi.approveCheckpoint(dealId, checkpointId)
      onResolved()
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!feedback.trim()) return
    setLoading(true)
    try {
      await maApi.rejectCheckpoint(dealId, checkpointId, feedback)
      onResolved()
    } catch (err) {
      console.error('Failed to reject:', err)
    } finally {
      setLoading(false)
    }
  }

  const stringify = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'object' && v ? ((v as Record<string, string>).risk || (v as Record<string, string>).title || (v as Record<string, string>).gap || JSON.stringify(v)) : String(v ?? '')

  if (stage === 'plan_review') {
    return (
      <div className="card border-accent/30 bg-accent/5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={20} className="text-accent" />
          <h3 className="font-serif text-lg text-parchment">Analysis Plan Review</h3>
        </div>

        <p className="text-cream text-sm mb-4">
          Review the analysis plan below. The pipeline will proceed to extract clauses, risks, and warranties from all documents.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={16} className="text-antique" />
              <span className="text-cream font-medium">Documents</span>
            </div>
            <p className="text-parchment text-2xl">{(proposal.documentCount as number) || 0}</p>
            {proposal.docTypeCounts ? (
              <div className="mt-2 space-y-1">
                {Object.entries(proposal.docTypeCounts as Record<string, number>).map(([type, count]) => (
                  <div key={type} className="flex justify-between text-xs">
                    <span className="text-antique">{type}</span>
                    <span className="text-cream">{String(count)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <Globe size={16} className="text-antique" />
              <span className="text-cream font-medium">Jurisdictions</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {((proposal.jurisdictions as string[]) || []).map(j => (
                <span key={j} className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">{j}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 rounded-button bg-leather/50">
            <p className="text-antique text-xs">Est. LLM Calls</p>
            <p className="text-parchment text-lg">{(proposal.estimatedLLMCalls as number) || '?'}</p>
          </div>
          <div className="text-center p-3 rounded-button bg-leather/50">
            <div className="flex items-center justify-center gap-1">
              <Clock size={12} className="text-antique" />
              <p className="text-antique text-xs">Est. Time</p>
            </div>
            <p className="text-parchment text-lg">{(proposal.estimatedMinutes as number) || '?'} min</p>
          </div>
          <div className="text-center p-3 rounded-button bg-leather/50">
            <p className="text-antique text-xs">Total Chunks</p>
            <p className="text-parchment text-lg">{(proposal.totalChunks as number) || '?'}</p>
          </div>
        </div>

        {(proposal.keyObservations as string[])?.length > 0 && (
          <div className="mb-4">
            <p className="text-cream text-sm font-medium mb-1">Key Observations</p>
            <ul className="list-disc list-inside text-antique text-sm space-y-0.5">
              {(proposal.keyObservations as unknown[]).map((obs, i) => (
                <li key={i}>{stringify(obs)}</li>
              ))}
            </ul>
          </div>
        )}

        {(proposal.missingDocTypes as string[])?.length > 0 && (
          <div className="mb-4 p-3 rounded-button bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-400 text-sm font-medium mb-1">Missing Document Types</p>
            <p className="text-antique text-sm">{(proposal.missingDocTypes as string[]).join(', ')}</p>
          </div>
        )}

        {showReject ? (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Explain why you're rejecting this plan..."
              className="input w-full h-20 resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleReject} disabled={loading || !feedback.trim()} className="btn-primary bg-red-500/20 text-red-400 text-sm">
                {loading ? 'Rejecting...' : 'Confirm Reject'}
              </button>
              <button onClick={() => setShowReject(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={handleApprove} disabled={loading} className="btn-primary flex items-center gap-2">
              <CheckCircle size={16} />
              {loading ? 'Approving...' : 'Approve & Start Analysis'}
            </button>
            <button onClick={() => setShowReject(true)} className="btn-secondary flex items-center gap-2">
              <XCircle size={16} />
              Reject
            </button>
          </div>
        )}
      </div>
    )
  }

  if (stage === 'risk_review') {
    const tierCounts = (proposal.tierCounts || {}) as Record<string, number>
    const rawDealBreakers = (proposal.dealBreakers || []) as unknown[]
    const rawPriceAffecting = (proposal.priceAffecting || []) as unknown[]
    const mitigationPriorities = (proposal.mitigationPriorities || []) as unknown[]
    const dealBreakers = rawDealBreakers.map(stringify)
    const priceAffecting = rawPriceAffecting.map(stringify)

    return (
      <div className="card border-accent/30 bg-accent/5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={20} className="text-accent" />
          <h3 className="font-serif text-lg text-parchment">Risk Review</h3>
        </div>

        <p className="text-cream text-sm mb-4">
          Review the risks below. You can override severity tiers after approving. The pipeline will proceed to warranty scoring and report generation.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { key: 'deal_breaker', label: 'Deal Breakers', color: 'text-red-400' },
            { key: 'price_affecting', label: 'Price Affecting', color: 'text-amber-400' },
            { key: 'standard', label: 'Standard', color: 'text-blue-400' },
            { key: 'informational', label: 'Informational', color: 'text-antique' },
          ].map(t => (
            <div key={t.key} className="text-center p-3 rounded-button bg-leather/50">
              <p className={`text-xs ${t.color}`}>{t.label}</p>
              <p className="text-parchment text-2xl font-serif">{tierCounts[t.key] || 0}</p>
            </div>
          ))}
        </div>

        {dealBreakers.length > 0 && (
          <div className="mb-4 p-3 rounded-button bg-red-500/10 border border-red-500/20">
            <p className="text-red-400 text-sm font-medium mb-1">Deal Breakers</p>
            <ul className="list-disc list-inside text-antique text-sm space-y-0.5">
              {dealBreakers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}

        {priceAffecting.length > 0 && (
          <div className="mb-4 p-3 rounded-button bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-400 text-sm font-medium mb-1">Price Affecting</p>
            <ul className="list-disc list-inside text-antique text-sm space-y-0.5">
              {priceAffecting.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        )}

        {mitigationPriorities.length > 0 && (
          <div className="mb-4">
            <p className="text-cream text-sm font-medium mb-1">Mitigation Priorities</p>
            <ol className="list-decimal list-inside text-antique text-sm space-y-1">
              {mitigationPriorities.map((m, i) => (
                <li key={i}>{stringify(m)}</li>
              ))}
            </ol>
          </div>
        )}

        {showReject ? (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Explain why you're rejecting..."
              className="input w-full h-20 resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleReject} disabled={loading || !feedback.trim()} className="btn-primary bg-red-500/20 text-red-400 text-sm">
                {loading ? 'Rejecting...' : 'Confirm Reject'}
              </button>
              <button onClick={() => setShowReject(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={handleApprove} disabled={loading} className="btn-primary flex items-center gap-2">
              <CheckCircle size={16} />
              {loading ? 'Approving...' : 'Approve & Continue'}
            </button>
            <button onClick={() => setShowReject(true)} className="btn-secondary flex items-center gap-2">
              <XCircle size={16} /> Reject
            </button>
          </div>
        )}
      </div>
    )
  }

  if (stage === 'counsel_signoff') {
    const dealBreakers = ((proposal.dealBreakers || []) as unknown[]).map(stringify)
    return (
      <div className="card border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-center gap-2 mb-4">
          <Gavel size={20} className="text-emerald-400" />
          <h3 className="font-serif text-lg text-parchment">Counsel Sign-Off</h3>
        </div>

        <p className="text-cream text-sm mb-4">
          The analysis is complete. Review the summary below and approve to enable export. This sign-off confirms the report has been reviewed by counsel.
        </p>

        {/* Executive summary snippet */}
        {!!proposal.executiveSummary && (
          <div className="mb-4 p-3 rounded bg-leather/30 text-cream text-sm italic">
            {String(proposal.executiveSummary)}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="text-center p-3 rounded-button bg-leather/50">
            <div className="flex items-center justify-center gap-1 text-red-400">
              <AlertTriangle size={12} />
              <p className="text-xs">Risks</p>
            </div>
            <p className="text-parchment text-xl font-serif">{(proposal.riskCount as number) || 0}</p>
          </div>
          <div className="text-center p-3 rounded-button bg-leather/50">
            <div className="flex items-center justify-center gap-1 text-amber-400">
              <Shield size={12} />
              <p className="text-xs">Warranties</p>
            </div>
            <p className="text-parchment text-xl font-serif">{(proposal.warrantyCount as number) || 0}</p>
          </div>
          <div className="text-center p-3 rounded-button bg-leather/50">
            <div className="flex items-center justify-center gap-1 text-blue-400">
              <ScrollText size={12} />
              <p className="text-xs">Disclosures</p>
            </div>
            <p className="text-parchment text-xl font-serif">{(proposal.disclosureCount as number) || 0}</p>
          </div>
          <div className="text-center p-3 rounded-button bg-leather/50">
            <div className="flex items-center justify-center gap-1 text-green-400">
              <FileText size={12} />
              <p className="text-xs">Playbooks</p>
            </div>
            <p className="text-parchment text-xl font-serif">{(proposal.warrantiesWithPlaybook as number) || 0}</p>
          </div>
        </div>

        {/* Deal breakers warning */}
        {dealBreakers.length > 0 && (
          <div className="mb-4 p-3 rounded-button bg-red-500/10 border border-red-500/20">
            <p className="text-red-400 text-sm font-medium mb-1">Deal Breakers ({dealBreakers.length})</p>
            <ul className="list-disc list-inside text-antique text-sm space-y-0.5">
              {dealBreakers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}

        {/* Missing disclosures warning */}
        {((proposal.missingDisclosureCount as number) || 0) > 0 && (
          <div className="mb-4 p-3 rounded-button bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-400 text-sm font-medium">
              {String(proposal.missingDisclosureCount)} missing disclosures require attention
            </p>
          </div>
        )}

        {/* W&I readiness */}
        {proposal.wniScore != null && (
          <div className="mb-4 text-sm text-antique">
            W&I Insurance: <span className="text-cream font-medium">{String(proposal.wniScore)}/100</span>
            <span className="ml-2 text-antique">({String(proposal.wniLevel)})</span>
          </div>
        )}

        {showReject ? (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Explain why you're sending this back for revision..."
              className="input w-full h-20 resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleReject} disabled={loading || !feedback.trim()} className="btn-primary bg-red-500/20 text-red-400 text-sm">
                {loading ? 'Sending...' : 'Send Back'}
              </button>
              <button onClick={() => setShowReject(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={handleApprove} disabled={loading} className="btn-primary flex items-center gap-2">
              <CheckCircle size={16} />
              {loading ? 'Signing off...' : 'Sign Off & Enable Export'}
            </button>
            <button onClick={() => setShowReject(true)} className="btn-secondary flex items-center gap-2">
              <XCircle size={16} /> Send Back
            </button>
          </div>
        )}
      </div>
    )
  }

  // Generic checkpoint fallback
  return (
    <div className="card border-accent/30 bg-accent/5">
      <h3 className="font-serif text-lg text-parchment mb-2">Checkpoint: {stage}</h3>
      <pre className="text-antique text-xs overflow-auto max-h-40 mb-4">{JSON.stringify(proposal, null, 2)}</pre>
      <div className="flex gap-3">
        <button onClick={handleApprove} disabled={loading} className="btn-primary">Approve</button>
        <button onClick={() => setShowReject(true)} className="btn-secondary">Reject</button>
      </div>
    </div>
  )
}
