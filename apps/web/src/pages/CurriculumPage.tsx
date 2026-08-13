import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { CourseListResponse } from '@teacheros/contracts';

import { CourseEditWorkspace } from '../components/CourseEditWorkspace.js';
import { EditFocusDialog } from '../components/EditFocusDialog.js';
import { TeachingDataImporter } from '../components/TeachingDataImporter.js';
import { ApiError, useApiClient } from '../lib/api.js';

type CourseRow = CourseListResponse['courses'][number];

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function CurriculumPage() {
  const api = useApiClient();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [courseToEdit, setCourseToEdit] = useState<CourseRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadCourses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listCourses();
      setCourses(data.courses);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load curriculum');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  return (
    <div className="stack">
      <h1>Curriculum</h1>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}

      <div className="card row spread">
        <div>
          <h3>Build your curriculum</h3>
          <p className="muted">Start a Course manually or bring in the details you already have.</p>
        </div>
        <div className="row">
          <button className="secondary" type="button" onClick={() => setImportOpen(true)}>
            Import curriculum
          </button>
          <button type="button" onClick={() => setCreateOpen(true)}>
            Add course
          </button>
        </div>
      </div>

      <EditFocusDialog
        open={importOpen}
        title="Import curriculum"
        description="Review imported details in a dedicated workspace before changing your courses."
        onClose={() => setImportOpen(false)}
      >
        <TeachingDataImporter
          onApplied={async () => {
            await loadCourses();
            setImportOpen(false);
          }}
        />
      </EditFocusDialog>

      <EditFocusDialog
        open={createOpen}
        title="Add course"
        description="Create this Course, then return to the curriculum list when you are done."
        onClose={() => setCreateOpen(false)}
        busy={saving}
      >
        <div className="stack">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Course name (required)"
          />
          <input
            className="input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject (optional)"
          />
          <input
            className="input"
            value={gradeLevel}
            onChange={(event) => setGradeLevel(event.target.value)}
            placeholder="Grade level (optional)"
          />
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={async () => {
              try {
                setSaving(true);
                await api.createCourse({
                  name: name.trim(),
                  subject: toNullable(subject),
                  gradeLevel: toNullable(gradeLevel)
                });
                setName('');
                setSubject('');
                setGradeLevel('');
                await loadCourses();
                setCreateOpen(false);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Failed to create course');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Creating...' : 'Create course'}
          </button>
        </div>
      </EditFocusDialog>

      <div className="card stack">
        <h3>Courses</h3>
        {loading ? <p className="muted">Loading courses...</p> : null}
        {!loading && courses.length === 0 ? (
          <p className="muted">No courses yet. Create your first one above.</p>
        ) : null}
        {courses.map((course) => (
          <div key={course.id} className="card stack">
            <div>
              <strong>{course.name}</strong>
              <p className="muted">
                {course.subject ?? 'No subject'} | {course.gradeLevel ?? 'No grade level'}
              </p>
            </div>
            <div className="row">
              <Link className="button-link secondary" to={`/courses/${course.id}`}>
                Open course
              </Link>
              <button
                className="secondary"
                type="button"
                onClick={() => setCourseToEdit(course)}
              >
                Edit course
              </button>
              <button
                type="button"
                onClick={async () => {
                  const confirmDelete = window.confirm(
                    `Delete course "${course.name}" and all nested units/lessons/segments?`
                  );
                  if (!confirmDelete) return;
                  try {
                    setSaving(true);
                    await api.deleteCourse(course.id);
                    await loadCourses();
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Failed to delete course');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <CourseEditWorkspace
        course={courseToEdit}
        open={courseToEdit !== null}
        onClose={() => setCourseToEdit(null)}
        onSaved={loadCourses}
      />
    </div>
  );
}
