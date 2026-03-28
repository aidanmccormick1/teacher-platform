import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  PlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  SparklesIcon,
  PencilSquareIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ClockIcon,
  MapPinIcon,
  CalendarDaysIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

function formatTimeCourse(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const p = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${p}`
}

const ALL_DAYS_COURSE = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day']

export default function CoursePage() {
  const { id: courseId } = useParams()
  const { profile }      = useAuth()
  const navigate         = useNavigate()

  const [course,  setCourse]  = useState(null)
  const [units,   setUnits]   = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedUnits, setExpandedUnits] = useState({})
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    document.title = course ? `${course.name} | Cacio EDU` : 'Course | Cacio EDU'
  }, [course])

  useEffect(() => { loadCourse() }, [courseId])

  async function loadCourse() {
    const [courseRes, unitsRes, sectionsRes] = await Promise.all([
      supabase.from('courses').select('*').eq('id', courseId).single(),
      supabase.from('units').select(`*, lessons (*, lesson_segments ( id ))`).eq('course_id', courseId).order('order_index', { ascending: true }),
      supabase.from('sections').select('*').eq('course_id', courseId).order('meeting_time', { ascending: true }),
    ])

    setCourse(courseRes.data)
    setSections(sectionsRes.data || [])

    const sorted = (unitsRes.data || []).map(u => ({
      ...u,
      lessons: [...(u.lessons || [])].sort((a, b) => a.order_index - b.order_index),
    }))
    setUnits(sorted)
    if (sorted.length > 0) {
      setExpandedUnits({ [sorted[0].id]: true })
    }
    setLoading(false)
  }

  // ─── Units ────────────────────────────────────────────────────

  async function addUnit() {
    const title = prompt('Unit title:')
    if (!title) return
    const nextIndex = units.length
    const { data } = await supabase
      .from('units')
      .insert({ course_id: courseId, title, order_index: nextIndex })
      .select()
      .single()
    setUnits(prev => [...prev, { ...data, lessons: [] }])
    setExpandedUnits(prev => ({ ...prev, [data.id]: true }))
  }

  async function deleteUnit(unitId) {
    if (!confirm('Delete this unit and all its lessons?')) return
    await supabase.from('units').delete().eq('id', unitId)
    setUnits(prev => prev.filter(u => u.id !== unitId))
  }

  async function renameUnit(unitId, currentTitle) {
    const title = prompt('Rename unit:', currentTitle)
    if (!title || title === currentTitle) return
    await supabase.from('units').update({ title }).eq('id', unitId)
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, title } : u))
  }

  // AI: generate lesson outline for a unit
  async function aiGenerateLessons(unit) {
    if (aiLoading) return
    setAiLoading(unit.id)
    try {
      const res = await fetch('/api/ai/generate-unit-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitTitle:   unit.title,
          courseSubject: course?.subject,
          gradeLevel:  course?.grade_level,
        }),
      })
      const { lessons: generated } = await res.json()
      if (!generated?.length) return

      const existingCount = unit.lessons.length
      const inserts = generated.map((l, i) => ({
        unit_id:                    unit.id,
        title:                      l.title,
        description:                l.description || null,
        estimated_duration_minutes: l.duration_minutes || null,
        order_index:                existingCount + i,
      }))

      const { data: newLessons } = await supabase
        .from('lessons')
        .insert(inserts)
        .select()

      setUnits(prev => prev.map(u =>
        u.id === unit.id
          ? { ...u, lessons: [...u.lessons, ...(newLessons || []).map(l => ({ ...l, lesson_segments: [] }))] }
          : u
      ))
    } catch (err) {
      console.error('AI generate failed:', err)
    } finally {
      setAiLoading(null)
    }
  }

  // ─── Lessons ──────────────────────────────────────────────────

  async function addLesson(unitId) {
    const title = prompt('Lesson title:')
    if (!title) return
    const unit = units.find(u => u.id === unitId)
    const nextIndex = unit?.lessons.length || 0
    const { data } = await supabase
      .from('lessons')
      .insert({ unit_id: unitId, title, order_index: nextIndex })
      .select()
      .single()
    setUnits(prev => prev.map(u =>
      u.id === unitId
        ? { ...u, lessons: [...u.lessons, { ...data, lesson_segments: [] }] }
        : u
    ))
  }

  async function deleteLesson(unitId, lessonId) {
    if (!confirm('Delete this lesson?')) return
    await supabase.from('lessons').delete().eq('id', lessonId)
    setUnits(prev => prev.map(u =>
      u.id === unitId
        ? { ...u, lessons: u.lessons.filter(l => l.id !== lessonId) }
        : u
    ))
  }

  function toggleUnit(unitId) {
    setExpandedUnits(prev => ({ ...prev, [unitId]: !prev[unitId] }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-navy-800 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <button
            onClick={() => navigate('/curriculum')}
            className="text-xs text-gray-400 hover:text-gray-600 mb-1 block"
          >
            ← Curriculum
          </button>
          <h1 className="page-title">{course?.name}</h1>
          <p className="text-sm text-gray-400">
            {course?.subject} · Grade {course?.grade_level}
          </p>
        </div>
        <button className="btn-primary gap-1.5 shrink-0" onClick={addUnit}>
          <PlusIcon className="w-4 h-4" />
          Add unit
        </button>
      </div>

      {/* Sections panel */}
      <SectionsPanel
        courseId={courseId}
        sections={sections}
        onSectionsChange={setSections}
      />

      {/* Course planner — shown when no units exist yet */}
      {units.length === 0 && (
        <CoursePlanner course={course} onDone={loadCourse} />
      )}

      {/* Units */}
      <div className="space-y-3">
        {units.map((unit, uIdx) => (
          <div key={unit.id} className="card overflow-hidden">
            {/* Unit header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => toggleUnit(unit.id)}
            >
              <ChevronDownIcon className={clsx(
                'w-4 h-4 text-gray-400 shrink-0 transition-transform',
                !expandedUnits[unit.id] && '-rotate-90'
              )} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">
                  Unit {uIdx + 1}: {unit.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {unit.lessons.length} lesson{unit.lessons.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button
                  className="btn-ghost p-1.5 text-purple-500 hover:bg-purple-50"
                  onClick={() => aiGenerateLessons(unit)}
                  disabled={aiLoading === unit.id}
                  title="Generate lessons with AI"
                >
                  {aiLoading === unit.id
                    ? <span className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin block" />
                    : <SparklesIcon className="w-4 h-4" />
                  }
                </button>
                <button
                  className="btn-ghost p-1.5"
                  onClick={() => renameUnit(unit.id, unit.title)}
                  title="Rename unit"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                </button>
                <button
                  className="btn-ghost p-1.5 text-red-400 hover:bg-red-50"
                  onClick={() => deleteUnit(unit.id)}
                  title="Delete unit"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Lessons */}
            {expandedUnits[unit.id] && (
              <div className="border-t border-gray-100">
                {unit.lessons.map((lesson, lIdx) => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    idx={lIdx}
                    courseId={courseId}
                    onDelete={() => deleteLesson(unit.id, lesson.id)}
                    onReload={loadCourse}
                  />
                ))}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                  <button
                    className="btn-ghost gap-1.5 text-xs"
                    onClick={() => addLesson(unit.id)}
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    Add lesson
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Lesson Row ────────────────────────────────────────────────────

function LessonRow({ lesson, idx, courseId, onDelete, onReload }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [segments, setSegments] = useState(lesson.lesson_segments || [])
  const [segLoaded, setSegLoaded] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  async function loadSegments() {
    if (segLoaded) return
    const { data } = await supabase
      .from('lesson_segments')
      .select('*')
      .eq('lesson_id', lesson.id)
      .order('order_index')
    setSegments(data || [])
    setSegLoaded(true)
  }

  function handleExpand() {
    if (!expanded) loadSegments()
    setExpanded(v => !v)
  }

  async function addSegment() {
    const title = prompt('Segment title (e.g. "Warm-up", "Activity 1"):')
    if (!title) return
    const { data } = await supabase
      .from('lesson_segments')
      .insert({
        lesson_id:   lesson.id,
        title,
        order_index: segments.length,
      })
      .select()
      .single()
    setSegments(prev => [...prev, data])
  }

  async function deleteSegment(segId) {
    await supabase.from('lesson_segments').delete().eq('id', segId)
    setSegments(prev => prev.filter(s => s.id !== segId))
  }

  async function aiGenerateSegments() {
    setAiLoading(true)
    try {
      const res = await fetch('/api/ai/generate-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonTitle: lesson.title }),
      })
      const { segments: generated } = await res.json()
      if (!generated?.length) return

      const inserts = generated.map((s, i) => ({
        lesson_id:        lesson.id,
        title:            s.title,
        description:      s.description || null,
        duration_minutes: s.duration_minutes || null,
        order_index:      segments.length + i,
      }))

      const { data: newSegs } = await supabase
        .from('lesson_segments')
        .insert(inserts)
        .select()

      setSegments(prev => [...prev, ...(newSegs || [])])
      setExpanded(true)
    } catch (err) {
      console.error(err)
    } finally {
      setAiLoading(false)
    }
  }

  const segCount = lesson.lesson_segments?.length ?? segments.length

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
        <button onClick={handleExpand} className="flex-1 flex items-center gap-3 text-left min-w-0">
          <ChevronDownIcon className={clsx(
            'w-3.5 h-3.5 text-gray-300 shrink-0 transition-transform',
            !expanded && '-rotate-90'
          )} />
          <span className="text-sm text-gray-800 truncate">
            {idx + 1}. {lesson.title}
          </span>
          {segCount > 0 && (
            <span className="badge-gray shrink-0">{segCount} segments</span>
          )}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="btn-ghost p-1 text-purple-400 hover:bg-purple-50"
            onClick={aiGenerateSegments}
            disabled={aiLoading}
            title="Generate segments with AI"
          >
            {aiLoading
              ? <span className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin block" />
              : <SparklesIcon className="w-3.5 h-3.5" />
            }
          </button>
          <button
            className="btn-ghost p-1 text-red-400 hover:bg-red-50"
            onClick={onDelete}
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="bg-gray-50 px-4 pb-3 space-y-1.5 ml-6">
          {segments.length === 0 && (
            <p className="text-xs text-gray-400 py-2">No segments yet.</p>
          )}
          {segments.map(seg => (
            <div key={seg.id} className="flex items-center gap-2 py-1.5 px-3 bg-white rounded-lg border border-gray-100 text-sm">
              <span className="flex-1 text-gray-700 text-xs">{seg.title}</span>
              {seg.duration_minutes && (
                <span className="text-xs text-gray-400 shrink-0">{seg.duration_minutes}m</span>
              )}
              <button
                className="text-gray-300 hover:text-red-400"
                onClick={() => deleteSegment(seg.id)}
              >
                <TrashIcon className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button className="btn-ghost gap-1.5 text-xs mt-1" onClick={addSegment}>
            <PlusIcon className="w-3 h-3" />
            Add segment
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Sections Panel ───────────────────────────────────────────────

function SectionsPanel({ courseId, sections, onSectionsChange }) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', meeting_days: [], meeting_time: '', room: '' })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)

  function toggleDay(day) {
    setForm(f => ({
      ...f,
      meeting_days: f.meeting_days.includes(day)
        ? f.meeting_days.filter(d => d !== day)
        : [...f.meeting_days, day],
    }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAddLoading(true)
    setAddError(null)
    const { data, error } = await supabase
      .from('sections')
      .insert({ ...form, course_id: courseId, meeting_time: form.meeting_time || null })
      .select()
      .single()
    setAddLoading(false)
    if (error) {
      setAddError(error.message || 'Failed to add period')
    } else if (data) {
      onSectionsChange(prev => [...prev, data])
      setForm({ name: '', meeting_days: [], meeting_time: '', room: '' })
      setShowAdd(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this class period?')) return
    await supabase.from('sections').delete().eq('id', id)
    onSectionsChange(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-sm text-gray-900">Class Periods</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{sections.length}</span>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Add period
        </button>
      </div>

      {sections.length === 0 && !showAdd && (
        <div className="px-4 py-5 text-center">
          <p className="text-sm text-gray-500 mb-1">No class periods yet</p>
          <p className="text-xs text-gray-400">Add each period this course runs (e.g. Period 1 Mon/Wed/Fri at 8:00 AM).</p>
        </div>
      )}

      {sections.length > 0 && (
        <div className="divide-y divide-gray-50">
          {sections.map(section => (
            <div key={section.id} className="flex items-center px-4 py-3 gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{section.name}</p>
                <div className="flex flex-wrap gap-3 mt-0.5">
                  {section.meeting_days?.length > 0 && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <CalendarDaysIcon className="w-3 h-3" />
                      {section.meeting_days.map(d => d.slice(0, 3)).join(', ')}
                    </span>
                  )}
                  {section.meeting_time && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <ClockIcon className="w-3 h-3" />
                      {formatTimeCourse(section.meeting_time)}
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
                onClick={() => handleDelete(section.id)}
                className="text-gray-300 hover:text-red-400 p-1 transition-colors shrink-0"
                title="Remove period"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="border-t border-gray-100 bg-indigo-50/40 px-4 py-4 space-y-3">
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

          <div>
            <label className="label text-xs">Meeting days</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS_COURSE.map(day => (
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

          <div className="w-40">
            <label className="label text-xs">Time</label>
            <input
              type="time"
              className="input text-sm"
              value={form.meeting_time}
              onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}
            />
          </div>

          {addError && <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{addError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addLoading || !form.name}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
            >
              {addLoading ? 'Adding...' : 'Add period'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Course Planner (replaces AI Scaffold Banner) ─────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function CoursePlanner({ course, onDone }) {
  // Step 1: course context. Step 2: month-by-month topic entry. Step 3: AI fills in lessons.
  const [step, setStep] = useState(1)
  const [ctx, setCtx] = useState({
    startMonth: '',
    endMonth: '',
    daysPerWeek: '',
    examDate: '',
    goals: '',
  })
  // monthTopics: array of { month: string, topic: string }
  const [monthTopics, setMonthTopics] = useState([])
  const [generating, setGenerating] = useState(null) // month string currently generating
  const [done, setDone] = useState([]) // months that have been generated

  // Build month list from start/end selection
  function buildMonthList(start, end) {
    const si = MONTHS.indexOf(start)
    const ei = MONTHS.indexOf(end)
    if (si < 0 || ei < 0) return []
    // Handle wrap-around (e.g. Aug -> May next year)
    const result = []
    if (si <= ei) {
      for (let i = si; i <= ei; i++) result.push(MONTHS[i])
    } else {
      for (let i = si; i < MONTHS.length; i++) result.push(MONTHS[i])
      for (let i = 0; i <= ei; i++) result.push(MONTHS[i])
    }
    return result
  }

  function handleCtxNext(e) {
    e.preventDefault()
    const months = buildMonthList(ctx.startMonth, ctx.endMonth)
    setMonthTopics(months.map(m => ({ month: m, topic: '' })))
    setStep(2)
  }

  function updateTopic(month, value) {
    setMonthTopics(prev => prev.map(mt => mt.month === month ? { ...mt, topic: value } : mt))
  }

  async function generateForMonth(mt) {
    if (!mt.topic.trim()) return
    setGenerating(mt.month)
    try {
      const res = await fetch('/api/ai/scaffold-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId:   course.id,
          subject:    course.subject,
          gradeLevel: course.grade_level,
          goals:      ctx.goals,
          month:      mt.month,
          topic:      mt.topic,
          examDate:   ctx.examDate,
          mode:       'month', // signal to the API to scope to one month
        }),
      })
      if (res.ok) {
        setDone(prev => [...prev, mt.month])
      }
    } catch (err) {
      console.error('Generate failed for', mt.month, err)
    } finally {
      setGenerating(null)
    }
  }

  async function generateAll() {
    const pending = monthTopics.filter(mt => mt.topic.trim() && !done.includes(mt.month))
    for (const mt of pending) {
      await generateForMonth(mt)
    }
    onDone()
  }

  const filledCount = monthTopics.filter(mt => mt.topic.trim()).length
  const months = monthTopics.map(mt => mt.month)

  // ── Step 1: Context ──
  if (step === 1) {
    return (
      <div className="card p-5 border-2 border-dashed border-gray-200 bg-gray-50 space-y-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-4 h-4 text-indigo-500" />
          <h3 className="font-semibold text-sm text-gray-900">Plan your curriculum</h3>
          <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">Step 1 of 2</span>
        </div>
        <p className="text-xs text-gray-500">
          Tell us about the course — you'll map out your topics month by month, then AI generates the lesson details within each.
        </p>

        <form onSubmit={handleCtxNext} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Course starts</label>
              <select
                className="input text-sm"
                value={ctx.startMonth}
                onChange={e => setCtx(c => ({ ...c, startMonth: e.target.value }))}
                required
              >
                <option value="">Month</option>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Course ends</label>
              <select
                className="input text-sm"
                value={ctx.endMonth}
                onChange={e => setCtx(c => ({ ...c, endMonth: e.target.value }))}
                required
              >
                <option value="">Month</option>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Class meetings per week</label>
              <select
                className="input text-sm"
                value={ctx.daysPerWeek}
                onChange={e => setCtx(c => ({ ...c, daysPerWeek: e.target.value }))}
              >
                <option value="">Select</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} day{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Key date (AP exam, finals, etc.)</label>
              <input
                type="text"
                className="input text-sm"
                value={ctx.examDate}
                onChange={e => setCtx(c => ({ ...c, examDate: e.target.value }))}
                placeholder="e.g. May 7 AP exam"
              />
            </div>
          </div>

          <div>
            <label className="label text-xs">Course goals or focus (optional)</label>
            <textarea
              className="input text-sm resize-none"
              rows={2}
              value={ctx.goals}
              onChange={e => setCtx(c => ({ ...c, goals: e.target.value }))}
              placeholder="e.g. Prepare students for the AP exam with emphasis on primary source analysis"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-primary text-sm gap-1.5" disabled={!ctx.startMonth || !ctx.endMonth}>
              Next: map your months
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={onDone}
            >
              Skip — add units manually
            </button>
          </div>
        </form>
      </div>
    )
  }

  // ── Step 2: Month-by-month topic mapping ──
  return (
    <div className="card border-2 border-dashed border-gray-200 bg-gray-50 overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-center gap-2">
        <SparklesIcon className="w-4 h-4 text-indigo-500" />
        <h3 className="font-semibold text-sm text-gray-900">Map your months</h3>
        <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">Step 2 of 2</span>
      </div>
      <p className="px-5 pb-3 text-xs text-gray-500">
        Write the main topic or unit for each month — just a short phrase is enough. AI generates the individual lessons within each.
      </p>

      <div className="divide-y divide-gray-100">
        {monthTopics.map((mt) => {
          const isDone = done.includes(mt.month)
          const isGenerating = generating === mt.month
          return (
            <div key={mt.month} className="flex items-center gap-3 px-5 py-3">
              <div className="w-20 shrink-0">
                <span className={`text-xs font-semibold ${isDone ? 'text-green-600' : 'text-gray-500'}`}>
                  {mt.month}
                </span>
                {isDone && (
                  <span className="block text-xs text-green-500 mt-0.5 flex items-center gap-1">
                    <CheckIcon className="w-3 h-3 inline" /> Generated
                  </span>
                )}
              </div>
              <input
                className="input text-sm flex-1"
                value={mt.topic}
                onChange={e => updateTopic(mt.month, e.target.value)}
                placeholder={`Topic or unit for ${mt.month}...`}
                disabled={isDone}
              />
              {!isDone && (
                <button
                  type="button"
                  onClick={() => generateForMonth(mt)}
                  disabled={!mt.topic.trim() || isGenerating || !!generating}
                  className="shrink-0 px-2.5 py-1.5 text-xs font-medium border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  title="Generate lessons for this month"
                >
                  {isGenerating
                    ? <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    : <SparklesIcon className="w-3 h-3" />
                  }
                  {isGenerating ? 'Building...' : 'Generate'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-5 py-4 bg-white border-t border-gray-100 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="btn-secondary text-sm"
          >
            Done
          </button>
          <button
            type="button"
            onClick={generateAll}
            disabled={filledCount === 0 || !!generating}
            className="btn-primary text-sm gap-1.5 disabled:opacity-40"
          >
            {generating
              ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating...</>
              : <><SparklesIcon className="w-3.5 h-3.5" /> Generate all ({filledCount})</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
