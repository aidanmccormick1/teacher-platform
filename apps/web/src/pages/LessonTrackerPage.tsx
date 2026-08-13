import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { EditFocusDialog } from '../components/EditFocusDialog.js';
import { ApiError, useApiClient } from '../lib/api.js';

export function LessonTrackerPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const { sectionId = '', lessonId = '' } = useParams();
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack">
      <EditFocusDialog
        open
        title="Lesson tracker"
        description="Record this Lesson’s current progress, then exit back to Classroom."
        onClose={() => navigate('/classroom')}
      >
        <div className="stack">
          <p>
            Section: <strong>{sectionId}</strong>
          </p>
          <p>
            Lesson: <strong>{lessonId}</strong>
          </p>
          <textarea
            rows={5}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Carry-over note..."
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await api.upsertLessonProgress({
                  sectionId,
                  lessonId,
                  status: 'in_progress',
                  currentSegmentId: null,
                  stoppedAtSegmentId: null,
                  completedSegmentIds: [],
                  carryOverNote: note || null,
                  lastTaughtDate: new Date().toISOString().slice(0, 10)
                });
                await api.upsertClassNote({
                  sectionId,
                  date: new Date().toISOString().slice(0, 10),
                  noteType: 'raw',
                  content: note || 'Tracked lesson progress'
                });
                setSavedAt(new Date().toLocaleTimeString());
                setError(null);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Failed to save lesson progress');
              }
            }}
          >
            Save progress
          </button>
          {savedAt ? <p className="muted">Saved at {savedAt}</p> : null}
          {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}
        </div>
      </EditFocusDialog>
    </div>
  );
}
