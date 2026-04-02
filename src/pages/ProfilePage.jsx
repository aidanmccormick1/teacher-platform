import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import {
  CheckIcon,
  CameraIcon,
  ExclamationCircleIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function isValidPhone(val) {
  if (!val) return true
  return /^\(\d{3}\) \d{3}-\d{4}$/.test(val)
}

function isValidEmail(val) {
  if (!val) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { profile, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    full_name:      '',
    email:          '',
    phone:          '',
    work_email:     '',
    personal_email: '',
  })
  const [touched, setTouched]           = useState({})
  const [loading, setLoading]           = useState(false)
  const [avatarUrl, setAvatarUrl]       = useState(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileRef = useRef()

  // Delete state
  const [showDeleteModal, setShowDeleteModal]   = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting]                 = useState(false)

  useEffect(() => { document.title = 'Profile | TeacherOS' }, [])

  useEffect(() => {
    if (profile) {
      setForm({
        full_name:      profile.full_name      || '',
        email:          profile.email          || '',
        phone:          formatPhone(profile.phone || ''),
        work_email:     profile.work_email     || '',
        personal_email: profile.personal_email || '',
      })
      setAvatarUrl(profile.avatar_url || null)
    }
  }, [profile])

  function handlePhoneChange(e) {
    setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))
  }

  function handleBlur(field) {
    setTouched(t => ({ ...t, [field]: true }))
  }

  const phoneError    = touched.phone          && !isValidPhone(form.phone)          ? 'Enter a valid phone: (555) 000-0000' : null
  const workError     = touched.work_email     && !isValidEmail(form.work_email)     ? 'Enter a valid email address' : null
  const personalError = touched.personal_email && !isValidEmail(form.personal_email) ? 'Enter a valid email address' : null
  const hasErrors     = !isValidPhone(form.phone) || !isValidEmail(form.work_email) || !isValidEmail(form.personal_email)

  // ── Save profile ────────────────────────────────────────────────────────────

  async function handleSave(e) {
    e.preventDefault()
    setTouched({ phone: true, work_email: true, personal_email: true })
    if (hasErrors) return

    setLoading(true)
    const payload = {
      full_name:      form.full_name.trim()      || null,
      phone:          form.phone.trim()          || null,
      work_email:     form.work_email.trim()     || null,
      personal_email: form.personal_email.trim() || null,
    }

    const { error: dbError } = await supabase
      .from('users')
      .update(payload)
      .eq('id', profile.id)

    if (dbError) {
      console.error('Profile DB save error:', dbError)
      // Fallback — persist to auth metadata
      await supabase.auth.updateUser({ data: payload })
      toast.error(`DB error: ${dbError.message} — saved to account metadata instead`)
    } else {
      toast.success('Profile saved')
    }

    await refreshProfile()
    setLoading(false)
  }

  // ── Avatar upload ───────────────────────────────────────────────────────────

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return }
    if (file.size > 2 * 1024 * 1024)    { toast.error('Image must be under 2 MB');    return }

    setAvatarUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `avatars/${profile.id}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${data.publicUrl}?t=${Date.now()}`

      const { error: dbError } = await supabase.from('users').update({ avatar_url: url }).eq('id', profile.id)
      if (dbError) console.warn('Could not save avatar_url to DB:', dbError.message)

      await supabase.auth.updateUser({ data: { avatar_url: url } })
      setAvatarUrl(url)
      await refreshProfile()
      toast.success('Photo updated')
    } catch (err) {
      toast.error('Failed to upload photo: ' + (err.message || 'Unknown error'))
    } finally {
      setAvatarUploading(false)
    }
  }

  // ── Delete account ──────────────────────────────────────────────────────────

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Deletion failed')

      await signOut()
      navigate('/login')
      toast.success('Account deleted. Sorry to see you go.')
    } catch (err) {
      console.error('Delete account error:', err)
      toast.error(err.message || 'Could not delete account. Please try again.')
      setDeleting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const initials = form.full_name
    ? form.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : (form.email?.[0] || '?').toUpperCase()

  const deleteConfirmEmail = profile?.email || ''
  const deleteReady = deleteConfirmText.trim().toLowerCase() === deleteConfirmEmail.toLowerCase()

  return (
    <div className="space-y-6 pb-10 max-w-md">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your account details</p>
      </div>

      {/* ── Avatar ── */}
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-2xl bg-navy-100 flex items-center justify-center overflow-hidden">
            {avatarUrl
              ? <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
              : <span className="text-xl font-bold text-navy-700">{initials}</span>
            }
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={avatarUploading}
            title="Change profile photo"
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-navy-800 text-white flex items-center justify-center shadow hover:bg-navy-900 transition-colors disabled:opacity-50"
          >
            {avatarUploading
              ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <CameraIcon className="w-3.5 h-3.5" aria-hidden="true" />
            }
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{form.full_name || 'No name set'}</p>
          <p className="text-sm text-gray-400 truncate">{form.email}</p>
          <p className="text-xs text-gray-300 mt-0.5">Tap the camera to update your photo</p>
        </div>
      </div>

      {/* ── Edit form ── */}
      <form onSubmit={handleSave} className="card p-5 space-y-8" noValidate>
        {/* Personal */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Personal</p>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="full_name">Full name</label>
              <input
                id="full_name"
                className="input"
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full name"
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label" htmlFor="phone">Phone number</label>
              <div className="relative">
                <input
                  id="phone"
                  className={`input ${phoneError ? 'border-red-300 focus:ring-red-300' : ''}`}
                  type="tel"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={handlePhoneChange}
                  onBlur={() => handleBlur('phone')}
                  placeholder="(555) 000-0000"
                  autoComplete="tel"
                  aria-invalid={!!phoneError}
                />
                {touched.phone && form.phone && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidPhone(form.phone)
                      ? <CheckIcon className="w-4 h-4 text-navy-600" />
                      : <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                    }
                  </span>
                )}
              </div>
              {phoneError && <p className="text-xs text-red-500 mt-1" role="alert">{phoneError}</p>}
            </div>

            <div>
              <label className="label" htmlFor="personal_email">Personal email</label>
              <div className="relative">
                <input
                  id="personal_email"
                  className={`input ${personalError ? 'border-red-300 focus:ring-red-300' : ''}`}
                  type="email"
                  value={form.personal_email}
                  onChange={e => setForm(f => ({ ...f, personal_email: e.target.value }))}
                  onBlur={() => handleBlur('personal_email')}
                  placeholder="you@gmail.com"
                  autoComplete="email"
                  aria-invalid={!!personalError}
                />
                {touched.personal_email && form.personal_email && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidEmail(form.personal_email)
                      ? <CheckIcon className="w-4 h-4 text-navy-600" />
                      : <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                    }
                  </span>
                )}
              </div>
              {personalError && <p className="text-xs text-red-500 mt-1" role="alert">{personalError}</p>}
            </div>
          </div>
        </div>

        {/* Work */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Work</p>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="work_email">Work email</label>
              <div className="relative">
                <input
                  id="work_email"
                  className={`input ${workError ? 'border-red-300 focus:ring-red-300' : ''}`}
                  type="email"
                  value={form.work_email}
                  onChange={e => setForm(f => ({ ...f, work_email: e.target.value }))}
                  onBlur={() => handleBlur('work_email')}
                  placeholder="you@school.edu"
                  aria-invalid={!!workError}
                />
                {touched.work_email && form.work_email && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidEmail(form.work_email)
                      ? <CheckIcon className="w-4 h-4 text-navy-600" />
                      : <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                    }
                  </span>
                )}
              </div>
              {workError && <p className="text-xs text-red-500 mt-1" role="alert">{workError}</p>}
            </div>

            <div>
              <label className="label" htmlFor="login_email">Login email</label>
              <input
                id="login_email"
                className="input bg-gray-50 cursor-not-allowed text-gray-400"
                value={form.email}
                disabled
                aria-disabled="true"
              />
              <p className="text-xs text-gray-400 mt-1.5">Used to sign in — cannot be changed here.</p>
            </div>
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full" aria-label="Save profile changes">
          {loading ? 'Saving...' : 'Save changes'}
        </button>
      </form>

      {/* ── Danger Zone ── */}
      <div className="card p-5 border border-red-100">
        <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-3">Danger Zone</p>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">Delete account</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Permanently removes your account, all courses, lessons, and schedule data. Cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>

      {/* ── Delete confirmation modal ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-red-50 px-6 pt-6 pb-4 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-3">
                <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Delete your account?</h2>
              <p className="text-sm text-gray-500 mt-1">
                All courses, lessons, schedule, and data will be <strong>permanently deleted</strong>.
                This <strong>cannot be undone</strong>.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="label text-xs">
                  Type <span className="font-semibold text-gray-700">{deleteConfirmEmail}</span> to confirm
                </label>
                <input
                  className="input text-sm"
                  type="email"
                  placeholder={deleteConfirmEmail}
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowDeleteModal(false); setDeleteConfirmText('') }}
                  className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={!deleteReady || deleting}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting…</>
                    : 'Yes, delete everything'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
