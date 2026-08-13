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

type AnnualCalendarOverride = AnnualCalendarProposal['overrides'][number];

const calendarKindLabels: Record<AnnualCalendarOverride['kind'], string> = {
  no_school: 'No school / holiday',
  early_release: 'Half day / early release',
  assembly: 'Assembly',
  testing: 'Testing day',
  special_schedule: 'Special schedule',
  other: 'Other calendar change'
};

function isInstructionalCalendarChange(override: AnnualCalendarOverride): boolean {
  return override.kind !== 'no_school';
}

function calendarProposalWithOverride(
  proposal: AnnualCalendarProposal | null,
  override: AnnualCalendarOverride
): AnnualCalendarProposal {
  return {
    overrides: [...(proposal?.overrides ?? []), override],
    warnings: proposal?.warnings ?? []
  };
}

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
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
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
    const converted = await importedModule.default({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.9
    });
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
            <p className="muted">
              It is ready when you are. We have not read or saved anything from it yet.
            </p>
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
                  onChange({
                    text: '',
                    imageBase64s: [await extractImage(file)],
                    fileName: file.name
                  });
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
  courses[courseIndex] = {
    ...courses[courseIndex],
    ...update
  } as WeeklyScheduleProposal['courses'][number];
  return { ...proposal, courses };
}

