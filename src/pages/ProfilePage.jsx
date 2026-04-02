import { useEffect, useState, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { CheckIcon, CameraIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'

// Simple US phone formatter: turns digits into (XXX) XXX-XXXX
function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function isValidPhone(val) {
  if (!val) return true // optional
  return /^\(\d{3}\) \d{3}-\d{4}$/.test(val)
}

function isValidEmail(val) {
  if (!val) return true // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
}

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({
    full_name:      '',
    email:          '',
    phone:          '',
    work_email:     '',
    personal_email: '',
  })
  const [touched, setTouched] = useState({})
  const [loading, setLoading]   = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileRef = useRef()

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
    const formatted = formatPhone(e.target.value)
    setForm(f => ({ ...f, phone: formatted }))
  }

  function handleBlur(field) {
    setTouched(t => ({ ...t, [field]: true }))
  }

  // Validation
  const phoneError   = touched.phone         && !isValidPhone(form.phone)   ? 'Enter a valid phone: (555) 000-0000' : null
  const workError    = touched.work_email    && !isValidEmail(form.work_email)    ? 'Enter a valid email address' : null
  const personalError= touched.personal_email && !isValidEmail(form.personal_email) ? 'Enter a valid email address' : null
  const hasErrors    = !isValidPhone(form.phone) || !isValidEmail(form.work_email) || !isValidEmail(form.personal_email)

  async function handleSave(e) {
    e.preventDefault()
    // Mark all as touched to show errors
    setTouched({ phone: true, work_email: true, personal_email: true })
    if (hasErrors) return

    setLoading(true)
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
      toast.error('Failed to save changes')
    } else {
      await refreshProfile()
      toast.success('Profile saved')
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2 MB')
      return
    }

    setAvatarUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `avatars/${profile.id}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = data.publicUrl + `?t=${Date.now()}` // cache-bust

      // Update the public profile table
      const { error: dbError } = await supabase.from('users').update({ avatar_url: url }).eq('id', profile.id)
      if (dbError) {
        console.warn('Could not update users table avatar_url (column might not exist):', dbError)
      }
      
      // Also update auth user metadata as a reliable fallback
      await supabase.auth.updateUser({ data: { avatar_url: url } })

      setAvatarUrl(url)
      await refreshProfile()
      toast.success('Photo updated')
    } catch (err) {
      console.error('Avatar upload failed:', err)
      toast.error('Failed to upload photo: ' + (err.message || 'Unknown error'))
    } finally {
      setAvatarUploading(false)
    }
  }

  const initials = form.full_name
    ? form.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : (form.email?.[0] || '?').toUpperCase()

  return (
    <div className="space-y-6 pb-10 max-w-md">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your account details</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-2xl bg-navy-100 flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-navy-700">{initials}</span>
            )}
          </div>
          {/* Upload overlay */}
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
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate" title={form.full_name || 'No name set'}>
            {form.full_name || 'No name set'}
          </p>
          <p className="text-sm text-gray-400 truncate" title={form.email}>{form.email}</p>
          <p className="text-xs text-gray-300 mt-0.5">Click the camera icon to update your photo</p>
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={handleSave} className="card p-5 space-y-8" noValidate>

        {/* Personal section */}
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
                  className={`input ${phoneError ? 'border-red-300 focus:ring-red-300' : touched.phone && form.phone && isValidPhone(form.phone) ? 'border-navy-300 focus:ring-navy-300' : ''}`}
                  type="tel"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={handlePhoneChange}
                  onBlur={() => handleBlur('phone')}
                  placeholder="(555) 000-0000"
                  autoComplete="tel"
                  aria-describedby={phoneError ? 'phone-error' : undefined}
                  aria-invalid={!!phoneError}
                />
                {touched.phone && form.phone && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidPhone(form.phone)
                      ? <CheckIcon className="w-4 h-4 text-navy-600" aria-hidden="true" />
                      : <ExclamationCircleIcon className="w-4 h-4 text-red-400" aria-hidden="true" />
                    }
                  </span>
                )}
              </div>
              {phoneError && (
                <p id="phone-error" className="text-xs text-red-500 mt-1" role="alert">{phoneError}</p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="personal_email">Personal email</label>
              <div className="relative">
                <input
                  id="personal_email"
                  className={`input ${personalError ? 'border-red-300 focus:ring-red-300' : touched.personal_email && form.personal_email && isValidEmail(form.personal_email) ? 'border-navy-300' : ''}`}
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
                      ? <CheckIcon className="w-4 h-4 text-navy-600" aria-hidden="true" />
                      : <ExclamationCircleIcon className="w-4 h-4 text-red-400" aria-hidden="true" />
                    }
                  </span>
                )}
              </div>
              {personalError && <p className="text-xs text-red-500 mt-1" role="alert">{personalError}</p>}
            </div>
          </div>
        </div>

        {/* Work section */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Work</p>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="work_email">Work email</label>
              <div className="relative">
                <input
                  id="work_email"
                  className={`input ${workError ? 'border-red-300 focus:ring-red-300' : touched.work_email && form.work_email && isValidEmail(form.work_email) ? 'border-navy-300' : ''}`}
                  type="email"
                  value={form.work_email}
                  onChange={e => setForm(f => ({ ...f, work_email: e.target.value }))}
                  onBlur={() => handleBlur('work_email')}
                  placeholder="you@school.edu"
                  autoComplete="work email"
                  aria-invalid={!!workError}
                />
                {touched.work_email && form.work_email && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isValidEmail(form.work_email)
                      ? <CheckIcon className="w-4 h-4 text-navy-600" aria-hidden="true" />
                      : <ExclamationCircleIcon className="w-4 h-4 text-red-400" aria-hidden="true" />
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
                aria-describedby="login-email-hint"
              />
              <p id="login-email-hint" className="text-xs text-gray-400 mt-1.5">
                This is the email used to sign in. It cannot be changed here.
              </p>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
          aria-label="Save profile changes"
        >
          {loading ? 'Saving...' : 'Save changes'}
        </button>
      </form>

      <CalendarSync userId={profile?.id} />
    </div>
  )
}

function CalendarSync({ userId }) {
  const [text, setText] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [holidays, setHolidays] = useState([])

  useEffect(() => {
    if (!userId) return
    supabase.from('school_holidays').select('*').order('date', { ascending: true })
      .then(({ data }) => setHolidays(data || []))
  }, [userId])

  async function handleSync() {
    if (!text.trim()) {
      toast.error('Please paste your calendar text first')
      return
    }
    setSyncing(true)
    try {
      const res = await fetch('/api/ai/parse-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })

      if (!res.ok) throw new Error('Failed to parse calendar')
      const { holidays: newHolidays } = await res.json()

      if (!newHolidays || newHolidays.length === 0) {
        toast.error('No dates found in that text.')
        setSyncing(false)
        return
      }

      // Insert into DB
      const inserts = newHolidays.map(h => ({
        teacher_id: userId,
        name: h.name,
        date: h.date, // format YYYY-MM-DD
      }))

      const { error } = await supabase.from('school_holidays').insert(inserts)
      if (error) throw error

      toast.success(`Synced ${newHolidays.length} days off!`)
      setText('')
      
      // Refresh local list
      const { data } = await supabase.from('school_holidays').select('*').order('date', { ascending: true })
      setHolidays(data || [])
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">School Calendar Setup</h3>
        <p className="text-sm text-gray-500">
          Paste your district's list of holidays, breaks, and off days. The sync assistant will automatically extract the dates so your course planner can bypass them.
        </p>
      </div>

      <textarea
        className="input text-sm resize-none h-24"
        placeholder="e.g. Thanksgiving Break Nov 24-26, Winter Break Dec 20-Jan 3..."
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={syncing}
      />

      <button
        onClick={handleSync}
        disabled={syncing || !text.trim()}
        className="btn-secondary w-full text-sm"
      >
        {syncing ? 'Scanning Dates...' : 'Sync Breaks & Holidays'}
      </button>

      {holidays.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-900 mb-2">Currently Synced Days Off ({holidays.length})</p>
          <div className="max-h-32 overflow-y-auto space-y-1 pr-2">
            {holidays.map(h => (
              <div key={h.id} className="flex justify-between text-xs py-1">
                <span className="text-gray-600">{h.name}</span>
                <span className="text-navy-600 font-medium">{new Date(h.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
