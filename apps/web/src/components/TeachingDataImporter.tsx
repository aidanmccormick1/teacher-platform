import { useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  AnnualCalendarProposal,
  ScheduleSetupSource,
  WeeklyScheduleProposal
} from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type TeachingDataImporterProps = {
  onApplied: () => Promise<void>;
};

type ImportSource = {
  text: string;
  imageBase64s: string[];
  fileName: string | null;
};

const emptySource: ImportSource = { text: '', imageBase64s: [], fileName: null };

async function extractFileText(file: File): Promise<string> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return file.text();
  }

  const [{ getDocument, GlobalWorkerOptions }, pdfWorkerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorkerModule.default;
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => (typeof item === 'object' && item !== null && 'str' in item ? item.str : ''))
        .join(' ')
    );
  }
  return pages.join('\n\n');
}

async function renderPdfPages(file: File): Promise<string[]> {
  const [{ getDocument, GlobalWorkerOptions }, pdfWorkerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ]);
  GlobalWorkerOptions.workerSrc = pdfWorkerModule.default;
  const pdfDocument = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const images: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdfDocument.numPages, 3); pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this PDF for reading.');
    await page.render({ canvasContext: context, viewport }).promise;
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (image) images.push(await readAsDataUrl(image));
  }
  return images;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to read image'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image'));
    reader.readAsDataURL(file);
  });
}

async function extractImage(file: File): Promise<string> {
  const isHeic = /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  let image: Blob = file;
  if (isHeic) {
    const importedModule = await import('heic2any');
    const converted = await importedModule.default({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const convertedImage = Array.isArray(converted) ? converted[0] : converted;
    if (!convertedImage) throw new Error('Unable to convert this HEIC image');
    image = convertedImage;
  }

  if (image.size <= 3 * 1024 * 1024) return readAsDataUrl(image);
  try {
    const bitmap = await createImageBitmap(image);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return readAsDataUrl(image);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88)
    );
    return readAsDataUrl(compressed ?? image);
  } catch {
    return readAsDataUrl(image);
  }
}

function sourcePayload(source: ImportSource): ScheduleSetupSource | null {
  if (source.text.trim() || source.imageBase64s.length) {
    return {
      ...(source.text.trim() ? { text: source.text.trim() } : {}),
      ...(source.imageBase64s.length === 1
        ? { imageBase64: source.imageBase64s[0] }
        : source.imageBase64s.length > 1
          ? { imageBase64s: source.imageBase64s }
          : {})
    };
  }
  return null;
}

function SourceUploader({
  heading,
  description,
  source,
  busy,
  onChange,
  onError
}: {
  heading: string;
  description: string;
  source: ImportSource;
  busy: boolean;
  onChange: (source: ImportSource) => void;
  onError: (message: string) => void;
}) {
  const hasUploadedFile = Boolean(source.fileName);

  return (
    <div className="stack schedule-source">
      <div>
        <h3>{heading}</h3>
        <p className="muted">{description}</p>
      </div>
      {hasUploadedFile ? (
        <div className="uploaded-file-confirmation" role="status">
          <div>
            <strong>✓ File uploaded: {source.fileName}</strong>
            <p className="muted">It is ready when you are. We have not read or saved anything from it yet.</p>
          </div>
          {source.imageBase64s.length ? (
            <img
              className="import-image-preview"
              src={source.imageBase64s[0]}
              alt="Uploaded file ready for schedule reading"
            />
          ) : null}
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => onChange(emptySource)}
          >
            Choose a different file
          </button>
        </div>
      ) : (
        <>
          <input
            className="file-input"
            type="file"
            disabled={busy}
            accept=".pdf,.txt,.csv,.ics,.heic,.heif,image/*,text/plain,text/csv,text/calendar,application/pdf"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const isImage = file.type.startsWith('image/') || /\.hei[cf]$/i.test(file.name);
                if (isImage) {
                  onChange({ text: '', imageBase64s: [await extractImage(file)], fileName: file.name });
                  return;
                }
                const text = await extractFileText(file);
                const pdfImages =
                  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
                    ? await renderPdfPages(file)
                    : [];
                if (!text.trim() && !pdfImages.length) {
                  throw new Error('No readable pages were found. Upload a clearer photo or PDF.');
                }
                onChange({ text, imageBase64s: pdfImages, fileName: file.name });
              } catch (error) {
                onChange(emptySource);
                onError(error instanceof Error ? error.message : 'Unable to read this file.');
              }
            }}
          />
          <label>
            Or paste the schedule text
            <textarea
              rows={7}
              value={source.text}
              disabled={busy}
              onChange={(event) =>
                onChange({ text: event.target.value, imageBase64s: [], fileName: null })
              }
              placeholder="Paste schedule or calendar text here."
            />
          </label>
        </>
      )}
    </div>
  );
}

