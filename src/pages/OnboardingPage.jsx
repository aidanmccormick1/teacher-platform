import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

const ROLES = [
  { value: 'teacher',         label: 'Teacher' },
  { value: 'department_head', label: 'Department Head' },
  { value: 'admin',           label: 'School Administrator' },
]

const SUBJECTS = [
  'English / ELA', 'Math', 'Science', 'History / Social Studies',
  'Spanish', 'French', 'Art', 'Music', 'PE', 'Computer Science', 'Other',
]

const GRADES = [
  'K', '1', '2', '3', '4', '5',
  '6', '7', '8', '9', '10', '11', '12',
]

export default function OnboardingPage() {
  const { session, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({
    full_name:    '',
    role:         'teacher',
    subjects:     [],
    grades:       [],
    school_name:  '',
    district:     '',
    state:        '',
  })

  function update(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function toggleItem(key, value) {
    setForm(f => ({
      ...f,
      [key]: f[key].includes(value)
        ? f[key].filter(v => v !== value)
        : [...f[key], value],
    }))
  }

  async function handleFinish() {
    setLoading(true)
    setError(null)

    try {
      // 1. Find or create school
      let schoolId = null
      const { data: existingSchools } = await supabase
        .from('schools')
        .select('id')
        .ilike('name', form.school_name)
        .limit(1)

      if (existingSchools?.length > 0) {
        schoolId = existingSchools[0].id
      } else {
        const { data: newSchool, error: schoolError } = await supabase
          .from('schools')
          .insert({ name: form.school_name, district: form.district, state: form.state })
          .select('id')
          .single()
        if (schoolError) throw schoolError
        schoolId = newSchool.id
      }

      // 2. Update user profile
      const { error: profileError } = await supabase
        .from('users')
        .update({
          full_name: form.full_name,
          role:      form.role,
          school_id: schoolId,
          onboarded: true,
        })
        .eq('id', session.user.id)

      if (profileError) throw profileError

      await refreshProfile()
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map(n => (
            <div
              key={n}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                n <= step ? 'bg-navy-800' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="card p-6">
          {/* Step 1: Name + Role */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="page-title mb-1">Welcome to TeacherOS</h2>
                <p className="text-sm text-gray-500">Let's get your account set up. Takes about 2 minutes.</p>
              </div>

              <div>
                <label className="label">Your full name</label>
                <input
                  type="text"
                  className="input"
                  value={form.full_name}
                  onChange={e => update('full_name', e.target.value)}
                  placeholder="Ms. Johnson"
                />
              </div>

              <div>
                <label className="label">Your role</label>
                <div className="space-y-2">
                  {ROLES.map(r => (
                    <label key={r.value} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                      <input
                        type="radio"
                        name="role"
                        value={r.value}
                        checked={form.role === r.value}
                        onChange={() => update('role', r.value)}
                        className="text-navy-800"
                      />
                      <span className="text-sm font-medium text-gray-700">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                className="btn-primary w-full py-2.5"
                disabled={!form.full_name}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </div>
          )}

          {/* Step 2: Subjects + Grades */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="page-title mb-1">What do you teach?</h2>
                <p className="text-sm text-gray-500">Pick all that apply.</p>
              </div>

              <div>
                <label className="label">Subjects</label>
                <div className="flex flex-wrap gap-2">
                  {SUBJECTS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleItem('subjects', s)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                        form.subjects.includes(s)
                          ? 'bg-navy-800 text-white border-navy-800'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Grade levels</label>
                <div className="flex flex-wrap gap-2">
                  {GRADES.map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleItem('grades', g)}
                      className={`w-10 h-10 rounded-lg text-sm font-medium border transition-all ${
                        form.grades.includes(g)
                          ? 'bg-navy-800 text-white border-navy-800'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => setStep(1)}>Back</button>
                <button
                  className="btn-primary flex-1"
                  onClick={() => setStep(3)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: School info */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="page-title mb-1">Your school</h2>
                <p className="text-sm text-gray-500">We'll look for an existing school or create a new one.</p>
              </div>

              <div>
                <label className="label">School name</label>
                <input
                  type="text"
                  className="input"
                  value={form.school_name}
                  onChange={e => update('school_name', e.target.value)}
                  placeholder="Lincoln Middle School"
                />
              </div>

              <div>
                <label className="label">District (optional)</label>
                <input
                  type="text"
                  className="input"
                  value={form.district}
                  onChange={e => update('district', e.target.value)}
                  placeholder="Palo Alto Unified"
                />
              </div>

              <div>
                <label className="label">State</label>
                <input
                  type="text"
                  className="input"
                  value={form.state}
                  onChange={e => update('state', e.target.value)}
                  placeholder="CA"
                  maxLength={2}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => setStep(2)}>Back</button>
                <button
                  className="btn-primary flex-1"
                  disabled={!form.school_name || loading}
                  onClick={handleFinish}
                >
                  {loading ? 'Saving...' : 'Get started'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
