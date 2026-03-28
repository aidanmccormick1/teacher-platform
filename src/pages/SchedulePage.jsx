import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  PlusIcon,
  TrashIcon,
  CalendarDaysIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { format, parseISO } from 'date-fns'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const BLOCK_DAYS = ['A-Day', 'B-Day']
const ALL_DAY_OPTIONS = [...WEEKDAYS, ...BLOCK_DAYS]

export default function SchedulePage() {
  const { profile } = useAuth()
  const [courses,   setCourses]   = useState([])
  const [sections,  setSections]  = useState([])
  const [overrides, setOverrides] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showNewSection, setShowNewSection] = useState(false)
  const [newSectionCourseId, setNewSectionCourseId] = useState(null)
  const [showOverride, setShowOverride] = useState(null) // sectionId

  useEffect(() => {
    if (profile) loadAll()
  }, [profile])

  async function loadAll() {
    const { data: courseData } = await supabase
      .from('courses')
      .select('id, name, subject, grade_level')
      .eq('teacher_id', profile.id)
      .order('name')

    const courseIds = (courseData || []).map(c => c.id)
    setCourses(courseData || [])

    if (courseIds.length === 0) {
      setSections([])
      setLoading(false)
      return
    }

    const { data: sectionData } = await supabase
      .from('sections')
      .select('*')
      .in('course_id', courseIds)
      .order('meeting_time', { ascending: true })

    const { data: overrideData } = await supabase
      .from('schedule_overrides')
      .select('*')
      .in('section_id', (sectionData || []).map(s => s.id))
      .gte('override_date', format(new Date(), 'yyyy-MM-dd'))
      .order('override_date', { ascending: true })

    setSections(sectionData || [])
    setOverrides(overrideData || [])
    setLoading(false)
  }

  async function deleteSection(id) {
    if (!confirm('Delete this section?')) return
    await supabase.from('sections').delete().eq('id', id)
    setSections(prev => prev.filter(s => s.id !== id))
  }

  async function addOverride(sectionId, date, reason, cancelled) {
    const { data } = await supabase
      .from('schedule_overrides')
      .upsert({
        section_id:    sectionId,
        override_date: date,
        reason,
        cancelled,
      }, { onConflict: 'section_id,override_date' })
      .select()
      .single()
    setOverrides(prev => {
      const filtered = prev.filter(o => !(o.section_id === sectionId && o.override_date === date))
      return [...filtered, data]
    })
    setShowOverride(null)
  }

  async function deleteOverride(id) {
    await supabase.from('schedule_overrides').delete().eq('id', id)
    setOverrides(prev => prev.filter(o => o.id !== id))
  }

  // Group sections by course
  const grouped = courses.map(course => ({
    course,
    sections: sections.filter(s => s.course_id === course.id),
  })).filter(g => g.sections.length > 0 || true)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Schedule</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarDaysIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900 mb-1">No courses yet</h3>
          <p className="text-sm text-gray-500">
            Create a course in Curriculum first, then set up your class sections here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ course, sections: courseSections }) => (
            <div key={course.id} className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm text-gray-900">{course.name}</p>
                  <p className="text-xs text-gray-400">{course.subject} · Grade {course.grade_level}</p>
                </div>
                <button
                  className="btn-primary gap-1.5 text-xs"
                  onClick={() => { setNewSectionCourseId(course.id); setShowNewSection(true) }}
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Add section
                </button>
              </div>

              {courseSections.length === 0 ? (
                <div className="px-4 py-4 text-sm text-gray-400">
                  No sections yet. Add one above.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {courseSections.map(section => {
                    const sectionOverrides = overrides.filter(o => o.section_id === section.id)
                    return (
                      <SectionRow
                        key={section.id}
                        section={section}
                        overrides={sectionOverrides}
                        onDelete={() => deleteSection(section.id)}
                        onAddOverride={() => setShowOverride(section.id)}
                        onDeleteOverride={deleteOverride}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New section modal */}
      {showNewSection && (
        <NewSectionModal
          courseId={newSectionCourseId}
          onClose={() => setShowNewSection(false)}
          onCreated={async (section) => {
            setSections(prev => [...prev, section])
            setShowNewSection(false)
          }}
        />
      )}

      {/* Override modal */}
      {showOverride && (
        <OverrideModal
          sectionId={showOverride}
          onClose={() => setShowOverride(null)}
          onSave={addOverride}
        />
      )}
    </div>
  )
}

// ─── Section Row ───────────────────────────────────────────────────

function SectionRow({ section, overrides, onDelete, onAddOverride, onDeleteOverride }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{section.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-400">
              {section.meeting_days?.join(', ') || 'No days set'}
            </span>
            {section.meeting_time && (
              <span className="text-xs text-gray-400">
                · {formatTime(section.meeting_time)}
              </span>
            )}
            {section.room && (
              <span className="text-xs text-gray-400">· Room {section.room}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {overrides.length > 0 && (
            <span className="badge-amber text-xs">
              {overrides.length} override{overrides.length > 1 ? 's' : ''}
            </span>
          )}
          <button
            className="btn-ghost p-1.5 text-xs gap-1"
            onClick={onAddOverride}
            title="Add schedule override"
          >
            <CalendarDaysIcon className="w-4 h-4" />
          </button>
          <button
            className="btn-ghost p-1.5 text-red-400 hover:bg-red-50"
            onClick={onDelete}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {overrides.length > 0 && (
        <div className="px-4 pb-3 space-y-1.5">
          {overrides.map(o => (
            <div key={o.id} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
              <CalendarDaysIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">
                {format(parseISO(o.override_date), 'MMM d')}
                {o.cancelled ? ' — Cancelled' : o.new_time ? ` — Moved to ${formatTime(o.new_time)}` : ''}
                {o.reason && ` (${o.reason})`}
              </span>
              <button
                onClick={() => onDeleteOverride(o.id)}
                className="text-amber-400 hover:text-amber-700"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── New Section Modal ─────────────────────────────────────────────

function NewSectionModal({ courseId, onClose, onCreated }) {
  const [form, setForm] = useState({
    name:         '',
    meeting_days: [],
    meeting_time: '',
    room:         '',
  })
  const [loading, setLoading] = useState(false)

  function toggleDay(day) {
    setForm(f => ({
      ...f,
      meeting_days: f.meeting_days.includes(day)
        ? f.meeting_days.filter(d => d !== day)
        : [...f.meeting_days, day],
    }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('sections')
      .insert({
        ...form,
        course_id:    courseId,
        meeting_time: form.meeting_time || null,
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
        <h3 className="font-semibold text-gray-900">Add section</h3>

        <div>
          <label className="label">Section name</label>
          <input
            className="input"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Period 2, 6A, Block B..."
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label">Meeting days</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_DAY_OPTIONS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  form.meeting_days.includes(day)
                    ? 'bg-navy-800 text-white border-navy-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Meeting time</label>
            <input
              type="time"
              className="input"
              value={form.meeting_time}
              onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Room</label>
            <input
              className="input"
              value={form.room}
              onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
              placeholder="101"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading || !form.name}>
            {loading ? 'Adding...' : 'Add section'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Override Modal ────────────────────────────────────────────────

function OverrideModal({ sectionId, onClose, onSave }) {
  const [form, setForm] = useState({
    date:      '',
    reason:    '',
    cancelled: true,
    new_time:  '',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
        <h3 className="font-semibold text-gray-900">Schedule override</h3>

        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            required
          />
        </div>

        <div>
          <label className="label">Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, cancelled: true }))}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-all ${
                form.cancelled
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              Class cancelled
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, cancelled: false }))}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-all ${
                !form.cancelled
                  ? 'bg-navy-800 text-white border-navy-800'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              Different time
            </button>
          </div>
        </div>

        {!form.cancelled && (
          <div>
            <label className="label">New time</label>
            <input
              type="time"
              className="input"
              value={form.new_time}
              onChange={e => setForm(f => ({ ...f, new_time: e.target.value }))}
            />
          </div>
        )}

        <div>
          <label className="label">Reason (optional)</label>
          <input
            className="input"
            value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            placeholder="Assembly day, Testing schedule..."
          />
        </div>

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary flex-1"
            disabled={!form.date}
            onClick={() => onSave(sectionId, form.date, form.reason, form.cancelled)}
          >
            Save override
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}
