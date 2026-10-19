import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, ArrowLeft, KeyRound, CheckCircle } from 'lucide-react'
import { api } from '../lib/api'

export default function ResetPassword() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  // No token = show forgot-password form
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setEmailSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed. Link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="card animate-fade-in text-center py-10">
            <CheckCircle size={48} className="mx-auto text-forest mb-4" />
            <h1 className="font-serif text-2xl text-parchment mb-2">{t('auth.passwordResetSuccess')}</h1>
            <p className="text-cream-dark text-sm">
              Your password has been reset successfully. Redirecting to login...
            </p>
            <Link to="/login" className="btn-primary inline-block mt-6">
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Forgot password form (no token in URL)
  if (!token) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <h1 className="font-serif text-4xl text-parchment font-bold tracking-wide mb-2">
              Lex<span className="text-accent">Vault</span>
            </h1>
          </div>

          <div className="card animate-fade-in">
            <Link to="/login" className="inline-flex items-center text-sm text-cream-dark hover:text-parchment transition-colors mb-6">
              <ArrowLeft size={16} className="mr-2" /> Back to login
            </Link>

            <h2 className="font-serif text-2xl text-parchment mb-2">{t('auth.resetPasswordTitle')}</h2>
            <p className="text-cream-dark text-sm mb-6">
              Enter your email and we'll send you a reset link.
            </p>

            {emailSent ? (
              <div className="bg-forest/10 border border-forest/30 rounded-card px-4 py-6 text-center">
                <CheckCircle size={32} className="mx-auto text-forest mb-3" />
                <p className="text-cream text-sm">
                  If an account exists with that email, we've sent a password reset link.
                </p>
                <p className="text-antique text-xs mt-2">Check your inbox and spam folder.</p>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-cream text-sm mb-2">{t('common.email')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input w-full"
                    placeholder={t('auth.emailPlaceholder')}
                    required
                  />
                </div>

                {error && (
                  <div className="bg-burgundy/20 border border-burgundy/50 rounded-button px-4 py-3 text-red-300 text-sm">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Reset password form (token in URL)
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="font-serif text-4xl text-parchment font-bold tracking-wide mb-2">
            Lex<span className="text-accent">Vault</span>
          </h1>
        </div>

        <div className="card animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-accent/20 rounded-card flex items-center justify-center">
              <KeyRound size={24} className="text-accent" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-parchment">{t('auth.newPasswordTitle')}</h2>
              <p className="text-cream-dark text-sm">Choose a strong password</p>
            </div>
          </div>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-cream text-sm mb-2">New Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input w-full pr-10"
                  placeholder="Min. 8 characters"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-antique hover:text-parchment transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-cream text-sm mb-2">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input w-full"
                placeholder="Repeat password"
                required
              />
            </div>

            {error && (
              <div className="bg-burgundy/20 border border-burgundy/50 rounded-button px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
