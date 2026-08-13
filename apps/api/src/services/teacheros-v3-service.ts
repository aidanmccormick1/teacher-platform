import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';

import {
  academicYears,
  calendarEvents,
  classGroupLessonProgress,
  classGroupLessonStepProgress,
  classGroups,
  classGroupUnitPlans,
  courses,
  db,
  lessonSteps,
  lessons,
  meetingHistory,
  meetingInstances,
  meetingRuleDays,
  meetingRules,
  planAllocations,
  scheduleOverrideMeetingsV3,
  scheduleOverridesV3,
  units,
  users
} from '@teacheros/db';
import type {
  ClassroomProgressInput,
  ClassroomState,
  MeetingGenerationPreview,
  MeetingInstance,
  MeetingRuleInput,
  PlannedPercentage
} from '@teacheros/contracts';

type Candidate = {
  localDate: string;
  startTime: string;
  endTime: string;
  room: string | null;
  source: 'generated' | 'override';
};

type DateParts = { localDate: string; localTime: string };

type PlannedBatch = {
  meetingId: string;
  meetingNumber: number;
  localDate: string;
  startTime: string;
  allocationIds: string[];
};

export function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeLocalTime(value: string): string {
  return value.slice(0, 5);
}

export function zonedDateParts(timezone: string, instant = new Date()): DateParts {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  if (!year || !month || !day || !hour || !minute) throw new Error('Unable to resolve local time');
  return { localDate: `${year}-${month}-${day}`, localTime: `${hour}:${minute}` };
}

export function findCurrentMeeting<
  T extends { localDate: string; startTime: string; endTime: string }
>(meetings: T[], local: DateParts): T | null {
  return (
    meetings.find(
      (meeting) =>
        meeting.localDate === local.localDate &&
        normalizeLocalTime(meeting.startTime) <= local.localTime &&
        normalizeLocalTime(meeting.endTime) > local.localTime
    ) ?? null
  );
}

function dateRange(startDate: string, endDate: string): string[] {
  const values: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (cursor <= end) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

function weekday(localDate: string): number {
  return new Date(`${localDate}T12:00:00Z`).getUTCDay();
}

function inDateRange(localDate: string, startDate: string | null, endDate: string | null): boolean {
  return (!startDate || localDate >= startDate) && (!endDate || localDate <= endDate);
}

function meetingKey(candidate: Pick<Candidate, 'localDate' | 'startTime'>): string {
  return `${candidate.localDate}:${normalizeLocalTime(candidate.startTime)}`;
}

function compareMeetingPosition(
  left: Pick<PlannedBatch, 'localDate' | 'startTime'>,
  right: Pick<PlannedBatch, 'localDate' | 'startTime'>
): number {
  return `${left.localDate}T${left.startTime}`.localeCompare(
    `${right.localDate}T${right.startTime}`
  );
}

export function buildMeetingCandidates(params: {
  startDate: string;
  endDate: string;
  rules: Array<{
    id: string;
    startTime: string;
    endTime: string;
    effectiveStart: string | null;
    effectiveEnd: string | null;
    room: string | null;
  }>;
  ruleDays: Array<{ meetingRuleId: string; weekday: number }>;
  events: Array<{ startDate: string; endDate: string; instructional: boolean }>;
  overrides: Array<{
    date: string;
    meetings: Array<{
      action: 'replace' | 'add' | 'cancel';
      startTime: string | null;
      endTime: string | null;
      room: string | null;
    }>;
  }>;
}): Candidate[] {
  const daysByRule = new Map<string, Set<number>>();
  for (const day of params.ruleDays) {
    const values = daysByRule.get(day.meetingRuleId) ?? new Set<number>();
    values.add(day.weekday);
    daysByRule.set(day.meetingRuleId, values);
  }
  const overridesByDate = new Map(
    params.overrides.map((override) => [override.date, override.meetings])
  );
  const candidates: Candidate[] = [];

  for (const localDate of dateRange(params.startDate, params.endDate)) {
    const instructional = !params.events.some(
      (event) => !event.instructional && inDateRange(localDate, event.startDate, event.endDate)
    );
    // A schedule override never turns a non-instructional event into a class day.
    if (!instructional) continue;

    const dayCandidates = new Map<string, Candidate>();
    for (const rule of params.rules) {
      if (!inDateRange(localDate, rule.effectiveStart, rule.effectiveEnd)) continue;
      if (!daysByRule.get(rule.id)?.has(weekday(localDate))) continue;
      dayCandidates.set(normalizeLocalTime(rule.startTime), {
        localDate,
        startTime: normalizeLocalTime(rule.startTime),
        endTime: normalizeLocalTime(rule.endTime),
        room: rule.room,
        source: 'generated'
      });
    }

    for (const override of overridesByDate.get(localDate) ?? []) {
      if (override.action === 'cancel') {
        dayCandidates.clear();
      } else if (override.startTime && override.endTime) {
        if (override.action === 'replace') dayCandidates.clear();
        dayCandidates.set(normalizeLocalTime(override.startTime), {
          localDate,
          startTime: normalizeLocalTime(override.startTime),
          endTime: normalizeLocalTime(override.endTime),
          room: override.room,
          source: 'override'
        });
      }
    }
    candidates.push(
      ...[...dayCandidates.values()].sort((left, right) =>
        left.startTime.localeCompare(right.startTime)
      )
    );
  }
  return candidates;
}

async function assertOwnedClassGroup(userId: string, classGroupId: string) {
  const [group] = await db
    .select({
      id: classGroups.id,
      courseId: classGroups.courseId,
      academicYearId: classGroups.academicYearId,
      name: classGroups.name,
      periodLabel: classGroups.periodLabel,
      room: classGroups.room,
      courseName: courses.name
    })
    .from(classGroups)
    .innerJoin(courses, eq(classGroups.courseId, courses.id))
    .where(and(eq(classGroups.id, classGroupId), eq(courses.teacherId, userId)))
    .limit(1);
  if (!group) throw new Error('Class Group not found.');
  return group;
}

export async function loadAccountTimezone(userId: string): Promise<string | null> {
  const [account] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return account?.timezone ?? null;
}

export async function initializeTimezone(userId: string, timezone: string): Promise<string> {
  if (!isIanaTimezone(timezone)) throw new Error('Invalid IANA timezone.');
  const [updated] = await db
    .update(users)
    .set({ timezone, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.timezone)))
    .returning({ timezone: users.timezone });
  return updated?.timezone ?? (await loadAccountTimezone(userId)) ?? timezone;
}

