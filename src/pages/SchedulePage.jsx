import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  PlusIcon,
  TrashIcon,
  SparklesIcon,
  CameraIcon,
  XMarkIcon,
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  ArrowPathIcon,
  CheckIcon,
  LightBulbIcon,
  ChatBubbleBottomCenterTextIcon,
  BookOpenIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' }
const HOUR_COLORS = [
  'bg-blue-100 border-blue-300 text-blue-800',
  'bg-violet-100 border-violet-300 text-violet-800',
  'bg-emerald-100 border-emerald-300 text-emerald-800',
  'bg-amber-100 border-amber-300 text-amber-800',
  'bg-rose-100 border-rose-300 text-rose-800',
  'bg-cyan-100 border-cyan-300 text-cyan-800',
  'bg-orange-100 border-orange-300 text-orange-800',
]

function colorForIndex(i) {
  return HOUR_COLORS[i % HOUR_COLORS.length]
}

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const p = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${p}`
}

function timeToMinutes(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ─── Tutorial Overlay ────────────────────────────────────────────────────────

const TUTORIAL_STEPS = [
  {
    title: 'Welcome to Schedule Builder',
    body: 'This is where you build your weekly teaching schedule. Once it\'s set up, your dashboard will show today\'s classes automatically — no manual updates needed.',
    icon: null,
  },
  {
    title: 'Two ways to add classes',
    body: 'You can type your schedule out naturally (like "Algebra 9, Period 1, 8:00 AM, Mon/Wed/Fri, Room 204") or add each class manually. Either way works.',
    icon: null,
  },
  {
    title: 'AI parses it for you',
    body: 'Paste your schedule from a PDF, email, or school system and hit "Build with AI." It reads the text and builds your full schedule automatically.',
    icon: null,
  },
  {
    title: 'Your week at a glance',
    body: 'After setup, you\'ll see a color-coded weekly grid. Click any class to mark attendance, track lesson progress, or add notes.',
    icon: null,
  },
]

function TutorialOverlay({ onDone }) {
  const [step, setStep] = useState(0)
  const current = TUTORIAL_STEPS[step]
  const isLast = step === TUTORIAL_STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Progress dots */}
        <div className="flex gap-1.5 justify-center pt-5 pb-2">
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-navy-800' : 'w-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="px-7 py-5 text-center space-y-3">
          <h2 className="text-lg font-bold text-gray-900">{current.title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{current.body}</p>
        </div>

        <div className="px-7 pb-7 flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              Back
            </button>
          )}
          <button
            onClick={() => isLast ? onDone() : setStep(s => s + 1)}
            className="flex-1 py-2.5 text-sm font-semibold bg-navy-800 text-white rounded-xl hover:bg-navy-900 transition-colors"
          >
            {isLast ? "Let's build it" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AI Builder Panel ────────────────────────────────────────────────────────

function AIBuilderPanel({ onParsed, onClose }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [photoMode, setPhotoMode] = useState(false)
  const fileRef = useRef()

  const PLACEHOLDER = `Paste your schedule here, for example:

Algebra I - Period 1 - Mon/Wed/Fri - 8:00 AM - Room 204
AP Chemistry - Period 2 - Mon/Tue/Thu - 9:15 AM - Room 108
English 10 - Period 3 - Daily - 10:30 AM - Room 312
Lunch - 11:45 AM
Geometry - Period 4 - Mon/Wed/Fri - 12:45 PM - Room 204
Study Hall - Tue/Thu - 12:45 PM - Library

