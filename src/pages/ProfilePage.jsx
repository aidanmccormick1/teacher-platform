import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { UserCircleIcon, CheckIcon } from '@heroicons/react/24/outline'

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({ full_name: '', email: '' })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    document.title = 'Profile | TeacherOS'
  }, [])

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || '',
        email: profile.email || '',
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
      .update({ full_name: form.full_name.trim() || null })
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

  // Derive initials for avatar
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
      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm">Edit details</h2>

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
          <label className="label">Email</label>
          <input
            className="input bg-gray-50 cursor-not-allowed"
            value={form.email}
            disabled
            title="Email cannot be changed here"
          />
          <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
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
