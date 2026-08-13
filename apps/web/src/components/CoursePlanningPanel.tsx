import { useCallback, useEffect, useMemo, useState } from 'react';

import type { V3CourseDetail } from '@teacheros/contracts';

import { EditFocusDialog } from './EditFocusDialog.js';
import { ApiError, useApiClient } from '../lib/api.js';

type Meeting = {
  id: string;
  localDate: string;
  startTime: string;
  endTime: string;
  meetingNumber: number;
  state: string;
};

export function CoursePlanningPanel({ courseId }: { courseId: string }) {
  const api = useApiClient();
  const [detail, setDetail] = useState<V3CourseDetail | null>(null);
  const [classGroupId, setClassGroupId] = useState('');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [allocations, setAllocations] = useState<
    Awaited<ReturnType<typeof api.listPlanAllocations>>['allocations']
  >([]);
  const [metric, setMetric] = useState<Awaited<ReturnType<typeof api.getPlannedPercentage>> | null>(
    null
  );
  const [tab, setTab] = useState<'calendar' | 'year-plan' | 'resources' | 'settings'>('calendar');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [movingAllocationId, setMovingAllocationId] = useState<string | null>(null);
  const [shiftFollowing, setShiftFollowing] = useState(false);
  const [undoMove, setUndoMove] = useState<{
    allocationId: string;
    previousMeetingId: string;
  } | null>(null);
  const [durationUnitId, setDurationUnitId] = useState<string | null>(null);
  const [durationKind, setDurationKind] = useState<'meetings' | 'weeks' | 'date_range'>('meetings');
  const [durationMeetings, setDurationMeetings] = useState('');
  const [durationStartDate, setDurationStartDate] = useState('');
  const [durationEndDate, setDurationEndDate] = useState('');
  const [lessonBankQuery, setLessonBankQuery] = useState('');
  const [lessonBank, setLessonBank] = useState<
    Awaited<ReturnType<typeof api.searchLessonBank>>['lessons']
  >([]);
  const [destinationUnitId, setDestinationUnitId] = useState('');
  const [resources, setResources] = useState<
    Awaited<ReturnType<typeof api.getV3Resources>>['resources']
  >([]);
  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [templates, setTemplates] = useState<
    Awaited<ReturnType<typeof api.listLessonTemplates>>['templates']
  >([]);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateStepsText, setTemplateStepsText] = useState('Warm-up\nActivity\nExit ticket');
  const [templateLessonId, setTemplateLessonId] = useState('');
  const [editor, setEditor] = useState<
    'allocation' | 'resource' | 'template' | 'apply-template' | 'lesson-bank' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [next, resourceResponse, templateResponse] = await Promise.all([
        api.getV3CourseDetail(courseId),
        api.getV3Resources(courseId),
        api.listLessonTemplates()
      ]);
      setDetail(next);
      setResources(resourceResponse.resources);
      setTemplates(templateResponse.templates);
      setClassGroupId((current) =>
        next.course.classGroups.some((group) => group.id === current)
          ? current
          : next.course.classGroups[0]?.id || ''
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load class-group planning.');
    }
  }, [api, courseId]);

  useEffect(() => {
    // Course ownership is the boundary for planning. Clear the previous Course's
    // selection before its replacement detail arrives so it can never be read or
    // mutated from the newly selected Course.
    setClassGroupId('');
    setSelectedMeetingId('');
    setMeetings([]);
    setAllocations([]);
    setMetric(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!classGroupId || detail?.course.id !== courseId) return;
    void (async () => {
      try {
        const [meetingResponse, allocationResponse, percentage] = await Promise.all([
          api.getMeetings(classGroupId),
          api.listPlanAllocations(classGroupId),
          api.getPlannedPercentage(classGroupId)
        ]);
        const rows = meetingResponse.meetings as unknown as Meeting[];
        setMeetings(rows.filter((meeting) => meeting.state === 'scheduled'));
        setAllocations(allocationResponse.allocations);
        setMetric(percentage);
        setSelectedMeetingId(
          (current) => current || rows.find((meeting) => meeting.state === 'scheduled')?.id || ''
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Unable to load this Class Group plan.');
      }
    })();
  }, [api, classGroupId, courseId, detail?.course.id]);

  const allocationsByMeeting = useMemo(() => {
    const result = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      const values = result.get(allocation.meetingInstanceId) ?? [];
      values.push(allocation);
      result.set(allocation.meetingInstanceId, values);
    }
    return result;
  }, [allocations]);

  async function refreshPlanning() {
    if (!classGroupId) return;
    const [allocationResponse, percentage] = await Promise.all([
      api.listPlanAllocations(classGroupId),
      api.getPlannedPercentage(classGroupId)
    ]);
    setAllocations(allocationResponse.allocations);
    setMetric(percentage);
  }

  async function moveAllocation(
    allocationId: string,
    targetMeetingId: string,
    includeFollowing: boolean
  ) {
    const allocation = allocations.find((item) => item.id === allocationId);
    if (!allocation || allocation.meetingInstanceId === targetMeetingId) return;
    try {
      setBusy(true);
      await api.movePlanAllocation(allocationId, {
        targetMeetingInstanceId: targetMeetingId,
        shiftFollowing: includeFollowing
      });
      setUndoMove(
        includeFollowing ? null : { allocationId, previousMeetingId: allocation.meetingInstanceId }
      );
      setMovingAllocationId(null);
      await refreshPlanning();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to move this planned Lesson.');
    } finally {
      setBusy(false);
    }
  }

  if (!detail?.course.classGroups.length) return null;

  return (
    <section className="card stack course-planning-panel">
      <div className="row spread">
        <div>
          <p className="eyebrow">Class Group planning</p>
          <h3>Calendar and Year Plan</h3>
        </div>
        <select
          className="input"
          value={classGroupId}
          onChange={(event) => setClassGroupId(event.target.value)}
        >
          {detail.course.classGroups.map((group) => (
            <option value={group.id} key={group.id}>
              {group.periodLabel ? `${group.periodLabel} · ` : ''}
              {group.name}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="error-message">{error}</p> : null}
      <div className="course-tabs" role="tablist" aria-label="Course planning views">
        {(['calendar', 'year-plan', 'resources', 'settings'] as const).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'course-tab-active' : 'secondary'}
            key={item}
            onClick={() => setTab(item)}
          >
            {item === 'year-plan' ? 'Year Plan' : item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'calendar' ? (
        <>
          <div className="planning-metric">
            <strong>
              {metric?.isApproximate ? 'About ' : ''}
              {Math.round(metric?.percent ?? 0)}% of instructional year planned
            </strong>
            <span>
              {metric?.explicitMeetings ?? 0} explicit meetings
              {metric?.estimatedMeetings ? ` + ${metric.estimatedMeetings} estimated` : ''} of{' '}
              {metric?.availableMeetings ?? 0}
            </span>
          </div>
          {metric?.overCapacityMeetings ? (
            <p className="schedule-warnings">
              Curriculum exceeds available instructional time by approximately{' '}
              {metric.overCapacityMeetings} meetings.
            </p>
          ) : null}
          <button type="button" onClick={() => setEditor('allocation')}>
            Plan curriculum
          </button>
          <EditFocusDialog
            open={editor === 'allocation'}
            title="Plan curriculum"
            description="Place a Lesson on one instructional Meeting, then return to the Class Group plan."
            onClose={() => setEditor(null)}
            busy={busy}
          >
            <div className="stack">
              <div className="two-column allocation-form">
                <label>
                  Lesson
                  <select
                    className="input"
                    value={selectedLessonId}
                    onChange={(event) => setSelectedLessonId(event.target.value)}
                  >
                    <option value="">Select Lesson</option>
                    {detail.course.units.map((unit) => (
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
                <label>
                  Instructional Meeting
                  <select
                    className="input"
                    value={selectedMeetingId}
                    onChange={(event) => setSelectedMeetingId(event.target.value)}
                  >
                    <option value="">Select Meeting</option>
                    {meetings.map((meeting) => (
                      <option value={meeting.id} key={meeting.id}>
                        Meeting {meeting.meetingNumber} · {meeting.localDate} · {meeting.startTime}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                disabled={busy || !selectedLessonId || !selectedMeetingId}
                onClick={async () => {
                  try {
                    setBusy(true);
                    await api.createPlanAllocation(classGroupId, {
                      meetingInstanceId: selectedMeetingId,
                      lessonId: selectedLessonId,
                      lessonStepId: null,
                      notes: null,
                      orderIndex: undefined
                    });
                    setAllocations((await api.listPlanAllocations(classGroupId)).allocations);
                    setMetric(await api.getPlannedPercentage(classGroupId));
                    setEditor(null);
                  } catch (err) {
                    setError(
                      err instanceof ApiError ? err.message : 'Unable to schedule the Lesson.'
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Plan Lesson on Meeting
              </button>
            </div>
          </EditFocusDialog>
          {movingAllocationId ? (
            <EditFocusDialog
              open
              title="Move planned Lesson"
              description="Choose the target instructional Meeting without losing your place in the plan."
              onClose={() => setMovingAllocationId(null)}
              busy={busy}
            >
              <div className="stack">
                <strong>Move selected planned Lesson</strong>
                <label>
                  Target instructional Meeting
                  <select
                    className="input"
                    value={selectedMeetingId}
                    onChange={(event) => setSelectedMeetingId(event.target.value)}
                  >
                    {meetings.map((meeting) => (
                      <option value={meeting.id} key={meeting.id}>
                        Meeting {meeting.meetingNumber} · {meeting.localDate} · {meeting.startTime}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkin-checkbox">
                  <input
                    type="checkbox"
                    checked={shiftFollowing}
                    onChange={(event) => setShiftFollowing(event.target.checked)}
                  />
                  Shift planned work between these Meetings forward
                </label>
                <div className="row">
                  <button
                    type="button"
                    disabled={busy || !selectedMeetingId}
                    onClick={() =>
                      void moveAllocation(movingAllocationId, selectedMeetingId, shiftFollowing)
                    }
                  >
                    Move planned Lesson
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setMovingAllocationId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </EditFocusDialog>
          ) : null}
          {undoMove ? (
            <p className="field-note">
              Plan move saved.{' '}
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={async () => {
                  await moveAllocation(undoMove.allocationId, undoMove.previousMeetingId, false);
                  setUndoMove(null);
                }}
              >
                Undo
              </button>
            </p>
          ) : null}
          <div className="meeting-list">
            {meetings.slice(0, 40).map((meeting) => (
              <div
                className="meeting-card"
                key={meeting.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const allocationId = event.dataTransfer.getData('text/plain');
                  if (allocationId) void moveAllocation(allocationId, meeting.id, false);
                }}
              >
                <strong>Meeting {meeting.meetingNumber}</strong>
                <span>
                  {meeting.localDate} · {meeting.startTime}–{meeting.endTime}
                </span>
                {(allocationsByMeeting.get(meeting.id) ?? []).map((allocation) => (
                  <button
                    className="secondary planned-allocation"
                    type="button"
                    draggable
                    key={allocation.id}
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', allocation.id)}
                    onClick={() => {
                      setSelectedLessonId(allocation.lessonId);
                      setSelectedMeetingId(meeting.id);
                      setMovingAllocationId(allocation.id);
                      setShiftFollowing(false);
                    }}
                  >
                    {allocation.lessonTitle}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {tab === 'year-plan' ? (
        <div className="stack">
          <p className="muted">
            Set loose Unit duration by Class Group. Estimates inform pacing but never create
            required dated Lessons.
          </p>
          {detail.course.units.map((unit) => (
            <div className="year-unit-row" key={unit.id}>
              <strong>{unit.title}</strong>
              {durationUnitId === unit.id ? (
                <EditFocusDialog
                  open
                  title={`Set duration for ${unit.title}`}
                  description="Use an optional Class Group estimate. This never creates dated Lesson allocations."
                  onClose={() => setDurationUnitId(null)}
                  busy={busy}
                >
                  <div className="stack">
                    <div className="row">
                      <label>
                        Duration method
                        <select
                          className="input"
                          value={durationKind}
                          onChange={(event) =>
                            setDurationKind(
                              event.target.value as 'meetings' | 'weeks' | 'date_range'
                            )
                          }
                        >
                          <option value="meetings">Meetings</option>
                          <option value="weeks">Weeks</option>
                          <option value="date_range">Date range</option>
                        </select>
                      </label>
                      {durationKind === 'date_range' ? (
                        <>
                          <input
                            className="input"
                            type="date"
                            value={durationStartDate}
                            onChange={(event) => setDurationStartDate(event.target.value)}
                            aria-label="Unit duration start date"
                          />
                          <input
                            className="input"
                            type="date"
                            value={durationEndDate}
                            onChange={(event) => setDurationEndDate(event.target.value)}
                            aria-label="Unit duration end date"
                          />
                        </>
                      ) : (
                        <input
                          className="input"
                          type="number"
                          min="1"
                          value={durationMeetings}
                          onChange={(event) => setDurationMeetings(event.target.value)}
                          placeholder={durationKind === 'weeks' ? 'Weeks' : 'Meetings'}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const value = Number(durationMeetings);
                        const isDateRange =
                          durationKind === 'date_range' &&
                          durationStartDate &&
                          durationEndDate &&
                          durationEndDate >= durationStartDate;
                        if (
                          (durationKind !== 'date_range' &&
                            (!Number.isInteger(value) || value < 1)) ||
                          (durationKind === 'date_range' && !isDateRange)
                        )
                          return;
                        try {
                          setBusy(true);
                          await api.saveClassGroupUnitPlan(classGroupId, unit.id, {
                            planKind: durationKind,
                            estimatedMeetings: durationKind === 'meetings' ? value : null,
                            estimatedWeeks: durationKind === 'weeks' ? value : null,
                            startDate: durationKind === 'date_range' ? durationStartDate : null,
                            endDate: durationKind === 'date_range' ? durationEndDate : null
                          });
                          setDurationUnitId(null);
                          setDurationMeetings('');
                          setDurationStartDate('');
                          setDurationEndDate('');
                          setMetric(await api.getPlannedPercentage(classGroupId));
                        } catch (err) {
                          setError(
                            err instanceof ApiError ? err.message : 'Unable to save Unit duration.'
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Save
                    </button>
                  </div>
                </EditFocusDialog>
              ) : (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setDurationUnitId(unit.id);
                    setDurationKind('meetings');
                    setDurationMeetings(String(unit.estimatedMeetings ?? ''));
                  }}
                >
                  Duration + Add
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {tab === 'resources' ? (
        <div className="stack">
          <div className="lesson-bank stack">
            <h4>Course resources</h4>
            <p className="field-note">
              Add a URL once. TeacherOS detects common providers and keeps the resource attached to
              this Course.
            </p>
            <button className="secondary" type="button" onClick={() => setEditor('resource')}>
              Add Resource
            </button>
            <EditFocusDialog
              open={editor === 'resource'}
              title="Add Course resource"
              description="Save a resource to this Course, then return to the resource list."
              onClose={() => setEditor(null)}
              busy={busy}
            >
              <div className="stack">
                <input
                  className="input"
                  value={resourceTitle}
                  onChange={(event) => setResourceTitle(event.target.value)}
                  placeholder="Resource title (optional)"
                />
                <input
                  className="input"
                  value={resourceUrl}
                  onChange={(event) => setResourceUrl(event.target.value)}
                  placeholder="https://…"
                />
                <button
                  type="button"
                  disabled={busy || !resourceUrl.trim()}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await api.createV3Resource({
                        courseId,
                        unitId: null,
                        lessonId: null,
                        lessonStepId: null,
                        title: resourceTitle.trim() || null,
                        url: resourceUrl.trim(),
                        resourceType: 'link'
                      });
                      setResourceTitle('');
                      setResourceUrl('');
                      setResources((await api.getV3Resources(courseId)).resources);
                      setEditor(null);
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Unable to add this Resource.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Add Resource
                </button>
              </div>
            </EditFocusDialog>
            {resources.length ? (
              <div className="lesson-bank">
                {resources.map((resource) => (
                  <a
                    className="lesson-bank-row"
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    key={resource.id}
                  >
                    <span>
                      <strong>{resource.title || resource.url}</strong>
                      <small>
                        {resource.provider} · {resource.resourceType}
                      </small>
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted">No resources for this Course yet.</p>
            )}
          </div>

          <div className="lesson-bank stack">
            <h4>Teacher Lesson Bank</h4>
            <p className="field-note">
              Search lessons from any of your Courses, then copy one into this Course. The original
              remains unchanged.
            </p>
            <button className="secondary" type="button" onClick={() => setEditor('lesson-bank')}>
              Search Lesson Bank
            </button>
            <EditFocusDialog
              open={editor === 'lesson-bank'}
              title="Teacher Lesson Bank"
              description="Search a previous Lesson and copy an independent version into this Course."
              onClose={() => setEditor(null)}
              busy={busy}
            >
              <div className="stack">
                <div className="row">
                  <input
                    className="input"
                    value={lessonBankQuery}
                    onChange={(event) => setLessonBankQuery(event.target.value)}
                    placeholder="Search previous lessons"
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      try {
                        setLessonBank((await api.searchLessonBank(lessonBankQuery)).lessons);
                      } catch (err) {
                        setError(
                          err instanceof ApiError
                            ? err.message
                            : 'Unable to search the Lesson Bank.'
                        );
                      }
                    }}
                  >
                    Search
                  </button>
                </div>
                <label>
                  Copy into Unit
                  <select
                    className="input"
                    value={destinationUnitId}
                    onChange={(event) => setDestinationUnitId(event.target.value)}
                  >
                    <option value="">Select destination Unit</option>
                    {detail.course.units.map((unit) => (
                      <option value={unit.id} key={unit.id}>
                        {unit.title}
                      </option>
                    ))}
                  </select>
                </label>
                {lessonBank.map((lesson) => (
                  <div className="lesson-bank-row" key={lesson.id}>
                    <span>
                      <strong>{lesson.title}</strong>
                      <small>
                        Originally from {lesson.courseName} → {lesson.unitTitle}
                      </small>
                    </span>
                    <button
                      type="button"
                      disabled={busy || !destinationUnitId}
                      onClick={async () => {
                        try {
                          setBusy(true);
                          await api.copyLessonBankLesson(lesson.id, destinationUnitId);
                          await refresh();
                          setError(null);
                          setEditor(null);
                        } catch (err) {
                          setError(
                            err instanceof ApiError ? err.message : 'Unable to copy this Lesson.'
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Copy Lesson
                    </button>
                  </div>
                ))}
              </div>
            </EditFocusDialog>
          </div>

          <div className="lesson-bank stack">
            <h4>Lesson templates</h4>
            <p className="field-note">
              Reusable Lesson Step structures belong to your account and are copied into a Lesson
              when applied.
            </p>
            <button className="secondary" type="button" onClick={() => setEditor('template')}>
              Create Lesson Template
            </button>
            <EditFocusDialog
              open={editor === 'template'}
              title="Create Lesson Template"
              description="Save a reusable Lesson Step structure, then return to your Course resources."
              onClose={() => setEditor(null)}
              busy={busy}
            >
              <div className="stack">
                <div className="two-column">
                  <input
                    className="input"
                    value={templateTitle}
                    onChange={(event) => setTemplateTitle(event.target.value)}
                    placeholder="Template name"
                  />
                  <textarea
                    className="input"
                    value={templateStepsText}
                    onChange={(event) => setTemplateStepsText(event.target.value)}
                    aria-label="One Lesson Step per line"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || !templateTitle.trim() || !templateStepsText.trim()}
                  onClick={async () => {
                    const steps = templateStepsText
                      .split('\n')
                      .map((title) => title.trim())
                      .filter(Boolean)
                      .map((title) => ({
                        title,
                        description: null,
                        estimatedMinutes: null,
                        isOptional: false
                      }));
                    if (!steps.length) return;
                    try {
                      setBusy(true);
                      await api.createLessonTemplate({
                        title: templateTitle.trim(),
                        description: null,
                        steps
                      });
                      setTemplateTitle('');
                      setTemplates((await api.listLessonTemplates()).templates);
                      setEditor(null);
                    } catch (err) {
                      setError(
                        err instanceof ApiError
                          ? err.message
                          : 'Unable to save this Lesson Template.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save Template
                </button>
              </div>
            </EditFocusDialog>
            <button className="secondary" type="button" onClick={() => setEditor('apply-template')}>
              Apply Lesson Template
            </button>
            <EditFocusDialog
              open={editor === 'apply-template'}
              title="Apply Lesson Template"
              description="Copy a reusable Step structure into a Lesson without changing the original template."
              onClose={() => setEditor(null)}
              busy={busy}
            >
              <div className="stack">
                <label>
                  Apply to Lesson
                  <select
                    className="input"
                    value={templateLessonId}
                    onChange={(event) => setTemplateLessonId(event.target.value)}
                  >
                    <option value="">Select Lesson</option>
                    {detail.course.units.map((unit) => (
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
                {templates.map((template) => (
                  <div className="lesson-bank-row" key={template.id}>
                    <span>
                      <strong>{template.title}</strong>
                      <small>{template.steps.map((step) => step.title).join(' · ')}</small>
                    </span>
                    <button
                      type="button"
                      disabled={busy || !templateLessonId}
                      onClick={async () => {
                        try {
                          setBusy(true);
                          await api.applyLessonTemplate(templateLessonId, template.id);
                          await refresh();
                          setEditor(null);
                        } catch (err) {
                          setError(
                            err instanceof ApiError
                              ? err.message
                              : 'Unable to apply this Lesson Template.'
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            </EditFocusDialog>
          </div>
        </div>
      ) : null}
      {tab === 'settings' ? (
        <p className="muted">
          This Course uses shared curriculum. Its Class Groups own meetings, plans, and actual
          classroom progress.
        </p>
      ) : null}
    </section>
  );
}
