import { useCallback, useEffect, useState } from 'react';

import type { TeacherNote } from '@teacheros/contracts';

import { EditFocusDialog } from '../components/EditFocusDialog.js';
import { ApiError, useApiClient } from '../lib/api.js';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

export function TeacherNotesPage() {
  const api = useApiClient();
  const [notes, setNotes] = useState<TeacherNote[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.listTeacherNotes();
      setNotes(response.notes);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load your notes.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const resetEditor = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setEditorOpen(false);
  };

  return (
    <div className="stack teacher-notes-page">
      <div className="row spread">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>My notes</h1>
          <p className="muted">
            Keep personal reminders, parent-call notes, and planning ideas here. These notes belong
            only to your account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setTitle('');
            setContent('');
            setEditorOpen(true);
          }}
        >
          Write a note
        </button>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      <EditFocusDialog
        open={editorOpen}
        title={editingId ? 'Edit note' : 'Write a new note'}
        description="Keep this note in focus, then save it or exit without changing your saved notes."
        onClose={resetEditor}
        busy={saving}
      >
        <section className="stack">
          <label>
            Note title
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Call home on Friday"
            />
          </label>
          <label>
            Note text
            <textarea
              className="input"
              rows={7}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Write anything you want to remember..."
            />
          </label>
          <div className="row">
            <button
              type="button"
              disabled={saving || !title.trim()}
              onClick={async () => {
                try {
                  setSaving(true);
                  if (editingId) {
                    const updated = await api.updateTeacherNote(editingId, {
                      title: title.trim(),
                      content
                    });
                    setNotes((current) =>
                      current.map((note) => (note.id === updated.id ? updated : note))
                    );
                  } else {
                    const created = await api.createTeacherNote({ title: title.trim(), content });
                    setNotes((current) => [created, ...current]);
                  }
                  resetEditor();
                  setError(null);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Unable to save your note.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {editingId ? 'Save changes' : 'Save note'}
            </button>
            <button className="secondary" type="button" onClick={resetEditor} disabled={saving}>
              Cancel
            </button>
          </div>
        </section>
      </EditFocusDialog>

      <section className="stack" aria-label="Saved notes">
        <h2>Saved notes</h2>
        {loading ? <p className="muted">Loading your notes...</p> : null}
        {!loading && notes.length === 0 ? (
          <div className="card empty-state">
            <strong>Your first private note goes here.</strong>
            <span className="muted">Add a title and a few words above, then choose Save note.</span>
          </div>
        ) : null}
        {notes.map((note) => (
          <article className="card stack" key={note.id}>
            <div className="row spread">
              <div>
                <h3>{note.title}</h3>
                <p className="muted">Last saved {formatDate(note.updatedAt)}</p>
              </div>
              <div className="row">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setEditingId(note.id);
                    setTitle(note.title);
                    setContent(note.content);
                    setEditorOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete “${note.title}”?`)) return;
                    try {
                      setSaving(true);
                      await api.deleteTeacherNote(note.id);
                      setNotes((current) => current.filter((item) => item.id !== note.id));
                      if (editingId === note.id) resetEditor();
                    } catch (err) {
                      setError(
                        err instanceof ApiError ? err.message : 'Unable to delete your note.'
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            {note.content ? (
              <p className="note-content">{note.content}</p>
            ) : (
              <p className="muted">No text yet.</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
