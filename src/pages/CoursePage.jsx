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
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

export default function CoursePage() {
  const { id: courseId } = useParams()
  const { profile }      = useAuth()
  const navigate         = useNavigate()

  const [course,  setCourse]  = useState(null)
  const [units,   setUnits]   = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedUnits, setExpandedUnits] = useState({})
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => { loadCourse() }, [courseId])

  async function loadCourse() {
    const { data: courseData } = await supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .single()
    setCourse(courseData)

    const { data: unitsData } = await supabase
      .from('units')
      .select(`
        *,
        lessons (
          *,
          lesson_segments ( id )
        )
      `)
      .eq('course_id', courseId)
      .order('order_index', { ascending: true })

    const sorted = (unitsData || []).map(u => ({
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

      {/* AI scaffold prompt (only when empty) */}
      {units.length === 0 && (
        <AiScaffoldBanner course={course} onScaffolded={loadCourse} />
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

// ─── AI Scaffold Banner ────────────────────────────────────────────

function AiScaffoldBanner({ course, onScaffolded }) {
  const [loading, setLoading] = useState(false)
  const [goals, setGoals]     = useState('')

  async function handleScaffold() {
    if (!course) return
    setLoading(true)
    try {
      const res = await fetch('/api/ai/scaffold-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId:    course.id,
          subject:     course.subject,
          gradeLevel:  course.grade_level,
          goals,
        }),
      })
      await res.json()
      onScaffolded()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-5 border-dashed border-2 border-gray-200 bg-gray-50">
      <div className="flex items-start gap-3">
        <SparklesIcon className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-medium text-gray-900 text-sm mb-1">
            Build your curriculum with AI
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Describe your goals and we'll generate a full unit + lesson structure you can edit.
          </p>
          <textarea
            className="input text-sm resize-none mb-3"
            rows={2}
            placeholder="e.g. Cover ancient civilizations through primary sources with emphasis on critical thinking"
            value={goals}
            onChange={e => setGoals(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn-primary gap-1.5 text-sm"
              onClick={handleScaffold}
              disabled={loading}
            >
              {loading
                ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Building...</>
                : <><SparklesIcon className="w-3.5 h-3.5" /> Generate structure</>
              }
            </button>
            <button className="btn-secondary text-sm" onClick={() => {}}>
              I'll add units manually
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
