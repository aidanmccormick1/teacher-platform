import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

export default function SchoolPage() {
  const { profile } = useAuth()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalLessons: 0,
    completedLessons: 0,
    behindCount: 0,
  })

  useEffect(() => {
    document.title = 'School Overview | TeacherOS'
    if (profile?.id) loadData()
  }, [profile?.id])

  async function loadData() {
    setLoading(true)
    
    // Fetch all courses with their units and lessons
    const { data: courseData } = await supabase
      .from('courses')
      .select(`
        id, 
        name, 
        subject,
        units (
          id,
          title,
          lessons (
            id,
            title
          )
        )
      `)
      .eq('teacher_id', profile.id)

    if (!courseData) {
      setLoading(false)
      return
    }

    // Fetch all progress for these courses
    const { data: progressData } = await supabase
      .from('lesson_progress')
      .select('lesson_id, status')
      .eq('status', 'completed')

    const completedLessonIds = new Set(progressData?.map(p => p.lesson_id) || [])

    // Process data for analytics
    const processedCourses = courseData.map(course => {
      let total = 0
      let completed = 0
      
      course.units?.forEach(unit => {
        unit.lessons?.forEach(lesson => {
          total++
          if (completedLessonIds.has(lesson.id)) completed++
        })
      })

      const percent = total > 0 ? Math.round((completed / total) * 100) : 0
      
      // Manual Pacing Logic (Simulated for Now)
      // In a real app, we'd check against a 'target_date' field
      // For this demo, we'll mark as 'Behind' if less than 10% done and it's an older course
      const isBehind = percent < 20 && course.units?.length > 0

      return {
        ...course,
        totalLessons: total,
        completedLessons: completed,
        percent,
        pacing: isBehind ? 'Behind' : percent > 50 ? 'Ahead' : 'On Track'
      }
    })

    setCourses(processedCourses)
    
    const totalL = processedCourses.reduce((acc, c) => acc + c.totalLessons, 0)
    const completedL = processedCourses.reduce((acc, c) => acc + c.completedLessons, 0)
    const behindC = processedCourses.filter(c => c.pacing === 'Behind').length

    setStats({
      totalLessons: totalL,
      completedLessons: completedL,
      behindCount: behindC,
    })

    setLoading(false)
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-lg w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-2xl" />)}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-12 animate-in">
      <header>
        <h1 className="page-title">Curriculum Control</h1>
        <p className="text-sm text-gray-500 mt-1">High-level overview of school-wide progress.</p>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          label="Syllabus Progress" 
          value={`${stats.totalLessons > 0 ? Math.round((stats.completedLessons / stats.totalLessons) * 100) : 0}%`}
          sub={`${stats.completedLessons} of ${stats.totalLessons} lessons taught`}
          icon={<ChartBarIcon className="w-5 h-5" />}
          color="text-navy-600"
          bg="bg-navy-50"
        />
        <StatCard 
          label="Pacing Alerts" 
          value={stats.behindCount}
          sub={stats.behindCount === 1 ? 'Course needs attention' : 'Courses behind schedule'}
          icon={<ExclamationTriangleIcon className="w-5 h-5" />}
          color={stats.behindCount > 0 ? 'text-amber-600' : 'text-emerald-600'}
          bg={stats.behindCount > 0 ? 'bg-amber-50' : 'bg-emerald-50'}
        />
        <StatCard 
          label="Current Term" 
          value="Spring 2026"
          sub="Week 14 of 18"
          icon={<CalendarIcon className="w-5 h-5" />}
          color="text-indigo-600"
          bg="bg-indigo-50"
        />
      </div>

      {/* Course List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-header">Pacing by Course</h2>
          <div className="flex gap-2">
            <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase">
              <div className="w-2 h-2 rounded-full bg-emerald-500" /> On Track
            </span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase">
              <div className="w-2 h-2 rounded-full bg-amber-500" /> Behind
            </span>
          </div>
        </div>

        <div className="grid gap-4">
          {courses.map(course => (
            <div key={course.id} className="planning-block flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-bold text-gray-900 truncate">{course.name}</h3>
                  <span className={clsx(
                    'badge',
                    course.pacing === 'Behind' ? 'badge-amber' : 
                    course.pacing === 'Ahead' ? 'badge-teal' : 'badge-green'
                  )}>
                    {course.pacing}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{course.subject} · {course.totalLessons} Lessons Total</p>
              </div>

              <div className="flex-[2] space-y-2">
                <div className="flex justify-between text-[11px] font-bold text-gray-500">
                  <span>Curriculum Completion</span>
                  <span>{course.percent}%</span>
                </div>
                <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={clsx(
                      "h-full transition-all duration-500",
                      course.pacing === 'Behind' ? 'bg-amber-500' : 'bg-navy-600'
                    )}
                    style={{ width: `${course.percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <p>Step: {course.completedLessons} / {course.totalLessons}</p>
                  {course.pacing === 'Behind' && (
                    <p className="text-amber-600 font-medium">Risk: 2 units behind target</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {courses.length === 0 && (
            <div className="card p-12 text-center text-gray-400">
              <ChartBarIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No course data available yet.</p>
            </div>
          )}
        </div>
      </section>

      {/* Timeline Section */}
      <section className="card p-6 border-navy-100/50 bg-gradient-to-br from-white to-navy-50/30">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-navy-600 rounded-2xl text-white">
            <ArrowTrendingUpIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-extrabold text-gray-900 tracking-tight">Expected vs Actual Timeline</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-lg">
              TeacherOS compares your current lesson progress against the school's historical pacing targets.
            </p>
            
            <div className="mt-8 relative h-12 flex items-center">
              <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1 bg-gray-200 rounded-full" />
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-navy-600 rounded-full" style={{ width: '70%' }} />
              
              {/* Markers */}
              <TimelineMarker pos="0%" label="Start" />
              <TimelineMarker pos="25%" label="Unit 1" done />
              <TimelineMarker pos="50%" label="Unit 2" done />
              <TimelineMarker pos="70%" label="You are here" active />
              <TimelineMarker pos="85%" label="Target" warning />
              <TimelineMarker pos="100%" label="End" />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, sub, icon, color, bg }) {
  return (
    <div className="card p-6 flex flex-col justify-between min-h-[140px]">
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</span>
        <div className={clsx("p-2 rounded-xl", bg, color)}>
          {icon}
        </div>
      </div>
      <div>
        <div className={clsx("text-3xl font-black tracking-tight", color)}>{value}</div>
        <p className="text-xs text-gray-400 font-medium mt-1">{sub}</p>
      </div>
    </div>
  )
}

function TimelineMarker({ pos, label, done, active, warning }) {
  return (
    <div className="absolute top-0 -translate-x-1/2 flex flex-col items-center gap-2" style={{ left: pos }}>
      <div className={clsx(
        "w-3 h-3 rounded-full border-2",
        done ? "bg-navy-600 border-navy-600" : 
        active ? "bg-white border-navy-600 ring-4 ring-navy-100" :
        warning ? "bg-amber-500 border-amber-500" : "bg-white border-gray-300"
      )} />
      <span className={clsx(
        "text-[10px] font-bold whitespace-nowrap",
        active ? "text-navy-900" : warning ? "text-amber-600" : "text-gray-400"
      )}>
        {label}
      </span>
    </div>
  )
}
