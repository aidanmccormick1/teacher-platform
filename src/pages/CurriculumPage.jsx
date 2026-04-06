import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import {
  PlusIcon,
  BookOpenIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

const SUBJECTS = [
  'Math', 'English / ELA', 'Science', 'History / Social Studies',
  'World Languages', 'Art', 'Music', 'Physical Education',
  'Computer Science', 'Special Education', 'Other',
]

const GRADES = [
  'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  'Mixed', 'College',
]

export default function CurriculumPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showNewCourse, setShowNewCourse] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('recent') 

  useEffect(() => { document.title = 'Curriculum Control | TeacherOS' }, [])

  useEffect(() => {
    if (profile) loadCourses()
  }, [profile])

  async function loadCourses() {
    setLoading(true)
    const { data, error } = await supabase
      .from('courses')
      .select(`*, units ( count ), sections ( count )`)
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
    
    if (error) setLoadError(true)
    else setCourses(data || [])
    setLoading(false)
  }

  const visibleCourses = useMemo(() => {
    let list = [...courses]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.subject?.toLowerCase().includes(q) ||
        c.grade_level?.toLowerCase().includes(q)
      )
    }
    if (sortBy === 'alpha') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    else if (sortBy === 'subject') list.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''))
    return list
  }, [courses, search, sortBy])

  async function deleteCourse(id) {
    if (!confirm('Delete this course and all its lessons?')) return
    await supabase.from('courses').delete().eq('id', id)
    setCourses(prev => prev.filter(c => c.id !== id))
    toast.success('Course deleted')
  }

  async function duplicateCourse(course) {
    toast.info('Duplicating course...')
    const { data: newCourse } = await supabase
      .from('courses')
      .insert({
        name: `${course.name} (Copy)`,
        subject: course.subject,
        grade_level: course.grade_level,
        teacher_id: profile.id,
        school_id: profile.school_id,
      })
      .select().single()

    if (newCourse) {
      navigate(`/courses/${newCourse.id}`)
      toast.success('Course duplicated')
    }
  }

  if (loading) return <LoadingSkeleton />
  if (loadError) return <LoadError onRetry={loadCourses} />

  return (
    <div className="space-y-8 animate-in pb-20">
      <header className="flex items-end justify-between border-b border-gray-100 pb-2">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-1">Curriculum Library</h1>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            Control Center
            <span className="w-1 h-1 bg-gray-300 rounded-full" />
            {courses.length} Active Courses
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowNewCourse(true)}>
          <PlusIcon className="w-4 h-4 mr-2" />
          Create Course
        </button>
      </header>

      {/* Roster & Controls */}
      <div className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 group">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-11 h-12 bg-gray-50/50 border-gray-200 focus:bg-white"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, subject, or grade..."
            />
          </div>
          <div className="flex items-center gap-2">
             <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-2">Sort By</span>
             {['Recent', 'Alpha', 'Subject'].map(opt => (
               <button
                 key={opt}
                 onClick={() => setSortBy(opt.toLowerCase())}
                 className={clsx(
                   "px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all",
                   sortBy === opt.toLowerCase() ? "bg-navy-800 text-white shadow-md" : "bg-white text-gray-500 border border-gray-100 hover:bg-gray-50"
                 )}
               >
                 {opt}
               </button>
             ))}
          </div>
        </div>

        {courses.length === 0 ? (
          <div className="card p-20 text-center border-dashed border-gray-300 bg-gray-50/50">
             <BookOpenIcon className="w-16 h-16 mx-auto mb-6 text-gray-200" />
             <h2 className="text-2xl font-black text-gray-900 mb-2">Build Your First Course</h2>
             <p className="text-gray-500 mb-8 max-w-sm mx-auto">Start organizing your curriculum by creating your first instructional course.</p>
             <button onClick={() => setShowNewCourse(true)} className="btn-primary px-10 py-4 shadow-xl">
               Start Planning
             </button>
          </div>
        ) : (
          <div className="grid gap-3">
             {visibleCourses.map(course => {
               const unitCount = course.units?.[0]?.count ?? 0
               return (
                  <div 
                    key={course.id}
                    onClick={() => navigate(`/courses/${course.id}`)}
                    className="card p-5 group flex items-center gap-5 hover:border-navy-200 hover:shadow-lg transition-all cursor-pointer active:scale-[0.99]"
                  >
                     <div className="w-12 h-12 rounded-2xl bg-navy-50 flex items-center justify-center shrink-0 group-hover:bg-navy-800 group-hover:text-white transition-colors duration-300">
                        <BookOpenIcon className="w-6 h-6" />
                     </div>
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                           <h3 className="text-lg font-black text-gray-900 group-hover:text-navy-900 transition-colors uppercase tracking-tight">{course.name}</h3>
                           <div className="badge badge-gray px-2 py-0.5">{course.subject}</div>
                        </div>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                           {unitCount} UNITS PLANNED · GRADE {course.grade_level}
                        </p>
                     </div>
                     <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                        <button 
                          onClick={(e) => { e.stopPropagation(); duplicateCourse(course) }}
                          className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:bg-navy-50 hover:text-navy-700 transition-all"
                        >
                           <DocumentDuplicateIcon className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteCourse(course.id) }}
                          className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-all"
                        >
                           <TrashIcon className="w-5 h-5" />
                        </button>
                        <ChevronRightIcon className="w-6 h-6 text-gray-300 ml-2" />
                     </div>
                  </div>
               )
             })}
          </div>
        )}
      </div>

      {showNewCourse && (
        <NewCourseModal
          profile={profile}
          onClose={() => setShowNewCourse(false)}
          onCreated={course => {
            setShowNewCourse(false)
            navigate(`/courses/${course.id}`)
          }}
        />
      )}
    </div>
  )
}

