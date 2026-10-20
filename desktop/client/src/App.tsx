import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Research from './pages/Research'
import Upload from './pages/Upload'
import Vault from './pages/Vault'
import Workshop from './pages/Workshop'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import DocumentView from './pages/DocumentView'
import Investigate from './pages/Investigate'
import ResetPassword from './pages/ResetPassword'
import Admin from './pages/Admin'
import AcceptInvite from './pages/AcceptInvite'
import MaDashboard from './pages/MaDashboard'
import MaDealSetup from './pages/MaDealSetup'
import MaDeal from './pages/MaDeal'
import Hub from './pages/Hub'
import Grid from './pages/Grid'
import Plans from './pages/Plans'

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

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ResetPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:invitationId" element={<AcceptInvite />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<ProtectedRoute><ErrorBoundary><Layout /></ErrorBoundary></ProtectedRoute>}>
        <Route path="/workshop" element={<Workshop />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/research" element={<Research />} />
        <Route path="/hub" element={<Hub />} />
        <Route path="/grid" element={<Grid />} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/vault" element={<Vault />} />
        <Route path="/investigate" element={<Investigate />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/documents/:id" element={<DocumentView />} />
        <Route path="/ma" element={<MaDashboard />} />
        <Route path="/ma/:dealId/setup" element={<MaDealSetup />} />
        <Route path="/ma/:dealId" element={<MaDeal />} />
      </Route>
    </Routes>
  )
}

export default App
