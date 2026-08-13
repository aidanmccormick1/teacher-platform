import { useEffect, useState } from 'react';

import type { AiJobStatusResponse } from '@teacheros/contracts';

import { EditFocusDialog } from '../components/EditFocusDialog.js';
import { TeachingDataImporter } from '../components/TeachingDataImporter.js';
import { AcademicCalendarPanel } from '../components/AcademicCalendarPanel.js';
import { V3ScheduleOverview } from '../components/V3ScheduleOverview.js';
import { ApiError, useApiClient } from '../lib/api.js';

function isTerminalStatus(status: AiJobStatusResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function SchedulePage() {
  const api = useApiClient();
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [segmentLessonTitle, setSegmentLessonTitle] = useState('');
  const [segmentObjective, setSegmentObjective] = useState('');
  const [segmentDuration, setSegmentDuration] = useState('45');
  const [continuityLessonTitle, setContinuityLessonTitle] = useState('');
  const [continuityLastSegment, setContinuityLastSegment] = useState('');
  const [continuityLastNote, setContinuityLastNote] = useState('');
  const [continuitySummary, setContinuitySummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<AiJobStatusResponse | null>(null);
  const [jobOutput, setJobOutput] = useState<string | null>(null);
  const [showImporter, setShowImporter] = useState(false);
  const [aiEditor, setAiEditor] = useState<'segments' | 'continuity' | null>(null);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const status = await api.getAiJobStatus(activeJobId);
        if (cancelled) return;
        setActiveJob(status);
        if (status.output) {
          setJobOutput(JSON.stringify(status.output, null, 2));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load AI job status');
        }
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1200);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, activeJobId]);

  useEffect(() => {
    if (!activeJob || !isTerminalStatus(activeJob.status)) return;
    if (activeJob.status === 'failed' && activeJob.error) {
      setError(`AI job failed: ${activeJob.error}`);
    }
  }, [activeJob]);

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Plan your week</p>
        <h1>Schedule</h1>
        <p className="muted">See every class, its start time, and its end time in one place.</p>
      </div>
      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}

      <V3ScheduleOverview
        refreshKey={scheduleRefreshKey}
        onOpenImport={() => setShowImporter(true)}
      />
      <AcademicCalendarPanel />

      <EditFocusDialog
        open={showImporter}
        title="Edit schedule"
        description="Review every class, meeting time, and special date before applying changes."
        onClose={() => setShowImporter(false)}
      >
        <TeachingDataImporter
          onApplied={async () => {
            setScheduleRefreshKey((current) => current + 1);
            setShowImporter(false);
          }}
        />
      </EditFocusDialog>

      <div className="card row spread">
        <div>
          <h3>AI: Generate Lesson Segments</h3>
          <p className="muted">Draft a proposal in a focused workspace before anything is saved.</p>
        </div>
        <button className="secondary" type="button" onClick={() => setAiEditor('segments')}>
          Draft segments
        </button>
      </div>
      <EditFocusDialog
        open={aiEditor === 'segments'}
        title="Draft Lesson Segments"
        description="This creates an editable proposal only; it does not change your curriculum."
        onClose={() => setAiEditor(null)}
        busy={busy}
      >
        <div className="stack">
          <input
            className="input"
            value={segmentLessonTitle}
            onChange={(event) => setSegmentLessonTitle(event.target.value)}
            placeholder="Lesson title"
          />
          <input
            className="input"
            value={segmentObjective}
            onChange={(event) => setSegmentObjective(event.target.value)}
            placeholder="Objective (optional)"
          />
          <input
            className="input"
            value={segmentDuration}
            onChange={(event) => setSegmentDuration(event.target.value)}
            placeholder="Duration in minutes"
          />
          <button
            type="button"
            disabled={busy || !segmentLessonTitle.trim()}
            onClick={async () => {
              const parsedDuration = Number(segmentDuration);
              if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
                setError('Duration must be a positive integer');
                return;
              }

              try {
                setBusy(true);
                const queued = await api.enqueueGenerateSegments({
                  lessonTitle: segmentLessonTitle.trim(),
                  objective: segmentObjective.trim() ? segmentObjective.trim() : null,
                  durationMinutes: parsedDuration
                });
                setActiveJobId(queued.jobId);
                setActiveJob(null);
                setJobOutput(null);
                setError(null);
                setAiEditor(null);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Failed to enqueue segment job');
              } finally {
                setBusy(false);
              }
            }}
          >
            Queue segment job
          </button>
        </div>
      </EditFocusDialog>

      <div className="card row spread">
        <div>
          <h3>AI: Continuity Suggestions</h3>
          <p className="muted">Use a focused draft to prepare the next instructional move.</p>
        </div>
        <button className="secondary" type="button" onClick={() => setAiEditor('continuity')}>
          Draft continuity
        </button>
      </div>
      <EditFocusDialog
        open={aiEditor === 'continuity'}
        title="Draft Continuity Suggestions"
        description="Review the proposal after it is generated; no curriculum changes happen here."
        onClose={() => setAiEditor(null)}
        busy={busy}
      >
        <div className="stack">
          <input
            className="input"
            value={continuityLessonTitle}
            onChange={(event) => setContinuityLessonTitle(event.target.value)}
            placeholder="Lesson title"
          />
          <input
            className="input"
            value={continuityLastSegment}
            onChange={(event) => setContinuityLastSegment(event.target.value)}
            placeholder="Last segment title (optional)"
          />
          <textarea
            rows={3}
            value={continuityLastNote}
            onChange={(event) => setContinuityLastNote(event.target.value)}
            placeholder="Last class note (optional)"
          />
          <textarea
            rows={3}
            value={continuitySummary}
            onChange={(event) => setContinuitySummary(event.target.value)}
            placeholder="Previous lesson summary (optional)"
          />
          <button
            type="button"
            disabled={busy || !continuityLessonTitle.trim()}
            onClick={async () => {
              try {
                setBusy(true);
                const queued = await api.enqueueGenerateContinuity({
                  lessonTitle: continuityLessonTitle.trim(),
                  lastSegmentTitle: continuityLastSegment.trim() || null,
                  lastNote: continuityLastNote.trim() || null,
                  previousLessonSummary: continuitySummary.trim() || null
                });
                setActiveJobId(queued.jobId);
                setActiveJob(null);
                setJobOutput(null);
                setError(null);
                setAiEditor(null);
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : 'Failed to enqueue continuity job'
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Queue continuity job
          </button>
        </div>
      </EditFocusDialog>

      {activeJobId ? (
        <div className="card stack">
          <h3>AI Job Status</h3>
          <p>
            <strong>Job:</strong> {activeJobId}
          </p>
          {activeJob ? (
            <>
              <p>
                <strong>Type:</strong> {activeJob.type}
              </p>
              <p>
                <strong>Status:</strong> {activeJob.status}
              </p>
              <p>
                <strong>Progress:</strong> {activeJob.progressPercent}%
              </p>
              <p>
                <strong>Attempts:</strong> {activeJob.attemptsMade}/{activeJob.maxAttempts}
              </p>
              {activeJob.cancelRequested ? (
                <p className="muted">Cancellation requested. Waiting for the worker to stop.</p>
              ) : null}
              {activeJob.error ? <p style={{ color: '#b02020' }}>{activeJob.error}</p> : null}
              <div className="row">
                <button
                  type="button"
                  disabled={!activeJob.canCancel || busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await api.cancelAiJob(activeJob.jobId);
                      setActiveJob(await api.getAiJobStatus(activeJob.jobId));
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to cancel AI job');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!activeJob.canRetry || busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await api.retryAiJob(activeJob.jobId);
                      setActiveJob(await api.getAiJobStatus(activeJob.jobId));
                      setError(null);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed to retry AI job');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Retry
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setActiveJobId(null);
                    setActiveJob(null);
                    setJobOutput(null);
                  }}
                >
                  Clear panel
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Loading job status...</p>
          )}
          {jobOutput ? <pre>{jobOutput}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
