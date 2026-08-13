import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { V3CourseDetail, V3Lesson } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function ClassroomPage() {
  const api = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedClassGroupId = searchParams.get('classGroupId') ?? undefined;
  const [state, setState] = useState<Awaited<ReturnType<typeof api.getV3Classroom>> | null>(null);
  const [course, setCourse] = useState<V3CourseDetail | null>(null);
  const [manualClassGroupId, setManualClassGroupId] = useState<string | undefined>(
    requestedClassGroupId
  );
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (classGroupId = manualClassGroupId) => {
      try {
        const next = await api.getV3Classroom(classGroupId);
        setState(next);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Unable to load your classroom.');
      }
    },
    [api, manualClassGroupId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (requestedClassGroupId === manualClassGroupId) return;
    setManualClassGroupId(requestedClassGroupId);
    setLessonId(null);
  }, [manualClassGroupId, requestedClassGroupId]);

  const selectedGroup = useMemo(
    () => state?.classGroups.find((group) => group.id === state.selected?.classGroupId) ?? null,
    [state]
  );

  useEffect(() => {
    if (!selectedGroup) {
      setCourse(null);
      return;
    }
    void (async () => {
      try {
        setCourse(await api.getV3CourseDetail(selectedGroup.courseId));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Unable to load this course.');
      }
    })();
  }, [api, selectedGroup]);

  const lessons = useMemo(
    () => course?.course.units.flatMap((unit) => unit.lessons) ?? [],
    [course]
  );
  const selectedLesson = useMemo<V3Lesson | null>(() => {
    const desired = lessonId ?? state?.selected?.currentLesson?.id;
    return (
      lessons.find((lesson) => lesson.id === desired) ?? state?.selected?.currentLesson ?? null
    );
  }, [lessonId, lessons, state]);
  const lessonIndex = selectedLesson
    ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id)
    : -1;
  const selectedMeeting = state?.selected?.meeting ?? null;
  const noActiveClass = state !== null && state.activeClassGroupId === null;

  async function saveLesson(status: 'not_started' | 'in_progress' | 'completed' | 'skipped') {
    if (!state?.selected || !selectedLesson) return;
    try {
      setSaving(true);
      await api.saveV3LessonProgress(state.selected.classGroupId, {
        lessonId: selectedLesson.id,
        status,
        meetingInstanceId: selectedMeeting?.id ?? null,
        manualOverride: status === 'completed' || status === 'skipped',
        notes: null
      });
      await load(state.selected.classGroupId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save lesson progress.');
    } finally {
      setSaving(false);
    }
  }

  async function moveToNextMeeting() {
    if (!state?.selected || !selectedLesson || !state.selected.upcomingMeeting) return;
    try {
      setSaving(true);
      await api.createPlanAllocation(state.selected.classGroupId, {
        meetingInstanceId: state.selected.upcomingMeeting.id,
        lessonId: selectedLesson.id,
        lessonStepId: null,
        notes: 'Moved from Classroom',
        orderIndex: undefined
      });
      await saveLesson('in_progress');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to move this lesson to the next meeting.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack classroom-v3">
      <div className="row spread classroom-header">
        <div>
          <p className="eyebrow">Live classroom</p>
          <h1>Classroom</h1>
        </div>
        <label className="class-group-picker">
          Class Group
          <select
            className="input"
            value={state?.selected?.classGroupId ?? manualClassGroupId ?? ''}
            onChange={(event) => {
              const value = event.target.value || undefined;
              setManualClassGroupId(value);
              setLessonId(null);
              setSearchParams(value ? { classGroupId: value } : {});
              void load(value);
            }}
          >
            <option value="">Choose a Class Group</option>
            {state?.classGroups.map((group) => (
              <option value={group.id} key={group.id}>
                {group.periodLabel ? `${group.periodLabel} · ` : ''}
                {group.courseName} — {group.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {!state ? <p className="muted">Finding the current instructional meeting…</p> : null}

      {noActiveClass ? (
        <section className="card classroom-no-active">
          <h2>No class is happening right now.</h2>
          <p className="muted">
            Choose any Class Group above to prepare, review, or continue where that group left off.
          </p>
        </section>
      ) : null}

      {state?.activeMeeting && !manualClassGroupId ? (
        <section className="card classroom-active-notice">
          <strong>Current class detected</strong>
          <span>
            Meeting {state.activeMeeting.meetingNumber} · {state.activeMeeting.localDate}
          </span>
        </section>
      ) : null}

      {state?.selected && selectedGroup ? (
        <section className="card stack classroom-current-meeting">
          <div>
            <p className="eyebrow">
              {selectedGroup.periodLabel ? `${selectedGroup.periodLabel} · ` : ''}
              {selectedGroup.courseName}
            </p>
            <h2>{selectedGroup.name}</h2>
            {selectedMeeting ? (
              <p className="meeting-label">
                Meeting {selectedMeeting.meetingNumber} · {selectedMeeting.localDate} ·{' '}
                {selectedMeeting.startTime}–{selectedMeeting.endTime}
              </p>
            ) : (
              <p className="muted">
                No dated meeting is available yet. You can still manage this Class Group’s
                curriculum.
              </p>
            )}
          </div>

          {selectedLesson ? (
            <>
              <div className="row spread lesson-navigation">
                <button
                  className="secondary"
                  type="button"
                  disabled={lessonIndex <= 0}
                  onClick={() => setLessonId(lessons[lessonIndex - 1]?.id ?? null)}
                >
                  Previous
                </button>
                <label>
                  Current Lesson
                  <select
                    className="input"
                    value={selectedLesson.id}
                    onChange={(event) => setLessonId(event.target.value)}
                  >
                    {course?.course.units.map((unit) => (
                      <optgroup label={unit.title} key={unit.id}>
                        {unit.lessons.map((lesson) => (
                          <option value={lesson.id} key={lesson.id}>
                            {lesson.title}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  type="button"
                  disabled={lessonIndex < 0 || lessonIndex >= lessons.length - 1}
                  onClick={() => setLessonId(lessons[lessonIndex + 1]?.id ?? null)}
                >
                  Next
                </button>
              </div>

              <div>
                <p className="eyebrow">Today</p>
                <h2>{selectedLesson.title}</h2>
                {selectedLesson.description ? (
                  <p className="muted">{selectedLesson.description}</p>
                ) : null}
              </div>

              {selectedLesson.steps.length ? (
                <div className="classroom-steps">
                  {selectedLesson.steps.map((step) => {
                    const status = state.selected?.stepStatuses[step.id] ?? 'not_started';
                    const done = status === 'completed' || status === 'skipped';
                    return (
                      <div className="classroom-step" key={step.id}>
                        <button
                          className={done ? 'step-done' : 'secondary'}
                          type="button"
                          disabled={saving}
                          onClick={async () => {
                            if (!state.selected) return;
                            try {
                              setSaving(true);
                              await api.saveV3StepProgress(state.selected.classGroupId, {
                                lessonStepId: step.id,
                                status: done ? 'not_started' : 'completed',
                                meetingInstanceId: selectedMeeting?.id ?? null
                              });
                              await load(state.selected.classGroupId);
                            } catch (err) {
                              setError(
                                err instanceof ApiError
                                  ? err.message
                                  : 'Unable to save step progress.'
                              );
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          {done ? '✓' : '○'}
                        </button>
                        <span>
                          <strong>{step.title}</strong>
                          {step.description ? ` — ${step.description}` : ''}
                        </span>
                        <button
                          className="secondary"
                          type="button"
                          disabled={saving || done}
                          onClick={async () => {
                            if (!state.selected) return;
                            try {
                              setSaving(true);
                              await api.saveV3StepProgress(state.selected.classGroupId, {
                                lessonStepId: step.id,
                                status: 'skipped',
                                meetingInstanceId: selectedMeeting?.id ?? null
                              });
                              await load(state.selected.classGroupId);
                            } catch (err) {
                              setError(
                                err instanceof ApiError
                                  ? err.message
                                  : 'Unable to skip this Lesson Step.'
                              );
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          Skip
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">
                  This Lesson has no steps. Teach it as-is or manage its status below.
                </p>
              )}

              <div className="row classroom-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveLesson('in_progress')}
                >
                  Start / continue
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveLesson('completed')}
                >
                  Mark complete
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveLesson('skipped')}
                >
                  Skip Lesson
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={saving || !state.selected.upcomingMeeting}
                  onClick={() => void moveToNextMeeting()}
                >
                  Move to next class
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              This Class Group has no curriculum Lesson selected yet. Build curriculum, then return
              here to teach it.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
