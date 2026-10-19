import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import {
  Users,
  UserPlus,
  BarChart3,
  Shield,
  ShieldCheck,
  MoreVertical,
  RefreshCw,
  UserMinus,
  Ban,
  CheckCircle,
  Key,
  Trash2,
  Mail,
  Clock,
} from 'lucide-react'

interface Seat {
  id: string
  userId: string | null
  email: string | null
  name: string | null
  seatType: string
  status: string
  isActive: boolean
  memberRole: string | null
  lastActive: string | null
  assignedAt: string | null
  createdAt: string
}

interface MemberStat {
  id: string
  email: string
  name: string | null
  role: string | null
  lastActive: string | null
  documentCount: number
  queryCount: number
}

interface PendingInvite {
  id: string
  orgName: string
  orgSlug: string
  role: string
  createdAt: string
  expiresAt: string
}

export default function Admin() {
  const { t } = useTranslation()
  const { user, isOrgAdmin } = useAuth()
  const hasOrg = !!user?.organization

  const [seats, setSeats] = useState<Seat[]>([])
  const [stats, setStats] = useState<MemberStat[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'team' | 'stats'>('team')

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Action menu
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Password change
  const [passwordSeatId, setPasswordSeatId] = useState<string | null>(null)
  const [passwordSeatEmail, setPasswordSeatEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  // Pending invitations (for users not in an org)
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null)

  // Delete team
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingTeam, setDeletingTeam] = useState(false)

  // Close menu on click outside
  useEffect(() => {
    if (!openMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenu])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      if (isOrgAdmin) {
        const [seatsData, statsData] = await Promise.all([
          api.get('/org/seats'),
          api.get('/org/stats'),
        ])
        setSeats(seatsData.seats || [])
        setStats(statsData.stats || [])
      } else if (!hasOrg) {
        // Fetch pending invitations for this user
        const data = await api.get('/org/invites/mine')
        setPendingInvites(data.invitations || [])
      }
    } catch (err) {
      console.error('Failed to fetch team data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteMsg(null)

    try {
      await api.post('/org/seats', { email: inviteEmail.trim(), role: inviteRole })
      setInviteMsg({ type: 'success', text: `Invitation sent to ${inviteEmail}` })
      setInviteEmail('')
      setInviteRole('member')
      fetchData()
    } catch (err) {
      setInviteMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send invitation' })
    } finally {
      setInviting(false)
    }
  }

  const handleAcceptInvite = async (inviteId: string) => {
    setAcceptingInvite(inviteId)
    try {
      await api.post(`/org/invite/${inviteId}/accept`, {})
      // Refresh auth context to pick up new org
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to accept invitation')
      setAcceptingInvite(null)
    }
  }

  const handleDeleteTeam = async () => {
    setDeletingTeam(true)
    try {
      await api.delete('/org')
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete team')
      setDeletingTeam(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleChangeRole = async (seatId: string, newRole: string) => {
    setActionLoading(seatId)
    try {
      await api.patch(`/org/seats/${seatId}`, { role: newRole })
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to change role')
    } finally {
      setActionLoading(null)
      setOpenMenu(null)
    }
  }

  const handleToggleStatus = async (seatId: string, currentStatus: string) => {
    setActionLoading(seatId)
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active'
    try {
      await api.patch(`/org/seats/${seatId}/status`, { status: newStatus })
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setActionLoading(null)
      setOpenMenu(null)
    }
  }

  const openPasswordDialog = (seatId: string, email: string | null) => {
    setPasswordSeatId(seatId)
    setPasswordSeatEmail(email || '')
    setNewPassword('')
    setOpenMenu(null)
  }

  const handleChangePassword = async () => {
    if (!passwordSeatId || newPassword.length < 6) return
    setChangingPassword(true)
    try {
      await api.post(`/org/seats/${passwordSeatId}/reset-password`, { newPassword })
      alert(t('admin.passwordUpdated', { email: passwordSeatEmail }))
      setPasswordSeatId(null)
      setNewPassword('')
    } catch (err) {
      alert(err instanceof Error ? err.message : t('admin.failedChangePassword'))
    } finally {
      setChangingPassword(false)
    }
  }

  const handleRemoveSeat = async (seatId: string, email: string | null) => {
    if (!confirm(t('admin.removeConfirmMsg', { email: email || t('admin.thisSeat') }))) return
    setActionLoading(seatId)
    try {
      await api.delete(`/org/seats/${seatId}`)
      fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('admin.failedRemoveSeat'))
    } finally {
      setActionLoading(null)
      setOpenMenu(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-antique animate-pulse">{t('common.loading')}</div>
      </div>
    )
  }

  // ── No org: show pending invitations ────────────────────────────────────
  if (!hasOrg) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="font-serif text-3xl text-parchment mb-2">{t('admin.title')}</h1>
        <p className="text-antique mb-8">{t('admin.notInTeam')}</p>

        {pendingInvites.length > 0 ? (
          <div className="space-y-4">
            <h2 className="font-serif text-lg text-parchment flex items-center gap-2">
              <Mail size={20} /> {t('admin.pendingInvitations')}
            </h2>
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="card flex items-center justify-between">
                <div>
                  <div className="text-cream font-medium">{inv.orgName}</div>
                  <div className="text-antique text-sm">
                    {t('admin.invitedAs')} <span className="text-accent">{inv.role}</span>
                    <span className="mx-2">·</span>
                    <Clock size={12} className="inline -mt-0.5" /> {t('admin.inviteExpires', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                  </div>
                </div>
                <button
                  onClick={() => handleAcceptInvite(inv.id)}
                  disabled={acceptingInvite === inv.id}
                  className="btn-primary"
                >
                  {acceptingInvite === inv.id ? t('admin.joining') : t('admin.accept')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card text-center py-12">
            <Users size={40} className="mx-auto text-antique mb-4" />
            <p className="text-antique">{t('admin.noPendingInvitations')}</p>
            <p className="text-antique text-sm mt-1">{t('admin.askAdminToInvite')}</p>
          </div>
        )}
      </div>
    )
  }

  // ── Helper badges ──────────────────────────────────────────────────────
  const roleBadge = (role: string | null) => {
    if (!role) return null
    const colors: Record<string, string> = {
      owner: 'bg-amber-500/20 text-amber-400',
      admin: 'bg-blue-500/20 text-blue-400',
      member: 'bg-green-500/20 text-green-400',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[role] || 'bg-gray-500/20 text-gray-400'}`}>
        {role}
      </span>
    )
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'text-green-400',
      pending: 'text-amber-400',
      suspended: 'text-red-400',
    }
    return (
      <span className={`text-xs ${colors[status] || 'text-antique'}`}>
        {status}
      </span>
    )
  }

  // ── Non-admin member: read-only view with leave option ──────────────────
  if (!isOrgAdmin) {
    const handleLeave = async () => {
      if (!confirm(t('admin.leaveConfirm'))) return
      try {
        await api.post('/org/leave', {})
        window.location.reload()
      } catch (err) {
        alert(err instanceof Error ? err.message : t('admin.failedLeave'))
      }
    }

    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="font-serif text-3xl text-parchment mb-2">{t('admin.title')}</h1>
        <p className="text-antique mb-6">{user?.organization?.name}</p>
        <div className="card text-center py-8">
          <Users size={32} className="mx-auto text-antique mb-3" />
          <p className="text-cream">{t('admin.youAreMember')}</p>
          <p className="text-antique text-sm mt-1 mb-6">{t('admin.contactAdmin')}</p>
          <button
            onClick={handleLeave}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            {t('admin.leaveTeam')}
          </button>
        </div>
      </div>
    )
  }

  // ── Admin view ─────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-parchment mb-2">{t('admin.title')}</h1>
          <p className="text-antique">{user?.organization?.name}</p>
        </div>
        {user?.organization?.isOwner && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-burgundy/20 rounded-button transition-colors"
          >
            <Trash2 size={16} /> {t('admin.deleteTeam')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('team')}
          className={`flex items-center gap-2 px-4 py-2 rounded-button transition-all ${
            activeTab === 'team' ? 'bg-accent/10 text-accent' : 'text-cream hover:bg-leather'
          }`}
        >
          <Users size={18} /> {t('nav.team')}
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`flex items-center gap-2 px-4 py-2 rounded-button transition-all ${
            activeTab === 'stats' ? 'bg-accent/10 text-accent' : 'text-cream hover:bg-leather'
          }`}
        >
          <BarChart3 size={18} /> {t('admin.usage')}
        </button>
      </div>

      {activeTab === 'team' && (
        <>
          {/* Invite Form */}
          <div className="card mb-6">
            <h2 className="font-serif text-lg text-parchment mb-4 flex items-center gap-2">
              <UserPlus size={20} /> {t('admin.inviteMember')}
            </h2>
            <form onSubmit={handleInvite} className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-cream text-sm mb-1">{t('common.email')}</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('admin.emailPlaceholder')}
                  className="input w-full"
                  required
                />
              </div>
              <div className="w-36">
                <label className="block text-cream text-sm mb-1">{t('admin.role')}</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="input w-full"
                >
                  <option value="member">{t('admin.roleMember')}</option>
                  <option value="admin">{t('admin.roleAdmin')}</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="btn-primary whitespace-nowrap"
              >
                {inviting ? t('admin.inviting') : t('admin.sendInvite')}
              </button>
            </form>
            {inviteMsg && (
              <div className={`mt-3 text-sm ${inviteMsg.type === 'success' ? 'text-forest' : 'text-red-400'}`}>
                {inviteMsg.text}
              </div>
            )}
          </div>

          {/* Team Table */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg text-parchment flex items-center gap-2">
                <Users size={20} /> {t('admin.teamMembers', { count: seats.length })}
              </h2>
              <button onClick={fetchData} className="text-antique hover:text-cream transition-colors">
                <RefreshCw size={16} />
              </button>
            </div>

            <div className="overflow-visible">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-tobacco text-antique text-sm text-left">
                    <th className="pb-3 pr-4">{t('admin.roleMember')}</th>
                    <th className="pb-3 pr-4">{t('admin.role')}</th>
                    <th className="pb-3 pr-4">{t('common.status')}</th>
                    <th className="pb-3 pr-4">{t('admin.lastActive')}</th>
                    <th className="pb-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {seats.map((seat) => {
                    const isOwnerSeat = seat.userId === user?.id && user?.organization?.isOwner
                    return (
                      <tr key={seat.id} className="border-b border-tobacco/50 hover:bg-leather/30 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="text-cream text-sm">{seat.name || seat.email}</div>
                          {seat.name && <div className="text-antique text-xs">{seat.email}</div>}
                        </td>
                        <td className="py-3 pr-4">
                          {isOwnerSeat ? roleBadge('owner') : roleBadge(seat.seatType)}
                        </td>
                        <td className="py-3 pr-4">{statusBadge(seat.status)}</td>
                        <td className="py-3 pr-4 text-antique text-xs">
                          {seat.lastActive
                            ? new Date(seat.lastActive).toLocaleDateString()
                            : seat.status === 'pending' ? t('admin.invitePending') : '—'}
                        </td>
                        <td className="py-3 relative">
                          {!isOwnerSeat && (
                            <div className="relative" ref={openMenu === seat.id ? menuRef : undefined}>
                              <button
                                onMouseDown={(e) => { e.stopPropagation(); setOpenMenu(openMenu === seat.id ? null : seat.id) }}
                                className="p-1 text-antique hover:text-cream rounded transition-colors"
                                disabled={actionLoading === seat.id}
                              >
                                {actionLoading === seat.id
                                  ? <RefreshCw size={16} className="animate-spin" />
                                  : <MoreVertical size={16} />}
                              </button>

                              {openMenu === seat.id && (
                                <div className="absolute right-0 top-8 z-50 w-48 bg-deep-brown border border-tobacco rounded-card shadow-lg py-1"
                                     onMouseDown={(e) => e.stopPropagation()}>
                                  {seat.seatType === 'member' && (
                                    <button
                                      onClick={() => handleChangeRole(seat.id, 'admin')}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-cream hover:bg-leather transition-colors"
                                    >
                                      <ShieldCheck size={14} /> {t('admin.makeAdmin')}
                                    </button>
                                  )}
                                  {seat.seatType === 'admin' && (
                                    <button
                                      onClick={() => handleChangeRole(seat.id, 'member')}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-cream hover:bg-leather transition-colors"
                                    >
                                      <Shield size={14} /> {t('admin.makeMember')}
                                    </button>
                                  )}
                                  {seat.userId && (
                                    <button
                                      onClick={() => handleToggleStatus(seat.id, seat.status)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-cream hover:bg-leather transition-colors"
                                    >
                                      {seat.status === 'active'
                                        ? <><Ban size={14} /> {t('admin.suspend')}</>
                                        : <><CheckCircle size={14} /> {t('admin.reactivate')}</>}
                                    </button>
                                  )}
                                  {seat.userId && (
                                    <button
                                      onClick={() => openPasswordDialog(seat.id, seat.email)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-cream hover:bg-leather transition-colors"
                                    >
                                      <Key size={14} /> {t('admin.changePassword')}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleRemoveSeat(seat.id, seat.email)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-burgundy/20 transition-colors"
                                  >
                                    <UserMinus size={14} /> {t('common.remove')}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {seats.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-antique">
                        {t('admin.noMembers')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Password Change Modal */}
      {passwordSeatId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-deep-brown border border-tobacco rounded-card p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-serif text-lg text-parchment mb-1">{t('admin.changePassword')}</h3>
            <p className="text-antique text-sm mb-4">{passwordSeatEmail}</p>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('admin.newPasswordPlaceholder')}
              className="input w-full mb-4"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setPasswordSeatId(null); setNewPassword('') }}
                className="px-4 py-2 text-sm text-cream hover:bg-leather rounded-button transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changingPassword || newPassword.length < 6}
                className="btn-primary"
              >
                {changingPassword ? t('common.saving') : t('admin.setPassword')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Team Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-deep-brown border border-tobacco rounded-card p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-serif text-lg text-parchment mb-2">{t('admin.deleteTeam')}</h3>
            <p className="text-antique text-sm mb-4">
              {t('admin.deleteTeamConfirm')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-cream hover:bg-leather rounded-button transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deletingTeam}
                className="px-4 py-2 text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-button transition-colors"
              >
                {deletingTeam ? t('admin.deleting') : t('admin.deleteTeam')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="card">
          <h2 className="font-serif text-lg text-parchment mb-4 flex items-center gap-2">
            <BarChart3 size={20} /> {t('admin.memberUsage')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-tobacco text-antique text-sm text-left">
                  <th className="pb-3 pr-4">{t('admin.roleMember')}</th>
                  <th className="pb-3 pr-4">{t('admin.role')}</th>
                  <th className="pb-3 pr-4 text-right">{t('admin.documents')}</th>
                  <th className="pb-3 pr-4 text-right">{t('admin.queries')}</th>
                  <th className="pb-3 text-right">{t('admin.lastActive')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.id} className="border-b border-tobacco/50 hover:bg-leather/30 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="text-cream text-sm">{s.name || s.email}</div>
                      {s.name && <div className="text-antique text-xs">{s.email}</div>}
                    </td>
                    <td className="py-3 pr-4">{roleBadge(s.role)}</td>
                    <td className="py-3 pr-4 text-cream text-sm text-right">{s.documentCount}</td>
                    <td className="py-3 pr-4 text-cream text-sm text-right">{s.queryCount}</td>
                    <td className="py-3 text-antique text-xs text-right">
                      {s.lastActive ? new Date(s.lastActive).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-antique">
                      {t('admin.noUsageData')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
