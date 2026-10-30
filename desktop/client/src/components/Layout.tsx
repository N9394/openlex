import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { hubBridge } from '../lib/hub'
import MatterPicker from './MatterPicker'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import CommandPalette from './CommandPalette'
import { initTheme } from '../lib/theme'
import { needsSetup, setupSkipped } from '../pages/Setup'
import { useWindowWidth, useWindowHeight, NARROW_APP } from '../lib/viewport'
import {
  MessageSquare,
  FolderOpen,
  LayoutGrid,
  HelpCircle,
  Archive,
  ClipboardList,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Users,
} from 'lucide-react'

export default function Layout() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    return saved === 'true'
  })

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])
  // Narrow window (below 1100 px): icons only; "expand" opens the full
  // sidebar over the page instead of squeezing the chat.
  const width = useWindowWidth()
  const narrow = width < NARROW_APP
  const [overlayOpen, setOverlayOpen] = useState(false)
  useEffect(() => { if (!narrow) setOverlayOpen(false) }, [narrow])
  const collapsed = narrow ? !overlayOpen : sidebarCollapsed
  const toggleSidebar = () => (narrow ? setOverlayOpen((v) => !v) : setSidebarCollapsed(!sidebarCollapsed))
  // Short windows (13–14" laptops): tighter rows so every item fits.
  const short = useWindowHeight() < 820

  // Seven entries (UI audit 2026-10-30): the chat, matters, saved items, the
  // AI record, More tools (Analyse/Investigate/Draft/Due diligence as chat
  // launchers, Review grid, Plans, Matter desk, Hub), Settings and Help.
  const navItems: { to: string; icon: any; label: string; command?: string; also?: string[] }[] = [
    { to: '/research', icon: MessageSquare, label: t('nav.chat', 'Chat & research') },
    { to: '/matters', icon: FolderOpen, label: t('nav.matters', 'Matters') },
    { to: '/vault', icon: Archive, label: t('nav.saved', 'Saved') },
    { to: '/audit', icon: ClipboardList, label: t('nav.record', 'AI record') },
    { to: '/more', icon: LayoutGrid, label: t('nav.more', 'More tools'), also: ['/grid', '/plans', '/desk', '/hub'] },
  ]

  // Electron App build: identity is the license file, so logout / signup /
  // team admin all live elsewhere (launcher / sales site). Hide them.
  const isElectron = typeof window !== 'undefined' && (window as any).lexvault?.isElectron
  const bottomItems = [
    ...(isElectron ? [] : [{ to: '/admin', icon: Users, label: t('nav.team') }]),
    { to: '/settings', icon: Settings, label: t('nav.settings') },
    { to: '/help', icon: HelpCircle, label: t('nav.help', 'Help') },
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

  // First start: no AI set up yet → the setup page (once per start; "Not now" skips it).
  useEffect(() => {
    if (setupSkipped() || location.pathname === '/setup') return
    let alive = true
    needsSetup().then((need) => { if (alive && need) navigate('/setup') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Colours and text size (Settings → Appearance); 'same as this computer' follows the system.
  useEffect(() => { initTheme() }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="h-screen bg-obsidian flex flex-col overflow-clip">
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
      <div className="flex-1 flex overflow-clip min-h-0 relative">
      {/* Command Palette */}
      <CommandPalette />

      {/* Sidebar */}
      {narrow && overlayOpen && <div className="absolute inset-0 z-30 bg-ink/50" onClick={() => setOverlayOpen(false)} aria-hidden="true" />}
      {narrow && <div className="w-16 flex-shrink-0" aria-hidden="true" />}
      <aside
        className={`
          bg-deep-brown border-r border-tobacco flex flex-col min-h-0
          transition-[width] duration-200 ease-in-out flex-shrink-0
          ${collapsed ? 'w-16' : 'w-64'}
          ${narrow ? 'absolute inset-y-0 left-0 z-40 shadow-2xl' : ''}
        `}
        data-testid="app-sidebar"
      >
        {/* Logo */}
        <div className={`px-4 border-b border-tobacco flex items-center justify-between flex-shrink-0 ${short ? 'min-h-[56px]' : 'min-h-[72px]'}`}>
          {!collapsed && (
            <h1 className="font-serif text-2xl text-parchment font-bold tracking-wide">
              Open<span className="text-accent">Lex</span>
            </h1>
          )}
          <button
            onClick={toggleSidebar}
            className={`p-2 rounded-button text-antique hover:text-cream hover:bg-leather transition-all ${
              collapsed ? 'mx-auto' : ''
            }`}
            title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
        </div>

        {/* Matter (shared with the Word plugin) */}
        {!collapsed && <div className="flex-shrink-0"><MatterPicker /></div>}

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-2">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={`${item.to}:${item.command || ''}`}>
                <NavLink
                  to={item.to}
                  state={item.command ? { command: item.command } : undefined}
                  onClick={() => setOverlayOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 ${short ? 'py-2' : 'py-3'} rounded-button transition-all duration-200 focus:outline-none
                    ${collapsed ? 'justify-center' : ''}
                    ${(isActive && !item.command) || item.also?.some((p) => location.pathname.startsWith(p))
                      ? 'bg-accent/10 text-accent'
                      : 'text-cream hover:bg-leather hover:text-parchment'
                    }`
                  }
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                >
                  <item.icon size={20} className="flex-shrink-0" />
                  {!collapsed && <span className="font-medium truncate">{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom items */}
        <div className="p-2 border-t border-tobacco flex-shrink-0">
          <ul className="space-y-1">
            {bottomItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setOverlayOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-button transition-all duration-200 focus:outline-none
                    ${collapsed ? 'justify-center' : ''}
                    ${isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-antique hover:bg-leather hover:text-cream'
                    }`
                  }
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                >
                  <item.icon size={18} className="flex-shrink-0" />
                  {!collapsed && <span className="text-sm">{item.label}</span>}
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
                            ${collapsed ? 'justify-center' : ''}`}
                  title={collapsed ? t('nav.logout') : undefined}
                >
                  <LogOut size={18} className="flex-shrink-0" />
                  {!collapsed && <span className="text-sm">{t('nav.logout')}</span>}
                </button>
              </li>
            )}
          </ul>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 min-h-0 overflow-auto">
        <Outlet />
      </main>
      </div>
    </div>
  )
}
