import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';
import { useApiClient } from '../lib/api.js';

const links = [
  { path: '/', label: 'Dashboard' },
  { path: '/classroom', label: 'Classroom' },
  { path: '/curriculum', label: 'Curriculum' },
  { path: '/schedule', label: 'Schedule' },
  { path: '/notes', label: 'My notes' },
  { path: '/school', label: 'School' },
  { path: '/profile', label: 'Profile' }
];

export function AppShell() {
  const auth = useAppAuth();
  const api = useApiClient();

  useEffect(() => {
    void (async () => {
      try {
        const account = await api.getAccountTimezone();
        if (account.timezone) return;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timezone) await api.initializeTimezone(timezone);
      } catch {
        // Timezone setup should never prevent normal navigation; retry next load.
      }
    })();
  }, [api]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>TeacherOS</h2>
        <p className="muted">{auth.email ?? auth.userId ?? 'Signed in'}</p>
        <nav>
          {links.map((link) => (
            <NavLink key={link.path} to={link.path}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            void auth.signOut();
          }}
          style={{ marginTop: 18 }}
        >
          Sign out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
