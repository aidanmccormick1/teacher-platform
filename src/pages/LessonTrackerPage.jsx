import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { getNextClassDate, todayISO } from '@/lib/dateUtils'
import { format, addDays } from 'date-fns'
import {
  CheckIcon,
  ForwardIcon,
  ChevronLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftEllipsisIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

// Segment states
const STATUS = {
  PENDING:   'pending',
  DONE:      'done',
  SKIPPED:   'skipped',
  CARRYOVER: 'carryover',
}

export default function LessonTrackerPage() {
  const { sectionId, lessonId } = useParams()
  const navigate = useNavigate()

  const [lesson,   setLesson]   = useState(null)
  const [section,  setSection]  = useState(null)
  const [segments, setSegments] = useState([])
  const [progress, setProgress] = useState(null) // existing DB record
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)

  // Per-segment state: { [segmentId]: STATUS }
  const [segState, setSegState] = useState({})
  // Skip note input: { [segmentId]: string }
  const [skipNotes, setSkipNotes] = useState({})
  // Which segment has the skip input open
  const [skipOpen, setSkipOpen] = useState(null)

  // Carry-over modal
  const [showCarryModal, setShowCarryModal] = useState(false)
  const [carryNote, setCarryNote] = useState('')

  // Done modal
  const [showDoneModal, setShowDoneModal] = useState(false)

  const [overrides, setOverrides] = useState([])

  useEffect(() => {
    loadAll()
  }, [sectionId, lessonId])

  async function loadAll() {
    setLoading(true)

    const [lessonRes, sectionRes, segRes, progressRes, overrideRes] = await Promise.all([
      supabase.from('lessons').select('*, units(title, course_id, courses(name))').eq('id', lessonId).single(),
      supabase.from('sections').select('*').eq('id', sectionId).single(),
      supabase.from('lesson_segments').select('*').eq('lesson_id', lessonId).order('order_index'),
      supabase.from('lesson_progress')
        .select('*')
        .eq('lesson_id', lessonId)
        .eq('section_id', sectionId)
        .order('date_taught', { ascending: false })
        .limit(1),
      supabase.from('schedule_overrides')
        .select('override_date')
        .eq('section_id', sectionId)
        .eq('cancelled', true),
    ])

    setLesson(lessonRes.data)
    setSection(sectionRes.data)
    const segs = segRes.data || []
    setSegments(segs)
    setOverrides(overrideRes.data || [])

    const existingProgress = progressRes.data?.[0] || null
    setProgress(existingProgress)

    // Restore segment state from last progress
    if (existingProgress && segs.length > 0) {
      const lastIdx = existingProgress.last_segment_completed_index ?? -1
      const state = {}
      segs.forEach((seg, i) => {
        if (i <= lastIdx) state[seg.id] = STATUS.DONE
        else state[seg.id] = STATUS.PENDING
      })
      setSegState(state)
    } else {
      const state = {}
      segs.forEach(seg => { state[seg.id] = STATUS.PENDING })
      setSegState(state)
    }

    setLoading(false)
  }

  // ─── Computed ──────────────────────────────────────────────────

  const doneCount    = Object.values(segState).filter(s => s === STATUS.DONE).length
  const totalCount   = segments.length
  const progressPct  = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const allDone      = totalCount > 0 && doneCount === totalCount
  const hasIncomplete = segments.some(seg => segState[seg.id] === STATUS.PENDING)

  const cancelledDates = overrides.map(o => o.override_date)
  const nextClassDate  = section
    ? getNextClassDate(section.meeting_days, cancelledDates)
    : null
  const nextClassStr = nextClassDate ? format(nextClassDate, 'EEEE, MMM d') : null

  // ─── Segment actions ────────────────────────────────────────────

  function toggleSegment(segId) {
    setSegState(prev => ({
      ...prev,
      [segId]: prev[segId] === STATUS.DONE ? STATUS.PENDING : STATUS.DONE,
    }))
    if (skipOpen === segId) setSkipOpen(null)
  }

  function markSkipped(segId) {
    setSegState(prev => ({
      ...prev,
      [segId]: prev[segId] === STATUS.SKIPPED ? STATUS.PENDING : STATUS.SKIPPED,
    }))
    if (segState[segId] !== STATUS.SKIPPED) {
      setSkipOpen(segId)
    } else {
      setSkipOpen(null)
    }
  }

  function markCarryover(segId) {
    setSegState(prev => ({
      ...prev,
      [segId]: prev[segId] === STATUS.CARRYOVER ? STATUS.PENDING : STATUS.CARRYOVER,
    }))
  }

  // Slider: snap to nearest segment
  function handleSlider(e) {
    const val = Number(e.target.value) // 0–100
    const idx = Math.round((val / 100) * (totalCount - 1))
    const newState = {}
    segments.forEach((seg, i) => {
      newState[seg.id] = i <= idx ? STATUS.DONE : STATUS.PENDING
    })
    setSegState(newState)
  }

  // ─── Save + Done ─────────────────────────────────────────────────

  async function saveProgress() {
    setSaving(true)

    const lastDoneIdx = segments.reduce((acc, seg, i) => {
      if (segState[seg.id] === STATUS.DONE) return i
      return acc
    }, -1)

    const today = todayISO()
    const isComplete = !hasIncomplete

    const record = {
      lesson_id:                   lessonId,
      section_id:                  sectionId,
      date_taught:                 today,
      status:                      isComplete ? 'completed' : 'in_progress',
      last_segment_completed_index: lastDoneIdx,
      skip_reason:                 buildSkipSummary(),
      carry_over_note:             progress?.carry_over_note || null,
      updated_at:                  new Date().toISOString(),
      ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
    }

    if (progress?.id) {
      await supabase.from('lesson_progress').update(record).eq('id', progress.id)
    } else {
      await supabase.from('lesson_progress').insert(record)
    }

    setSaving(false)
  }

  function buildSkipSummary() {
    const skipped = segments
      .filter(seg => segState[seg.id] === STATUS.SKIPPED)
      .map(seg => {
        const note = skipNotes[seg.id]
        return note ? `${seg.title}: ${note}` : seg.title
      })
    return skipped.length > 0 ? skipped.join(' | ') : null
  }

  async function handleDoneForToday() {
    if (hasIncomplete) {
      setShowCarryModal(true)
    } else {
      await saveProgress()
      setShowDoneModal(true)
    }
  }

  async function handleCarryConfirm(carry) {
    setSaving(true)
    setShowCarryModal(false)

    const today = todayISO()
    const lastDoneIdx = segments.reduce((acc, seg, i) => {
      if (segState[seg.id] === STATUS.DONE) return i
      return acc
    }, -1)

    const record = {
      lesson_id:                    lessonId,
      section_id:                   sectionId,
      date_taught:                  today,
      status:                       carry ? 'in_progress' : 'completed',
      last_segment_completed_index:  lastDoneIdx,
      skip_reason:                  buildSkipSummary(),
      carry_over_note:              carry ? (carryNote || 'Continuing from last class') : null,
      updated_at:                   new Date().toISOString(),
      ...(!carry ? { completed_at: new Date().toISOString() } : {}),
    }

    if (progress?.id) {
      await supabase.from('lesson_progress').update(record).eq('id', progress.id)
    } else {
      await supabase.from('lesson_progress').insert(record)
    }

    setSaving(false)
    setShowDoneModal(true)
  }

  // ─── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-navy-800 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!lesson || !section) {
    return <p className="text-gray-500 py-12 text-center">Lesson not found.</p>
  }

  const courseName = lesson?.units?.courses?.name || ''
  const unitName   = lesson?.units?.title || ''

  return (
    <div className="space-y-4 pb-24">
      {/* Back nav */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ChevronLeftIcon className="w-4 h-4" />
        Back
      </button>

      {/* Header */}
      <div className="card p-4">
        <p className="text-xs text-gray-400 mb-1">
          {courseName} · {section.name} · {unitName}
        </p>
        <h1 className="page-title">{lesson.title}</h1>
        {lesson.estimated_duration_minutes && (
          <p className="text-sm text-gray-400 mt-0.5">
            ~{lesson.estimated_duration_minutes} min
          </p>
        )}

        {/* Carry-over note from last class */}
        {progress?.carry_over_note && (
          <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
            <ChatBubbleLeftEllipsisIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>From last class:</strong> {progress.carry_over_note}
            </p>
          </div>
        )}
      </div>

      {/* Progress slider */}
      {totalCount > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">
              Progress
            </span>
            <span className={clsx(
              'text-sm font-semibold',
              progressPct === 100 ? 'text-teal-600' : 'text-navy-800'
            )}>
              {progressPct}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={progressPct}
            onChange={handleSlider}
            className="w-full"
            style={{
              background: `linear-gradient(to right, #0d9488 0%, #0d9488 ${progressPct}%, #e5e7eb ${progressPct}%, #e5e7eb 100%)`
            }}
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">Start</span>
            <span className="text-xs text-gray-400">Done</span>
          </div>
        </div>
      )}

      {/* Segments */}
      <div className="space-y-2">
        <p className="section-header">Segments</p>
        {segments.length === 0 && (
          <div className="card p-6 text-center text-sm text-gray-400">
            No segments added yet. Go to Curriculum to add them.
          </div>
        )}
        {segments.map((seg, idx) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            idx={idx}
            state={segState[seg.id] || STATUS.PENDING}
            skipNote={skipNotes[seg.id] || ''}
            isSkipOpen={skipOpen === seg.id}
            onToggle={() => toggleSegment(seg.id)}
            onSkip={() => markSkipped(seg.id)}
            onCarryover={() => markCarryover(seg.id)}
            onSkipNoteChange={note => setSkipNotes(prev => ({ ...prev, [seg.id]: note }))}
            onCloseSkip={() => setSkipOpen(null)}
          />
        ))}
      </div>

      {/* Done for today button — sticky on mobile */}
      <div className="fixed bottom-0 left-0 right-0 md:relative md:bottom-auto p-4 bg-white border-t border-gray-100 md:border-0 md:p-0 md:bg-transparent">
        <div className="max-w-4xl mx-auto flex gap-3">
          <button
            onClick={saveProgress}
            disabled={saving}
            className="btn-secondary flex-shrink-0"
          >
            {saving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
          <button
            onClick={handleDoneForToday}
            disabled={saving}
            className="btn-primary flex-1 py-3"
          >
            Done for today
          </button>
        </div>
      </div>

      {/* Carry-over modal */}
      {showCarryModal && (
        <Modal onClose={() => setShowCarryModal(false)}>
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Carry remaining segments?</h3>
            <p className="text-sm text-gray-500">
              {segments.filter(s => segState[s.id] === STATUS.PENDING).length} segments weren't covered.
              {nextClassStr && ` They'll appear at the top of your next class (${nextClassStr}).`}
            </p>

            <div>
              <label className="label">Add a note for next class (optional)</label>
              <textarea
                className="input resize-none"
                rows={2}
                placeholder="e.g. Start with the group activity from where we left off"
                value={carryNote}
                onChange={e => setCarryNote(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => handleCarryConfirm(false)}
              >
                No, mark complete
              </button>
              <button
                className="btn-primary flex-1"
                onClick={() => handleCarryConfirm(true)}
              >
                Yes, carry over
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Done modal */}
      {showDoneModal && (
        <Modal onClose={() => { setShowDoneModal(false); navigate(-1) }}>
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center mx-auto">
              <CheckIcon className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Saved!</h3>
              {nextClassStr && (
                <p className="text-sm text-gray-500 mt-1">
                  Next class: {nextClassStr}
                </p>
              )}
            </div>
            <button
              className="btn-primary w-full"
              onClick={() => { setShowDoneModal(false); navigate(-1) }}
            >
              Back to dashboard
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Segment Row ────────────────────────────────────────────────────

function SegmentRow({ seg, idx, state, skipNote, isSkipOpen, onToggle, onSkip, onCarryover, onSkipNoteChange, onCloseSkip }) {
  const isDone      = state === STATUS.DONE
  const isSkipped   = state === STATUS.SKIPPED
  const isCarryover = state === STATUS.CARRYOVER

  return (
    <div className={clsx(
      'card transition-all duration-150',
      isDone && 'bg-teal-50 border-teal-100',
      isSkipped && 'bg-gray-50 border-gray-100 opacity-70',
      isCarryover && 'bg-amber-50 border-amber-100',
    )}>
      <div className="p-3.5 flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          className={clsx(
            'w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all',
            isDone
              ? 'bg-teal-500 border-teal-500'
              : 'border-gray-200 hover:border-gray-300 bg-white'
          )}
        >
          {isDone && <CheckIcon className="w-3.5 h-3.5 text-white stroke-[3]" />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx(
              'text-sm font-medium',
              isDone ? 'line-through text-teal-600' : 'text-gray-900',
              isSkipped && 'line-through text-gray-400',
            )}>
              {seg.title}
            </span>
            {seg.duration_minutes && (
              <span className="text-xs text-gray-400 shrink-0">
                {seg.duration_minutes}m
              </span>
            )}
          </div>
          {seg.description && (
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{seg.description}</p>
          )}

          {/* Status badges */}
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {isSkipped && (
              <span className="badge-gray">Skipped</span>
            )}
            {isCarryover && (
              <span className="badge-amber">Carrying over</span>
            )}
          </div>

          {/* Skip note input */}
          {isSkipOpen && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={skipNote}
                onChange={e => onSkipNoteChange(e.target.value)}
                placeholder="Note for next class..."
                className="input text-xs py-1.5 flex-1"
                autoFocus
              />
              <button onClick={onCloseSkip} className="btn-ghost p-1.5">
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onSkip}
            title="Skip (intentional)"
            className={clsx(
              'p-1.5 rounded-lg transition-all text-xs',
              isSkipped
                ? 'bg-gray-200 text-gray-600'
                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
            )}
          >
            <ForwardIcon className="w-4 h-4" />
          </button>
          <button
            onClick={onCarryover}
            title="Carry over to next class"
            className={clsx(
              'p-1.5 rounded-lg transition-all',
              isCarryover
                ? 'bg-amber-200 text-amber-700'
                : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50'
            )}
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        {children}
      </div>
    </div>
  )
}
