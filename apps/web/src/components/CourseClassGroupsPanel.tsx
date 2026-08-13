import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  AcademicYear,
  ClassGroupInput,
  ClassGroupUpdateInput,
  MeetingRuleInput,
  V3CourseDetail
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { EditFocusDialog } from './EditFocusDialog.js';

const weekdays = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' }
] as const;

type RuleDraft = {
  weekdays: number[];
  startTime: string;
  endTime: string;
  room: string;
  effectiveStart: string;
  effectiveEnd: string;
};

type GroupDraft = {
  id: string | null;
  academicYearId: string;
  name: string;
  periodLabel: string;
  room: string;
  rules: RuleDraft[];
};

const defaultRule = (): RuleDraft => ({
  weekdays: [1, 3, 5],
  startTime: '09:00',
  endTime: '09:50',
  room: '',
  effectiveStart: '',
  effectiveEnd: ''
});

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function ruleToInput(rule: RuleDraft): MeetingRuleInput {
  return {
    weekdays: [...rule.weekdays].sort((left, right) => left - right),
    startTime: rule.startTime,
    endTime: rule.endTime,
    room: toNullable(rule.room),
    effectiveStart: rule.effectiveStart || null,
    effectiveEnd: rule.effectiveEnd || null
  };
}

function daySummary(values: number[]): string {
  return weekdays
    .filter((day) => values.includes(day.value))
    .map((day) => day.label)
    .join(' · ');
}

function toDraft(group: V3CourseDetail['course']['classGroups'][number]): GroupDraft {
  return {
    id: group.id,
    academicYearId: group.academicYearId,
    name: group.name,
    periodLabel: group.periodLabel ?? '',
    room: group.room ?? '',
    rules: group.meetingRules.map((rule) => ({
      weekdays: rule.weekdays,
      startTime: rule.startTime,
      endTime: rule.endTime,
      room: rule.room ?? group.room ?? '',
      effectiveStart: rule.effectiveStart ?? '',
      effectiveEnd: rule.effectiveEnd ?? ''
    }))
  };
}

type CourseClassGroupsPanelProps = { courseId: string };

