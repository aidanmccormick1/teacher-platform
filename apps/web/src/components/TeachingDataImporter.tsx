import { useState } from 'react';

import type { AcademicCalendarParseResponse, ScheduleImportResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type TeachingDataImporterProps = {
  onApplied: () => Promise<void>;
};

type ImportedClass = ScheduleImportResponse['classes'][number];
type ImportedHoliday = AcademicCalendarParseResponse['holidays'][number];

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

async function extractScheduleImage(file: File): Promise<string> {
  const isHeic = /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  if (!isHeic) return readAsDataUrl(file);

  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return readAsDataUrl(Array.isArray(converted) ? converted[0] : converted);
}

export function TeachingDataImporter({ onApplied }: TeachingDataImporterProps) {
  const api = useApiClient();
  const [sourceText, setSourceText] = useState('');
  const [sourceImageDataUrl, setSourceImageDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [classes, setClasses] = useState<ImportedClass[]>([]);
  const [holidays, setHolidays] = useState<ImportedHoliday[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parseSchedule = async () => {
    if (!sourceText.trim() && !sourceImageDataUrl) {
      setError('Paste or upload a schedule before parsing.');
      return;
    }
    try {
      setBusy(true);
      const parsed = await api.importSchedule({
        text: sourceText.trim() || undefined,
        imageBase64: sourceImageDataUrl ?? undefined
      });
      setClasses(parsed.classes);
      setError(null);
      setMessage(`Found ${parsed.classes.length} class sections. Review them before applying.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to parse this schedule');
    } finally {
      setBusy(false);
    }
  };

  const parseCalendar = async () => {
    if (!sourceText.trim() && !sourceImageDataUrl) {
      setError('Paste or upload an academic calendar before parsing.');
      return;
    }
    try {
      setBusy(true);
      const parsed = await api.parseAcademicCalendar({
        text: sourceText.trim() || undefined,
        imageBase64: sourceImageDataUrl ?? undefined
      });
      setHolidays(parsed.holidays);
      setError(null);
      setMessage(`Found ${parsed.holidays.length} no-school dates. Review them before applying.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to parse this academic calendar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack teaching-importer">
      <div>
        <h2>Import teaching information</h2>
        <p className="muted">
          Upload an academic calendar, bell schedule, course schedule, calendar export, or a photo
          of any of them. Nothing is added until you review it.
        </p>
      </div>
      <input
        className="file-input"
        type="file"
        accept=".pdf,.txt,.csv,.ics,.heic,.heif,image/*,text/plain,text/csv,text/calendar,application/pdf"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            setBusy(true);
            const isImage = file.type.startsWith('image/') || /\.hei[cf]$/i.test(file.name);
            if (isImage) {
              const imageDataUrl = await extractScheduleImage(file);
              setSourceImageDataUrl(imageDataUrl);
              setSourceText('');
              setFileName(file.name);
              setMessage(`Loaded ${file.name}. Choose what you want to extract.`);
              setError(null);
              return;
            }
            const extractedText = await extractFileText(file);
            if (!extractedText.trim()) {
              throw new Error(
                'No selectable text was found. Try a text-based PDF, CSV, ICS, or paste the schedule text.'
              );
            }
            setSourceText(extractedText);
            setSourceImageDataUrl(null);
            setFileName(file.name);
            setMessage(`Loaded ${file.name}. Choose what you want to extract.`);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to read this file');
          } finally {
            setBusy(false);
          }
        }}
      />
      <textarea
        rows={7}
        value={sourceText}
        onChange={(event) => {
          setSourceText(event.target.value);
          if (event.target.value.trim()) setSourceImageDataUrl(null);
        }}
        placeholder="Or paste a school calendar, bell schedule, course schedule, or exported calendar text here."
      />
      {fileName ? <p className="muted">Loaded file: {fileName}</p> : null}
      {sourceImageDataUrl ? (
        <img className="import-image-preview" src={sourceImageDataUrl} alt="Schedule or calendar ready to parse" />
      ) : null}
      <div className="row">
        <button
          type="button"
          disabled={busy || (!sourceText.trim() && !sourceImageDataUrl)}
          onClick={() => void parseSchedule()}
        >
          Parse class schedule
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy || (!sourceText.trim() && !sourceImageDataUrl)}
          onClick={() => void parseCalendar()}
        >
          Parse academic calendar
        </button>
      </div>
      {error ? <p className="error-message">{error}</p> : null}
      {message ? <p className="import-message">{message}</p> : null}

      {classes.length ? (
        <div className="stack import-review">
          <div>
            <h3>Class schedule</h3>
            <p className="muted">
              These entries create or update courses, sections, and meeting times across the
              dashboard.
            </p>
          </div>
          {classes.map((item, index) => (
            <div className="import-class-row" key={`${item.name}-${item.period}-${index}`}>
              <input
                className="input"
                value={item.name}
                onChange={(event) => {
                  const next = [...classes];
                  next[index] = { ...item, name: event.target.value };
                  setClasses(next);
                }}
                aria-label="Course name"
              />
              <input
                className="input"
                value={item.period}
                onChange={(event) => {
                  const next = [...classes];
                  next[index] = { ...item, period: event.target.value };
                  setClasses(next);
                }}
                aria-label="Section or period"
              />
              <input
                className="input"
                value={item.days.join(', ')}
                onChange={(event) => {
                  const next = [...classes];
                  const days = event.target.value
                    .split(',')
                    .map((day) => day.trim())
                    .filter((day) =>
                      [
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'A-Day',
                        'B-Day'
                      ].includes(day)
                    );
                  next[index] = { ...item, days: days as ImportedClass['days'] };
                  setClasses(next);
                }}
                aria-label="Meeting days"
              />
              <input
                className="input"
                value={item.time ?? ''}
                onChange={(event) => {
                  const next = [...classes];
                  next[index] = { ...item, time: event.target.value || null };
                  setClasses(next);
                }}
                placeholder="HH:MM"
                aria-label="Meeting time"
              />
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setClasses((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {holidays.length ? (
        <div className="stack import-review">
          <div>
            <h3>Academic calendar</h3>
            <p className="muted">
              No-school days prevent missed-class prompts and keep the dashboard calendar accurate.
            </p>
          </div>
          {holidays.map((holiday, index) => (
            <div className="import-holiday-row" key={`${holiday.date}-${index}`}>
              <input
                className="input"
                type="date"
                value={holiday.date}
                onChange={(event) => {
                  const next = [...holidays];
                  next[index] = { ...holiday, date: event.target.value };
                  setHolidays(next);
                }}
              />
              <input
                className="input"
                value={holiday.name}
                onChange={(event) => {
                  const next = [...holidays];
                  next[index] = { ...holiday, name: event.target.value };
                  setHolidays(next);
                }}
              />
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setHolidays((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {classes.length || holidays.length ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              setBusy(true);
              const result = await api.applyTeachingDataImport({ classes, holidays });
              await onApplied();
              setMessage(
                `Added ${result.coursesCreated} courses, ${result.sectionsCreated} sections, ${result.meetingsCreated} meeting times, and ${result.holidaysSaved} calendar dates.`
              );
              setError(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Unable to apply this import');
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply reviewed information to my dashboard
        </button>
      ) : null}
    </section>
  );
}
