import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'

// Pages — immediate load (critical)
import LoginPage        from '@/pages/LoginPage'
import OnboardingPage   from '@/pages/OnboardingPage'
import DashboardPage    from '@/pages/DashboardPage'
import AppShell         from '@/components/AppShell'

// Pages — lazy load (not critical, can defer)
const SchoolPage = lazy(() => import('@/pages/SchoolPage'))
const LessonTrackerPage = lazy(() => import('@/pages/LessonTrackerPage'))
const CurriculumPage = lazy(() => import('@/pages/CurriculumPage'))
const CoursePage = lazy(() => import('@/pages/CoursePage'))
const SchedulePage = lazy(() => import('@/pages/SchedulePage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const ClassroomPage = lazy(() => import('@/pages/ClassroomPage'))

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
    <div className="min-h-screen flex items-center justify-center bg-[#f4f7f4]">
      <div className="w-8 h-8 border-[3px] border-navy-800 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function PageLoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl border border-gray-100 p-4 animate-pulse">
          <div className="flex gap-4">
            <div className="w-14 h-10 bg-gray-100 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        </div>
      ))}
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
        <Route path="/school"      element={
          <Suspense fallback={<PageLoadingSkeleton />}>
            <SchoolPage />
          </Suspense>
        } />
        <Route path="/classroom"   element={
          <Suspense fallback={<PageLoadingSkeleton />}>
            <ClassroomPage />
          </Suspense>
        } />
        <Route path="/curriculum"  element={
          <Suspense fallback={<PageLoadingSkeleton />}>
            <CurriculumPage />
          </Suspense>
        } />
        <Route path="/courses/:id" element={
          <Suspense fallback={<PageLoadingSkeleton />}>
            <CoursePage />
          </Suspense>
        } />
        <Route path="/schedule"    element={
          <Suspense fallback={<PageLoadingSkeleton />}>
            <SchedulePage />
          </Suspense>
        } />
        <Route
          path="/sections/:sectionId/lessons/:lessonId"
          element={
            <Suspense fallback={<PageLoadingSkeleton />}>
              <LessonTrackerPage />
            </Suspense>
          }
        />
        <Route path="/profile" element={
          <Suspense fallback={<PageLoadingSkeleton />}>
            <ProfilePage />
          </Suspense>
        } />
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
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { borderRadius: '12px', fontSize: '13px' },
          duration: 3500,
        }}
      />
    </AuthProvider>
  )
}