function NewCourseModal({ profile, onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name: '', subject: 'Other', grade_level: '9' })
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    setLoading(true)
    const { data, error } = await supabase.from('courses').insert({
      name: form.name,
      subject: form.subject,
      grade_level: form.grade_level,
      teacher_id: profile.id,
      school_id: profile.school_id
    }).select().single()
    
    if (data) onCreated(data)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/20 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8">
        <div className="h-1.5 w-full bg-gray-100 overflow-hidden">
           <div className="h-full bg-navy-800 transition-all duration-500" style={{ width: step === 1 ? '50%' : '100%' }} />
        </div>
        
        <div className="p-10">
          {step === 1 ? (
             <div className="space-y-6">
                <header>
                   <SparklesIcon className="w-8 h-8 text-amber-500 mb-4" />
                   <h3 className="text-2xl font-black text-gray-900 tracking-tight">Let's build your course</h3>
                   <p className="text-sm text-gray-500">What do you call this curriculum in your school?</p>
                </header>
                <div className="space-y-4">
                   <input 
                     autoFocus
                     value={form.name}
                     onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                     className="input text-lg h-16 shadow-inner"
                     placeholder="e.g. AP World History: Modern"
                   />
                </div>
                <div className="flex gap-4 pt-4">
                   <button onClick={onClose} className="btn-secondary flex-1 py-4">Cancel</button>
                   <button 
                     disabled={!form.name.trim()} 
                     onClick={() => setStep(2)} 
                     className="btn-primary flex-1 py-4 shadow-xl"
                   >
                     Next Step
                   </button>
                </div>
             </div>
          ) : (
             <div className="space-y-8">
                <div className="space-y-4">
                   <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest">Select Subject</label>
                   <div className="flex flex-wrap gap-2">
                      {SUBJECTS.map(s => (
                        <button key={s} onClick={() => setForm(f => ({ ...f, subject: s }))} className={clsx(
                           "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                           form.subject === s ? "bg-navy-800 text-white shadow-md scale-105" : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                        )}>{s}</button>
                      ))}
                   </div>
                </div>
                <div className="space-y-4">
                   <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest">Select Grade</label>
                   <div className="flex flex-wrap gap-2">
                      {GRADES.map(s => (
                        <button key={s} onClick={() => setForm(f => ({ ...f, grade_level: s }))} className={clsx(
                           "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                           form.grade_level === s ? "bg-navy-800 text-white shadow-md" : "bg-gray-100/50 text-gray-500"
                        )}>{s}</button>
                      ))}
                   </div>
                </div>
                <div className="flex gap-4 pt-6">
                   <button onClick={() => setStep(1)} className="btn-secondary flex-1 py-4">Back</button>
                   <button 
                     disabled={loading}
                     onClick={handleCreate} 
                     className="btn-primary flex-1 py-4 shadow-xl active:scale-95"
                   >
                     {loading ? 'Creating...' : 'Launch Course'}
                   </button>
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
       <div className="h-16 bg-gray-50 rounded-2xl w-1/3" />
       <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-50 rounded-2xl" />)}
       </div>
    </div>
  )
}

function LoadError({ onRetry }) {
  return (
    <div className="card p-12 text-center max-w-md mx-auto mt-20 border-rose-100 bg-rose-50/50">
       <ExclamationTriangleIcon className="w-12 h-12 text-rose-500 mx-auto mb-4" />
       <h2 className="text-xl font-black text-rose-900 mb-2">Load Failed</h2>
       <button onClick={onRetry} className="btn-primary bg-rose-600 hover:bg-rose-700">Retry</button>
    </div>
  )
}
