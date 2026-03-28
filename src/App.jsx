import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'

// Pages
import LoginPage        from '@/pages/LoginPage'
import OnboardingPage   from '@/pages/OnboardingPage'
import DashboardPage    from '@/pages/DashboardPage'
import LessonTrackerPage from '@/pages/LessonTrackerPage'
import CurriculumPage   from '@/pages/CurriculumPage'
import CoursePage       from '@/pages/CoursePage'
import SchedulePage     from '@/pages/SchedulePage'
import AppShell         from '@/components/AppShell'

function RequireAuth({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace />
  return children
}

function RequireOnboarded({ children }) {
  const { profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (profile && !profile.onboarded) return <Navigate to="/onboarding" replace />
  return children
}

function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-3 border-navy-800 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function AppRoutes() {
  const { session, profile, loading } = useAuth()

  if (loading) return <FullPageSpinner />

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={
        session ? <Navigate to="/" replace /> : <LoginPage />
      } />

      {/* Onboarding — auth required but not yet onboarded */}
      <Route path="/onboarding" element={
        <RequireAuth>
          <OnboardingPage />
        </RequireAuth>
      } />

      {/* Protected app routes */}
      <Route element={
        <RequireAuth>
          <RequireOnboarded>
            <AppShell />
          </RequireOnboarded>
        </RequireAuth>
      }>
        <Route path="/"            element={<DashboardPage />} />
        <Route path="/curriculum"  element={<CurriculumPage />} />
        <Route path="/courses/:id" element={<CoursePage />} />
        <Route path="/schedule"    element={<SchedulePage />} />
        <Route
          path="/sections/:sectionId/lessons/:lessonId"
          element={<LessonTrackerPage />}
        />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