function updateCourse(
  proposal: WeeklyScheduleProposal,
  courseIndex: number,
  update: Partial<WeeklyScheduleProposal['courses'][number]>
) {
  const courses = [...proposal.courses];
  courses[courseIndex] = { ...courses[courseIndex], ...update } as WeeklyScheduleProposal['courses'][number];
  return { ...proposal, courses };
}

export function TeachingDataImporter({ onApplied }: TeachingDataImporterProps) {
  const api = useApiClient();
  const [step, setStep] = useState<'weekly' | 'weekly-confirm' | 'calendar' | 'calendar-confirm' | 'review' | 'save-confirm' | 'complete'>('weekly');
  const [weeklySource, setWeeklySource] = useState<ImportSource>(emptySource);
  const [calendarSource, setCalendarSource] = useState<ImportSource>(emptySource);
  const [weekly, setWeekly] = useState<WeeklyScheduleProposal | null>(null);
  const [annualCalendar, setAnnualCalendar] = useState<AnnualCalendarProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parseWeekly = async () => {
    const source = sourcePayload(weeklySource);
    if (!source) {
      setError('Upload or paste your weekly/block schedule first.');
      return;
    }
    try {
      setBusy(true);
      const proposal = await api.parseWeeklyScheduleSetup(source);
      setWeekly(proposal);
      setStep('weekly-confirm');
      setError(null);
      setMessage(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to parse this weekly schedule.');
    } finally {
      setBusy(false);
    }
  };

  const parseCalendar = async () => {
    const source = sourcePayload(calendarSource);
    if (!source) {
      setError('Upload or paste an annual calendar before parsing, or skip this step.');
      return;
    }
    try {
      setBusy(true);
      const proposal = await api.parseAnnualCalendarSetup(source);
      setAnnualCalendar(proposal);
      setStep('calendar-confirm');
      setError(null);
      setMessage(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to parse this annual calendar.');
    } finally {
      setBusy(false);
    }
  };

  const moveSection = (fromCourseIndex: number, sectionIndex: number, toCourseIndex: number) => {
    if (!weekly || fromCourseIndex === toCourseIndex) return;
    const courses = weekly.courses.map((course) => ({ ...course, sections: [...course.sections] }));
    const [section] = courses[fromCourseIndex]?.sections.splice(sectionIndex, 1) ?? [];
    if (!section || !courses[toCourseIndex]) return;
    courses[toCourseIndex].sections.push(section);
    setWeekly({ ...weekly, courses: courses.filter((course) => course.sections.length > 0) });
  };

  return (
    <section className="card stack teaching-importer schedule-setup">
      <div>
        <p className="eyebrow">Schedule setup</p>
        <h2>Let’s add your teaching schedule</h2>
        <p className="muted">
          We’ll do this one step at a time. Nothing is added to your dashboard until you review and confirm it.
        </p>
      </div>

      <div className="setup-steps" aria-label="Schedule setup progress">
        <span className={step === 'weekly' ? 'active' : weekly ? 'complete' : ''}>1. Upload your week</span>
        <span className={step === 'calendar' ? 'active' : annualCalendar ? 'complete' : ''}>2. School dates</span>
        <span className={step === 'review' || step === 'save-confirm' ? 'active' : step === 'complete' ? 'complete' : ''}>3. Check and save</span>
      </div>

      {step === 'weekly' ? (
        <>
          <SourceUploader
            heading="Your weekly or block schedule"
            description="Choose a PDF, photo, or text file—or paste the schedule below. A picture from your phone is fine. We will separate classes from lunch, homeroom, breaks, prep, and dismissal."
            source={weeklySource}
            busy={busy}
            onChange={setWeeklySource}
            onError={setError}
          />
          {sourcePayload(weeklySource) ? (
            <div className="import-next-step stack">
              <div>
                <h3>Ready for us to read it?</h3>
                <p className="muted">
                  We will identify courses, sections, start times, end times, rooms, and non-class blocks.
                  You will review every detail before anything is saved.
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => void parseWeekly()}>
                {busy ? 'Reading your schedule…' : 'Yes, read my schedule'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 'weekly-confirm' && weekly ? (
        <div className="setup-confirmation stack">
          <div><h3>We found your teaching week</h3><p className="muted">Please check this quick summary. You’ll be able to edit every detail before saving.</p></div>
          <dl className="setup-summary"><div><dt>Courses found</dt><dd>{weekly.courses.length}</dd></div><div><dt>Class sections found</dt><dd>{weekly.courses.reduce((total, course) => total + course.sections.length, 0)}</dd></div><div><dt>Non-class times</dt><dd>{weekly.blocks.length}</dd></div></dl>
          {weekly.warnings.length ? <div className="schedule-warnings"><strong>Before we continue:</strong><ul>{weekly.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div> : null}
          <div className="setup-actions"><button className="secondary" type="button" onClick={() => setStep('weekly')}>Try a different schedule</button><button type="button" onClick={() => setStep('calendar')}>Yes, next: add school dates</button></div>
        </div>
      ) : null}

      {step === 'calendar' ? (
        <>
          <SourceUploader
            heading="Your annual school calendar"
            description="This step is optional. Add a calendar PDF, photo, or pasted text if you have one. We use it for holidays, A/B rotations, early release, assemblies, testing, and other unusual days."
            source={calendarSource}
            busy={busy}
            onChange={setCalendarSource}
            onError={setError}
          />
          {sourcePayload(calendarSource) ? (
            <div className="import-next-step stack">
              <div>
                <h3>Ready for us to read it?</h3>
                <p className="muted">
                  We will look for dates that change the normal school schedule. You can edit the results
                  before saving.
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => void parseCalendar()}>
                {busy ? 'Reading your calendar…' : 'Yes, read my calendar'}
              </button>
            </div>
          ) : null}
          <button className="secondary" type="button" disabled={busy} onClick={() => setStep('review')}>
            I don’t have this right now — continue
          </button>
        </>
      ) : null}

      {step === 'calendar-confirm' && annualCalendar ? (
        <div className="setup-confirmation stack">
          <div><h3>We found school-year dates</h3><p className="muted">These dates are not saved yet. You’ll see the full list and can change anything next.</p></div>
          <dl className="setup-summary"><div><dt>Dates found</dt><dd>{annualCalendar.overrides.length}</dd></div><div><dt>Items to check</dt><dd>{annualCalendar.warnings.length}</dd></div></dl>
          <div className="setup-actions"><button className="secondary" type="button" onClick={() => setStep('calendar')}>Try a different calendar</button><button type="button" onClick={() => setStep('review')}>Yes, show me everything before saving</button></div>
        </div>
      ) : null}

      {step === 'review' && weekly ? (
        <div className="stack import-review schedule-review">
          <div>
            <h3>Review your teaching week</h3>
            <p className="muted">Take your time. Edit course groups, section names, period times, and rooms. Nothing changes until you choose “Save my schedule.”</p>
          </div>
          {weekly.warnings.length ? (
            <div className="schedule-warnings">
              <strong>Please check:</strong>
              <ul>{weekly.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
            </div>
          ) : null}
          {weekly.courses.map((course, courseIndex) => (
            <div className="schedule-course-card" key={`${course.name}-${courseIndex}`}>
              <div className="import-course-heading">
                <input
                  className="input"
                  value={course.name}
                  aria-label="Course name"
                  onChange={(event) => setWeekly(updateCourse(weekly, courseIndex, { name: event.target.value }))}
                />
                <input
                  className="input"
                  value={course.subject ?? ''}
                  placeholder="Subject"
                  aria-label="Course subject"
                  onChange={(event) => setWeekly(updateCourse(weekly, courseIndex, { subject: event.target.value || null }))}
                />
                <input
                  className="input"
                  value={course.gradeLevel ?? ''}
                  placeholder="Grades"
                  aria-label="Course grade levels"
                  onChange={(event) => setWeekly(updateCourse(weekly, courseIndex, { gradeLevel: event.target.value || null }))}
                />
                <button className="secondary" type="button" onClick={() => setWeekly({ ...weekly, courses: weekly.courses.filter((_, index) => index !== courseIndex) })}>
                  Remove course
                </button>
              </div>
              {course.sections.map((section, sectionIndex) => (
                <div className="schedule-section-card" key={`${section.name}-${sectionIndex}`}>
                  <div className="row">
                    <input
                      className="input"
                      value={section.name}
                      aria-label="Section name"
                      onChange={(event) => {
                        const courses = [...weekly.courses];
                        const sections = [...course.sections];
                        sections[sectionIndex] = { ...section, name: event.target.value };
                        courses[courseIndex] = { ...course, sections };
                        setWeekly({ ...weekly, courses });
                      }}
                    />
                    {weekly.courses.length > 1 ? (
                      <select
                        className="input"
                        value={String(courseIndex)}
                        aria-label="Move section to course"
                        onChange={(event) => moveSection(courseIndex, sectionIndex, Number(event.target.value))}
                      >
                        {weekly.courses.map((option, optionIndex) => (
                          <option key={`${option.name}-${optionIndex}`} value={optionIndex}>
                            {optionIndex === courseIndex ? 'This course' : `Move to ${option.name}`}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        const courses = [...weekly.courses];
                        courses[courseIndex] = { ...course, sections: course.sections.filter((_, index) => index !== sectionIndex) };
                        setWeekly({ ...weekly, courses: courses.filter((item) => item.sections.length > 0) });
                      }}
                    >
                      Remove section
                    </button>
                  </div>
                  {section.meetings.map((meeting, meetingIndex) => (
                    <div className="schedule-meeting-row" key={`${meeting.day}-${meetingIndex}`}>
                      <label>
                        Day
                        <select
                          className="input"
                          value={meeting.day}
                          onChange={(event) => {
                            const courses = [...weekly.courses];
                            const sections = [...course.sections];
                            const meetings = [...section.meetings];
                            meetings[meetingIndex] = { ...meeting, day: event.target.value as typeof meeting.day };
                            sections[sectionIndex] = { ...section, meetings };
                            courses[courseIndex] = { ...course, sections };
                            setWeekly({ ...weekly, courses });
                          }}
                        >
                          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'].map((day) => <option key={day}>{day}</option>)}
                        </select>
                      </label>
                      <label>
                        Start time
                        <input className="input" type="time" value={meeting.startTime ?? ''} onChange={(event) => {
                          const courses = [...weekly.courses]; const sections = [...course.sections]; const meetings = [...section.meetings];
                          meetings[meetingIndex] = { ...meeting, startTime: event.target.value || null }; sections[sectionIndex] = { ...section, meetings }; courses[courseIndex] = { ...course, sections }; setWeekly({ ...weekly, courses });
                        }} />
                      </label>
                      <label>
                        End time
                        <input className="input" type="time" value={meeting.endTime ?? ''} onChange={(event) => {
                          const courses = [...weekly.courses]; const sections = [...course.sections]; const meetings = [...section.meetings];
                          meetings[meetingIndex] = { ...meeting, endTime: event.target.value || null }; sections[sectionIndex] = { ...section, meetings }; courses[courseIndex] = { ...course, sections }; setWeekly({ ...weekly, courses });
                        }} />
                      </label>
                      <label>
                        Room
                        <input className="input" value={meeting.room ?? ''} placeholder="Room" onChange={(event) => {
                          const courses = [...weekly.courses]; const sections = [...course.sections]; const meetings = [...section.meetings];
                          meetings[meetingIndex] = { ...meeting, room: event.target.value || null }; sections[sectionIndex] = { ...section, meetings }; courses[courseIndex] = { ...course, sections }; setWeekly({ ...weekly, courses });
                        }} />
                      </label>
                    </div>
                  ))}
                </div>
              ))}
              <button className="secondary" type="button" onClick={() => setWeekly(updateCourse(weekly, courseIndex, { sections: [...course.sections, { name: 'New section', meetings: [{ day: 'Monday', startTime: null, endTime: null, room: null }] }] }))}>
                Add section
              </button>
            </div>
          ))}
          <button className="secondary" type="button" onClick={() => setWeekly({ ...weekly, courses: [...weekly.courses, { name: 'New course', subject: null, gradeLevel: null, sections: [{ name: 'New section', meetings: [{ day: 'Monday', startTime: null, endTime: null, room: null }] }] }] })}>
            Add course
          </button>

          <div className="schedule-block-summary">
            <h4>Non-class blocks</h4>
            {weekly.blocks.length ? weekly.blocks.map((block, index) => (
              <p key={`${block.label}-${index}`}>
                {block.day} · {block.startTime ?? 'time TBD'}–{block.endTime ?? 'time TBD'} · {block.label}
              </p>
            )) : <p className="muted">No non-class blocks were identified.</p>}
          </div>

          <div className="schedule-calendar-review">
            <h3>Annual calendar {annualCalendar ? '' : '(not added yet)'}</h3>
            {annualCalendar?.warnings.length ? <ul className="schedule-warnings">{annualCalendar.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : null}
            {annualCalendar?.overrides.map((override, index) => (
              <div className="schedule-override-row" key={`${override.date}-${index}`}>
                <input className="input" type="date" value={override.date} onChange={(event) => {
                  const overrides = [...annualCalendar.overrides]; overrides[index] = { ...override, date: event.target.value }; setAnnualCalendar({ ...annualCalendar, overrides });
                }} />
                <input className="input" value={override.label} onChange={(event) => {
                  const overrides = [...annualCalendar.overrides]; overrides[index] = { ...override, label: event.target.value }; setAnnualCalendar({ ...annualCalendar, overrides });
                }} />
                <select className="input" value={override.kind} onChange={(event) => {
                  const overrides = [...annualCalendar.overrides]; overrides[index] = { ...override, kind: event.target.value as typeof override.kind }; setAnnualCalendar({ ...annualCalendar, overrides });
                }}>
                  {['no_school', 'early_release', 'assembly', 'testing', 'special_schedule', 'other'].map((kind) => <option key={kind}>{kind.replace('_', ' ')}</option>)}
                </select>
                <button className="secondary" type="button" onClick={() => setAnnualCalendar({ ...annualCalendar, overrides: annualCalendar.overrides.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
              </div>
            ))}
            {!annualCalendar ? <button className="secondary" type="button" onClick={() => setStep('calendar')}>Add annual calendar</button> : null}
          </div>

          <div className="row">
            <button className="secondary" type="button" disabled={busy} onClick={() => setStep(annualCalendar ? 'calendar-confirm' : 'calendar')}>Back</button>
            <button
              type="button"
              disabled={busy || weekly.courses.length === 0}
              onClick={() => setStep('save-confirm')}
            >
              Everything looks right — continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'save-confirm' && weekly ? (
        <div className="setup-confirmation stack">
          <div><h3>Ready to save?</h3><p className="muted">This creates editable Class Groups and Meeting Rules in your active Academic Year. Set that year above first; you can return later to update the schedule.</p></div>
          <dl className="setup-summary"><div><dt>Courses</dt><dd>{weekly.courses.length}</dd></div><div><dt>Class sections</dt><dd>{weekly.courses.reduce((total, course) => total + course.sections.length, 0)}</dd></div><div><dt>Calendar dates</dt><dd>{annualCalendar?.overrides.length ?? 0}</dd></div></dl>
          <div className="setup-actions"><button className="secondary" type="button" disabled={busy} onClick={() => setStep('review')}>Go back and check again</button><button type="button" disabled={busy} onClick={async () => {
                try {
                  setBusy(true);
                  const result = await api.applyV3ScheduleImport({ weekly, annualCalendar: annualCalendar ?? undefined });
                  await onApplied();
                  setMessage(`Saved ${result.coursesCreated} courses, ${result.classGroupsCreated} Class Groups, ${result.meetingRulesSaved} meeting rules, and generated meetings for ${result.meetingsGeneratedFor} Class Groups.`);
                  setError(null);
                  setStep('complete');
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Unable to save this schedule.');
                } finally {
                  setBusy(false);
                }
              }}>{busy ? 'Saving your schedule…' : 'Yes, save my schedule'}</button></div>
        </div>
      ) : null}

      {step === 'complete' ? (
        <div className="setup-complete stack">
          <div><p className="eyebrow">You’re ready</p><h3>Your schedule is set up</h3><p className="muted">Your dashboard can now show the classes that matter today. You can update your schedule anytime.</p></div>
          {message ? <p className="import-message" role="status">{message}</p> : null}
          <div className="setup-actions"><Link className="button-link" to="/">Go to my dashboard</Link><button className="secondary" type="button" onClick={() => { setWeekly(null); setAnnualCalendar(null); setWeeklySource(emptySource); setCalendarSource(emptySource); setMessage(null); setStep('weekly'); }}>Start a new schedule instead</button></div>
        </div>
      ) : null}

      {error ? <p className="error-message">{error}</p> : null}
      {message && step !== 'complete' ? <p className="import-message" role="status">{message}</p> : null}
    </section>
  );
}
