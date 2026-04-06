import { useState, useMemo } from 'react'
import { CalendarDaysIcon, ClockIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

const UNIT_COLORS = [
  { bg: 'bg-blue-500',   light: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700' },
  { bg: 'bg-violet-500', light: 'bg-violet-50',  border: 'border-violet-200', text: 'text-violet-700' },
  { bg: 'bg-emerald-500',light: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-700' },
  { bg: 'bg-amber-500',  light: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700' },
  { bg: 'bg-rose-500',   light: 'bg-rose-50',    border: 'border-rose-200',   text: 'text-rose-700' },
  { bg: 'bg-cyan-500',   light: 'bg-cyan-50',    border: 'border-cyan-200',   text: 'text-cyan-700' },
  { bg: 'bg-orange-500', light: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-700' },
  { bg: 'bg-pink-500',   light: 'bg-pink-50',    border: 'border-pink-200',   text: 'text-pink-700' },
]

function colorForUnit(idx) {
  return UNIT_COLORS[idx % UNIT_COLORS.length]
}

export default function YearTimeline({ units, course, sections, holidays = [] }) {
  const [zoom, setZoom] = useState('month') // 'month' | 'week' | 'day'

  // ... (rest of parsedData useMemo remains the same)

  // Extract a flattened list of lessons mapped to their chronological occurrence
  const parsedData = useMemo(() => {
    let totalLessonsCount = 0
    let flatLessons = []
    
    units.forEach((u, uIdx) => {
      const sortedLessons = [...(u.lessons || [])].sort((a,b) => a.order_index - b.order_index)
      sortedLessons.forEach(l => {
        flatLessons.push({
          ...l,
          unitTitle: u.title,
          unitIndex: uIdx,
          color: colorForUnit(uIdx)
        })
      })
      totalLessonsCount += Math.max(u.lessons?.length || 1, 1)
    })
    
    return { flatLessons, totalLessonsCount }
  }, [units])

  if (units.length === 0) {
    return (
      <div className="card p-10 text-center">
        <CalendarDaysIcon className="w-8 h-8 text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-gray-400">No units yet. Add units to see them on the timeline.</p>
      </div>
    )
  }

  // To build a realistic representation:
  // We use chunks to represent the timeframe. 
  // Month: 10 chunks (Aug -> May)
  // Week: 40 chunks (40 weeks)
  // Day: Flat lessons sequentially
  
  let chunks = []
  
  if (zoom === 'month') {
      chunks = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']
  } else if (zoom === 'week') {
      chunks = Array.from({ length: 40 }, (_, i) => `W${i + 1}`)
  } else {
      chunks = parsedData.flatLessons.map((l, i) => `D${i + 1}`)
  }

  // Assign each unit a percentage width across the chosen chunks sequence dynamically
  let lessonCursor = 0
  const unitSlices = units.map((unit, i) => {
    const lessonsCount = Math.max(unit.lessons?.length || 1, 1)
    
    // Fallback logic if we want to guess dates, but simply distributing by percentage spans properly regardless of zoom
    const startPct = parsedData.totalLessonsCount > 0 ? (lessonCursor / parsedData.totalLessonsCount) * 100 : (i / units.length) * 100
    lessonCursor += lessonsCount
    const endPct = parsedData.totalLessonsCount > 0 ? (lessonCursor / parsedData.totalLessonsCount) * 100 : ((i + 1) / units.length) * 100
    
    return { unit, startPct, endPct, color: colorForUnit(i) }
  })

  // Determine an arbitrary "Today" marker line
  // If we had absolute dates mapped to chunks, we'd plot it accurately.
  // For now, representing middle of the sequence (e.g. 40%)
  const todayProgressPercent = 45 // Hardcoded for demo visualization

  return (
    <div className="card overflow-hidden">
      
      {/* Header and Controls */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Year at a glance</p>
        <div className="bg-gray-100 p-1 rounded-md flex">
           {['month', 'week', 'day'].map(z => (
               <button 
                  key={z} 
                  onClick={() => setZoom(z)} 
                  className={clsx(
                     "px-3 py-1 text-xs font-medium rounded transition-colors capitalize", 
                     zoom === z ? 'bg-white text-navy-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  )}
               >
                 {z}
               </button>
           ))}
        </div>
      </div>

      <div className="p-5 relative">
        {/* Timeline Axis Labels */}
        <div className="flex w-full mb-3 px-2">
          {zoom !== 'day' ? chunks.map(m => (
            <div key={m} className="flex-1 text-center">
              <span className="text-[10px] text-gray-400 font-medium truncate mix-blend-multiply">{m}</span>
            </div>
          )) : (
            <div className="flex w-full justify-between">
               <span className="text-[10px] text-gray-400 font-medium">Start of Term</span>
               <span className="text-[10px] text-gray-400 font-medium tracking-wide">Days</span>
               <span className="text-[10px] text-gray-400 font-medium">End of Term</span>
            </div>
          )}
        </div>

        {/* Timeline UI */}
        <div className="relative h-16 bg-gray-50/80 rounded-2xl border border-gray-200/50 shadow-inner flex overflow-hidden">
            {/* Units Bar Generation */}
            {unitSlices.map(({ unit, startPct, endPct, color }) => (
              <div
                key={unit.id}
                className={clsx(`h-full ${color.bg} flex flex-col justify-center px-2 overflow-hidden relative group cursor-pointer border-r border-white/20 last:border-r-0 transition-all hover:brightness-110`)}
                style={{ width: `${endPct - startPct}%` }}
                title={unit.title}
              >
                <span className="text-white text-xs font-bold truncate leading-tight drop-shadow-sm">
                  {unit.title}
                </span>
                {zoom === 'week' && endPct - startPct > 10 && (
                   <span className="text-white/70 text-[10px] truncate leading-tight font-medium mt-0.5 max-w-full">
                      {unit.lessons?.length || 0} Lessons
                   </span>
                )}
              </div>
            ))}
            
            {/* Holidays markers */}
            {holidays.map(h => {
              const hDate = new Date(h.date + 'T12:00:00')
              // Simple mapping: Aug 1 to May 31 (10 months)
              const startTerm = new Date(hDate.getFullYear() - (hDate.getMonth() < 7 ? 1 : 0), 7, 1)
              const endTerm = new Date(startTerm.getFullYear() + 1, 4, 31)
              const totalDays = (endTerm - startTerm) / 86400000
              const currentDays = (hDate - startTerm) / 86400000
              const pct = (currentDays / totalDays) * 100
              
              if (pct < 0 || pct > 100) return null

              return (
                <div
                  key={h.id}
                  className="absolute top-0 bottom-0 w-1 bg-white/40 ring-1 ring-white/20 z-10 group cursor-help transition-all hover:bg-white/80 hover:w-2"
                  style={{ left: `${pct}%` }}
                  title={h.name}
                >
                   <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-navy-800 text-white text-[9px] font-black px-2 py-0.5 rounded shadow whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                      {h.name}
                   </div>
                </div>
              )
            })}

            {/* The "Today" Marker Line */}
            <div 
              className="absolute top-0 bottom-0 w-[4px] bg-amber-500 z-30 flex flex-col shadow-lg group cursor-help transition-all"
              style={{ left: `${todayProgressPercent}%` }}
              title="Today's Date Marker"
            >
               <div className="absolute -top-7 left-1/2 transform -translate-x-1/2 bg-amber-600 text-white text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-widest shadow-xl opacity-100 group-hover:scale-110 transition-all whitespace-nowrap">
                   Now
               </div>
            </div>
        </div>
      </div>

      {/* Unit legend with behind-schedule indicators mapped from parsedData */}
      {zoom === 'day' ? (
         <div className="border-t border-gray-100 px-5 py-3 space-y-2 max-h-[300px] overflow-y-auto">
           {parsedData.flatLessons.map((l, idx) => {
              // Simulated checking: if lesson is behind Today marker and not completed (e.g. index < some fraction), highlight red
              const overallPercent = (idx / parsedData.totalLessonsCount) * 100
              const isBehindSchedule = overallPercent < todayProgressPercent 

              return (
                 <div key={l.id} className={clsx("flex items-center gap-3 py-1.5 px-3 rounded-md transition-colors", isBehindSchedule ? "bg-red-50" : "hover:bg-gray-50")}>
                    <div className={clsx("w-2 h-2 rounded-full shrink-0", isBehindSchedule ? "bg-red-400 animate-pulse" : l.color.bg)} />
                    <span className={clsx("text-sm font-medium flex-1 truncate", isBehindSchedule ? "text-red-900" : "text-gray-700")}>
                      {idx + 1}. {l.title}
                    </span>
                    <span className={clsx("text-[10px] uppercase font-bold tracking-wider", isBehindSchedule ? "text-red-400" : "text-gray-400")}>
                      {isBehindSchedule ? 'Overdue' : l.unitTitle}
                    </span>
                 </div>
              )
           })}
         </div>
      ) : (
        <div className="border-t border-gray-100 px-5 py-3 space-y-1">
          {unitSlices.map(({ unit, color }, i) => (
            <div key={unit.id} className="flex items-center gap-3 py-1.5">
              <div className={`w-3 h-3 rounded-sm ${color.bg} shrink-0`} />
              <span className="text-sm text-gray-700 font-medium flex-1 truncate">
                Unit {i + 1}: {unit.title}
              </span>
              <span className="text-xs text-gray-400 shrink-0">
                {unit.lessons.length} lesson{unit.lessons.length !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
