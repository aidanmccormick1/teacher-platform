import { SignIn, SignUp } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

type LoginMode = 'signin' | 'signup';

const devAccounts = [
  { label: 'Primary teacher', userId: 'teacher-dev-1', email: 'teacher@example.com' },
  { label: 'Tester account', userId: 'teacher-dev-2', email: 'tester@example.com' }
];

export function LoginPage() {
  const auth = useAppAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [devUserId, setDevUserId] = useState('teacher-dev-1');
  const [devEmail, setDevEmail] = useState('teacher@example.com');

  useEffect(() => {
    if (auth.isSignedIn) navigate('/');
  }, [auth.isSignedIn, navigate]);

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setSearchParams(nextMode === 'signup' ? { mode: 'signup' } : {});
  }

  if (auth.mode === 'clerk') {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="login-intro">
            <p className="muted">TeacherOS v2</p>
            <h1>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
          </div>

          <div className="login-tabs" role="tablist" aria-label="Login options">
            <button
              className={mode === 'signin' ? 'active' : 'secondary'}
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => switchMode('signin')}
            >
              Sign in
            </button>
            <button
              className={mode === 'signup' ? 'active' : 'secondary'}
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => switchMode('signup')}
            >
              Create account
            </button>
          </div>

          {mode === 'signin' ? (
            <SignIn fallbackRedirectUrl="/" signUpUrl="/login?mode=signup" />
          ) : (
            <SignUp fallbackRedirectUrl="/onboarding" signInUrl="/login" />
          )}
        </section>
      </main>
    );
  }

  function useDevAccount(userId: string, email: string) {
    setDevUserId(userId);
    setDevEmail(email);
  }

  return (
    <main className="login-page">
      <div className="card stack login-card">
        <div className="login-intro">
          <p className="muted">TeacherOS v2</p>
          <h1>Developer Login</h1>
          <p className="muted">Clerk publishable key is missing. Using local dev auth mode.</p>
        </div>

        <div className="dev-account-grid">
          {devAccounts.map((account) => (
            <button
              className="secondary"
              type="button"
              key={account.userId}
              onClick={() => useDevAccount(account.userId, account.email)}
            >
              {account.label}
            </button>
          ))}
        </div>

        <label>
          User ID
          <input className="input" value={devUserId} onChange={(e) => setDevUserId(e.target.value)} />
        </label>
        <label>
          Email
          <input className="input" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            auth.signInDev(devUserId, devEmail || null);
            navigate('/');
          }}
        >
          Sign in
        </button>
      </div>
    </main>
  );
}
