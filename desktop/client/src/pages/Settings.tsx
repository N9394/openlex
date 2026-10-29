import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import { setUiLanguage } from '../i18n'
import DependenciesTab from '../components/DependenciesTab'
import LocalMemorySetting from '../components/LocalMemorySetting'
import {
  User,
  Bell,
  Shield,
  Key,
  Save,
  Download,
  Trash2,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  Sliders,
  HardDrive,
  Sun,
  Moon,
  Palette,
  Users,
  Building2,
  Copy,
  Globe,
} from 'lucide-react'

interface UserProfile {
  email: string
  name?: string
  username?: string
  createdAt?: string
  tier?: string
  language?: string
}

type ResponseLanguage = 'auto' | 'en' | 'de' | 'sk' | 'cs' | 'ro' | 'el'

const RESPONSE_LANGUAGE_OPTIONS: { value: ResponseLanguage; label: string }[] = [
  { value: 'auto', label: 'Auto — match the language of your prompt' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'sk', label: 'Slovenčina' },
  { value: 'cs', label: 'Čeština' },
  { value: 'ro', label: 'Română' },
  { value: 'el', label: 'Ελληνικά' },
]

interface StorageInfo {
  usedMB: string
  limitMB: string
  usedBytes: number
}

export default function Settings() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState('profile')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [storage, setStorage] = useState<StorageInfo>({ usedMB: '0', limitMB: '100', usedBytes: 0 })

  // License (Electron App only — null on web)
  const [licenseInfo, setLicenseInfo] = useState<{
    account_id: string | null; email: string | null; tier: string; entitlements: string[]; language_pref?: string
    community?: boolean; canActivate?: boolean
  } | null>(null)
  // Optional token activation (community mode, distribution builds only)
  const [activationInput, setActivationInput] = useState('')
  const [activationMsg, setActivationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [activating, setActivating] = useState(false)
  const [appInfo, setAppInfo] = useState<{
    version: string; platform: string; arch: string;
    qdrant: { reachable: boolean; collectionExists?: boolean; totalChunks: number; perJurisdiction?: Record<string, number>; error?: string }
  } | null>(null)
  const [licenseToken, setLicenseToken] = useState<string>('')
  const [tokenCopied, setTokenCopied] = useState(false)
  const isElectron = typeof window !== 'undefined' && (window as any).lexvault?.isElectron

  useEffect(() => {
    if (!isElectron) return
    ;(window as any).lexvault.getIdentity()
      .then((id: any) => setLicenseInfo(id))
      .catch((e: Error) => console.warn('[settings] getIdentity failed:', e.message))
    ;(window as any).lexvault.getAppInfo?.()
      .then((info: any) => setAppInfo(info))
      .catch((e: Error) => console.warn('[settings] getAppInfo failed:', e.message))
  }, [isElectron])

  // Profile
  const [username, setUsername] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)
  const [usernameMessage, setUsernameMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Notifications
  const [notifications, setNotifications] = useState({
    email: true,
    updates: false,
    security: true,
  })
  const [savingNotifications, setSavingNotifications] = useState(false)

  // Privacy
  const [privacy, setPrivacy] = useState({
    shareAnalytics: false,
  })

  // AI Settings
  const [aiSettings, setAiSettings] = useState({
    tone: 'balanced' as 'educational' | 'balanced' | 'professional',
    depth: 'standard' as 'quick' | 'standard' | 'thorough',
    ragOnly: false,
  })

  // Response language (server-persisted on User.language)
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>('auto')
  const [savingLanguage, setSavingLanguage] = useState(false)
  const [languageSaved, setLanguageSaved] = useState(false)

  // Load ragOnly from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ragOnly')
      if (saved !== null) setAiSettings(prev => ({ ...prev, ragOnly: saved === 'true' }))
    } catch {}
  }, [])
  const [savingAI, setSavingAI] = useState(false)

  // Theme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme') as 'dark' | 'light') || 'light' } catch { return 'light' }
  })

  const applyTheme = (t: 'dark' | 'light') => {
    setTheme(t)
    localStorage.setItem('theme', t)
    if (t === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  // Organization creation
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [orgMessage, setOrgMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Account actions
  const [exportingData, setExportingData] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  useEffect(() => {
    fetchProfile()
  }, [])

  // The desktop App keeps its settings on this computer and in the engine;
  // the old desktop server (accounts, /docs) is off.
  const DEPTH_TO_ENGINE: Record<string, string> = { quick: 'fast', standard: 'balanced', thorough: 'deep' }
  const DEPTH_FROM_ENGINE: Record<string, 'quick' | 'standard' | 'thorough'> = { fast: 'quick', balanced: 'standard', deep: 'thorough', ultra: 'thorough' }
  const fetchLocal = async () => {
    const pref = (localStorage.getItem('lexvault-ui-lang-pref') || 'auto') as ResponseLanguage
    setResponseLanguage(RESPONSE_LANGUAGE_OPTIONS.some((o) => o.value === pref) ? pref : 'auto')
    setUsername(localStorage.getItem('openlex-display-name') || user?.name || '')
    let saved: any = {}
    try { saved = JSON.parse(localStorage.getItem('openlex-ai-style') || '{}') } catch { saved = {} }
    let depth = saved.depth || 'standard'
    try { const c = await (window as any).lexvault?.engine?.call('GET', '/api/config/agent'); if (c?.depth) depth = DEPTH_FROM_ENGINE[c.depth] || depth } catch { /* engine not running */ }
    setAiSettings((a) => ({ ...a, ...saved, depth }))
    setLoading(false)
  }

  const fetchProfile = async () => {
    if (isElectron) return fetchLocal()
    try {
      const data = await api.get('/account/me')
      const profileData = data.user || data
      setProfile(profileData)
      setUsername(profileData.username || profileData.name || '')
      const lang = (profileData.language || 'auto') as ResponseLanguage
      const isSupported = RESPONSE_LANGUAGE_OPTIONS.some(o => o.value === lang)
      const safeLang = isSupported ? lang : 'auto'
      setResponseLanguage(safeLang)
      setUiLanguage(safeLang)

      // Fetch storage info
      try {
        const docsData = await api.get('/docs')
        if (docsData.storage) {
          setStorage(docsData.storage)
        }
      } catch {
        // Ignore storage fetch errors
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveUsername = async () => {
    setSavingUsername(true)
    setUsernameMessage(null)

    try {
      if (isElectron) {
        localStorage.setItem('openlex-display-name', username.trim())
        setUsernameMessage({ type: 'success', text: t('settings.nameSavedHere', 'Saved on this computer.') })
        setTimeout(() => setUsernameMessage(null), 3000)
        return
      }
      await api.put('/account/username', { username: username.trim() || null })
      setUsernameMessage({ type: 'success', text: 'Username updated successfully!' })
      setTimeout(() => setUsernameMessage(null), 3000)
    } catch (err) {
      setUsernameMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update username' })
    } finally {
      setSavingUsername(false)
    }
  }

  const handleCreateOrg = async () => {
    if (!orgName.trim() || !orgSlug.trim()) {
      setOrgMessage({ type: 'error', text: 'Name and slug are required' })
      return
    }
    setCreatingOrg(true)
    setOrgMessage(null)
    try {
      await api.post('/org', { name: orgName.trim(), slug: orgSlug.trim().toLowerCase() })
      setOrgMessage({ type: 'success', text: 'Team created! Refresh to see changes.' })
      // Refresh profile to get org data
      fetchProfile()
    } catch (err) {
      setOrgMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create team' })
    } finally {
      setCreatingOrg(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Please fill in all password fields' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }

    setChangingPassword(true)
    setPasswordMessage(null)

    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      setPasswordMessage({ type: 'success', text: 'Password changed successfully!' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPasswordMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' })
    } finally {
      setChangingPassword(false)
    }
  }

  const handleSaveNotifications = async () => {
    setSavingNotifications(true)
    try {
      await api.put('/account/notifications', notifications)
    } catch (err) {
      console.error('Failed to save notifications:', err)
    } finally {
      setSavingNotifications(false)
    }
  }

  const handleSaveAISettings = async () => {
    setSavingAI(true)
    try {
      localStorage.setItem('ragOnly', String(aiSettings.ragOnly))
      if (isElectron) {
        // Depth goes to the engine (how far the AI reads and looks things up); the rest stays on this computer.
        localStorage.setItem('openlex-ai-style', JSON.stringify(aiSettings))
        await (window as any).lexvault?.engine?.call('POST', '/api/config/agent', { depth: DEPTH_TO_ENGINE[aiSettings.depth] || 'balanced' })
        return
      }
      await api.put('/account/preferences', { ai: aiSettings })
    } catch (err) {
      console.error('Failed to save AI settings:', err)
    } finally {
      setSavingAI(false)
    }
  }

  const handleChangeResponseLanguage = async (next: ResponseLanguage) => {
    const prev = responseLanguage
    setResponseLanguage(next)
    setUiLanguage(next)
    setSavingLanguage(true)
    setLanguageSaved(false)
    try {
      if (!isElectron) await api.patch('/account/me', { language: next })
      setProfile(p => p ? { ...p, language: next } : p)
      setLanguageSaved(true)
      setTimeout(() => setLanguageSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save response language:', err)
      setResponseLanguage(prev)
      setUiLanguage(prev)
    } finally {
      setSavingLanguage(false)
    }
  }

  const handleExportData = async () => {
    setExportingData(true)
    try {
      const data = await api.post('/account/export', {})
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `openlex-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export error:', err)
      alert('Failed to export data')
    } finally {
      setExportingData(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      alert('Please enter your password to confirm')
      return
    }

    setDeletingAccount(true)
    try {
      await api.post('/account/delete', { password: deletePassword })
      logout()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete account')
    } finally {
      setDeletingAccount(false)
    }
  }

  // Electron App: hide tabs that only make sense for the cloud product —
  // Security (password mgmt is server-side, no password in App), Notifications
  // (will repurpose for desktop push when we wire it; hidden until then),
  // Account (subscription mgmt belongs in launcher / sales site).
  const tabs = [
    { id: 'profile', label: t('settings.tabs.profile'), icon: User },
    ...(isElectron ? [{ id: 'license', label: 'License', icon: Key }] : []),
    ...(isElectron ? [{ id: 'dependencies', label: 'Dependencies', icon: HardDrive }] : []),
    { id: 'appearance', label: t('settings.theme.title'), icon: Palette },
    ...(isElectron ? [] : [{ id: 'security', label: t('settings.tabs.security'), icon: Shield }]),
    ...(isElectron ? [] : [{ id: 'notifications', label: t('settings.tabs.notifications'), icon: Bell }]),
    { id: 'ai', label: t('settings.tabs.ai'), icon: Sliders },
    ...(isElectron ? [] : [{ id: 'account', label: t('settings.tabs.account'), icon: Key as any }]),
  ]

  const storagePercent = storage.limitMB ? (parseFloat(storage.usedMB) / parseFloat(storage.limitMB)) * 100 : 0

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-antique animate-pulse">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-parchment mb-2">{t('settings.title')}</h1>
      </div>

      <div className="flex gap-8">
        {/* Tabs */}
        <div className="w-52 flex-shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-button transition-all ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-cream hover:bg-leather hover:text-parchment'
                }`}
              >
                <tab.icon size={18} />
                <span className="font-medium text-sm">{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Cloud-product storage counter — hidden in App build (the
              5120 MB cap doesn't apply when you're storing locally). */}
          {!isElectron && (
            <div className="mt-6 p-4 bg-leather rounded-card border border-tobacco">
              <div className="flex items-center gap-2 text-antique text-sm mb-2">
                <HardDrive size={14} />
                Storage
              </div>
              <div className="text-parchment text-lg font-medium">
                {storage.usedMB} / {storage.limitMB} MB
              </div>
              <div className="mt-2 h-2 bg-deep-brown rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    storagePercent > 80 ? 'bg-red-500' : 'bg-accent'
                  }`}
                  style={{ width: `${Math.min(storagePercent, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="card space-y-6">
              <h2 className="font-serif text-xl text-parchment">{t('settings.profile.title')}</h2>

              <div>
                <label className="block text-cream text-sm mb-2">{t('settings.profile.displayName')}</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input flex-1"
                    placeholder={t('common.username')}
                  />
                  <button
                    onClick={handleSaveUsername}
                    disabled={savingUsername}
                    className="btn-primary flex items-center gap-2"
                  >
                    {savingUsername ? t('common.saving') : <><Save size={16} /> {t('common.save')}</>}
                  </button>
                </div>
                {usernameMessage && (
                  <div className={`mt-2 text-sm ${usernameMessage.type === 'success' ? 'text-forest' : 'text-red-400'}`}>
                    {usernameMessage.text}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-cream text-sm mb-2">{t('common.email')}</label>
                <input
                  type="email"
                  value={profile?.email || user?.email || ''}
                  disabled
                  className="input w-full opacity-50 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-cream text-sm mb-2">{t('dashboard.tier')}</label>
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1.5 bg-accent/10 text-accent rounded-full text-sm font-medium capitalize">
                    {profile?.tier || 'Free'}
                  </span>
                  <span className="text-antique text-sm">
                    {t('settings.profile.memberSince')} {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Organization Info — hidden in App build (multi-user team
                  features belong to the enterprise variant, not solo SaaS). */}
              {!isElectron && <div className="pt-6 border-t border-tobacco">
                {user?.organization ? (
                  <div>
                    <label className="block text-cream text-sm mb-2">{t('admin.title')}</label>
                    <div className="flex items-center gap-3">
                      <Building2 size={18} className="text-accent" />
                      <span className="text-parchment font-medium">{user.organization.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 capitalize">
                        {user.organization.isOwner ? t('admin.roleOwner') : (user.memberRole === 'admin' ? t('admin.roleAdmin') : t('admin.roleMember'))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 className="text-cream font-medium mb-3 flex items-center gap-2">
                      <Users size={18} /> {t('settings.organization.create')}
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-cream text-sm mb-1">{t('settings.organization.name')}</label>
                        <input
                          type="text"
                          value={orgName}
                          onChange={(e) => {
                            setOrgName(e.target.value)
                            setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
                          }}
                          className="input w-full"
                          placeholder="Smith & Partners LLP"
                        />
                      </div>
                      <div>
                        <label className="block text-cream text-sm mb-1">{t('settings.organization.slug')}</label>
                        <input
                          type="text"
                          value={orgSlug}
                          onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                          className="input w-full"
                          placeholder="smith-partners"
                        />
                      </div>
                      {orgMessage && (
                        <div className={`text-sm ${orgMessage.type === 'success' ? 'text-forest' : 'text-red-400'}`}>
                          {orgMessage.text}
                        </div>
                      )}
                      <button
                        onClick={handleCreateOrg}
                        disabled={creatingOrg}
                        className="btn-primary"
                      >
                        {creatingOrg ? t('settings.organization.creating') : t('settings.organization.create')}
                      </button>
                    </div>
                  </div>
                )}
              </div>}
            </div>
          )}

          {/* Dependencies Tab — Electron App only */}
          {activeTab === 'dependencies' && isElectron && <DependenciesTab />}

          {/* License Tab — Electron App only */}
          {activeTab === 'license' && isElectron && (
            <div className="card space-y-6">
              {licenseInfo?.community ? (
                <div>
                  <h2 className="font-serif text-xl text-parchment">Community edition</h2>
                  <p className="text-antique text-sm mt-1">
                    OpenLex works fully without an account or sign-in. Use your own model (an API key,
                    a local .gguf file, or your llama-server / Ollama endpoint) and law packs you add locally.
                  </p>
                </div>
              ) : (
                <div>
                  <h2 className="font-serif text-xl text-parchment">Your OpenLex License</h2>
                  <p className="text-antique text-sm mt-1">
                    This information lives on your machine. It never travels back to OpenLex servers
                    except when you renew or change your subscription.
                  </p>
                </div>
              )}

              {licenseInfo?.community && licenseInfo.canActivate && (
                <div>
                  <label className="block text-cream text-sm mb-2">Activate a license (optional)</label>
                  <p className="text-antique text-xs mb-2">
                    Only needed for your distributor's model and law-pack downloads and updates.
                    OpenLex restarts after activation.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={activationInput}
                      onChange={(e) => setActivationInput(e.target.value)}
                      placeholder="lv_live_…"
                      className="input flex-1 font-mono text-xs"
                    />
                    <button
                      disabled={activating || !activationInput.trim()}
                      onClick={async () => {
                        setActivating(true)
                        setActivationMsg(null)
                        try {
                          const r = await (window as any).lexvault.activateToken(activationInput.trim())
                          setActivationMsg(r?.ok
                            ? { type: 'success', text: 'Activated — restarting OpenLex…' }
                            : { type: 'error', text: r?.error || 'Activation failed' })
                        } catch (e) {
                          setActivationMsg({ type: 'error', text: e instanceof Error ? e.message : 'Activation failed' })
                        } finally {
                          setActivating(false)
                        }
                      }}
                      className="btn-secondary flex items-center gap-2"
                    >
                      <Key size={16} /> Activate
                    </button>
                  </div>
                  {activationMsg && (
                    <p className={`text-xs mt-2 ${activationMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {activationMsg.text}
                    </p>
                  )}
                </div>
              )}

              {!licenseInfo?.community && <>
              <div>
                <label className="block text-cream text-sm mb-2">{t('settings.app.accountEmail')}</label>
                <input
                  type="text"
                  value={licenseInfo?.email || '—'}
                  disabled
                  className="input w-full opacity-60 cursor-not-allowed font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-cream text-sm mb-2">{t('settings.app.accountId')}</label>
                <input
                  type="text"
                  value={licenseInfo?.account_id || '—'}
                  disabled
                  className="input w-full opacity-60 cursor-not-allowed font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-cream text-sm mb-2">{t('settings.app.tier')}</label>
                <span className="px-3 py-1.5 bg-accent/10 text-accent rounded-full text-sm font-medium capitalize inline-block">
                  {licenseInfo?.tier || '—'}
                </span>
              </div>

              <div>
                <label className="block text-cream text-sm mb-2 flex items-center gap-2">
                  <Globe size={14} /> {t('settings.app.subscribedJurisdictions')}
                </label>
                {licenseInfo?.entitlements && licenseInfo.entitlements.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {licenseInfo.entitlements.map(code => (
                      <span key={code} className="px-3 py-1 bg-tobacco/30 text-cream rounded text-sm font-mono">
                        {code}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-antique text-sm italic">
                    {t('settings.app.noSubscriptions')}
                  </p>
                )}
              </div>
              </>}

              <div className="pt-6 border-t border-tobacco grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-cream text-sm mb-2">{t('settings.app.appVersion')}</label>
                  <div className="font-mono text-parchment">{appInfo?.version || '—'}</div>
                  <div className="text-antique text-xs mt-1">
                    {appInfo ? `${appInfo.platform} ${appInfo.arch}` : ''}
                  </div>
                </div>
                <div>
                  <label className="block text-cream text-sm mb-2">{t('settings.app.statuteChunks')}</label>
                  <div className="font-mono text-parchment">
                    {!appInfo
                      ? '—'
                      : !appInfo.qdrant.reachable
                        ? t('settings.app.qdrantUnreachable')
                        : appInfo.qdrant.totalChunks.toLocaleString()}
                  </div>
                  <div className="text-antique text-xs mt-1">
                    {appInfo?.qdrant.reachable && !appInfo.qdrant.collectionExists
                      ? t('settings.app.noPacksYet')
                      : appInfo?.qdrant.reachable && appInfo.qdrant.totalChunks === 0
                        ? t('settings.app.collectionEmpty')
                        : appInfo?.qdrant.error || ''}
                  </div>
                </div>
              </div>

              {!licenseInfo?.community && <div className="pt-6 border-t border-tobacco">
                <label className="block text-cream text-sm mb-2">{t('settings.app.activationToken')}</label>
                <p className="text-antique text-xs mb-2">
                  {t('settings.app.activationTokenDesc')}
                </p>
                <div className="flex gap-2">
                  <input
                    type={licenseToken ? 'text' : 'password'}
                    value={licenseToken || '••••••••••••••••••••••••••••••••'}
                    disabled
                    className="input flex-1 font-mono text-xs opacity-60 cursor-not-allowed"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const idAny = (await (window as any).lexvault.getIdentity()) as any
                        if (idAny?.activation_token) {
                          await navigator.clipboard.writeText(idAny.activation_token)
                          setLicenseToken(idAny.activation_token)
                          setTokenCopied(true)
                          setTimeout(() => setTokenCopied(false), 2000)
                        } else {
                          alert('Token not exposed by main process. Reveal requires main.js update — contact support.')
                        }
                      } catch (e) {
                        console.warn('copy token failed:', e)
                      }
                    }}
                    className="btn-secondary flex items-center gap-2"
                  >
                    {tokenCopied ? <Check size={16} /> : <Copy size={16} />}
                    {tokenCopied ? 'Copied' : 'Reveal & copy'}
                  </button>
                </div>
              </div>}
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="card space-y-6">
              <h2 className="font-serif text-xl text-parchment">{t('settings.theme.title')}</h2>

              <div>
                <label className="block text-cream text-sm mb-3">{t('settings.theme.title')}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => applyTheme('dark')}
                    className={`flex items-center gap-3 p-4 rounded-card border-2 transition-all ${
                      theme === 'dark'
                        ? 'border-accent bg-accent/5'
                        : 'border-tobacco hover:border-accent/30'
                    }`}
                  >
                    <Moon size={20} className={theme === 'dark' ? 'text-accent' : 'text-antique'} />
                    <div className="text-left">
                      <div className={`font-medium text-sm ${theme === 'dark' ? 'text-accent' : 'text-cream'}`}>{t('settings.theme.dark')}</div>
                    </div>
                    {theme === 'dark' && <Check size={16} className="text-accent ml-auto" />}
                  </button>

                  <button
                    onClick={() => applyTheme('light')}
                    className={`flex items-center gap-3 p-4 rounded-card border-2 transition-all ${
                      theme === 'light'
                        ? 'border-accent bg-accent/5'
                        : 'border-tobacco hover:border-accent/30'
                    }`}
                  >
                    <Sun size={20} className={theme === 'light' ? 'text-accent' : 'text-antique'} />
                    <div className="text-left">
                      <div className={`font-medium text-sm ${theme === 'light' ? 'text-accent' : 'text-cream'}`}>{t('settings.theme.light')}</div>
                    </div>
                    {theme === 'light' && <Check size={16} className="text-accent ml-auto" />}
                  </button>
                </div>
              </div>

              {/* Preview swatch */}
              <div className="p-4 bg-deep-brown rounded-card border border-tobacco">
                <div className="text-xs text-antique uppercase tracking-wide mb-3">Preview</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-obsidian border border-tobacco" title="Background" />
                    <div className="w-6 h-6 rounded bg-leather border border-tobacco" title="Card" />
                    <div className="w-6 h-6 rounded bg-deep-brown border border-tobacco" title="Input" />
                    <div className="w-6 h-6 rounded bg-accent border border-tobacco" title="Accent" />
                    <div className="flex-1" />
                    <span className="text-parchment text-sm">Heading</span>
                    <span className="text-cream text-sm">Body</span>
                    <span className="text-antique text-sm">Muted</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="card space-y-6">
              <h2 className="font-serif text-xl text-parchment">{t('settings.tabs.security')}</h2>

              <div className="space-y-4">
                <h3 className="text-cream font-medium">{t('settings.security.changePassword')}</h3>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('settings.security.currentPassword')}</label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="input w-full pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-antique hover:text-cream"
                    >
                      {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('settings.security.newPassword')}</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="input w-full pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-antique hover:text-cream"
                    >
                      {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-cream text-sm mb-2">{t('settings.security.confirmPassword')}</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input w-full"
                  />
                </div>

                {passwordMessage && (
                  <div className={`flex items-center gap-2 text-sm ${
                    passwordMessage.type === 'success' ? 'text-forest' : 'text-red-400'
                  }`}>
                    {passwordMessage.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
                    {passwordMessage.text}
                  </div>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                  className="btn-primary"
                >
                  {changingPassword ? t('common.saving') : t('settings.security.changePassword')}
                </button>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="card space-y-6">
              <h2 className="font-serif text-xl text-parchment">{t('settings.notifications.title')}</h2>

              <div className="space-y-4">
                <label className="flex items-center justify-between cursor-pointer p-4 bg-leather rounded-button hover:bg-tobacco transition-colors">
                  <div>
                    <div className="text-cream font-medium">{t('settings.notifications.email')}</div>
                    <div className="text-antique text-sm">{t('settings.notifications.emailDesc')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.email}
                    onChange={(e) => setNotifications({ ...notifications, email: e.target.checked })}
                    className="w-5 h-5 rounded border-tobacco bg-deep-brown text-accent focus:ring-accent/30"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-4 bg-leather rounded-button hover:bg-tobacco transition-colors">
                  <div>
                    <div className="text-cream font-medium">{t('settings.notifications.updates')}</div>
                    <div className="text-antique text-sm">{t('settings.notifications.updatesDesc')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.updates}
                    onChange={(e) => setNotifications({ ...notifications, updates: e.target.checked })}
                    className="w-5 h-5 rounded border-tobacco bg-deep-brown text-accent focus:ring-accent/30"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-4 bg-leather rounded-button hover:bg-tobacco transition-colors">
                  <div>
                    <div className="text-cream font-medium">Security Alerts</div>
                    <div className="text-antique text-sm">Important security notifications</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.security}
                    onChange={(e) => setNotifications({ ...notifications, security: e.target.checked })}
                    className="w-5 h-5 rounded border-tobacco bg-deep-brown text-accent focus:ring-accent/30"
                  />
                </label>
              </div>

              <button
                onClick={handleSaveNotifications}
                disabled={savingNotifications}
                className="btn-primary flex items-center gap-2"
              >
                {savingNotifications ? t('common.saving') : <><Save size={16} /> {t('settings.notifications.savePreferences')}</>}
              </button>
            </div>
          )}

          {/* AI Settings Tab */}
          {activeTab === 'ai' && (
            <div className="card space-y-6">
              <h2 className="font-serif text-xl text-parchment">{t('settings.ai.title')}</h2>

              {/* Tone and "always search the law" were settings of the old desktop server; the App's chat does not use them. */}
              {!isElectron && <div>
                <label className="block text-cream text-sm mb-2">{t('settings.ai.communicationStyle')}</label>
                <select
                  value={aiSettings.tone}
                  onChange={(e) => setAiSettings({ ...aiSettings, tone: e.target.value as typeof aiSettings.tone })}
                  className="input w-full"
                >
                  <option value="educational">{t('settings.ai.tone.educational')}</option>
                  <option value="balanced">{t('settings.ai.tone.balanced')}</option>
                  <option value="professional">{t('settings.ai.tone.professional')}</option>
                </select>
              </div>}

              <div>
                <label className="block text-cream text-sm mb-2">
                  {t('settings.ai.softwareLanguage')}
                  {savingLanguage && <span className="text-antique text-xs ml-2">{t('common.saving')}</span>}
                  {languageSaved && <span className="text-green-400 text-xs ml-2">{t('common.saved')}</span>}
                </label>
                <select
                  value={responseLanguage}
                  onChange={(e) => handleChangeResponseLanguage(e.target.value as ResponseLanguage)}
                  disabled={savingLanguage}
                  className="input w-full"
                >
                  {RESPONSE_LANGUAGE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-antique text-xs mt-2">{t('settings.ai.softwareLanguageHint')}</p>
              </div>

              <div>
                <label className="block text-cream text-sm mb-2">{t('settings.ai.analysisDepth')}</label>
                <select
                  value={aiSettings.depth}
                  onChange={(e) => setAiSettings({ ...aiSettings, depth: e.target.value as typeof aiSettings.depth })}
                  className="input w-full"
                >
                  <option value="quick">{t('settings.ai.depth.quick')}</option>
                  <option value="standard">{t('settings.ai.depth.standard')}</option>
                  <option value="thorough">{t('settings.ai.depth.thorough')}</option>
                </select>
                <p className="text-antique text-xs mt-2">{t('settings.ai.depthHint')}</p>
              </div>

              {!isElectron && <div className="pt-4 border-t border-tobacco">
                <label className="flex items-center justify-between cursor-pointer p-4 bg-leather rounded-button hover:bg-tobacco transition-colors">
                  <div>
                    <div className="text-cream font-medium">{t('settings.ai.ragOnly')}</div>
                    <div className="text-antique text-sm">{t('settings.ai.ragOnlyHint')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={aiSettings.ragOnly}
                    onChange={(e) => setAiSettings({ ...aiSettings, ragOnly: e.target.checked })}
                    className="w-5 h-5 rounded border-tobacco bg-deep-brown text-accent focus:ring-accent/30"
                  />
                </label>
              </div>}

              <button
                onClick={handleSaveAISettings}
                disabled={savingAI}
                className="btn-primary flex items-center gap-2"
              >
                {savingAI ? t('common.saving') : <><Save size={16} /> {t('settings.ai.saveSettings')}</>}
              </button>

              <LocalMemorySetting />
            </div>
          )}

          {/* Account Tab */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              {/* Privacy */}
              <div className="card">
                <h2 className="font-serif text-xl text-parchment mb-6">{t('settings.account.privacy')}</h2>

                <label className="flex items-center justify-between cursor-pointer p-4 bg-leather rounded-button">
                  <div>
                    <div className="text-cream font-medium">{t('settings.account.shareAnalytics')}</div>
                    <div className="text-antique text-sm">{t('settings.account.shareAnalyticsHint')}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={privacy.shareAnalytics}
                    onChange={(e) => setPrivacy({ ...privacy, shareAnalytics: e.target.checked })}
                    className="w-5 h-5 rounded border-tobacco bg-deep-brown text-accent focus:ring-accent/30"
                  />
                </label>

                <p className="text-antique text-sm mt-4">
                  {t('settings.account.yourDocsSafe')}
                </p>
              </div>

              {/* Data */}
              <div className="card">
                <h2 className="font-serif text-xl text-parchment mb-6">{t('settings.account.data')}</h2>

                <div className="flex items-center justify-between p-4 bg-leather rounded-button mb-4">
                  <div>
                    <div className="text-cream font-medium">{t('settings.account.exportData')}</div>
                  </div>
                  <button
                    onClick={handleExportData}
                    disabled={exportingData}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Download size={16} />
                    {exportingData ? t('settings.account.exporting') : t('common.export')}
                  </button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="card border-red-900/50">
                <h2 className="font-serif text-xl text-red-400 mb-2">{t('settings.account.deleteAccount')}</h2>

                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="btn-secondary border-red-900 text-red-400 hover:bg-red-900/20 flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                    {t('settings.account.deleteAccount')}
                  </button>
                ) : (
                  <div className="bg-red-900/10 border border-red-900/30 rounded-card p-4">
                    <p className="text-red-300 text-sm mb-4">
                      {t('settings.account.deleteAccountConfirm')}
                    </p>
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder={t('common.password')}
                      className="input w-full mb-4"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false)
                          setDeletePassword('')
                        }}
                        className="btn-secondary flex-1"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deletingAccount || !deletePassword}
                        className="flex-1 px-4 py-2 bg-red-600 text-white rounded-button hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deletingAccount ? t('settings.account.deletingAccount') : t('common.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
