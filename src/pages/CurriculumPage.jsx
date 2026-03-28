import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  PlusIcon,
  BookOpenIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  PencilIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

export default function CurriculumPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showNewCourse, setShowNewCourse] = useState(false)

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
      .select(`
        *,
        units ( count ),
        sections ( count )
      `)
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
    setCourses(data || [])
    setLoading(false)
  }

  async function deleteCourse(id) {
    if (!confirm('Delete this course and all its lessons?')) return
    await supabase.from('courses').delete().eq('id', id)
    setCourses(prev => prev.filter(c => c.id !== id))
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

    // Copy units
    const { data: units } = await supabase
      .from('units')
      .select('*')
      .eq('course_id', course.id)

    for (const unit of (units || [])) {
      const { data: newUnit } = await supabase
        .from('units')
        .insert({
          course_id:   newCourse.id,
          title:       unit.title,
          description: unit.description,
          order_index: unit.order_index,
          standards:   unit.standards,
        })
        .select()
        .single()

      if (!newUnit) continue

      const { data: lessons } = await supabase
        .from('lessons')
        .select('*')
        .eq('unit_id', unit.id)

      for (const lesson of (lessons || [])) {
        const { data: newLesson } = await supabase
          .from('lessons')
          .insert({
            unit_id:                    newUnit.id,
            title:                      lesson.title,
            description:                lesson.description,
            order_index:                lesson.order_index,
            estimated_duration_minutes: lesson.estimated_duration_minutes,
          })
          .select()
          .single()

        if (!newLesson) continue

        const { data: segs } = await supabase
          .from('lesson_segments')
          .select('*')
          .eq('lesson_id', lesson.id)

        if (segs?.length) {
          await supabase.from('lesson_segments').insert(
            segs.map(s => ({
              lesson_id:        newLesson.id,
              title:            s.title,
              description:      s.description,
              duration_minutes: s.duration_minutes,
              order_index:      s.order_index,
            }))
          )
        }
      }
    }

    await loadCourses()
    navigate(`/courses/${newCourse.id}`)
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      ) : courses.length === 0 ? (
        <div className="card p-8 text-center">
          <BookOpenIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900 mb-1">No courses yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create your first course to start building your curriculum.
          </p>
          <button className="btn-primary" onClick={() => setShowNewCourse(true)}>
            Create your first course
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {courses.map(course => (
            <div
              key={course.id}
              className="card p-4 flex items-center gap-3 hover:shadow-md transition-all cursor-pointer"
              onClick={() => navigate(`/courses/${course.id}`)}
            >
              <div className="w-10 h-10 rounded-lg bg-navy-100 flex items-center justify-center shrink-0">
                <BookOpenIcon className="w-5 h-5 text-navy-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm truncate">{course.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {course.subject} · Grade {course.grade_level}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  className="btn-ghost p-1.5"
                  onClick={e => { e.stopPropagation(); duplicateCourse(course) }}
                  title="Duplicate course"
                >
                  <DocumentDuplicateIcon className="w-4 h-4" />
                </button>
                <button
                  className="btn-ghost p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={e => { e.stopPropagation(); deleteCourse(course.id) }}
                  title="Delete course"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
                <ChevronRightIcon className="w-4 h-4 text-gray-300" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewCourse && (
        <NewCourseModal
          profile={profile}
          onClose={() => setShowNewCourse(false)}
          onCreated={course => {
            setShowNewCourse(false)
            navigate(`/courses/${course.id}`)
          }}
        />
      )}
    </div>
  )
}

// ─── New Course Modal ─────────────────────────────────────────────

function NewCourseModal({ profile, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', subject: '', grade_level: '' })
  const [loading, setLoading] = useState(false)

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('courses')
      .insert({
        ...form,
        teacher_id: profile.id,
        school_id:  profile.school_id,
      })
      .select()
      .single()
    setLoading(false)
    if (!error) onCreated(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleCreate}
        className="relative bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4"
      >
        <h3 className="font-semibold text-gray-900">New course</h3>

        <div>
          <label className="label">Course name</label>
          <input
            className="input"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="7th Grade History"
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="History"
            />
          </div>
          <div>
            <label className="label">Grade level</label>
            <input
              className="input"
              value={form.grade_level}
              onChange={e => setForm(f => ({ ...f, grade_level: e.target.value }))}
              placeholder="7"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading || !form.name}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
