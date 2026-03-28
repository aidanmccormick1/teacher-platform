import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  HomeIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  UserCircleIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline'
import {
  HomeIcon as HomeSolid,
  BookOpenIcon as BookSolid,
  CalendarDaysIcon as CalendarSolid,
  UserCircleIcon as UserSolid,
} from '@heroicons/react/24/solid'
import { useState } from 'react'
import clsx from 'clsx'

const NAV = [
  { to: '/',           label: 'Dashboard',  Icon: HomeIcon,         IconActive: HomeSolid },
  { to: '/curriculum', label: 'Curriculum', Icon: BookOpenIcon,     IconActive: BookSolid },
  { to: '/schedule',   label: 'Schedule',   Icon: CalendarDaysIcon, IconActive: CalendarSolid },
  { to: '/profile',    label: 'Profile',    Icon: UserCircleIcon,   IconActive: UserSolid },
]

export default function AppShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.full_name ||
    (profile?.email ? profile.email.split('@')[0] : null)
  const firstName = profile?.full_name?.split(' ')[0] ||
    (profile?.email ? profile.email.split('@')[0].replace(/[^a-zA-Z]/g, '') : null)
  const initials = displayName
    ? displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  // Get current page label for mobile header
  const currentPage = NAV.find(n => n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))
  const pageLabel = currentPage?.label || 'TeacherOS'

  return (
    <div className="min-h-screen flex bg-[#f7f8fc]">
      {/* Sign out confirmation dialog */}
      {confirmSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-4 border border-gray-100">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-1">
              <ArrowRightStartOnRectangleIcon className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Sign out?</h3>
              <p className="text-sm text-gray-500 mt-1">You'll need to sign back in to access your schedule.</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setConfirmSignOut(false)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-gray-200/80 bg-white">
        {/* Logo area */}
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-navy-800 flex items-center justify-center shrink-0">
              <AcademicCapIcon className="w-4.5 h-4.5 text-white w-[18px] h-[18px]" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold tracking-tight text-gray-900 leading-none">TeacherOS</h1>
              <p className="text-[11px] text-gray-400 mt-0.5 font-medium">Teacher Platform</p>
            </div>
          </div>
        </div>

        {/* User pill */}
        <div className="mx-3 mb-4 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-gray-800 truncate leading-tight">
              {firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : displayName}
            </p>
            <p className="text-[11px] text-gray-400 truncate leading-tight">{profile?.email}</p>
          </div>
        </div>

        {/* Nav label */}
        <p className="px-5 text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Menu</p>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV.map(({ to, label, Icon, IconActive }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-navy-800 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive
                    ? <IconActive className="w-4.5 h-4.5 shrink-0 w-[18px] h-[18px]" />
                    : <Icon className="w-4.5 h-4.5 shrink-0 w-[18px] h-[18px]" />
                  }
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: sign out */}
        <div className="px-3 py-4 mt-4 border-t border-gray-100">
          <button
            onClick={() => setConfirmSignOut(true)}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-[13px] font-medium text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all duration-150"
          >
            <ArrowRightStartOnRectangleIcon className="w-[18px] h-[18px] shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 bg-white border-b border-gray-200 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-navy-800 flex items-center justify-center">
            <AcademicCapIcon className="w-4 h-4 text-white" />
          </div>
          <span className="text-[15px] font-bold text-gray-900">{pageLabel}</span>
        </div>
        <button onClick={() => setMobileOpen(v => !v)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          {mobileOpen
            ? <XMarkIcon className="w-5 h-5 text-gray-600" />
            : <Bars3Icon className="w-5 h-5 text-gray-600" />
          }
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-10 flex">
          <div className="w-64 bg-white border-r border-gray-200 flex flex-col pt-16 shadow-2xl">
            {/* User pill mobile */}
            <div className="mx-3 mt-3 mb-4 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-gray-800 truncate">{displayName}</p>
                <p className="text-[11px] text-gray-400 truncate">{profile?.email}</p>
              </div>
            </div>

            <nav className="flex-1 px-3 space-y-0.5">
              {NAV.map(({ to, label, Icon, IconActive }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all',
                      isActive
                        ? 'bg-navy-800 text-white'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? <IconActive className="w-[18px] h-[18px] shrink-0" /> : <Icon className="w-[18px] h-[18px] shrink-0" />}
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="px-3 py-4 border-t border-gray-100">
              <button
                onClick={() => { setMobileOpen(false); setConfirmSignOut(true) }}
                className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-[13px] font-medium text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all"
              >
                <ArrowRightStartOnRectangleIcon className="w-[18px] h-[18px]" />
                Sign out
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 md:pt-0 pt-14 overflow-x-hidden">
        <div className="max-w-5xl mx-auto px-5 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
