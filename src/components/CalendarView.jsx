import { useMemo, useState } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { supabase } from '@/lib/supabase'
import { CalendarDaysIcon, ClockIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

export default function CalendarView({ course, sections, units, onReload }) {
  const [saving, setSaving] = useState(false)

  // 1. Flatten lessons from all units into a single array, sorted by unit order, then lesson order
  const lessons = useMemo(() => {
    let all = []
    units.forEach(u => {
      const sortedLessons = [...(u.lessons || [])].sort((a,b) => a.order_index - b.order_index)
      sortedLessons.forEach(l => {
        all.push({ ...l, unitTitle: u.title })
      })
    })
    return all
  }, [units])

  // 2. Determine class periods per week based on the first section's meeting days
  const baseSection = sections?.[0]
  const classDaysPerWeek = baseSection?.meeting_days?.length || 5

  // 3. Slot lessons into Weeks based on their duration
  const weeks = useMemo(() => {
    let weekList = []
    let currentWeekId = 1
    let currentWeekLessons = []
    let usedSpotsInWeek = 0

    lessons.forEach(lesson => {
      const needed = lesson.duration_periods || 1
      
      // If it doesn't fit in current week, push to next
      // (This is a simplified packing. If a lesson spans weeks, we just put it in the week it starts for UI simplicity)
      if (usedSpotsInWeek + needed > classDaysPerWeek && usedSpotsInWeek > 0) {
        weekList.push({ id: `week-${currentWeekId}`, title: `Week ${currentWeekId}`, items: currentWeekLessons })
        currentWeekId++
        currentWeekLessons = []
        usedSpotsInWeek = 0
      }

      currentWeekLessons.push(lesson)
      usedSpotsInWeek += needed

      // If it perfectly filled or overfilled, wrap
      if (usedSpotsInWeek >= classDaysPerWeek) {
        weekList.push({ id: `week-${currentWeekId}`, title: `Week ${currentWeekId}`, items: currentWeekLessons })
        currentWeekId++
        currentWeekLessons = []
        usedSpotsInWeek = 0
      }
    })

    if (currentWeekLessons.length > 0) {
      weekList.push({ id: `week-${currentWeekId}`, title: `Week ${currentWeekId}`, items: currentWeekLessons })
    }

    // Always show at least one empty week at the end for drag target
    weekList.push({ id: `week-${currentWeekId + 1}`, title: `Week ${currentWeekId + (currentWeekLessons.length ? 1 : 0)}`, items: [] })

    return weekList
  }, [lessons, classDaysPerWeek])

  async function handleDragEnd(result) {
    if (!result.destination) return

    const sourceId = result.source.droppableId // e.g. "week-1"
    const destId = result.destination.droppableId // e.g. "week-2"
    const sourceIndex = result.source.index
    const destIndex = result.destination.index

    // Find the lesson being dragged
    const sourceWeek = weeks.find(w => w.id === sourceId)
    const draggedLesson = sourceWeek.items[sourceIndex]

    if (!draggedLesson) return

    // Calculate new global index
    let newFlatList = [...lessons]
    const currentFlatIndex = newFlatList.findIndex(l => l.id === draggedLesson.id)
    newFlatList.splice(currentFlatIndex, 1) // remove

    // We must find the flat index corresponding to destId and destIndex
    let targetFlatIndex = 0
    let found = false
    let currentWeekIdNum = parseInt(destId.replace('week-', ''))
    
    // Sum all lessons prior to the destination week
    for (let i = 1; i < currentWeekIdNum; i++) {
        const wk = weeks.find(w => w.id === `week-${i}`)
        if (wk) targetFlatIndex += wk.items.length
    }
    targetFlatIndex += destIndex // Add the index within the destination week

    newFlatList.splice(targetFlatIndex, 0, draggedLesson)

    setSaving(true)

    // Fire bulk update to sync order_index (within their specific units)
    // To make it simple, we just assign sequential order_index globally or per-unit
    // Wait, lessons belong to disjoint units, but we allow dragging *across* units?
    // Native request: "Allow teachers to drag a lesson from Unit 1 into a specific Week 3 slot... pushing subsequent lessons forward."
    // If they drag a lesson, does it change Unit? No, just the sequential ordering mapping across the entire course.
    // However, units map linearly: Unit 1, Unit 2...
    // To strictly support this without changing unit logic, we can just assign the newly ordered lessons 
    // an order_index mapped 1 to N, BUT they might interleave units. 
    // If we want purely interleaf, we update their order_index directly, but units are loaded ordered by order_index.
    // Let's just update `order_index` on all lessons to match newFlatList order.
    
    // In Supabase, if we give them monotonic order_index across ALL lessons, we can sort them when querying.
    // BUT the units page groups by Unit. It's safe to just monotonic order them.
    const updates = newFlatList.map((l, i) => ({
        id: l.id,
        unit_id: l.unit_id,
        title: l.title,
        order_index: i
    }))

    const { error } = await supabase.from('lessons').upsert(updates)
    if (error) console.error("Error updating lesson order:", error)

    await onReload()
    setSaving(false)
  }

  return (
    <div className="mt-6 flex gap-6 overflow-x-auto pb-8 items-start relative min-h-[500px]">
      {saving && (
        <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center backdrop-blur-[1px]">
          <span className="bg-navy-800 text-white px-4 py-2 rounded-lg text-sm shadow-xl flex items-center gap-2 font-medium">
             <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
             Resolving Schedule...
          </span>
        </div>
      )}

      {sections?.length === 0 && (
         <div className="w-full text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200">
             <p className="text-gray-500 text-sm">Please set up a Class Period containing meeting days to map your calendar.</p>
         </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        {sections?.length > 0 && weeks.map((week) => (
          <div key={week.id} className="shrink-0 w-80 bg-gray-50 rounded-xl border border-gray-100 flex flex-col h-full max-h-[70vh]">
            <div className="p-3 border-b border-gray-200 bg-gray-100/50 rounded-t-xl sticky top-0 z-10">
              <h3 className="font-semibold text-gray-800 text-sm">{week.title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{classDaysPerWeek} class periods</p>
            </div>
            
            <Droppable droppableId={week.id}>
              {(provided, snapshot) => (
                <div 
                  className={clsx("flex-1 p-2 space-y-2 overflow-y-auto min-h-[150px] transition-colors", snapshot.isDraggingOver && 'bg-navy-50/50')}
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  {week.items.map((lesson, index) => (
                    <Draggable key={lesson.id} draggableId={lesson.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={clsx(
                            "group bg-white rounded-lg p-3 shadow-sm border text-left",
                            snapshot.isDragging ? "border-navy-400 ring-2 ring-navy-400/20 opacity-90 shadow-lg" : "border-gray-100 hover:border-gray-300"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-medium text-sm text-gray-900 leading-tight">{lesson.title}</h4>
                            {lesson.target_date && (
                                <CalendarDaysIcon className="w-4 h-4 text-emerald-500 shrink-0" title="Target Date Set" />
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-2">
                             <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400 truncate pr-2">
                               {lesson.unitTitle}
                             </p>
                             <div className="flex items-center gap-1 text-xs font-medium text-navy-600 bg-navy-50 px-2 py-0.5 rounded-full shrink-0">
                                <ClockIcon className="w-3 h-3" />
                                {lesson.duration_periods || 1}
                             </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </DragDropContext>
    </div>
  )
}