export async function updateTimezone(userId: string, timezone: string): Promise<string> {
  if (!isIanaTimezone(timezone)) throw new Error('Invalid IANA timezone.');
  const [updated] = await db
    .update(users)
    .set({ timezone, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ timezone: users.timezone });
  if (!updated) throw new Error('Account not found.');
  return updated.timezone ?? timezone;
}

function isHistoricalMeeting(params: {
  meetingId: string;
  historyIds: Set<string>;
  lessonMeetingIds: Set<string>;
  stepMeetingIds: Set<string>;
}): boolean {
  return (
    params.historyIds.has(params.meetingId) ||
    params.lessonMeetingIds.has(params.meetingId) ||
    params.stepMeetingIds.has(params.meetingId)
  );
}

export async function recalculateMeetingInstances(
  userId: string,
  classGroupId: string,
  mode: 'preview' | 'meetings_only' | 'shift' = 'preview',
  options: { meetingRules?: MeetingRuleInput[] } = {}
): Promise<MeetingGenerationPreview> {
  const group = await assertOwnedClassGroup(userId, classGroupId);
  const [year] = await db
    .select({ startDate: academicYears.startDate, endDate: academicYears.endDate })
    .from(academicYears)
    .where(eq(academicYears.id, group.academicYearId))
    .limit(1);
  if (!year) throw new Error('Academic Year not found.');
  const timezone = await loadAccountTimezone(userId);
  if (!timezone) throw new Error('Set your TeacherOS timezone before generating meetings.');

  const persistedRules = await db
    .select({
      id: meetingRules.id,
      startTime: meetingRules.startTime,
      endTime: meetingRules.endTime,
      effectiveStart: meetingRules.effectiveStart,
      effectiveEnd: meetingRules.effectiveEnd,
      room: meetingRules.room
    })
    .from(meetingRules)
    .where(eq(meetingRules.classGroupId, classGroupId));
  const persistedRuleIds = persistedRules.map((rule) => rule.id);
  const persistedRuleDays = persistedRuleIds.length
    ? await db
        .select({ meetingRuleId: meetingRuleDays.meetingRuleId, weekday: meetingRuleDays.weekday })
        .from(meetingRuleDays)
        .where(inArray(meetingRuleDays.meetingRuleId, persistedRuleIds))
    : [];
  // A schedule-edit preview must evaluate the proposed rules without writing them.
  // These synthetic IDs exist only long enough to group the proposed weekday values.
  const rules = options.meetingRules
    ? options.meetingRules.map((rule, index) => ({
        id: `draft-rule-${index}`,
        startTime: rule.startTime,
        endTime: rule.endTime,
        effectiveStart: rule.effectiveStart,
        effectiveEnd: rule.effectiveEnd,
        room: rule.room
      }))
    : persistedRules;
  const ruleDays = options.meetingRules
    ? options.meetingRules.flatMap((rule, index) =>
        rule.weekdays.map((weekday) => ({ meetingRuleId: `draft-rule-${index}`, weekday }))
      )
    : persistedRuleDays;
  const events = await db
    .select({
      startDate: calendarEvents.startDate,
      endDate: calendarEvents.endDate,
      instructional: calendarEvents.instructional
    })
    .from(calendarEvents)
    .where(eq(calendarEvents.academicYearId, group.academicYearId));
  const overrides = await db
    .select({ id: scheduleOverridesV3.id, date: scheduleOverridesV3.date })
    .from(scheduleOverridesV3)
    .where(eq(scheduleOverridesV3.academicYearId, group.academicYearId));
  const overrideIds = overrides.map((override) => override.id);
  const overrideMeetings = overrideIds.length
    ? await db
        .select({
          scheduleOverrideId: scheduleOverrideMeetingsV3.scheduleOverrideId,
          action: scheduleOverrideMeetingsV3.action,
          startTime: scheduleOverrideMeetingsV3.startTime,
          endTime: scheduleOverrideMeetingsV3.endTime,
          room: scheduleOverrideMeetingsV3.room
        })
        .from(scheduleOverrideMeetingsV3)
        .where(
          and(
            inArray(scheduleOverrideMeetingsV3.scheduleOverrideId, overrideIds),
            eq(scheduleOverrideMeetingsV3.classGroupId, classGroupId)
          )
        )
    : [];
  const candidates = buildMeetingCandidates({
    startDate: year.startDate,
    endDate: year.endDate,
    rules,
    ruleDays,
    events,
    overrides: overrides.map((override) => ({
      date: override.date,
      meetings: overrideMeetings
        .filter((meeting) => meeting.scheduleOverrideId === override.id)
        .map((meeting) => ({ ...meeting, action: meeting.action }))
    }))
  });

  const existing = await db
    .select()
    .from(meetingInstances)
    .where(
      and(
        eq(meetingInstances.classGroupId, classGroupId),
        eq(meetingInstances.academicYearId, group.academicYearId)
      )
    );
  const ids = existing.map((meeting) => meeting.id);
  const [historyRows, lessonRows, stepRows, allocationRows] = ids.length
    ? await Promise.all([
        db
          .select({ meetingInstanceId: meetingHistory.meetingInstanceId })
          .from(meetingHistory)
          .where(inArray(meetingHistory.meetingInstanceId, ids)),
        db
          .select({
            actualStartMeetingId: classGroupLessonProgress.actualStartMeetingId,
            actualCompletionMeetingId: classGroupLessonProgress.actualCompletionMeetingId
          })
          .from(classGroupLessonProgress)
          .where(eq(classGroupLessonProgress.classGroupId, classGroupId)),
        db
          .select({ meetingInstanceId: classGroupLessonStepProgress.meetingInstanceId })
          .from(classGroupLessonStepProgress)
          .where(eq(classGroupLessonStepProgress.classGroupId, classGroupId)),
        db
          .select({ id: planAllocations.id, meetingInstanceId: planAllocations.meetingInstanceId })
          .from(planAllocations)
          .where(inArray(planAllocations.meetingInstanceId, ids))
      ])
    : [[], [], [], []];
  const historyIds = new Set(historyRows.map((row) => row.meetingInstanceId));
  const lessonMeetingIds = new Set(
    lessonRows
      .flatMap((row) => [row.actualStartMeetingId, row.actualCompletionMeetingId])
      .filter((value): value is string => Boolean(value))
  );
  const stepMeetingIds = new Set(
    stepRows.map((row) => row.meetingInstanceId).filter((value): value is string => Boolean(value))
  );
  const allocationIds = new Set(allocationRows.map((row) => row.meetingInstanceId));
  const historicalIds = new Set(
    existing
      .filter((meeting) =>
        isHistoricalMeeting({ meetingId: meeting.id, historyIds, lessonMeetingIds, stepMeetingIds })
      )
      .map((meeting) => meeting.id)
  );
  const candidateKeys = new Set(candidates.map(meetingKey));
  const existingByKey = new Map(
    existing.map((meeting) => [
      meetingKey({ localDate: meeting.localDate, startTime: meeting.startTime }),
      meeting
    ])
  );
  const today = zonedDateParts(timezone).localDate;
  const affectedPlanned = existing.filter(
    (meeting) =>
      !candidateKeys.has(
        meetingKey({ localDate: meeting.localDate, startTime: meeting.startTime })
      ) &&
      allocationIds.has(meeting.id) &&
      !historicalIds.has(meeting.id)
  );
  const allocationIdsByMeeting = new Map<string, string[]>();
  for (const allocation of allocationRows) {
    const idsForMeeting = allocationIdsByMeeting.get(allocation.meetingInstanceId) ?? [];
    idsForMeeting.push(allocation.id);
    allocationIdsByMeeting.set(allocation.meetingInstanceId, idsForMeeting);
  }
  const affectedPlanAllocations = affectedPlanned.reduce(
    (count, meeting) => count + (allocationIdsByMeeting.get(meeting.id)?.length ?? 0),
    0
  );
  const firstAffected = [...affectedPlanned].sort(compareMeetingPosition)[0];
  const plannedBatchesToShift: PlannedBatch[] = firstAffected
    ? existing
        .filter(
          (meeting) =>
            allocationIds.has(meeting.id) &&
            !historicalIds.has(meeting.id) &&
            meeting.localDate >= today &&
            compareMeetingPosition(meeting, firstAffected) >= 0
        )
        .sort(compareMeetingPosition)
        .map((meeting) => ({
          meetingId: meeting.id,
          meetingNumber: meeting.meetingNumber,
          localDate: meeting.localDate,
          startTime: meeting.startTime,
          allocationIds: allocationIdsByMeeting.get(meeting.id) ?? []
        }))
    : [];
  const shiftCandidates = firstAffected
    ? candidates.filter((candidate) => candidate.localDate >= firstAffected.localDate)
    : [];
  const proposedRemappings = plannedBatchesToShift.flatMap((batch, index) => {
    const target = shiftCandidates[index];
    return target
      ? [
          {
            fromMeetingId: batch.meetingId,
            fromMeetingNumber: batch.meetingNumber,
            toLocalDate: target.localDate,
            toStartTime: target.startTime
          }
        ]
      : [];
  });
  const unmappedPlanAllocations = plannedBatchesToShift
    .slice(shiftCandidates.length)
    .reduce((count, batch) => count + batch.allocationIds.length, 0);
  const preview: MeetingGenerationPreview = {
    generated: candidates.filter((candidate) => !existingByKey.has(meetingKey(candidate))).length,
    updated: candidates.filter((candidate) => existingByKey.has(meetingKey(candidate))).length,
    removedUnused: existing.filter(
      (meeting) =>
        !candidateKeys.has(
          meetingKey({ localDate: meeting.localDate, startTime: meeting.startTime })
        ) &&
        !allocationIds.has(meeting.id) &&
        !historicalIds.has(meeting.id) &&
        meeting.localDate >= today
    ).length,
    affectedPlanned: affectedPlanned.length,
    affectedPlanAllocations,
    historicalPreserved: historicalIds.size,
    proposedRemappings,
    unmappedPlanAllocations,
    conflicts: [
      ...affectedPlanned.map(
        (meeting) =>
          `Meeting ${meeting.meetingNumber} on ${meeting.localDate} has planned curriculum.`
      ),
      ...(unmappedPlanAllocations
        ? [
            `${unmappedPlanAllocations} planned Lesson allocation${unmappedPlanAllocations === 1 ? '' : 's'} cannot be shifted because no later instructional Meeting is available.`
          ]
        : [])
    ]
  };
  if (mode === 'preview') return preview;

  await db.transaction(async (tx) => {
    for (const meeting of existing) {
      const key = meetingKey({ localDate: meeting.localDate, startTime: meeting.startTime });
      if (candidateKeys.has(key)) {
        const candidate = candidates.find((item) => meetingKey(item) === key);
        if (candidate && !historicalIds.has(meeting.id)) {
          await tx
            .update(meetingInstances)
            .set({
              endTime: candidate.endTime,
              source: candidate.source,
              state: 'scheduled',
              updatedAt: new Date()
            })
            .where(eq(meetingInstances.id, meeting.id));
        }
      } else if (historicalIds.has(meeting.id)) {
        continue;
      } else if (allocationIds.has(meeting.id)) {
        await tx
          .update(meetingInstances)
          .set({ state: 'superseded', updatedAt: new Date() })
          .where(eq(meetingInstances.id, meeting.id));
      } else if (meeting.localDate >= today) {
        await tx.delete(meetingInstances).where(eq(meetingInstances.id, meeting.id));
      }
    }
    for (const [index, candidate] of candidates.entries()) {
      if (existingByKey.has(meetingKey(candidate))) continue;
      await tx.insert(meetingInstances).values({
        classGroupId,
        academicYearId: group.academicYearId,
        localDate: candidate.localDate,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        meetingNumber: 100000 + index,
        source: candidate.source,
        state: 'scheduled'
      });
    }
  });

  // Meeting numbers describe the real schedule, never curriculum. Preserve every
  // historical number and deterministically renumber only future, non-recorded rows.
  const activeRows = await db
    .select()
    .from(meetingInstances)
    .where(
      and(
        eq(meetingInstances.classGroupId, classGroupId),
        eq(meetingInstances.academicYearId, group.academicYearId),
        eq(meetingInstances.state, 'scheduled')
      )
    )
    .orderBy(asc(meetingInstances.localDate), asc(meetingInstances.startTime));

  if (mode === 'shift' && plannedBatchesToShift.length) {
    const finalTargets = activeRows.filter(
      (meeting) => meeting.localDate >= firstAffected!.localDate && !historicalIds.has(meeting.id)
    );
    await db.transaction(async (tx) => {
      const remappedSourceMeetingIds = new Set<string>();
      for (const [index, batch] of plannedBatchesToShift.entries()) {
        const target = finalTargets[index];
        if (!target || !batch.allocationIds.length) continue;
        await tx
          .update(planAllocations)
          .set({ meetingInstanceId: target.id, updatedAt: new Date() })
          .where(inArray(planAllocations.id, batch.allocationIds));
        remappedSourceMeetingIds.add(batch.meetingId);
      }
      const resolvedSupersededIds = affectedPlanned
        .filter((meeting) => remappedSourceMeetingIds.has(meeting.id))
        .map((meeting) => meeting.id);
      if (resolvedSupersededIds.length) {
        await tx
          .delete(meetingInstances)
          .where(inArray(meetingInstances.id, resolvedSupersededIds));
      }
    });
  }
  const protectedNumbers = new Map(
    existing
      .filter(
        (row) =>
          historicalIds.has(row.id) ||
          (mode !== 'shift' && affectedPlanned.some((meeting) => meeting.id === row.id))
      )
      .map((row) => [row.id, row.meetingNumber])
  );
  const mutable = activeRows.filter((row) => !protectedNumbers.has(row.id));
  await db.transaction(async (tx) => {
    for (const [index, row] of mutable.entries()) {
      await tx
        .update(meetingInstances)
        .set({ meetingNumber: -100000 - index })
        .where(eq(meetingInstances.id, row.id));
    }
    let nextNumber = Math.max(0, ...protectedNumbers.values()) + 1;
    for (const row of mutable) {
      await tx
        .update(meetingInstances)
        .set({ meetingNumber: nextNumber++, updatedAt: new Date() })
        .where(eq(meetingInstances.id, row.id));
    }
  });
  return preview;
}

