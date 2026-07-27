import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ClassroomCheckinResponse, DashboardTodayResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

export function ClassroomPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [checkins, setCheckins] = useState<ClassroomCheckinResponse['pendingSessions']>([]);
  const [outcome, setOutcome] = useState<'taught' | 'substitute' | 'cancelled' | 'shortened'>(
    'cancelled'
  );
  const [coveredPlannedLesson, setCoveredPlannedLesson] = useState(false);
  const [note, setNote] = useState('');
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const [savingCheckin, setSavingCheckin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingCheckin = checkins[0];

  useEffect(() => {
    void (async () => {
      try {
        const [dashboard, checkin] = await Promise.all([
          api.dashboardToday(),
          api.classroomCheckin()
        ]);
        setData(dashboard);
        setCheckins(checkin.pendingSessions);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load classroom state');
      }
    })();
  }, [api]);

  return (
    <div className="stack">
      <h1>Classroom</h1>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
      {pendingCheckin ? (
        <div className="card stack classroom-checkin">
          <div>
            <h3>Quick check-in</h3>
            <p>
              We did not hear what happened with <strong>{pendingCheckin.courseName}</strong> (
              {pendingCheckin.sectionName}) on {pendingCheckin.sessionDate}.
            </p>
            <p className="muted">
              Confirm it once and your next planned lesson will stay in the right place.
            </p>
          </div>
          <div className="checkin-outcomes">
            <button
              className={outcome === 'taught' ? '' : 'secondary'}
              type="button"
              onClick={() => setOutcome('taught')}
            >
              We taught class
            </button>
            <button
              className={outcome === 'substitute' ? '' : 'secondary'}
              type="button"
              onClick={() => setOutcome('substitute')}
            >
              Substitute day
            </button>
            <button
              className={outcome === 'cancelled' ? '' : 'secondary'}
              type="button"
              onClick={() => setOutcome('cancelled')}
            >
              No class / cancelled
            </button>
            <button
              className={outcome === 'shortened' ? '' : 'secondary'}
              type="button"
              onClick={() => setOutcome('shortened')}
            >
              Shortened / assembly
            </button>
          </div>
          {outcome === 'substitute' || outcome === 'shortened' ? (
            <label className="checkin-checkbox">
              <input
                type="checkbox"
                checked={coveredPlannedLesson}
                onChange={(event) => setCoveredPlannedLesson(event.target.checked)}
              />
              The planned lesson was covered well enough to move on.
            </label>
          ) : null}
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note for your future self"
          />
          <div className="row">
            <button
              type="button"
              disabled={savingCheckin}
              onClick={async () => {
                try {
                  setSavingCheckin(true);
                  const result = await api.resolveClassroomCheckin({
                    sectionId: pendingCheckin.sectionId,
                    sessionDate: pendingCheckin.sessionDate,
                    outcome,
                    coveredPlannedLesson,
                    note: note.trim() || null
                  });
                  setCheckins((current) => current.slice(1));
                  setNote('');
                  setCoveredPlannedLesson(false);
                  setCheckinMessage(result.message);
                  setError(null);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Unable to save class check-in');
                } finally {
                  setSavingCheckin(false);
                }
              }}
            >
              {savingCheckin ? 'Saving...' : 'Save and continue'}
            </button>
            {checkins.length > 1 ? (
              <span className="muted">{checkins.length - 1} more to review</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {checkinMessage ? <p className="checkin-message">{checkinMessage}</p> : null}
      {!data ? <p className="muted">Loading active class...</p> : null}
      {data?.currentClass ? (
        <div className="card stack">
          <p>
            Active class: <strong>{data.currentClass.courseName}</strong> (
            {data.currentClass.sectionName})
          </p>
          <button
            type="button"
            onClick={() =>
              navigate(`/sections/${data.currentClass?.sectionId}/lessons/demo-lesson`)
            }
          >
            Resume lesson tracker
          </button>
        </div>
      ) : (
        <div className="card">
          <p className="muted">No class currently detected. Open schedule to verify class times.</p>
        </div>
      )}
    </div>
  );
}
