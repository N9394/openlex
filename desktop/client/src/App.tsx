import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Research from './pages/Research'
import Settings from './pages/Settings'
import ResetPassword from './pages/ResetPassword'
import Admin from './pages/Admin'
import AcceptInvite from './pages/AcceptInvite'
import Hub from './pages/Hub'
import Grid from './pages/Grid'
import Plans from './pages/Plans'
import Desk from './pages/Desk'
import Saved from './pages/Saved'
import Record from './pages/Record'
import Moved from './pages/Moved'
import More from './pages/More'
import Matters from './pages/Matters'
import Help from './pages/Help'
import Setup from './pages/Setup'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center">
        <div className="text-accent animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// The pages of the old desktop server (Upload, Vault, Investigate, Workshop,
// M&A, Audit, DocumentView, Navigator) moved into the chat and onto the
// engine; their old addresses show where they went. Their code stays in the
// repository for now (pages/*.tsx, desktop/server) but nothing calls it.

// The desktop App has no accounts (identity is the license or the local
// community user), so its sign-in / sign-up routes go straight to the app.
const isElectron = typeof window !== 'undefined' && !!(window as any).lexvault?.isElectron

function App() {
  return (
    <Routes>
      <Route path="/login" element={isElectron ? <Navigate to="/research" replace /> : <Login />} />
      <Route path="/signup" element={isElectron ? <Navigate to="/research" replace /> : <Signup />} />
      <Route path="/forgot-password" element={isElectron ? <Navigate to="/research" replace /> : <ResetPassword />} />
      <Route path="/reset-password" element={isElectron ? <Navigate to="/research" replace /> : <ResetPassword />} />
      <Route path="/invite/:invitationId" element={isElectron ? <Navigate to="/research" replace /> : <AcceptInvite />} />
      <Route path="/" element={<Navigate to="/research" replace />} />

      <Route element={<ProtectedRoute><ErrorBoundary><Layout /></ErrorBoundary></ProtectedRoute>}>
        <Route path="/workshop" element={<Moved command="draft" what="Workshop" />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/research" element={<Research />} />
        <Route path="/hub" element={<Hub />} />
        <Route path="/grid" element={<Grid />} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/desk" element={<Desk />} />
        <Route path="/upload" element={<Moved command="analyse" what="Analyse" />} />
        <Route path="/vault" element={<Saved />} />
        <Route path="/investigate" element={<Moved command="investigate" what="Investigate" />} />
        <Route path="/audit" element={<Record />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/more" element={<More />} />
        <Route path="/matters" element={<Matters />} />
        <Route path="/help" element={<Help />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/admin" element={isElectron ? <Navigate to="/research" replace /> : <Admin />} />
        <Route path="/documents/:id" element={<Moved command="analyse" what="Document analysis" />} />
        <Route path="/navigator" element={<Moved command="draft" what="Navigator" />} />
        <Route path="/ma" element={<Moved command="diligence" what="M&A" />} />
        <Route path="/ma/:dealId/setup" element={<Moved command="diligence" what="M&A" />} />
        <Route path="/ma/:dealId" element={<Moved command="diligence" what="M&A" />} />
      </Route>
    </Routes>
  )
}

export default App
