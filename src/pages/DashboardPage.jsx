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
} from '@heroicons/react/24/outline'
import { format } from 'date-fns'

const PERIOD_COLORS = [
  { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-400' },
  { bg: 'bg-violet-500', light: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dot: 'bg-violet-400' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  { bg: 'bg-amber-500', light: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-400' },
  { bg: 'bg-rose-500', light: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dot: 'bg-rose-400' },
  { bg: 'bg-cyan-500', light: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', dot: 'bg-cyan-400' },
  { bg: 'bg-orange-500', light: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-400' },
]

function colorFor(i) {
  return PERIOD_COLORS[i % PERIOD_COLORS.length]
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [sections, setSections]   = useState([])
  const [allSections, setAllSections] = useState([])
  const [courses, setCourses]     = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (profile) loadData()
  }, [profile])

  async function loadData() {
    setLoading(true)

    const { data: courseData } = await supabase
      .from('courses')
      .select('id, name, subject, grade_level')
      .eq('teacher_id', profile.id)

    if (!courseData?.length) {
      setCourses([])
      setSections([])
      setLoading(false)
      return
    }

    setCourses(courseData)
    const courseIds = courseData.map(c => c.id)

    const { data: sectionData } = await supabase
      .from('sections')
      .select('*')
      .in('course_id', courseIds)
      .order('meeting_time', { ascending: true })

    setAllSections(sectionData || [])

    const todaySections = (sectionData || []).filter(s => doesSectionMeetToday(s.meeting_days))

    // Enrich with course info and "is now" status
    const enriched = todaySections.map(section => ({
      ...section,
      course: courseData.find(c => c.id === section.course_id),
      isNow: isClassNow(section.meeting_time),
    }))

    enriched.sort((a, b) => {
      if (a.isNow && !b.isNow) return -1
      if (!a.isNow && b.isNow) return 1
      return (a.meeting_time || '').localeCompare(b.meeting_time || '')
    })

    setSections(enriched)
    setLoading(false)
  }

  const today    = format(new Date(), 'EEEE, MMMM d')
  const greeting = getGreeting()
  const firstName = profile?.full_name?.split(' ')[0] || 'there'
  const hasSchedule = allSections.length > 0
  const hasAnything = sections.length > 0

  // Build a quick "next class" preview even when not today
  const currentIdx = sections.findIndex(s => s.isNow)
  const nextIdx = currentIdx >= 0 ? currentIdx + 1 : 0

  return (
    <div className="space-y-6 pb-8">
      {/* Greeting header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Good {greeting}, {firstName} 👋
          </h1>
          <p className="text-sm text-gray-400 mt-1">{today}</p>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : !hasSchedule ? (
        <SetupPrompt navigate={navigate} courses={courses} />
      ) : !hasAnything ? (
        <FreeDay sections={allSections} courses={courses} navigate={navigate} />
      ) : (
        <>
          {/* Today's timeline */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Today's classes</p>
              <button
                onClick={() => navigate('/schedule')}
                className="text-xs text-indigo-600 font-medium hover:underline"
              >
                Edit schedule
              </button>
            </div>

            <div className="space-y-2">
              {sections.map((section, i) => {
                const color = colorFor(courses.findIndex(c => c.id === section.course_id))
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

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Classes today"
              value={sections.length}
              icon={<CalendarDaysIcon className="w-4 h-4" />}
              color="text-indigo-600"
            />
            <StatCard
              label="Total courses"
              value={courses.length}
              icon={<BookOpenIcon className="w-4 h-4" />}
              color="text-emerald-600"
            />
          </div>
        </>
      )}
    </div>
  )
}

function ClassCard({ section, color, isNext, navigate }) {
  const { course, isNow } = section

  return (
    <div
      onClick={() => navigate('/schedule')}
      className={`
        relative rounded-2xl border overflow-hidden cursor-pointer transition-all hover:shadow-md
        ${isNow
          ? 'border-amber-300 shadow-md shadow-amber-100'
          : 'border-gray-200 hover:border-gray-300'
        }
      `}
    >
      {/* Left color bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${color.bg}`} />

      <div className="pl-4 pr-4 py-3.5 flex items-center gap-4">
        {/* Time block */}
        <div className="text-center shrink-0 w-14">
          {section.meeting_time ? (
            <>
              <p className="text-sm font-bold text-gray-900">{formatTime(section.meeting_time).replace(' AM', '').replace(' PM', '')}</p>
              <p className="text-xs text-gray-400">{formatTime(section.meeting_time).includes('AM') ? 'AM' : 'PM'}</p>
            </>
          ) : (
            <p className="text-xs text-gray-300">No time</p>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-100" />

        {/* Class info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isNow && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Now
              </span>
            )}
            {isNext && (
              <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                Up next
              </span>
            )}
            <p className="font-semibold text-gray-900 text-sm">{section.name}</p>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <p className="text-xs text-gray-500">{course?.name}</p>
            {section.room && (
              <span className="flex items-center gap-0.5 text-xs text-gray-400">
                <MapPinIcon className="w-3 h-3" />
                Rm {section.room}
              </span>
            )}
          </div>
        </div>

        <ChevronRightIcon className="w-4 h-4 text-gray-300 shrink-0" />
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className="card p-4">
      <div className={`flex items-center gap-2 ${color} mb-2`}>
        {icon}
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

function SetupPrompt({ navigate, courses }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <SparklesIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-lg">Build your schedule</h2>
          <p className="text-sm text-indigo-200 mt-1">
            {courses.length === 0
              ? "Add your courses first, then build your schedule. Takes 2 minutes."
              : "You have courses set up. Now build your weekly schedule with AI — paste your schedule or snap a photo."
            }
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        {courses.length === 0 ? (
          <button
            onClick={() => navigate('/curriculum')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-indigo-700 text-sm font-semibold rounded-xl hover:bg-indigo-50"
          >
            <BookOpenIcon className="w-4 h-4" />
            Add courses
          </button>
        ) : (
          <button
            onClick={() => navigate('/schedule')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-indigo-700 text-sm font-semibold rounded-xl hover:bg-indigo-50"
          >
            <CalendarDaysIcon className="w-4 h-4" />
            Build schedule
          </button>
        )}
      </div>
    </div>
  )
}

function FreeDay({ sections, courses, navigate }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  // Find what's on tomorrow
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const todayIdx = WEEKDAYS.indexOf(today)
  const tomorrowDay = WEEKDAYS[todayIdx + 1]
  const tomorrow = tomorrowDay
    ? sections.filter(s => s.meeting_days?.includes(tomorrowDay))
    : []

  return (
    <div className="space-y-4">
      {/* No classes today */}
      <div className="card p-6 text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h3 className="font-semibold text-gray-900">No classes today</h3>
        <p className="text-sm text-gray-400 mt-1">
          {today === 'Saturday' || today === 'Sunday'
            ? "Enjoy your weekend!"
            : "Looks like you have the day free."}
        </p>
      </div>

      {/* Tomorrow preview */}
      {tomorrow.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Tomorrow — {tomorrowDay}
          </p>
          <div className="space-y-2">
            {tomorrow
              .sort((a, b) => (a.meeting_time || '').localeCompare(b.meeting_time || ''))
              .map((section, i) => {
                const color = colorFor(courses.findIndex(c => c.id === section.course_id))
                return (
                  <div key={section.id} className="card px-4 py-3 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{section.name}</p>
                      <p className="text-xs text-gray-400">
                        {courses.find(c => c.id === section.course_id)?.name}
                        {section.meeting_time && ` · ${formatTime(section.meeting_time)}`}
                      </p>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      <button
        onClick={() => navigate('/schedule')}
        className="w-full py-3 border border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
      >
        View full schedule
      </button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl border border-gray-100 p-4 animate-pulse">
          <div className="flex gap-4">
            <div className="w-14 h-10 bg-gray-100 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
