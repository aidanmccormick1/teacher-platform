import { useEffect, useState } from 'react'
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
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckSolid } from '@heroicons/react/24/solid'
import { format } from 'date-fns'

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
  const [sections, setSections]     = useState([])
  const [allSections, setAllSections] = useState([])
  const [courses, setCourses]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState(false)
  const [now, setNow]               = useState(new Date())

  useEffect(() => { document.title = 'Dashboard | Cacio EDU' }, [])

  // Keep "now" ticking so "Now" badge stays accurate
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
      .select('id, name, subject, grade_level, sections(id, name, meeting_days, meeting_time, room, course_id)')
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

    if (sectionIds.length > 0) {
      const { data: progressData } = await supabase
        .from('lesson_progress')
        .select('section_id, lesson_id, status, last_segment_completed_index, date_taught, lessons(title, order_index, units(title, order_index))')
        .in('section_id', sectionIds)
        .order('date_taught', { ascending: false })

      ;(progressData || []).forEach(p => {
        if (!progressBySection[p.section_id]) progressBySection[p.section_id] = p
      })
    }

    const enriched = todaySections.map(section => ({
      ...section,
      course: courseLookup[section.course_id],
      isNow: isClassNow(section.meeting_time),
      currentLesson: progressBySection[section.id] || null,
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
  const greetIcon   = greeting === 'morning' ? SunIcon : greeting === 'afternoon' ? SunIcon : MoonIcon
  const GreetIcon   = greetIcon
  const firstName   = profile?.full_name?.split(' ')[0] ||
    (profile?.email ? profile.email.split('@')[0].replace(/[^a-zA-Z]/g, '') : null)
  const displayName = firstName
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1)
    : null
  const hasSchedule = allSections.length > 0
  const hasAnything = sections.length > 0

  const currentIdx  = sections.findIndex(s => s.isNow)
  const nextIdx     = currentIdx >= 0 ? currentIdx + 1 : 0

  // Build course color map once
  const courseColorMap = {}
  courses.forEach((course, idx) => { courseColorMap[course.id] = colorFor(idx) })

  // Week schedule: group allSections by day
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

  return (
    <div className="space-y-6 pb-10">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Left column: today + stats ── */}
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
                  return (
                    <ClassCard
                      key={section.id}
                      section={section}
                      color={color}
                      isNext={isNext}
                      navigate={navigate}
                    />
                  )
                })}
              </div>
            </div>

            {/* Progress timeline */}
            <DayTimeline sections={sections} courseColorMap={courseColorMap} />
          </div>

          {/* ── Right column: weekly schedule sidebar ── */}
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
      )}
    </div>
  )
}

// ── Class Card ─────────────────────────────────────────────────────────────
function ClassCard({ section, color, isNext, navigate }) {
  const { course, isNow, currentLesson } = section
  const lessonTitle = currentLesson?.lessons?.title

  // Calculate progress through class if "now"
  let progressPct = 0
  if (isNow && section.meeting_time) {
    const [h, m] = section.meeting_time.split(':').map(Number)
    const start = new Date()
    start.setHours(h, m, 0, 0)
    const elapsed = (Date.now() - start.getTime()) / 1000 / 60
    progressPct = Math.min(100, Math.max(0, (elapsed / 55) * 100))
  }

  return (
    <div
      onClick={() => navigate('/schedule')}
      className={`
        relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200
        ${isNow
          ? 'shadow-lg shadow-amber-100/60 ring-1 ring-amber-200'
          : 'bg-white border border-gray-100 hover:border-gray-200 hover:shadow-md'
        }
      `}
      style={isNow ? { background: 'white' } : {}}
    >
      {/* "Now" progress bar at top */}
      {isNow && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gray-100">
          <div
            className="h-full bg-amber-400 transition-all duration-1000"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Left color bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${color?.bg || 'bg-gray-300'}`} />

      <div className="pl-4 pr-4 py-3.5 flex items-center gap-4">
        {/* Time block */}
        <div className="text-center shrink-0 w-12">
          {section.meeting_time ? (
            <>
              <p className="text-sm font-bold text-gray-900 leading-none">
                {formatTime(section.meeting_time).replace(' AM', '').replace(' PM', '')}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 font-medium">
                {formatTime(section.meeting_time).includes('AM') ? 'AM' : 'PM'}
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-300">—</p>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-9 bg-gray-100 shrink-0" />

        {/* Class info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isNow && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Now
              </span>
            )}
            {isNext && (
              <span className="text-[11px] font-semibold text-navy-700 bg-navy-50 px-2 py-0.5 rounded-full">
                Up next
              </span>
            )}
            <p className="font-semibold text-gray-900 text-[13px] leading-snug">{section.name}</p>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <p className="text-[12px] text-gray-500 font-medium">{course?.name}</p>
            {section.room && (
              <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                <MapPinIcon className="w-3 h-3" />
                Rm {section.room}
              </span>
            )}
          </div>
          {lessonTitle && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color?.dot || 'bg-gray-300'}`} />
              <p className="text-[11px] text-gray-400 truncate">
                Last: <span className="text-gray-600 font-medium">{lessonTitle}</span>
              </p>
            </div>
          )}
        </div>

        <ChevronRightIcon className="w-4 h-4 text-gray-200 shrink-0" />
      </div>
    </div>
  )
}

// ── Day Timeline (visual time bar for today) ───────────────────────────────
function DayTimeline({ sections, courseColorMap }) {
  if (!sections.some(s => s.meeting_time)) return null

  // Earliest / latest times to determine scale
  const times = sections
    .filter(s => s.meeting_time)
    .map(s => {
      const [h, m] = s.meeting_time.split(':').map(Number)
      return h * 60 + m
    })
  const minT = Math.min(...times) - 30
  const maxT = Math.max(...times) + 85 // +55 min class + buffer
  const span = maxT - minT || 1

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const nowPct = Math.min(100, Math.max(0, ((nowMin - minT) / span) * 100))
  const showNow = nowMin >= minT && nowMin <= maxT

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Day Timeline</p>

      <div className="relative h-8">
        {/* Track */}
        <div className="absolute inset-y-[13px] left-0 right-0 h-1.5 bg-gray-100 rounded-full" />

        {/* Class blocks */}
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

        {/* Now indicator */}
        {showNow && (
          <div
            className="absolute top-0 w-0.5 h-8 bg-red-400 rounded-full"
            style={{ left: `${nowPct}%` }}
          >
            <div className="w-2 h-2 rounded-full bg-red-400 absolute -left-[3px] -top-0.5" />
          </div>
        )}
      </div>

      {/* Time labels */}
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

  // Build course lookup
  const courseLookup = {}
  courses.forEach(c => { courseLookup[c.id] = c })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden sticky top-5">
      {/* Header */}
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

        {/* Day tabs */}
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

      {/* Day sections list */}
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
                  {/* Color dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${color?.dot || 'bg-gray-300'}`} />

                  {/* Info */}
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

                  {/* Room */}
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

      {/* Footer: class count */}
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
                ? "Add your courses first, then use AI to build your full weekly schedule in under 2 minutes."
                : "You have courses set up. Paste your schedule text or snap a photo and AI will build it for you."
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
              Build with AI
            </button>
          )}
        </div>
      </div>

      {/* Feature hints */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 border border-t-0 border-gray-100 rounded-b-2xl overflow-hidden">
        {[
          { icon: '✦', text: 'AI text parser' },
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

  // Find next school day that has classes
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
      {/* Status card */}
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

      {/* Next Up */}
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
