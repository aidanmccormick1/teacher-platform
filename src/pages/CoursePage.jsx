import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  PlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  TrashIcon,
  DocumentDuplicateIcon,

  PencilSquareIcon,
  ClockIcon,
  MapPinIcon,
  CalendarDaysIcon,
  XMarkIcon,
  CheckIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  ChevronLeftIcon,
  Bars3Icon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import QuickAddLessonDrawer from '@/components/QuickAddLessonDrawer'
import CalendarView from '@/components/CalendarView'
import YearTimeline from '@/components/YearTimeline'

function formatTimeCourse(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const p = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${p}`
}

// Days that can have distinct times
const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const BLOCK_DAYS = ['A-Day', 'B-Day']
const ALL_DAYS = [...WEEKDAYS_FULL, ...BLOCK_DAYS]
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', 'A-Day': 'A', 'B-Day': 'B' }

// Unit color palette — like Atlas
const UNIT_COLORS = [
  { bg: 'bg-blue-500',   light: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   bar: '#3b82f6' },
  { bg: 'bg-violet-500', light: 'bg-violet-50',  border: 'border-violet-200', text: 'text-violet-700', bar: '#8b5cf6' },
  { bg: 'bg-emerald-500',light: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-700',bar: '#10b981' },
  { bg: 'bg-amber-500',  light: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700',  bar: '#f59e0b' },
  { bg: 'bg-rose-500',   light: 'bg-rose-50',    border: 'border-rose-200',   text: 'text-rose-700',   bar: '#ef4444' },
  { bg: 'bg-cyan-500',   light: 'bg-cyan-50',    border: 'border-cyan-200',   text: 'text-cyan-700',   bar: '#06b6d4' },
  { bg: 'bg-orange-500', light: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-700', bar: '#f97316' },
  { bg: 'bg-pink-500',   light: 'bg-pink-50',    border: 'border-pink-200',   text: 'text-pink-700',   bar: '#ec4899' },
]

function colorForUnit(idx) {
  return UNIT_COLORS[idx % UNIT_COLORS.length]
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function CoursePage() {
  const { id: courseId } = useParams()
  const { profile }      = useAuth()
  const navigate         = useNavigate()

  const [course,    setCourse]    = useState(null)
  const [units,     setUnits]     = useState([])
  const [sections,  setSections]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [expandedUnits, setExpandedUnits] = useState({})
  const [aiLoading, setAiLoading] = useState(null)
  const [activeTab, setActiveTab] = useState('units') // 'units' | 'timeline' | 'standards'
  const [showPlanner, setShowPlanner] = useState(false)
  const [calendarView, setCalendarView] = useState(false)

  // Inline edit states
  const [isAddingUnit, setIsAddingUnit] = useState(false)
  const [newUnitTitle, setNewUnitTitle] = useState('')
  const [renamingUnitId, setRenamingUnitId] = useState(null)
  const [renameUnitTitle, setRenameUnitTitle] = useState('')
  const [addingLessonToUnit, setAddingLessonToUnit] = useState(null)
  const [newLessonTitle, setNewLessonTitle] = useState('')
  const [quickAddUnit, setQuickAddUnit] = useState(null)

  const unitInputRef = useRef(null)
  const renameInputRef = useRef(null)
  const lessonInputRef = useRef(null)

  useEffect(() => {
    document.title = course ? `${course.name} | TeacherOS` : 'Course | TeacherOS'
  }, [course])

  useEffect(() => { loadCourse() }, [courseId])

  useEffect(() => {
    if (isAddingUnit) unitInputRef.current?.focus()
  }, [isAddingUnit])

  useEffect(() => {
    if (renamingUnitId) renameInputRef.current?.focus()
  }, [renamingUnitId])

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

  async function handleAddUnit(e) {
    if (e) e.preventDefault()
    if (!newUnitTitle.trim()) {
      setIsAddingUnit(false)
      return
    }
    const title = newUnitTitle.trim()
    const nextIndex = units.length
    const { data } = await supabase
      .from('units')
      .insert({ course_id: courseId, title, order_index: nextIndex })
      .select()
      .single()
    setUnits(prev => [...prev, { ...data, lessons: [] }])
    setExpandedUnits(prev => ({ ...prev, [data.id]: true }))
    setNewUnitTitle('')
    setIsAddingUnit(false)
  }

  async function deleteUnit(unitId) {
    if (!confirm('Delete this unit and all its lessons?')) return
    await supabase.from('units').delete().eq('id', unitId)
    setUnits(prev => prev.filter(u => u.id !== unitId))
  }

  async function handleRenameUnit(e) {
    if (e) e.preventDefault()
    if (!renameUnitTitle.trim() || !renamingUnitId) {
      setRenamingUnitId(null)
      return
    }
    const title = renameUnitTitle.trim()
    await supabase.from('units').update({ title }).eq('id', renamingUnitId)
    setUnits(prev => prev.map(u => u.id === renamingUnitId ? { ...u, title } : u))
    setRenamingUnitId(null)
    setRenameUnitTitle('')
  }

  async function aiGenerateLessons(unit) {
    if (aiLoading) return
    setAiLoading(unit.id)
    try {
      const res = await fetch('/api/ai/generate-unit-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitTitle: unit.title, courseSubject: course?.subject, gradeLevel: course?.grade_level }),
      })
      const { lessons: generated } = await res.json()
      if (!generated?.length) return

      const existingCount = unit.lessons.length
      const inserts = generated.map((l, i) => ({
        unit_id: unit.id, title: l.title, description: l.description || null,
        estimated_duration_minutes: l.duration_minutes || null, order_index: existingCount + i,
      }))

      const { data: newLessons } = await supabase.from('lessons').insert(inserts).select()
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

  async function handleAddLesson(e) {
    if (e) e.preventDefault()
    if (!newLessonTitle.trim() || !addingLessonToUnit) {
      setAddingLessonToUnit(null)
      return
    }
    const title = newLessonTitle.trim()
    const unitId = addingLessonToUnit
    const unit = units.find(u => u.id === unitId)
    const nextIndex = unit?.lessons.length || 0
    const { data } = await supabase
      .from('lessons')
      .insert({ unit_id: unitId, title, order_index: nextIndex })
      .select()
      .single()
    setUnits(prev => prev.map(u =>
      u.id === unitId ? { ...u, lessons: [...u.lessons, { ...data, lesson_segments: [] }] } : u
    ))
    setAddingLessonToUnit(null)
    setNewLessonTitle('')
  }

  async function deleteLesson(unitId, lessonId) {
    if (!confirm('Delete this lesson?')) return
    await supabase.from('lessons').delete().eq('id', lessonId)
    setUnits(prev => prev.map(u =>
      u.id === unitId ? { ...u, lessons: u.lessons.filter(l => l.id !== lessonId) } : u
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
          <button onClick={() => navigate('/curriculum')} className="text-xs text-gray-400 hover:text-gray-600 mb-1 flex items-center gap-1">
            <ChevronLeftIcon className="w-3 h-3" /> Curriculum
          </button>
          <h1 className="page-title">{course?.name}</h1>
          <p className="text-sm text-gray-400">
            {course?.subject}{course?.grade_level ? ` · Grade ${course.grade_level}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {activeTab === 'units' && (
            isAddingUnit ? (
              <form onSubmit={handleAddUnit} className="flex items-center gap-2">
                <input
                  ref={unitInputRef}
                  className="input py-1.5 text-sm w-48"
                  placeholder="New unit title..."
                  value={newUnitTitle}
                  onChange={e => setNewUnitTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && setIsAddingUnit(false)}
                />
                <button type="submit" className="btn-primary py-1.5 px-3 text-xs">Save</button>
                <button type="button" onClick={() => setIsAddingUnit(false)} className="btn-secondary py-1.5 px-3 text-xs">
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <button className="btn-primary gap-1.5" onClick={() => setIsAddingUnit(true)}>
                <PlusIcon className="w-4 h-4" />
                Add unit
              </button>
            )
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-100">
        {[
          { id: 'units',     label: 'Units & Lessons' },
          { id: 'timeline',  label: 'Year Timeline' },
          { id: 'standards', label: 'Standards' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-navy-800 text-navy-800'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sections panel — always visible at top */}
      <SectionsPanel courseId={courseId} sections={sections} onSectionsChange={setSections} />

      {/* Tab content */}
      {activeTab === 'units' && (
        <>
          <div className="flex justify-end pt-2 pb-2">
            <div className="bg-gray-100/80 p-1 rounded-lg inline-flex border border-gray-200/60 shadow-inner">
              <button 
                onClick={() => setCalendarView(false)} 
                className={clsx("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", !calendarView ? 'bg-white shadow text-navy-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50')}
              >
                Unit View
              </button>
              <button 
                onClick={() => setCalendarView(true)} 
                className={clsx("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", calendarView ? 'bg-white shadow text-navy-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50')}
              >
                Calendar View
              </button>
            </div>
          </div>

          {!calendarView ? (
            <>
              {/* Planner prompt when no units */}
          {units.length === 0 && !showPlanner && (
            <div className="card p-6 flex items-center gap-4 border-dashed border-2 border-gray-200 bg-gray-50">
              <div className="w-10 h-10 rounded-xl bg-navy-50 flex items-center justify-center shrink-0">
                <CalendarDaysIcon className="w-5 h-5 text-navy-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">Plan your year</p>
                <p className="text-xs text-gray-400 mt-0.5">Map out units month by month and we'll help fill in the lessons.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn-secondary text-sm" onClick={() => setIsAddingUnit(true)}>Add unit</button>
                <button className="btn-primary text-sm" onClick={() => setShowPlanner(true)}>Plan year</button>
              </div>
            </div>
          )}

          {units.length === 0 && showPlanner && (
            <CoursePlanner course={course} onDone={() => { setShowPlanner(false); loadCourse() }} onSkip={() => setShowPlanner(false)} />
          )}

          {units.length > 0 && units.length < 3 && !showPlanner && (
            <button
              onClick={() => setShowPlanner(true)}
              className="w-full text-left card p-4 flex items-center gap-3 border-dashed border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <CalendarDaysIcon className="w-4 h-4 text-navy-500 shrink-0" />
              <span className="text-sm text-gray-500">Continue planning your year month by month</span>
              <ChevronRightIcon className="w-4 h-4 text-gray-300 ml-auto" />
            </button>
          )}

          {showPlanner && units.length > 0 && (
            <CoursePlanner course={course} onDone={() => { setShowPlanner(false); loadCourse() }} onSkip={() => setShowPlanner(false)} />
          )}

          {/* Units list */}
          <div className="space-y-3">
            {units.map((unit, uIdx) => {
              const color = colorForUnit(uIdx)
              return (
                <div key={unit.id} className="card overflow-hidden">
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleUnit(unit.id)}
                  >
                    {/* Color dot */}
                    <div className={`w-2.5 h-2.5 rounded-full ${color.bg} shrink-0`} />
                    <ChevronDownIcon className={clsx(
                      'w-4 h-4 text-gray-300 shrink-0 transition-transform',
                      !expandedUnits[unit.id] && '-rotate-90'
                    )} />
                    <div className="flex-1 min-w-0">
                      {renamingUnitId === unit.id ? (
                        <form onSubmit={handleRenameUnit} onClick={e => e.stopPropagation()}>
                          <input
                            ref={renameInputRef}
                            className="input py-1 text-sm w-full max-w-sm"
                            value={renameUnitTitle}
                            onChange={e => setRenameUnitTitle(e.target.value)}
                            onBlur={() => setRenamingUnitId(null)}
                            onKeyDown={e => e.key === 'Escape' && setRenamingUnitId(null)}
                          />
                        </form>
                      ) : (
                        <>
                          <p className="font-semibold text-gray-900 text-sm">
                            Unit {uIdx + 1}: {unit.title}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {unit.lessons.length} lesson{unit.lessons.length !== 1 ? 's' : ''}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        className="btn-ghost p-1.5 text-navy-500 hover:bg-navy-50"
                        onClick={() => aiGenerateLessons(unit)}
                        disabled={aiLoading === unit.id}
                        title="Suggest lessons"
                      >
                        {aiLoading === unit.id
                          ? <span className="w-4 h-4 border-2 border-navy-400 border-t-transparent rounded-full animate-spin block" />
                          : <DocumentTextIcon className="w-4 h-4" />
                        }
                      </button>
                      <button 
                        className="btn-ghost p-1.5" 
                        onClick={() => {
                          setRenamingUnitId(unit.id)
                          setRenameUnitTitle(unit.title)
                        }} 
                        title="Rename"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                      <button className="btn-ghost p-1.5 text-red-400 hover:bg-red-50" onClick={() => deleteUnit(unit.id)} title="Delete">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {expandedUnits[unit.id] && (
                    <div className="border-t border-gray-100">
                      {unit.lessons.map((lesson, lIdx) => (
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          idx={lIdx}
                          courseId={courseId}
                          sections={sections}
                          color={color}
                          onDelete={() => deleteLesson(unit.id, lesson.id)}
                          onUpdateDate={async (lessonId, targetDate) => {
                            await supabase.from('lessons').update({ target_date: targetDate }).eq('id', lessonId)
                            loadCourse()
                          }}
                          onReload={loadCourse}
                        />
                      ))}
                      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                        <button className="btn-ghost gap-1.5 text-xs text-navy-600 hover:bg-navy-50" onClick={() => setQuickAddUnit(unit)}>
                          <PlusIcon className="w-3.5 h-3.5" />
                          Add lesson
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
            </>
          ) : (
            <CalendarView 
              course={course} 
              sections={sections} 
              units={units} 
              onReload={loadCourse} 
            />
          )}

          {quickAddUnit && (
            <QuickAddLessonDrawer
              unitId={quickAddUnit.id}
              unitTitle={quickAddUnit.title}
              onClose={() => setQuickAddUnit(null)}
              onAdded={() => loadCourse()}
            />
          )}
        </>
      )}

      {activeTab === 'timeline' && (
        <YearTimeline units={units} course={course} />
      )}

      {activeTab === 'standards' && (
        <StandardsPanel courseId={courseId} course={course} units={units} />
      )}
    </div>
  )
}

// ─── Lesson Row ────────────────────────────────────────────────────

function LessonRow({ lesson, idx, courseId, sections, color, onDelete, onUpdateDate, onReload }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [segments, setSegments] = useState(lesson.lesson_segments || [])
  const [segLoaded, setSegLoaded] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const dateInputRef = useRef(null)

  useEffect(() => {
    if (editingDate) dateInputRef.current?.showPicker?.() || dateInputRef.current?.focus()
  }, [editingDate])

  // Inline edit states
  const [isAddingSegment, setIsAddingSegment] = useState(false)
  const [newSegmentTitle, setNewSegmentTitle] = useState('')
  const segmentInputRef = useRef(null)

  useEffect(() => {
    if (isAddingSegment) segmentInputRef.current?.focus()
  }, [isAddingSegment])

  function handleTrack() {
    if (!sections?.length) return
    if (sections.length === 1) {
      navigate(`/sections/${sections[0].id}/lessons/${lesson.id}`)
    } else {
      setShowSectionPicker(v => !v)
    }
  }

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

  async function handleAddSegment(e) {
    if (e) e.preventDefault()
    if (!newSegmentTitle.trim()) {
      setIsAddingSegment(false)
      return
    }
    const title = newSegmentTitle.trim()
    const { data } = await supabase
      .from('lesson_segments')
      .insert({ lesson_id: lesson.id, title, order_index: segments.length })
      .select()
      .single()
    setSegments(prev => [...prev, data])
    setNewSegmentTitle('')
    setIsAddingSegment(false)
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
        lesson_id: lesson.id, title: s.title, description: s.description || null,
        duration_minutes: s.duration_minutes || null, order_index: segments.length + i,
      }))

      const { data: newSegs } = await supabase.from('lesson_segments').insert(inserts).select()
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
        <div className={`w-1 h-4 rounded-full ${color.bg} opacity-60 shrink-0`} />
        <button onClick={handleExpand} className="flex-1 flex items-center gap-2 text-left min-w-0">
          <ChevronDownIcon className={clsx(
            'w-3.5 h-3.5 text-gray-300 shrink-0 transition-transform',
            !expanded && '-rotate-90'
          )} />
          <span className="text-sm text-gray-800 truncate">
            {idx + 1}. {lesson.title}
          </span>
          {segCount > 0 && (
            <span className="badge-gray shrink-0 text-xs">{segCount} seg</span>
          )}
          {lesson.duration_periods > 1 && (
            <span className="badge-gray shrink-0 text-xs">{lesson.duration_periods} periods</span>
          )}
          {/* ── Date badge ── */}
          {editingDate ? (
            <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
              <input
                ref={dateInputRef}
                type="date"
                defaultValue={lesson.target_date || ''}
                className="input text-xs py-0.5 px-2 h-7 w-36 border-navy-300 focus:ring-navy-400"
                autoFocus
                onBlur={() => setEditingDate(false)}
                onChange={async (e) => {
                  if (e.target.value) {
                    await onUpdateDate(lesson.id, e.target.value)
                    setEditingDate(false)
                  }
                }}
                onKeyDown={e => { if (e.key === 'Escape') setEditingDate(false) }}
              />
            </div>
          ) : lesson.target_date ? (
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0 group"
              onClick={e => { e.stopPropagation(); setEditingDate(true) }}
              title="Click to change date"
            >
              <CalendarDaysIcon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-semibold">
                {new Date(lesson.target_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <PencilSquareIcon className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 border-dashed hover:bg-amber-100 transition-colors shrink-0"
              onClick={e => { e.stopPropagation(); setEditingDate(true) }}
              title="No date set — click to add one"
            >
              <CalendarDaysIcon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">Add Date</span>
            </button>
          )}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {sections?.length > 0 && (
            <button
              className="btn-ghost p-1 text-navy-500 hover:bg-navy-50"
              onClick={handleTrack}
              title="Track this lesson"
            >
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            className="btn-ghost p-1 text-navy-500 hover:bg-navy-50"
            onClick={aiGenerateSegments}
            disabled={aiLoading}
            title="Suggest segments"
          >
            {aiLoading
              ? <span className="w-3.5 h-3.5 border-2 border-navy-400 border-t-transparent rounded-full animate-spin block" />
              : <Bars3Icon className="w-3.5 h-3.5" />
            }
          </button>
          <button className="btn-ghost p-1 text-red-400 hover:bg-red-50" onClick={onDelete}>
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Section picker — shown when course has multiple sections */}
      {showSectionPicker && sections?.length > 1 && (
        <div className="mx-4 mb-2 rounded-xl border border-navy-100 bg-navy-50/60 divide-y divide-navy-100 overflow-hidden">
          <p className="px-3 py-2 text-[11px] font-semibold text-navy-700 uppercase tracking-wide">Which period?</p>
          {sections.map(s => (
            <button
              key={s.id}
              className="w-full text-left px-3 py-2.5 text-xs text-gray-700 hover:bg-navy-100 flex items-center justify-between transition-colors"
              onClick={() => navigate(`/sections/${s.id}/lessons/${lesson.id}`)}
            >
              <span>{s.name}</span>
              <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />
            </button>
          ))}
        </div>
      )}

      {expanded && (
        <div className="bg-gray-50 px-4 pb-3 space-y-1.5 ml-7">
          {segments.length === 0 && <p className="text-xs text-gray-400 py-2">No segments yet.</p>}
          {segments.map(seg => (
            <div key={seg.id} className="flex items-center gap-2 py-1.5 px-3 bg-white rounded-lg border border-gray-100 text-sm">
              <span className="flex-1 text-gray-700 text-xs">{seg.title}</span>
              {seg.duration_minutes && <span className="text-xs text-gray-400 shrink-0">{seg.duration_minutes}m</span>}
              <button className="text-gray-300 hover:text-red-400" onClick={() => deleteSegment(seg.id)}>
                <TrashIcon className="w-3 h-3" />
              </button>
            </div>
          ))}
          {isAddingSegment ? (
            <form onSubmit={handleAddSegment} className="flex items-center gap-2">
              <input
                ref={segmentInputRef}
                className="input py-1.5 text-xs flex-1"
                placeholder="New segment title..."
                value={newSegmentTitle}
                onChange={e => setNewSegmentTitle(e.target.value)}
                onBlur={() => !newSegmentTitle && setIsAddingSegment(false)}
                onKeyDown={e => e.key === 'Escape' && setIsAddingSegment(false)}
              />
              <button type="submit" className="btn-primary py-1.5 px-3 text-xs">Save</button>
              <button type="button" onClick={() => setIsAddingSegment(false)} className="btn-secondary py-1.5 px-3 text-xs">
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button className="btn-ghost gap-1.5 text-xs mt-1" onClick={() => setIsAddingSegment(true)}>
              <PlusIcon className="w-3 h-3" />
              Add segment
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sections Panel — supports per-day times ─────────────────────

function SectionsPanel({ courseId, sections, onSectionsChange }) {
  const [showAdd, setShowAdd] = useState(false)
  const EMPTY_FORM = {
    name: '',
    meeting_days: [],
    meeting_time: '',
    end_time: '',
    start_date: '',
    end_date: '',
    room: '',
    // per-day overrides: { Monday: { start: '09:00', end: '09:55' }, Friday: { start: '10:00', end: '10:55' } }
    day_times: {},
    use_per_day: false,
  }
  const [form, setForm] = useState(EMPTY_FORM)
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

  // Update a single field (start or end) for a specific day
  function setDayTimeField(day, field, value) {
    setForm(f => ({
      ...f,
      day_times: {
        ...f.day_times,
        [day]: { ...(f.day_times[day] || {}), [field]: value },
      },
    }))
  }

  // Check if selected days have different times
  const hasMultipleTimes = form.use_per_day && form.meeting_days.length > 1

  async function handleAdd(e) {
    e.preventDefault()
    setAddLoading(true)
    setAddError(null)

    // Build the section data
    // day_times stores { day: { start, end } } per day when use_per_day is on
    // Otherwise, meeting_time + end_time hold single start/end
    const sectionData = {
      course_id:    courseId,
      name:         form.name,
      meeting_days: form.meeting_days,
      meeting_time: form.use_per_day ? null : (form.meeting_time || null),
      end_time:     form.use_per_day ? null : (form.end_time || null),
      start_date:   form.start_date || null,
      end_date:     form.end_date || null,
      day_times:    form.use_per_day ? form.day_times : null,
      room:         form.room || null,
    }

    const { data, error } = await supabase
      .from('sections')
      .insert(sectionData)
      .select()
      .single()

    setAddLoading(false)
    if (error) {
      // If extended columns don't exist yet, fall back to minimal insert
      if (error.message?.includes('day_times') || error.message?.includes('end_time')) {
        const fallback = {
          course_id:    courseId,
          name:         form.name,
          meeting_days: form.meeting_days,
          meeting_time: form.meeting_time || null,
          room:         form.room || null,
        }
        const { data: d2, error: e2 } = await supabase.from('sections').insert(fallback).select().single()
        if (e2) {
          setAddError(e2.message || 'Failed to add period')
        } else if (d2) {
          onSectionsChange(prev => [...prev, d2])
          setForm(EMPTY_FORM)
          setShowAdd(false)
        }
      } else {
        setAddError(error.message || 'Failed to add period')
      }
    } else if (data) {
      onSectionsChange(prev => [...prev, data])
      setForm(EMPTY_FORM)
      setShowAdd(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this class period?')) return
    await supabase.from('sections').delete().eq('id', id)
    onSectionsChange(prev => prev.filter(s => s.id !== id))
  }

  function formatTimeRange(start, end) {
    if (!start) return null
    const startStr = formatTimeCourse(start)
    if (!end) return startStr
    // Show "8:00 – 8:55 AM" (drop AM/PM from start if same period)
    const endStr = formatTimeCourse(end)
    const startPeriod = start.split(':')[0] >= 12 ? 'PM' : 'AM'
    const endPeriod   = end.split(':')[0]   >= 12 ? 'PM' : 'AM'
    if (startPeriod === endPeriod) {
      return `${startStr.replace(` ${startPeriod}`, '')} \u2013 ${endStr}`
    }
    return `${startStr} \u2013 ${endStr}`
  }

  function renderSectionTime(section) {
    if (section.day_times && Object.keys(section.day_times).length > 0) {
      const entries = Object.entries(section.day_times)
      if (entries.length === 1) {
        const v = entries[0][1]
        // Support both old string format and new {start,end} object
        return typeof v === 'object' ? formatTimeRange(v.start, v.end) : formatTimeCourse(v)
      }
      return entries.map(([day, v]) => {
        const timeStr = typeof v === 'object' ? formatTimeRange(v.start, v.end) : formatTimeCourse(v)
        return `${DAY_SHORT[day] || day.slice(0,3)} ${timeStr}`
      }).join('  ·  ')
    }
    return formatTimeRange(section.meeting_time, section.end_time)
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
          className="flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-800 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Add period
        </button>
      </div>

      {sections.length === 0 && !showAdd && (
        <div className="px-4 py-5 text-center">
          <p className="text-sm text-gray-400">No class periods yet</p>
          <p className="text-xs text-gray-300 mt-0.5">Add each period this course runs, including the days and time.</p>
        </div>
      )}

      {sections.length > 0 && (
        <div className="divide-y divide-gray-50">
          {sections.map(section => {
            const timeStr = renderSectionTime(section)
            return (
              <div key={section.id} className="flex items-center px-4 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{section.name}</p>
                  <div className="flex flex-wrap gap-3 mt-0.5">
                    {section.meeting_days?.length > 0 && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <CalendarDaysIcon className="w-3 h-3" />
                        {section.meeting_days.map(d => DAY_SHORT[d] || d.slice(0,3)).join(', ')}
                      </span>
                    )}
                    {timeStr && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" />
                        {timeStr}
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
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="border-t border-gray-100 bg-gray-50/60 px-4 py-4 space-y-3">
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
                      ? 'bg-navy-800 text-white border-navy-800'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {DAY_SHORT[day] || day}
                </button>
              ))}
            </div>
          </div>

          {/* Time section */}
          {form.meeting_days.length > 0 && (
            <div className="space-y-2">
              {/* Toggle for per-day times */}
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

          {addError && <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{addError}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={addLoading || !form.name} className="px-3 py-1.5 text-xs font-semibold text-white bg-navy-800 rounded-lg hover:bg-navy-900 disabled:opacity-40">
              {addLoading ? 'Adding...' : 'Add period'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}



// ─── Standards Panel ──────────────────────────────────────────────

function StandardsPanel({ courseId, course, units }) {
  const [file, setFile] = useState(null)
  const [standards, setStandards] = useState([]) // parsed standards
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setAnalysis(null)
    setStandards([])
    // Read as text for txt/csv, as base64 for pdf
    const ext = f.name.split('.').pop().toLowerCase()
    if (ext === 'pdf') {
      const reader = new FileReader()
      reader.onload = e => {
        const base64 = e.target.result.split(',')[1]
        parseStandards({ pdf: base64, filename: f.name })
      }
      reader.readAsDataURL(f)
    } else {
      const reader = new FileReader()
      reader.onload = e => parseStandards({ text: e.target.result, filename: f.name })
      reader.readAsText(f)
    }
  }

  async function parseStandards({ text, pdf, filename }) {
    setAnalyzing(true)
    try {
      const body = { filename }
      if (text) body.text = text.slice(0, 8000) // trim to avoid token limits
      if (pdf) body.pdf = pdf

      const res = await fetch('/api/ai/parse-standards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('Parse failed')
      const { standards: parsed } = await res.json()
      setStandards(parsed || [])
    } catch (err) {
      console.error('Standards parse failed:', err)
      // Fallback: just show raw text lines as standards
      if (text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5)
        setStandards(lines.slice(0, 50).map(l => ({ code: '', description: l })))
      }
    } finally {
      setAnalyzing(false)
    }
  }

  async function analyzeAlignment() {
    if (!standards.length || !units.length) return
    setAnalyzing(true)
    try {
      const unitSummaries = units.map(u => ({
        title: u.title,
        lessons: u.lessons.slice(0, 5).map(l => l.title),
      }))

      const res = await fetch('/api/ai/analyze-standards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: course?.subject,
          gradeLevel: course?.grade_level,
          standards: standards.slice(0, 30),
          units: unitSummaries,
        }),
      })

      if (!res.ok) throw new Error('Analysis failed')
      const { analysis: result } = await res.json()
      setAnalysis(result)
    } catch (err) {
      console.error('Analysis failed:', err)
      setAnalysis({ error: 'Analysis failed. Make sure your API key is configured.' })
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <DocumentTextIcon className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-sm text-gray-900">Upload Standards</h3>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Upload your state or district standards document (PDF, TXT, or CSV) and we'll compare them to your curriculum.
        </p>

        {!file ? (
          <div
            className={clsx(
              'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
              dragOver ? 'border-navy-400 bg-navy-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
          >
            <ArrowUpTrayIcon className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500 font-medium">Drop your standards file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse — PDF, TXT, CSV</p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.csv"
              className="hidden"
              onChange={e => handleFile(e.target.files[0])}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
            <DocumentTextIcon className="w-5 h-5 text-navy-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
              {analyzing && <p className="text-xs text-gray-400 mt-0.5">Reading standards...</p>}
              {!analyzing && standards.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{standards.length} standards found</p>
              )}
            </div>
            <button
              onClick={() => { setFile(null); setStandards([]); setAnalysis(null) }}
              className="text-gray-300 hover:text-gray-500"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Standards list */}
      {standards.length > 0 && !analyzing && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-sm text-gray-900">{standards.length} Standards</h3>
            {units.length > 0 && (
              <button
                onClick={analyzeAlignment}
                disabled={analyzing}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-navy-800 px-3 py-1.5 rounded-lg hover:bg-navy-900 disabled:opacity-40"
              >
                <DocumentTextIcon className="w-3.5 h-3.5" />
                Analyze alignment
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
            {standards.map((std, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                {std.code && (
                  <span className="text-xs font-mono font-semibold text-navy-700 bg-navy-50 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                    {std.code}
                  </span>
                )}
                <p className="text-xs text-gray-600 leading-relaxed">{std.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analysis results */}
      {analyzing && (
        <div className="card p-6 text-center">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Comparing standards to your curriculum...</p>
        </div>
      )}

      {analysis && !analyzing && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <CheckIcon className="w-4 h-4 text-emerald-500" />
            <h3 className="font-semibold text-sm text-gray-900">Standards Alignment</h3>
          </div>
          <div className="px-4 py-4">
            {analysis.error ? (
              <p className="text-sm text-red-500">{analysis.error}</p>
            ) : (
              <div className="space-y-4">
                {analysis.overview && (
                  <p className="text-sm text-gray-700 leading-relaxed">{analysis.overview}</p>
                )}
                {analysis.alignments?.map((item, i) => (
                  <div key={i} className="border border-gray-100 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx(
                        'text-xs font-medium px-2 py-0.5 rounded-full',
                        item.coverage === 'strong' ? 'bg-emerald-50 text-emerald-700' :
                        item.coverage === 'partial' ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      )}>
                        {item.coverage === 'strong' ? 'Well covered' : item.coverage === 'partial' ? 'Partially covered' : 'Gap'}
                      </span>
                      {item.standard_code && (
                        <span className="text-xs font-mono text-navy-700">{item.standard_code}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">{item.note}</p>
                  </div>
                ))}
                {analysis.gaps?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-2">Standards not yet covered:</p>
                    <ul className="space-y-1">
                      {analysis.gaps.map((g, i) => (
                        <li key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                          <span className="text-red-300 mt-0.5">•</span> {g}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!file && units.length === 0 && (
        <div className="text-center py-4">
          <p className="text-xs text-gray-400">Add units to your course first, then upload standards for alignment analysis.</p>
        </div>
      )}
    </div>
  )
}

// ─── Course Planner — single unified panel ────────────────────────────

function CoursePlanner({ course, onDone, onSkip }) {
  const [dates, setDates] = useState({ startDate: '', endDate: '' })
  const [holidays, setHolidays] = useState([])
  const [allocations, setAllocations] = useState([
    { id: 1, title: '', description: '', target_lessons: 10 },
    { id: 2, title: '', description: '', target_lessons: 10 },
  ])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('school_holidays').select('date').then(({ data }) => {
      if (data) setHolidays(data)
    })
  }, [])

  // ── Math ──────────────────────────────────────────────────────────
  const totalAvailable = useMemo(() => {
    if (!dates.startDate || !dates.endDate) return 0
    const start = new Date(dates.startDate + 'T12:00:00')
    const end   = new Date(dates.endDate   + 'T12:00:00')
    if (start > end) return 0
    const holidaySet = new Set(holidays.map(h => h.date))
    let count = 0
    const cur = new Date(start)
    while (cur <= end) {
      const d = cur.getDay()
      if (d !== 0 && d !== 6 && !holidaySet.has(cur.toISOString().split('T')[0])) count++
      cur.setDate(cur.getDate() + 1)
    }
    return count
  }, [dates, holidays])

  const totalAllocated = allocations.reduce((s, u) => s + (Number(u.target_lessons) || 0), 0)
  const remaining      = totalAvailable - totalAllocated
  const canBuild       = dates.startDate && dates.endDate && totalAvailable > 0
                         && allocations.some(a => a.title.trim())
                         && remaining >= 0

  // ── Allocation helpers ────────────────────────────────────────────
  const nextId = useRef(100)
  function addUnit() {
    setAllocations(p => [...p, { id: nextId.current++, title: '', description: '', target_lessons: 10 }])
  }
  function updateUnit(id, field, value) {
    setAllocations(p => p.map(a => a.id === id ? { ...a, [field]: value } : a))
  }
  function removeUnit(id) {
    if (allocations.length <= 1) return
    setAllocations(p => p.filter(a => a.id !== id))
  }

  // ── Build ─────────────────────────────────────────────────────────
  async function handleBuild() {
    const valid = allocations.filter(a => a.title.trim() && a.target_lessons > 0)
    if (!valid.length) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/scaffold-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId:   course.id,
          subject:    course.subject,
          gradeLevel: course.grade_level,
          units:      valid,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Build failed')
      }
      onDone()
    } catch (err) {
      console.error(err)
      setError(err.message)
      setGenerating(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="card overflow-hidden flex flex-col">

      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-0.5">
          <h3 className="font-bold text-gray-900 text-base">Plan your course</h3>
          <button onClick={onSkip} className="text-xs text-gray-400 hover:text-gray-600">Skip for now</button>
        </div>
        <p className="text-sm text-gray-400">Set your dates, allocate lessons to each unit, then let us build the outline.</p>
      </div>

      <div className="px-5 pt-4 pb-2 space-y-4">

        {/* ── Date range + live counter ── */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="label text-xs">Course starts</label>
            <input
              type="date"
              className="input text-sm"
              value={dates.startDate}
              onChange={e => setDates(d => ({ ...d, startDate: e.target.value }))}
            />
          </div>
          <div className="flex-1">
            <label className="label text-xs">Course ends</label>
            <input
              type="date"
              className="input text-sm"
              value={dates.endDate}
              onChange={e => setDates(d => ({ ...d, endDate: e.target.value }))}
            />
          </div>
          <div className={`shrink-0 rounded-xl px-4 py-2.5 text-center min-w-[80px] transition-colors ${
            totalAvailable > 0 ? 'bg-navy-50 border border-navy-100' : 'bg-gray-50 border border-gray-100'
          }`}>
            <p className={`text-2xl font-bold leading-tight ${totalAvailable > 0 ? 'text-navy-700' : 'text-gray-300'}`}>
              {totalAvailable || '—'}
            </p>
            <p className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold leading-tight">days</p>
          </div>
        </div>

        {holidays.length === 0 && dates.startDate && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
            Tip: Sync your school holidays from Profile → School Calendar so days off are auto-excluded.
          </p>
        )}

        {/* ── Pool bar ── */}
        {totalAvailable > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500 font-medium">Allocated</span>
              <span className={`font-bold ${remaining < 0 ? 'text-red-500' : remaining === 0 ? 'text-emerald-600' : 'text-navy-600'}`}>
                {totalAllocated} / {totalAvailable}{remaining !== 0 && ` · ${Math.abs(remaining)} ${remaining > 0 ? 'left' : 'over'}`}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${remaining < 0 ? 'bg-red-400' : remaining === 0 ? 'bg-emerald-400' : 'bg-navy-500'}`}
                style={{ width: `${Math.min(100, totalAvailable > 0 ? (totalAllocated / totalAvailable) * 100 : 0)}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Divider ── */}
        <div className="flex items-center gap-2 pt-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 shrink-0">Units</p>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

      </div>

      {/* ── Unit list ── */}
      <div className="px-5 pb-2 space-y-2 max-h-72 overflow-y-auto">
        {allocations.map((unit, idx) => (
          <div
            key={unit.id}
            className="flex flex-col gap-1.5 p-3 bg-gray-50 border border-gray-100 rounded-xl group relative"
          >
            <div className="flex items-center gap-2">
              <span className="w-5 text-center text-xs font-bold text-gray-300 shrink-0">{idx + 1}</span>
              <input
                className="input text-sm flex-1 font-semibold bg-white min-w-0"
                placeholder="Unit title  (e.g. Ecology)"
                value={unit.title}
                onChange={e => updateUnit(unit.id, 'title', e.target.value)}
              />
              {/* Lesson counter stepper */}
              <div className="flex items-center shrink-0 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <button
                  type="button"
                  className="px-2 py-1 text-gray-400 hover:text-navy-700 hover:bg-gray-50 text-base leading-none"
                  onClick={() => updateUnit(unit.id, 'target_lessons', Math.max(1, (Number(unit.target_lessons) || 1) - 1))}
                >−</button>
                <input
                  type="number"
                  min="1"
                  className="w-10 text-center text-sm font-bold text-navy-700 bg-transparent border-none p-0 focus:ring-0"
                  value={unit.target_lessons}
                  onChange={e => updateUnit(unit.id, 'target_lessons', parseInt(e.target.value) || 0)}
                />
                <button
                  type="button"
                  className="px-2 py-1 text-gray-400 hover:text-navy-700 hover:bg-gray-50 text-base leading-none"
                  onClick={() => updateUnit(unit.id, 'target_lessons', (Number(unit.target_lessons) || 0) + 1)}
                >+</button>
              </div>
              <span className="text-xs text-gray-400 shrink-0 hidden sm:block">lessons</span>
              {allocations.length > 1 && (
                <button
                  className="p-1 text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={() => removeUnit(unit.id)}
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="pl-7 pr-8">
              <input
                className="input text-xs w-full bg-white"
                placeholder="Topics to cover (optional — e.g. Food webs, Biomes, Climate)"
                value={unit.description}
                onChange={e => updateUnit(unit.id, 'description', e.target.value)}
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addUnit}
          className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-navy-600 font-medium text-sm hover:bg-navy-50 hover:border-navy-200 flex items-center justify-center gap-2 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Add unit
        </button>
      </div>

      {/* ── Footer ── */}
      <div className="px-5 py-4 border-t border-gray-100 bg-white mt-2">
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <button
          type="button"
          onClick={handleBuild}
          disabled={!canBuild || generating}
          className="btn-primary w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? (
            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Building course…</>
          ) : (
            canBuild ? `Build course · ${allocations.filter(a => a.title.trim()).length} unit${allocations.filter(a => a.title.trim()).length !== 1 ? 's' : ''}` : 'Fill in dates & at least one unit above'
          )}
        </button>
      </div>
    </div>
  )
}

