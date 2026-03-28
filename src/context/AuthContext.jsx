import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]   = useState(undefined)
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    let settled = false

    function settle() {
      if (!settled) {
        settled = true
        setLoading(false)
      }
    }

    // Hard timeout — if auth takes more than 5s, give up and show login
    const timeout = setTimeout(() => {
      supabase.auth.signOut()
      setSession(null)
      setProfile(null)
      settle()
    }, 5000)

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      clearTimeout(timeout)
      if (error || !session) {
        if (error) supabase.auth.signOut()
        setSession(null)
        settle()
        return
      }
      setSession(session)
      fetchProfile(session.user.id).finally(settle)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session) {
          await fetchProfile(session.user.id)
        } else {
          setProfile(null)
        }
        settle()
      }
    )

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  async function fetchProfile(userId) {
    try {
      // Optimized: Only fetch user row, not schools (not needed on auth check)
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, role, school_id, onboarded, created_at')
        .eq('id', userId)
        .single()
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
