import { useState } from 'react';

import type { GenerateActivityResponse } from '@teacheros/contracts';

import { EditFocusDialog } from './EditFocusDialog.js';
import { ApiError, useApiClient } from '../lib/api.js';

type ActivityStudioProps = {
  courseName: string;
  subject: string | null;
  gradeLevel: string | null;
  lessonTitle: string;
  objective: string | null;
  estimatedDurationMinutes: number | null;
  onAddSteps: (steps: GenerateActivityResponse['steps']) => Promise<void>;
};

function printableText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function ActivityStudio(props: ActivityStudioProps) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [activityType, setActivityType] = useState('Small-group activity');
  const [durationMinutes, setDurationMinutes] = useState(props.estimatedDurationMinutes ?? 45);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [activity, setActivity] = useState<GenerateActivityResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const printHandout = () => {
    if (!activity) return;
    const handout = activity.studentHandout;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) {
      setError('Allow pop-ups to print or save this activity as a PDF.');
      return;
    }

    printWindow.document.write(
      `<!doctype html><html><head><title>${printableText(handout.title)}</title><style>body{font-family:Arial,sans-serif;max-width:720px;margin:48px auto;color:#18253d;line-height:1.5}h1{font-size:24px;margin-bottom:8px}h2{font-size:16px;margin-top:28px}li{margin:10px 0}.name{margin:24px 0 32px;border-bottom:1px solid #444;padding-bottom:8px}@media print{body{margin:0}}</style></head><body><h1>${printableText(handout.title)}</h1><div class="name">Name: ____________________________________</div><h2>Directions</h2><p>${printableText(handout.directions)}</p><h2>Your work</h2><ol>${handout.questions.map((question) => `<li>${printableText(question)}<br><br><br></li>`).join('')}</ol><script>window.onload=()=>window.print()</script></body></html>`
    );
    printWindow.document.close();
  };

  return (
    <div className="activity-studio">
      <button className="secondary" type="button" onClick={() => setOpen(true)}>
        Plan an activity
      </button>
      <EditFocusDialog
        open={open}
        title="Plan an activity"
        description="Draft, revise, and apply an activity without losing your place in the course."
        onClose={() => setOpen(false)}
        busy={working}
      >
        <div className="activity-studio-panel stack">
          <div>
            <h4>Make this lesson yours</h4>
            <p className="muted">
              Start with the lesson you already have, then add the details that matter today.
            </p>
          </div>
          <div className="two-column">
            <label>
              Activity format
              <select
                value={activityType}
                onChange={(event) => setActivityType(event.target.value)}
              >
                <option>Small-group activity</option>
                <option>Partner practice</option>
                <option>Independent practice</option>
                <option>Discussion and reflection</option>
                <option>Quick formative check</option>
              </select>
            </label>
            <label>
              Minutes
              <input
                className="input"
                min={5}
                max={180}
                type="number"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value) || 5)}
              />
            </label>
          </div>
          <label>
            Notes for this group today
            <textarea
              rows={3}
              value={teacherNotes}
              onChange={(event) => setTeacherNotes(event.target.value)}
              placeholder="For example: students need more vocabulary support; use the lab tables; keep materials to paper and pencils."
            />
          </label>
          <button
            type="button"
            disabled={working}
            onClick={async () => {
              try {
                setWorking(true);
                setActivity(
                  await api.generateActivity({
                    courseName: props.courseName,
                    subject: props.subject,
                    gradeLevel: props.gradeLevel,
                    lessonTitle: props.lessonTitle,
                    objective: props.objective,
                    durationMinutes,
                    activityType,
                    teacherNotes: teacherNotes.trim() || null
                  })
                );
                setError(null);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Unable to draft an activity');
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? 'Drafting activity...' : 'Draft activity'}
          </button>
          {error ? <p className="error-message">{error}</p> : null}
          {activity ? (
            <div className="activity-result stack">
              <input
                className="input activity-title"
                value={activity.title}
                onChange={(event) => setActivity({ ...activity, title: event.target.value })}
              />
              <textarea
                rows={2}
                value={activity.teacherSummary}
                onChange={(event) =>
                  setActivity({ ...activity, teacherSummary: event.target.value })
                }
                aria-label="Activity summary"
              />
              <div>
                <strong>Materials</strong>
                <textarea
                  rows={2}
                  value={activity.materials.join('\n')}
                  onChange={(event) =>
                    setActivity({
                      ...activity,
                      materials: event.target.value.split('\n').filter((item) => item.trim())
                    })
                  }
                />
              </div>
              <div className="stack">
                <strong>Lesson steps</strong>
                {activity.steps.map((step, index) => (
                  <div className="step-box" key={`${step.title}-${index}`}>
                    <input
                      className="input"
                      value={step.title}
                      onChange={(event) => {
                        const steps = [...activity.steps];
                        steps[index] = { ...step, title: event.target.value };
                        setActivity({ ...activity, steps });
                      }}
                    />
                    <textarea
                      rows={2}
                      value={step.directions}
                      onChange={(event) => {
                        const steps = [...activity.steps];
                        steps[index] = { ...step, directions: event.target.value };
                        setActivity({ ...activity, steps });
                      }}
                    />
                    <input
                      className="input minutes-input"
                      type="number"
                      min={1}
                      value={step.durationMinutes}
                      onChange={(event) => {
                        const steps = [...activity.steps];
                        steps[index] = {
                          ...step,
                          durationMinutes: Number(event.target.value) || 1
                        };
                        setActivity({ ...activity, steps });
                      }}
                      aria-label={`${step.title} minutes`}
                    />
                  </div>
                ))}
              </div>
              <div className="card stack handout-preview">
                <div>
                  <strong>Student handout</strong>
                  <p className="muted">Edit it here, then print or save it as a PDF.</p>
                </div>
                <input
                  className="input"
                  value={activity.studentHandout.title}
                  onChange={(event) =>
                    setActivity({
                      ...activity,
                      studentHandout: { ...activity.studentHandout, title: event.target.value }
                    })
                  }
                />
                <textarea
                  rows={3}
                  value={activity.studentHandout.directions}
                  onChange={(event) =>
                    setActivity({
                      ...activity,
                      studentHandout: { ...activity.studentHandout, directions: event.target.value }
                    })
                  }
                />
                <textarea
                  rows={5}
                  value={activity.studentHandout.questions.join('\n')}
                  onChange={(event) =>
                    setActivity({
                      ...activity,
                      studentHandout: {
                        ...activity.studentHandout,
                        questions: event.target.value
                          .split('\n')
                          .filter((question) => question.trim())
                      }
                    })
                  }
                />
                <div className="row">
                  <button className="secondary" type="button" onClick={printHandout}>
                    Print / Save PDF
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={async () => {
                      try {
                        setWorking(true);
                        await props.onAddSteps(activity.steps);
                        setError(null);
                        setActivity(null);
                        setOpen(false);
                      } catch (err) {
                        setError(
                          err instanceof ApiError ? err.message : 'Unable to add activity steps'
                        );
                      } finally {
                        setWorking(false);
                      }
                    }}
                  >
                    Add steps to lesson
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </EditFocusDialog>
    </div>
  );
}
