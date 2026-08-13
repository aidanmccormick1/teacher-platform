import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { CourseDetailResponse } from '@teacheros/contracts';

import { ActivityStudio } from '../components/ActivityStudio.js';
import { CourseEditWorkspace } from '../components/CourseEditWorkspace.js';
import { CoursePlanningPanel } from '../components/CoursePlanningPanel.js';
import { CourseClassGroupsPanel } from '../components/CourseClassGroupsPanel.js';
import { EditFocusDialog } from '../components/EditFocusDialog.js';
import { SemesterPlanner } from '../components/SemesterPlanner.js';
import { ApiError, useApiClient } from '../lib/api.js';
import type { LessonMaterialKind } from '@teacheros/contracts';

type MaterialDraft = { label: string; url: string; kind: LessonMaterialKind };

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNullablePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseOptionalOrder(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function CoursePage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const courseId = params.id ?? '';
  const [course, setCourse] = useState<CourseDetailResponse['course'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [courseEditorOpen, setCourseEditorOpen] = useState(false);
  const [view, setView] = useState<'classes' | 'curriculum' | 'planning'>('classes');

  const [unitEditor, setUnitEditor] = useState<{
    id: string | null;
    title: string;
    description: string;
    order: string;
  } | null>(null);

  const [lessonEditor, setLessonEditor] = useState<{
    id: string | null;
    unitId: string;
    title: string;
    description: string;
    duration: string;
    durationKind: 'minutes' | 'meetings';
    order: string;
  } | null>(null);
  const [segmentEditor, setSegmentEditor] = useState<{
    id: string | null;
    lessonId: string;
    title: string;
    description: string;
    duration: string;
    order: string;
  } | null>(null);
  const [materialDrafts, setMaterialDrafts] = useState<Record<string, MaterialDraft>>({});
  const [materialEditorLessonId, setMaterialEditorLessonId] = useState<string | null>(null);
  const loadCourse = useCallback(async () => {
    if (!courseId) return;

    try {
      setLoading(true);
      const data = await api.getCourseDetail(courseId);
      setCourse(data.course);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load course');
    } finally {
      setLoading(false);
    }
  }, [api, courseId]);

  useEffect(() => {
    void loadCourse();
  }, [loadCourse]);

  const updateFromDetail = (detail: CourseDetailResponse) => {
    setCourse(detail.course);
  };

  if (!courseId) {
    return (
      <div className="stack">
        <p style={{ color: '#b02020' }}>Course id is missing.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <Link to="/curriculum">Back to curriculum</Link>
      </div>
      <div className="row spread">
        <div>
          <p className="eyebrow">Shared curriculum</p>
          <h1>{course?.name ?? 'Course Detail'}</h1>
          {course ? (
            <p className="muted">
              {course.subject ?? 'Subject not set'} · {course.gradeLevel ?? 'Grade level not set'}
            </p>
          ) : null}
        </div>
        {course ? (
          <button className="secondary" type="button" onClick={() => setCourseEditorOpen(true)}>
            Edit course
          </button>
        ) : null}
      </div>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
      {loading && !course ? <p className="muted">Loading course...</p> : null}

      {course ? (
        <>
          <nav className="course-primary-tabs" aria-label="Course sections">
            {(
              [
                ['classes', 'Classes'],
                ['curriculum', 'Curriculum'],
                ['planning', 'Plan & progress']
              ] as const
            ).map(([value, label]) => (
              <button
                className={view === value ? 'course-primary-tab-active' : 'secondary'}
                type="button"
                aria-current={view === value ? 'page' : undefined}
                key={value}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          {view === 'classes' ? <CourseClassGroupsPanel courseId={course.id} /> : null}
          {view === 'planning' ? <CoursePlanningPanel courseId={course.id} /> : null}
          {view === 'curriculum' ? (
            <>
              <div className="card row spread">
                <div>
                  <h3>Course settings</h3>
                  <p className="muted">
                    {course.subject ?? 'No subject'} · {course.gradeLevel ?? 'No grade level'}
                  </p>
                </div>
                <div className="row">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setCourseEditorOpen(true)}
                  >
                    Edit course
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const confirmDelete = window.confirm(
                        'Delete this Course and all nested curriculum items? Courses with Class Groups cannot be deleted because their teaching records are protected.'
                      );
                      if (!confirmDelete) return;
                      try {
                        setSaving(true);
                        await api.deleteCourse(course.id);
                        navigate('/curriculum');
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Failed to delete course');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    Delete course
                  </button>
                </div>
              </div>
              <div className="card stack">
                <p className="eyebrow">Class Group planning</p>
                <h3>Plan teaching time by Class Group</h3>
                <p className="muted">
                  This Course keeps shared Units and Lessons. Dates, available instructional
                  Meetings, pacing, and actual progress belong to each Class Group.
                </p>
                <button className="secondary" type="button" onClick={() => setView('planning')}>
                  Open Class Group Year Plan
                </button>
              </div>

              <SemesterPlanner
                courseName={course.name}
                subject={course.subject}
                gradeLevel={course.gradeLevel}
                onApplyPlan={async (plan) => {
                  let latestDetail: CourseDetailResponse | null = null;
                  for (const [unitIndex, unit] of plan.units.entries()) {
                    const unitDetail = await api.createUnit(course.id, {
                      title: unit.title.trim() || `Unit ${unitIndex + 1}`,
                      description: toNullable(unit.description),
                      orderIndex: undefined
                    });
                    const createdUnit = [...unitDetail.course.units]
                      .reverse()
                      .find(
                        (candidate) =>
                          candidate.title === (unit.title.trim() || `Unit ${unitIndex + 1}`)
                      );
                    if (!createdUnit) throw new Error('Unable to find the new unit');

                    latestDetail = unitDetail;
                    for (const lesson of unit.lessons) {
                      latestDetail = await api.createLesson(createdUnit.id, {
                        title: lesson.title.trim() || 'Untitled lesson',
                        description: toNullable(lesson.description),
                        estimatedDurationMinutes: lesson.estimatedDurationMinutes,
                        estimatedMeetings: null,
                        durationKind: lesson.estimatedDurationMinutes ? 'minutes' : null,
                        orderIndex: undefined
                      });
                    }
                  }
                  if (latestDetail) updateFromDetail(latestDetail);
                }}
              />

              <div className="card row spread">
                <div>
                  <h3>Units</h3>
                  <p className="muted">Build and edit Unit details in a dedicated workspace.</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setUnitEditor({
                      id: null,
                      title: '',
                      description: '',
                      order: String(course.units.length)
                    })
                  }
                >
                  Add Unit
                </button>
              </div>
              <EditFocusDialog
                open={unitEditor !== null}
                title={unitEditor?.id ? 'Edit Unit' : 'Add Unit'}
                description="Set this Unit’s shared curriculum details, then return to the Course."
                onClose={() => setUnitEditor(null)}
                busy={saving}
              >
                {unitEditor ? (
                  <div className="stack">
                    <input
                      className="input"
                      value={unitEditor.title}
                      onChange={(event) =>
                        setUnitEditor({ ...unitEditor, title: event.target.value })
                      }
                      placeholder="Unit title"
                    />
                    <input
                      className="input"
                      value={unitEditor.description}
                      onChange={(event) =>
                        setUnitEditor({ ...unitEditor, description: event.target.value })
                      }
                      placeholder="Unit description (optional)"
                    />
                    <input
                      className="input"
                      value={unitEditor.order}
                      onChange={(event) =>
                        setUnitEditor({ ...unitEditor, order: event.target.value })
                      }
                      placeholder="Order index (optional)"
                    />
                    <div className="row">
                      <button
                        type="button"
                        disabled={saving || !unitEditor.title.trim()}
                        onClick={async () => {
                          try {
                            setSaving(true);
                            const detail = unitEditor.id
                              ? await api.updateUnit(unitEditor.id, {
                                  title: unitEditor.title.trim(),
                                  description: toNullable(unitEditor.description),
                                  orderIndex: parseOptionalOrder(unitEditor.order)
                                })
                              : await api.createUnit(course.id, {
                                  title: unitEditor.title.trim(),
                                  description: toNullable(unitEditor.description),
                                  orderIndex: parseOptionalOrder(unitEditor.order)
                                });
                            updateFromDetail(detail);
                            setUnitEditor(null);
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : 'Failed to save Unit');
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        {unitEditor.id ? 'Save Unit' : 'Create Unit'}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setUnitEditor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </EditFocusDialog>

              <div className="stack">
                {course.units.map((unit) => {
                  return (
                    <div key={unit.id} className="card stack">
                      <div className="row">
                        <strong>
                          Unit {unit.orderIndex}: {unit.title}
                        </strong>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            setUnitEditor({
                              id: unit.id,
                              title: unit.title,
                              description: unit.description ?? '',
                              order: String(unit.orderIndex)
                            });
                          }}
                        >
                          Edit unit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const confirmDelete = window.confirm(
                              `Delete unit "${unit.title}" and all lessons inside it?`
                            );
                            if (!confirmDelete) return;
                            try {
                              setSaving(true);
                              await api.deleteUnit(unit.id);
                              await loadCourse();
                            } catch (err) {
                              setError(
                                err instanceof ApiError ? err.message : 'Failed to delete unit'
                              );
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          Delete unit
                        </button>
                      </div>
                      {unit.description ? <p className="muted">{unit.description}</p> : null}

                      <div className="card row spread">
                        <div>
                          <h4>Add lesson</h4>
                          <p className="muted">Create a Lesson in a focused editor.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setLessonEditor({
                              id: null,
                              unitId: unit.id,
                              title: '',
                              description: '',
                              duration: '',
                              durationKind: 'minutes',
                              order: String(unit.lessons.length)
                            })
                          }
                        >
                          Add Lesson
                        </button>
                      </div>

                      {unit.lessons.map((lesson, lessonIndex) => {
                        const materialsForLesson = lesson.materials;

                        return (
                          <div key={lesson.id} className="card stack">
                            <div className="row">
                              <strong>
                                Lesson {lessonIndex + 1}: {lesson.title}
                              </strong>
                              <button
                                className="secondary"
                                type="button"
                                disabled={saving || lessonIndex === 0}
                                onClick={async () => {
                                  const ordered = [...unit.lessons];
                                  [ordered[lessonIndex - 1], ordered[lessonIndex]] = [
                                    ordered[lessonIndex]!,
                                    ordered[lessonIndex - 1]!
                                  ];
                                  try {
                                    setSaving(true);
                                    const detail = await api.reorderLessons(unit.id, {
                                      lessonIds: ordered.map((item) => item.id)
                                    });
                                    updateFromDetail(detail);
                                    setError(null);
                                  } catch (err) {
                                    setError(
                                      err instanceof ApiError
                                        ? err.message
                                        : 'Failed to move this lesson'
                                    );
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                              >
                                Move up
                              </button>
                              <button
                                className="secondary"
                                type="button"
                                disabled={saving || lessonIndex === unit.lessons.length - 1}
                                onClick={async () => {
                                  const ordered = [...unit.lessons];
                                  [ordered[lessonIndex], ordered[lessonIndex + 1]] = [
                                    ordered[lessonIndex + 1]!,
                                    ordered[lessonIndex]!
                                  ];
                                  try {
                                    setSaving(true);
                                    const detail = await api.reorderLessons(unit.id, {
                                      lessonIds: ordered.map((item) => item.id)
                                    });
                                    updateFromDetail(detail);
                                    setError(null);
                                  } catch (err) {
                                    setError(
                                      err instanceof ApiError
                                        ? err.message
                                        : 'Failed to move this lesson'
                                    );
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                              >
                                Move down
                              </button>
                              <button
                                className="secondary"
                                type="button"
                                onClick={() => {
                                  const durationKind = lesson.estimatedMeetings
                                    ? 'meetings'
                                    : 'minutes';
                                  setLessonEditor({
                                    id: lesson.id,
                                    unitId: unit.id,
                                    title: lesson.title,
                                    description: lesson.description ?? '',
                                    duration: String(
                                      durationKind === 'meetings'
                                        ? (lesson.estimatedMeetings ?? '')
                                        : (lesson.estimatedDurationMinutes ?? '')
                                    ),
                                    durationKind,
                                    order: String(lesson.orderIndex)
                                  });
                                }}
                              >
                                Edit lesson
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const confirmDelete = window.confirm(
                                    `Delete lesson "${lesson.title}" and all Lesson Steps?`
                                  );
                                  if (!confirmDelete) return;
                                  try {
                                    setSaving(true);
                                    await api.deleteLesson(lesson.id);
                                    await loadCourse();
                                  } catch (err) {
                                    setError(
                                      err instanceof ApiError
                                        ? err.message
                                        : 'Failed to delete lesson'
                                    );
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                              >
                                Delete lesson
                              </button>
                            </div>
                            {lesson.description ? (
                              <p className="muted">{lesson.description}</p>
                            ) : null}

                            <ActivityStudio
                              courseName={course.name}
                              subject={course.subject}
                              gradeLevel={course.gradeLevel}
                              lessonTitle={lesson.title}
                              objective={lesson.description}
                              estimatedDurationMinutes={lesson.estimatedDurationMinutes}
                              onAddSteps={async (steps) => {
                                let latestDetail: CourseDetailResponse | null = null;
                                for (const step of steps) {
                                  latestDetail = await api.createSegment(lesson.id, {
                                    title: step.title.trim() || 'Activity step',
                                    description: toNullable(step.directions),
                                    durationMinutes: step.durationMinutes,
                                    orderIndex: undefined
                                  });
                                }
                                if (latestDetail) updateFromDetail(latestDetail);
                              }}
                            />

                            <div className="card stack">
                              <div className="row spread">
                                <div>
                                  <h5 style={{ marginBottom: 8 }}>Materials</h5>
                                  <p className="muted" style={{ marginTop: 0 }}>
                                    Add a Google Drive link, PDF URL, Canvas resource, or web
                                    resource.
                                  </p>
                                </div>
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => setMaterialEditorLessonId(lesson.id)}
                                >
                                  Add Material
                                </button>
                              </div>
                              <EditFocusDialog
                                open={materialEditorLessonId === lesson.id}
                                title={`Add material to ${lesson.title}`}
                                description="Add this lesson resource, then return to the Course when you are done."
                                onClose={() => setMaterialEditorLessonId(null)}
                                busy={saving}
                              >
                                <div className="stack">
                                  <select
                                    value={materialDrafts[lesson.id]?.kind ?? 'google_drive'}
                                    onChange={(event) =>
                                      setMaterialDrafts((previous) => ({
                                        ...previous,
                                        [lesson.id]: {
                                          label: previous[lesson.id]?.label ?? '',
                                          url: previous[lesson.id]?.url ?? '',
                                          kind: event.target.value as LessonMaterialKind
                                        }
                                      }))
                                    }
                                  >
                                    <option value="google_drive">Paste Google Drive link</option>
                                    <option value="pdf">Paste PDF URL</option>
                                    <option value="canvas">Paste Canvas resource</option>
                                    <option value="web">Paste any web resource</option>
                                  </select>
                                  <input
                                    className="input"
                                    value={materialDrafts[lesson.id]?.label ?? ''}
                                    onChange={(event) =>
                                      setMaterialDrafts((previous) => ({
                                        ...previous,
                                        [lesson.id]: {
                                          label: event.target.value,
                                          url: previous[lesson.id]?.url ?? '',
                                          kind: previous[lesson.id]?.kind ?? 'google_drive'
                                        }
                                      }))
                                    }
                                    placeholder="Material title"
                                  />
                                  <input
                                    className="input"
                                    value={materialDrafts[lesson.id]?.url ?? ''}
                                    onChange={(event) =>
                                      setMaterialDrafts((previous) => ({
                                        ...previous,
                                        [lesson.id]: {
                                          label: previous[lesson.id]?.label ?? '',
                                          url: event.target.value,
                                          kind: previous[lesson.id]?.kind ?? 'google_drive'
                                        }
                                      }))
                                    }
                                    placeholder="https://"
                                  />
                                  <div className="row">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const draft = materialDrafts[lesson.id] ?? {
                                          label: '',
                                          url: '',
                                          kind: 'google_drive' as LessonMaterialKind
                                        };

                                        try {
                                          const parsedUrl = new URL(draft.url.trim());
                                          setSaving(true);
                                          const detail = await api.createLessonMaterial(lesson.id, {
                                            label: draft.label.trim() || 'Lesson material',
                                            url: parsedUrl.toString(),
                                            kind: draft.kind
                                          });
                                          updateFromDetail(detail);
                                          setMaterialDrafts((previous) => ({
                                            ...previous,
                                            [lesson.id]: { label: '', url: '', kind: draft.kind }
                                          }));
                                          setError(null);
                                          setMaterialEditorLessonId(null);
                                        } catch (err) {
                                          setError(
                                            err instanceof ApiError
                                              ? err.message
                                              : 'Add a valid material link before saving.'
                                          );
                                        } finally {
                                          setSaving(false);
                                        }
                                      }}
                                    >
                                      Save material
                                    </button>
                                    <button
                                      className="secondary"
                                      type="button"
                                      onClick={() => setMaterialEditorLessonId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </EditFocusDialog>

                              {materialsForLesson.length > 0 ? (
                                <div className="stack">
                                  {materialsForLesson.map((material) => (
                                    <div key={material.id} className="row">
                                      <a
                                        href={material.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ fontWeight: 600 }}
                                      >
                                        {material.label}
                                      </a>
                                      <span
                                        className="muted"
                                        style={{ textTransform: 'capitalize' }}
                                      >
                                        {material.kind.replace('_', ' ')}
                                      </span>
                                      <button
                                        className="secondary"
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            setSaving(true);
                                            await api.deleteLessonMaterial(material.id);
                                            await loadCourse();
                                            setError(null);
                                          } catch (err) {
                                            setError(
                                              err instanceof ApiError
                                                ? err.message
                                                : 'Failed to remove material'
                                            );
                                          } finally {
                                            setSaving(false);
                                          }
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="muted">No materials added yet.</p>
                              )}
                            </div>

                            <div className="card row spread">
                              <div>
                                <h5>Add Lesson Step</h5>
                                <p className="muted">
                                  Create and revise steps without leaving this Course.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setSegmentEditor({
                                    id: null,
                                    lessonId: lesson.id,
                                    title: '',
                                    description: '',
                                    duration: '',
                                    order: String(lesson.segments.length)
                                  })
                                }
                              >
                                Add Lesson Step
                              </button>
                            </div>

                            {lesson.segments.map((segment) => (
                              <div key={segment.id} className="row">
                                <span>
                                  {segment.orderIndex}. {segment.title}
                                  {segment.durationMinutes
                                    ? ` (${segment.durationMinutes} min)`
                                    : ''}
                                </span>
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => {
                                    setSegmentEditor({
                                      id: segment.id,
                                      lessonId: lesson.id,
                                      title: segment.title,
                                      description: segment.description ?? '',
                                      duration: segment.durationMinutes?.toString() ?? '',
                                      order: String(segment.orderIndex)
                                    });
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const confirmDelete = window.confirm(
                                      `Delete Lesson Step "${segment.title}"?`
                                    );
                                    if (!confirmDelete) return;
                                    try {
                                      setSaving(true);
                                      await api.deleteSegment(segment.id);
                                      await loadCourse();
                                    } catch (err) {
                                      setError(
                                        err instanceof ApiError
                                          ? err.message
                                          : 'Failed to delete segment'
                                      );
                                    } finally {
                                      setSaving(false);
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <EditFocusDialog
                open={lessonEditor !== null}
                title={lessonEditor?.id ? 'Edit Lesson' : 'Add Lesson'}
                description="Keep this Lesson’s title and optional duration together in one focused editor."
                onClose={() => setLessonEditor(null)}
                busy={saving}
              >
                {lessonEditor ? (
                  <div className="stack">
                    <input
                      className="input"
                      value={lessonEditor.title}
                      onChange={(event) =>
                        setLessonEditor({ ...lessonEditor, title: event.target.value })
                      }
                      placeholder="Lesson title"
                    />
                    <input
                      className="input"
                      value={lessonEditor.description}
                      onChange={(event) =>
                        setLessonEditor({ ...lessonEditor, description: event.target.value })
                      }
                      placeholder="Lesson description (optional)"
                    />
                    <div className="row">
                      <label>
                        Duration + Add
                        <select
                          className="input"
                          value={lessonEditor.durationKind}
                          onChange={(event) =>
                            setLessonEditor({
                              ...lessonEditor,
                              durationKind: event.target.value as 'minutes' | 'meetings'
                            })
                          }
                        >
                          <option value="minutes">Minutes</option>
                          <option value="meetings">Meetings</option>
                        </select>
                      </label>
                      <input
                        className="input"
                        value={lessonEditor.duration}
                        onChange={(event) =>
                          setLessonEditor({ ...lessonEditor, duration: event.target.value })
                        }
                        placeholder={
                          lessonEditor.durationKind === 'minutes' ? '45 (optional)' : '1 (optional)'
                        }
                      />
                    </div>
                    <input
                      className="input"
                      value={lessonEditor.order}
                      onChange={(event) =>
                        setLessonEditor({ ...lessonEditor, order: event.target.value })
                      }
                      placeholder="Order index (optional)"
                    />
                    <div className="row">
                      <button
                        type="button"
                        disabled={saving || !lessonEditor.title.trim()}
                        onClick={async () => {
                          try {
                            setSaving(true);
                            const duration = parseNullablePositiveInt(lessonEditor.duration);
                            const detail = lessonEditor.id
                              ? await api.updateLesson(lessonEditor.id, {
                                  title: lessonEditor.title.trim(),
                                  description: toNullable(lessonEditor.description),
                                  estimatedDurationMinutes:
                                    lessonEditor.durationKind === 'minutes' ? duration : null,
                                  estimatedMeetings:
                                    lessonEditor.durationKind === 'meetings' ? duration : null,
                                  durationKind: duration ? lessonEditor.durationKind : null,
                                  orderIndex: parseOptionalOrder(lessonEditor.order)
                                })
                              : await api.createLesson(lessonEditor.unitId, {
                                  title: lessonEditor.title.trim(),
                                  description: toNullable(lessonEditor.description),
                                  estimatedDurationMinutes:
                                    lessonEditor.durationKind === 'minutes' ? duration : null,
                                  estimatedMeetings:
                                    lessonEditor.durationKind === 'meetings' ? duration : null,
                                  durationKind: duration ? lessonEditor.durationKind : null,
                                  orderIndex: parseOptionalOrder(lessonEditor.order)
                                });
                            updateFromDetail(detail);
                            setLessonEditor(null);
                          } catch (err) {
                            setError(
                              err instanceof ApiError ? err.message : 'Failed to save Lesson'
                            );
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        {lessonEditor.id ? 'Save Lesson' : 'Create Lesson'}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setLessonEditor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </EditFocusDialog>
              <EditFocusDialog
                open={segmentEditor !== null}
                title={segmentEditor?.id ? 'Edit Lesson Step' : 'Add Lesson Step'}
                description="Keep individual Lesson Step details in focus, then return to the Lesson."
                onClose={() => setSegmentEditor(null)}
                busy={saving}
              >
                {segmentEditor ? (
                  <div className="stack">
                    <input
                      className="input"
                      value={segmentEditor.title}
                      onChange={(event) =>
                        setSegmentEditor({ ...segmentEditor, title: event.target.value })
                      }
                      placeholder="Lesson Step title"
                    />
                    <input
                      className="input"
                      value={segmentEditor.description}
                      onChange={(event) =>
                        setSegmentEditor({ ...segmentEditor, description: event.target.value })
                      }
                      placeholder="Lesson Step description (optional)"
                    />
                    <input
                      className="input"
                      value={segmentEditor.duration}
                      onChange={(event) =>
                        setSegmentEditor({ ...segmentEditor, duration: event.target.value })
                      }
                      placeholder="Duration minutes (optional)"
                    />
                    <input
                      className="input"
                      value={segmentEditor.order}
                      onChange={(event) =>
                        setSegmentEditor({ ...segmentEditor, order: event.target.value })
                      }
                      placeholder="Order index (optional)"
                    />
                    <div className="row">
                      <button
                        type="button"
                        disabled={saving || !segmentEditor.title.trim()}
                        onClick={async () => {
                          try {
                            setSaving(true);
                            const payload = {
                              title: segmentEditor.title.trim(),
                              description: toNullable(segmentEditor.description),
                              durationMinutes: parseNullablePositiveInt(segmentEditor.duration),
                              orderIndex: parseOptionalOrder(segmentEditor.order)
                            };
                            const detail = segmentEditor.id
                              ? await api.updateSegment(segmentEditor.id, payload)
                              : await api.createSegment(segmentEditor.lessonId, payload);
                            updateFromDetail(detail);
                            setSegmentEditor(null);
                          } catch (err) {
                            setError(
                              err instanceof ApiError ? err.message : 'Failed to save Lesson Step'
                            );
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        {segmentEditor.id ? 'Save Lesson Step' : 'Create Lesson Step'}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setSegmentEditor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </EditFocusDialog>
            </>
          ) : null}
        </>
      ) : null}
      <CourseEditWorkspace
        course={course}
        open={courseEditorOpen}
        onClose={() => setCourseEditorOpen(false)}
        onSaved={loadCourse}
      />
    </div>
  );
}
