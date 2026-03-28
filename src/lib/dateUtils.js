import { addDays, format, isWeekend, parseISO, isSameDay } from 'date-fns'

// Day name -> JS getDay() index
const DAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
}

// Block schedule: A/B day alternation based on school year start
// Simple approach: count school days from a fixed epoch
const BLOCK_EPOCH = new Date('2024-09-03') // first day of 2024–25 school year (adjust as needed)

export function isADay(date) {
  const d = new Date(date)
  let schoolDays = 0
  const current = new Date(BLOCK_EPOCH)
  while (current <= d) {
    if (!isWeekend(current)) schoolDays++
    if (isSameDay(current, d)) break
    addDays(current, 1)
    current.setDate(current.getDate() + 1)
  }
  return schoolDays % 2 === 1 // odd = A-Day
}

/**
 * Given a section's meeting_days array and a list of cancelled dates,
 * find the next class date after `fromDate`.
 *
 * meeting_days examples:
 *   ["Monday", "Wednesday", "Friday"]
 *   ["Tuesday", "Thursday"]
 *   ["A-Day"]
 *   ["B-Day"]
 *   ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
 *
 * cancelledDates: string[] — ISO date strings of cancelled days
 */
export function getNextClassDate(meetingDays, cancelledDates = [], fromDate = new Date()) {
  const cancelled = new Set(cancelledDates.map(d => format(parseISO(d), 'yyyy-MM-dd')))
  let candidate = new Date(fromDate)
  candidate.setDate(candidate.getDate() + 1) // start from tomorrow

  for (let i = 0; i < 60; i++) { // look up to 60 days ahead
    const dayName = format(candidate, 'EEEE') // "Monday", "Tuesday", etc.
    const dateStr  = format(candidate, 'yyyy-MM-dd')

    if (!cancelled.has(dateStr)) {
      const isBlock = meetingDays.some(d => d === 'A-Day' || d === 'B-Day')

      if (isBlock) {
        const dayType = isADay(candidate) ? 'A-Day' : 'B-Day'
        if (meetingDays.includes(dayType)) return candidate
      } else {
        if (meetingDays.includes(dayName)) return candidate
      }
    }

    candidate = addDays(candidate, 1)
  }

  return null
}

/**
 * Returns the next class date as a formatted string, e.g. "Monday, Apr 1"
 */
export function getNextClassDateString(meetingDays, cancelledDates = [], fromDate = new Date()) {
  const d = getNextClassDate(meetingDays, cancelledDates, fromDate)
  return d ? format(d, 'EEEE, MMM d') : null
}

/**
 * Returns today's sections (those that meet today).
 */
export function getTodaysMeetingDays() {
  return [format(new Date(), 'EEEE')] // e.g. ["Friday"]
}

export function doesSectionMeetToday(meetingDays) {
  const today = format(new Date(), 'EEEE')
  const isBlock = meetingDays.some(d => d === 'A-Day' || d === 'B-Day')

  if (isBlock) {
    const dayType = isADay(new Date()) ? 'A-Day' : 'B-Day'
    return meetingDays.includes(dayType)
  }

  return meetingDays.includes(today)
}

/**
 * Given a meeting_time (HH:MM:SS string) and today's date,
 * return true if the class is currently "in session" (within the window).
 * Assumes an average class is 55 minutes.
 */
export function isClassNow(meetingTime, durationMinutes = 55) {
  if (!meetingTime) return false
  const now = new Date()
  const [h, m] = meetingTime.split(':').map(Number)
  const start = new Date(now)
  start.setHours(h, m, 0, 0)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return now >= start && now <= end
}

export function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export function todayISO() {
  return format(new Date(), 'yyyy-MM-dd')
}
