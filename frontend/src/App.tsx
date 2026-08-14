import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api.js'
import { ConsultationList } from './routes/ConsultationList.js'
import { ConsultationNew } from './routes/ConsultationNew.js'
import { ConsultationReview } from './routes/ConsultationReview.js'
import { Guidelines } from './routes/Guidelines.js'
import { Landing } from './routes/Landing.js'
import { Login } from './routes/Login.js'
import { Privacy } from './routes/Privacy.js'
import { Settings } from './routes/Settings.js'
import { AppShell } from './shell/AppShell.js'
import { MarketingShell } from './shell/MarketingShell.js'
import { Skeleton } from './ui/Card.js'
import { Toaster } from './ui/Toaster.js'

function RequireSession({ children }: { children: ReactNode }) {
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, retry: false })

  if (session.isPending) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    )
  }
  if (!session.data) return <Navigate to="/login" replace />
  return children
}

export function App() {
  return (
    <BrowserRouter>
      {/* Outside <Routes> so a toast raised during a navigation is not
          unmounted by the navigation that raised it. */}
      <Toaster />
      <Routes>
        {/* Login is deliberately outside the marketing shell: it is a
            full-height split with its own brand pane, and a topbar and footer
            wrapped around that would be chrome competing with chrome. */}
        <Route element={<MarketingShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/privacy" element={<Privacy />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireSession>
              <AppShell />
            </RequireSession>
          }
        >
          <Route path="/consultations" element={<ConsultationList />} />
          <Route path="/consultations/new" element={<ConsultationNew />} />
          <Route path="/consultations/:id" element={<ConsultationReview />} />
          <Route path="/guidelines" element={<Guidelines />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
