import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { engine } from '../lib/commands'

/** Recent conversations from the OpenLex engine (GET /api/sessions): every window's, newest first. */
async function engineSessions(limit: number): Promise<{ id: string; title: string; updatedAt: string | null }[]> {
  const e = engine()
  if (!e) return []
  try { const r = await e.call('GET', `/api/sessions?all=1&limit=${limit}`); return Array.isArray(r?.sessions) ? r.sessions : [] } catch { return [] }
}
import {
  FileSearch,
  ScanSearch,
  Search,
  Archive,
  Clock,
  FileText,
  MessageSquare,
  ArrowRight,
  Sparkles,
  FilePlus,
  Briefcase,
} from 'lucide-react'

interface RecentActivity {
  id: string
  type: 'document' | 'research' | 'draft'
  title: string
  timestamp: string
  link: string
}

export default function Dashboard() {
  const { t } = useTranslation()
  const features = [
    {
      to: '/research', command: 'analyse',
      icon: FileSearch,
      title: t('nav.analyse'),
      description: t('upload.title'),
      color: 'from-emerald-500/10 to-emerald-500/5',
      accent: 'text-emerald-400',
      bgAccent: 'bg-emerald-500/10',
    },
    {
      to: '/research', command: 'investigate',
      icon: ScanSearch,
      title: t('nav.investigate'),
      description: t('investigate.subtitle'),
      color: 'from-blue-500/10 to-blue-500/5',
      accent: 'text-blue-400',
      bgAccent: 'bg-blue-500/10',
    },
    {
      to: '/research',
      icon: Search,
      title: t('nav.research'),
      description: t('research.askAnything'),
      color: 'from-amber-500/10 to-amber-500/5',
      accent: 'text-amber-400',
      bgAccent: 'bg-amber-500/10',
    },
    {
      to: '/vault',
      icon: Archive,
      title: t('nav.saved', 'Saved'),
      description: t('dashboard.savedHint', 'Answers, notes, clauses, documents and drafts of the matter'),
      color: 'from-rose-500/10 to-rose-500/5',
      accent: 'text-rose-400',
      bgAccent: 'bg-rose-500/10',
    },
    {
      to: '/research', command: 'diligence',
      icon: Briefcase,
      title: t('nav.diligence', 'Due diligence'),
      description: t('dashboard.diligenceHint', 'A data room: review grid, red flags, what is missing'),
      color: 'from-purple-500/10 to-purple-500/5',
      accent: 'text-purple-400',
      bgAccent: 'bg-purple-500/10',
    },
  ]
  const { user } = useAuth()
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [stats, setStats] = useState({ documents: 0, research: 0, vault: 0 })

  useEffect(() => {
    loadRecentActivity()
    loadStats()
  }, [])

  // Everything from the engine (the old desktop server is off): the
  // conversations of every window and what is saved with the matters.
  const savedItems = async (): Promise<any[]> => {
    const e = (window as any).lexvault?.engine
    if (!e) return []
    let matterId = ''
    try { matterId = (await (window as any).lexvault?.matters?.list())?.active || '' } catch { /* none */ }
    try { return (await e.call('GET', `/api/saved${matterId ? `?matterId=${encodeURIComponent(matterId)}` : ''}`)).items || [] } catch { return [] }
  }

  const loadRecentActivity = async () => {
    try {
      const [conversations, saved] = await Promise.all([engineSessions(3), savedItems()])
      const activities: RecentActivity[] = []
      saved.slice(0, 2).forEach((it: { id: string; title: string; createdAt: string }) => {
        activities.push({ id: `saved-${it.id}`, type: 'document', title: it.title, timestamp: it.createdAt, link: '/vault' })
      })
      conversations.filter((c) => c.updatedAt).slice(0, 3).forEach((conv) => {
        activities.push({ id: `conv-${conv.id}`, type: 'research', title: conv.title, timestamp: conv.updatedAt as string, link: '/research' })
      })
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      setRecentActivity(activities.slice(0, 4))
    } catch (err) {
      console.error('Failed to load recent activity:', err)
    } finally {
      setLoadingActivity(false)
    }
  }

  const loadStats = async () => {
    try {
      const [convList, saved] = await Promise.all([engineSessions(200), savedItems()])
      setStats({
        documents: saved.filter((x: { kind: string }) => ['document', 'analysis', 'investigation', 'diligence', 'draft'].includes(x.kind)).length,
        research: Array.isArray(convList) ? convList.length : 0,
        vault: saved.length,
      })
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getTimeGreetingKey = () => {
    const hour = new Date().getHours()
    if (hour < 12) return t('dashboard.greeting.morning')
    if (hour < 18) return t('dashboard.greeting.afternoon')
    if (hour < 22) return t('dashboard.greeting.evening')
    return t('dashboard.greeting.night')
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center">
            <Sparkles size={24} className="text-accent" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-parchment">
              {getTimeGreetingKey()}, <span className="text-accent">{user?.name?.split(' ')[0] || ''}</span>
            </h1>
            <p className="text-antique">{t('dashboard.welcome')}</p>
          </div>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {features.map((feature, index) => (
          <Link
            key={`${feature.to}:${(feature as { command?: string }).command || ''}`}
            to={feature.to}
            state={(feature as { command?: string }).command ? { command: (feature as { command?: string }).command } : undefined}
            className="group"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div
              className={`
                relative overflow-hidden rounded-card border border-tobacco
                bg-gradient-to-br ${feature.color}
                p-6 transition-all duration-300
                hover:border-accent/30 hover:shadow-lg hover:-translate-y-0.5
              `}
            >
              <div className="flex items-start gap-4">
                <div className={`${feature.bgAccent} rounded-lg p-3`}>
                  <feature.icon size={24} className={feature.accent} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <h3 className="font-serif text-xl text-parchment mb-1">{feature.title}</h3>
                  <p className="text-cream-dark text-sm leading-relaxed">{feature.description}</p>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowRight size={20} className="text-accent" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg text-parchment flex items-center gap-2">
                <Clock size={18} className="text-antique" />
                {t('dashboard.recentActivity')}
              </h2>
            </div>

            {loadingActivity ? (
              <div className="text-center py-8 text-antique">{t('common.loading')}</div>
            ) : recentActivity.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-antique mb-2">{t('dashboard.noActivity')}</div>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <Link
                    key={activity.id}
                    to={activity.link}
                    className="flex items-center gap-3 p-3 rounded-button hover:bg-leather transition-colors group"
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        activity.type === 'document'
                          ? 'bg-emerald-500/10'
                          : activity.type === 'research'
                          ? 'bg-amber-500/10'
                          : 'bg-blue-500/10'
                      }`}
                    >
                      {activity.type === 'document' && (
                        <FileText size={18} className="text-emerald-400" />
                      )}
                      {activity.type === 'research' && (
                        <MessageSquare size={18} className="text-amber-400" />
                      )}
                      {activity.type === 'draft' && (
                        <FilePlus size={18} className="text-blue-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-cream font-medium truncate">{activity.title}</div>
                      <div className="text-xs text-antique">{formatTime(activity.timestamp)}</div>
                    </div>
                    <ArrowRight
                      size={16}
                      className="text-antique opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-serif text-lg text-parchment mb-4">{t('dashboard.yourStats')}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-antique">{t('dashboard.stats.documents')}</span>
                <span className="text-parchment font-medium">{stats.documents}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-antique">{t('dashboard.stats.researchSessions')}</span>
                <span className="text-parchment font-medium">{stats.research}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-antique">{t('dashboard.stats.vaultItems')}</span>
                <span className="text-parchment font-medium">{stats.vault}</span>
              </div>
            </div>
          </div>

          <div className="card bg-accent/5 border-accent/20">
            <div className="flex items-center gap-3 mb-3">
              <Search size={18} className="text-accent" />
              <span className="text-accent font-medium">{t('dashboard.legalDatabase.title')}</span>
            </div>
            <p className="text-sm text-antique">{t('dashboard.legalDatabase.tagline')}</p>
          </div>

          <div className="card text-center">
            <p className="text-antique text-sm mb-3">{t('dashboard.press')}</p>
            <kbd className="px-3 py-1.5 bg-deep-brown rounded-button text-cream text-sm">
              {navigator.platform?.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'} K
            </kbd>
            <p className="text-antique text-xs mt-2">to open command palette</p>
          </div>
        </div>
      </div>
    </div>
  )
}
