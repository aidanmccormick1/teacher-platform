/**
 * DailyDigest — top-of-dashboard at-a-glance strip
 *
 * Shows: next class countdown, classes remaining today, a rotating
 * "tip of the day" from a curated static list (no visible AI).
 * Keeps itself updated every minute via a tick.
 */
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  ClockIcon,
  CheckCircleIcon,
  AcademicCapIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import { formatTime } from '@/lib/dateUtils'


function getNextClass(sections) {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const upcoming = sections
    .filter(s => {
      if (!s.meeting_time) return false
      const [h, m] = s.meeting_time.split(':').map(Number)
      return h * 60 + m > nowMin
    })
    .sort((a, b) => a.meeting_time.localeCompare(b.meeting_time))

  return upcoming[0] || null
}

function getClassesRemaining(sections) {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  return sections.filter(s => {
    if (!s.meeting_time) return false
    const [h, m] = s.meeting_time.split(':').map(Number)
    // class is "remaining" if it hasn't ended (start + ~55 min)
    return h * 60 + m + 55 > nowMin
  }).length
}

function getCountdown(meetingTime) {
  if (!meetingTime) return null
  const [h, m] = meetingTime.split(':').map(Number)
  const now = new Date()
  const classMin = h * 60 + m
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const diff = classMin - nowMin
  if (diff <= 0) return null
  if (diff < 60) return `${diff}m`
  return `${Math.floor(diff / 60)}h ${diff % 60}m`
}

export default function DailyDigest({ sections, courses }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])


  const nextClass = getNextClass(sections)
  const remaining = getClassesRemaining(sections)
  const countdown = nextClass ? getCountdown(nextClass.meeting_time) : null
  const isNowInClass = sections.some(s => {
    if (!s.meeting_time) return false
    const [h, m] = s.meeting_time.split(':').map(Number)
    const nowMin = now.getHours() * 60 + now.getMinutes()
    return nowMin >= h * 60 + m && nowMin <= h * 60 + m + 55
  })

  const courseLookup = {}
  courses.forEach(c => { courseLookup[c.id] = c })

  if (sections.length === 0) return null

  const allDone = remaining === 0 && sections.length > 0

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="flex divide-x divide-gray-100">
        {/* Next class / In session */}
        <div className="flex-1 px-4 py-3.5 min-w-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
            {isNowInClass ? 'In Session' : allDone ? 'Wrap-Up' : 'Next Class'}
          </p>
          {allDone ? (
            <div className="flex items-center gap-1.5">
              <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0" />
              <p className="text-[13px] font-bold text-gray-900 truncate">All done today</p>
            </div>
          ) : isNowInClass ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <p className="text-[13px] font-bold text-gray-900 truncate">
                {sections.find(s => {
                  if (!s.meeting_time) return false
                  const [h, m] = s.meeting_time.split(':').map(Number)
                  const nowMin = now.getHours() * 60 + now.getMinutes()
                  return nowMin >= h * 60 + m && nowMin <= h * 60 + m + 55
                })?.name || 'Class'}
              </p>
            </div>
          ) : nextClass ? (
            <div>
              <p className="text-[13px] font-bold text-gray-900 truncate leading-tight">
                {nextClass.name}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {formatTime(nextClass.meeting_time)}
                {countdown && (
                  <span className="ml-1.5 text-navy-600 font-semibold">in {countdown}</span>
                )}
              </p>
            </div>
          ) : (
            <p className="text-[13px] font-bold text-gray-900">—</p>
          )}
        </div>

        {/* Classes remaining */}
        <div className="px-4 py-3.5 shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
            Remaining
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-[22px] font-bold text-gray-900 leading-none">{remaining}</span>
            <span className="text-[11px] text-gray-400 font-medium">
              {remaining === 1 ? 'class' : 'classes'}
            </span>
          </div>
        </div>


      </div>
    </div>
  )
}
