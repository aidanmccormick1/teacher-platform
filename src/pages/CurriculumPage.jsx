import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import {
  PlusIcon,
  BookOpenIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline'

const SUBJECTS = [
  'Math', 'English / ELA', 'Science', 'History / Social Studies',
  'World Languages', 'Art', 'Music', 'Physical Education',
  'Computer Science', 'Special Education', 'Other',
]

const GRADES = [
  'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  'Mixed', 'College',
]

export default function CurriculumPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showNewCourse, setShowNewCourse] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('recent') // 'recent' | 'alpha' | 'subject'

  useEffect(() => { document.title = 'Curriculum | TeacherOS' }, [])

  useEffect(() => {
    if (profile) {
      setLoadError(false)
      loadCourses()
      const timeout = setTimeout(() => {
        setLoading(prev => {
          if (prev) { setLoadError(true); return false }
          return prev
        })
      }, 10000)
      return () => clearTimeout(timeout)
    }
  }, [profile])

  async function loadCourses() {
    const { data } = await supabase
      .from('courses')
      .select(`*, units ( count ), sections ( count )`)
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
    setCourses(data || [])
    setLoading(false)
  }

  // Filtered + sorted view
  const visibleCourses = useMemo(() => {
    let list = [...courses]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.subject?.toLowerCase().includes(q) ||
        c.grade_level?.toLowerCase().includes(q)
      )
    }
    if (sortBy === 'alpha') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    } else if (sortBy === 'subject') {
      list.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''))
    }
    // 'recent' keeps Supabase default (created_at DESC)
    return list
  }, [courses, search, sortBy])

  async function deleteCourse(id) {
    if (!confirm('Delete this course and all its lessons?')) return
    await supabase.from('courses').delete().eq('id', id)
    setCourses(prev => prev.filter(c => c.id !== id))
    toast.success('Course deleted')
  }

  async function duplicateCourse(course) {
    const { data: newCourse } = await supabase
      .from('courses')
      .insert({
        name:        `${course.name} (copy)`,
        subject:     course.subject,
        grade_level: course.grade_level,
        teacher_id:  profile.id,
        school_id:   profile.school_id,
      })
      .select()
      .single()
    if (!newCourse) return

    const { data: units } = await supabase.from('units').select('*').eq('course_id', course.id)
    for (const unit of (units || [])) {
      const { data: newUnit } = await supabase.from('units').insert({
        course_id: newCourse.id, title: unit.title,
        description: unit.description, order_index: unit.order_index, standards: unit.standards,
      }).select().single()
      if (!newUnit) continue
      const { data: lessons } = await supabase.from('lessons').select('*').eq('unit_id', unit.id)
      for (const lesson of (lessons || [])) {
        const { data: newLesson } = await supabase.from('lessons').insert({
          unit_id: newUnit.id, title: lesson.title, description: lesson.description,
          order_index: lesson.order_index, estimated_duration_minutes: lesson.estimated_duration_minutes,
        }).select().single()
        if (!newLesson) continue
        const { data: segs } = await supabase.from('lesson_segments').select('*').eq('lesson_id', lesson.id)
        if (segs?.length) {
          await supabase.from('lesson_segments').insert(
            segs.map(s => ({ lesson_id: newLesson.id, title: s.title, description: s.description, duration_minutes: s.duration_minutes, order_index: s.order_index }))
          )
        }
      }
    }
    await loadCourses()
    toast.success('Course duplicated')
    navigate(`/courses/${newCourse.id}`)
  }

  // Subject color mapping for visual variety
  const subjectColor = (subject) => {
    const map = {
      'Math': 'bg-blue-50 text-blue-700',
      'English / ELA': 'bg-violet-50 text-violet-700',
      'Science': 'bg-emerald-50 text-emerald-700',
      'History / Social Studies': 'bg-amber-50 text-amber-700',
      'World Languages': 'bg-rose-50 text-rose-700',
      'Art': 'bg-pink-50 text-pink-700',
      'Music': 'bg-orange-50 text-orange-700',
      'Physical Education': 'bg-cyan-50 text-cyan-700',
      'Computer Science': 'bg-navy-50 text-navy-700',
    }
    return map[subject] || 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Curriculum</h1>
        <button className="btn-primary gap-1.5" onClick={() => setShowNewCourse(true)}>
          <PlusIcon className="w-4 h-4" />
          New course
        </button>
      </div>

      {/* Search + sort — only show when there are courses */}
      {!loading && !loadError && courses.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" aria-hidden="true" />
            <input
              className="input pl-9 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search courses..."
              aria-label="Search courses"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {[
              { key: 'recent', label: 'Recent' },
              { key: 'alpha',  label: 'A–Z' },
              { key: 'subject', label: 'Subject' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setSortBy(opt.key)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  sortBy === opt.key
                    ? 'bg-navy-800 text-white border-navy-800'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
                aria-pressed={sortBy === opt.key}
                title={`Sort by ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="card p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Couldn't load courses</h3>
          <p className="text-sm text-gray-400 mb-4">There was a problem connecting. Try refreshing.</p>
          <button
            onClick={() => { setLoadError(false); setLoading(true); loadCourses() }}
            className="btn-primary"
          >
            Try again
          </button>
        </div>
      ) : courses.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <BookOpenIcon className="w-7 h-7 text-gray-300" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">No courses yet</h3>
          <p className="text-sm text-gray-400 mb-5">
            Add your first course to start organizing your curriculum.
          </p>
          <button className="btn-primary" onClick={() => setShowNewCourse(true)}>
            Create your first course
          </button>
        </div>
      ) : (
        <>
          {visibleCourses.length === 0 && search.trim() && (
            <div className="card p-6 text-center">
              <MagnifyingGlassIcon className="w-6 h-6 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No courses match &ldquo;{search}&rdquo;</p>
              <button onClick={() => setSearch('')} className="text-xs text-navy-700 hover:underline mt-1">Clear search</button>
            </div>
          )}
          <div className="space-y-2">
          {visibleCourses.map(course => {
            const unitCount = course.units?.[0]?.count ?? 0
            return (
              <div
                key={course.id}
                className="card p-4 flex items-center gap-3 hover:shadow-md transition-all cursor-pointer group"
                onClick={() => navigate(`/courses/${course.id}`)}
              >
                <div className="w-10 h-10 rounded-xl bg-navy-50 flex items-center justify-center shrink-0">
                  <BookOpenIcon className="w-5 h-5 text-navy-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{course.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {course.subject && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${subjectColor(course.subject)}`}>
                        {course.subject}
                      </span>
                    )}
                    {course.grade_level && (
                      <span className="text-xs text-gray-400">Grade {course.grade_level}</span>
                    )}
                    {unitCount > 0 && (
                      <span className="text-xs text-gray-300">{unitCount} unit{unitCount !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="btn-ghost p-1.5"
                    onClick={e => { e.stopPropagation(); duplicateCourse(course) }}
                    title="Duplicate course"
                    aria-label={`Duplicate ${course.name}`}
                  >
                    <DocumentDuplicateIcon className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    className="btn-ghost p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={e => { e.stopPropagation(); deleteCourse(course.id) }}
                    title="Delete course"
                    aria-label={`Delete ${course.name}`}
                  >
                    <TrashIcon className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <ChevronRightIcon className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            )
          })}
          </div>
        </>
      )}

      {showNewCourse && (
        <NewCourseModal
          profile={profile}
          onClose={() => setShowNewCourse(false)}
          onCreated={course => {
            setShowNewCourse(false)
            navigate(`/courses/${course.id}`, {
              state: { start_date: course.start_date, end_date: course.end_date }
            })
          }}
        />
      )}
    </div>
  )
}