function CalendarOverrideEditor({
  override,
  onChange,
  onRemove
}: {
  override: AnnualCalendarOverride;
  onChange: (change: Partial<AnnualCalendarOverride>) => void;
  onRemove: () => void;
}) {
  const isHalfDay = override.kind === 'early_release';
  const canEditMeetings = override.kind !== 'no_school' && override.replaceWeeklySchedule;

  return (
    <div className="annual-calendar-entry">
      <div className="schedule-override-row">
        <label>
          Date
          <input
            className="input"
            type="date"
            value={override.date}
            onChange={(event) => onChange({ date: event.target.value })}
          />
        </label>
        <label>
          Name
          <input
            className="input"
            value={override.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
        <label>
          Treatment
          <select
            className="input"
            value={override.kind}
            onChange={(event) => {
              const kind = event.target.value as AnnualCalendarOverride['kind'];
              onChange({
                kind,
                ...(kind === 'no_school' ? { replaceWeeklySchedule: false, meetings: [] } : {})
              });
            }}
          >
            {Object.entries(calendarKindLabels).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>

      {isHalfDay ? (
        <div className="half-day-guidance">
          <strong>Half day: school remains in session.</strong>
          <span>
            It will not be saved as a holiday or skipped by planning. If classes follow shortened
            times, choose the option below and enter the affected Class Groups.
          </span>
        </div>
      ) : null}

      {override.kind !== 'no_school' ? (
        <div className="annual-calendar-options">
          <label>
            Rotation day
            <select
              className="input"
              value={override.rotationDay ?? ''}
              onChange={(event) =>
                onChange({
                  rotationDay:
                    event.target.value === 'A-Day' || event.target.value === 'B-Day'
                      ? event.target.value
                      : null
                })
              }
            >
              <option value="">No rotation label</option>
              <option value="A-Day">A-Day</option>
              <option value="B-Day">B-Day</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={override.replaceWeeklySchedule}
              onChange={(event) => onChange({ replaceWeeklySchedule: event.target.checked })}
            />
            This day has a special or shortened schedule for my classes
          </label>
        </div>
      ) : null}

      {canEditMeetings ? (
        <div className="annual-calendar-meetings">
          <p className="muted">
            Add only the Class Groups whose meeting time changes. Course and Class Group names must
            match the schedule above so the change is attached to the right group.
          </p>
          {override.meetings.map((meeting, meetingIndex) => (
            <div
              className="annual-calendar-meeting-row"
              key={`${meeting.courseName}-${meetingIndex}`}
            >
              <input
                className="input"
                value={meeting.courseName}
                placeholder="Course"
                aria-label="Special schedule Course"
                onChange={(event) => {
                  const meetings = [...override.meetings];
                  meetings[meetingIndex] = { ...meeting, courseName: event.target.value };
                  onChange({ meetings });
                }}
              />
              <input
                className="input"
                value={meeting.sectionName}
                placeholder="Class Group"
                aria-label="Special schedule Class Group"
                onChange={(event) => {
                  const meetings = [...override.meetings];
                  meetings[meetingIndex] = { ...meeting, sectionName: event.target.value };
                  onChange({ meetings });
                }}
              />
              <input
                className="input"
                type="time"
                value={meeting.startTime ?? ''}
                aria-label="Special schedule start time"
                onChange={(event) => {
                  const meetings = [...override.meetings];
                  meetings[meetingIndex] = { ...meeting, startTime: event.target.value || null };
                  onChange({ meetings });
                }}
              />
              <input
                className="input"
                type="time"
                value={meeting.endTime ?? ''}
                aria-label="Special schedule end time"
                onChange={(event) => {
                  const meetings = [...override.meetings];
                  meetings[meetingIndex] = { ...meeting, endTime: event.target.value || null };
                  onChange({ meetings });
                }}
              />
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  onChange({
                    meetings: override.meetings.filter((_, index) => index !== meetingIndex)
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="secondary"
            type="button"
            onClick={() =>
              onChange({
                meetings: [
                  ...override.meetings,
                  { courseName: '', sectionName: '', startTime: null, endTime: null, room: null }
                ]
              })
            }
          >
            Add shortened Class Group meeting
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TeachingDataImporter({ onApplied }: TeachingDataImporterProps) {
  const api = useApiClient();
  const [step, setStep] = useState<
    | 'weekly'
    | 'weekly-confirm'
    | 'calendar'
    | 'calendar-confirm'
    | 'review'
    | 'save-confirm'
    | 'complete'
  >('weekly');
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
        <p className="eyebrow">Teaching setup</p>
        <h2>Let’s add your teaching schedule and school-year calendar</h2>
        <p className="muted">
          We’ll do this one step at a time. Nothing is added until you review and confirm it.
        </p>
      </div>

      <div className="setup-steps" aria-label="Schedule setup progress">
        <span className={step === 'weekly' ? 'active' : weekly ? 'complete' : ''}>
          1. Upload your week
        </span>
        <span className={step === 'calendar' ? 'active' : annualCalendar ? 'complete' : ''}>
          2. Days off & calendar
        </span>
        <span
          className={
            step === 'review' || step === 'save-confirm'
              ? 'active'
              : step === 'complete'
                ? 'complete'
                : ''
          }
        >
          3. Check and save
        </span>
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
                  We will identify Courses, their Class Groups, start times, end times, rooms, and
                  non-class blocks. You will review every detail before anything is saved.
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
          <div>
            <h3>We found your teaching week</h3>
            <p className="muted">
              Please check the Course → Class Group hierarchy. You’ll be able to edit every detail
              before saving.
            </p>
          </div>
          <dl className="setup-summary">
            <div>
              <dt>Courses found</dt>
              <dd>{weekly.courses.length}</dd>
            </div>
            <div>
              <dt>Class Groups found</dt>
              <dd>{weekly.courses.reduce((total, course) => total + course.sections.length, 0)}</dd>
            </div>
            <div>
              <dt>Non-class times</dt>
              <dd>{weekly.blocks.length}</dd>
            </div>
          </dl>
          {weekly.warnings.length ? (
            <div className="schedule-warnings">
              <strong>Before we continue:</strong>
              <ul>
                {weekly.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="setup-actions">
            <button className="secondary" type="button" onClick={() => setStep('weekly')}>
              Try a different schedule
            </button>
            <button type="button" onClick={() => setStep('calendar')}>
              Yes, next: add school dates
            </button>
          </div>
        </div>
      ) : null}

      {step === 'calendar' ? (
        <>
          <SourceUploader
            heading="Your annual calendar: days off, breaks, and shortened days"
            description="This step is optional. Add a school-year calendar PDF, photo, .ics file, or pasted list. We will find holidays, breaks, non-instructional days, and half days. We keep half days as instructional days unless you confirm a special shortened schedule."
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
                  We will identify days off and breaks first, then flag early-release and special
                  schedule days separately. You can edit every date, category, and shortened meeting
                  before saving.
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => void parseCalendar()}>
                {busy ? 'Reading your calendar…' : 'Read my days off & calendar'}
              </button>
            </div>
          ) : null}
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => setStep('review')}
          >
            I don’t have a calendar right now — continue
          </button>
        </>
      ) : null}

      {step === 'calendar-confirm' && annualCalendar ? (
        <div className="setup-confirmation stack">
          <div>
            <h3>We found days off and school-year calendar changes</h3>
            <p className="muted">
              Nothing is saved yet. Holidays and breaks will be treated as non-instructional; half
              days stay instructional and need a shortened-meeting schedule if they change your
              classes.
            </p>
          </div>
          <dl className="setup-summary">
            <div>
              <dt>Days off / break dates</dt>
              <dd>{annualCalendar.overrides.filter((item) => item.kind === 'no_school').length}</dd>
            </div>
            <div>
              <dt>Instructional changes</dt>
              <dd>{annualCalendar.overrides.filter(isInstructionalCalendarChange).length}</dd>
            </div>
            <div>
              <dt>Items to check</dt>
              <dd>{annualCalendar.warnings.length}</dd>
            </div>
          </dl>
          <div className="setup-actions">
            <button className="secondary" type="button" onClick={() => setStep('calendar')}>
              Try a different calendar
            </button>
            <button type="button" onClick={() => setStep('review')}>
              Yes, show me everything before saving
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' && weekly ? (
        <div className="stack import-review schedule-review">
          <div>
            <h3>Review your teaching week</h3>
            <p className="muted">
              Each card is one Course. The Class Groups beneath it can share a name with groups in
              other Courses. Edit Course names, Class Group assignments and names, meeting days,
              times, and rooms. Nothing changes until you choose “Save my schedule.”
            </p>
          </div>
          {weekly.warnings.length ? (
            <div className="schedule-warnings">
              <strong>Please check:</strong>
              <ul>
                {weekly.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {weekly.courses.map((course, courseIndex) => (
            <div className="schedule-course-card" key={`${course.name}-${courseIndex}`}>
              <div className="import-course-heading">
                <span className="eyebrow">Course</span>
                <input
                  className="input"
                  value={course.name}
                  aria-label="Course name"
                  onChange={(event) =>
                    setWeekly(updateCourse(weekly, courseIndex, { name: event.target.value }))
                  }
                />
                <input
                  className="input"
                  value={course.subject ?? ''}
                  placeholder="Subject"
                  aria-label="Course subject"
                  onChange={(event) =>
                    setWeekly(
                      updateCourse(weekly, courseIndex, { subject: event.target.value || null })
                    )
                  }
                />
                <input
                  className="input"
                  value={course.gradeLevel ?? ''}
                  placeholder="Grades"
                  aria-label="Course grade levels"
                  onChange={(event) =>
                    setWeekly(
                      updateCourse(weekly, courseIndex, { gradeLevel: event.target.value || null })
                    )
                  }
                />
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    setWeekly({
                      ...weekly,
                      courses: weekly.courses.filter((_, index) => index !== courseIndex)
                    })
                  }
                >
                  Remove course
                </button>
              </div>
              {course.sections.map((section, sectionIndex) => (
                <div className="schedule-section-card" key={`${section.name}-${sectionIndex}`}>
                  <div className="row">
                    <label className="field-label">
                      Class Group
                      <input
                        className="input"
                        value={section.name}
                        aria-label="Class Group name"
                        onChange={(event) => {
                          const courses = [...weekly.courses];
                          const sections = [...course.sections];
                          sections[sectionIndex] = { ...section, name: event.target.value };
                          courses[courseIndex] = { ...course, sections };
                          setWeekly({ ...weekly, courses });
                        }}
                      />
                    </label>
                    {weekly.courses.length > 1 ? (
                      <select
                        className="input"
                        value={String(courseIndex)}
                        aria-label="Move Class Group to Course"
                        onChange={(event) =>
                          moveSection(courseIndex, sectionIndex, Number(event.target.value))
                        }
                      >
                        {weekly.courses.map((option, optionIndex) => (
                          <option key={`${option.name}-${optionIndex}`} value={optionIndex}>
                            {optionIndex === courseIndex ? 'This Course' : `Move to ${option.name}`}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        const courses = [...weekly.courses];
                        courses[courseIndex] = {
                          ...course,
                          sections: course.sections.filter((_, index) => index !== sectionIndex)
                        };
                        setWeekly({
                          ...weekly,
                          courses: courses.filter((item) => item.sections.length > 0)
                        });
                      }}
                    >
                      Remove Class Group
                    </button>
                  </div>
                  {section.meetings.map((meeting, meetingIndex) => (
                    <div className="schedule-meeting-row" key={`${meeting.day}-${meetingIndex}`}>
                      <label>
                        Day
                        <span
                          className="weekday-toggle-grid import-weekday-toggle-grid"
                          role="group"
                          aria-label="Meeting day"
                        >
                          {[
                            ['Monday', 'Mon'],
                            ['Tuesday', 'Tue'],
                            ['Wednesday', 'Wed'],
                            ['Thursday', 'Thu'],
                            ['Friday', 'Fri'],
                            ['A-Day', 'A-Day'],
                            ['B-Day', 'B-Day']
                          ].map(([day, label]) => {
                            const selected = meeting.day === day;
                            return (
                              <button
                                className={selected ? 'weekday-toggle-selected' : 'secondary'}
                                type="button"
                                key={day}
                                aria-pressed={selected}
                                onClick={() => {
                                  const courses = [...weekly.courses];
                                  const sections = [...course.sections];
                                  const meetings = [...section.meetings];
                                  meetings[meetingIndex] = {
                                    ...meeting,
                                    day: day as typeof meeting.day
                                  };
                                  sections[sectionIndex] = { ...section, meetings };
                                  courses[courseIndex] = { ...course, sections };
                                  setWeekly({ ...weekly, courses });
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </span>
                      </label>
                      <label>
                        Start time
                        <input
                          className="input"
                          type="time"
                          value={meeting.startTime ?? ''}
                          onChange={(event) => {
                            const courses = [...weekly.courses];
                            const sections = [...course.sections];
                            const meetings = [...section.meetings];
                            meetings[meetingIndex] = {
                              ...meeting,
                              startTime: event.target.value || null
                            };
                            sections[sectionIndex] = { ...section, meetings };
                            courses[courseIndex] = { ...course, sections };
                            setWeekly({ ...weekly, courses });
                          }}
                        />
                      </label>
                      <label>
                        End time
                        <input
                          className="input"
                          type="time"
                          value={meeting.endTime ?? ''}
                          onChange={(event) => {
                            const courses = [...weekly.courses];
                            const sections = [...course.sections];
                            const meetings = [...section.meetings];
                            meetings[meetingIndex] = {
                              ...meeting,
                              endTime: event.target.value || null
                            };
                            sections[sectionIndex] = { ...section, meetings };
                            courses[courseIndex] = { ...course, sections };
                            setWeekly({ ...weekly, courses });
                          }}
                        />
                      </label>
                      <label>
                        Room
                        <input
                          className="input"
                          value={meeting.room ?? ''}
                          placeholder="Room"
                          onChange={(event) => {
                            const courses = [...weekly.courses];
                            const sections = [...course.sections];
                            const meetings = [...section.meetings];
                            meetings[meetingIndex] = {
                              ...meeting,
                              room: event.target.value || null
                            };
                            sections[sectionIndex] = { ...section, meetings };
                            courses[courseIndex] = { ...course, sections };
                            setWeekly({ ...weekly, courses });
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ))}
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setWeekly(
                    updateCourse(weekly, courseIndex, {
                      sections: [
                        ...course.sections,
                        {
                          name: 'New section',
                          meetings: [{ day: 'Monday', startTime: null, endTime: null, room: null }]
                        }
                      ]
                    })
                  )
                }
              >
                Add Class Group
              </button>
            </div>
          ))}
          <button
            className="secondary"
            type="button"
            onClick={() =>
              setWeekly({
                ...weekly,
                courses: [
                  ...weekly.courses,
                  {
                    name: 'New course',
                    subject: null,
                    gradeLevel: null,
                    sections: [
                      {
                        name: 'New section',
                        meetings: [{ day: 'Monday', startTime: null, endTime: null, room: null }]
                      }
                    ]
                  }
                ]
              })
            }
          >
            Add course
          </button>

          <div className="schedule-block-summary">
            <h4>Non-class blocks</h4>
            {weekly.blocks.length ? (
              weekly.blocks.map((block, index) => (
                <p key={`${block.label}-${index}`}>
                  {block.day} · {block.startTime ?? 'time TBD'}–{block.endTime ?? 'time TBD'} ·{' '}
                  {block.label}
                </p>
              ))
            ) : (
              <p className="muted">No non-class blocks were identified.</p>
            )}
          </div>

          <div className="schedule-calendar-review">
            <div>
              <p className="eyebrow">Annual calendar</p>
              <h3>Days off, breaks, and changed school days</h3>
              <p className="muted">
                Days marked “No school / holiday” are saved as non-instructional and curriculum
                planning skips them. A half day is <strong>not</strong> a day off: keep it
                instructional and add shortened class times only when that day replaces your normal
                meeting schedule.
              </p>
            </div>
            {annualCalendar?.warnings.length ? (
              <div className="schedule-warnings">
                <strong>Needs review:</strong>
                <ul>
                  {annualCalendar.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {annualCalendar?.overrides.length ? (
              <div className="annual-calendar-groups">
                <div className="annual-calendar-group">
                  <h4>Days off & breaks</h4>
                  {annualCalendar.overrides
                    .map((override, index) => ({ override, index }))
                    .filter(({ override }) => override.kind === 'no_school')
                    .map(({ override, index }) => (
                      <CalendarOverrideEditor
                        key={`${override.date}-${index}`}
                        override={override}
                        onChange={(change) => {
                          const overrides = [...annualCalendar.overrides];
                          overrides[index] = { ...override, ...change };
                          setAnnualCalendar({ ...annualCalendar, overrides });
                        }}
                        onRemove={() =>
                          setAnnualCalendar({
                            ...annualCalendar,
                            overrides: annualCalendar.overrides.filter(
                              (_, itemIndex) => itemIndex !== index
                            )
                          })
                        }
                      />
                    ))}
                  {!annualCalendar.overrides.some((item) => item.kind === 'no_school') ? (
                    <p className="muted">No days off were found. Add one below if needed.</p>
                  ) : null}
                </div>
                <div className="annual-calendar-group">
                  <h4>Half days & instructional changes</h4>
                  {annualCalendar.overrides
                    .map((override, index) => ({ override, index }))
                    .filter(({ override }) => override.kind !== 'no_school')
                    .map(({ override, index }) => (
                      <CalendarOverrideEditor
                        key={`${override.date}-${index}`}
                        override={override}
                        onChange={(change) => {
                          const overrides = [...annualCalendar.overrides];
                          overrides[index] = { ...override, ...change };
                          setAnnualCalendar({ ...annualCalendar, overrides });
                        }}
                        onRemove={() =>
                          setAnnualCalendar({
                            ...annualCalendar,
                            overrides: annualCalendar.overrides.filter(
                              (_, itemIndex) => itemIndex !== index
                            )
                          })
                        }
                      />
                    ))}
                  {!annualCalendar.overrides.some(isInstructionalCalendarChange) ? (
                    <p className="muted">
                      No half days or special schedules were found. Add one only if it changes your
                      normal meetings.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="muted">No calendar entries have been added yet.</p>
            )}
            <div className="row">
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setAnnualCalendar(
                    calendarProposalWithOverride(annualCalendar, {
                      date: '',
                      label: 'School holiday',
                      kind: 'no_school',
                      rotationDay: null,
                      replaceWeeklySchedule: false,
                      meetings: []
                    })
                  )
                }
              >
                Add day off / break
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setAnnualCalendar(
                    calendarProposalWithOverride(annualCalendar, {
                      date: '',
                      label: 'Half day',
                      kind: 'early_release',
                      rotationDay: null,
                      replaceWeeklySchedule: false,
                      meetings: []
                    })
                  )
                }
              >
                Add half day / special schedule
              </button>
              {!annualCalendar ? (
                <button className="secondary" type="button" onClick={() => setStep('calendar')}>
                  Import annual calendar
                </button>
              ) : null}
            </div>
          </div>

          <div className="row">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setStep(annualCalendar ? 'calendar-confirm' : 'calendar')}
            >
              Back
            </button>
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
          <div>
            <h3>Ready to save?</h3>
            <p className="muted">
              This creates editable Class Groups and Meeting Rules in your active Academic Year. Set
              that year above first; you can return later to update the schedule.
            </p>
          </div>
          <dl className="setup-summary">
            <div>
              <dt>Courses</dt>
              <dd>{weekly.courses.length}</dd>
            </div>
            <div>
              <dt>Class Groups</dt>
              <dd>{weekly.courses.reduce((total, course) => total + course.sections.length, 0)}</dd>
            </div>
            <div>
              <dt>Calendar dates</dt>
              <dd>{annualCalendar?.overrides.length ?? 0}</dd>
            </div>
          </dl>
          <div className="setup-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setStep('review')}
            >
              Go back and check again
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  setBusy(true);
                  const result = await api.applyV3ScheduleImport({
                    weekly,
                    annualCalendar: annualCalendar ?? undefined
                  });
                  await onApplied();
                  setMessage(
                    `Saved ${result.coursesCreated} courses, ${result.classGroupsCreated} Class Groups, ${result.meetingRulesSaved} meeting rules, and generated meetings for ${result.meetingsGeneratedFor} Class Groups.`
                  );
                  setError(null);
                  setStep('complete');
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Unable to save this schedule.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Saving your schedule…' : 'Yes, save my schedule'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'complete' ? (
        <div className="setup-complete stack">
          <div>
            <p className="eyebrow">You’re ready</p>
            <h3>Your schedule is set up</h3>
            <p className="muted">
              Your dashboard can now show the classes that matter today. You can update your
              schedule anytime.
            </p>
          </div>
          {message ? (
            <p className="import-message" role="status">
              {message}
            </p>
          ) : null}
          <div className="setup-actions">
            <Link className="button-link" to="/">
              Go to my dashboard
            </Link>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setWeekly(null);
                setAnnualCalendar(null);
                setWeeklySource(emptySource);
                setCalendarSource(emptySource);
                setMessage(null);
                setStep('weekly');
              }}
            >
              Start a new schedule instead
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-message">{error}</p> : null}
      {message && step !== 'complete' ? (
        <p className="import-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
