import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]   = useState(undefined)
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    let initialSessionHandled = false

    // getSession() is the authoritative first check — handles persisted sessions on reload
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      initialSessionHandled = true
      if (error || !session) {
        setSession(null)
        setLoading(false)
        return
      }
      setSession(session)
      fetchProfile(session.user.id).finally(() => setLoading(false))
    })

    // onAuthStateChange handles subsequent changes (login, logout, token refresh)
    // but we skip INITIAL_SESSION since getSession() already handles it
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Skip the initial session event — getSession handles it above
        if (event === 'INITIAL_SESSION') return

        setSession(session)
        if (session) {
          await fetchProfile(session.user.id)
        } else {
          setProfile(null)
        }
        // Only update loading here if getSession somehow didn't fire
        if (!initialSessionHandled) setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    try {
      // Try with extended fields first; fall back to base fields if columns don't exist yet
      let { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, role, school_id, onboarded, created_at, phone, work_email, personal_email')
        .eq('id', userId)
        .single()

      if (error?.code === '42703' || error?.message?.includes('column')) {
        // Column doesn't exist yet — fall back to base fields
        const fallback = await supabase
          .from('users')
          .select('id, email, full_name, role, school_id, onboarded, created_at')
          .eq('id', userId)
          .single()
        data = fallback.data
        error = fallback.error
      }

      if (!error && data) setProfile(data)
    } catch (_) {
      // profile fetch failed — app still loads, user goes to onboarding
    }
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  async function signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    return { data, error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }

  async function refreshProfile() {
    if (session) await fetchProfile(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
