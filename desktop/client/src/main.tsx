import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'

// Electron loads index.html via file:// — BrowserRouter would see the
// Windows file path as the pathname and match no route. HashRouter keeps
// the route in the URL fragment, which works the same on every protocol.
// Web deployments (https://) keep clean BrowserRouter URLs.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import UpdateBanner from './components/UpdateBanner'
import PackBanner from './components/PackBanner'
import './i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <UpdateBanner />
          <PackBanner />
        </AuthProvider>
      </QueryClientProvider>
    </Router>
  </React.StrictMode>,
)
