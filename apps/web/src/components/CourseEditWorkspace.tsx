import { useEffect, useState } from 'react';

import { ApiError, useApiClient } from '../lib/api.js';
import { CourseClassGroupsPanel } from './CourseClassGroupsPanel.js';
import { EditFocusDialog } from './EditFocusDialog.js';

type CourseEditWorkspaceProps = {
  course: {
    id: string;
    name: string;
    subject: string | null;
    gradeLevel: string | null;
  } | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * The Course is shared curriculum, while its Class Groups are the nested,
 * teachable contexts. Keeping them together in a full-screen editor makes the
 * relationship obvious and prevents an in-place list edit from squeezing the
 * rest of the course catalogue.
 */
export function CourseEditWorkspace({
  course,
  open,
  onClose,
  onSaved
}: CourseEditWorkspaceProps) {
  const api = useApiClient();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!course || !open) return;
    setName(course.name);
    setSubject(course.subject ?? '');
    setGradeLevel(course.gradeLevel ?? '');
    setError(null);
    setSuccess(null);
  }, [course, open]);

  if (!course) return null;
  const courseId = course.id;

  async function saveCourseDetails() {
    if (!name.trim()) {
      setError('A Course name is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await api.updateCourse(courseId, {
        name: name.trim(),
        subject: toNullable(subject),
        gradeLevel: toNullable(gradeLevel)
      });
      await onSaved();
      setSuccess('Course details saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save this Course.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditFocusDialog
      fullScreen
      open={open}
      title={`Edit ${course.name}`}
      description="Edit the shared Course and its Class Groups in one focused workspace. Changes save only when you use the labeled action."
      onClose={onClose}
      closeLabel="Done editing"
      busy={saving}
    >
      <div className="course-edit-workspace stack">
        <section className="course-edit-intro" aria-label="Course editing guide">
          <div>
            <p className="eyebrow">Course → Class Groups → meeting times</p>
            <h3>Keep curriculum and teaching groups connected</h3>
            <p className="muted">
              Course details are shared. Every Class Group below has its own meeting schedule,
              planning, progress, and teaching history.
            </p>
          </div>
          <span className="course-edit-status">Editing workspace</span>
        </section>

        <section className="course-edit-section stack" aria-labelledby="course-details-heading">
          <div className="row spread">
            <div>
              <p className="eyebrow">Shared curriculum</p>
              <h3 id="course-details-heading">Course details</h3>
            </div>
            {success ? <span className="save-success" role="status">{success}</span> : null}
          </div>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          <div className="three-column">
            <label>
              Course name
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Course name"
              />
            </label>
            <label>
              Subject
              <input
                className="input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Grade level
              <input
                className="input"
                value={gradeLevel}
                onChange={(event) => setGradeLevel(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="row">
            <button type="button" disabled={saving || !name.trim()} onClick={() => void saveCourseDetails()}>
              {saving ? 'Saving…' : 'Save Course details'}
            </button>
          </div>
        </section>

        <section className="course-edit-section course-edit-groups" aria-labelledby="course-groups-heading">
          <div className="course-edit-section-heading">
            <p className="eyebrow">Nested teaching contexts</p>
            <h3 id="course-groups-heading">Class Groups & meeting times</h3>
            <p className="muted">
              Open any Class Group to edit its name, period, weekday boxes, times, rooms, and
              effective dates. These settings never change the shared Course curriculum.
            </p>
          </div>
          <CourseClassGroupsPanel courseId={course.id} />
        </section>
      </div>
    </EditFocusDialog>
  );
}
