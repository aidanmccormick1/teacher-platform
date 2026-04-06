import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  doesSectionMeetToday,
  isClassNow,
  formatTime,
} from '@/lib/dateUtils'
import {
  ClockIcon,
  ChevronRightIcon,
  SparklesIcon,
  CalendarDaysIcon,
  BookOpenIcon,
  MapPinIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  AcademicCapIcon,
  ArrowPathIcon,
  SunIcon,
  MoonIcon,
  PencilSquareIcon,
  ListBulletIcon,
  ArrowRightIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckSolid } from '@heroicons/react/24/solid'
import { format } from 'date-fns'
import DailyDigest from '@/components/DailyDigest'
import ClassNotesDrawer from '@/components/ClassNotesDrawer'
import clsx from 'clsx'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const SHORT_DAYS = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' }

export default function DashboardPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [sections, setSections]       = useState([])
  const [allSections, setAllSections] = useState([])
  const [courses, setCourses]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(false)
  const [now, setNow]                 = useState(new Date())
  const [notesSection, setNotesSection] = useState(null)

  useEffect(() => { document.title = 'Teacher Dashboard | TeacherOS' }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (profile) {
      loadData()
    }
  }, [profile])

  async function loadData() {
    setLoading(true)
    setLoadError(false)

    try {
      const { data: courseData, error: courseErr } = await supabase
        .from('courses')
        .select('id, name, subject, grade_level, sections(id, name, meeting_days, meeting_time, room, course_id, end_time)')
        .eq('teacher_id', profile.id)
        .order('id')

      if (courseErr) throw courseErr

      if (!courseData?.length) {
        setCourses([])
        setSections([])
        setLoading(false)
        return
      }

      setCourses(courseData)
      const courseLookup = {}
      const allSectionsList = []
      courseData.forEach(c => {
        courseLookup[c.id] = c
        if (c.sections?.length) allSectionsList.push(...c.sections)
      })
      setAllSections(allSectionsList)

      const todaySections = allSectionsList.filter(s => doesSectionMeetToday(s.meeting_days))
      const sectionIds = todaySections.map(s => s.id)

      // Fetch progress and continuity context
      let progressMap = {}
      let continuityMap = {}

      if (sectionIds.length > 0) {
        const { data: progressData } = await supabase
          .from('lesson_progress')
          .select(`
            section_id, 
            lesson_id, 
            status, 
            last_segment_completed_index, 
            carry_over_note,
            lessons (
              id,
              title,
              order_index,
              units (
                id,
                title,
                lessons (id)
              )
            )
          `)
          .in('section_id', sectionIds)
          .order('updated_at', { ascending: false })

        progressData?.forEach(p => {
          if (!progressMap[p.section_id]) progressMap[p.section_id] = p
        })
      }

      const enriched = todaySections.map(section => ({
        ...section,
        course: courseLookup[section.course_id],
        isNow: isClassNow(section.meeting_time),
        progress: progressMap[section.id] || null,
      }))

      enriched.sort((a, b) => (a.meeting_time || '').localeCompare(b.meeting_time || ''))
      setSections(enriched)
    } catch (err) {
      console.error('Dashboard load error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const [generatingContinuity, setGeneratingContinuity] = useState({})

  async function generateContinuityForSection(sectionId) {
    const section = sections.find(s => s.id === sectionId)
    if (!section || !section.progress) return

    setGeneratingContinuity(prev => ({ ...prev, [sectionId]: true }))
    try {
      const res = await fetch('/api/ai/generate-continuity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonTitle: section.progress.lessons.title,
          lastSegmentTitle: `Segment #${(section.progress.last_segment_completed_index || 0) + 1}`,
          lastNote: section.progress.carry_over_note
        })
      })
      if (res.ok) {
        const data = await res.json()
        // Save the generated summary back to the progress record optionally, 
        // but for now we just show it in the UI/session.
        setSections(prev => prev.map(s => {
          if (s.id === sectionId) {
            return { ...s, aiContinuity: data }
          }
          return s
        }))
      }
    } catch (e) {
      console.error('Continuity generation failed', e)
    } finally {
      setGeneratingContinuity(prev => ({ ...prev, [sectionId]: false }))
    }
  }

  const greeting = getGreeting()
  const GreetIcon = greeting === 'evening' ? MoonIcon : SunIcon
  const firstName = profile?.full_name?.split(' ')[0] || 'Teacher'

  if (loading) return <LoadingSkeleton />
  if (loadError) return <LoadError onRetry={loadData} />
  if (allSections.length === 0) return <SetupPrompt navigate={navigate} />

  return (
    <div className="space-y-8 pb-20 animate-in">
      {/* ── Daily Snapshot Header ── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <GreetIcon className="w-6 h-6 text-amber-500" />
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
              Good {greeting}, {firstName}
            </h1>
          </div>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            {format(new Date(), 'EEEE, MMMM do')}
            <span className="w-1 h-1 bg-gray-300 rounded-full" />
            {sections.length} classes today
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatMini label="Courses" value={courses.length} icon={<BookOpenIcon className="w-4 h-4" />} />
          <StatMini label="Ahead/Behind" value="Manual" icon={<ArrowTrendingUpIcon className="w-4 h-4" />} color="text-amber-600" />
          <button 
            onClick={loadData}
            className="p-2.5 rounded-2xl bg-white border border-gray-100 hover:bg-gray-50 text-gray-400 transition-all shadow-sm"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ── Left: Planning Blocks ── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="section-header">Instructional Command Center</h2>
            <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400">
              <SparklesIcon className="w-3.5 h-3.5 text-navy-600" />
              AI Continuity Enabled
            </div>
          </div>

          <div className="space-y-4">
            {sections.map(section => (
              <PlanningBlock 
                key={section.id} 
                section={section} 
                navigate={navigate}
                onOpenNotes={() => setNotesSection(section)}
                onGenerateContinuity={() => generateContinuityForSection(section.id)}
                isGeneratingContinuity={generatingContinuity[section.id]}
              />
            ))}
            
            {sections.length === 0 && (
              <div className="card p-12 text-center bg-gray-50/50 border-dashed border-gray-200">
                <SunIcon className="w-12 h-12 mx-auto mb-3 text-gray-200" />
                <p className="text-gray-400 font-medium">No classes scheduled for today.</p>
                <button onClick={() => navigate('/schedule')} className="mt-4 text-xs font-bold text-navy-700 hover:underline">Manage Schedule</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Sidebar ── */}
        <aside className="space-y-8">
          <section className="card p-6 bg-navy-800 text-white border-0 shadow-xl overflow-hidden relative group">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all duration-500" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-navy-300 mb-4">Today's Focus</h3>
            <p className="text-lg font-bold leading-tight">
              Focus on formative assessments for Unit 4. Ensure students grasp fraction comparison before the quiz Friday.
            </p>
            <div className="mt-6 flex items-center gap-2 text-[11px] font-bold text-navy-200 uppercase tracking-wider bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-lg w-fit">
              <SparklesIcon className="w-3.5 h-3.5" />
              AI Recommendation
            </div>
          </section>

          <section className="card p-6 border-amber-100 bg-amber-50/30">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">Pacing Alert</h4>
                <p className="text-sm text-gray-700 leading-snug">
                  <strong>7th Grade ELA</strong> is currently 3 days behind the semester target. 
                </p>
                <button 
                  onClick={() => navigate('/school')}
                  className="mt-3 text-[11px] font-black text-amber-700 uppercase tracking-widest hover:underline flex items-center gap-1"
                >
                  Adjust Pacing <ArrowRightIcon className="w-3 h-3" />
                </button>
              </div>
            </div>
          </section>

          <WeekSidebar sections={allSections} />
        </aside>
      </div>

      {/* ── Notes Drawer ── */}
      {notesSection && (
        <ClassNotesDrawer
          section={notesSection}
          course={notesSection.course}
          onClose={() => setNotesSection(null)}
        />
      )}
    </div>
  )
}

