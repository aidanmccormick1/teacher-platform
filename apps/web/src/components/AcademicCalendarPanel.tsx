import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AcademicYear } from '@teacheros/contracts';

import { EditFocusDialog } from './EditFocusDialog.js';
import { ApiError, useApiClient } from '../lib/api.js';

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type AcademicCalendarPanelProps = { compact?: boolean };

export function AcademicCalendarPanel({ compact = false }: AcademicCalendarPanelProps) {
  const api = useApiClient();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState('');
  const [groups, setGroups] = useState<
    Awaited<ReturnType<typeof api.listV3ClassGroups>>['classGroups']
  >([]);
  const [courses, setCourses] = useState<Awaited<ReturnType<typeof api.listCourses>>['courses']>(
    []
  );
  const [calendar, setCalendar] = useState<{
    events: Array<Record<string, unknown>>;
    overrides: Array<Record<string, unknown>>;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [yearForm, setYearForm] = useState({ name: '2026–2027', startDate: '', endDate: '' });
  const [eventForm, setEventForm] = useState({
    label: '',
    startDate: '',
    endDate: '',
    type: 'holiday',
    instructional: false
  });
  const [groupForm, setGroupForm] = useState({
    courseId: '',
    name: '',
    periodLabel: '',
    room: '',
    weekdays: [1, 3, 5],
    startTime: '09:00',
    endTime: '09:50'
  });
  const [overrideForm, setOverrideForm] = useState({
    classGroupId: '',
    date: '',
    label: 'Minimum day',
    type: 'minimum_day',
    startTime: '09:00',
    endTime: '09:40'
  });
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.recalculateMeetings>
  > | null>(null);
  const [editor, setEditor] = useState<'year' | 'event' | 'override' | 'group' | null>(null);

  const activeYear = useMemo(
    () => years.find((year) => year.id === yearId) ?? null,
    [yearId, years]
  );

  const load = useCallback(async () => {
    try {
      const [yearsResponse, coursesResponse] = await Promise.all([
        api.listAcademicYears(),
        api.listCourses()
      ]);
      setYears(yearsResponse.years);
      setCourses(coursesResponse.courses);
      setYearId(
        (current) =>
          current ||
          yearsResponse.years.find((year) => year.isActive)?.id ||
          yearsResponse.years[0]?.id ||
          ''
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load calendar setup.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!yearId) {
      setCalendar(null);
      setGroups([]);
      return;
    }
    void (async () => {
      try {
        const [calendarResponse, groupResponse] = await Promise.all([
          api.getAcademicCalendar(yearId),
          api.listV3ClassGroups(yearId)
        ]);
        setCalendar(calendarResponse);
        setGroups(groupResponse.classGroups);
        setSelectedGroupId((current) => current || groupResponse.classGroups[0]?.id || '');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Unable to load this academic year.');
      }
    })();
  }, [api, yearId]);

  async function refreshYear() {
    await load();
    if (yearId) {
      const [calendarResponse, groupResponse] = await Promise.all([
        api.getAcademicCalendar(yearId),
        api.listV3ClassGroups(yearId)
      ]);
      setCalendar(calendarResponse);
      setGroups(groupResponse.classGroups);
    }
  }

  return (
    <section className="card stack academic-calendar-panel">
      <div className="row spread">
        <div>
          <p className="eyebrow">Calendar foundation</p>
          <h2>
            {compact ? 'Academic calendar' : 'Academic year, schedule, and instructional meetings'}
          </h2>
          <p className="muted">
            Calendar Events decide whether school is in session. Schedule Overrides only adjust
            instructional days.
          </p>
        </div>
        {years.length ? (
          <select
            className="input calendar-year-select"
            value={yearId}
            onChange={(event) => setYearId(event.target.value)}
          >
            {years.map((year) => (
              <option value={year.id} key={year.id}>
                {year.name}
                {year.isActive ? ' · Active' : ''}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? <p className="error-message">{error}</p> : null}
      {message ? <p className="checkin-message">{message}</p> : null}

      {!years.length ? (
        <div className="calendar-setup-form stack">
          <h3>Set your instructional year</h3>
          <p className="muted">
            Create the year in a focused workspace before editing its calendar.
          </p>
          <button type="button" onClick={() => setEditor('year')}>
            Create academic year
          </button>
        </div>
      ) : null}

      {activeYear ? (
        <div className="calendar-edit-actions card row spread">
          <div>
            <h3>Calendar editing</h3>
            <p className="muted">Open one focused editor at a time, then exit when you are done.</p>
          </div>
          <div className="row">
            <button className="secondary" type="button" onClick={() => setEditor('event')}>
              Add Calendar Event
            </button>
            <button className="secondary" type="button" onClick={() => setEditor('override')}>
              Add Schedule Override
            </button>
            {!compact ? (
              <button type="button" onClick={() => setEditor('group')}>
                Add Class Group
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <EditFocusDialog
        open={editor === 'year'}
        title="Create academic year"
        description="Set the local dates that define this instructional year."
        onClose={() => setEditor(null)}
        busy={busy}
      >
        <div className="calendar-setup-form stack">
          <div className="three-column">
            <label>
              School year
              <input
                className="input"
                value={yearForm.name}
                onChange={(event) => setYearForm({ ...yearForm, name: event.target.value })}
              />
            </label>
            <label>
              Instruction begins
              <input
                className="input"
                type="date"
                value={yearForm.startDate}
                onChange={(event) => setYearForm({ ...yearForm, startDate: event.target.value })}
              />
            </label>
            <label>
              Instruction ends
              <input
                className="input"
                type="date"
                value={yearForm.endDate}
                onChange={(event) => setYearForm({ ...yearForm, endDate: event.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !yearForm.name.trim() || !yearForm.startDate || !yearForm.endDate}
            onClick={async () => {
              try {
                setBusy(true);
                const created = await api.createAcademicYear({ ...yearForm, isActive: true });
                setYearId(created.year.id);
                setMessage('Academic year created. Add dates and Class Groups below.');
                await load();
                setEditor(null);
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : 'Unable to create this academic year.'
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Create academic year
          </button>
        </div>
      </EditFocusDialog>

      {activeYear ? (
        <>
          <EditFocusDialog
            open={editor === 'event'}
            title="Add Calendar Event"
            description="A non-instructional event prevents normal and ordinary overridden meetings."
            onClose={() => setEditor(null)}
            busy={busy}
          >
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  try {
                    setBusy(true);
                    await api.createCalendarEvent(yearId, {
                      ...eventForm,
                      endDate: eventForm.endDate || eventForm.startDate
                    });
                    setEventForm({
                      label: '',
                      startDate: '',
                      endDate: '',
                      type: 'holiday',
                      instructional: false
                    });
                    setMessage(
                      'Calendar Event saved. Recalculate affected Class Groups to review the impact.'
                    );
                    await refreshYear();
                    setEditor(null);
                  } catch (err) {
                    setError(
                      err instanceof ApiError ? err.message : 'Unable to save Calendar Event.'
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <h3>Add Calendar Event</h3>
              <p className="field-note">
                Use for off days or ranges. A non-instructional event prevents normal and overridden
                meetings.
              </p>
              <input
                className="input"
                placeholder="Holiday, winter break, teacher workday…"
                value={eventForm.label}
                onChange={(event) => setEventForm({ ...eventForm, label: event.target.value })}
              />
              <div className="two-column">
                <label>
                  Starts
                  <input
                    className="input"
                    type="date"
                    value={eventForm.startDate}
                    onChange={(event) =>
                      setEventForm({ ...eventForm, startDate: event.target.value })
                    }
                  />
                </label>
                <label>
                  Ends
                  <input
                    className="input"
                    type="date"
                    value={eventForm.endDate}
                    onChange={(event) =>
                      setEventForm({ ...eventForm, endDate: event.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Type
                <select
                  className="input"
                  value={eventForm.type}
                  onChange={(event) => setEventForm({ ...eventForm, type: event.target.value })}
                >
                  <option value="holiday">Holiday</option>
                  <option value="break">Break</option>
                  <option value="workday">Teacher workday</option>
                  <option value="closure">School closed</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="checkin-checkbox">
                <input
                  type="checkbox"
                  checked={eventForm.instructional}
                  onChange={(event) =>
                    setEventForm({ ...eventForm, instructional: event.target.checked })
                  }
                />
                This date remains instructional
              </label>
              <button
                type="submit"
                disabled={busy || !eventForm.label.trim() || !eventForm.startDate}
              >
                Add Calendar Event
              </button>
            </form>
          </EditFocusDialog>

          <EditFocusDialog
            open={editor === 'override'}
            title="Add Schedule Override"
            description="Use this for an instructional-day minimum day, testing, assembly, or special bell schedule."
            onClose={() => setEditor(null)}
            busy={busy}
          >
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  try {
                    setBusy(true);
                    await api.createScheduleOverride(yearId, {
                      date: overrideForm.date,
                      label: overrideForm.label,
                      type: overrideForm.type,
                      meetings: [
                        {
                          classGroupId: overrideForm.classGroupId,
                          action: 'replace',
                          startTime: overrideForm.startTime,
                          endTime: overrideForm.endTime,
                          room: null
                        }
                      ]
                    });
                    setMessage(
                      'Schedule Override saved. It applies only if the date is instructional.'
                    );
                    await refreshYear();
                    setEditor(null);
                  } catch (err) {
                    setError(
                      err instanceof ApiError ? err.message : 'Unable to save Schedule Override.'
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <h3>Add Schedule Override</h3>
              <p className="field-note">
                Use for minimum days, testing, assemblies, and special bell schedules—not holidays.
              </p>
              <label>
                Class Group
                <select
                  className="input"
                  value={overrideForm.classGroupId}
                  onChange={(event) =>
                    setOverrideForm({ ...overrideForm, classGroupId: event.target.value })
                  }
                >
                  <option value="">Select a Class Group</option>
                  {groups.map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.courseName} · {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input
                  className="input"
                  type="date"
                  value={overrideForm.date}
                  onChange={(event) =>
                    setOverrideForm({ ...overrideForm, date: event.target.value })
                  }
                />
              </label>
              <label>
                Label
                <input
                  className="input"
                  value={overrideForm.label}
                  onChange={(event) =>
                    setOverrideForm({ ...overrideForm, label: event.target.value })
                  }
                />
              </label>
              <div className="two-column">
                <label>
                  Starts
                  <input
                    className="input"
                    type="time"
                    value={overrideForm.startTime}
                    onChange={(event) =>
                      setOverrideForm({ ...overrideForm, startTime: event.target.value })
                    }
                  />
                </label>
                <label>
                  Ends
                  <input
                    className="input"
                    type="time"
                    value={overrideForm.endTime}
                    onChange={(event) =>
                      setOverrideForm({ ...overrideForm, endTime: event.target.value })
                    }
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={
                  busy ||
                  !overrideForm.classGroupId ||
                  !overrideForm.date ||
                  !overrideForm.label.trim()
                }
              >
                Add Schedule Override
              </button>
            </form>
          </EditFocusDialog>

          {!compact ? (
            <EditFocusDialog
              open={editor === 'group'}
              title="Add Class Group"
              description="Set the Course, period, days, and local meeting times for this Academic Year."
              onClose={() => setEditor(null)}
              busy={busy}
            >
              <form
                className="card stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void (async () => {
                    try {
                      setBusy(true);
                      await api.createClassGroup({
                        courseId: groupForm.courseId,
                        academicYearId: yearId,
                        name: groupForm.name,
                        periodLabel: groupForm.periodLabel || null,
                        room: groupForm.room || null,
                        meetingRules: [
                          {
                            weekdays: groupForm.weekdays,
                            startTime: groupForm.startTime,
                            endTime: groupForm.endTime,
                            effectiveStart: null,
                            effectiveEnd: null,
                            room: groupForm.room || null
                          }
                        ]
                      });
                      setGroupForm({ ...groupForm, name: '', periodLabel: '', room: '' });
                      setMessage(
                        'Class Group created. Preview its generated instructional meetings.'
                      );
                      await refreshYear();
                      setEditor(null);
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Unable to create Class Group.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                <h3>Add Class Group and meeting rule</h3>
                <div className="three-column">
                  <label>
                    Course
                    <select
                      className="input"
                      value={groupForm.courseId}
                      onChange={(event) =>
                        setGroupForm({ ...groupForm, courseId: event.target.value })
                      }
                    >
                      <option value="">Select Course</option>
                      {courses.map((course) => (
                        <option value={course.id} key={course.id}>
                          {course.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Class Group name
                    <input
                      className="input"
                      value={groupForm.name}
                      onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })}
                      placeholder="Period 3"
                    />
                  </label>
                  <label>
                    Room
                    <input
                      className="input"
                      value={groupForm.room}
                      onChange={(event) => setGroupForm({ ...groupForm, room: event.target.value })}
                    />
                  </label>
                </div>
                <div className="row weekday-buttons" role="group" aria-label="Meeting weekdays">
                  {weekdayLabels.map((label, weekday) => (
                    <button
                      className={
                        groupForm.weekdays.includes(weekday) ? 'weekday-selected' : 'secondary'
                      }
                      type="button"
                      key={label}
                      aria-pressed={groupForm.weekdays.includes(weekday)}
                      onClick={() =>
                        setGroupForm({
                          ...groupForm,
                          weekdays: groupForm.weekdays.includes(weekday)
                            ? groupForm.weekdays.filter((value) => value !== weekday)
                            : [...groupForm.weekdays, weekday].sort()
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="two-column">
                  <label>
                    Starts
                    <input
                      className="input"
                      type="time"
                      value={groupForm.startTime}
                      onChange={(event) =>
                        setGroupForm({ ...groupForm, startTime: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      className="input"
                      type="time"
                      value={groupForm.endTime}
                      onChange={(event) =>
                        setGroupForm({ ...groupForm, endTime: event.target.value })
                      }
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !groupForm.courseId ||
                    !groupForm.name.trim() ||
                    !groupForm.weekdays.length
                  }
                >
                  Create Class Group
                </button>
              </form>
            </EditFocusDialog>
          ) : null}

          <div className="card stack">
            <div className="row spread">
              <h3>Generated instructional meetings</h3>
              <select
                className="input"
                value={selectedGroupId}
                onChange={(event) => setSelectedGroupId(event.target.value)}
              >
                <option value="">Select a Class Group</option>
                {groups.map((group) => (
                  <option value={group.id} key={group.id}>
                    {group.courseName} · {group.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedGroupId ? (
              <div className="row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      setPreview(await api.recalculateMeetings(selectedGroupId, 'preview'));
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Unable to calculate impact.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Preview recalculation
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      const result = await api.recalculateMeetings(
                        selectedGroupId,
                        preview?.affectedPlanned ? 'meetings_only' : 'meetings_only'
                      );
                      setPreview(result);
                      setMessage(
                        'Meetings recalculated. Planned curriculum was retained as conflicts where needed.'
                      );
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Unable to recalculate meetings.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Recalculate meetings only
                </button>
                {preview?.affectedPlanned ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        setBusy(true);
                        const result = await api.recalculateMeetings(selectedGroupId, 'shift');
                        setPreview(result);
                        setMessage('Affected plans were shifted to future instructional meetings.');
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Unable to shift plans.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Recalculate and shift affected plans
                  </button>
                ) : null}
              </div>
            ) : null}
            {preview ? (
              <p className="field-note">
                {preview.generated} generated · {preview.updated} updated · {preview.removedUnused}{' '}
                unused meetings removed · {preview.affectedPlanned} planned meetings /{' '}
                {preview.affectedPlanAllocations} Lesson allocations affected ·{' '}
                {preview.historicalPreserved} historical meetings preserved.
              </p>
            ) : null}
            {preview?.proposedRemappings.length ? (
              <ul className="schedule-warnings">
                {preview.proposedRemappings.map((remapping) => (
                  <li key={remapping.fromMeetingId}>
                    Meeting {remapping.fromMeetingNumber} → {remapping.toLocalDate} at{' '}
                    {remapping.toStartTime}
                  </li>
                ))}
              </ul>
            ) : null}
            {preview?.conflicts.length ? (
              <ul className="schedule-warnings">
                {preview.conflicts.map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="calendar-summary two-column">
            <div>
              <h3>Calendar Events</h3>
              {calendar?.events.length ? (
                <ul>
                  {calendar.events.map((event) => (
                    <li key={String(event.id)}>
                      {String(event.startDate)}
                      {event.startDate !== event.endDate ? `–${String(event.endDate)}` : ''}:{' '}
                      {String(event.label)}
                      {event.instructional ? ' (instructional)' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No events yet.</p>
              )}
            </div>
            <div>
              <h3>Schedule Overrides</h3>
              {calendar?.overrides.length ? (
                <ul>
                  {calendar.overrides.map((override) => (
                    <li key={String(override.id)}>
                      {String(override.date)}: {String(override.label)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No overrides yet.</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
