import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { CheckIcon } from '@heroicons/react/24/outline'

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name:     '',
    email:         '',
    phone:         '',
    work_email:    '',
    personal_email: '',
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    document.title = 'Profile | Cacio EDU'
  }, [])

  useEffect(() => {
    if (profile) {
      setForm({
        full_name:      profile.full_name     || '',
        email:          profile.email         || '',
        phone:          profile.phone         || '',
        work_email:     profile.work_email    || '',
        personal_email: profile.personal_email || '',
      })
    }
  }, [profile])

  async function handleSave(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSaved(false)

    const { error: dbError } = await supabase
      .from('users')
      .update({
        full_name:      form.full_name.trim()      || null,
        phone:          form.phone.trim()          || null,
        work_email:     form.work_email.trim()     || null,
        personal_email: form.personal_email.trim() || null,
      })
      .eq('id', profile.id)

    setLoading(false)

    if (dbError) {
      setError(dbError.message || 'Failed to save changes')
    } else {
      await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const initials = form.full_name
    ? form.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : (form.email?.[0] || '?').toUpperCase()

  return (
    <div className="space-y-6 pb-8 max-w-md">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your account details</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
          <span className="text-xl font-bold text-indigo-600">{initials}</span>
        </div>
        <div>
          <p className="font-semibold text-gray-900">{form.full_name || 'No name set'}</p>
          <p className="text-sm text-gray-400">{form.email}</p>
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={handleSave} className="card p-5 space-y-5">
        {/* Personal */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Personal</p>
          <div className="space-y-4">
            <div>
              <label className="label">Full name</label>
              <input
                className="input"
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="label">Phone number</label>
              <input
                className="input"
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(555) 000-0000"
              />
            </div>

            <div>
              <label className="label">Personal email</label>
              <input
                className="input"
                type="email"
                value={form.personal_email}
                onChange={e => setForm(f => ({ ...f, personal_email: e.target.value }))}
                placeholder="you@gmail.com"
              />
            </div>
          </div>
        </div>

        {/* Work */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Work</p>
          <div className="space-y-4">
            <div>
              <label className="label">Work email</label>
              <input
                className="input"
                type="email"
                value={form.work_email}
                onChange={e => setForm(f => ({ ...f, work_email: e.target.value }))}
                placeholder="you@school.edu"
              />
            </div>

            <div>
              <label className="label">Login email</label>
              <input
                className="input bg-gray-50 cursor-not-allowed"
                value={form.email}
                disabled
                title="Login email cannot be changed here"
              />
              <p className="text-xs text-gray-400 mt-1">This is the email used to sign in and cannot be changed.</p>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saved ? (
            <>
              <CheckIcon className="w-4 h-4" />
              Saved
            </>
          ) : loading ? 'Saving...' : 'Save changes'}
        </button>
      </form>
    </div>
  )
}
