import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  doesSectionMeetToday,
  isClassNow,
  formatTime,
} from '@/lib/dateUtils'
import {
  ClockIcon,
  ChevronRightIcon,
  SparklesIcon,
  CalendarDaysIcon,
  BookOpenIcon,
  MapPinIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  AcademicCapIcon,
  ArrowPathIcon,
  SunIcon,
  MoonIcon,
  PencilSquareIcon,
  ListBulletIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckSolid } from '@heroicons/react/24/solid'
import { format } from 'date-fns'
import DailyDigest from '@/components/DailyDigest'
import ClassNotesDrawer from '@/components/ClassNotesDrawer'

const PERIOD_COLORS = [
  { bg: 'bg-blue-500',    light: 'bg-blue-50',    border: 'border-blue-200',   text: 'text-blue-700',   dot: 'bg-blue-400',   ring: 'ring-blue-200',   pill: 'bg-blue-100 text-blue-700' },
  { bg: 'bg-violet-500',  light: 'bg-violet-50',  border: 'border-violet-200', text: 'text-violet-700', dot: 'bg-violet-400', ring: 'ring-violet-200', pill: 'bg-violet-100 text-violet-700' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-700',dot: 'bg-emerald-400',ring: 'ring-emerald-200',pill: 'bg-emerald-100 text-emerald-700' },
  { bg: 'bg-amber-500',   light: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700',  dot: 'bg-amber-400',  ring: 'ring-amber-200',  pill: 'bg-amber-100 text-amber-700' },
  { bg: 'bg-rose-500',    light: 'bg-rose-50',    border: 'border-rose-200',   text: 'text-rose-700',   dot: 'bg-rose-400',   ring: 'ring-rose-200',   pill: 'bg-rose-100 text-rose-700' },
  { bg: 'bg-cyan-500',    light: 'bg-cyan-50',    border: 'border-cyan-200',   text: 'text-cyan-700',   dot: 'bg-cyan-400',   ring: 'ring-cyan-200',   pill: 'bg-cyan-100 text-cyan-700' },
  { bg: 'bg-orange-500',  light: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-400', ring: 'ring-orange-200', pill: 'bg-orange-100 text-orange-700' },
]

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const SHORT_DAYS = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' }

function colorFor(i) {
  return PERIOD_COLORS[i % PERIOD_COLORS.length]
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [sections, setSections]       = useState([])
  const [allSections, setAllSections] = useState([])
  const [courses, setCourses]         = useState([])
  const [lessonsBySectionId, setLessonsBySectionId] = useState({})
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(false)
  const [now, setNow]                 = useState(new Date())
  // Notes drawer state
  const [notesSection, setNotesSection] = useState(null)

  useEffect(() => { document.title = 'Dashboard | Cacio EDU' }, [])

  // Keep "now" ticking so badges stay accurate
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (profile) {
      setLoadError(false)
      loadData()
      const timeout = setTimeout(() => {
        setLoading(prev => {
          if (prev) { setLoadError(true); return false }
          return prev
        })
      }, 10000)
      return () => clearTimeout(timeout)
    }
  }, [profile])

  async function loadData() {
    setLoading(true)

    const { data: courseData } = await supabase
      .from('courses')
      .select('id, name, subject, grade_level, sections(id, name, meeting_days, meeting_time, room, course_id, end_time)')
      .eq('teacher_id', profile.id)
      .order('id')

    if (!courseData?.length) {
      setCourses([])
      setSections([])
      setLoading(false)
      return
    }

    const courseLookup = {}
    const allSectionsList = []

    courseData.forEach(course => {
      courseLookup[course.id] = course
      if (course.sections?.length) allSectionsList.push(...course.sections)
    })

    setCourses(courseData)
    setAllSections(allSectionsList)

    const todaySections = allSectionsList.filter(s => doesSectionMeetToday(s.meeting_days))
    const sectionIds = todaySections.map(s => s.id)
    let progressBySection = {}
    let carryOverBySection = {}
    let todayNotesBySection = {}

    if (sectionIds.length > 0) {
      // Load lesson progress (today)
      const { data: progressData } = await supabase
        .from('lesson_progress')
        .select('section_id, lesson_id, status, last_segment_completed_index, date_taught, lessons(title, order_index, units(title, order_index))')
        .in('section_id', sectionIds)
        .order('date_taught', { ascending: false })

      ;(progressData || []).forEach(p => {
        if (!progressBySection[p.section_id]) progressBySection[p.section_id] = p
      })

      const TODAY_STR = format(new Date(), 'yyyy-MM-dd')
      const { data: notesData } = await supabase
        .from('class_notes')
        .select('section_id, content')
        .in('section_id', sectionIds)
        .eq('date', TODAY_STR)
      
      ;(notesData || []).forEach(n => {
        todayNotesBySection[n.section_id] = n.content
      })

      // Load carry-over notes — most recent in_progress record per section with a note
      const { data: carryData } = await supabase
        .from('lesson_progress')
        .select('section_id, lesson_id, carry_over_note, date_taught, lessons(id, title)')
        .in('section_id', sectionIds)
        .eq('status', 'in_progress')
        .not('carry_over_note', 'is', null)
        .order('date_taught', { ascending: false })

      ;(carryData || []).forEach(p => {
        if (!carryOverBySection[p.section_id]) carryOverBySection[p.section_id] = p
      })

      // Load lessons for today's sections (for the tracker)
      const { data: lessonsData } = await supabase
        .from('lessons')
        .select('id, title, order_index, unit_id, units!inner(id, title, course_id, order_index)')
        .in('units.course_id', courseData.map(c => c.id))
        .order('order_index')

      if (lessonsData) {
        // Group lessons by section via course — pick the first unit's lessons per course
        const lessonsByCourse = {}
        lessonsData.forEach(l => {
          const cid = l.units?.course_id
          if (!cid) return
          if (!lessonsByCourse[cid]) lessonsByCourse[cid] = []
          lessonsByCourse[cid].push(l)
        })
        const map = {}
        todaySections.forEach(s => {
          const course = courseLookup[s.course_id]
          if (course) map[s.id] = lessonsByCourse[course.id] || []
        })
        setLessonsBySectionId(map)
      }
    }

    const enriched = todaySections.map(section => ({
      ...section,
      course: courseLookup[section.course_id],
      isNow: isClassNow(section.meeting_time),
      currentLesson: progressBySection[section.id] || null,
      carryOver: carryOverBySection[section.id] || null,
      todayNote: todayNotesBySection[section.id] || '',
    }))

    enriched.sort((a, b) => {
      if (a.isNow && !b.isNow) return -1
      if (!a.isNow && b.isNow) return 1
      return (a.meeting_time || '').localeCompare(b.meeting_time || '')
    })

    setSections(enriched)
    setLoading(false)
  }

  const todayLabel  = format(new Date(), 'EEEE, MMMM d')
  const greeting    = getGreeting()
  const GreetIcon   = greeting === 'evening' ? MoonIcon : SunIcon
  const firstName   = profile?.full_name?.split(' ')[0] ||
    (profile?.email ? profile.email.split('@')[0].replace(/[^a-zA-Z]/g, '') : null)
  const displayName = firstName
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1)
    : null
  const hasSchedule = allSections.length > 0
  const hasAnything = sections.length > 0

  const currentIdx  = sections.findIndex(s => s.isNow)
  const nextIdx     = currentIdx >= 0 ? currentIdx + 1 : 0

  const courseColorMap = {}
  courses.forEach((course, idx) => { courseColorMap[course.id] = colorFor(idx) })

  const weekByDay = {}
  WEEKDAYS.forEach(d => { weekByDay[d] = [] })
  allSections.forEach(s => {
    s.meeting_days?.forEach(d => {
      if (weekByDay[d]) weekByDay[d].push(s)
    })
  })
  WEEKDAYS.forEach(d => {
    weekByDay[d].sort((a, b) => (a.meeting_time || '').localeCompare(b.meeting_time || ''))
  })
  const todayName = format(new Date(), 'EEEE')

  // Find the notes-section's course for the drawer
  const notesCourse = notesSection
    ? courses.find(c => c.id === notesSection.course_id)
    : null
  const notesColor = notesSection
    ? courseColorMap[notesSection.course_id]
    : null

  return (
    <div className="space-y-5 pb-10">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GreetIcon className="w-5 h-5 text-amber-400" />
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {displayName ? `Good ${greeting}, ${displayName}` : `Good ${greeting}`}
            </h1>
          </div>
          <p className="text-sm text-gray-400 font-medium">{todayLabel}</p>
        </div>
        <button
          onClick={() => { setLoadError(false); setLoading(true); loadData() }}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          title="Refresh"
        >
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : loadError ? (
        <LoadError onRetry={() => { setLoadError(false); setLoading(true); loadData() }} />
      ) : !hasSchedule ? (
        <SetupPrompt navigate={navigate} courses={courses} />
      ) : !hasAnything ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <FreeDay sections={allSections} courses={courses} courseColorMap={courseColorMap} navigate={navigate} />
          </div>
          <div className="lg:col-span-1">
            <WeekSidebar weekByDay={weekByDay} todayName={todayName} courseColorMap={courseColorMap} courses={courses} navigate={navigate} />
          </div>
        </div>
      ) : (
        <>
          {/* ── Daily Digest strip ── */}
          <DailyDigest sections={sections} courses={courses} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* ── Left column ── */}
            <div className="lg:col-span-2 space-y-5">
              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Today"
                  value={sections.length}
                  sub="classes"
                  icon={<CalendarDaysIcon className="w-4 h-4" />}
                  accent="text-navy-700"
                  bg="bg-navy-50"
                />
                <StatCard
                  label="Courses"
                  value={courses.length}
                  sub="total"
                  icon={<BookOpenIcon className="w-4 h-4" />}
                  accent="text-emerald-600"
                  bg="bg-emerald-50"
                />
                <StatCard
                  label="Now"
                  value={sections.some(s => s.isNow) ? sections.find(s => s.isNow).name : '—'}
                  sub={sections.some(s => s.isNow) ? 'in session' : 'no class'}
                  icon={<ClockIcon className="w-4 h-4" />}
                  accent="text-amber-600"
                  bg="bg-amber-50"
                  compact
                />
                <StatCard
                  label="Done"
                  value={sections.filter(s => {
                    if (!s.meeting_time) return false
                    const [h, m] = s.meeting_time.split(':').map(Number)
                    const end = new Date()
                    end.setHours(h, m + 55, 0, 0)
                    return new Date() > end
                  }).length}
                  sub="today"
                  icon={<CheckSolid className="w-4 h-4" />}
                  accent="text-teal-600"
                  bg="bg-teal-50"
                />
              </div>

              {/* Today's classes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Today's Classes</p>
                  <button
                    onClick={() => navigate('/schedule')}
                    className="text-xs text-navy-700 font-semibold hover:underline flex items-center gap-1"
                  >
                    Edit schedule
                    <ChevronRightIcon className="w-3 h-3" />
                  </button>
                </div>

                <div className="space-y-2.5">
                  {sections.map((section, i) => {
                    const color  = courseColorMap[section.course_id]
                    const isNext = !section.isNow && i === nextIdx && !sections[0]?.isNow
                    const lessons = lessonsBySectionId[section.id] || []
                    return (
                      <ClassCard
                        key={section.id}
                        section={section}
                        color={color}
                        isNext={isNext}
                        lessons={lessons}
                        onOpenNotes={() => setNotesSection(section)}
                        navigate={navigate}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Progress timeline */}
              <DayTimeline sections={sections} courseColorMap={courseColorMap} />
            </div>

            {/* ── Right column ── */}
            <div className="lg:col-span-1">
              <WeekSidebar
                weekByDay={weekByDay}
                todayName={todayName}
                courseColorMap={courseColorMap}
                courses={courses}
                navigate={navigate}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Class Notes Drawer ── */}
      {notesSection && (
        <ClassNotesDrawer
          section={notesSection}
          course={notesCourse}
          color={notesColor}
          onClose={() => setNotesSection(null)}
        />
      )}
    </div>
  )
}