export function CourseClassGroupsPanel({ courseId }: CourseClassGroupsPanelProps) {
  const api = useApiClient();
  const [detail, setDetail] = useState<V3CourseDetail | null>(null);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [impact, setImpact] = useState<{
    classGroupId: string;
    change: ClassGroupUpdateInput;
    preview: Awaited<ReturnType<typeof api.recalculateMeetings>>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeYear = useMemo(
    () => years.find((year) => year.isActive) ?? years[0] ?? null,
    [years]
  );

  const refresh = useCallback(async () => {
    try {
      const [next, yearResponse] = await Promise.all([
        api.getV3CourseDetail(courseId),
        api.listAcademicYears()
      ]);
      setDetail(next);
      setYears(yearResponse.years);
      const percentageRows = await Promise.all(
        next.course.classGroups.map(async (group) => {
          const percentage = await api.getPlannedPercentage(group.id).catch(() => null);
          return [group.id, percentage?.percent ?? 0] as const;
        })
      );
      setMetrics(Object.fromEntries(percentageRows));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to load this Course’s Class Groups.'
      );
    }
  }, [api, courseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openNewGroup() {
    if (!activeYear) {
      setError('Create an Academic Year before adding a Class Group.');
      return;
    }
    setDraft({
      id: null,
      academicYearId: activeYear.id,
      name: '',
      periodLabel: '',
      room: '',
      rules: [defaultRule()]
    });
  }

  function updateRule(index: number, update: Partial<RuleDraft>) {
    if (!draft) return;
    const rules = [...draft.rules];
    rules[index] = { ...rules[index]!, ...update };
    setDraft({ ...draft, rules });
  }

  async function saveGroup() {
    if (!draft) return;
    if (
      !draft.name.trim() ||
      !draft.rules.every((rule) => rule.weekdays.length && rule.startTime && rule.endTime)
    ) {
      setError('Give the Class Group a name and at least one complete meeting-time box.');
      return;
    }
    try {
      setBusy(true);
      const meetingRules = draft.rules.map(ruleToInput);
      let groupId = draft.id;
      if (draft.id) {
        const change: ClassGroupUpdateInput = {
          name: draft.name.trim(),
          periodLabel: toNullable(draft.periodLabel),
          room: toNullable(draft.room),
          meetingRules
        };
        const preview = await api.previewClassGroupScheduleChange(draft.id, change);
        setImpact({ classGroupId: draft.id, change, preview });
        setDraft(null);
        return;
      } else {
        const body: ClassGroupInput = {
          courseId,
          academicYearId: draft.academicYearId,
          name: draft.name.trim(),
          periodLabel: toNullable(draft.periodLabel),
          room: toNullable(draft.room),
          meetingRules
        };
        const result = await api.createClassGroup(body);
        groupId = result.classGroup.id;
      }
      setDraft(null);
      if (!groupId) return;
      await api.recalculateMeetings(groupId, 'meetings_only');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save this Class Group.');
    } finally {
      setBusy(false);
    }
  }

  async function applyImpact(mode: 'meetings_only' | 'shift') {
    if (!impact) return;
    try {
      setBusy(true);
      const saved = await api.updateClassGroup(impact.classGroupId, impact.change);
      if (!saved.requiresRecalculation) {
        setImpact(null);
        await refresh();
        return;
      }
      await api.recalculateMeetings(impact.classGroupId, mode);
      setImpact(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to recalculate this Class Group.');
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="muted">Loading Class Groups…</p>;

  return (
    <section className="course-class-groups stack" aria-labelledby="course-class-groups-title">
      <div className="row spread">
        <div>
          <p className="eyebrow">Actual teaching groups</p>
          <h2 id="course-class-groups-title">Class Groups</h2>
          <p className="muted">
            Each Class Group has its own meeting times, planning, progress, and teaching history.
          </p>
        </div>
        <button type="button" onClick={openNewGroup}>
          Add Class Group
        </button>
      </div>
      {error ? <p className="error-message">{error}</p> : null}
      {!detail.course.classGroups.length ? (
        <div className="card empty-state">
          <strong>No Class Groups yet.</strong>
          <span className="muted">
            Add a period or group to give this shared Course an actual schedule.
          </span>
        </div>
      ) : (
        <div className="class-group-grid">
          {detail.course.classGroups.map((group) => (
            <article className="class-group-card stack" key={group.id}>
              <div className="row spread">
                <div>
                  <p className="eyebrow">{group.periodLabel || 'Class Group'}</p>
                  <h3>{group.name}</h3>
                  <p className="muted">
                    {years.find((year) => year.id === group.academicYearId)?.name ??
                      'Academic Year'}{' '}
                    · {Math.round(metrics[group.id] ?? 0)}% planned
                  </p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDraft(toDraft(group))}
                >
                  Edit group
                </button>
              </div>
              <div className="meeting-times-box stack">
                <div className="row spread">
                  <strong>Meeting times</strong>
                  {group.room ? (
                    <span className="field-note">Default room: {group.room}</span>
                  ) : null}
                </div>
                {group.meetingRules.length ? (
                  group.meetingRules.map((rule) => (
                    <div className="meeting-rule-summary" key={rule.id}>
                      <div className="weekday-chip-list" aria-label="Meeting days">
                        {weekdays
                          .filter((day) => rule.weekdays.includes(day.value))
                          .map((day) => (
                            <span className="weekday-chip" key={day.value}>
                              {day.label}
                            </span>
                          ))}
                      </div>
                      <strong>
                        {rule.startTime}–{rule.endTime}
                      </strong>
                      <span className="muted">{rule.room ?? group.room ?? 'Room not set'}</span>
                      {rule.effectiveStart || rule.effectiveEnd ? (
                        <span className="field-note">
                          Effective {rule.effectiveStart ?? 'start of year'}–
                          {rule.effectiveEnd ?? 'end of year'}
                        </span>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="muted">No recurring meeting times are set.</p>
                )}
              </div>
              <div className="row">
                <Link className="button-link secondary" to="/classroom">
                  Open Classroom
                </Link>
              </div>
              {impact?.classGroupId === group.id ? (
                <div className="recalculation-impact stack" role="status">
                  <strong>Review schedule impact before applying this change</strong>
                  <span>
                    {impact.preview.removedUnused} unused meetings removed ·{' '}
                    {impact.preview.affectedPlanned} planned meetings affected ·{' '}
                    {impact.preview.historicalPreserved} historical meetings protected.
                  </span>
                  {impact.preview.affectedPlanAllocations ? (
                    <p className="schedule-warnings">
                      {impact.preview.affectedPlanAllocations} Plan Allocations need a decision.
                    </p>
                  ) : null}
                  <div className="row">
                    <button type="button" disabled={busy} onClick={() => void applyImpact('shift')}>
                      Recalculate and shift plans
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void applyImpact('meetings_only')}
                    >
                      Recalculate meetings only
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => setImpact(null)}
                    >
                      Cancel change
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <EditFocusDialog
        open={draft !== null}
        title={draft?.id ? `Edit ${draft.name || 'Class Group'}` : 'Add Class Group'}
        description="Use weekday boxes for every recurring meeting time. Add another box only when this group meets at a different time, room, or effective date."
        onClose={() => setDraft(null)}
        busy={busy}
      >
        {draft ? (
          <div className="stack">
            {!draft.id ? (
              <label>
                Academic Year
                <select
                  className="input"
                  value={draft.academicYearId}
                  onChange={(event) => setDraft({ ...draft, academicYearId: event.target.value })}
                >
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                      {year.isActive ? ' · Active' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="three-column">
              <label>
                Class Group name
                <input
                  className="input"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Period 3 or Group A"
                />
              </label>
              <label>
                Period label
                <input
                  className="input"
                  value={draft.periodLabel}
                  onChange={(event) => setDraft({ ...draft, periodLabel: event.target.value })}
                  placeholder="Period 3"
                />
              </label>
              <label>
                Default room
                <input
                  className="input"
                  value={draft.room}
                  onChange={(event) => setDraft({ ...draft, room: event.target.value })}
                  placeholder="Room 204"
                />
              </label>
            </div>
            <div className="stack" aria-label="Recurring meeting times">
              <div className="row spread">
                <div>
                  <h3>Recurring meeting times</h3>
                  <p className="field-note">Each box is one shared time pattern.</p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDraft({ ...draft, rules: [...draft.rules, defaultRule()] })}
                >
                  Add meeting time
                </button>
              </div>
              {draft.rules.map((rule, index) => (
                <div className="meeting-rule-editor stack" key={index}>
                  <div className="row spread">
                    <strong>Meeting time {index + 1}</strong>
                    {draft.rules.length > 1 ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            rules: draft.rules.filter((_, ruleIndex) => ruleIndex !== index)
                          })
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div
                    className="weekday-toggle-grid"
                    role="group"
                    aria-label={`Meeting time ${index + 1} weekdays`}
                  >
                    {weekdays.map((day) => {
                      const selected = rule.weekdays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          className={selected ? 'weekday-toggle-selected' : 'secondary'}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            updateRule(index, {
                              weekdays: selected
                                ? rule.weekdays.filter((weekday) => weekday !== day.value)
                                : [...rule.weekdays, day.value]
                            })
                          }
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="three-column">
                    <label>
                      Starts
                      <input
                        className="input"
                        type="time"
                        value={rule.startTime}
                        onChange={(event) => updateRule(index, { startTime: event.target.value })}
                      />
                    </label>
                    <label>
                      Ends
                      <input
                        className="input"
                        type="time"
                        value={rule.endTime}
                        onChange={(event) => updateRule(index, { endTime: event.target.value })}
                      />
                    </label>
                    <label>
                      Room
                      <input
                        className="input"
                        value={rule.room}
                        onChange={(event) => updateRule(index, { room: event.target.value })}
                        placeholder={draft.room || 'Optional'}
                      />
                    </label>
                  </div>
                  <div className="two-column">
                    <label>
                      Effective from
                      <input
                        className="input"
                        type="date"
                        value={rule.effectiveStart}
                        onChange={(event) =>
                          updateRule(index, { effectiveStart: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Effective through
                      <input
                        className="input"
                        type="date"
                        value={rule.effectiveEnd}
                        onChange={(event) =>
                          updateRule(index, { effectiveEnd: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <p className="field-note">
                    {daySummary(rule.weekdays) || 'Choose at least one day'} ·{' '}
                    {rule.startTime || 'Start'}–{rule.endTime || 'End'}
                  </p>
                </div>
              ))}
            </div>
            <div className="row">
              <button type="button" disabled={busy} onClick={() => void saveGroup()}>
                {draft.id ? 'Save Class Group' : 'Create Class Group'}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </EditFocusDialog>
    </section>
  );
}
