import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  doesSectionMeetToday,
  isClassNow,
  formatTime,
  todayISO,
} from '@/lib/dateUtils'
import {
  ClockIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ChatBubbleLeftIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { format } from 'date-fns'

export default function DashboardPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [sections, setSections] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (profile) loadTodaysSections()
  }, [profile])

  async function loadTodaysSections() {
    setLoading(true)

    // Load all sections for this teacher's courses
    const { data: courses } = await supabase
      .from('courses')
      .select('id, name, subject, grade_level')
      .eq('teacher_id', profile.id)

    if (!courses?.length) {
      setSections([])
      setLoading(false)
      return
    }

    const courseIds = courses.map(c => c.id)

    const { data: sectionData } = await supabase
      .from('sections')
      .select('*')
      .in('course_id', courseIds)
      .order('meeting_time', { ascending: true })

    if (!sectionData?.length) {
      setSections([])
      setLoading(false)
      return
    }

    // Filter to today's sections
    const todaySections = sectionData.filter(s => doesSectionMeetToday(s.meeting_days))

    // For each section, get the current lesson progress
    const enriched = await Promise.all(
      todaySections.map(async (section) => {
        const course = courses.find(c => c.id === section.course_id)

        // Get the most recent progress record for this section
        const { data: progressRows } = await supabase
          .from('lesson_progress')
          .select(`
            *,
            lessons (
              id, title, unit_id, order_index, estimated_duration_minutes,
              units ( title, course_id )
            )
          `)
          .eq('section_id', section.id)
          .in('status', ['in_progress', 'not_started'])
          .order('date_taught', { ascending: false })
          .limit(1)

        // Get today's scheduled lesson (if no in-progress, get next not_started)
        let activeLesson = null
        let progress     = null

        if (progressRows?.length) {
          progress     = progressRows[0]
          activeLesson = progress.lessons
        } else {
          // Find the next lesson in the curriculum for this section
          const { data: nextLesson } = await supabase
            .from('lessons')
            .select(`
              id, title, order_index, estimated_duration_minutes,
              units!inner ( title, course_id )
            `)
            .eq('units.course_id', section.course_id)
            .order('order_index', { ascending: true })
            .limit(1)
          activeLesson = nextLesson?.[0] || null
        }

        // Get segment count for progress display
        let segmentCount = 0
        if (activeLesson) {
          const { count } = await supabase
            .from('lesson_segments')
            .select('id', { count: 'exact', head: true })
            .eq('lesson_id', activeLesson.id)
          segmentCount = count || 0
        }

        return {
          ...section,
          course,
          activeLesson,
          progress,
          segmentCount,
          isNow: isClassNow(section.meeting_time),
        }
      })
    )

    // Sort: current class first, then by meeting time
    enriched.sort((a, b) => {
      if (a.isNow && !b.isNow) return -1
      if (!a.isNow && b.isNow) return 1
      return (a.meeting_time || '').localeCompare(b.meeting_time || '')
    })

    setSections(enriched)
    setLoading(false)
  }

  const today = format(new Date(), 'EEEE, MMMM d')
  const hasAnything = sections.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">
            Good {getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{today}</p>
        </div>
        <button
          onClick={() => navigate('/curriculum')}
          className="btn-secondary text-xs gap-1.5"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          New course
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : !hasAnything ? (
        <EmptyState navigate={navigate} />
      ) : (
        <div className="space-y-3">
          <p className="section-header">Today's classes</p>
          {sections.map(section => (
            <SectionCard
              key={section.id}
              section={section}
              navigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SectionCard({ section, navigate }) {
  const { course, activeLesson, progress, segmentCount, isNow } = section

  const completedSegments = progress
    ? Math.max(0, (progress.last_segment_completed_index ?? -1) + 1)
    : 0

  const progressPct = segmentCount > 0
    ? Math.round((completedSegments / segmentCount) * 100)
    : 0

  const hasCarryOver = !!progress?.carry_over_note
  const isCarriedOver = progress?.last_segment_completed_index >= 0 &&
    progress?.last_segment_completed_index < segmentCount - 1

  function handleOpen() {
    if (activeLesson) {
      navigate(`/sections/${section.id}/lessons/${activeLesson.id}`)
    }
  }

  return (
    <div
      className={`card p-4 cursor-pointer hover:shadow-md transition-all duration-150 ${
        isNow ? 'ring-2 ring-amber-400 border-amber-200' : ''
      }`}
      onClick={handleOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Class name + time */}
          <div className="flex items-center gap-2 flex-wrap">
            {isNow && (
              <span className="badge-amber flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Now
              </span>
            )}
            <span className="font-semibold text-gray-900 text-sm">
              {section.name}
            </span>
            <span className="text-xs text-gray-400">
              {course?.name}
            </span>
          </div>

          {/* Time + room */}
          <div className="flex items-center gap-3 mt-0.5">
            {section.meeting_time && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <ClockIcon className="w-3.5 h-3.5" />
                {formatTime(section.meeting_time)}
              </span>
            )}
            {section.room && (
              <span className="text-xs text-gray-400">Room {section.room}</span>
            )}
          </div>

          {/* Active lesson */}
          {activeLesson ? (
            <div className="mt-2">
              <p className="text-sm text-gray-700 font-medium truncate">
                {activeLesson.title}
              </p>

              {/* Progress bar */}
              {segmentCount > 0 && (
                <div className="mt-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">
                      {completedSegments} of {segmentCount} segments
                    </span>
                    <span className="text-xs font-medium text-gray-600">{progressPct}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-500 rounded-full transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Left-off reminder */}
              {isCarriedOver && !hasCarryOver && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Left off at segment {completedSegments} of {segmentCount} last time
                </div>
              )}

              {/* Carry-over note */}
              {hasCarryOver && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                  <ChatBubbleLeftIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span><strong>Note from last class:</strong> {progress.carry_over_note}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 mt-1.5 italic">No lesson scheduled — add one in Curriculum</p>
          )}
        </div>

        <ChevronRightIcon className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />
      </div>
    </div>
  )
}

function EmptyState({ navigate }) {
  return (
    <div className="card p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <BookIcon />
      </div>
      <h3 className="font-semibold text-gray-900 mb-1">No classes today</h3>
      <p className="text-sm text-gray-500 mb-4">
        Set up your courses and sections to see your daily schedule here.
      </p>
      <div className="flex gap-2 justify-center">
        <button className="btn-primary" onClick={() => navigate('/curriculum')}>
          Build curriculum
        </button>
        <button className="btn-secondary" onClick={() => navigate('/schedule')}>
          Set up schedule
        </button>
      </div>
    </div>
  )
}

function BookIcon() {
  return (
    <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
      />
    </svg>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
