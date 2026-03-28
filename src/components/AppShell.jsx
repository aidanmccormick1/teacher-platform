import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  HomeIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useState } from 'react'
import clsx from 'clsx'

const NAV = [
  { to: '/',           label: 'Dashboard',  Icon: HomeIcon },
  { to: '/curriculum', label: 'Curriculum', Icon: BookOpenIcon },
  { to: '/schedule',   label: 'Schedule',   Icon: CalendarDaysIcon },
]

export default function AppShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-56 bg-navy-900 text-white shrink-0">
        <div className="px-5 py-6 border-b border-navy-800">
          <h1 className="text-lg font-bold tracking-tight">TeacherOS</h1>
          <p className="text-xs text-navy-300 mt-0.5 truncate">
            {profile?.full_name || profile?.email}
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-navy-700 text-white'
                    : 'text-navy-300 hover:bg-navy-800 hover:text-white'
                )
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-navy-800">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm font-medium text-navy-300 hover:bg-navy-800 hover:text-white transition-colors"
          >
            <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 bg-navy-900 text-white flex items-center justify-between px-4 py-3 shadow-lg">
        <h1 className="text-base font-bold">TeacherOS</h1>
        <button onClick={() => setMobileOpen(v => !v)} className="p-1">
          {mobileOpen
            ? <XMarkIcon className="w-6 h-6" />
            : <Bars3Icon className="w-6 h-6" />
          }
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-10 flex">
          <div className="w-56 bg-navy-900 text-white flex flex-col pt-16">
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-navy-700 text-white'
                        : 'text-navy-300 hover:bg-navy-800 hover:text-white'
                    )
                  }
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="px-3 py-4 border-t border-navy-800">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm font-medium text-navy-300 hover:bg-navy-800 hover:text-white transition-colors"
              >
                <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
                Sign out
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
