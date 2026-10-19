import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Briefcase, Clock, FileText, AlertTriangle, CheckCircle, Loader2, Trash2, Copy } from 'lucide-react'
import { maApi, type Deal, type DealTemplate } from '../lib/api'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  created: { label: 'Created', color: 'text-antique' },
  ingesting: { label: 'Ingesting', color: 'text-amber-400' },
  classifying: { label: 'Classifying', color: 'text-blue-400' },
  plan_review: { label: 'Plan Review', color: 'text-accent' },
  analyzing: { label: 'Analyzing', color: 'text-blue-400' },
  rag_verifying: { label: 'Verifying', color: 'text-purple-400' },
  risk_review: { label: 'Risk Review', color: 'text-accent' },
  synthesizing: { label: 'Synthesizing', color: 'text-blue-400' },
  playbook_pending: { label: 'Playbook', color: 'text-accent' },
  reporting: { label: 'Reporting', color: 'text-blue-400' },
  counsel_signoff: { label: 'Sign-Off', color: 'text-emerald-400' },
  completed: { label: 'Completed', color: 'text-green-400' },
  paused: { label: 'Paused', color: 'text-amber-400' },
  failed: { label: 'Failed', color: 'text-red-400' },
}

export default function MaDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newDealName, setNewDealName] = useState('')
  const [templates, setTemplates] = useState<DealTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  useEffect(() => {
    loadDeals()
    maApi.getTemplates().then(setTemplates).catch(() => {})
  }, [])

  const loadDeals = async () => {
    try {
      const data = await maApi.listDeals()
      setDeals(data)
    } catch (err) {
      console.error('Failed to load deals:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newDealName.trim()) return
    try {
      const template = templates.find(t => t.id === selectedTemplate)
      const deal = await maApi.createDeal({
        name: newDealName.trim(),
        perspective: template?.perspective,
        dealType: template?.dealType,
      })

      // If template selected, create its parties
      if (template) {
        for (const p of template.parties) {
          await maApi.addParty(deal.id, p)
        }
      }

      navigate(`/ma/${deal.id}/setup`)
    } catch (err) {
      console.error('Failed to create deal:', err)
    }
  }

  const handleClone = async (e: React.MouseEvent, dealId: string) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const cloned = await maApi.cloneDeal(dealId)
      navigate(`/ma/${cloned.id}/setup`)
    } catch (err) {
      console.error('Failed to clone deal:', err)
    }
  }

  const handleDelete = async (e: React.MouseEvent, dealId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(t('ma.deleteDealConfirm'))) return
    try {
      await maApi.deleteDeal(dealId)
      setDeals(d => d.filter(deal => deal.id !== dealId))
    } catch (err) {
      console.error('Failed to delete deal:', err)
    }
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-500/10 rounded-full flex items-center justify-center">
            <Briefcase size={24} className="text-purple-400" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-parchment">{t('ma.title')}</h1>
            <p className="text-antique">{t('ma.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} /> {t('ma.newDeal')}
        </button>
      </div>

      {creating && (
        <div className="card mb-6 border-accent/20">
          <h3 className="font-serif text-lg text-parchment mb-3">{t('ma.createNewDeal')}</h3>
          <div className="space-y-3">
            {templates.length > 0 && (
              <div>
                <label className="text-antique text-xs block mb-1">{t('ma.templateOptional')}</label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setSelectedTemplate('')}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      !selectedTemplate ? 'border-accent text-accent bg-accent/10' : 'border-tobacco text-antique hover:text-cream'
                    }`}
                  >
                    {t('ma.blank')}
                  </button>
                  {templates.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplate(tpl.id)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        selectedTemplate === tpl.id ? 'border-accent text-accent bg-accent/10' : 'border-tobacco text-antique hover:text-cream'
                      }`}
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <input
                type="text"
                placeholder={t('ma.dealName')}
                value={newDealName}
                onChange={e => setNewDealName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                className="input flex-1"
                autoFocus
              />
              <button onClick={handleCreate} disabled={!newDealName.trim()} className="btn-primary">
                {t('common.create')}
              </button>
              <button onClick={() => { setCreating(false); setNewDealName(''); setSelectedTemplate('') }} className="btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <Loader2 size={24} className="mx-auto text-antique animate-spin" />
          <p className="text-antique mt-2">{t('ma.loadingDeals')}</p>
        </div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16 card">
          <Briefcase size={48} className="mx-auto text-antique/30 mb-4" />
          <h3 className="font-serif text-xl text-parchment mb-2">{t('ma.noDeals')}</h3>
          <p className="text-antique mb-4">{t('ma.noDealsHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map(deal => {
            const status = STATUS_LABELS[deal.status] || { label: deal.status, color: 'text-antique' }
            return (
              <Link
                key={deal.id}
                to={deal.status === 'created' ? `/ma/${deal.id}/setup` : `/ma/${deal.id}`}
                className="block"
              >
                <div className="card hover:border-accent/30 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Briefcase size={18} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-cream font-medium truncate">{deal.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${status.color} bg-leather`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-antique mt-1">
                        <span className="flex items-center gap-1">
                          <FileText size={12} /> {deal._count?.documents || 0} docs
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle size={12} /> {deal._count?.risks || 0} risks
                        </span>
                        {deal.job?.currentStage && deal.job.currentStage !== 'completed' && (
                          <span className="flex items-center gap-1">
                            <Loader2 size={12} className="animate-spin" /> {deal.job.currentStage}
                          </span>
                        )}
                        {deal.status === 'completed' && (
                          <span className="flex items-center gap-1 text-green-400">
                            <CheckCircle size={12} /> {t('common.completed')}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> {formatTime(deal.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => handleClone(e, deal.id)}
                        className="text-antique hover:text-accent transition-colors p-2"
                        title={t('ma.cloneDeal')}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={e => handleDelete(e, deal.id)}
                        className="text-antique hover:text-red-400 transition-colors p-2"
                        title={t('ma.deleteDeal')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
