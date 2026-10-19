import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
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
      to: '/upload',
      icon: FileSearch,
      title: t('nav.analyse'),
      description: t('upload.title'),
      color: 'from-emerald-500/10 to-emerald-500/5',
      accent: 'text-emerald-400',
      bgAccent: 'bg-emerald-500/10',
    },
    {
      to: '/investigate',
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
      title: t('nav.vault'),
      description: t('vault.subtitle'),
      color: 'from-rose-500/10 to-rose-500/5',
      accent: 'text-rose-400',
      bgAccent: 'bg-rose-500/10',
    },
    {
      to: '/ma',
      icon: Briefcase,
      title: t('ma.title'),
      description: t('ma.subtitle'),
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

  const loadRecentActivity = async () => {
    try {
      // Fetch recent documents
      const docs = await api.get('/docs?limit=3').catch(() => ({ documents: [] }))
      const conversations = await api.get('/research/conversations?limit=3').catch(() => [])

      const activities: RecentActivity[] = []

      // Add documents
      const docList = docs.documents || docs || []
      if (Array.isArray(docList)) {
        docList.slice(0, 2).forEach((doc: { id: string; filename: string; createdAt: string }) => {
          activities.push({
            id: `doc-${doc.id}`,
            type: 'document',
            title: doc.filename,
            timestamp: doc.createdAt,
            link: `/documents/${doc.id}`,
          })
        })
      }

      // Add conversations
      const convList = Array.isArray(conversations) ? conversations : conversations.conversations || []
      convList.slice(0, 2).forEach((conv: { id: string; title: string; createdAt: string }) => {
        activities.push({
          id: `conv-${conv.id}`,
          type: 'research',
          title: conv.title,
          timestamp: conv.createdAt,
          link: '/research',
        })
      })

      // Sort by timestamp
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
      const docs = await api.get('/docs').catch(() => ({ documents: [] }))
      const vault = await api.get('/vault').catch(() => [])
      const convs = await api.get('/research/conversations').catch(() => [])

      const docList = docs.documents || docs || []
      const vaultList = Array.isArray(vault) ? vault : vault.items || []
      const convList = Array.isArray(convs) ? convs : convs.conversations || []

      setStats({
        documents: Array.isArray(docList) ? docList.length : 0,
        research: Array.isArray(convList) ? convList.length : 0,
        vault: Array.isArray(vaultList) ? vaultList.length : 0,
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
            key={feature.to}
            to={feature.to}
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
