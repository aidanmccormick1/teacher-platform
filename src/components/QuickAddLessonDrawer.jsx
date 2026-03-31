import { useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { supabase } from '@/lib/supabase'

export default function QuickAddLessonDrawer({ unitId, unitTitle, onClose, onAdded }) {
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(1)
  const [targetDate, setTargetDate] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)

    const { data: lessonData } = await supabase
      .from('lessons')
      .insert({
        unit_id: unitId,
        title: title.trim(),
        duration_periods: duration,
        target_date: targetDate || null,
        // Insert at the end by default; order indexing usually handled by mapping
        order_index: 999 
      })
      .select()
      .single()

    setLoading(false)
    if (lessonData) {
      onAdded(lessonData)
      onClose()
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white shadow-2xl border-l border-gray-100 flex flex-col transition-transform transform translate-x-0">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add Lesson</h2>
            <p className="text-xs text-gray-500 font-medium tracking-wide uppercase mt-0.5">{unitTitle}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-50 transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <form id="add-lesson-form" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label text-sm text-gray-700">Lesson Title</label>
              <input 
                required 
                autoFocus
                className="input focus:ring-2 focus:ring-navy-500" 
                placeholder="e.g. The Federalist Papers" 
                value={title} 
                onChange={e => setTitle(e.target.value)} 
              />
            </div>
            <div>
              <label className="label text-sm text-gray-700">Duration (Class Periods)</label>
              <input 
                type="number" 
                min="1"
                required 
                className="input cursor-ns-resize focus:ring-2 focus:ring-navy-500" 
                value={duration} 
                onChange={e => setDuration(parseInt(e.target.value) || 1)} 
              />
              <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">Number of scheduled periods this lesson requires to complete.</p>
            </div>
            <div>
              <label className="label text-sm text-gray-700">Target Date (Optional)</label>
              <input 
                type="date"
                className="input focus:ring-2 focus:ring-navy-500" 
                value={targetDate} 
                onChange={e => setTargetDate(e.target.value)} 
              />
              <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">Leave blank to let the Smart Schedule automatically slot this lesson into the next available period.</p>
            </div>
          </form>
        </div>
        <div className="p-5 border-t border-gray-100 bg-gray-50/80 flex gap-3 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 font-medium shadow-sm hover:shadow">Cancel</button>
          <button type="submit" form="add-lesson-form" disabled={loading || !title} className="btn-primary flex-1 py-2.5 font-medium shadow shadow-navy-200/50">
            {loading ? 'Saving...' : 'Add Lesson'}
          </button>
        </div>
      </div>
    </>
  )
}
