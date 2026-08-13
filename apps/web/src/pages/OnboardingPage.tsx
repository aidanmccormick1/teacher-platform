import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

type SetupStep = 'you' | 'school' | 'teaching' | 'review';

const steps: Array<{ id: SetupStep; label: string }> = [
  { id: 'you', label: 'About you' },
  { id: 'school', label: 'Your school' },
  { id: 'teaching', label: 'What you teach' },
  { id: 'review', label: 'Review' }
];

export function OnboardingPage() {
  const api = useApiClient();
  const auth = useAppAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<SetupStep>('you');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    workEmail: auth.email ?? '',
    phone: '',
    role: 'teacher' as 'teacher' | 'department_head' | 'admin',
    schoolName: '',
    district: '',
        state: '',
        subjects: '',
    grades: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null
  });
  const stepIndex = steps.findIndex((item) => item.id === step);
  const canContinue =
    (step === 'you' && form.fullName.trim().length > 0) ||
    (step === 'school' && form.schoolName.trim().length > 0) ||
    step === 'teaching';

  function next() {
    if (!canContinue) return;
    setError(null);
    setStep(steps[stepIndex + 1]?.id ?? 'review');
  }

  function back() {
    setError(null);
    setStep(steps[stepIndex - 1]?.id ?? 'you');
  }

  async function finishSetup() {
    try {
      setSaving(true);
      setError(null);
      await api.onboarding({
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        workEmail: form.workEmail.trim() || null,
        role: form.role,
        schoolName: form.schoolName.trim(),
        district: form.district.trim() || null,
        state: form.state.trim() || null,
        subjects: form.subjects.split(',').map((value) => value.trim()).filter(Boolean),
        grades: form.grades.split(',').map((value) => value.trim()).filter(Boolean),
        timezone: form.timezone
      });
      navigate('/schedule?setup=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save these details. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="onboarding-page stack">
      <header className="onboarding-intro">
        <p className="eyebrow">Welcome to TeacherOS</p>
        <h1>Let’s get your classroom ready</h1>
        <p className="muted">We’ll ask one small group of questions at a time. You can change these later.</p>
      </header>

      <div className="setup-steps" aria-label="Account setup progress">
        {steps.map((item, index) => (
          <span key={item.id} className={index === stepIndex ? 'active' : index < stepIndex ? 'complete' : ''}>
            {index + 1}. {item.label}
          </span>
        ))}
      </div>

      <section className="card stack onboarding-card">
        {step === 'you' ? (
          <>
            <div><h2>First, what should we call you?</h2><p className="muted">This helps personalize your dashboard.</p></div>
            <label>Full name <input className="input" autoComplete="name" value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} placeholder="For example, Jordan Lee" /></label>
            <label>School email <span className="field-note">Optional</span><input className="input" autoComplete="email" type="email" value={form.workEmail} onChange={(event) => setForm((prev) => ({ ...prev, workEmail: event.target.value }))} placeholder="you@school.org" /></label>
            <label>Phone number <span className="field-note">Optional</span><input className="input" autoComplete="tel" type="tel" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="(555) 555-5555" /></label>
          </>
        ) : null}

        {step === 'school' ? (
          <>
            <div><h2>Tell us about your school</h2><p className="muted">Only your school name is needed to continue.</p></div>
            <label>School name <input className="input" value={form.schoolName} onChange={(event) => setForm((prev) => ({ ...prev, schoolName: event.target.value }))} placeholder="For example, Lincoln Middle School" /></label>
            <label>District <span className="field-note">Optional</span><input className="input" value={form.district} onChange={(event) => setForm((prev) => ({ ...prev, district: event.target.value }))} placeholder="For example, North County Schools" /></label>
            <label>State <span className="field-note">Optional</span><input className="input" value={form.state} onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))} placeholder="For example, California" /></label>
          </>
        ) : null}

        {step === 'teaching' ? (
          <>
            <div><h2>What do you teach?</h2><p className="muted">These are optional. You can add or change courses after your schedule is imported.</p></div>
            <label>Your role <select className="input" value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as typeof form.role }))}><option value="teacher">Teacher</option><option value="department_head">Department head</option><option value="admin">Administrator</option></select></label>
            <label>Subjects <span className="field-note">Optional — separate more than one with commas</span><input className="input" value={form.subjects} onChange={(event) => setForm((prev) => ({ ...prev, subjects: event.target.value }))} placeholder="For example, Math, Science" /></label>
            <label>Grades <span className="field-note">Optional — separate more than one with commas</span><input className="input" value={form.grades} onChange={(event) => setForm((prev) => ({ ...prev, grades: event.target.value }))} placeholder="For example, 6, 7, 8" /></label>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <div><h2>Does this look right?</h2><p className="muted">Once you confirm, we’ll guide you through adding your schedule.</p></div>
            <dl className="setup-summary"><div><dt>Name</dt><dd>{form.fullName}</dd></div><div><dt>School</dt><dd>{form.schoolName}</dd></div><div><dt>Role</dt><dd>{form.role.replace('_', ' ')}</dd></div><div><dt>Subjects</dt><dd>{form.subjects || 'Not added yet'}</dd></div><div><dt>Grades</dt><dd>{form.grades || 'Not added yet'}</dd></div></dl>
          </>
        ) : null}

        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <div className="setup-actions">
          {stepIndex > 0 ? <button className="secondary" type="button" disabled={saving} onClick={back}>Back</button> : null}
          {step !== 'review' ? <button type="button" disabled={!canContinue} onClick={next}>Continue</button> : <button type="button" disabled={saving} onClick={() => void finishSetup()}>{saving ? 'Saving your details…' : 'Yes, continue to my schedule'}</button>}
        </div>
      </section>
    </main>
  );
}
