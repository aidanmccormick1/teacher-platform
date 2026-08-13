import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ClassroomState } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function DashboardPage() {
  const api = useApiClient();
  const [classroom, setClassroom] = useState<ClassroomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setClassroom(await api.getV3Classroom());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Unable to load today’s teaching view.');
      }
    })();
  }, [api]);

  return (
    <div className="stack">
      <div><p className="eyebrow">Today</p><h1>Dashboard</h1></div>
      {error ? <p className="error-message">{error}</p> : null}
      {!classroom ? <p className="muted">Loading your instructional day…</p> : null}
      {classroom?.activeMeeting ? (
        <section className="card stack">
          <p className="eyebrow">Current instructional meeting</p>
          <h2>Meeting {classroom.activeMeeting.meetingNumber} · {classroom.activeMeeting.localDate}</h2>
          <p>{classroom.selected?.currentLesson ? `Teaching: ${classroom.selected.currentLesson.title}` : 'Open Classroom to choose today’s Lesson.'}</p>
          <Link className="button-link" to="/classroom">Open Classroom</Link>
        </section>
      ) : classroom ? (
        <section className="card stack classroom-no-active">
          <h2>No class is happening right now.</h2>
          <p className="muted">Open Classroom to prepare a Class Group, review progress, or see the next instructional meeting.</p>
          <Link className="button-link" to="/classroom">Open Classroom</Link>
        </section>
      ) : null}
      {classroom?.classGroups.length === 0 ? <section className="card stack"><h3>Start with your school year</h3><p className="muted">Set your academic calendar, then add Class Groups and meeting rules to unlock live classroom planning.</p><Link className="button-link" to="/schedule">Set up calendar and schedule</Link></section> : null}
      {classroom ? <section className="card stack"><h3>Your Class Groups</h3>{classroom.classGroups.length ? <ul>{classroom.classGroups.map((group) => <li key={group.id}>{group.periodLabel ? `${group.periodLabel} · ` : ''}{group.courseName} — {group.name}</li>)}</ul> : <p className="muted">No Class Groups yet.</p>}</section> : null}
    </div>
  );
}
