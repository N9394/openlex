import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../lib/api'
import { setUiLanguage, SUPPORTED_LANGUAGES } from '../i18n'

interface UserOrganization {
  id: string
  name: string
  slug: string
  isOwner: boolean
}

interface User {
  id: string
  email: string
  name: string
  organizationId?: string
  memberRole?: string
  organization?: UserOrganization | null
  language?: string
}

function applyLanguageFromUser(user: User | null) {
  if (!user) return
  const lang = user.language
  if (lang && (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
    setUiLanguage(lang as typeof SUPPORTED_LANGUAGES[number])
  }
}

interface MfaOptions {
  mfaToken: string
  mfaCode: string
}

interface LoginResult {
  requiresMfa?: boolean
  mfaToken?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  isOrgAdmin: boolean
  login: (email: string, password: string, mfa?: MfaOptions) => Promise<LoginResult | void>
  signup: (email: string, password: string, name: string, inviteToken?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Electron App: identity comes from the signed license file via the
    // preload bridge — no HTTP fetch, no cookies, no /login screen. This
    // matches the SaaS architecture where the launcher writes the license
    // and the App reads it on every boot.
    const isElectron = typeof window !== 'undefined' && (window as any).lexvault?.isElectron
    if (isElectron) {
      ;(window as any).lexvault.getIdentity()
        .then((id: any) => {
          const u: User = {
            id: id.account_id,
            email: id.email,
            name: id.email?.split('@')[0] || 'OpenLex User',
            language: id.language_pref,
          }
          setUser(u)
          applyLanguageFromUser(u)
        })
        .catch((err: Error) => console.warn('[auth] getIdentity failed:', err.message))
        .finally(() => setLoading(false))
    } else {
      // Web build: cookie-based session against the cloud backend
      api.get('/account/me')
        .then(data => { setUser(data.user); applyLanguageFromUser(data.user) })
        .catch(() => {
          localStorage.removeItem('token')
          localStorage.removeItem('refreshToken')
        })
        .finally(() => setLoading(false))
    }

    // Listen for forced logout from api.ts 401 handler
    const handleForceLogout = () => {
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      setUser(null)
    }
    window.addEventListener('auth:logout', handleForceLogout)
    return () => window.removeEventListener('auth:logout', handleForceLogout)
  }, [])

  const login = async (email: string, password: string, mfa?: MfaOptions): Promise<LoginResult | void> => {
    const body: Record<string, string> = { email, password }
    if (mfa) {
      body.mfaToken = mfa.mfaToken
      body.mfaCode = mfa.mfaCode
    }

    const data = await api.post('/auth/login', body)

    // Check if MFA is required
    if (data.requiresMfa && data.mfaToken) {
      return { requiresMfa: true, mfaToken: data.mfaToken }
    }

    // Cookie is set by the server response; keep localStorage for backward compat
    if (data.token || data.accessToken) {
      localStorage.setItem('token', data.token || data.accessToken)
    }
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken)
    }
    // Fetch full profile (includes org data) instead of using login response's partial user
    const profile = await api.get('/account/me')
    setUser(profile.user)
    applyLanguageFromUser(profile.user)
  }

  const signup = async (email: string, password: string, name: string, inviteToken?: string) => {
    const body: Record<string, string> = { email, password, name }
    if (inviteToken) body.inviteToken = inviteToken
    const data = await api.post('/auth/signup', body)
    // Cookie is set by server; keep localStorage for backward compat
    if (data.token) {
      localStorage.setItem('token', data.token)
    }
    setUser(data.user)
    applyLanguageFromUser(data.user)
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout', {})
    } catch {
      // Best effort — clear local state regardless
    }
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    setUser(null)
  }

  const isOrgAdmin = !!(user?.organization?.isOwner || user?.memberRole === 'admin')

  return (
    <AuthContext.Provider value={{ user, loading, isOrgAdmin, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
