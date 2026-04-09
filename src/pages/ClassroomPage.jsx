import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  PlayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  BookOpenIcon,
  AcademicCapIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function todayName() {
  return DAY_NAMES[new Date().getDay()]
}

function nowMinutes() {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}

function timeToMinutes(str) {
  // Accepts "HH:MM" or "H:MM"
  if (!str) return null
  const [h, m] = str.split(':').map(Number)
  return h * 60 + (m || 0)
}

function fmtTime(str) {
  if (!str) return ''
  const [h, m] = str.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 || 12
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`
}

function detectActiveSectionId(sections) {
  const today = todayName()
  const now = nowMinutes()
  const todaySections = sections.filter(s =>
    s.meeting_days?.includes(today)
  )
  if (!todaySections.length) return null

  // Find one whose start time is closest to now (or currently in session)
  let best = null
  let bestDiff = Infinity

  for (const s of todaySections) {
    const start = timeToMinutes(s.meeting_time)
    if (start === null) continue

    // Within 15 min before or up to 90 min after start = active window
    if (now >= (start - 15) && now <= (start + 90)) {
      return s.id
    }

    // Upcoming today
    if (start > now) {
      const diff = start - now
      if (diff < bestDiff) { bestDiff = diff; best = s }
    }
  }
  return best?.id || todaySections[0]?.id || null
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClassroomPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [sections, setSections] = useState([])
  const [loading, setLoading]   = useState(true)
  // Per-section: next pending lesson query results
  const [nextLessons, setNextLessons] = useState({}) // { sectionId: lesson }

  // Which section is selected for the tracker
  const [selectedId, setSelectedId]   = useState(null)
  const [overriding, setOverriding]   = useState(false) // show section picker
  const [confirmed, setConfirmed]     = useState(false) // after user confirms section

  useEffect(() => {
    document.title = 'Classroom | TeacherOS'
    if (profile?.id) load()
  }, [profile?.id])

  async function load() {
    setLoading(true)
    try {
      // Sections don't have teacher_id; filter via courses
      const { data: teacherCourses } = await supabase
        .from('courses')
        .select('id')
        .eq('teacher_id', profile.id)

      const courseIds = teacherCourses?.map(c => c.id) || []

      if (!courseIds.length) {
        setSections([])
        setLoading(false)
        return
      }

      const { data: secs } = await supabase
        .from('sections')
        .select('*, courses(id, name, subject, grade_level)')
        .in('course_id', courseIds)
        .order('meeting_time', { ascending: true })

      if (!secs) { setLoading(false); return }
      setSections(secs)

      // Auto-detect active class
      const detected = detectActiveSectionId(secs)
      setSelectedId(detected)

      // Fetch next upcoming lesson for each section
      await loadNextLessons(secs)
    } catch (err) {
      console.error('ClassroomPage load error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadNextLessons(secs) {
    const results = {}
    await Promise.all(secs.map(async (sec) => {
      // Get course units + lessons in order, find one without completed progress
      const { data: units } = await supabase
        .from('units')
        .select('id, title, order_index')
        .eq('course_id', sec.courses?.id)
        .order('order_index')

      if (!units?.length) return

      for (const unit of units) {
        const { data: lessons } = await supabase
          .from('lessons')
          .select('id, title, order_index')
          .eq('unit_id', unit.id)
          .order('order_index')

        if (!lessons?.length) continue

        for (const lesson of lessons) {
          const { data: prog } = await supabase
            .from('lesson_progress')
            .select('id, status')
            .eq('lesson_id', lesson.id)
            .eq('section_id', sec.id)
            .eq('status', 'completed')
            .limit(1)

          if (!prog?.length) {
            results[sec.id] = { ...lesson, unitTitle: unit.title }
            return
          }
        }
      }
    }))
    setNextLessons(results)
  }

  const selectedSection = useMemo(
    () => sections.find(s => s.id === selectedId),
    [sections, selectedId]
  )

  const nextLesson = selectedId ? nextLessons[selectedId] : null

  function handleConfirm() {
    setOverriding(false)
    setConfirmed(true)
  }

  function handleLaunch() {
    if (!selectedId || !nextLesson) return
    navigate(`/sections/${selectedId}/lessons/${nextLesson.id}`)
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-navy-800 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Finding your active class…</p>
      </div>
    )
  }

  if (!sections.length) {
    return (
      <div className="space-y-2 pb-12">
        <h1 className="page-title">Classroom</h1>
        <div className="card p-8 text-center space-y-3">
          <AcademicCapIcon className="w-10 h-10 text-gray-200 mx-auto" />
          <p className="text-sm text-gray-500">No class periods set up yet.</p>
          <button onClick={() => navigate('/schedule')} className="btn-primary text-sm">
            Set up your schedule →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-16">
      {/* Header */}
      <div>
        <h1 className="page-title">Classroom</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── Active class card ── */}
      {!confirmed ? (
        <div className="card overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-navy-600 mb-1">
              {selectedId ? 'Active class detected' : 'No class right now'}
            </p>
            <h2 className="text-lg font-bold text-gray-900">
              {selectedSection
                ? selectedSection.courses?.name || selectedSection.name
                : 'Pick your class period'}
            </h2>
            {selectedSection && (
              <p className="text-sm text-gray-400 mt-0.5">
                {selectedSection.name}
                {selectedSection.meeting_time && ` · ${fmtTime(selectedSection.meeting_time)}`}
              </p>
            )}
          </div>

          <div className="px-5 py-4 space-y-3">
            {/* Confirm or override selector */}
            {!overriding ? (
              <div className="space-y-2">
                {selectedSection && (
                  <button
                    onClick={handleConfirm}
                    className="btn-primary w-full text-sm py-3 flex items-center justify-center gap-2"
                  >
                    <PlayIcon className="w-4 h-4" />
                    Yes, open {selectedSection.name}
                  </button>
                )}
                <button
                  onClick={() => setOverriding(true)}
                  className="btn-secondary w-full text-sm flex items-center justify-center gap-1.5"
                >
                  <ChevronDownIcon className="w-3.5 h-3.5" />
                  {selectedSection ? "No, it's a different class" : 'Pick a class period'}
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 mb-2">Select your class period:</p>
                {sections.map(sec => (
                  <button
                    key={sec.id}
                    onClick={() => { setSelectedId(sec.id); setOverriding(false); setConfirmed(true) }}
                    className={clsx(
                      'w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all',
                      sec.id === selectedId
                        ? 'border-navy-400 bg-navy-50 text-navy-800'
                        : 'border-gray-100 bg-gray-50 hover:border-gray-200 text-gray-700'
                    )}
                  >
                    <div>
                      <p className="text-sm font-semibold">{sec.courses?.name || '—'}</p>
                      <p className="text-xs text-gray-400">
                        {sec.name}
                        {sec.meeting_time && ` · ${fmtTime(sec.meeting_time)}`}
                      </p>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-gray-300 shrink-0" />
                  </button>
                ))}
                <button
                  onClick={() => setOverriding(false)}
                  className="text-xs text-gray-400 hover:text-gray-600 w-full text-center pt-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Confirmed: show the launcher ── */
        <div className="space-y-4">
          {/* Confirmed section header */}
          <div className="card px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy-600 mb-0.5">Now teaching</p>
              <p className="text-base font-bold text-gray-900">
                {selectedSection?.courses?.name || selectedSection?.name}
              </p>
              <p className="text-xs text-gray-400">
                {selectedSection?.name}
                {selectedSection?.meeting_time && ` · ${fmtTime(selectedSection.meeting_time)}`}
              </p>
            </div>
            <button
              onClick={() => { setConfirmed(false); setOverriding(true) }}
              className="btn-ghost p-2 text-gray-400 hover:text-navy-700"
              title="Switch class"
            >
              <ArrowPathIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Next lesson */}
          {nextLesson ? (
            <div className="card overflow-hidden">
              <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Up next</p>
                <p className="text-xs text-gray-400 mb-0.5">{nextLesson.unitTitle}</p>
                <h2 className="text-base font-bold text-gray-900">{nextLesson.title}</h2>
              </div>

              <div className="px-5 py-4">
                <button
                  onClick={handleLaunch}
                  className="btn-primary w-full py-3.5 text-base flex items-center justify-center gap-2"
                >
                  <PlayIcon className="w-5 h-5" />
                  Start lesson tracker
                </button>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center space-y-3">
              <BookOpenIcon className="w-10 h-10 text-gray-200 mx-auto" />
              <p className="text-sm font-semibold text-gray-700">All caught up!</p>
              <p className="text-sm text-gray-400">No pending lessons found for this period.</p>
              <button onClick={() => navigate('/curriculum')} className="btn-secondary text-sm">
                Go to Curriculum →
              </button>
            </div>
          )}

          {/* Other sections today */}
          {(() => {
            const today = todayName()
            const others = sections.filter(s => s.id !== selectedId && s.meeting_days?.includes(today))
            if (!others.length) return null
            return (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Also today
                </p>
                <div className="space-y-2">
                  {others.map(sec => {
                    const lsn = nextLessons[sec.id]
                    return (
                      <button
                        key={sec.id}
                        onClick={() => { setSelectedId(sec.id); setConfirmed(true) }}
                        className="card w-full px-4 py-3 flex items-center justify-between hover:border-navy-200 transition-all text-left"
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{sec.courses?.name || sec.name}</p>
                          <p className="text-xs text-gray-400">
                            {sec.name}
                            {sec.meeting_time && ` · ${fmtTime(sec.meeting_time)}`}
                            {lsn && ` · ${lsn.title}`}
                          </p>
                        </div>
                        <ChevronRightIcon className="w-4 h-4 text-gray-300 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Quick access — all sections */}
      {confirmed && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">All periods</p>
          <div className="space-y-2">
            {sections.map(sec => {
              const today = todayName()
              const isToday = sec.meeting_days?.includes(today)
              const lsn = nextLessons[sec.id]
              return (
                <button
                  key={sec.id}
                  onClick={() => { setSelectedId(sec.id); setConfirmed(true) }}
                  className={clsx(
                    'card w-full px-4 py-3 flex items-center justify-between text-left transition-all',
                    sec.id === selectedId
                      ? 'border-navy-300 bg-navy-50'
                      : 'hover:border-gray-200'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={clsx(
                      'w-2 h-2 rounded-full shrink-0',
                      isToday ? 'bg-emerald-400' : 'bg-gray-200'
                    )} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{sec.courses?.name || sec.name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {sec.name}
                        {sec.meeting_time && ` · ${fmtTime(sec.meeting_time)}`}
                        {lsn ? ` · Next: ${lsn.title}` : ' · All done'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {sec.id === selectedId && (
                      <span className="text-[10px] font-bold text-navy-700 bg-navy-100 px-2 py-0.5 rounded-full">Active</span>
                    )}
                    <ChevronRightIcon className="w-4 h-4 text-gray-300" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
