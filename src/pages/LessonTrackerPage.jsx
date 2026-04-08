import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { todayISO } from '@/lib/dateUtils'
import { format } from 'date-fns'
import {
  CheckIcon,
  ChevronLeftIcon,
  ArrowPathIcon,
  SparklesIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckSolid } from '@heroicons/react/24/solid'
import clsx from 'clsx'

const STATUS = {
  PENDING:   'pending',
  DONE:      'done',
}

export default function LessonTrackerPage() {
  const { sectionId, lessonId } = useParams()
  const navigate = useNavigate()

  const [lesson,   setLesson]   = useState(null)
  const [segments, setSegments] = useState([])
  const [progress, setProgress] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  
  const [segState, setSegState] = useState({})
  const [activeNote, setActiveNote] = useState('')
  const [continuity, setContinuity] = useState(null)
  const [loadingContinuity, setLoadingContinuity] = useState(false)

  const saveTimeout = useRef(null)

  useEffect(() => {
    loadAll()
  }, [sectionId, lessonId])

  async function loadAll() {
    setLoading(true)
    const [lessonRes, segRes, progressRes] = await Promise.all([
      supabase.from('lessons').select('*, units(title, courses(name))').eq('id', lessonId).single(),
      supabase.from('lesson_segments').select('*').eq('lesson_id', lessonId).order('order_index'),
      supabase.from('lesson_progress')
        .select('*')
        .eq('lesson_id', lessonId)
        .eq('section_id', sectionId)
        .order('updated_at', { ascending: false })
        .limit(1)
    ])

    const lessonData = lessonRes.data
    const segmentsData = segRes.data || []
    const progressData = progressRes.data?.[0] || null

    setLesson(lessonData)
    setSegments(segmentsData)
    setProgress(progressData)
    setActiveNote(progressData?.carry_over_note || '')

    // Restore state
    const state = {}
    const lastIdx = progressData?.last_segment_completed_index ?? -1
    segmentsData.forEach((s, i) => {
      state[s.id] = i <= lastIdx ? STATUS.DONE : STATUS.PENDING
    })
    setSegState(state)
    setLoading(false)

    // Trigger Smart Continuity if not completed
    if (progressData?.status !== 'completed' && lessonData && lastIdx >= 0) {
      fetchContinuity(lessonData, segmentsData[lastIdx + 1]?.title, progressData?.carry_over_note)
    }
  }

  async function fetchContinuity(lessonData, nextSeg, lastNote) {
    setLoadingContinuity(true)
    try {
      const res = await fetch('/api/ai/generate-continuity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonTitle: lessonData.title,
          lastSegmentTitle: nextSeg ? `Before: ${nextSeg}` : 'End of lesson',
          lastNote: lastNote
        })
      })
      if (res.ok) {
        const data = await res.json()
        setContinuity(data)
      }
    } catch (e) {
      console.error('Continuity fetch failed', e)
    } finally {
      setLoadingContinuity(false)
    }
  }

  const debouncedSave = (newState, note) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      saveProgress(newState, note)
    }, 1000)
  }

  async function saveProgress(newState, note) {
    setSaving(true)
    const lastDoneIdx = segments.reduce((acc, seg, i) => {
      return newState[seg.id] === STATUS.DONE ? i : acc
    }, -1)

    const isComplete = lastDoneIdx === segments.length - 1 && segments.length > 0

    const record = {
      lesson_id: lessonId,
      section_id: sectionId,
      date_taught: todayISO(),
      status: isComplete ? 'completed' : 'in_progress',
      last_segment_completed_index: lastDoneIdx,
      carry_over_note: note,
      updated_at: new Date().toISOString(),
      ...(isComplete ? { completed_at: new Date().toISOString() } : {})
    }

    let err;
    if (progress?.id) {
      const { error } = await supabase.from('lesson_progress').update(record).eq('id', progress.id)
      err = error
    } else {
      const { data, error } = await supabase.from('lesson_progress').insert(record).select().single()
      if (data) setProgress(data)
      err = error
    }

    if (!err) setLastSaved(new Date())
    setSaving(false)
  }

  function handleToggle(segId) {
    const newState = {
      ...segState,
      [segId]: segState[segId] === STATUS.DONE ? STATUS.PENDING : STATUS.DONE
    }
    setSegState(newState)
    debouncedSave(newState, activeNote)
  }

  function handleNoteChange(e) {
    const val = e.target.value
    setActiveNote(val)
    debouncedSave(segState, val)
  }

  if (loading) return <LoadingSpinner />

  const lastDoneIdx = segments.reduce((acc, seg, i) => segState[seg.id] === STATUS.DONE ? i : acc, -1)
  const nextSegIdx = lastDoneIdx + 1

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-32 animate-in">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-navy-600 mb-2 transition-colors"
          >
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            Exit Tracker
          </button>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-tight">
            {lesson.title}
          </h1>
          <p className="text-sm font-bold text-gray-400 mt-1">
            {lesson.units?.courses?.name} · {lesson.units?.title}
          </p>
        </div>
        
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end gap-2 text-[10px] font-black uppercase tracking-widest mb-1.5">
            {saving ? (
              <span className="text-navy-600 flex items-center gap-1 animate-pulse">
                <ArrowPathIcon className="w-3 h-3 animate-spin" /> Saving...
              </span>
            ) : lastSaved ? (
              <span className="text-emerald-600 flex items-center gap-1">
                <CheckCircleIcon className="w-3 h-3" /> Saved {format(lastSaved, 'HH:mm')}
              </span>
            ) : (
              <span className="text-gray-300">Not saved</span>
            )}
          </div>
          <div className="h-2 w-32 bg-gray-100 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-navy-600 transition-all duration-700" 
              style={{ width: `${Math.round(((lastDoneIdx + 1) / segments.length) * 100)}%` }} 
            />
          </div>
        </div>
      </header>

      {/* Continuity / AI Intelligence */}
      { (loadingContinuity || continuity) && (
        <section className="card p-5 bg-gradient-to-br from-navy-800 to-navy-900 text-white border-0 shadow-xl relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/5 rounded-full blur-xl group-hover:bg-white/10 transition-all" />
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-navy-300 mb-3">
             <SparklesIcon className="w-3.5 h-3.5" />
             AI Recap
          </div>
          
          {loadingContinuity ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-3/4" />
              <div className="h-4 bg-white/10 rounded w-1/2" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <span className="text-[10px] font-bold text-navy-400 uppercase tracking-tighter block mb-0.5">Recap</span>
                <p className="text-[13px] leading-relaxed font-medium text-navy-50">{continuity.recap}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 border border-white/5 backdrop-blur-sm">
                <span className="text-[10px] font-bold text-navy-300 uppercase tracking-tighter block mb-1">Suggested Opening</span>
                <p className="text-sm font-bold text-white">{continuity.nextStep}</p>
              </div>
              {continuity.adjustment && (
                <div className="flex items-center gap-2 text-[11px] font-bold text-amber-300 bg-amber-400/10 px-2 py-1 rounded-lg w-fit">
                  <InformationCircleIcon className="w-3.5 h-3.5" />
                  {continuity.adjustment}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Segments List */}
      <section className="space-y-3">
        <h2 className="section-header">Lesson Flow</h2>
        <div className="grid gap-3">
          {segments.map((seg, i) => {
            const isDone = segState[seg.id] === STATUS.DONE
            const isActive = i === nextSegIdx
            
            return (
              <button
                key={seg.id}
                onClick={() => handleToggle(seg.id)}
                className={clsx(
                  "w-full text-left p-5 rounded-2xl border transition-all duration-200 flex items-start gap-4 active:scale-[0.99]",
                  isDone ? "bg-emerald-50/50 border-emerald-100 opacity-60" : 
                  isActive ? "bg-white border-navy-300 shadow-md ring-4 ring-navy-50" : "bg-white border-gray-100 hover:border-gray-200"
                )}
              >
                <div className={clsx(
                  "w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all duration-300",
                  isDone ? "bg-emerald-500 border-emerald-500" : 
                  isActive ? "border-navy-600 ring-4 ring-navy-100" : "border-gray-200"
                )}>
                  {isDone && <CheckIcon className="w-4 h-4 text-white stroke-[3px]" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-4 mb-0.5">
                    <h3 className={clsx(
                      "font-black tracking-tight transition-colors",
                      isDone ? "text-emerald-700 line-through" : "text-gray-900",
                      isActive && "text-navy-900"
                    )}>
                      {seg.title}
                    </h3>
                    {seg.duration_minutes && (
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{seg.duration_minutes}m</span>
                    )}
                  </div>
                  <p className={clsx(
                    "text-xs leading-relaxed",
                    isDone ? "text-emerald-600/70" : "text-gray-500"
                  )}>
                    {seg.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Quick Note / Carry over */}
      <section className="space-y-3">
        <h2 className="section-header">Planning Continuity</h2>
        <div className="card p-5 space-y-4">
          <div>
            <label className="label">Note for next session</label>
            <div className="relative group">
               <PencilSquareIcon className="absolute left-4 top-4 w-4 h-4 text-gray-400 group-focus-within:text-navy-600 transition-colors" />
               <textarea 
                 value={activeNote}
                 onChange={handleNoteChange}
                 placeholder="What should you remember for next session? Students struggled with... Finished halfway through activity... "
                 className="input pl-11 min-h-[120px] leading-relaxed"
               />
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 group">
             <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                <InformationCircleIcon className="w-4 h-4" />
                Automatic Position Sync
             </div>
             <p className="text-[11px] text-gray-500 leading-normal">
               TeacherOS is tracking your exact position. When you exit, this lesson will appear on your Dashboard exactly where you left off.
             </p>
          </div>
        </div>
      </section>

      {/* Primary Finish Action */}
      <button 
        onClick={() => navigate('/')}
        className="w-full py-4 rounded-2xl bg-navy-800 text-white text-sm font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-navy-900 hover:-translate-y-0.5 active:scale-95 transition-all"
      >
        Close & Sync Today's Progress
      </button>

    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
      <div className="w-10 h-10 border-4 border-navy-800 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-gray-400">Loading lesson...</p>
    </div>
  )
}
