import type { GetScheduleResponse } from '@teacheros/contracts';

type ScheduleItem = {
  id: string;
  title: string;
  subtitle: string;
  startTime: string | null;
  endTime: string | null;
  kind: 'class' | 'block';
};

const orderedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'A-Day', 'B-Day'];

function minutesSinceMidnight(time: string | null): number {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const [hour = Number.NaN, minute = Number.NaN] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : Number.MAX_SAFE_INTEGER;
}

function displayTime(time: string | null): string | null {
  if (!time) return null;
  const [hourString, minute] = time.split(':');
  const hour = Number(hourString);
  if (!Number.isFinite(hour) || !minute) return time;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function displayRange(startTime: string | null, endTime: string | null): string {
  const start = displayTime(startTime);
  const end = displayTime(endTime);
  if (start && end) return `${start} – ${end}`;
  if (start) return `${start} · end time to confirm`;
  return 'Time to confirm';
}

export function WeeklyScheduleView({ schedule }: { schedule: GetScheduleResponse }) {
  const itemsByDay = new Map<string, ScheduleItem[]>();
  const usedDays = new Set<string>();

  for (const section of schedule.sections) {
    for (const meeting of section.meetings) {
      usedDays.add(meeting.day);
      const items = itemsByDay.get(meeting.day) ?? [];
      items.push({
        id: `${section.sectionId}-${meeting.day}-${meeting.time ?? 'unknown'}-${meeting.endTime ?? 'unknown'}`,
        title: section.courseName,
        subtitle: [section.sectionName, meeting.room].filter(Boolean).join(' · '),
        startTime: meeting.time,
        endTime: meeting.endTime,
        kind: 'class'
      });
      itemsByDay.set(meeting.day, items);
    }
  }

  for (const block of schedule.blocks) {
    usedDays.add(block.day);
    const items = itemsByDay.get(block.day) ?? [];
    items.push({
      id: `${block.day}-${block.label}-${block.startTime ?? 'unknown'}-${block.endTime ?? 'unknown'}`,
      title: block.label,
      subtitle: block.kind.replace('_', ' '),
      startTime: block.startTime,
      endTime: block.endTime,
      kind: 'block'
    });
    itemsByDay.set(block.day, items);
  }

  const days = orderedDays.filter((day) => usedDays.has(day));
  if (!days.length) return null;

  return (
    <section className="card stack weekly-schedule">
      <div>
        <p className="eyebrow">Your teaching week</p>
        <h2>Weekly schedule</h2>
        <p className="muted">Classes show their start and end time. Gray cards are lunch, planning, and other non-class blocks.</p>
      </div>
      <div className="weekly-schedule-grid" aria-label="Weekly teaching schedule">
        {days.map((day) => {
          const items = [...(itemsByDay.get(day) ?? [])].sort(
            (left, right) => minutesSinceMidnight(left.startTime) - minutesSinceMidnight(right.startTime)
          );
          return (
            <section className="weekly-day" key={day}>
              <h3>{day}</h3>
              {items.map((item) => (
                <article className={`weekly-event weekly-event-${item.kind}`} key={item.id}>
                  <span className="weekly-event-time">{displayRange(item.startTime, item.endTime)}</span>
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span className="muted">{item.subtitle}</span> : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </section>
  );
}