Or just describe it naturally — the AI will figure it out.`

  async function handleBuild() {
    if (!text.trim()) return
    setLoading(true)
    setError(null)

    try {
      const resp = await fetch('/api/parse-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.error || 'Failed to parse schedule')
      }

      const { schedule } = await resp.json()
      onParsed(schedule)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)

    try {
      const base64 = await fileToBase64(file)
      const resp = await fetch('/api/parse-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      })
      if (!resp.ok) throw new Error('Could not read schedule from photo')
      const { schedule } = await resp.json()
      onParsed(schedule)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-navy-600" />
            <h2 className="font-semibold text-gray-900">Build Schedule with AI</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setPhotoMode(false)}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              !photoMode ? 'text-navy-700 border-b-2 border-navy-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <ChatBubbleBottomCenterTextIcon className="w-4 h-4" />
            Type or paste
          </button>
          <button
            onClick={() => setPhotoMode(true)}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              photoMode ? 'text-navy-700 border-b-2 border-navy-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <CameraIcon className="w-4 h-4" />
            Photo of schedule
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!photoMode ? (
            <textarea
              className="w-full border border-gray-200 rounded-xl p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-navy-300 text-gray-700 placeholder:text-gray-300 placeholder:font-sans"
              rows={9}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={PLACEHOLDER}
            />
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-navy-300 hover:bg-navy-50 transition-all"
            >
              <CameraIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600">Tap to take a photo or upload an image</p>
              <p className="text-xs text-gray-400 mt-1">Works with printed schedules, PDFs saved as images, screenshots</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhoto}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex items-start gap-2 bg-navy-50 rounded-xl p-3">
            <LightBulbIcon className="w-4 h-4 text-navy-600 shrink-0 mt-0.5" />
            <p className="text-xs text-navy-700">
              Include class name, days, and time for the best results. Room numbers and period labels are optional but helpful.
            </p>
          </div>

          {!photoMode && (
            <button
              onClick={handleBuild}
              disabled={loading || !text.trim()}
              className="w-full py-3 bg-navy-800 text-white text-sm font-semibold rounded-xl hover:bg-navy-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  Parsing your schedule...
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4" />
                  Build with AI
                </>
              )}
            </button>
          )}

          {loading && photoMode && (
            <div className="flex items-center justify-center gap-2 text-sm text-navy-700">
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
              Reading your schedule...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Parsed Schedule Review ───────────────────────────────────────────────────

function ParsedScheduleReview({ parsed, onConfirm, onRetry }) {
  const [items, setItems] = useState(parsed)

  function removeItem(i) {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateItem(i, field, value) {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Review your schedule</h2>
            <p className="text-xs text-gray-400 mt-0.5">Edit or remove anything before saving</p>
          </div>
          <span className="text-xs bg-navy-100 text-navy-700 font-medium px-2.5 py-1 rounded-full">
            {items.length} class{items.length !== 1 ? 'es' : ''}
          </span>
        </div>

        <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
          {items.map((item, i) => (
            <div key={i} className={`px-6 py-4 flex items-start gap-3`}>
              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${colorForIndex(i).split(' ')[0].replace('bg-', 'bg-').replace('100', '400')}`} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <input
                  className="font-medium text-sm text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-navy-400 focus:outline-none w-full"
                  value={item.name}
                  onChange={e => updateItem(i, 'name', e.target.value)}
                />
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <ClockIcon className="w-3.5 h-3.5" />
                    {item.days?.join(', ')} · {formatTime(item.time) || item.time}
                  </span>
                  {item.room && (
                    <span className="flex items-center gap-1">
                      <MapPinIcon className="w-3.5 h-3.5" />
                      Room {item.room}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeItem(i)}
                className="text-gray-300 hover:text-red-400 p-1 transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onRetry}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
          >
            Try again
          </button>
          <button
            onClick={() => onConfirm(items)}
            disabled={items.length === 0}
            className="flex-1 py-2.5 text-sm font-semibold bg-navy-800 text-white rounded-xl hover:bg-navy-900 disabled:opacity-40"
          >
            Save schedule
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Week Grid ─────────────────────────────────────────────────────────────

function WeekGrid({ sections, courses, onDeleteSection }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  // Build a map: day -> sorted sections
  const byDay = {}
  WEEKDAYS.forEach(d => { byDay[d] = [] })

  sections.forEach(section => {
    const days = section.meeting_days || []
    days.forEach(day => {
      if (byDay[day]) byDay[day].push(section)
    })
  })

  WEEKDAYS.forEach(d => {
    byDay[d].sort((a, b) => timeToMinutes(a.meeting_time) - timeToMinutes(b.meeting_time))
  })

  const courseColorMap = {}
  courses.forEach((c, i) => { courseColorMap[c.id] = colorForIndex(i) })

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="min-w-[600px] grid grid-cols-5 gap-2">
        {WEEKDAYS.map(day => {
          const isToday = day === today
          const daySections = byDay[day]

          return (
            <div key={day} className={`rounded-xl overflow-hidden border ${isToday ? 'border-navy-300 shadow-sm' : 'border-gray-200'}`}>
              {/* Day header */}
              <div className={`px-3 py-2 text-center text-xs font-semibold ${
                isToday ? 'bg-navy-800 text-white' : 'bg-gray-50 text-gray-500'
              }`}>
                {DAY_SHORT[day]}
              </div>

              {/* Classes */}
              <div className="p-2 space-y-1.5 min-h-24">
                {daySections.length === 0 ? (
                  <div className="h-full flex items-center justify-center py-4">
                    <span className="text-xs text-gray-300">—</span>
                  </div>
                ) : (
                  daySections.map(section => {
                    const colorClass = courseColorMap[section.course_id] || HOUR_COLORS[0]
                    return (
                      <div
                        key={section.id + day}
                        className={`rounded-lg border px-2 py-1.5 text-xs ${colorClass} group relative`}
                      >
                        <p className="font-semibold truncate leading-tight">{section.name}</p>
                        {section.meeting_time && (
                          <p className="opacity-70 mt-0.5">
                            {formatTime(section.meeting_time)}{section.end_time ? ` \u2013 ${formatTime(section.end_time)}` : ''}
                          </p>
                        )}
                        {section.room && (
                          <p className="opacity-60">Rm {section.room}</p>
                        )}
                        <button
                          onClick={() => onDeleteSection(section.id)}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-current hover:opacity-100"
                        >
                          <XMarkIcon className="w-3 h-3" />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Manual Add Form ─────────────────────────────────────────────────────────

function AddClassModal({ courses, onClose, onCreated }) {
  const [form, setForm] = useState({
    course_id:    courses[0]?.id || '',
    name:         '',
    meeting_days: [],
    meeting_time: '',
    end_time:     '',
    room:         '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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
    setError(null)
    const { data, error: dbError } = await supabase
      .from('sections')
      .insert({ ...form, meeting_time: form.meeting_time || null, end_time: form.end_time || null })
      .select()
      .single()
    setLoading(false)
    if (dbError) {
      setError(dbError.message || 'Failed to add class')
      console.error('Add class error:', dbError)
    } else if (data) {
      onCreated(data)
      onClose()
    }
  }

  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day']

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/40">
      <form
        onSubmit={handleCreate}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm space-y-4 p-6"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Add a class</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={loading}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div>
          <label className="label">Course</label>
          <select
            className="input"
            value={form.course_id}
            onChange={e => setForm(f => ({ ...f, course_id: e.target.value }))}
            required
          >
            {courses.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Section name</label>
          <input
            className="input"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Period 1, 6A, Block B..."
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label">Meeting days</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  form.meeting_days.includes(day)
                    ? 'bg-navy-800 text-white border-navy-700'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {day.length > 3 ? day.slice(0, 3) : day}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Start time</label>
            <input
              type="time"
              className="input"
              value={form.meeting_time}
              onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">End time</label>
            <input
              type="time"
              className="input"
              value={form.end_time}
              onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Room</label>
            <input
              className="input"
              value={form.room}
              onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
              placeholder="204"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="flex-1 py-2.5 bg-navy-800 text-white text-sm font-semibold rounded-xl hover:bg-navy-900 disabled:opacity-40"
            disabled={loading || !form.name || !form.course_id}
          >
            {loading ? 'Adding...' : 'Add class'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── No Courses State ─────────────────────────────────────────────────────────

function NoCourses({ onNavigate }) {
  return (
    <div className="card p-10 text-center">
      <BookOpenIcon className="w-10 h-10 text-gray-300 mx-auto mb-4" />
      <h3 className="font-semibold text-gray-900 mb-2">Add your courses first</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        Before building your schedule, add the courses you teach in the Curriculum section.
      </p>
      <button
        onClick={onNavigate}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-navy-800 text-white text-sm font-semibold rounded-xl hover:bg-navy-900"
      >
        Go to Curriculum
        <ChevronRightIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── Course Schedule Card ──────────────────────────────────────────────────────

function CourseScheduleCard({ course, sections, colorClass, onAddSection, onDeleteSection, onNavigateCourse }) {
  const [expanded, setExpanded] = useState(true)
  const [showAdd, setShowAdd]   = useState(false)

  return (
    <div className="card overflow-hidden">
      {/* Course header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`w-3 h-3 rounded-full shrink-0 ${colorClass}`} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900">{course.name}</p>
          <p className="text-xs text-gray-400">
            {course.subject}{course.grade_level ? ` · Grade ${course.grade_level}` : ''}
            {' · '}{sections.length} section{sections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onNavigateCourse(course.id)}
            className="text-xs text-navy-700 font-medium hover:underline"
          >
            View curriculum
          </button>
          <ChevronRightIcon className={`w-4 h-4 text-gray-300 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Section rows */}
          {sections.length === 0 && !showAdd && (
            <div className="px-4 py-4 text-center">
              <p className="text-xs text-gray-400 mb-3">No class periods added yet for this course.</p>
            </div>
          )}

          {sections.map(section => (
            <div key={section.id} className="flex items-center px-4 py-3 gap-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{section.name}</p>
                <div className="flex gap-3 mt-0.5 flex-wrap">
                  {section.meeting_days?.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {section.meeting_days.map(d => d.slice(0, 3)).join(', ')}
                    </span>
                  )}
                  {section.meeting_time && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <ClockIcon className="w-3 h-3" />
                      {formatTime(section.meeting_time)}{section.end_time ? ` \u2013 ${formatTime(section.end_time)}` : ''}
                    </span>
                  )}
                  {section.room && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <MapPinIcon className="w-3 h-3" />
                      Rm {section.room}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => onDeleteSection(section.id)}
                className="text-gray-300 hover:text-red-400 p-1 transition-colors"
                title="Remove section"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Inline add section form */}
          {showAdd ? (
            <InlineAddSection
              courseId={course.id}
              onCreated={section => {
                onAddSection(section)
                setShowAdd(false)
              }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-800 transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Add class period
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Inline Add Section Form ───────────────────────────────────────────────────

function InlineAddSection({ courseId, onCreated, onCancel }) {
  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day']
  const [form, setForm] = useState({ name: '', meeting_days: [], meeting_time: '', end_time: '', room: '', use_different_times: false })
  const [timeSections, setTimeSections] = useState([{ meeting_time: '', end_time: '' }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function toggleDay(day) {
    setForm(f => ({
      ...f,
      meeting_days: f.meeting_days.includes(day)
        ? f.meeting_days.filter(d => d !== day)
        : [...f.meeting_days, day],
    }))
  }

  function addTimeSlot() {
    setTimeSections(prev => [...prev, { meeting_time: '', end_time: '' }])
  }

  function removeTimeSlot(idx) {
    setTimeSections(prev => prev.filter((_, i) => i !== idx))
  }

  function updateTimeSlot(idx, field, value) {
    setTimeSections(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // If using different times per day, create multiple sections
    if (form.use_different_times && timeSections.length > 1) {
      const createdSections = []
      for (let i = 0; i < timeSections.length; i++) {
        const { meeting_time, end_time } = timeSections[i]
        const { data, error: dbError } = await supabase
          .from('sections')
          .insert({
            course_id: courseId,
            name: `${form.name} (${i + 1})`,
            meeting_days: form.meeting_days,
            meeting_time: meeting_time || null,
            end_time: end_time || null,
            room: form.room || null,
          })
          .select()
          .single()
        if (dbError) { console.error('Error creating section:', dbError); continue }
        if (data) { createdSections.push(data) }
      }
      setLoading(false)
      if (createdSections.length > 0) {
        onCreated(createdSections[0])
      } else {
        setError('Failed to create sections')
      }
    } else {
      // Single time slot
      const { data, error: dbError } = await supabase
        .from('sections')
        .insert({
          course_id: courseId,
          name: form.name,
          meeting_days: form.meeting_days,
          meeting_time: form.meeting_time || null,
          end_time: form.end_time || null,
          room: form.room || null,
        })
        .select()
        .single()
      setLoading(false)
      if (dbError) {
        setError(dbError.message || 'Failed to add section')
      } else if (data) {
        onCreated(data)
      }
    }
  }

  return (
    <form onSubmit={handleCreate} className="px-4 py-4 border-t border-gray-100 bg-navy-50/40 space-y-3">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">New class period</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Period name</label>
          <input
            className="input text-sm"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Period 1, Block A, 6th hour..."
            required
            autoFocus
          />
        </div>
        <div>
          <label className="label text-xs">Room</label>
          <input
            className="input text-sm"
            value={form.room}
            onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
            placeholder="204"
          />
        </div>
      </div>

      <div>
        <label className="label text-xs">Meeting days</label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DAYS.map(day => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                form.meeting_days.includes(day)
                  ? 'bg-navy-800 text-white border-navy-700'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {day.length > 3 ? day.slice(0, 3) : day}
            </button>
          ))}
        </div>
      </div>

      {/* Toggle for different times */}
      <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200">
        <input
          type="checkbox"
          id="use_different_times"
          checked={form.use_different_times}
          onChange={e => setForm(f => ({ ...f, use_different_times: e.target.checked }))}
          className="w-4 h-4 rounded accent-navy-700"
        />
        <label htmlFor="use_different_times" className="text-xs font-medium text-gray-700 cursor-pointer">
          Different times per day
        </label>
      </div>

      {/* Time slots */}
      {!form.use_different_times ? (
        <div className="flex items-end gap-3">
          <div className="w-36">
            <label className="label text-xs">Start time</label>
            <input
              type="time"
              className="input text-sm"
              value={form.meeting_time}
              onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}
            />
          </div>
          <div className="w-36">
            <label className="label text-xs">End time</label>
            <input
              type="time"
              className="input text-sm"
              value={form.end_time}
              onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2 bg-white p-3 rounded-lg border border-gray-200">
          {timeSections.map((ts, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="label text-xs">Start</label>
                <input
                  type="time"
                  className="input text-sm"
                  value={ts.meeting_time}
                  onChange={e => updateTimeSlot(idx, 'meeting_time', e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="label text-xs">End</label>
                <input
                  type="time"
                  className="input text-sm"
                  value={ts.end_time}
                  onChange={e => updateTimeSlot(idx, 'end_time', e.target.value)}
                />
              </div>
              {timeSections.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTimeSlot(idx)}
                  className="text-gray-400 hover:text-red-400 p-1.5 transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addTimeSlot}
            className="flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-800 transition-colors w-full justify-center py-1.5 border border-dashed border-navy-200 rounded-lg"
          >
            <PlusIcon className="w-3 h-3" />
            Add another time
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !form.name || form.meeting_days.length === 0}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-navy-800 rounded-lg hover:bg-navy-900 disabled:opacity-40"
        >
          {loading ? 'Adding...' : 'Add period'}
        </button>
      </div>
    </form>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { profile } = useAuth()
  const [courses, setCourses]   = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showTutorial, setShowTutorial]   = useState(false)
  const [showAIBuilder, setShowAIBuilder] = useState(false)
  const [parsedSchedule, setParsedSchedule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const nav = useNavigate()

  useEffect(() => { document.title = 'Schedule | Cacio EDU' }, [])

  useEffect(() => {
    if (profile) {
      setLoadError(false)
      loadAll()
      const timeout = setTimeout(() => {
        setLoading(prev => {
          if (prev) { setLoadError(true); return false }
          return prev
        })
      }, 10000)
      return () => clearTimeout(timeout)
    }
  }, [profile])

  async function loadAll() {
    const { data: courseData } = await supabase
      .from('courses')
      .select('id, name, subject, grade_level')
      .eq('teacher_id', profile.id)
      .order('name')

    setCourses(courseData || [])

    if (!courseData?.length) {
      setLoading(false)
      return
    }

    const courseIds = courseData.map(c => c.id)
    const { data: sectionData } = await supabase
      .from('sections')
      .select('*')
      .in('course_id', courseIds)
      .order('meeting_time', { ascending: true })

    setSections(sectionData || [])
    setLoading(false)

    // Show tutorial on first visit (no sections yet)
    if (!sectionData?.length) {
      const seen = localStorage.getItem('schedule_tutorial_seen')
      if (!seen) setShowTutorial(true)
    }
  }

  function handleTutorialDone() {
    localStorage.setItem('schedule_tutorial_seen', '1')
    setShowTutorial(false)
    setShowAIBuilder(true)
  }

  async function handleParsedConfirm(items) {
    setSaving(true)

    try {
      const createdSections = []

      for (const item of items) {
        if (item.type === 'assignment') continue

        let courseId = courses.find(c =>
          c.name.toLowerCase().includes(item.name.toLowerCase()) ||
          item.name.toLowerCase().includes(c.name.toLowerCase())
        )?.id

        if (!courseId) {
          const { data: newCourse, error: courseError } = await supabase
            .from('courses')
            .insert({
              name:        item.name,
              subject:     item.subject || 'General',
              grade_level: item.grade || '',
              teacher_id:  profile.id,
              school_id:   profile.school_id,
            })
            .select('id, name, subject, grade_level')
            .single()

          if (courseError) { console.error('Error creating course:', courseError); continue }
          if (newCourse) { setCourses(prev => [...prev, newCourse]); courseId = newCourse.id }
        }

        if (!courseId) continue

        const { data: newSection, error: sectionError } = await supabase
          .from('sections')
          .insert({
            course_id:    courseId,
            name:         item.period || item.name,
            meeting_days: item.days || [],
            meeting_time: item.time || null,
            room:         item.room || null,
          })
          .select()
          .single()

        if (sectionError) { console.error('Error creating section:', sectionError); continue }
        if (newSection) { createdSections.push(newSection); setSections(prev => [...prev, newSection]) }
      }

      if (createdSections.length > 0) {
        setParsedSchedule(null)
      } else {
        alert('Could not create any classes. Check console for errors.')
      }
    } catch (e) {
      console.error('Error saving schedule:', e)
      alert('Error saving schedule: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteSection(id) {
    if (!confirm('Remove this class period?')) return
    await supabase.from('sections').delete().eq('id', id)
    setSections(prev => prev.filter(s => s.id !== id))
  }

  // Color map for courses
  const courseColorMap = {}
  courses.forEach((c, i) => {
    const cls = colorForIndex(i).split(' ')
    // extract e.g. bg-blue-400
    courseColorMap[c.id] = cls[0].replace('100', '400')
  })

  const totalSections = sections.length

  return (
    <div className="space-y-5">
      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDone={handleTutorialDone} />}

      {/* AI Builder panel */}
      {showAIBuilder && (
        <AIBuilderPanel
          onParsed={parsed => { setShowAIBuilder(false); setParsedSchedule(parsed) }}
          onClose={() => setShowAIBuilder(false)}
        />
      )}

      {/* Review parsed schedule */}
      {parsedSchedule && (
        <ParsedScheduleReview
          parsed={parsedSchedule}
          onConfirm={handleParsedConfirm}
          onRetry={() => { setParsedSchedule(null); setShowAIBuilder(true) }}
        />
      )}

      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-3">
            <ArrowPathIcon className="w-5 h-5 text-navy-700 animate-spin" />
            <span className="text-sm font-medium text-gray-700">Saving your schedule...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Schedule</h1>
          {!loading && totalSections > 0 && (
            <p className="text-sm text-gray-400 mt-0.5">
              {totalSections} period{totalSections !== 1 ? 's' : ''} across {courses.length} course{courses.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {!loading && courses.length > 0 && (
          <button
            onClick={() => setShowAIBuilder(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-navy-800 text-white text-xs font-semibold rounded-xl hover:bg-navy-900 transition-colors shrink-0"
          >
            <SparklesIcon className="w-3.5 h-3.5" />
            AI Builder
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 bg-gray-200 rounded-full" />
                <div className="h-4 bg-gray-100 rounded w-1/3" />
              </div>
              <div className="space-y-2 pl-6">
                <div className="h-3 bg-gray-100 rounded w-1/2" />
                <div className="h-3 bg-gray-100 rounded w-2/5" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="card p-8 text-center">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Couldn't load your schedule</h3>
          <p className="text-sm text-gray-400 mb-4">There was a problem connecting. Try refreshing.</p>
          <button
            onClick={() => { setLoadError(false); setLoading(true); loadAll() }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-navy-800 text-white text-sm font-semibold rounded-xl hover:bg-navy-900"
          >
            Try again
          </button>
        </div>
      ) : courses.length === 0 ? (
        <NoCourses onNavigate={() => nav('/curriculum')} />
      ) : (
        <div className="space-y-3">
          {/* Explainer for first-time users */}
          {totalSections === 0 && (
            <div className="card p-5 border border-navy-100 bg-navy-50/50 flex items-start gap-3">
              <SparklesIcon className="w-5 h-5 text-navy-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-navy-900">Add class periods to each course</p>
                <p className="text-xs text-navy-700 mt-0.5">
                  Each course can have multiple periods (e.g. AP Gov can have Period 1, Period 3, and Period 5). Click "Add class period" inside each course, or use AI Builder to import everything at once.
                </p>
              </div>
            </div>
          )}

          {/* One card per course */}
          {courses.map((course, ci) => {
            const courseSections = sections
              .filter(s => s.course_id === course.id)
              .sort((a, b) => (a.meeting_time || '').localeCompare(b.meeting_time || ''))
            return (
              <CourseScheduleCard
                key={course.id}
                course={course}
                sections={courseSections}
                colorClass={courseColorMap[course.id]}
                onAddSection={section => setSections(prev => [...prev, section])}
                onDeleteSection={deleteSection}
                onNavigateCourse={id => nav(`/courses/${id}`)}
              />
            )
          })}

          {/* Week grid — collapsed by default, expandable */}
          {totalSections > 0 && (
            <WeekGridCollapsible sections={sections} courses={courses} onDeleteSection={deleteSection} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Collapsible Week Grid ──────────────────────────────────────────────────────

function WeekGridCollapsible({ sections, courses, onDeleteSection }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>Week view</span>
        <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 p-4 overflow-hidden">
          <WeekGrid sections={sections} courses={courses} onDeleteSection={onDeleteSection} />
        </div>
      )}
    </div>
  )
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