export function calculatePlannedPercentage(params: {
  meetingIds: string[];
  allocations: Array<{ meetingInstanceId: string; unitId: string }>;
  unitPlans: Array<{
    unitId: string;
    estimatedMeetings: number | null;
    estimatedWeeks: number | null;
    startDate: string | null;
    endDate: string | null;
  }>;
  meetingDates: Map<string, string>;
  weeklyMeetingCount: number;
}): PlannedPercentage {
  const availableMeetings = params.meetingIds.length;
  const explicitByUnit = new Map<string, Set<string>>();
  const explicitMeetingIds = new Set<string>();
  for (const allocation of params.allocations) {
    explicitMeetingIds.add(allocation.meetingInstanceId);
    const values = explicitByUnit.get(allocation.unitId) ?? new Set<string>();
    values.add(allocation.meetingInstanceId);
    explicitByUnit.set(allocation.unitId, values);
  }
  let remainingCapacity = Math.max(0, availableMeetings - explicitMeetingIds.size);
  let requestedEstimate = 0;
  let representedEstimate = 0;
  for (const plan of params.unitPlans) {
    const explicitForUnit = explicitByUnit.get(plan.unitId)?.size ?? 0;
    let requested = plan.estimatedMeetings ?? 0;
    if (!requested && plan.startDate && plan.endDate) {
      requested = [...params.meetingDates.values()].filter(
        (date) => date >= plan.startDate! && date <= plan.endDate!
      ).length;
    }
    if (!requested && plan.estimatedWeeks)
      requested = plan.estimatedWeeks * params.weeklyMeetingCount;
    requested = Math.max(0, requested - explicitForUnit);
    requestedEstimate += requested;
    const used = Math.min(requested, remainingCapacity);
    representedEstimate += used;
    remainingCapacity -= used;
  }
  const rawDemand = explicitMeetingIds.size + requestedEstimate;
  return {
    availableMeetings,
    explicitMeetings: explicitMeetingIds.size,
    estimatedMeetings: representedEstimate,
    percent: availableMeetings
      ? Math.min(100, ((explicitMeetingIds.size + representedEstimate) / availableMeetings) * 100)
      : 0,
    isApproximate: requestedEstimate > 0,
    overCapacityMeetings: Math.max(0, rawDemand - availableMeetings)
  };
}