// ── Class Card ─────────────────────────────────────────────────────────────
function ClassCard({ section, color, isNext, lessons, onOpenNotes, navigate }) {
  const { profile } = useAuth()
  const { course, isNow, currentLesson, carryOver, todayNote } = section
  const [expanded, setExpanded] = useState(isNow) // auto-expand the "now" class
  const [note, setNote] = useState(todayNote || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef(null)

  const autoSaveNote = async (text) => {
    if (!profile) return
    setSaving(true)
    const TODAY = format(new Date(), 'yyyy-MM-dd')
    const { error } = await supabase
      .from('class_notes')
      .upsert({
        teacher_id: profile.id,
        section_id: section.id,
        date: TODAY,
        content: text,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'teacher_id,section_id,date' })
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleNoteChange = (e) => {
    const text = e.target.value
    setNote(text)
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autoSaveNote(text), 800)
  }

  // Calculate time-in-class progress bar for "Now" card
  let timePct = 0
  if (isNow && section.meeting_time) {
    const [h, m] = section.meeting_time.split(':').map(Number)
    const start = new Date(); start.setHours(h, m, 0, 0)
    const duration = section.end_time
      ? (() => { const [eh, em] = section.end_time.split(':').map(Number); return (eh * 60 + em) - (h * 60 + m) })()
      : 55
    const elapsed = (Date.now() - start.getTime()) / 1000 / 60
    timePct = Math.min(100, Math.max(0, (elapsed / duration) * 100))
  }

  // Figure out which lesson is current/next
  const currentLessonId = currentLesson?.lesson_id
  const currentLessonObj = lessons.find(l => l.id === currentLessonId) || lessons[0] || null
  const currentUnitTitle = currentLessonObj?.units?.title || null
  const currentUnitIdx   = currentLessonObj?.units?.order_index ?? null

  // Carry-over from previous class
  const hasCarryOver = !!(carryOver?.lessons?.id)

  return (
    <div className={`
      relative rounded-2xl overflow-hidden transition-all duration-200 bg-white
      ${isNow
        ? 'shadow-md shadow-amber-100/50 ring-1 ring-amber-200'
        : 'border border-gray-100 hover:border-gray-200 hover:shadow-sm'
      }
    `}>
      {/* Time-in-class progress bar */}
      {isNow && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gray-100 z-10">
          <div className="h-full bg-amber-400 transition-all duration-[60s]" style={{ width: `${timePct}%` }} />
        </div>
      )}

      {/* Left color bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${color?.bg || 'bg-gray-300'}`} />

      {/* ── Header row (always visible) ── */}
      <div
        className="pl-4 pr-3 py-3.5 flex items-center gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Time block */}
        <div className="text-center shrink-0 w-11">
          {section.meeting_time ? (
            <>
              <p className="text-[13px] font-bold text-gray-900 leading-none">
                {formatTime(section.meeting_time).replace(' AM','').replace(' PM','')}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5 font-medium">
                {formatTime(section.meeting_time).includes('AM') ? 'AM' : 'PM'}
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-300">—</p>
          )}
        </div>

        <div className="w-px h-8 bg-gray-100 shrink-0" />

        {/* Class info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isNow && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Now
              </span>
            )}
            {isNext && !isNow && (
              <span className="text-[11px] font-semibold text-navy-700 bg-navy-50 px-2 py-0.5 rounded-full">Up next</span>
            )}
            {hasCarryOver && !isNow && (
              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Carry-over</span>
            )}
            <p className="font-semibold text-gray-900 text-[13px] truncate">{section.name}</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-[12px] text-gray-500 font-medium truncate">{course?.name}</p>
            {section.room && (
              <span className="flex items-center gap-0.5 text-[11px] text-gray-400 shrink-0">
                <MapPinIcon className="w-3 h-3" />
                {section.room}
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        <ChevronRightIcon className={`w-4 h-4 text-gray-300 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </div>

      {/* ── Expanded lesson panel ── */}
      {expanded && (
        <div className="border-t border-gray-100">

          {/* Carry-over banner */}
          {hasCarryOver && (
            <div className="mx-4 mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
              <ArrowPathIcon className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800">
                  Didn't finish "{carryOver.lessons.title}" last class
                </p>
                {carryOver.carry_over_note && (
                  <p className="text-xs text-amber-600 mt-0.5">{carryOver.carry_over_note}</p>
                )}
              </div>
            </div>
          )}

          {/* Lesson on deck */}
          {lessons.length > 0 ? (
            <div className="px-4 pt-3 pb-1">
              {currentUnitTitle && (
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">
                  {currentUnitIdx != null ? `Unit ${currentUnitIdx + 1}: ` : ''}{currentUnitTitle}
                </p>
              )}
              {currentLessonObj ? (
                <div className={`rounded-xl border px-3.5 py-2.5 ${color?.light || 'bg-gray-50'} ${color?.border || 'border-gray-100'}`}>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                    {currentLesson ? 'Current lesson' : 'Up next'}
                  </p>
                  <p className={`text-[13px] font-semibold leading-snug ${color?.text || 'text-gray-800'}`}>
                    {currentLessonObj.title}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Lesson {lessons.indexOf(currentLessonObj) + 1} of {lessons.length}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 py-1">No lesson progress yet today.</p>
              )}
            </div>
          ) : (
            <div className="px-4 pt-3 pb-1">
              <p className="text-xs text-gray-400">No lessons in curriculum yet.</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="px-4 pt-3 pb-4 flex items-center gap-2">
            {currentLessonObj ? (
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-white bg-navy-800 hover:bg-navy-900 transition-colors"
                onClick={() => navigate(`/sections/${section.id}/lessons/${currentLessonObj.id}`)}
              >
                <ListBulletIcon className="w-4 h-4" />
                {hasCarryOver ? 'Continue lesson tracker' : 'Open lesson tracker'}
              </button>
            ) : (
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                onClick={() => navigate('/curriculum')}
              >
                <BookOpenIcon className="w-4 h-4" />
                Add lessons in Curriculum
              </button>
            )}
            <button
              onClick={onOpenNotes}
              className="p-2.5 rounded-xl border border-gray-100 text-gray-400 hover:text-navy-700 hover:border-navy-100 hover:bg-navy-50 transition-all"
              title="Historical Notes Log"
            >
              <CalendarDaysIcon className="w-4 h-4" />
            </button>
          </div>
          
          {/* Inline Daily Note */}
          <div className="px-4 pb-4">
            <div className={`rounded-xl border relative focus-within:ring-2 focus-within:ring-navy-100 transition-all ${color?.light || 'bg-gray-50'} ${color?.border || 'border-gray-100'}`}>
              <textarea
                value={note}
                onChange={handleNoteChange}
                placeholder="Type period notes, to-dos, or missing assignments..."
                className="w-full bg-transparent resize-none text-[13px] text-gray-800 placeholder-gray-400 p-3 pb-8 focus:outline-none min-h-[75px] leading-relaxed"
              />
              <div className="absolute bottom-2 right-2.5 flex items-center gap-2">
                {saving && <span className="text-[10px] font-medium text-gray-400 animate-pulse">Saving...</span>}
                {saved && !saving && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                    <CheckCircleIcon className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Day Timeline (visual time bar for today) ───────────────────────────────
function DayTimeline({ sections, courseColorMap }) {
  if (!sections.some(s => s.meeting_time)) return null

  const times = sections
    .filter(s => s.meeting_time)
    .map(s => {
      const [h, m] = s.meeting_time.split(':').map(Number)
      return h * 60 + m
    })
  const minT = Math.min(...times) - 30
  const maxT = Math.max(...times) + 85
  const span = maxT - minT || 1

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const nowPct = Math.min(100, Math.max(0, ((nowMin - minT) / span) * 100))
  const showNow = nowMin >= minT && nowMin <= maxT

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Day Timeline</p>

      <div className="relative h-8">
        <div className="absolute inset-y-[13px] left-0 right-0 h-1.5 bg-gray-100 rounded-full" />

        {sections.filter(s => s.meeting_time).map(s => {
          const [h, m] = s.meeting_time.split(':').map(Number)
          const startMin = h * 60 + m
          const left = ((startMin - minT) / span) * 100
          const width = (55 / span) * 100
          const color = courseColorMap[s.course_id]
          return (
            <div
              key={s.id}
              title={`${s.name} · ${formatTime(s.meeting_time)}`}
              className={`absolute top-[9px] h-[14px] rounded-sm ${color?.bg || 'bg-gray-300'} opacity-80 hover:opacity-100 transition-opacity cursor-default`}
              style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
            />
          )
        })}

        {showNow && (
          <div
            className="absolute top-0 w-0.5 h-8 bg-red-400 rounded-full"
            style={{ left: `${nowPct}%` }}
          >
            <div className="w-2 h-2 rounded-full bg-red-400 absolute -left-[3px] -top-0.5" />
          </div>
        )}
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-gray-300 font-medium">
          {Math.floor((minT + 30) / 60)}:{String((minT + 30) % 60).padStart(2, '0')}
        </span>
        <span className="text-[10px] text-gray-300 font-medium">
          {Math.floor((maxT - 30) / 60)}:{String((maxT - 30) % 60).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}

// ── Weekly Schedule Sidebar ────────────────────────────────────────────────
function WeekSidebar({ weekByDay, todayName, courseColorMap, courses, navigate }) {
  const [selectedDay, setSelectedDay] = useState(
    WEEKDAYS.includes(todayName) ? todayName : 'Monday'
  )

  const daySections = weekByDay[selectedDay] || []

  const courseLookup = {}
  courses.forEach(c => { courseLookup[c.id] = c })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden sticky top-5">
      <div className="px-4 pt-4 pb-3 border-b border-gray-50">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Week Schedule</p>
          <button
            onClick={() => navigate('/schedule')}
            className="text-[11px] text-navy-700 font-semibold hover:underline"
          >
            Edit
          </button>
        </div>

        <div className="flex gap-1">
          {WEEKDAYS.map(day => {
            const isToday = day === todayName
            const isSelected = day === selectedDay
            const count = weekByDay[day]?.length || 0
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`
                  flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 relative
                  ${isSelected
                    ? 'bg-navy-800 text-white'
                    : isToday
                    ? 'bg-navy-50 text-navy-700'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                {SHORT_DAYS[day]}
                {count > 0 && !isSelected && (
                  <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${isToday ? 'bg-navy-500' : 'bg-gray-300'}`} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-3">
        {daySections.length === 0 ? (
          <div className="py-8 text-center">
            <div className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-2">
              <CalendarDaysIcon className="w-4 h-4 text-gray-300" />
            </div>
            <p className="text-[12px] text-gray-400 font-medium">No classes</p>
            <p className="text-[11px] text-gray-300 mt-0.5">
              {selectedDay === todayName ? 'Free day!' : 'Nothing scheduled'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {daySections.map(section => {
              const color  = courseColorMap[section.course_id]
              const course = courseLookup[section.course_id]
              const isNow  = selectedDay === todayName && isClassNow(section.meeting_time)

              return (
                <div
                  key={section.id}
                  className={`
                    flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group
                    ${isNow
                      ? 'bg-amber-50 ring-1 ring-amber-200'
                      : 'hover:bg-gray-50'
                    }
                  `}
                  onClick={() => navigate('/schedule')}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${color?.dot || 'bg-gray-300'}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isNow && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                      )}
                      <p className="text-[12px] font-semibold text-gray-800 truncate">{section.name}</p>
                    </div>
                    <p className="text-[11px] text-gray-400 truncate">
                      {course?.name}
                      {section.meeting_time && <span className="text-gray-300"> · {formatTime(section.meeting_time)}</span>}
                    </p>
                  </div>

                  {section.room && (
                    <span className="text-[10px] text-gray-300 font-medium shrink-0 group-hover:text-gray-400">
                      Rm {section.room}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          {daySections.length} {daySections.length === 1 ? 'class' : 'classes'}
          {selectedDay === todayName && ' today'}
        </p>
        {selectedDay === todayName && daySections.length > 0 && (
          <span className="text-[10px] bg-navy-50 text-navy-700 font-semibold px-2 py-0.5 rounded-full">Today</span>
        )}
      </div>
    </div>
  )
}

// ── Stat Card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, accent, bg, compact }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
      <div className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${bg} ${accent} mb-2.5`}>
        {icon}
      </div>
      <p className={`font-bold text-gray-900 ${compact ? 'text-[15px] leading-tight truncate' : 'text-2xl'}`}>
        {value}
      </p>
      <p className="text-[11px] text-gray-400 font-medium mt-0.5">{sub || label}</p>
    </div>
  )
}

// ── Setup Prompt ───────────────────────────────────────────────────────────
function SetupPrompt({ navigate, courses }) {
  return (
    <div className="rounded-2xl overflow-hidden">
      <div className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-700 text-white p-7">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0 backdrop-blur-sm">
            <SparklesIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg tracking-tight">Build your schedule</h2>
            <p className="text-sm text-white/70 mt-1.5 leading-relaxed">
              {courses.length === 0
                ? "Add your courses first, then build your full weekly schedule in under 2 minutes."
                : "You have courses set up. Paste your schedule text or snap a photo to build it automatically."
              }
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          {courses.length === 0 ? (
            <button
              onClick={() => navigate('/curriculum')}
              className="flex items-center gap-2 px-4 py-2.5 bg-white text-navy-800 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <BookOpenIcon className="w-4 h-4" />
              Add courses
            </button>
          ) : (
            <button
              onClick={() => navigate('/schedule')}
              className="flex items-center gap-2 px-4 py-2.5 bg-white text-navy-800 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <CalendarDaysIcon className="w-4 h-4" />
              Build schedule
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-gray-100 border border-t-0 border-gray-100 rounded-b-2xl overflow-hidden">
        {[
          { icon: '✦', text: 'Text parser' },
          { icon: '⌗', text: 'Photo import' },
          { icon: '⊞', text: 'Manual entry' },
        ].map(f => (
          <div key={f.text} className="bg-white py-3 text-center">
            <p className="text-base">{f.icon}</p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">{f.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Free Day ───────────────────────────────────────────────────────────────
function FreeDay({ sections, courses, courseColorMap, navigate }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const todayIdx = WEEKDAYS.indexOf(today)
  const courseLookup = {}
  courses.forEach(c => { courseLookup[c.id] = c })

  let nextDayLabel = null
  let nextDaySections = []
  for (let offset = 1; offset <= 7; offset++) {
    const checkDay = WEEKDAYS[(todayIdx + offset) % 5]
    if (!checkDay) continue
    const found = sections
      .filter(s => s.meeting_days?.includes(checkDay))
      .sort((a, b) => (a.meeting_time || '').localeCompare(b.meeting_time || ''))
    if (found.length > 0) {
      nextDayLabel = offset === 1 ? `Tomorrow — ${checkDay}` : checkDay
      nextDaySections = found
      break
    }
  }

  const isWeekend = today === 'Saturday' || today === 'Sunday'

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-full bg-navy-50 flex items-center justify-center shrink-0">
            <CheckSolid className="w-5 h-5 text-navy-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900">No classes today</h3>
            <p className="text-sm text-gray-400 mt-0.5">
              {isWeekend ? 'Enjoy your weekend!' : 'You have the day free — a good time to plan ahead.'}
            </p>
            {!isWeekend && (
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => navigate('/curriculum')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-navy-800 bg-navy-50 rounded-lg hover:bg-navy-100 transition-colors"
                >
                  <BookOpenIcon className="w-3.5 h-3.5" />
                  Plan curriculum
                </button>
                <button
                  onClick={() => navigate('/schedule')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  <CalendarDaysIcon className="w-3.5 h-3.5" />
                  View schedule
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {nextDaySections.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
            Next Up — {nextDayLabel}
          </p>
          <div className="space-y-2">
            {nextDaySections.map(section => {
              const color  = courseColorMap[section.course_id]
              const course = courseLookup[section.course_id]
              return (
                <div
                  key={section.id}
                  onClick={() => navigate('/schedule')}
                  className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-sm transition-shadow"
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${color?.dot || 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{section.name}</p>
                    <p className="text-xs text-gray-400">
                      {course?.name}
                      {section.meeting_time && (
                        <span className="text-gray-300"> · {formatTime(section.meeting_time)}</span>
                      )}
                    </p>
                  </div>
                  <ChevronRightIcon className="w-3.5 h-3.5 text-gray-200 shrink-0" />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Loading Skeleton ────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Digest skeleton */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse h-16" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
                <div className="w-7 h-7 bg-gray-100 rounded-lg mb-2.5" />
                <div className="h-6 bg-gray-100 rounded w-1/2 mb-1" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-12 h-10 bg-gray-100 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-100 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse space-y-3">
            <div className="h-4 bg-gray-100 rounded w-1/2" />
            <div className="flex gap-1">
              {[1,2,3,4,5].map(i => <div key={i} className="flex-1 h-7 bg-gray-100 rounded-lg" />)}
            </div>
            {[1,2,3].map(i => (
              <div key={i} className="h-12 bg-gray-50 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Load Error ──────────────────────────────────────────────────────────────
function LoadError({ onRetry }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
        <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
      </div>
      <h3 className="font-semibold text-gray-900 mb-1">Couldn't load your schedule</h3>
      <p className="text-sm text-gray-400 mb-5">There was a problem connecting. Try refreshing.</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-navy-800 text-white text-sm font-semibold rounded-xl hover:bg-navy-900 transition-colors"
      >
        <ArrowPathIcon className="w-4 h-4" />
        Try again
      </button>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
