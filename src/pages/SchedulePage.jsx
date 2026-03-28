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
    icon: '👋',
  },
  {
    title: 'Two ways to add classes',
    body: 'You can type your schedule out naturally (like "Algebra 9, Period 1, 8:00 AM, Mon/Wed/Fri, Room 204") or add each class manually. Either way works.',
    icon: '✍️',
  },
  {
    title: 'AI parses it for you',
    body: 'Paste your schedule from a PDF, email, or school system and hit "Build with AI." It reads the text and builds your full schedule automatically.',
    icon: '✨',
  },
  {
    title: 'Your week at a glance',
    body: 'After setup, you\'ll see a color-coded weekly grid. Click any class to mark attendance, track lesson progress, or add notes.',
    icon: '📅',
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
                i === step ? 'w-6 bg-indigo-600' : 'w-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="px-7 py-5 text-center space-y-3">
          <div className="text-4xl">{current.icon}</div>
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
            className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors"
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
            <SparklesIcon className="w-5 h-5 text-indigo-500" />
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
              !photoMode ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <ChatBubbleBottomCenterTextIcon className="w-4 h-4" />
            Type or paste
          </button>
          <button
            onClick={() => setPhotoMode(true)}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              photoMode ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <CameraIcon className="w-4 h-4" />
            Photo of schedule
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!photoMode ? (
            <textarea
              className="w-full border border-gray-200 rounded-xl p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-700 placeholder:text-gray-300 placeholder:font-sans"
              rows={9}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={PLACEHOLDER}
            />
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50 transition-all"
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

          <div className="flex items-start gap-2 bg-indigo-50 rounded-xl p-3">
            <LightBulbIcon className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
            <p className="text-xs text-indigo-700">
              Include class name, days, and time for the best results. Room numbers and period labels are optional but helpful.
            </p>
          </div>

          {!photoMode && (
            <button
              onClick={handleBuild}
              disabled={loading || !text.trim()}
              className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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
            <div className="flex items-center justify-center gap-2 text-sm text-indigo-600">
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
          <span className="text-xs bg-indigo-100 text-indigo-700 font-medium px-2.5 py-1 rounded-full">
            {items.length} class{items.length !== 1 ? 'es' : ''}
          </span>
        </div>

        <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
          {items.map((item, i) => (
            <div key={i} className={`px-6 py-4 flex items-start gap-3`}>
              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${colorForIndex(i).split(' ')[0].replace('bg-', 'bg-').replace('100', '400')}`} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <input
                  className="font-medium text-sm text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-indigo-400 focus:outline-none w-full"
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
            className="flex-1 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40"
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
            <div key={day} className={`rounded-xl overflow-hidden border ${isToday ? 'border-indigo-300 shadow-sm' : 'border-gray-200'}`}>
              {/* Day header */}
              <div className={`px-3 py-2 text-center text-xs font-semibold ${
                isToday ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-500'
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
                          <p className="opacity-70 mt-0.5">{formatTime(section.meeting_time)}</p>
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
      .insert({ ...form, meeting_time: form.meeting_time || null })
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
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {day.length > 3 ? day.slice(0, 3) : day}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Time</label>
            <input
              type="time"
              className="input"
              value={form.meeting_time}
              onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}
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
            className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40"
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
      <div className="text-4xl mb-4">📚</div>
      <h3 className="font-semibold text-gray-900 mb-2">Add your courses first</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        Before building your schedule, add the courses you teach in the Curriculum section.
      </p>
      <button
        onClick={onNavigate}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"
      >
        Go to Curriculum
        <ChevronRightIcon className="w-4 h-4" />
      </button>
    </div>
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
  const [showAddModal, setShowAddModal]   = useState(false)
  const [parsedSchedule, setParsedSchedule] = useState(null)
  const [saving, setSaving] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    if (profile) loadAll()
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

      // For each parsed item, find or create a matching course, then create a section
      for (const item of items) {
        // Skip assignments for now (only process classes)
        if (item.type === 'assignment') continue

        // Try to match by name to existing courses
        let courseId = courses.find(c =>
          c.name.toLowerCase().includes(item.name.toLowerCase()) ||
          item.name.toLowerCase().includes(c.name.toLowerCase())
        )?.id

        // If no match, create a new course
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

          if (courseError) {
            console.error('Error creating course:', courseError)
            continue
          }
          if (newCourse) {
            setCourses(prev => [...prev, newCourse])
            courseId = newCourse.id
          }
        }

        if (!courseId) continue

        // Create the section
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

        if (sectionError) {
          console.error('Error creating section:', sectionError)
          continue
        }
        if (newSection) {
          createdSections.push(newSection)
          setSections(prev => [...prev, newSection])
        }
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
    if (!confirm('Remove this class from your schedule?')) return
    await supabase.from('sections').delete().eq('id', id)
    setSections(prev => prev.filter(s => s.id !== id))
  }

  const hasSchedule = sections.length > 0

  return (
    <div className="space-y-5">
      {/* Tutorial overlay */}
      {showTutorial && <TutorialOverlay onDone={handleTutorialDone} />}

      {/* AI Builder panel */}
      {showAIBuilder && (
        <AIBuilderPanel
          onParsed={parsed => {
            setShowAIBuilder(false)
            setParsedSchedule(parsed)
          }}
          onClose={() => setShowAIBuilder(false)}
        />
      )}

      {/* Review parsed schedule */}
      {parsedSchedule && (
        <ParsedScheduleReview
          parsed={parsedSchedule}
          onConfirm={handleParsedConfirm}
          onRetry={() => {
            setParsedSchedule(null)
            setShowAIBuilder(true)
          }}
        />
      )}

      {/* Manual add modal */}
      {showAddModal && courses.length > 0 && (
        <AddClassModal
          courses={courses}
          onClose={() => setShowAddModal(false)}
          onCreated={section => {
            setSections(prev => [...prev, section])
            setShowAddModal(false)
          }}
        />
      )}

      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-3">
            <ArrowPathIcon className="w-5 h-5 text-indigo-600 animate-spin" />
            <span className="text-sm font-medium text-gray-700">Saving your schedule...</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Schedule</h1>
          {hasSchedule && (
            <p className="text-sm text-gray-400 mt-0.5">
              {sections.length} class{sections.length !== 1 ? 'es' : ''} across {courses.length} course{courses.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {!loading && courses.length > 0 && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setShowAIBuilder(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <SparklesIcon className="w-3.5 h-3.5" />
              AI Builder
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Manual
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
              <div className="grid grid-cols-5 gap-2">
                {[1,2,3,4,5].map(j => <div key={j} className="h-16 bg-gray-100 rounded-lg" />)}
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <NoCourses onNavigate={() => nav('/curriculum')} />
      ) : !hasSchedule ? (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-4">📅</div>
          <h3 className="font-bold text-gray-900 mb-2 text-lg">Build your weekly schedule</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
            Paste your schedule, describe it, or snap a photo — AI will build it automatically. Or add classes one by one.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={() => setShowAIBuilder(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"
            >
              <SparklesIcon className="w-4 h-4" />
              Build with AI
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50"
            >
              <PlusIcon className="w-4 h-4" />
              Add manually
            </button>
            <button
              onClick={() => setShowTutorial(true)}
              className="flex items-center gap-2 px-5 py-2.5 text-indigo-600 text-sm font-medium"
            >
              How does this work?
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Week grid */}
          <div className="card p-4 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-700">This week</p>
              <div className="flex items-center gap-2">
                {/* Color legend */}
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {courses.slice(0, 5).map((c, i) => (
                    <span
                      key={c.id}
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colorForIndex(i)}`}
                    >
                      {c.name.length > 12 ? c.name.slice(0, 10) + '…' : c.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <WeekGrid
              sections={sections}
              courses={courses}
              onDeleteSection={deleteSection}
            />
          </div>

          {/* List view */}
          <div>
            <p className="section-header mb-3">All classes</p>
            <div className="space-y-2">
              {courses.map((course, ci) => {
                const courseSections = sections.filter(s => s.course_id === course.id)
                if (!courseSections.length) return null
                return (
                  <div key={course.id} className="card overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${colorForIndex(ci).split(' ')[0].replace('100', '400')}`} />
                      <span className="font-semibold text-sm text-gray-900">{course.name}</span>
                      <span className="text-xs text-gray-400">{course.subject}</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {courseSections.map(section => (
                        <div key={section.id} className="flex items-center px-4 py-3 gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{section.name}</p>
                            <div className="flex gap-3 mt-0.5 flex-wrap">
                              {section.meeting_days?.length > 0 && (
                                <span className="text-xs text-gray-400">
                                  {section.meeting_days.map(d => d.slice(0, 3)).join(', ')}
                                </span>
                              )}
                              {section.meeting_time && (
                                <span className="text-xs text-gray-400">{formatTime(section.meeting_time)}</span>
                              )}
                              {section.room && (
                                <span className="text-xs text-gray-400">Rm {section.room}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => deleteSection(section.id)}
                            className="text-gray-300 hover:text-red-400 p-1 transition-colors"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
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