export async function getPlannedPercentage(
  userId: string,
  classGroupId: string
): Promise<PlannedPercentage> {
  const group = await assertOwnedClassGroup(userId, classGroupId);
  const meetings = await db
    .select({ id: meetingInstances.id, localDate: meetingInstances.localDate })
    .from(meetingInstances)
    .where(
      and(eq(meetingInstances.classGroupId, classGroupId), eq(meetingInstances.state, 'scheduled'))
    );
  const allocations = await db
    .select({ meetingInstanceId: planAllocations.meetingInstanceId, unitId: units.id })
    .from(planAllocations)
    .innerJoin(meetingInstances, eq(planAllocations.meetingInstanceId, meetingInstances.id))
    .innerJoin(lessons, eq(planAllocations.lessonId, lessons.id))
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(
      and(eq(planAllocations.classGroupId, classGroupId), eq(meetingInstances.state, 'scheduled'))
    );
  const unitPlans = await db
    .select({
      unitId: classGroupUnitPlans.unitId,
      estimatedMeetings: classGroupUnitPlans.estimatedMeetings,
      estimatedWeeks: classGroupUnitPlans.estimatedWeeks,
      startDate: classGroupUnitPlans.startDate,
      endDate: classGroupUnitPlans.endDate
    })
    .from(classGroupUnitPlans)
    .where(eq(classGroupUnitPlans.classGroupId, classGroupId));
  const ruleDays = await db
    .select({ weekday: meetingRuleDays.weekday })
    .from(meetingRuleDays)
    .innerJoin(meetingRules, eq(meetingRuleDays.meetingRuleId, meetingRules.id))
    .where(eq(meetingRules.classGroupId, group.id));
  return calculatePlannedPercentage({
    meetingIds: meetings.map((meeting) => meeting.id),
    allocations,
    unitPlans,
    meetingDates: new Map(meetings.map((meeting) => [meeting.id, meeting.localDate])),
    weeklyMeetingCount: new Set(ruleDays.map((rule) => rule.weekday)).size
  });
}

