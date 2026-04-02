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
      let { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()

      // Get fresh auth session to merge any metadata-stored fields
      const { data: { session: freshSession } } = await supabase.auth.getSession()
      const meta = freshSession?.user?.user_metadata || {}

      if (!error && data) {
        // Merge metadata as fallback for fields that may not be in the DB yet
        data = {
          ...data,
          full_name:      data.full_name      || meta.full_name      || null,
          phone:          data.phone          || meta.phone          || null,
          work_email:     data.work_email     || meta.work_email     || null,
          personal_email: data.personal_email || meta.personal_email || null,
          avatar_url:     data.avatar_url     || meta.avatar_url     || null,
        }
        setProfile(data)
      } else if (meta.full_name || meta.email) {
        // users table row missing entirely — build a profile from auth metadata
        setProfile({
          id: userId,
          email: freshSession?.user?.email || '',
          ...meta,
        })
      }
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
    // Re-fetch fresh session so we get the latest user.id reliably
    const { data: { session: fresh } } = await supabase.auth.getSession()
    if (fresh?.user?.id) await fetchProfile(fresh.user.id)
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
