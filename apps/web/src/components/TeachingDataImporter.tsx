import { useState } from 'react';

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
  return (
    <div className="stack schedule-source">
      <div>
        <h3>{heading}</h3>
        <p className="muted">{description}</p>
      </div>
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
            const pdfImages = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
              ? await renderPdfPages(file)
              : [];
            if (!text.trim() && !pdfImages.length) {
              throw new Error('No readable pages were found. Upload a clearer photo or PDF.');
            }
            onChange({ text, imageBase64s: pdfImages, fileName: file.name });
          } catch (error) {
            onChange({ ...source, fileName: null });
            onError(error instanceof Error ? error.message : 'Unable to read this file.');
          }
        }}
      />
      <textarea
        rows={7}
        value={source.text}
        disabled={busy}
        onChange={(event) =>
          onChange({ text: event.target.value, imageBase64s: [], fileName: source.fileName })
        }
        placeholder="Or paste schedule or calendar text here."
      />
      {source.fileName ? <p className="muted">Ready to parse: {source.fileName}</p> : null}
      {source.imageBase64s.length ? (
        <img className="import-image-preview" src={source.imageBase64s[0]} alt="Schedule ready to parse" />
      ) : null}
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
  const [step, setStep] = useState<'weekly' | 'calendar' | 'review'>('weekly');
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
      setStep('calendar');
      setError(null);
      setMessage('Weekly schedule found. Add the annual calendar next, or continue to review.');
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
      setStep('review');
      setError(null);
      setMessage('Annual calendar found. Review everything before it is added to your dashboard.');
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
        <h2>Set up your teaching schedule</h2>
        <p className="muted">
          Start with the way your week runs, then add the school-year calendar. You review every
          detail before it affects your dashboard.
        </p>
      </div>

      <div className="setup-steps" aria-label="Schedule setup progress">
        <span className={step === 'weekly' ? 'active' : weekly ? 'complete' : ''}>1. Weekly schedule</span>
        <span className={step === 'calendar' ? 'active' : annualCalendar ? 'complete' : ''}>2. Annual calendar</span>
        <span className={step === 'review' ? 'active' : ''}>3. Review</span>
      </div>

      {step === 'weekly' ? (
        <>
          <SourceUploader
            heading="Your weekly or block schedule"
            description="Upload a bell schedule, class grid, or a clear photo. We will separate classes from lunch, homeroom, breaks, prep, and dismissal."
            source={weeklySource}
            busy={busy}
            onChange={setWeeklySource}
            onError={setError}
          />
          <button type="button" disabled={busy || !sourcePayload(weeklySource)} onClick={() => void parseWeekly()}>
            {busy ? 'Reading schedule…' : 'Find my classes and periods'}
          </button>
        </>
      ) : null}

      {step === 'calendar' ? (
        <>
          <SourceUploader
            heading="Your annual school calendar"
            description="Optional, but useful for holidays, A/B rotations, early release, assemblies, testing, and other unusual days."
            source={calendarSource}
            busy={busy}
            onChange={setCalendarSource}
            onError={setError}
          />
          <div className="row">
            <button type="button" disabled={busy || !sourcePayload(calendarSource)} onClick={() => void parseCalendar()}>
              {busy ? 'Reading calendar…' : 'Find school-year dates'}
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={() => setStep('review')}>
              Skip for now
            </button>
          </div>
        </>
      ) : null}

      {step === 'review' && weekly ? (
        <div className="stack import-review schedule-review">
          <div>
            <h3>Review your teaching week</h3>
            <p className="muted">
              Edit course groups, section names, period times, and rooms. Removing or moving a section is safe until you save.
            </p>
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
                      <select
                        className="input"
                        value={meeting.day}
                        aria-label="Meeting day"
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
                      <input className="input" type="time" value={meeting.startTime ?? ''} aria-label="Start time" onChange={(event) => {
                        const courses = [...weekly.courses]; const sections = [...course.sections]; const meetings = [...section.meetings];
                        meetings[meetingIndex] = { ...meeting, startTime: event.target.value || null }; sections[sectionIndex] = { ...section, meetings }; courses[courseIndex] = { ...course, sections }; setWeekly({ ...weekly, courses });
                      }} />
                      <input className="input" type="time" value={meeting.endTime ?? ''} aria-label="End time" onChange={(event) => {
                        const courses = [...weekly.courses]; const sections = [...course.sections]; const meetings = [...section.meetings];
                        meetings[meetingIndex] = { ...meeting, endTime: event.target.value || null }; sections[sectionIndex] = { ...section, meetings }; courses[courseIndex] = { ...course, sections }; setWeekly({ ...weekly, courses });
                      }} />
                      <input className="input" value={meeting.room ?? ''} placeholder="Room" aria-label="Room" onChange={(event) => {
                        const courses = [...weekly.courses]; const sections = [...course.sections]; const meetings = [...section.meetings];
                        meetings[meetingIndex] = { ...meeting, room: event.target.value || null }; sections[sectionIndex] = { ...section, meetings }; courses[courseIndex] = { ...course, sections }; setWeekly({ ...weekly, courses });
                      }} />
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
            <button className="secondary" type="button" disabled={busy} onClick={() => setStep('calendar')}>Back</button>
            <button
              type="button"
              disabled={busy || weekly.courses.length === 0}
              onClick={async () => {
                try {
                  setBusy(true);
                  const result = await api.applyScheduleSetup({ weekly, annualCalendar: annualCalendar ?? undefined });
                  await onApplied();
                  setMessage(`Saved ${result.coursesCreated} courses, ${result.sectionsCreated} sections, ${result.meetingsSaved} class periods, and ${result.overridesSaved} calendar overrides.`);
                  setError(null);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Unable to save this schedule.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Saving schedule…' : 'Add reviewed schedule to my dashboard'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-message">{error}</p> : null}
      {message ? <p className="import-message">{message}</p> : null}
    </section>
  );
}