export async function buildV3CourseDetail(userId: string, courseId: string) {
  const [course] = await db
    .select({
      id: courses.id,
      name: courses.name,
      subject: courses.subject,
      gradeLevel: courses.gradeLevel
    })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, userId)))
    .limit(1);
  if (!course) return null;
  const [unitRows, groupRows] = await Promise.all([
    db
      .select({
        id: units.id,
        title: units.title,
        description: units.description,
        orderIndex: units.orderIndex,
        estimatedWeeks: units.estimatedWeeks,
        estimatedMeetings: units.estimatedMeetings
      })
      .from(units)
      .where(and(eq(units.courseId, courseId), isNull(units.archivedAt)))
      .orderBy(asc(units.orderIndex)),
    db.select().from(classGroups).where(eq(classGroups.courseId, courseId))
  ]);
  const unitIds = unitRows.map((unit) => unit.id);
  const lessonRows = unitIds.length
    ? await db
        .select({
          id: lessons.id,
          unitId: lessons.unitId,
          title: lessons.title,
          description: lessons.description,
          orderIndex: lessons.orderIndex,
          estimatedDurationMinutes: lessons.estimatedDurationMinutes,
          estimatedMeetings: lessons.estimatedMeetings
        })
        .from(lessons)
        .where(inArray(lessons.unitId, unitIds))
        .orderBy(asc(lessons.orderIndex))
    : [];
  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const stepRows = lessonIds.length
    ? await db
        .select({
          id: lessonSteps.id,
          lessonId: lessonSteps.lessonId,
          title: lessonSteps.title,
          description: lessonSteps.description,
          estimatedMinutes: lessonSteps.estimatedMinutes,
          isOptional: lessonSteps.isOptional,
          orderIndex: lessonSteps.orderIndex
        })
        .from(lessonSteps)
        .where(inArray(lessonSteps.lessonId, lessonIds))
        .orderBy(asc(lessonSteps.orderIndex))
    : [];
  const groupIds = groupRows.map((group) => group.id);
  const ruleRows = groupIds.length
    ? await db.select().from(meetingRules).where(inArray(meetingRules.classGroupId, groupIds))
    : [];
  const ruleIds = ruleRows.map((rule) => rule.id);
  const dayRows = ruleIds.length
    ? await db.select().from(meetingRuleDays).where(inArray(meetingRuleDays.meetingRuleId, ruleIds))
    : [];
  return {
    course: {
      ...course,
      units: unitRows.map((unit) => ({
        ...unit,
        lessons: lessonRows
          .filter((lesson) => lesson.unitId === unit.id)
          .map((lesson) => ({
            ...lesson,
            steps: stepRows.filter((step) => step.lessonId === lesson.id)
          }))
      })),
      classGroups: groupRows.map((group) => ({
        id: group.id,
        courseId: group.courseId,
        academicYearId: group.academicYearId,
        name: group.name,
        periodLabel: group.periodLabel,
        room: group.room,
        meetingRules: ruleRows
          .filter((rule) => rule.classGroupId === group.id)
          .map((rule) => ({
            id: rule.id,
            weekdays: dayRows
              .filter((day) => day.meetingRuleId === rule.id)
              .map((day) => day.weekday),
            startTime: normalizeLocalTime(rule.startTime),
            endTime: normalizeLocalTime(rule.endTime),
            effectiveStart: rule.effectiveStart,
            effectiveEnd: rule.effectiveEnd,
            room: rule.room
          }))
      }))
    }
  };
}

