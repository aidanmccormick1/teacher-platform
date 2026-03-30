/**
 * InClassTracker
 *
 * A lightweight, flexible progress tracker shown on each class card.
 * Teachers mark where they are in today's lesson — bump forward/back freely.
 * Designed for real school days: unpredictable, interruptible, non-linear.
 *
 * State is persisted to lesson_progress in Supabase (reuses existing table).
 * Falls back to localStorage if there are no lessons loaded yet.
 *
 * Props:
 *   section    — the section object
 *   lessons    — array of { id, title, order_index } for this section's current unit
 *   color      — color scheme object
 *   compact    — boolean, show mini version inside card
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { format } from 'date-fns'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  ListBulletIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

const TODAY = format(new Date(), 'yyyy-MM-dd')

// Simple freeform tracker — no lessons needed, just a manual step counter
function FreeformTracker({ sectionId, color, compact }) {
  const storageKey = `tracker_${sectionId}_${TODAY}`
  const [step, setStep] = useState(() => {
    try { return parseInt(localStorage.getItem(storageKey) || '0', 10) } catch { return 0 }
  })
  const [total, setTotal] = useState(() => {
    try { return parseInt(localStorage.getItem(`${storageKey}_total`) || '4', 10) } catch { return 4 }
  })

  function save(newStep, newTotal) {
    try {
      localStorage.setItem(storageKey, String(newStep))
      localStorage.setItem(`${storageKey}_total`, String(newTotal))
    } catch {}
  }

  function bump(dir) {
    setStep(prev => {
      const next = Math.max(0, Math.min(total, prev + dir))
      save(next, total)
      return next
    })
  }

  function adjustTotal(dir) {
    setTotal(prev => {
      const next = Math.max(2, Math.min(10, prev + dir))
      const newStep = Math.min(step, next)
      setStep(newStep)
      save(newStep, next)
      return next
    })
  }

  const pct = total > 0 ? (step / total) * 100 : 0
  const done = step >= total

  if (compact) {
    return (
      <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => bump(-1)}
          disabled={step <= 0}
          className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:border-gray-300 disabled:opacity-30 transition-all shrink-0"
        >
          <ChevronLeftIcon className="w-3 h-3" />
        </button>

        {/* Progress dots */}
        <div className="flex gap-1 flex-1">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              onClick={() => { setStep(i + 1); save(i + 1, total) }}
              className={`
                flex-1 h-1.5 rounded-full transition-all duration-200
                ${i < step
                  ? (color?.bg || 'bg-navy-600')
                  : 'bg-gray-100 hover:bg-gray-200'
                }
              `}
            />
          ))}
        </div>

        <button
          onClick={() => bump(1)}
          disabled={done}
          className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:border-gray-300 disabled:opacity-30 transition-all shrink-0"
        >
          {done
            ? <CheckIcon className="w-3 h-3 text-emerald-500" />
            : <ChevronRightIcon className="w-3 h-3" />
          }
        </button>

        <span className="text-[11px] text-gray-400 font-medium shrink-0 min-w-[28px] text-right">
          {done ? '✓' : `${step}/${total}`}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-3" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500">Today's progress</p>
        <div className="flex items-center gap-1 text-[11px] text-gray-400">
          <button
            onClick={() => adjustTotal(-1)}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-gray-100 transition-all"
          >−</button>
          <span className="font-medium">{total} steps</span>
          <button
            onClick={() => adjustTotal(1)}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-gray-100 transition-all"
          >+</button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${done ? 'bg-emerald-400' : (color?.bg || 'bg-navy-600')}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => bump(-1)}
          disabled={step <= 0}
          className="flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-800 disabled:opacity-30 transition-all px-2 py-1 rounded-lg hover:bg-gray-100"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="flex-1 text-center">
          <span className="text-[13px] font-bold text-gray-900">
            {done ? 'Done!' : `Step ${step} of ${total}`}
          </span>
        </div>
        <button
          onClick={() => bump(1)}
          disabled={done}
          className="flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-800 disabled:opacity-30 transition-all px-2 py-1 rounded-lg hover:bg-gray-100"
        >
          Next
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// Lesson-based tracker — uses actual lesson titles from the curriculum
function LessonTracker({ sectionId, lessons, color, compact }) {
  const { profile } = useAuth()
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!profile || !sectionId || !lessons?.length) return
    loadProgress()
  }, [profile, sectionId, lessons])

  async function loadProgress() {
    const { data } = await supabase
      .from('lesson_progress')
      .select('lesson_id, status, last_segment_completed_index')
      .eq('section_id', sectionId)
      .eq('date_taught', TODAY)
      .order('last_segment_completed_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data?.lesson_id) {
      const idx = lessons.findIndex(l => l.id === data.lesson_id)
      if (idx >= 0) setCurrentIdx(idx)
    }
    setLoaded(true)
  }

  async function saveProgress(idx) {
    if (!profile || !lessons[idx]) return
    await supabase
      .from('lesson_progress')
      .upsert({
        section_id: sectionId,
        lesson_id: lessons[idx].id,
        teacher_id: profile.id,
        status: idx >= lessons.length - 1 ? 'completed' : 'in_progress',
        date_taught: TODAY,
        last_segment_completed_index: idx,
      }, { onConflict: 'section_id,lesson_id,date_taught' })
  }

  function bump(dir) {
    setCurrentIdx(prev => {
      const next = Math.max(0, Math.min(lessons.length - 1, prev + dir))
      saveProgress(next)
      return next
    })
  }

  function jumpTo(idx) {
    setCurrentIdx(idx)
    saveProgress(idx)
  }

  if (!loaded || !lessons?.length) return null

  const current = lessons[currentIdx]
  const done = currentIdx >= lessons.length - 1
  const pct = lessons.length > 1 ? (currentIdx / (lessons.length - 1)) * 100 : 100

  if (compact) {
    return (
      <div className="mt-2 space-y-1.5" onClick={e => e.stopPropagation()}>
        <p className="text-[11px] text-gray-500 truncate font-medium">
          <span className="text-gray-400 font-normal">Lesson {currentIdx + 1}/{lessons.length}: </span>
          {current?.title}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => bump(-1)}
            disabled={currentIdx <= 0}
            className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-all shrink-0"
          >
            <ChevronLeftIcon className="w-3 h-3" />
          </button>

          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-emerald-400' : (color?.bg || 'bg-navy-600')}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <button
            onClick={() => bump(1)}
            disabled={done}
            className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-all shrink-0"
          >
            {done
              ? <CheckIcon className="w-3 h-3 text-emerald-500" />
              : <ChevronRightIcon className="w-3 h-3" />
            }
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" onClick={e => e.stopPropagation()}>
      {/* Current lesson */}
      <div className={`rounded-xl px-3.5 py-2.5 ${color?.light || 'bg-gray-50'} border ${color?.border || 'border-gray-100'}`}>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
          On lesson {currentIdx + 1} of {lessons.length}
        </p>
        <p className={`text-[13px] font-semibold ${color?.text || 'text-gray-800'} leading-snug`}>
          {current?.title}
        </p>
      </div>

      {/* All lessons mini list */}
      <div className="space-y-1">
        {lessons.map((lesson, i) => (
          <button
            key={lesson.id}
            onClick={() => jumpTo(i)}
            className={`
              w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-all
              ${i === currentIdx
                ? `${color?.light || 'bg-gray-50'} border ${color?.border || 'border-gray-100'}`
                : 'hover:bg-gray-50'
              }
            `}
          >
            {i < currentIdx
              ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              : i === currentIdx
              ? <span className={`w-2 h-2 rounded-full shrink-0 ${color?.dot || 'bg-navy-500'} animate-pulse`} />
              : <span className="w-3.5 h-3.5 rounded-full border border-gray-200 shrink-0" />
            }
            <span className={`text-[12px] truncate ${i === currentIdx ? 'font-semibold text-gray-900' : i < currentIdx ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
              {lesson.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function InClassTracker({ section, lessons, color, compact = true }) {
  if (lessons?.length > 0) {
    return (
      <LessonTracker
        sectionId={section.id}
        lessons={lessons}
        color={color}
        compact={compact}
      />
    )
  }

  return (
    <FreeformTracker
      sectionId={section.id}
      color={color}
      compact={compact}
    />
  )
}
