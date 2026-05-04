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
  ArrowRightIcon,
  ArrowTrendingUpIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import ClassNotesDrawer from '@/components/ClassNotesDrawer'
import clsx from 'clsx'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

export default function DashboardPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [sections, setSections]         = useState([])
  const [allSections, setAllSections]   = useState([])
  const [courses, setCourses]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState(false)
  const [now, setNow]                   = useState(new Date())
  const [notesSection, setNotesSection] = useState(null)
  const [holidays, setHolidays]         = useState([])

  useEffect(() => { document.title = 'Dashboard | TeacherOS' }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (profile) loadData()
  }, [profile])

  async function loadData() {
    setLoading(true)
    setLoadError(false)
    try {
      const [
        { data: courseData, error: courseErr },
        { data: holidayData },
      ] = await Promise.all([
        supabase
          .from('courses')
          .select('id, name, subject, grade_level, sections(id, name, meeting_days, meeting_time, room, course_id)')
          .eq('teacher_id', profile.id)
          .order('id'),
        supabase
          .from('school_holidays')
          .select('*')
          .gte('date', format(new Date(), 'yyyy-MM-dd'))
          .lte('date', format(new Date(Date.now() + 86400000 * 2), 'yyyy-MM-dd'))
          .order('date', { ascending: true }),
      ])

      if (courseErr) throw courseErr
      setHolidays(holidayData || [])

      if (!courseData?.length) {
        setCourses([])
        setSections([])
        setLoading(false)
        return
      }

      setCourses(courseData)
      const courseLookup = {}
      const allSectionsList = []
      courseData.forEach(c => {
        courseLookup[c.id] = c
        if (c.sections?.length) allSectionsList.push(...c.sections)
      })
      setAllSections(allSectionsList)

      const todaySections = allSectionsList.filter(s => doesSectionMeetToday(s.meeting_days))
      const sectionIds = todaySections.map(s => s.id)

      let progressMap = {}
      if (sectionIds.length > 0) {
        const { data: progressData } = await supabase
          .from('lesson_progress')
          .select(`
            section_id,
            lesson_id,
            status,
            last_segment_completed_index,
            carry_over_note,
            lessons (
              id, title, order_index,
              units ( id, title, lessons(id) )
            )
          `)
          .in('section_id', sectionIds)
          .order('updated_at', { ascending: false })

        progressData?.forEach(p => {
          if (!progressMap[p.section_id]) progressMap[p.section_id] = p
        })
      }

      const enriched = todaySections.map(section => ({
        ...section,
        course: courseLookup[section.course_id],
        isNow: isClassNow(section.meeting_time),
        progress: progressMap[section.id] || null,
      }))
      enriched.sort((a, b) => (a.meeting_time || '').localeCompare(b.meeting_time || ''))
      setSections(enriched)
    } catch (err) {
      console.error('Dashboard load error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const [generatingContinuity, setGeneratingContinuity] = useState({})

  async function generateContinuityForSection(sectionId) {
    const section = sections.find(s => s.id === sectionId)
    if (!section?.progress) return

    setGeneratingContinuity(prev => ({ ...prev, [sectionId]: true }))
    try {
      const res = await fetch('/api/ai/generate-continuity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonTitle: section.progress.lessons?.title,
          lastSegmentTitle: `Segment #${(section.progress.last_segment_completed_index || 0) + 1}`,
          lastNote: section.progress.carry_over_note,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setSections(prev => prev.map(s =>
          s.id === sectionId ? { ...s, aiContinuity: data } : s
        ))
      }
    } catch (e) {
      console.error('Continuity generation failed', e)
    } finally {
      setGeneratingContinuity(prev => ({ ...prev, [sectionId]: false }))
    }
  }

  const greeting = getGreeting()
  const GreetIcon = greeting === 'evening' ? MoonIcon : SunIcon
  const firstName = profile?.full_name?.split(' ')[0] || 'Teacher'

  if (loading) return <LoadingSkeleton />
  if (loadError) return <LoadError onRetry={loadData} />
  if (allSections.length === 0) return <SetupPrompt navigate={navigate} />

  const todayHoliday = holidays.find(h => h.date === format(new Date(), 'yyyy-MM-dd'))

  return (
    <div className="space-y-6 pb-16 animate-in">

      {/* Holiday alert */}
      {todayHoliday && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-100">
          <CalendarDaysIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">No school today</span> — {todayHoliday.name}.
            Lesson tracking is paused.
          </p>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GreetIcon className="w-5 h-5 text-amber-500" />
            <h1 className="text-2xl font-bold text-gray-900">
              Good {greeting}, {firstName}
            </h1>
          </div>
          <p className="text-sm text-gray-400">
            {format(new Date(), 'EEEE, MMMM do')} &middot; {sections.length} {sections.length === 1 ? 'class' : 'classes'} today
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-white border border-gray-100 px-3 py-1.5 rounded-xl shadow-sm flex items-center gap-2 text-sm">
            <BookOpenIcon className="w-4 h-4 text-gray-400" />
            <span className="font-semibold text-gray-700">{courses.length}</span>
            <span className="text-gray-400">courses</span>
          </div>
          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-white border border-gray-100 hover:bg-gray-50 text-gray-400 transition-all shadow-sm"
            title="Refresh"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Today's classes */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="section-header">Today's Classes</h2>

          {sections.length === 0 ? (
            <div className="card p-10 text-center border-dashed border-gray-200">
              <SunIcon className="w-10 h-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm text-gray-400">No classes scheduled for today.</p>
              <button onClick={() => navigate('/schedule')} className="mt-3 text-xs font-semibold text-navy-700 hover:underline">
                Manage schedule
              </button>
            </div>
          ) : (
            sections.map(section => (
              <PlanningBlock
                key={section.id}
                section={section}
                navigate={navigate}
                onOpenNotes={() => setNotesSection(section)}
                onGenerateContinuity={() => generateContinuityForSection(section.id)}
                isGeneratingContinuity={generatingContinuity[section.id]}
              />
            ))
          )}
        </div>

        {/* Right: Sidebar */}
        <aside className="space-y-5">
          {/* Stats */}
          <div className="card p-5 space-y-3">
            <h3 className="section-header !mb-0">Quick Stats</h3>
            <div className="divide-y divide-gray-50">
              <StatRow label="Courses" value={courses.length} />
              <StatRow label="Classes today" value={sections.length} />
              <StatRow
                label="Lessons in progress"
                value={sections.filter(s => s.progress && s.progress.status !== 'completed').length}
              />
              <StatRow
                label="Completed lessons"
                value={sections.filter(s => s.progress?.status === 'completed').length}
              />
            </div>
          </div>

          {/* Weekly overview */}
          <WeekSidebar sections={allSections} />

          {/* Upcoming classes (rest of week) */}
          <UpcomingClasses sections={allSections} navigate={navigate} />
        </aside>
      </div>

      {notesSection && (
        <ClassNotesDrawer
          section={notesSection}
          course={notesSection.course}
          onClose={() => setNotesSection(null)}
        />
      )}
    </div>
  )
}

function PlanningBlock({ section, navigate, onOpenNotes, onGenerateContinuity, isGeneratingContinuity }) {
  const { progress, aiContinuity } = section
  const lesson   = progress?.lessons || null
  const unit     = lesson?.units    || null
  const isNow    = section.isNow
  const isCompleted = progress?.status === 'completed'

  const totalLessons = unit?.lessons?.length || 0
  const currentIdx   = lesson ? lesson.order_index + 1 : 0
  const progressPct  = totalLessons > 0 ? Math.round((currentIdx / totalLessons) * 100) : 0

  return (
    <div className={clsx(
      'planning-block group relative',
      isNow && 'ring-2 ring-navy-400/30 shadow-md'
    )}>
      {isNow && (
        <span className="absolute top-4 right-4 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-navy-700 text-[10px] font-bold text-white uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Now
        </span>
      )}

      {/* AI Continuity panel */}
      {(aiContinuity || isGeneratingContinuity) && (
        <div className="mb-4 p-4 rounded-xl bg-navy-800 text-white flex items-start gap-3">
          <SparklesIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            {isGeneratingContinuity ? (
              <div className="space-y-1.5 animate-pulse">
                <div className="h-2.5 bg-white/20 rounded w-1/4" />
                <div className="h-2 bg-white/10 rounded w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-navy-300 block mb-0.5">Recap</span>
                  <p className="text-xs text-navy-100 leading-relaxed">{aiContinuity.recap}</p>
                </div>
                {aiContinuity.nextStep && (
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-navy-300 block mb-0.5">Opening move</span>
                    <p className="text-xs text-amber-200 font-medium leading-relaxed">{aiContinuity.nextStep}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {!isGeneratingContinuity && aiContinuity && (
            <button
              onClick={onGenerateContinuity}
              className="text-white/40 hover:text-white transition-colors shrink-0"
              title="Regenerate"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-5">
        {/* Left: course + progress */}
        <div className="md:w-44 shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 mb-0.5">
            {formatTime(section.meeting_time)}{section.room ? ` · Rm ${section.room}` : ''}
          </p>
          <h3 className="font-bold text-gray-900 leading-tight mb-0.5">{section.name}</h3>
          <p className="text-xs text-gray-400 mb-4 truncate">{section.course?.name}</p>

          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>{unit ? 'Unit progress' : 'No unit'}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-navy-600 transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: lesson + actions */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {unit?.title && (
                <span className="badge badge-gray">{unit.title}</span>
              )}
              {lesson && (
                <span className="text-[11px] text-gray-400">
                  Lesson {currentIdx} of {totalLessons}
                </span>
              )}
            </div>
            <h4 className="font-semibold text-gray-900 leading-snug mb-3">
              {lesson?.title || 'No lesson assigned'}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-start gap-2 text-xs">
                <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Stopped at</span>
                  <p className="text-gray-500 italic">
                    {progress?.last_segment_completed_index !== undefined
                      ? `Segment ${progress.last_segment_completed_index + 1}`
                      : 'Not started'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <PencilSquareIcon className="w-4 h-4 text-navy-400 shrink-0 mt-0.5" />
                <div>
                  <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Last note</span>
                  <p className="text-gray-500 italic line-clamp-2">
                    {progress?.carry_over_note || 'No notes yet'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={() =>
                lesson
                  ? navigate(`/sections/${section.id}/lessons/${lesson.id}`)
                  : navigate('/curriculum')
              }
              className={clsx(
                'flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all',
                lesson
                  ? 'bg-navy-800 text-white hover:bg-navy-900'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {isNow ? 'Open lesson tracker' : 'Continue planning'}
            </button>

            {/* AI Continuity button — only show if lesson exists */}
            {lesson && !aiContinuity && (
              <button
                onClick={onGenerateContinuity}
                disabled={isGeneratingContinuity}
                title="Generate AI recap"
                className="p-2.5 rounded-xl border border-gray-100 text-gray-400 hover:text-navy-700 hover:bg-navy-50 hover:border-navy-100 transition-all disabled:opacity-40"
              >
                {isGeneratingContinuity
                  ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  : <SparklesIcon className="w-4 h-4" />
                }
              </button>
            )}

            <button
              onClick={onOpenNotes}
              title="Class notes"
              className="p-2.5 rounded-xl border border-gray-100 text-gray-400 hover:text-navy-700 hover:bg-navy-50 hover:border-navy-100 transition-all"
            >
              <CalendarDaysIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  )
}

function WeekSidebar({ sections }) {
  const dayName = format(new Date(), 'EEEE')

  const weekByDay = {}
  WEEKDAYS.forEach(d => { weekByDay[d] = [] })
  sections.forEach(s => {
    s.meeting_days?.forEach(d => {
      if (weekByDay[d]) weekByDay[d].push(s)
    })
  })

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-gray-50">
        <h3 className="section-header !mb-0">This week</h3>
      </div>
      <div className="p-2 space-y-0.5">
        {WEEKDAYS.map(day => {
          const count = weekByDay[day]?.length || 0
          const isToday = day === dayName
          return (
            <div
              key={day}
              className={clsx(
                'flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors',
                isToday ? 'bg-navy-50' : ''
              )}
            >
              <span className={clsx('font-medium', isToday ? 'text-navy-800' : 'text-gray-400')}>
                {day}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={clsx('text-xs', isToday ? 'text-navy-600 font-semibold' : 'text-gray-300')}>
                  {count} {count === 1 ? 'class' : 'classes'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UpcomingClasses({ sections, navigate }) {
  const dayName   = format(new Date(), 'EEEE')
  const dayIndex  = WEEKDAYS.indexOf(dayName)
  const upcoming  = WEEKDAYS.slice(dayIndex + 1)
  const nextDays  = upcoming.filter(d =>
    sections.some(s => s.meeting_days?.includes(d))
  ).slice(0, 2)

  if (!nextDays.length) return null

  return (
    <div className="card p-4 space-y-3">
      <h3 className="section-header !mb-0">Coming up</h3>
      {nextDays.map(day => {
        const daySections = sections.filter(s => s.meeting_days?.includes(day))
        return (
          <div key={day}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{day}</p>
            <div className="space-y-1">
              {daySections.slice(0, 3).map(s => (
                <div key={s.id} className="text-xs text-gray-600 flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getGreeting() {
  const hr = new Date().getHours()
  if (hr < 12) return 'morning'
  if (hr < 17) return 'afternoon'
  return 'evening'
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 bg-gray-100 rounded-xl w-2/3" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-gray-100 rounded-2xl" />)}
        </div>
        <div className="space-y-4">
          <div className="h-40 bg-gray-100 rounded-2xl" />
          <div className="h-32 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

function LoadError({ onRetry }) {
  return (
    <div className="card p-10 text-center max-w-md mx-auto mt-12 bg-rose-50 border-rose-100">
      <ExclamationTriangleIcon className="w-10 h-10 mx-auto mb-3 text-rose-400" />
      <h2 className="font-semibold text-rose-900 mb-1">Couldn't load your dashboard</h2>
      <p className="text-sm text-rose-600/70 mb-5">Check your connection and try again.</p>
      <button onClick={onRetry} className="btn-primary">Retry</button>
    </div>
  )
}

function SetupPrompt({ navigate }) {
  return (
    <div className="card p-12 text-center max-w-xl mx-auto mt-12 border-dashed border-gray-200">
      <AcademicCapIcon className="w-12 h-12 mx-auto mb-5 text-navy-200" />
      <h2 className="text-2xl font-bold text-gray-900 mb-3">Welcome to TeacherOS</h2>
      <p className="text-gray-500 mb-8 leading-relaxed">
        Set up your courses and schedule to get started. Your dashboard will show today's classes and lesson progress automatically.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button onClick={() => navigate('/curriculum')} className="btn-primary px-8 py-3">
          Build curriculum
        </button>
        <button onClick={() => navigate('/schedule')} className="btn-secondary px-8 py-3">
          Set schedule
        </button>
      </div>
    </div>
  )
}