export function toMeetingInstance(row: typeof meetingInstances.$inferSelect): MeetingInstance {
  return {
    id: row.id,
    classGroupId: row.classGroupId,
    academicYearId: row.academicYearId,
    localDate: row.localDate,
    startTime: normalizeLocalTime(row.startTime),
    endTime: normalizeLocalTime(row.endTime),
    meetingNumber: row.meetingNumber,
    source: row.source,
    state: row.state
  };
}

export async function getClassroomState(
  userId: string,
  requestedClassGroupId?: string,
  instant = new Date()
): Promise<ClassroomState> {
  const timezone = await loadAccountTimezone(userId);
  const now = instant;
  const local = timezone ? zonedDateParts(timezone, now) : null;
  const groupRows = await db
    .select({
      id: classGroups.id,
      courseId: classGroups.courseId,
      name: classGroups.name,
      periodLabel: classGroups.periodLabel,
      courseName: courses.name
    })
    .from(classGroups)
    .innerJoin(courses, eq(classGroups.courseId, courses.id))
    .where(eq(courses.teacherId, userId));
  const groupIds = groupRows.map((group) => group.id);
  const todays =
    local && groupIds.length
      ? await db
          .select()
          .from(meetingInstances)
          .where(
            and(
              inArray(meetingInstances.classGroupId, groupIds),
              eq(meetingInstances.localDate, local.localDate),
              eq(meetingInstances.state, 'scheduled')
            )
          )
          .orderBy(asc(meetingInstances.startTime))
      : [];
  const active = local ? findCurrentMeeting(todays, local) : null;
  const selectedGroupId = requestedClassGroupId ?? active?.classGroupId ?? null;
  if (requestedClassGroupId && !groupIds.includes(requestedClassGroupId))
    throw new Error('Class Group not found.');
  let selected: ClassroomState['selected'] = null;
  if (selectedGroupId) {
    let relevant = active?.classGroupId === selectedGroupId ? active : null;
    if (!relevant) {
      const [history] = await db
        .select({ meeting: meetingInstances })
        .from(meetingHistory)
        .innerJoin(meetingInstances, eq(meetingHistory.meetingInstanceId, meetingInstances.id))
        .where(eq(meetingHistory.classGroupId, selectedGroupId))
        .orderBy(desc(meetingHistory.updatedAt))
        .limit(1);
      relevant = history?.meeting ?? null;
    }
    if (!relevant) {
      const [unfinished] = await db
        .select({ meeting: meetingInstances })
        .from(classGroupLessonProgress)
        .innerJoin(
          planAllocations,
          and(
            eq(planAllocations.classGroupId, classGroupLessonProgress.classGroupId),
            eq(planAllocations.lessonId, classGroupLessonProgress.lessonId)
          )
        )
        .innerJoin(meetingInstances, eq(planAllocations.meetingInstanceId, meetingInstances.id))
        .where(
          and(
            eq(classGroupLessonProgress.classGroupId, selectedGroupId),
            eq(classGroupLessonProgress.status, 'in_progress'),
            eq(meetingInstances.state, 'scheduled')
          )
        )
        .orderBy(desc(meetingInstances.localDate), desc(meetingInstances.startTime))
        .limit(1);
      relevant = unfinished?.meeting ?? null;
    }
    const [upcoming] = await db
      .select()
      .from(meetingInstances)
      .where(
        and(
          eq(meetingInstances.classGroupId, selectedGroupId),
          eq(meetingInstances.state, 'scheduled'),
          gte(meetingInstances.localDate, local?.localDate ?? '0000-01-01')
        )
      )
      .orderBy(asc(meetingInstances.localDate), asc(meetingInstances.startTime))
      .limit(1);
    relevant ??= upcoming ?? null;
    const [historyLesson] = relevant
      ? await db
          .select({ activeLessonId: meetingHistory.activeLessonId })
          .from(meetingHistory)
          .where(eq(meetingHistory.meetingInstanceId, relevant.id))
          .limit(1)
      : [];
    const [allocation] = relevant
      ? await db
          .select({ lessonId: planAllocations.lessonId })
          .from(planAllocations)
          .where(eq(planAllocations.meetingInstanceId, relevant.id))
          .orderBy(asc(planAllocations.orderIndex))
          .limit(1)
      : [];
    const [progress] = await db
      .select({
        lessonId: classGroupLessonProgress.lessonId,
        status: classGroupLessonProgress.status
      })
      .from(classGroupLessonProgress)
      .where(
        and(
          eq(classGroupLessonProgress.classGroupId, selectedGroupId),
          eq(classGroupLessonProgress.status, 'in_progress')
        )
      )
      .limit(1);
    const lessonId =
      historyLesson?.activeLessonId ?? allocation?.lessonId ?? progress?.lessonId ?? null;
    const [lesson] = lessonId
      ? await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1)
      : [];
    const steps = lesson
      ? await db
          .select()
          .from(lessonSteps)
          .where(eq(lessonSteps.lessonId, lesson.id))
          .orderBy(asc(lessonSteps.orderIndex))
      : [];
    const statuses = steps.length
      ? await db
          .select({
            lessonStepId: classGroupLessonStepProgress.lessonStepId,
            status: classGroupLessonStepProgress.status
          })
          .from(classGroupLessonStepProgress)
          .where(
            and(
              eq(classGroupLessonStepProgress.classGroupId, selectedGroupId),
              inArray(
                classGroupLessonStepProgress.lessonStepId,
                steps.map((step) => step.id)
              )
            )
          )
      : [];
    selected = {
      classGroupId: selectedGroupId,
      meeting: relevant ? toMeetingInstance(relevant) : null,
      currentLesson: lesson
        ? {
            id: lesson.id,
            unitId: lesson.unitId,
            title: lesson.title,
            description: lesson.description,
            estimatedDurationMinutes: lesson.estimatedDurationMinutes,
            estimatedMeetings: lesson.estimatedMeetings,
            orderIndex: lesson.orderIndex,
            steps: steps.map((step) => ({
              id: step.id,
              title: step.title,
              description: step.description,
              estimatedMinutes: step.estimatedMinutes,
              isOptional: step.isOptional,
              orderIndex: step.orderIndex
            }))
          }
        : null,
      lessonStatus: progress?.status ?? null,
      stepStatuses: Object.fromEntries(
        statuses.map((status) => [status.lessonStepId, status.status])
      ),
      upcomingMeeting: upcoming ? toMeetingInstance(upcoming) : null
    };
  }
  return {
    now: now.toISOString(),
    timezone,
    activeClassGroupId: active?.classGroupId ?? null,
    activeMeeting: active ? toMeetingInstance(active) : null,
    classGroups: groupRows,
    selected
  };
}