function PlanningBlock({ section, navigate, onOpenNotes, onGenerateContinuity, isGeneratingContinuity }) {
  const { progress, aiContinuity } = section
  const lesson = progress?.lessons || null
  const unit = lesson?.units || null

  const isCompleted = progress?.status === 'completed'
  const isNow = section.isNow
  
  // Calculate progress
  const totalLessons = unit?.lessons?.length || 0
  const currentIdx = lesson ? lesson.order_index + 1 : 0
  const progressPct = totalLessons > 0 ? (currentIdx / totalLessons) * 100 : 0

  return (
    <div className={clsx(
      "planning-block group relative animate-in",
      isNow && "ring-2 ring-navy-600/20 bg-gradient-to-br from-white to-navy-50/20 shadow-lg"
    )}>
      {isNow && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-navy-600 text-[10px] font-black text-white uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Live Now
        </div>
      )}

      {/* Continuation UI (Smart Recap) */}
      {(aiContinuity || isGeneratingContinuity) && (
        <div className="absolute inset-x-0 -top-4 px-8 z-10 animate-in">
           <div className="bg-navy-800 text-white rounded-2xl p-4 shadow-xl border border-white/10 flex items-start gap-4">
              <SparklesIcon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                 {isGeneratingContinuity ? (
                   <div className="animate-pulse space-y-1">
                      <div className="h-2.5 bg-white/20 rounded w-1/4" />
                      <div className="h-2 bg-white/10 rounded w-full" />
                   </div>
                 ) : (
                   <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1">
                        <span className="text-[9px] font-black uppercase text-navy-400 block mb-0.5 tracking-widest">AI Recap</span>
                        <p className="text-[11px] leading-relaxed text-navy-50">{aiContinuity.recap}</p>
                      </div>
                      <div className="flex-1 md:border-l md:border-white/10 md:pl-4">
                        <span className="text-[9px] font-black uppercase text-navy-400 block mb-0.5 tracking-widest">Opening Move</span>
                        <p className="text-[11px] leading-relaxed text-amber-200 font-bold">{aiContinuity.nextStep}</p>
                      </div>
                   </div>
                 )}
              </div>
              {!isGeneratingContinuity && (
                <button onClick={() => { /* clear if needed or hide */ }} className="text-white/30 hover:text-white transition-colors">
                   <XMarkIcon className="w-4 h-4" />
                </button>
              )}
           </div>
        </div>
      )}

      <div className={clsx("flex flex-col md:flex-row gap-6", (aiContinuity || isGeneratingContinuity) && "mt-8")}>
        {/* Course & Metadata */}
        <div className="flex-none md:w-48">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">
             {formatTime(section.meeting_time)}  {section.room && `· Rm ${section.room}`}
          </span>
          <h3 className="text-lg font-black text-gray-900 leading-tight mb-1 group-hover:text-navy-800 transition-colors">
            {section.name}
          </h3>
          <p className="text-sm font-bold text-gray-400 truncate mb-4">{section.course?.name}</p>
          
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
              <span>Unit {unit?.id ? 'Progress' : '—'}</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden shadow-inner">
              <div className="h-full bg-navy-600 transition-all duration-700" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>

        {/* Content & Continuity */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="badge badge-gray">
                {unit?.title ? `Unit: ${unit.title}` : 'No Active Unit'}
              </span>
              {lesson && (
                <span className="text-[11px] font-bold text-gray-400">
                  Lesson {currentIdx} of {totalLessons}
                </span>
              )}
            </div>

            <h4 className="text-xl font-extrabold text-gray-900 leading-snug mb-3">
              {lesson?.title || 'Assign a lesson to begin planning...'}
            </h4>

            {/* Continuity Context */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <div className="flex items-start gap-2 text-xs">
                <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-gray-900 block mb-0.5 uppercase tracking-tighter text-[10px]">Stopped at</span>
                  <p className="text-gray-500 leading-relaxed italic">
                    {progress?.last_segment_completed_index !== undefined 
                      ? `Segment #${progress.last_segment_completed_index + 1}`
                      : 'Not started yet'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <PencilSquareIcon className="w-4 h-4 text-navy-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-gray-900 block mb-0.5 uppercase tracking-tighter text-[10px]">Previously</span>
                  <p className="text-gray-500 leading-relaxed truncate-2-lines italic">
                    {progress?.carry_over_note || 'No notes from last session.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button 
              onClick={() => lesson ? navigate(`/sections/${section.id}/lessons/${lesson.id}`) : navigate('/curriculum')}
              className={clsx(
                "flex-1 px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-[0.98]",
                lesson ? "bg-navy-800 text-white hover:bg-navy-900 hover:shadow-lg" : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              {isNow ? 'Open Lesson Tracker' : 'Continue Planning'}
            </button>
            <button 
              onClick={onOpenNotes}
              className="p-3 rounded-2xl border border-gray-100 text-gray-400 hover:text-navy-800 hover:bg-navy-50 hover:border-navy-100 transition-all shadow-sm"
              title="Class Log"
            >
              <CalendarDaysIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatMini({ label, value, icon, color = 'text-navy-800' }) {
  return (
    <div className="bg-white border border-gray-100 px-3 py-1.5 rounded-2xl shadow-sm flex items-center gap-3">
      <div className={clsx("p-1.5 rounded-xl bg-gray-50", color)}>{icon}</div>
      <div>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-tighter leading-none mb-0.5">{label}</p>
        <p className={clsx("text-[13px] font-black leading-none", color)}>{value}</p>
      </div>
    </div>
  )
}

function WeekSidebar({ sections }) {
  const dayName = format(new Date(), 'EEEE')
  
  const weekByDay = {}
  WEEKDAYS.forEach(d => { weekByDay[d] = [] })
  sections.forEach(s => {
    s.meeting_days?.forEach(d => {
      if (weekByDay[d]) weekByDay[d].push(s)
    })
  })

  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-gray-50 flex items-center justify-between">
        <h3 className="section-header !mb-0">Weekly Overview</h3>
        <SparklesIcon className="w-4 h-4 text-navy-400" />
      </div>
      <div className="p-2 space-y-1">
        {WEEKDAYS.map(day => (
          <div key={day} className={clsx(
            "flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-colors",
            day === dayName ? "bg-navy-50 text-navy-800" : "text-gray-400"
          )}>
            <span>{day}</span>
            <div className="flex gap-1">
              {[...Array(weekByDay[day]?.length || 0)].map((_, i) => (
                <div key={i} className={clsx("w-1.5 h-1.5 rounded-full", day === dayName ? "bg-navy-600" : "bg-gray-200")} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getGreeting() {
  const hr = new Date().getHours()
  if (hr < 12) return 'morning'
  if (hr < 17) return 'afternoon'
  return 'evening'
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-12 bg-gray-50 rounded-2xl w-2/3" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-gray-50 rounded-2xl" />)}
        </div>
        <div className="space-y-4">
          <div className="h-40 bg-gray-50 rounded-2xl" />
          <div className="h-40 bg-gray-50 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

function LoadError({ onRetry }) {
  return (
    <div className="card p-12 text-center max-w-lg mx-auto mt-12 bg-rose-50 border-rose-100">
      <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-4 text-rose-500" />
      <h2 className="text-xl font-black text-rose-900 mb-2">Something went wrong</h2>
      <p className="text-sm text-rose-700/70 mb-6">We couldn't load your planning sheet. This could be a connection issue.</p>
      <button onClick={onRetry} className="btn-primary bg-rose-600 hover:bg-rose-700 px-8">Retry Connection</button>
    </div>
  )
}

function SetupPrompt({ navigate }) {
  return (
    <div className="card p-16 text-center max-w-2xl mx-auto mt-12 border-dashed border-gray-300">
      <AcademicCapIcon className="w-16 h-16 mx-auto mb-6 text-navy-200" />
      <h2 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">Welcome to TeacherOS</h2>
      <p className="text-gray-500 mb-10 text-lg leading-relaxed">
        Your daily planning system is ready. To get started, set up your first course and schedule.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button onClick={() => navigate('/curriculum')} className="btn-primary px-10 py-4 shadow-xl">
          Build Curriculum
        </button>
        <button onClick={() => navigate('/schedule')} className="btn-secondary px-10 py-4 shadow-xl">
          Set My Schedule
        </button>
      </div>
    </div>
  )
}
