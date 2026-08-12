import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { DashboardTodayResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function DashboardPage() {
  const api = useApiClient();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsProfileSetup = error?.includes('Complete onboarding first');

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.dashboardToday());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
      }
    })();
  }, [api]);

  if (needsProfileSetup) {
    return (
      <div className="stack dashboard-locked">
        <section className="card stack dashboard-unlock-card">
          <p className="eyebrow">Start here</p>
          <h1>Finish your quick setup</h1>
          <p className="muted">
            Before we build your dashboard, we need a few basics about you and your school.
          </p>
          <Link className="button-link dashboard-unlock-button" to="/onboarding">
            Start my setup
          </Link>
        </section>
      </div>
    );
  }

  if (data?.needsScheduleSetup) {
    return (
      <div className="stack dashboard-locked">
        <section className="card stack dashboard-unlock-card">
          <p className="eyebrow">TeacherOS is ready when you are</p>
          <h1>Import your schedule to unlock your dashboard</h1>
          <p className="muted">
            Your dashboard will fill in with today’s classes, upcoming lessons, and the planning tools that
            match your teaching week after you import a schedule.
          </p>
          <div className="dashboard-unlock-checklist" aria-label="What importing unlocks">
            <div><span>1</span><strong>Upload your schedule</strong><small>PDF, photo, or pasted text is fine.</small></div>
            <div><span>2</span><strong>Check the results</strong><small>Confirm class names, start times, end times, and rooms.</small></div>
            <div><span>3</span><strong>Unlock your workspace</strong><small>See your week, lessons, and daily dashboard.</small></div>
          </div>
          <Link className="button-link dashboard-unlock-button" to="/schedule?setup=1">
            Import my schedule
          </Link>
          <p className="field-note">Nothing is saved until you review and confirm it.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Dashboard</h1>
      {error ? <p className="error-message">{error}</p> : null}
      {!data ? <p className="muted">Loading your workspace...</p> : null}
      {data && !data.needsScheduleSetup ? (
        <>
          {data.specialDay ? (
            <div className="card special-day-notice">
              <strong>{data.specialDay.label}</strong>
              <span>{data.specialDay.kind.replace('_', ' ')}</span>
            </div>
          ) : null}
          <div className="card stack">
            <h3>Current class</h3>
            {data.currentClass ? (
              <p>
                {data.currentClass.courseName} ({data.currentClass.sectionName}) at{' '}
                {data.currentClass.meetingTime ?? 'TBD'}
                {data.currentClass.meetingEndTime ? `–${data.currentClass.meetingEndTime}` : ''}
              </p>
            ) : (
              <p className="muted">No class currently in session.</p>
            )}
          </div>
          <div className="card stack">
            <h3>Next class</h3>
            {data.nextClass ? (
              <p>
                {data.nextClass.courseName} ({data.nextClass.sectionName}) at{' '}
                {data.nextClass.meetingTime ?? 'TBD'}
                {data.nextClass.meetingEndTime ? `–${data.nextClass.meetingEndTime}` : ''}
              </p>
            ) : (
              <p className="muted">No additional classes scheduled today.</p>
            )}
          </div>
          <div className="card stack">
            <h3>Today schedule</h3>
            {data.todaySchedule.length ? (
              <ul>
                {data.todaySchedule.map((item) => (
                  <li key={item.sectionId}>
                    {item.meetingTime ?? '--:--'}
                    {item.meetingEndTime ? `–${item.meetingEndTime}` : ''} - {item.courseName} / {item.sectionName}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No schedule entries for today.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
