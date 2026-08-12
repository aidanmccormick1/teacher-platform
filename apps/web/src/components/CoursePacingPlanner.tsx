import { useEffect, useMemo, useState } from 'react';

import type { CourseDetailResponse, CoursePacingPlanUpsertRequest } from '@teacheros/contracts';

type PacingDraft = {
  startDate: string;
  weeks: string;
  meetingsPerWeek: string;
  plannedClassPeriods: string;
  classPeriodMinutes: string;
  notes: string;
};

type Props = {
  course: CourseDetailResponse['course'];
  scheduleMeetingsPerWeek: number | null;
  saving: boolean;
  onSave: (body: CoursePacingPlanUpsertRequest) => Promise<void>;
};

function positiveInteger(value: string): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function initialDraft(course: CourseDetailResponse['course']): PacingDraft {
  const plan = course.pacingPlan;
  return {
    startDate: plan?.startDate ?? '',
    weeks: plan?.weeks?.toString() ?? '',
    meetingsPerWeek: plan?.meetingsPerWeek?.toString() ?? '',
    plannedClassPeriods: plan?.plannedClassPeriods?.toString() ?? '',
    classPeriodMinutes: plan?.classPeriodMinutes.toString() ?? '50',
    notes: plan?.notes ?? ''
  };
}

function classLabel(period: number, meetingsPerWeek: number): string {
  const week = Math.floor((period - 1) / meetingsPerWeek) + 1;
  const meeting = ((period - 1) % meetingsPerWeek) + 1;
  return `Week ${week}, class ${meeting}`;
}

