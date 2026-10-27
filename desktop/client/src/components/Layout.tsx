import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { hubBridge } from '../lib/hub'
import { Network, Table2, Route, ListTodo } from 'lucide-react'
import MatterPicker from './MatterPicker'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import CommandPalette from './CommandPalette'
import {
  LayoutDashboard,
  FileSearch,
  Search,
  Archive,
  ClipboardList,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  ScanSearch,
  Users,
  Wrench,
  Briefcase,
} from 'lucide-react'

export default function Layout() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    return saved === 'true'
  })

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('nav.home') },
    { to: '/upload', icon: FileSearch, label: t('nav.analyse') },
    { to: '/research', icon: Search, label: t('nav.research') },
    { to: '/investigate', icon: ScanSearch, label: t('nav.investigate') },
    { to: '/vault', icon: Archive, label: t('nav.vault') },
    { to: '/workshop', icon: Wrench, label: t('nav.workshop'), badge: 'BETA' },
    { to: '/ma', icon: Briefcase, label: t('nav.ma'), badge: 'NEW' },
    ...((window as any).lexvault?.engine ? [{ to: '/hub', icon: Network, label: t('nav.hub', 'OpenLex hub') }, { to: '/grid', icon: Table2, label: t('nav.grid', 'Review grid') }, { to: '/plans', icon: Route, label: t('nav.plans', 'Plans') }, { to: '/desk', icon: ListTodo, label: t('nav.desk', 'Matter desk') }] : []),
  ]

  // Electron App build: identity is the license file, so logout / signup /
  // team admin all live elsewhere (launcher / sales site). Hide them.
  const isElectron = typeof window !== 'undefined' && (window as any).lexvault?.isElectron
  const bottomItems = [
    ...(isElectron ? [] : [{ to: '/admin', icon: Users, label: t('nav.team') }]),
    { to: '/audit', icon: ClipboardList, label: t('nav.audit') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ]

  // Word plugin → App handoff: "continue in the app" opens Research with the
  // question pre-filled (main process already brought the window forward).
  useEffect(() => {
    const hub = hubBridge()
    if (!hub) return
    hub.onEvent((ev) => {
      if (ev.type === 'open-in-app') {
        navigate('/research', { state: { prefill: ev.data?.query || '' } })
      }
    })
  }, [navigate])

  // Restore saved theme on app load
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark') {
      document.documentElement.classList.add('dark')
    }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="h-screen bg-obsidian flex flex-col overflow-hidden">
      {/* Windows-only title-bar drag region. macOS hiddenInset handles this
          natively via the trafficLightPosition we set in main.js.
          Without this 32px strip Electron's titleBarOverlay sits ON TOP of
          app content (close/min/max clip into the jurisdiction picker etc.)
          and the window can't be dragged at all. */}
      {(typeof window !== 'undefined' && (window as any).lexvault?.isElectron
        && /win/i.test(navigator.platform || '')) && (
        <div
          className="flex-shrink-0 bg-obsidian"
          style={{ height: 32, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      <div className="flex-1 flex overflow-hidden">
      {/* Command Palette */}
      <CommandPalette />

      {/* Sidebar */}
      <aside
        className={`
          bg-deep-brown border-r border-tobacco flex flex-col
          transition-all duration-300 ease-in-out flex-shrink-0
          ${sidebarCollapsed ? 'w-16' : 'w-64'}
        `}
      >
        {/* Logo */}
        <div className="p-4 border-b border-tobacco flex items-center justify-between min-h-[72px]">
          {!sidebarCollapsed && (
            <h1 className="font-serif text-2xl text-parchment font-bold tracking-wide">
              Open<span className="text-accent">Lex</span>
            </h1>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`p-2 rounded-button text-antique hover:text-cream hover:bg-leather transition-all ${
              sidebarCollapsed ? 'mx-auto' : ''
            }`}
            title={sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            {sidebarCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
        </div>

        {/* Matter (shared with the Word plugin) */}
        {!sidebarCollapsed && <MatterPicker />}

        {/* Navigation */}
        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-button transition-all duration-200 focus:outline-none
                    ${sidebarCollapsed ? 'justify-center' : ''}
                    ${isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-cream hover:bg-leather hover:text-parchment'
                    }`
                  }
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon size={20} className="flex-shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="font-medium flex items-center gap-1.5">
                      {item.label}
                      {'badge' in item && item.badge && (
                        <span className="text-[9px] bg-accent/20 text-accent px-1 py-px rounded font-semibold tracking-wider leading-none">{item.badge}</span>
                      )}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom items */}
        <div className="p-2 border-t border-tobacco">
          <ul className="space-y-1">
            {bottomItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-button transition-all duration-200 focus:outline-none
                    ${sidebarCollapsed ? 'justify-center' : ''}
                    ${isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-antique hover:bg-leather hover:text-cream'
                    }`
                  }
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon size={18} className="flex-shrink-0" />
                  {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
                </NavLink>
              </li>
            ))}
            {!isElectron && (
              <li>
                <button
                  onClick={handleLogout}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-button
                            text-antique hover:bg-burgundy/20 hover:text-red-400
                            transition-all duration-200
                            ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title={sidebarCollapsed ? t('nav.logout') : undefined}
                >
                  <LogOut size={18} className="flex-shrink-0" />
                  {!sidebarCollapsed && <span className="text-sm">{t('nav.logout')}</span>}
                </button>
              </li>
            )}
          </ul>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      </div>
    </div>
  )
}