export async function saveLessonProgress(
  userId: string,
  classGroupId: string,
  input: ClassroomProgressInput
) {
  const group = await assertOwnedClassGroup(userId, classGroupId);
  const [lesson] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(and(eq(lessons.id, input.lessonId), eq(units.courseId, group.courseId)))
    .limit(1);
  if (!lesson) throw new Error('Lesson is not part of this Class Group’s Course.');
  if (input.meetingInstanceId) {
    const [meeting] = await db
      .select({ id: meetingInstances.id })
      .from(meetingInstances)
      .where(
        and(
          eq(meetingInstances.id, input.meetingInstanceId),
          eq(meetingInstances.classGroupId, classGroupId)
        )
      )
      .limit(1);
    if (!meeting) throw new Error('Meeting is not part of this Class Group.');
  }
  const [existing] = await db
    .select({
      startedAt: classGroupLessonProgress.startedAt,
      actualStartMeetingId: classGroupLessonProgress.actualStartMeetingId
    })
    .from(classGroupLessonProgress)
    .where(
      and(
        eq(classGroupLessonProgress.classGroupId, classGroupId),
        eq(classGroupLessonProgress.lessonId, input.lessonId)
      )
    )
    .limit(1);
  const now = new Date();
  const values = {
    classGroupId,
    lessonId: input.lessonId,
    status: input.status,
    manualOverride: input.manualOverride,
    notes: input.notes,
    actualStartMeetingId:
      input.status === 'not_started'
        ? null
        : (existing?.actualStartMeetingId ?? input.meetingInstanceId),
    actualCompletionMeetingId:
      input.status === 'completed' || input.status === 'skipped' ? input.meetingInstanceId : null,
    startedAt: input.status === 'not_started' ? null : (existing?.startedAt ?? now),
    completedAt: input.status === 'completed' ? now : null,
    skippedAt: input.status === 'skipped' ? now : null,
    updatedAt: now
  };
  const [result] = await db
    .insert(classGroupLessonProgress)
    .values(values)
    .onConflictDoUpdate({
      target: [classGroupLessonProgress.classGroupId, classGroupLessonProgress.lessonId],
      set: values
    })
    .returning();
  if (input.meetingInstanceId && input.status !== 'not_started') {
    await db
      .insert(meetingHistory)
      .values({
        meetingInstanceId: input.meetingInstanceId,
        classGroupId,
        activeLessonId: input.lessonId,
        startedAt: input.status === 'in_progress' ? now : null,
        endedAt: input.status === 'completed' || input.status === 'skipped' ? now : null
      })
      .onConflictDoUpdate({
        target: meetingHistory.meetingInstanceId,
        set: {
          activeLessonId: input.lessonId,
          endedAt: input.status === 'completed' || input.status === 'skipped' ? now : null,
          updatedAt: now
        }
      });
  }
  return result;
}
