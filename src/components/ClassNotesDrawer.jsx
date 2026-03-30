import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { format, parseISO, subDays } from 'date-fns'
import {
  XMarkIcon,
  PencilSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TrashIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

const TODAY = format(new Date(), 'yyyy-MM-dd')

export default function ClassNotesDrawer({ section, course, color, onClose }) {
  const { profile } = useAuth()
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [content, setContent]           = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [allNotes, setAllNotes]         = useState([]) // list of { date, content }
  const [loadingNotes, setLoadingNotes] = useState(true)
  const saveTimer = useRef(null)
  const textareaRef = useRef(null)

  // Load all notes for this section
  useEffect(() => {
    if (!profile || !section) return
    loadAllNotes()
  }, [profile, section])

  // Load note for selected date
  useEffect(() => {
    const note = allNotes.find(n => n.date === selectedDate)
    const c = note?.content || ''
    setContent(c)
    setSavedContent(c)
    setSaved(false)
  }, [selectedDate, allNotes])

  // Focus textarea when date changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [selectedDate])

  async function loadAllNotes() {
    setLoadingNotes(true)
    const { data } = await supabase
      .from('class_notes')
      .select('date, content')
      .eq('teacher_id', profile.id)
      .eq('section_id', section.id)
      .order('date', { ascending: false })
    setAllNotes(data || [])
    setLoadingNotes(false)
  }

  // Auto-save with debounce
  const autoSave = useCallback(async (text) => {
    if (!profile || !section) return
    setSaving(true)
    const { error } = await supabase
      .from('class_notes')
      .upsert({
        teacher_id: profile.id,
        section_id: section.id,
        date: selectedDate,
        content: text,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'teacher_id,section_id,date' })

    setSaving(false)
    if (!error) {
      setSavedContent(text)
      setSaved(true)
      // Update allNotes in memory
      setAllNotes(prev => {
        const idx = prev.findIndex(n => n.date === selectedDate)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], content: text }
          return updated
        }
        // Add new date entry
        return [{ date: selectedDate, content: text }, ...prev].sort((a, b) => b.date.localeCompare(a.date))
      })
      setTimeout(() => setSaved(false), 2000)
    }
  }, [profile, section, selectedDate])

  function handleChange(e) {
    const text = e.target.value
    setContent(text)
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autoSave(text), 800)
  }

  async function handleDelete() {
    if (!content.trim()) return
    if (!confirm('Clear this note?')) return
    const { error } = await supabase
      .from('class_notes')
      .delete()
      .eq('teacher_id', profile.id)
      .eq('section_id', section.id)
      .eq('date', selectedDate)
    if (!error) {
      setContent('')
      setSavedContent('')
      setAllNotes(prev => prev.filter(n => n.date !== selectedDate))
    }
  }

  // Build last 7 days for date selector
  const recentDates = Array.from({ length: 7 }, (_, i) => {
    const d = subDays(new Date(), i)
    return format(d, 'yyyy-MM-dd')
  })

  function prevDate() {
    const idx = recentDates.indexOf(selectedDate)
    if (idx < recentDates.length - 1) setSelectedDate(recentDates[idx + 1])
  }
  function nextDate() {
    const idx = recentDates.indexOf(selectedDate)
    if (idx > 0) setSelectedDate(recentDates[idx - 1])
  }

  const hasNote = (date) => allNotes.some(n => n.date === date && n.content?.trim())
  const isDirty = content !== savedContent

  function formatDateLabel(dateStr) {
    if (dateStr === TODAY) return 'Today'
    if (dateStr === format(subDays(new Date(), 1), 'yyyy-MM-dd')) return 'Yesterday'
    return format(parseISO(dateStr), 'EEE, MMM d')
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className={`px-5 pt-5 pb-4 border-b border-gray-100`}>
          <div className="flex items-center gap-3 mb-1">
            {/* Color accent */}
            <div className={`w-1 h-8 rounded-full ${color?.bg || 'bg-gray-300'} shrink-0`} />
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-gray-900 text-[15px] truncate">{section?.name}</h2>
              <p className="text-[12px] text-gray-400 truncate">{course?.name}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Date nav */}
        <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
          <button
            onClick={prevDate}
            disabled={recentDates.indexOf(selectedDate) >= recentDates.length - 1}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-all"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>

          <div className="flex-1 flex gap-1.5 overflow-x-auto scrollbar-none">
            {recentDates.map(date => {
              const isSelected = date === selectedDate
              const hasContent = hasNote(date)
              return (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`
                    shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all relative
                    ${isSelected
                      ? `${color?.bg || 'bg-gray-800'} text-white shadow-sm`
                      : 'text-gray-500 hover:bg-gray-100'
                    }
                  `}
                >
                  {date === TODAY ? 'Today' : format(parseISO(date), 'EEE d')}
                  {hasContent && !isSelected && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-navy-500" />
                  )}
                </button>
              )
            })}
          </div>

          <button
            onClick={nextDate}
            disabled={recentDates.indexOf(selectedDate) <= 0}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-all"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col p-5 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PencilSquareIcon className="w-4 h-4 text-gray-300" />
              <span className="text-[12px] font-semibold text-gray-400">
                {formatDateLabel(selectedDate)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {saving && (
                <span className="text-[11px] text-gray-300 font-medium">Saving…</span>
              )}
              {saved && !saving && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                  <CheckCircleIcon className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
              {content.trim() && (
                <button
                  onClick={handleDelete}
                  className="p-1 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all"
                  title="Clear note"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            placeholder={`Notes for ${formatDateLabel(selectedDate).toLowerCase()}…\n\nWhat happened in class? What do you need to follow up on?`}
            className="flex-1 w-full resize-none text-[14px] text-gray-800 placeholder-gray-300 leading-relaxed focus:outline-none font-normal"
            style={{ minHeight: 0 }}
          />
        </div>

        {/* Past notes list */}
        {allNotes.filter(n => n.date !== selectedDate && n.content?.trim()).length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4 overflow-y-auto max-h-[30%]">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <CalendarDaysIcon className="w-3.5 h-3.5" />
              Previous notes
            </p>
            <div className="space-y-3">
              {allNotes
                .filter(n => n.date !== selectedDate && n.content?.trim())
                .slice(0, 5)
                .map(note => (
                  <button
                    key={note.date}
                    onClick={() => setSelectedDate(note.date)}
                    className="w-full text-left group"
                  >
                    <p className="text-[11px] font-semibold text-gray-400 mb-0.5 group-hover:text-navy-700 transition-colors">
                      {format(parseISO(note.date), 'EEE, MMM d')}
                    </p>
                    <p className="text-[12px] text-gray-600 line-clamp-2 leading-relaxed">
                      {note.content}
                    </p>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
