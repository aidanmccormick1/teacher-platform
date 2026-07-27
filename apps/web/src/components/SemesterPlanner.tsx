import { useState } from 'react';

import type { GenerateSemesterResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type SemesterPlannerProps = {
  courseName: string;
  subject: string | null;
  gradeLevel: string | null;
  onApplyPlan: (plan: GenerateSemesterResponse) => Promise<void>;
};

export function SemesterPlanner(props: SemesterPlannerProps) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState(18);
  const [meetingsPerWeek, setMeetingsPerWeek] = useState(5);
  const [unitCount, setUnitCount] = useState(6);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [plan, setPlan] = useState<GenerateSemesterResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="semester-planner card stack">
      <div className="row spread">
        <div>
          <h3>Semester plan</h3>
          <p className="muted">
            Build an editable outline from your course context before adding anything to your
            curriculum.
          </p>
        </div>
        <button className="secondary" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close planner' : 'Plan a semester'}
        </button>
      </div>
      {open ? (
        <>
          <div className="three-column">
            <label>
              Weeks
              <input
                className="input"
                type="number"
                min={1}
                max={52}
                value={weeks}
                onChange={(event) => setWeeks(Number(event.target.value) || 1)}
              />
            </label>
            <label>
              Meetings each week
              <input
                className="input"
                type="number"
                min={1}
                max={7}
                value={meetingsPerWeek}
                onChange={(event) => setMeetingsPerWeek(Number(event.target.value) || 1)}
              />
            </label>
            <label>
              Units
              <input
                className="input"
                type="number"
                min={1}
                max={12}
                value={unitCount}
                onChange={(event) => setUnitCount(Number(event.target.value) || 1)}
              />
            </label>
          </div>
          <label>
            What should shape this semester?
            <textarea
              rows={3}
              value={teacherNotes}
              onChange={(event) => setTeacherNotes(event.target.value)}
              placeholder="For example: build toward a research project, reserve a week for review, use hands-on labs often, include specific standards or texts."
            />
          </label>
          <button
            type="button"
            disabled={working}
            onClick={async () => {
              try {
                setWorking(true);
                setPlan(
                  await api.generateSemester({
                    courseName: props.courseName,
                    subject: props.subject,
                    gradeLevel: props.gradeLevel,
                    timeframeWeeks: weeks,
                    meetingsPerWeek,
                    unitCount,
                    teacherNotes: teacherNotes.trim() || null
                  })
                );
                setError(null);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Unable to draft a semester plan');
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? 'Building your outline...' : 'Create editable outline'}
          </button>
          {error ? <p className="error-message">{error}</p> : null}
          {plan ? (
            <div className="semester-plan stack">
              <textarea
                rows={3}
                value={plan.overview}
                onChange={(event) => setPlan({ ...plan, overview: event.target.value })}
                aria-label="Semester overview"
              />
              {plan.units.map((unit, unitIndex) => (
                <div className="unit-plan card stack" key={`${unit.title}-${unitIndex}`}>
                  <input
                    className="input activity-title"
                    value={unit.title}
                    onChange={(event) => {
                      const units = [...plan.units];
                      units[unitIndex] = { ...unit, title: event.target.value };
                      setPlan({ ...plan, units });
                    }}
                  />
                  <textarea
                    rows={2}
                    value={unit.description}
                    onChange={(event) => {
                      const units = [...plan.units];
                      units[unitIndex] = { ...unit, description: event.target.value };
                      setPlan({ ...plan, units });
                    }}
                  />
                  {unit.lessons.map((lesson, lessonIndex) => (
                    <div className="lesson-plan-row" key={`${lesson.title}-${lessonIndex}`}>
                      <input
                        className="input"
                        value={lesson.title}
                        onChange={(event) => {
                          const units = [...plan.units];
                          const lessons = [...unit.lessons];
                          lessons[lessonIndex] = { ...lesson, title: event.target.value };
                          units[unitIndex] = { ...unit, lessons };
                          setPlan({ ...plan, units });
                        }}
                      />
                      <textarea
                        rows={2}
                        value={lesson.description}
                        onChange={(event) => {
                          const units = [...plan.units];
                          const lessons = [...unit.lessons];
                          lessons[lessonIndex] = { ...lesson, description: event.target.value };
                          units[unitIndex] = { ...unit, lessons };
                          setPlan({ ...plan, units });
                        }}
                      />
                      <input
                        className="input minutes-input"
                        type="number"
                        min={1}
                        value={lesson.estimatedDurationMinutes}
                        onChange={(event) => {
                          const units = [...plan.units];
                          const lessons = [...unit.lessons];
                          lessons[lessonIndex] = {
                            ...lesson,
                            estimatedDurationMinutes: Number(event.target.value) || 1
                          };
                          units[unitIndex] = { ...unit, lessons };
                          setPlan({ ...plan, units });
                        }}
                        aria-label={`${lesson.title} minutes`}
                      />
                    </div>
                  ))}
                </div>
              ))}
              <button
                type="button"
                disabled={working}
                onClick={async () => {
                  try {
                    setWorking(true);
                    await props.onApplyPlan(plan);
                    setPlan(null);
                    setOpen(false);
                    setError(null);
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.message
                        : 'Unable to add this outline to the course'
                    );
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                Add this outline to my course
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