// ─── New Course Modal — 2-step walkthrough ─────────────────────────

function NewCourseModal({ profile, onClose, onCreated }) {
  const [step, setStep] = useState(1) // 1: nickname, 2: subject + grade, 3: dates
  const [form, setForm] = useState({ name: '', subject: '', grade_level: '', start_date: '', end_date: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    setLoading(true)
    setError(null)
    // Only insert columns that exist in the DB schema.
    // start_date / end_date are passed via nav state until the migration adds them.
    const { data, error: err } = await supabase
      .from('courses')
      .insert({
        name:        form.name,
        subject:     form.subject,
        grade_level: form.grade_level,
        teacher_id:  profile.id,
        school_id:   profile.school_id,
      })
      .select()
      .single()
    setLoading(false)
    if (err) {
      setError(err.message || 'Something went wrong')
    } else {
      // Attach the date fields in memory so the planner can pre-fill them
      onCreated({ ...data, start_date: form.start_date || null, end_date: form.end_date || null })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-1 bg-navy-500 transition-all duration-300"
            style={{ width: step === 1 ? '33%' : step === 2 ? '66%' : '100%' }}
          />
        </div>

        <div className="p-6">
          {step === 1 ? (
            <>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Step 1 of 3</p>
              <h3 className="font-bold text-gray-900 text-lg mb-1">What's this course called?</h3>
              <p className="text-sm text-gray-400 mb-5">
                Use a short name you recognize — like "AP Gov" or "7th Math B".
              </p>
              <input
                className="input w-full text-base"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. AP US History, 6th Science Period 2"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) setStep(2) }}
              />
              <div className="flex gap-3 mt-5">
                <button type="button" className="btn-secondary flex-1" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={!form.name.trim()}
                  onClick={() => setStep(2)}
                >
                  Next
                </button>
              </div>
            </>
          ) : step === 2 ? (
            <>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Step 2 of 3</p>
              <h3 className="font-bold text-gray-900 text-lg mb-1">Subject and grade</h3>
              <p className="text-sm text-gray-400 mb-4">
                Helps organize your curriculum. You can change this later.
              </p>

              <div className="mb-4">
                <label className="label text-xs mb-2 block">Subject</label>
                <div className="flex flex-wrap gap-1.5">
                  {SUBJECTS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, subject: s }))}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        form.subject === s
                          ? 'bg-navy-800 text-white border-navy-800'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <label className="label text-xs mb-2 block">Grade level</label>
                <div className="flex flex-wrap gap-1.5">
                  {GRADES.map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, grade_level: g }))}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        form.grade_level === g
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
                <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary flex-1"
                  onClick={() => setStep(3)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Step 3 of 3</p>
              <h3 className="font-bold text-gray-900 text-lg mb-1">When does it run?</h3>
              <p className="text-sm text-gray-400 mb-4">
                Set the first and last day of this course so your lesson planner knows exactly how many days you have.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="label text-xs">First day</label>
                  <input
                    type="date"
                    className="input text-sm"
                    value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label text-xs">Last day</label>
                  <input
                    type="date"
                    className="input text-sm"
                    value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>

              {/* Live day counter */}
              {form.start_date && form.end_date && (() => {
                const s = new Date(form.start_date + 'T12:00:00')
                const e = new Date(form.end_date   + 'T12:00:00')
                if (s >= e) return null
                let days = 0, cur = new Date(s)
                while (cur <= e) { if (cur.getDay() !== 0 && cur.getDay() !== 6) days++; cur.setDate(cur.getDate() + 1) }
                return (
                  <div className="bg-navy-50 border border-navy-100 rounded-xl p-3 flex items-center justify-between mb-4">
                    <p className="text-xs text-navy-700 font-medium">Approx. instructional days</p>
                    <p className="text-xl font-bold text-navy-700">{days}</p>
                  </div>
                )
              })()}

              {error && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>
              )}

              <div className="flex gap-3">
                <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={loading}
                  onClick={handleCreate}
                >
                  {loading ? 'Creating...' : 'Create course'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
