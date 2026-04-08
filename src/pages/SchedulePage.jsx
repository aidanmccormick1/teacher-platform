import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
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
  CalendarDaysIcon,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/20 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom-8">
        {/* Progress dots */}
        <div className="flex gap-2 justify-center pt-8 pb-2">
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === step ? 'w-8 bg-navy-800' : 'w-2 bg-gray-100'
              }`}
            />
          ))}
        </div>

        <div className="px-10 py-6 text-center space-y-4">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">{current.title}</h2>
          <p className="text-sm font-medium text-gray-500 leading-relaxed">{current.body}</p>
        </div>

        <div className="px-10 pb-10 flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-navy-800 transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={() => isLast ? onDone() : setStep(s => s + 1)}
            className="flex-1 py-4 text-xs font-black uppercase tracking-widest bg-navy-800 text-white rounded-2xl hover:bg-navy-900 transition-all shadow-xl shadow-navy-200 active:scale-95"
          >
            {isLast ? "Launch System" : 'Continue'}
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

  async function handleBuild() {
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/ai/parse-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!resp.ok) throw new Error('Failed to parse schedule')
      const { schedule } = await resp.json()
      onParsed(schedule)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-navy-950/20 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden animate-in slide-in-from-bottom-8">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <SparklesIcon className="w-5 h-5 text-amber-500" />
              <h2 className="text-xl font-semibold text-gray-900">Import Schedule</h2>
            </div>
            <p className="text-xs text-gray-400">Paste text or upload an image</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 transition-all">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="relative group">
            <textarea
              className="input min-h-[200px] p-5 text-sm font-medium leading-relaxed bg-gray-50/50 border-gray-200 focus:bg-white resize-none"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste your schedule here (periods, times, rooms)... or describe your week in plain English."
            />
            <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
               <span className="text-[10px] font-bold text-gray-400">GPT-5.4 Ready</span>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 flex items-start gap-3 animate-in shake">
               <ExclamationTriangleIcon className="w-5 h-5 text-rose-500 shrink-0" />
               <p className="text-xs font-bold text-rose-700">{error}</p>
            </div>
          )}

          <div className="flex items-start gap-4 p-5 rounded-2xl bg-navy-50/50 border border-navy-100/50">
            <LightBulbIcon className="w-6 h-6 text-navy-600 shrink-0" />
            <div>
               <p className="text-[11px] font-black text-navy-900 uppercase tracking-widest mb-1">Pro Tip</p>
               <p className="text-xs text-navy-700/70 leading-relaxed font-medium">Paste anything: emails, PDF text, or handwritten notes captured as text. Our AI handles complex block schedules effortlessly.</p>
            </div>
          </div>

          <button
            onClick={handleBuild}
            disabled={loading || !text.trim()}
            className="btn-primary w-full py-5 shadow-xl shadow-navy-200 active:scale-95 disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                Synthesizing Schedule...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <SparklesIcon className="w-5 h-5" />
                Build My Schedule
              </span>
            )}
          </button>
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
                            {formatTime(section.meeting_time)}{section.end_time ? ` – ${formatTime(section.end_time)}` : ''}
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
    start_date:   '',
    end_date:     '',
    room:         '',
    day_times:    {},
    use_per_day:  false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day']

  function toggleDay(day) {
    setForm(f => ({
      ...f,
      meeting_days: f.meeting_days.includes(day)
        ? f.meeting_days.filter(d => d !== day)
        : [...f.meeting_days, day],
    }))
  }

  function setDayTimeField(day, field, value) {
    setForm(f => ({
      ...f,
      day_times: {
        ...f.day_times,
        [day]: { ...(f.day_times[day] || {}), [field]: value },
      },
    }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const sectionData = {
      course_id:    form.course_id,
      name:         form.name,
      meeting_days: form.meeting_days,
      meeting_time: form.use_per_day ? null : (form.meeting_time || null),
      end_time:     form.use_per_day ? null : (form.end_time || null),
      start_date:   form.start_date || null,
      end_date:     form.end_date || null,
      day_times:    form.use_per_day ? form.day_times : null,
      room:         form.room || null,
    }
    
    // Attempt full v2 insert
    let { data, error: dbError } = await supabase
      .from('sections')
      .insert(sectionData)
      .select()
      .single()
      
    // Fallback if schema is out of date (missing end_date/start_date/day_times)
    if (dbError && (dbError.message?.includes('column') || dbError.message?.includes('schema cache'))) {
      console.warn('TeacherOS: Upgrading to v1 fallback insert due to missing columns.')
      const fallbackData = {
        course_id:    form.course_id,
        name:         form.name,
        meeting_days: form.meeting_days,
        meeting_time: form.meeting_time || null,
        room:         form.room || null,
      }
      const { data: d2, error: e2 } = await supabase
        .from('sections')
        .insert(fallbackData)
        .select()
        .single()
      data = d2
      dbError = e2
    }

    setLoading(false)
    if (dbError) {
      setError(dbError.message || 'Failed to add class')
      console.error('Add class error:', dbError)
    } else if (data) {
      onCreated(data)
      onClose()
    }
  }

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

        <div className="grid grid-cols-2 gap-3">
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
            <label className="label">Room</label>
            <input
              className="input"
              value={form.room}
              onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
              placeholder="204"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Term Start Date</label>
            <input
              type="date"
              className="input"
              value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Term End Date</label>
            <input
              type="date"
              className="input"
              value={form.end_date}
              onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
              required
            />
          </div>
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
                {DAY_SHORT[day] || (day.length > 3 ? day.slice(0, 3) : day)}
              </button>
            ))}
          </div>
        </div>

        {/* Time section — matches SectionsPanel in CoursePage */}
        {form.meeting_days.length > 0 && (
          <div className="space-y-2">
            {form.meeting_days.length > 1 && (
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <div
                  className={`rounded-full transition-colors relative ${form.use_per_day ? 'bg-navy-500' : 'bg-gray-200'}`}
                  style={{ height: '18px', width: '32px' }}
                  onClick={() => setForm(f => ({ ...f, use_per_day: !f.use_per_day }))}
                >
                  <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${form.use_per_day ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-xs text-gray-500">Different times per day</span>
              </label>
            )}

            {form.use_per_day && form.meeting_days.length > 1 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                  <span className="w-10" />
                  <span className="w-32">Start</span>
                  <span className="w-32">End</span>
                </div>
                {form.meeting_days.map(day => (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-600 w-10">{DAY_SHORT[day] || day}</span>
                    <input
                      type="time"
                      className="input text-sm w-32"
                      value={form.day_times[day]?.start || ''}
                      onChange={e => setDayTimeField(day, 'start', e.target.value)}
                    />
                    <input
                      type="time"
                      className="input text-sm w-32"
                      value={form.day_times[day]?.end || ''}
                      onChange={e => setDayTimeField(day, 'end', e.target.value)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label">Start time</label>
                  <input
                    type="time"
                    className="input"
                    value={form.meeting_time}
                    onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="label">End time</label>
                  <input
                    type="time"
                    className="input"
                    value={form.end_time}
                    onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                  />
                </div>
              </div>
            )}
          </div>
        )}

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
                      {formatTime(section.meeting_time)}{section.end_time ? ` – ${formatTime(section.end_time)}` : ''}
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
  const [form, setForm] = useState({
    name: '',
    meeting_days: [],
    meeting_time: '',
    end_time: '',
    start_date: '',
    end_date: '',
    room: '',
    day_times: {},
    use_per_day: false,
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

  function setDayTimeField(day, field, value) {
    setForm(f => ({
      ...f,
      day_times: {
        ...f.day_times,
        [day]: { ...(f.day_times[day] || {}), [field]: value },
      },
    }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const sectionData = {
      course_id: courseId,
      name: form.name,
      meeting_days: form.meeting_days,
      meeting_time: form.use_per_day ? null : (form.meeting_time || null),
      end_time: form.use_per_day ? null : (form.end_time || null),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      day_times: form.use_per_day ? form.day_times : null,
      room: form.room || null,
    }

    let { data, error: dbError } = await supabase
      .from('sections')
      .insert(sectionData)
      .select()
      .single()

    setLoading(false)
    if (dbError) {
      if (dbError.message?.includes('column') || dbError.message?.includes('schema cache')) {
        console.warn('TeacherOS: Upgrading to v1 fallback insert for InlineAdd due to missing columns.')
        const fallback = {
          course_id: courseId,
          name: form.name,
          meeting_days: form.meeting_days,
          meeting_time: form.meeting_time || null,
          room: form.room || null,
        }
        const { data: d2, error: e2 } = await supabase.from('sections').insert(fallback).select().single()
        if (e2) {
          setError(e2.message || 'Failed to add section')
        } else if (d2) {
          onCreated(d2)
        }
      } else {
        setError(dbError.message || 'Failed to add section')
      }
    } else if (data) {
      onCreated(data)
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
            placeholder="Period 1, Block A..."
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Term Start Date</label>
          <input
            type="date"
            className="input text-sm"
            value={form.start_date}
            onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="label text-xs">Term End Date</label>
          <input
            type="date"
            className="input text-sm"
            value={form.end_date}
            onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
            required
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

      {/* Time section */}
      {form.meeting_days.length > 0 && (
        <div className="space-y-2">
          {form.meeting_days.length > 1 && (
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <div
                className={`w-8 h-4.5 rounded-full transition-colors relative ${form.use_per_day ? 'bg-navy-500' : 'bg-gray-200'}`}
                style={{ height: '18px', width: '32px' }}
                onClick={() => setForm(f => ({ ...f, use_per_day: !f.use_per_day }))}
              >
                <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${form.use_per_day ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-gray-500">Different times per day</span>
            </label>
          )}

          {form.use_per_day && form.meeting_days.length > 1 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                <span className="w-10" />
                <span className="w-32">Start</span>
                <span className="w-32">End</span>
              </div>
              {form.meeting_days.map(day => (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 w-10">{DAY_SHORT[day] || day}</span>
                  <input
                    type="time"
                    className="input text-sm w-32"
                    value={form.day_times[day]?.start || ''}
                    onChange={e => setDayTimeField(day, 'start', e.target.value)}
                  />
                  <input
                    type="time"
                    className="input text-sm w-32"
                    value={form.day_times[day]?.end || ''}
                    onChange={e => setDayTimeField(day, 'end', e.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : (
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
          )}
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

// ─── Holidays Modal ────────────────────────────────────────────────────────
function HolidaysModal({ onClose }) {
  const { profile } = useAuth()
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    if (profile) loadHolidays()
  }, [profile])

  async function loadHolidays() {
    setLoading(true)
    const { data } = await supabase
      .from('school_holidays')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('date', { ascending: true })
    setHolidays(data || [])
    setLoading(false)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!date || !name) return
    const { data } = await supabase
      .from('school_holidays')
      .insert({ teacher_id: profile.id, date, name })
      .select()
      .single()
    if (data) {
      setHolidays(prev => [...prev, data].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()))
      setName('')
      setDate('')
    }
  }

  async function handleDelete(id) {
    await supabase.from('school_holidays').delete().eq('id', id)
    setHolidays(prev => prev.filter(h => h.id !== id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-gray-900">Manage Holidays & PD Days</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleAdd} className="flex gap-2 items-end shrink-0 py-2">
          <div className="flex-1">
            <label className="label text-xs">Date</label>
            <input type="date" required className="input text-sm" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label text-xs">Holiday Name</label>
            <input required className="input text-sm" placeholder="e.g. Winter Break" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary py-2 px-3 text-sm h-[38px]">+</button>
        </form>
        <div className="flex-1 overflow-y-auto min-h-[200px] border-t border-gray-100 pt-3">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-4">Loading...</p>
          ) : holidays.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No holidays added yet.</p>
          ) : (
            <ul className="space-y-2 pb-2">
              {holidays.map(h => (
                <li key={h.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{h.name}</p>
                    <p className="text-xs text-gray-500">{new Date(h.date).toLocaleDateString(undefined, { timeZone: 'UTC' })}</p>
                  </div>
                  <button onClick={() => handleDelete(h.id)} className="text-gray-400 hover:text-red-500 p-1">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function SchemaUpdateAdvisory({ onDismiss }) {
  const [copied, setCopied] = useState(false)
  const SQL = `ALTER TABLE public.sections 
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE,
ADD COLUMN IF NOT EXISTS day_times JSONB;`

  function handleCopy() {
    navigator.clipboard.writeText(SQL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="card p-8 border-amber-100 bg-amber-50/50 flex flex-col md:flex-row items-start gap-6 animate-in zoom-in-95">
      <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0 shadow-sm shadow-amber-200">
        <ExclamationTriangleIcon className="w-6 h-6 text-amber-600" />
      </div>
      <div className="flex-1 space-y-4">
        <div>
          <h3 className="text-sm font-black text-amber-900 uppercase tracking-widest mb-1">Database Update Required</h3>
          <p className="text-xs text-amber-800 leading-relaxed font-medium">
            Some core columns are missing in your Supabase project (likely from an earlier v1 setup).
            To enable full **Term Pacing** and **Block Scheduling**, please run the SQL below in your Supabase SQL Editor.
          </p>
        </div>

        <div className="relative group">
          <pre className="bg-navy-950 text-cyan-400 text-[11px] leading-relaxed rounded-2xl p-6 overflow-x-auto whitespace-pre-wrap border border-navy-900 shadow-xl">
            {SQL}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-4 right-4 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-navy-800 text-white hover:bg-navy-700 transition-all shadow-lg text-white"
          >
            {copied ? '✓ Copied' : 'Copy SQL'}
          </button>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-[10px] font-bold text-amber-600/60 flex items-center gap-2">
             <LightBulbIcon className="w-3.5 h-3.5" />
             Safe Mode enabled — App will still function but dates won't save.
          </p>
          <button onClick={onDismiss} className="text-[10px] font-black uppercase tracking-widest text-amber-700/50 hover:text-amber-800">
             Dismiss for now
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SchedulePage() {
  const { profile } = useAuth()
  const [courses, setCourses]   = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showTutorial, setShowTutorial]   = useState(false)
  const [showAIBuilder, setShowAIBuilder] = useState(false)
  const [showHolidays, setShowHolidays]   = useState(false)
  const [parsedSchedule, setParsedSchedule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [schemaError, setSchemaError] = useState(false)
  const [dismissSchemaError, setDismissSchemaError] = useState(false)
  const navigate = useNavigate()

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
    const { data: sectionData, error: sErr } = await supabase
      .from('sections')
      .select('*')
      .in('course_id', courseIds)
      .order('meeting_time', { ascending: true })

    if (sErr) {
      if (sErr.message?.includes('column') || sErr.message?.includes('schema cache')) {
        setSchemaError(true)
      } else {
        setLoadError(true)
      }
    }
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
    <div className="space-y-8 animate-in pb-24">
      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDone={handleTutorialDone} />}

      {/* AI Builder panel */}
      {showAIBuilder && (
        <AIBuilderPanel
          onParsed={parsed => { setShowAIBuilder(false); setParsedSchedule(parsed) }}
          onClose={() => setShowAIBuilder(false)}
        />
      )}

      {/* Holidays modal */}
      {showHolidays && (
        <HolidaysModal onClose={() => setShowHolidays(false)} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/20 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] px-10 py-8 shadow-2xl flex items-center gap-4 animate-in zoom-in-95">
            <ArrowPathIcon className="w-6 h-6 text-navy-800 animate-spin" />
            <span className="text-sm font-medium text-gray-700">Saving schedule...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2 border-b border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Schedule</h1>
          <p className="text-sm text-gray-400">
            {!loading ? `${totalSections} class ${totalSections === 1 ? 'period' : 'periods'}` : 'Loading...'}
          </p>
        </div>

        {!loading && courses.length > 0 && (
          <div className="flex items-center gap-3">
             <button
              onClick={() => setShowHolidays(true)}
              className="p-3 rounded-2xl bg-white border border-gray-100 text-gray-400 hover:text-navy-800 transition-all shadow-sm"
              title="Manage Holidays"
            >
              <CalendarDaysIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowAIBuilder(true)}
              className="btn-primary px-8 shadow-xl shadow-navy-100"
            >
              <SparklesIcon className="w-4 h-4 mr-2" />
              Sync with AI
            </button>
          </div>
        )}
      </header>

      {schemaError && !dismissSchemaError && (
        <SchemaUpdateAdvisory onDismiss={() => setDismissSchemaError(true)} />
      )}

      {loading ? (
        <div className="grid grid-cols-5 gap-4 animate-pulse">
           {[1,2,3,4,5].map(i => <div key={i} className="h-64 bg-gray-50 rounded-3xl" />)}
        </div>
      ) : loadError ? (
        <div className="card p-12 text-center border-rose-100 bg-rose-50/50">
           <ExclamationTriangleIcon className="w-12 h-12 text-rose-500 mx-auto mb-4" />
           <h2 className="text-lg font-semibold text-rose-900 mb-2">Failed to load schedule</h2>
           <button onClick={() => { setLoadError(false); setLoading(true); loadAll() }} className="btn-primary bg-rose-600 hover:bg-rose-700">Retry</button>
        </div>
      ) : courses.length === 0 ? (
        <NoCourses onNavigate={() => navigate('/curriculum')} />
      ) : (
        <div className="space-y-12">
          {/* Explainer for first-time users */}
          {totalSections === 0 && (
            <div className="card p-8 border-navy-100 bg-navy-50/50 flex items-start gap-4 animate-in">
              <SparklesIcon className="w-6 h-6 text-navy-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-navy-900 mb-1">Connect your courses</h3>
                <p className="text-xs text-navy-700 leading-relaxed font-medium">
                  Connect your classes to specific courses. Each course can have multiple periods (e.g. 1st, 3rd, 5th Hour). Once mapped, your Dashboard will automatically track lesson progress in real-time.
                </p>
              </div>
            </div>
          )}

          {/* Sections List */}
          <div className="space-y-4">
             <h2 className="section-header">Courses &amp; Periods</h2>
             <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                      onNavigateCourse={id => navigate(`/courses/${id}`)}
                    />
                  )
                })}
             </div>
          </div>

          {/* Week grid — premium view */}
          {totalSections > 0 && (
            <div className="space-y-4">
               <h2 className="section-header">Weekly view</h2>
               <WeekGridCollapsible sections={sections} courses={courses} onDeleteSection={deleteSection} />
            </div>
          )}

          {/* School Calendar — day off sync */}
          <div className="space-y-4">
             <h2 className="section-header">School calendar</h2>
             <CalendarSync userId={profile?.id} />
          </div>
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

// ─── School Calendar Sync ─────────────────────────────────────────────────────

function CalendarSync({ userId }) {
  const [text, setText] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [holidays, setHolidays] = useState([])
  const [tableError, setTableError] = useState(false) // true when school_holidays table doesn't exist
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase.from('school_holidays').select('*').order('date', { ascending: true })
      .then(({ data, error }) => {
        if (error?.message?.includes('schema cache') || error?.message?.includes('does not exist')) {
          setTableError(true)
        } else {
          setHolidays(data || [])
        }
      })
  }, [userId])

  async function handleSync() {
    if (!text.trim()) { toast.error('Paste your calendar text first'); return }
    setSyncing(true)
    try {
      const res = await fetch('/api/ai/parse-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error('Failed to parse calendar')
      const { holidays: newHolidays, warning } = await res.json()
      if (warning) toast.info?.(warning) // non-fatal

      if (!newHolidays?.length) {
        toast.error('No dates found. Try a format like "Thanksgiving Break Nov 24–28".')
        setSyncing(false)
        return
      }
      const inserts = newHolidays.map(h => ({ teacher_id: userId, name: h.name, date: h.date }))
      const { error } = await supabase.from('school_holidays').insert(inserts)
      if (error) {
        if (error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
          setTableError(true)
          return
        }
        throw error
      }
      toast.success(`Synced ${newHolidays.length} days off!`)
      setText('')
      const { data } = await supabase.from('school_holidays').select('*').order('date', { ascending: true })
      setHolidays(data || [])
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDelete(id) {
    await supabase.from('school_holidays').delete().eq('id', id)
    setHolidays(prev => prev.filter(h => h.id !== id))
  }

  const SETUP_SQL = `create table public.school_holidays (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  date date not null,
  created_at timestamptz default now()
);
alter table public.school_holidays enable row level security;
create policy "Users manage own holidays"
  on public.school_holidays for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);`

  function handleCopy() {
    navigator.clipboard.writeText(SETUP_SQL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── If the table hasn't been created yet, show setup instructions ──
  if (tableError) {
    return (
      <div className="card p-5 space-y-4 border border-amber-100">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <ExclamationTriangleIcon className="w-4 h-4 text-amber-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">One-time database setup needed</p>
            <p className="text-xs text-gray-500 mt-1">
              The <code className="bg-gray-100 px-1 rounded">school_holidays</code> table doesn't exist in your Supabase project yet.
              Run the SQL below in your{' '}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy-600 underline hover:text-navy-800"
              >
                Supabase dashboard → SQL Editor
              </a>{' '}
              to create it, then refresh this page.
            </p>
          </div>
        </div>

        <div className="relative">
          <pre className="bg-gray-900 text-green-300 text-[11px] leading-relaxed rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
{SETUP_SQL}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 px-2 py-1 text-[10px] font-bold rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <p className="text-[11px] text-gray-400 text-center">
          After running the SQL, refresh the page — this message will go away automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">School Calendar</h3>
        <p className="text-sm text-gray-500">
          Paste your district's list of holidays and breaks. The assistant extracts the dates so your course planner auto-excludes them.
        </p>
      </div>

      <textarea
        className="input text-sm resize-none h-24"
        placeholder="e.g. Thanksgiving Break Nov 24-26, Winter Break Dec 20-Jan 3..."
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={syncing}
      />

      <button
        onClick={handleSync}
        disabled={syncing || !text.trim()}
        className="btn-secondary w-full text-sm"
      >
        {syncing ? 'Scanning dates…' : 'Sync breaks & holidays'}
      </button>

      {holidays.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-900 mb-2">Synced days off ({holidays.length})</p>
          <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
            {holidays.map(h => (
              <div key={h.id} className="flex justify-between items-center text-xs py-1.5 group">
                <span className="text-gray-600">{h.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-navy-600 font-medium">
                    {new Date(h.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => handleDelete(h.id)}
                    className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

}