export function CoursePacingPlanner({
  course,
  scheduleMeetingsPerWeek,
  saving,
  onSave
}: Props) {
  const [draft, setDraft] = useState<PacingDraft>(() => initialDraft(course));

  useEffect(() => {
    setDraft(initialDraft(course));
  }, [course]);

  const weeks = positiveInteger(draft.weeks);
  const meetingsPerWeek = positiveInteger(draft.meetingsPerWeek);
  const plannedClassPeriods = positiveInteger(draft.plannedClassPeriods);
  const classPeriodMinutes = positiveInteger(draft.classPeriodMinutes) ?? 50;
  const computedPeriods = weeks && meetingsPerWeek ? weeks * meetingsPerWeek : null;
  const availablePeriods = plannedClassPeriods ?? computedPeriods;

  const timeline = useMemo(() => {
    if (!meetingsPerWeek) return [];
    let nextPeriod = 1;
    return course.units.map((unit) => {
      const lessons = unit.lessons.map((lesson) => {
        const periods = Math.max(
          1,
          Math.ceil((lesson.estimatedDurationMinutes ?? classPeriodMinutes) / classPeriodMinutes)
        );
        const startPeriod = nextPeriod;
        nextPeriod += periods;
        return { id: lesson.id, title: lesson.title, periods, startPeriod, endPeriod: nextPeriod - 1 };
      });

      return {
        id: unit.id,
        title: unit.title,
        startPeriod: lessons[0]?.startPeriod ?? nextPeriod,
        endPeriod: lessons[lessons.length - 1]?.endPeriod ?? nextPeriod - 1,
        lessons
      };
    });
  }, [classPeriodMinutes, course.units, meetingsPerWeek]);

  const usedPeriods = timeline.flatMap((unit) => unit.lessons).reduce((total, lesson) => total + lesson.periods, 0);

  return (
    <section className="card stack pacing-planner">
      <div>
        <p className="eyebrow">Plan your year</p>
        <h3>Year timeline</h3>
        <p className="muted">
          Start with the number you know. Enter teaching weeks to fill class meetings automatically,
          or enter class meetings and we will estimate the weeks you need.
        </p>
      </div>

      {scheduleMeetingsPerWeek ? (
        <div className="pacing-schedule-hint">
          Your saved schedule shows this course meets about {scheduleMeetingsPerWeek} day
          {scheduleMeetingsPerWeek === 1 ? '' : 's'} each week.
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setDraft((current) => {
                const periods = positiveInteger(current.plannedClassPeriods);
                return {
                  ...current,
                  meetingsPerWeek: String(scheduleMeetingsPerWeek),
                  weeks:
                    periods === null ? current.weeks : String(Math.ceil(periods / scheduleMeetingsPerWeek))
                };
              })
            }
          >
            Use my schedule
          </button>
        </div>
      ) : null}

      <div className="three-column">
        <label>
          First teaching day
          <input
            className="input"
            type="date"
            value={draft.startDate}
            onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
          />
        </label>
        <label>
          Teaching weeks
          <input
            className="input"
            inputMode="numeric"
            value={draft.weeks}
            onChange={(event) => {
              const nextWeeks = event.target.value;
              setDraft((current) => {
                const nextMeetings = positiveInteger(current.meetingsPerWeek);
                return {
                  ...current,
                  weeks: nextWeeks,
                  plannedClassPeriods:
                    positiveInteger(nextWeeks) && nextMeetings
                      ? String(positiveInteger(nextWeeks)! * nextMeetings)
                      : current.plannedClassPeriods
                };
              });
            }}
            placeholder="e.g. 36"
          />
        </label>
        <label>
          Class meetings each week
          <input
            className="input"
            inputMode="numeric"
            value={draft.meetingsPerWeek}
            onChange={(event) => {
              const nextMeetings = event.target.value;
              setDraft((current) => {
                const nextWeeks = positiveInteger(current.weeks);
                return {
                  ...current,
                  meetingsPerWeek: nextMeetings,
                  plannedClassPeriods:
                    nextWeeks && positiveInteger(nextMeetings)
                      ? String(nextWeeks * positiveInteger(nextMeetings)!)
                      : current.plannedClassPeriods
                };
              });
            }}
            placeholder="e.g. 5"
          />
        </label>
      </div>

      <div className="two-column">
        <label>
          Class periods available
          <input
            className="input"
            inputMode="numeric"
            value={draft.plannedClassPeriods}
            onChange={(event) => {
              const nextPeriods = event.target.value;
              setDraft((current) => {
                const nextMeetings = positiveInteger(current.meetingsPerWeek);
                const periods = positiveInteger(nextPeriods);
                return {
                  ...current,
                  plannedClassPeriods: nextPeriods,
                  weeks: periods && nextMeetings ? String(Math.ceil(periods / nextMeetings)) : current.weeks
                };
              });
            }}
            placeholder="e.g. 180"
          />
          <span className="field-note">Changing this estimate updates the teaching weeks above.</span>
        </label>
        <label>
          Minutes in one class period
          <input
            className="input"
            inputMode="numeric"
            value={draft.classPeriodMinutes}
            onChange={(event) =>
              setDraft((current) => ({ ...current, classPeriodMinutes: event.target.value }))
            }
            placeholder="50"
          />
        </label>
      </div>

      <label>
        Planning notes (private to your account)
        <textarea
          className="input"
          rows={3}
          value={draft.notes}
          onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          placeholder="Testing windows, field trips, goals, or reminders for this course..."
        />
      </label>

      <div className="pacing-summary" aria-live="polite">
        {availablePeriods ? (
          <>
            <strong>{availablePeriods} class periods</strong> planned
            {weeks && meetingsPerWeek ? ` across ${weeks} teaching weeks.` : '.'}
          </>
        ) : (
          <>Add teaching weeks or class periods to begin your year timeline.</>
        )}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() =>
          void onSave({
            startDate: draft.startDate || null,
            weeks,
            meetingsPerWeek,
            plannedClassPeriods: availablePeriods,
            classPeriodMinutes,
            notes: draft.notes.trim() || null
          })
        }
      >
        Save year timeline
      </button>

      {meetingsPerWeek && timeline.length > 0 ? (
        <div className="year-timeline">
          <div className="row spread">
            <h4>Lesson timeline</h4>
            <span className="muted">
              {usedPeriods} of {availablePeriods ?? '—'} planned periods used
            </span>
          </div>
          {timeline.map((unit) => (
            <div className="timeline-unit" key={unit.id}>
              <strong>
                {unit.title}{' '}
                {unit.lessons.length > 0
                  ? `· ${classLabel(unit.startPeriod, meetingsPerWeek)}–${classLabel(unit.endPeriod, meetingsPerWeek)}`
                  : '· no lessons yet'}
              </strong>
              {unit.lessons.map((lesson) => (
                <div className="timeline-lesson" key={lesson.id}>
                  <span>{lesson.title}</span>
                  <span className="muted">
                    {lesson.periods} period{lesson.periods === 1 ? '' : 's'} ·{' '}
                    {classLabel(lesson.startPeriod, meetingsPerWeek)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
