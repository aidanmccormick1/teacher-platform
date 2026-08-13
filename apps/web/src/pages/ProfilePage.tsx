import { useEffect, useState } from 'react';

import { EditFocusDialog } from '../components/EditFocusDialog.js';
import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

function friendlyTimezone(timezone: string): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZone: timezone, timeZoneName: 'long' })
      .formatToParts(new Date())
      .find((item) => item.type === 'timeZoneName')?.value;
    return part ?? timezone;
  } catch {
    return timezone;
  }
}

export function ProfilePage() {
  const auth = useAppAuth();
  const api = useApiClient();
  const [timezone, setTimezone] = useState('');
  const [draft, setDraft] = useState('');
  const [editingTimezone, setEditingTimezone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const account = await api.getAccountTimezone();
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const value = account.timezone ?? detected ?? '';
        setTimezone(value);
        setDraft(value);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Unable to load your profile settings.');
      }
    })();
  }, [api]);

  return (
    <div className="stack">
      <h1>Profile</h1>
      <div className="card stack">
        <p>User ID: {auth.userId}</p>
        <p>Email: {auth.email ?? 'Not available'}</p>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setDraft(timezone);
            setEditingTimezone(true);
          }}
        >
          Edit time zone
        </button>
        {message ? <p className="checkin-message">{message}</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
      </div>
      <EditFocusDialog
        open={editingTimezone}
        title="Edit time zone"
        description="This saved TeacherOS time zone controls the school-local interpretation of all schedules."
        onClose={() => {
          setDraft(timezone);
          setEditingTimezone(false);
        }}
        busy={saving}
      >
        <div className="stack">
          <label>
            Time Zone
            <span className="field-note">
              {timezone
                ? `${friendlyTimezone(timezone)} · ${timezone}`
                : 'Loading your saved timezone…'}
            </span>
            <input
              className="input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="America/Los_Angeles"
              autoCapitalize="none"
            />
          </label>
          <div className="row">
            <button
              type="button"
              disabled={saving || !draft.trim()}
              onClick={async () => {
                try {
                  setSaving(true);
                  const account = await api.updateTimezone(draft.trim());
                  setTimezone(account.timezone ?? draft.trim());
                  setMessage('Time zone saved. Future schedule calculations now use this setting.');
                  setError(null);
                  setEditingTimezone(false);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Enter a valid IANA timezone.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save time zone
            </button>
            <button
              className="secondary"
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(timezone);
                setEditingTimezone(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </EditFocusDialog>
    </div>
  );
}
