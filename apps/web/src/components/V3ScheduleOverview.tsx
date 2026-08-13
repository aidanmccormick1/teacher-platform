import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AcademicYear, V3CourseDetail } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

const weekdays = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' }
] as const;

type ScheduleGroup = V3CourseDetail['course']['classGroups'][number] & {
  courseId: string;
  courseName: string;
};

type V3ScheduleOverviewProps = {
  refreshKey: number;
  onOpenImport: () => void;
};

function minutesSinceMidnight(time: string): number {
  const [hour = Number.NaN, minute = Number.NaN] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : Number.MAX_SAFE_INTEGER;
}

function formatTime(time: string): string {
  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour) || !minute) return time;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function V3ScheduleOverview({ refreshKey, onOpenImport }: V3ScheduleOverviewProps) {
  const api = useApiClient();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [academicYearId, setAcademicYearId] = useState('');
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedYear = useMemo(
    () => years.find((year) => year.id === academicYearId) ?? null,
    [academicYearId, years]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const yearResponse = await api.listAcademicYears();
      setYears(yearResponse.years);
      const nextYearId =
        yearResponse.years.find((year) => year.id === academicYearId)?.id ??
        yearResponse.years.find((year) => year.isActive)?.id ??
        yearResponse.years[0]?.id ??
        '';
      setAcademicYearId(nextYearId);

      if (!nextYearId) {
        setGroups([]);
        setError(null);
        return;
      }

      const groupResponse = await api.listV3ClassGroups(nextYearId);
      const courseIds = [...new Set(groupResponse.classGroups.map((group) => group.courseId))];
      const details = await Promise.all(courseIds.map((courseId) => api.getV3CourseDetail(courseId)));
      const detailByCourseId = new Map(details.map((detail) => [detail.course.id, detail]));
      const nextGroups = groupResponse.classGroups.flatMap((row) => {
        const group = detailByCourseId
          .get(row.courseId)
          ?.course.classGroups.find((candidate) => candidate.id === row.id);
        return group
          ? [{ ...group, courseId: row.courseId, courseName: row.courseName }]
          : [];
      });
      setGroups(nextGroups);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load your saved Class Group schedule.');
    } finally {
      setLoading(false);
    }
  }, [academicYearId, api]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const groupsByDay = useMemo(() => {
    const result = new Map<number, Array<{ group: ScheduleGroup; rule: ScheduleGroup['meetingRules'][number] }>>();
    for (const group of groups) {
      for (const rule of group.meetingRules) {
        for (const weekday of rule.weekdays) {
          const entries = result.get(weekday) ?? [];
          entries.push({ group, rule });
          result.set(weekday, entries);
        }
      }
    }
    for (const entries of result.values()) {
      entries.sort((left, right) => minutesSinceMidnight(left.rule.startTime) - minutesSinceMidnight(right.rule.startTime));
    }
    return result;
  }, [groups]);

  return (
    <section className="card stack v3-schedule-overview" aria-labelledby="v3-schedule-overview-title">
      <div className="row spread v3-schedule-overview-header">
        <div>
          <p className="eyebrow">Saved Class Group schedule</p>
          <h2 id="v3-schedule-overview-title">Your teaching week</h2>
          <p className="muted">
            Each box is a saved Class Group meeting rule. Weekdays, times, and rooms are structured
            data—not a typed schedule summary.
          </p>
        </div>
        <div className="row v3-schedule-overview-actions">
          {years.length ? (
            <label>
              Academic Year
              <select
                className="input"
                value={academicYearId}
                onChange={(event) => setAcademicYearId(event.target.value)}
              >
                {years.map((year) => (
                  <option value={year.id} key={year.id}>
                    {year.name}{year.isActive ? ' · Active' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Link className="button-link secondary" to="/curriculum">
            Manage Class Groups
          </Link>
          <button type="button" onClick={onOpenImport}>
            Import or update
          </button>
        </div>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading saved meeting rules…</p> : null}
      {!loading && !selectedYear ? (
        <div className="empty-state">
          <strong>Start with an Academic Year.</strong>
          <span className="muted">Then import or add Class Groups with their actual meeting times.</span>
        </div>
      ) : null}
      {!loading && selectedYear && !groups.length ? (
        <div className="empty-state">
          <strong>No Class Groups are scheduled for {selectedYear.name}.</strong>
          <span className="muted">Import a schedule or create Class Groups inside a Course.</span>
        </div>
      ) : null}
      {!loading && groups.length ? (
        <div className="v3-week-grid" aria-label="Weekly Class Group schedule">
          {weekdays.map((day) => {
            const entries = groupsByDay.get(day.value) ?? [];
            return (
              <section className="v3-week-day" key={day.value}>
                <h3>{day.label}</h3>
                {entries.length ? (
                  entries.map(({ group, rule }) => (
                    <Link
                      className="v3-schedule-slot"
                      key={`${group.id}-${rule.id}-${day.value}`}
                      to={`/classroom?classGroupId=${encodeURIComponent(group.id)}`}
                    >
                      <span className="v3-schedule-slot-time">
                        {formatTime(rule.startTime)}–{formatTime(rule.endTime)}
                      </span>
                      <strong>{group.periodLabel || group.name}</strong>
                      <span>{group.courseName}</span>
                      <small>{rule.room ?? group.room ?? 'Room not set'}</small>
                    </Link>
                  ))
                ) : (
                  <span className="v3-week-day-empty">No meetings</span>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
