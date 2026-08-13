import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AiJobControlResponseSchema,
  AiJobEnqueueResponseSchema,
  AiJobStatusResponseSchema,
  AnnualCalendarProposalSchema,
  AcademicCalendarParseRequestSchema,
  AcademicCalendarParseResponseSchema,
  ClassroomCheckinResolveRequestSchema,
  ClassroomCheckinResolveResponseSchema,
  ClassroomCheckinResponseSchema,
  ClassNotesUpsertRequestSchema,
  ClassNotesUpsertResponseSchema,
  CreateUploadUrlRequestSchema,
  CreateUploadUrlResponseSchema,
  CourseCreateRequestSchema,
  CourseDetailResponseSchema,
  CoursePacingPlanUpsertRequestSchema,
  CourseListResponseSchema,
  CourseUpdateRequestSchema,
  DashboardTodayResponseSchema,
  DeleteEntityResponseSchema,
  GenerateContinuityRequestSchema,
  GenerateContinuityResponseSchema,
  GenerateActivityRequestSchema,
  GenerateActivityResponseSchema,
  GenerateSegmentsRequestSchema,
  GenerateSegmentsResponseSchema,
  GenerateSemesterRequestSchema,
  GenerateSemesterResponseSchema,
  GetScheduleResponseSchema,
  HolidaysUpsertRequestSchema,
  HolidaysUpsertResponseSchema,
  LessonProgressUpsertRequestSchema,
  LessonProgressUpsertResponseSchema,
  OnboardingRequestSchema,
  OnboardingResponseSchema,
  ParseScheduleResponseSchema,
  SegmentCreateRequestSchema,
  SegmentUpdateRequestSchema,
  ScheduleImportRequestSchema,
  ScheduleImportResponseSchema,
  ScheduleDateOverrideKindSchema,
  ScheduleDateOverrideMeetingSchema,
  ScheduleSetupApplyRequestSchema,
  ScheduleSetupApplyResponseSchema,
  ScheduleSetupSourceSchema,
  WeeklyScheduleProposalSchema,
  TeachingDataImportApplyRequestSchema,
  TeachingDataImportApplyResponseSchema,
  UnitCreateRequestSchema,
  UnitUpdateRequestSchema,
  LessonCreateRequestSchema,
  LessonReorderRequestSchema,
  LessonMaterialCreateRequestSchema,
  LessonUpdateRequestSchema,
  TeacherNoteCreateRequestSchema,
  TeacherNoteSchema,
  TeacherNotesResponseSchema,
  TeacherNoteUpdateRequestSchema,
  UuidSchema
} from '@teacheros/contracts';
import {
  aiJobs,
  aiOutputs,
  classNotes,
  coursePacingPlans,
  courses,
  db,
  lessonSteps,
  lessonMaterials,
  lessons,
  schoolHolidays,
  scheduleBlocks,
  scheduleDateOverrideMeetings,
  scheduleDateOverrides,
  sectionLessonState,
  sectionSessionEvents,
  sectionMeetings,
  sections,
  teacherProfiles,
  teacherNotes,
  teacherScheduleTemplates,
  units
} from '@teacheros/db';

import { runStructuredPrompt } from '../lib/openai.js';
import { safeRedisGet, safeRedisSet } from '../lib/redis.js';
import { createS3Client, createSignedUploadUrl } from '../lib/s3.js';
import { AI_JOB_MAX_ATTEMPTS, enqueueAiJob } from '../lib/queue.js';
import { ensureUserFromPrincipal, upsertOnboarding } from '../services/user-service.js';

const InternalParseScheduleSchema = z.object({
  classes: z.array(
    z.object({
      name: z.string(),
      period: z.string(),
      days: z.array(z.string()),
      time: z.string().nullable(),
      endTime: z.string().nullable(),
      room: z.string().nullable(),
      subject: z.string(),
      grade: z.string().default('')
    })
  ),
  assignments: z.array(
    z.object({
      name: z.string(),
      courseName: z.string(),
      dueDate: z.string().nullable(),
      description: z.string().nullable()
    })
  )
});

const ParseWeeklyScheduleSchema = WeeklyScheduleProposalSchema;
const ParseAnnualCalendarSchema = AnnualCalendarProposalSchema;

function requirePrincipal(request: FastifyRequest, reply: FastifyReply) {
  if (!request.principal) {
    reply.code(401).send({ error: 'Unauthorized', requestId: request.id });
    return null;
  }
  return request.principal;
}

function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function timeToMinutes(meetingTime: string | null): number | null {
  if (!meetingTime) return null;
  const parts = meetingTime.split(':');
  const hours = Number(parts[0] ?? Number.NaN);
  const minutes = Number(parts[1] ?? Number.NaN);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function normalizeImportedTime(value: string | null): string | null {
  if (!value) return value;
  const match = value.match(/(\d{1,2}):(\d{2})(?:\s*(a\.?m\.?|p\.?m\.?)\b)?/i);
  if (!match) return value;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return value;

  const meridiem = match[3]?.replaceAll('.', '').toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return value;
    if (meridiem === 'am') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return value;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeImportedScheduleTimes(response: z.infer<typeof InternalParseScheduleSchema>) {
  return {
    ...response,
    classes: response.classes.map((item) => ({
      ...item,
      time: normalizeImportedTime(item.time),
      endTime: normalizeImportedTime(item.endTime)
    }))
  };
}

function isInSession(meetingTime: string | null, meetingEndTime: string | null): boolean {
  const startMinutes = timeToMinutes(meetingTime);
  if (startMinutes === null) return false;
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (
    nowMinutes >= startMinutes && nowMinutes <= (timeToMinutes(meetingEndTime) ?? startMinutes + 55)
  );
}

function dateDaysAgo(daysAgo: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}

function hasMeetingPassed(
  meetingTime: string | null,
  meetingEndTime: string | null,
  date: Date,
  today: string
): boolean {
  const isoDate = dateToIso(date);
  if (isoDate < today) return true;
  if (isoDate > today || !meetingTime) return false;

  const startMinutes = timeToMinutes(meetingTime);
  if (startMinutes === null) return false;
  const now = new Date();
  return (
    now.getUTCHours() * 60 + now.getUTCMinutes() >
    (timeToMinutes(meetingEndTime) ?? startMinutes + 55)
  );
}

async function loadActiveScheduleTemplate(userId: string) {
  const [template] = await db
    .select({ id: teacherScheduleTemplates.id })
    .from(teacherScheduleTemplates)
    .where(
      and(
        eq(teacherScheduleTemplates.teacherId, userId),
        eq(teacherScheduleTemplates.isActive, true)
      )
    )
    .orderBy(desc(teacherScheduleTemplates.updatedAt))
    .limit(1);
  return template ?? null;
}

async function loadTeacherSchoolId(userId: string): Promise<string> {
  const [profile] = await db
    .select({ schoolId: teacherProfiles.schoolId })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    throw new Error('Teacher profile not found. Complete onboarding first.');
  }
  return profile.schoolId;
}

const CourseParamsSchema = z.object({ courseId: UuidSchema });
const UnitParamsSchema = z.object({ unitId: UuidSchema });
const LessonParamsSchema = z.object({ lessonId: UuidSchema });
const SegmentParamsSchema = z.object({ segmentId: UuidSchema });
const MaterialParamsSchema = z.object({ materialId: UuidSchema });
const TeacherNoteParamsSchema = z.object({ noteId: UuidSchema });
const AiJobParamsSchema = z.object({ jobId: UuidSchema });

async function findOwnedCourse(userId: string, courseId: string) {
  const [course] = await db
    .select({
      id: courses.id,
      name: courses.name,
      subject: courses.subject,
      gradeLevel: courses.gradeLevel,
      createdAt: courses.createdAt
    })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, userId)))
    .limit(1);
  return course ?? null;
}

async function findOwnedCourseIdForUnit(userId: string, unitId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(units)
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(units.id, unitId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedCourseIdForLesson(userId: string, lessonId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(lessons.id, lessonId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedCourseIdForSegment(userId: string, segmentId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(lessonSteps)
    .innerJoin(lessons, eq(lessonSteps.lessonId, lessons.id))
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(lessonSteps.id, segmentId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function findOwnedCourseIdForMaterial(userId: string, materialId: string) {
  const [row] = await db
    .select({
      courseId: units.courseId
    })
    .from(lessonMaterials)
    .innerJoin(lessons, eq(lessonMaterials.lessonId, lessons.id))
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(lessonMaterials.id, materialId), eq(courses.teacherId, userId)))
    .limit(1);

  return row?.courseId ?? null;
}

async function buildCourseDetail(userId: string, courseId: string) {
  const course = await findOwnedCourse(userId, courseId);
  if (!course) return null;

  const [pacingPlan] = await db
    .select({
      courseId: coursePacingPlans.courseId,
      startDate: coursePacingPlans.startDate,
      weeks: coursePacingPlans.weeks,
      meetingsPerWeek: coursePacingPlans.meetingsPerWeek,
      plannedClassPeriods: coursePacingPlans.plannedClassPeriods,
      classPeriodMinutes: coursePacingPlans.classPeriodMinutes,
      notes: coursePacingPlans.notes,
      updatedAt: coursePacingPlans.updatedAt
    })
    .from(coursePacingPlans)
    .where(eq(coursePacingPlans.courseId, courseId))
    .limit(1);

  const unitRows = await db
    .select({
      id: units.id,
      title: units.title,
      description: units.description,
      orderIndex: units.orderIndex
    })
    .from(units)
    .where(eq(units.courseId, courseId))
    .orderBy(asc(units.orderIndex), asc(units.createdAt));

  const unitIds = unitRows.map((unit) => unit.id);
  const lessonRows =
    unitIds.length > 0
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
          .orderBy(asc(lessons.orderIndex), asc(lessons.createdAt))
      : [];

  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const segmentRows =
    lessonIds.length > 0
      ? await db
          .select({
            id: lessonSteps.id,
            lessonId: lessonSteps.lessonId,
            title: lessonSteps.title,
            description: lessonSteps.description,
            durationMinutes: lessonSteps.estimatedMinutes,
            orderIndex: lessonSteps.orderIndex
          })
          .from(lessonSteps)
          .where(inArray(lessonSteps.lessonId, lessonIds))
          .orderBy(asc(lessonSteps.orderIndex), asc(lessonSteps.createdAt))
      : [];

  const materialRows =
    lessonIds.length > 0
      ? await db
          .select({
            id: lessonMaterials.id,
            lessonId: lessonMaterials.lessonId,
            label: lessonMaterials.label,
            url: lessonMaterials.url,
            kind: lessonMaterials.kind,
            createdAt: lessonMaterials.createdAt
          })
          .from(lessonMaterials)
          .where(inArray(lessonMaterials.lessonId, lessonIds))
          .orderBy(desc(lessonMaterials.createdAt))
      : [];

  const segmentsByLessonId = new Map<string, typeof segmentRows>();
  segmentRows.forEach((segment) => {
    const existing = segmentsByLessonId.get(segment.lessonId);
    if (existing) {
      existing.push(segment);
      return;
    }
    segmentsByLessonId.set(segment.lessonId, [segment]);
  });

  const lessonsByUnitId = new Map<string, typeof lessonRows>();
  lessonRows.forEach((lesson) => {
    const existing = lessonsByUnitId.get(lesson.unitId);
    if (existing) {
      existing.push(lesson);
      return;
    }
    lessonsByUnitId.set(lesson.unitId, [lesson]);
  });

  const materialsByLessonId = new Map<string, typeof materialRows>();
  materialRows.forEach((material) => {
    const existing = materialsByLessonId.get(material.lessonId);
    if (existing) {
      existing.push(material);
      return;
    }
    materialsByLessonId.set(material.lessonId, [material]);
  });

  return CourseDetailResponseSchema.parse({
    course: {
      id: course.id,
      name: course.name,
      subject: course.subject,
      gradeLevel: course.gradeLevel,
      createdAt: course.createdAt.toISOString(),
      pacingPlan: pacingPlan
        ? {
            courseId: pacingPlan.courseId,
            startDate: pacingPlan.startDate,
            weeks: pacingPlan.weeks,
            meetingsPerWeek: pacingPlan.meetingsPerWeek,
            plannedClassPeriods: pacingPlan.plannedClassPeriods,
            classPeriodMinutes: pacingPlan.classPeriodMinutes,
            notes: pacingPlan.notes,
            updatedAt: pacingPlan.updatedAt.toISOString()
          }
        : null,
      units: unitRows.map((unit) => ({
        id: unit.id,
        title: unit.title,
        description: unit.description,
        orderIndex: unit.orderIndex,
        lessons: (lessonsByUnitId.get(unit.id) ?? []).map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          orderIndex: lesson.orderIndex,
          estimatedDurationMinutes: lesson.estimatedDurationMinutes,
          estimatedMeetings: lesson.estimatedMeetings,
          materials: (materialsByLessonId.get(lesson.id) ?? []).map((material) => ({
            id: material.id,
            label: material.label,
            url: material.url,
            kind: material.kind,
            createdAt: material.createdAt.toISOString()
          })),
          segments: (segmentsByLessonId.get(lesson.id) ?? []).map((segment) => ({
            id: segment.id,
            title: segment.title,
            description: segment.description,
            durationMinutes: segment.durationMinutes,
            orderIndex: segment.orderIndex
          }))
        }))
      }))
    }
  });
}

function normalizeProgressPercent(progress: unknown): number | null {
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  if (
    typeof progress === 'object' &&
    progress !== null &&
    'percent' in progress &&
    typeof progress.percent === 'number' &&
    Number.isFinite(progress.percent)
  ) {
    return Math.max(0, Math.min(100, Math.round(progress.percent)));
  }

  return null;
}

export async function v1Routes(app: FastifyInstance) {
  app.post(
    '/v1/onboarding',
    {
      schema: {
        body: OnboardingRequestSchema,
        response: {
          200: OnboardingResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = OnboardingRequestSchema.parse(request.body);
      const result = await upsertOnboarding(principal, body);
      return {
        userId: result.userId,
        schoolId: result.schoolId,
        onboarded: true
      };
    }
  );

  app.get(
    '/v1/dashboard/today',
    {
      schema: {
        response: {
          200: DashboardTodayResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const user = await ensureUserFromPrincipal(principal);
      const date = new Date();
      const isoDate = dateToIso(date);
      const cacheKey = `dashboard:today:${user.id}:${isoDate}`;

      const cached = await safeRedisGet(app.redis, cacheKey);
      if (cached) {
        return JSON.parse(cached) as unknown;
      }

      const weekday = dayName(date);
      const schoolId = await loadTeacherSchoolId(user.id);
      const [activeTemplate, dateOverride] = await Promise.all([
        loadActiveScheduleTemplate(user.id),
        db
          .select({
            id: scheduleDateOverrides.id,
            label: scheduleDateOverrides.label,
            kind: scheduleDateOverrides.kind,
            rotationDay: scheduleDateOverrides.rotationDay,
            replaceWeeklySchedule: scheduleDateOverrides.replaceWeeklySchedule
          })
          .from(scheduleDateOverrides)
          .where(
            and(
              eq(scheduleDateOverrides.teacherId, user.id),
              eq(scheduleDateOverrides.date, isoDate)
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      ]);

      const effectiveDay = dateOverride?.rotationDay ?? weekday;
      const useOverrideMeetings = Boolean(dateOverride?.replaceWeeklySchedule);
      const rows =
        dateOverride?.kind === 'no_school'
          ? []
          : useOverrideMeetings
            ? await db
                .select({
                  sectionId: sections.id,
                  sectionName: sections.name,
                  courseName: courses.name,
                  meetingTime: scheduleDateOverrideMeetings.meetingTime,
                  meetingEndTime: scheduleDateOverrideMeetings.meetingEndTime,
                  room: scheduleDateOverrideMeetings.room
                })
                .from(scheduleDateOverrideMeetings)
                .innerJoin(
                  scheduleDateOverrides,
                  eq(scheduleDateOverrideMeetings.scheduleDateOverrideId, scheduleDateOverrides.id)
                )
                .innerJoin(sections, eq(scheduleDateOverrideMeetings.sectionId, sections.id))
                .innerJoin(courses, eq(sections.courseId, courses.id))
                .where(eq(scheduleDateOverrides.id, dateOverride!.id))
                .orderBy(asc(scheduleDateOverrideMeetings.meetingTime))
            : await db
                .select({
                  sectionId: sections.id,
                  sectionName: sections.name,
                  courseName: courses.name,
                  meetingTime: sectionMeetings.meetingTime,
                  meetingEndTime: sectionMeetings.meetingEndTime,
                  room: sectionMeetings.room
                })
                .from(sections)
                .innerJoin(courses, eq(sections.courseId, courses.id))
                .innerJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
                .where(
                  and(
                    eq(courses.teacherId, user.id),
                    eq(sectionMeetings.day, effectiveDay),
                    activeTemplate
                      ? eq(sectionMeetings.scheduleTemplateId, activeTemplate.id)
                      : isNull(sectionMeetings.scheduleTemplateId)
                  )
                )
                .orderBy(asc(sectionMeetings.meetingTime));

      const [holiday] = await db
        .select({
          id: schoolHolidays.id,
          date: schoolHolidays.date,
          name: schoolHolidays.name
        })
        .from(schoolHolidays)
        .where(and(eq(schoolHolidays.schoolId, schoolId), eq(schoolHolidays.date, isoDate)))
        .limit(1);

      const todaySchedule = rows.map((row) => ({
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        courseName: row.courseName,
        meetingTime: row.meetingTime ? row.meetingTime.slice(0, 5) : null,
        meetingEndTime: row.meetingEndTime ? row.meetingEndTime.slice(0, 5) : null,
        room: row.room,
        isInSession: isInSession(
          row.meetingTime ? row.meetingTime.slice(0, 5) : null,
          row.meetingEndTime ? row.meetingEndTime.slice(0, 5) : null
        )
      }));

      const nowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      const withMinutes = todaySchedule.map((entry) => ({
        ...entry,
        startMinutes: timeToMinutes(entry.meetingTime) ?? Number.MAX_SAFE_INTEGER,
        endMinutes: timeToMinutes(entry.meetingEndTime)
      }));

      const currentClass = withMinutes.find(
        (entry) =>
          nowMinutes >= entry.startMinutes &&
          nowMinutes <= (entry.endMinutes ?? entry.startMinutes + 55)
      );
      const nextClass = withMinutes.find((entry) => entry.startMinutes > nowMinutes);

      const response = {
        date: isoDate,
        currentClass: currentClass
          ? {
              sectionId: currentClass.sectionId,
              courseName: currentClass.courseName,
              sectionName: currentClass.sectionName,
              meetingTime: currentClass.meetingTime,
              meetingEndTime: currentClass.meetingEndTime,
              room: currentClass.room
            }
          : null,
        nextClass: nextClass
          ? {
              sectionId: nextClass.sectionId,
              courseName: nextClass.courseName,
              sectionName: nextClass.sectionName,
              meetingTime: nextClass.meetingTime,
              meetingEndTime: nextClass.meetingEndTime
            }
          : null,
        todaySchedule: todaySchedule.map(
          ({
            sectionId,
            courseName,
            sectionName,
            meetingTime,
            meetingEndTime,
            room,
            isInSession: inSession
          }) => ({
            sectionId,
            courseName,
            sectionName,
            meetingTime,
            meetingEndTime,
            room,
            isInSession: inSession
          })
        ),
        holiday:
          dateOverride?.kind === 'no_school'
            ? { id: dateOverride.id, date: isoDate, name: dateOverride.label }
            : holiday
              ? {
                  id: holiday.id,
                  date: holiday.date,
                  name: holiday.name
                }
              : null,
        specialDay:
          dateOverride && dateOverride.kind !== 'no_school'
            ? {
                label: dateOverride.label,
                kind: dateOverride.kind as z.infer<typeof ScheduleDateOverrideKindSchema>
              }
            : null,
        // A dashboard cannot be ready until the teacher has an active imported schedule.
        // `rows` only represents the current day, so it is empty on weekends, holidays,
        // and days without a class even when a schedule has already been imported.
        needsScheduleSetup: !activeTemplate
      };

      await safeRedisSet(app.redis, cacheKey, JSON.stringify(response), 30);
      return response;
    }
  );

  app.get(
    '/v1/classroom/check-in',
    {
      schema: { response: { 200: ClassroomCheckinResponseSchema } }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const today = dateToIso(new Date());
      const earliestDate = dateToIso(dateDaysAgo(14));
      const schoolId = await loadTeacherSchoolId(user.id);
      const activeTemplate = await loadActiveScheduleTemplate(user.id);

      const meetings = await db
        .select({
          sectionId: sections.id,
          sectionName: sections.name,
          courseName: courses.name,
          day: sectionMeetings.day,
          meetingTime: sectionMeetings.meetingTime,
          meetingEndTime: sectionMeetings.meetingEndTime
        })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .innerJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(
          and(
            eq(courses.teacherId, user.id),
            activeTemplate
              ? eq(sectionMeetings.scheduleTemplateId, activeTemplate.id)
              : isNull(sectionMeetings.scheduleTemplateId)
          )
        );

      if (!meetings.length) return { pendingSessions: [] };

      const [holidayRows, eventRows, noteRows, progressRows] = await Promise.all([
        db
          .select({ date: schoolHolidays.date })
          .from(schoolHolidays)
          .where(
            and(
              eq(schoolHolidays.schoolId, schoolId),
              gte(schoolHolidays.date, earliestDate),
              lte(schoolHolidays.date, today)
            )
          ),
        db
          .select({
            sectionId: sectionSessionEvents.sectionId,
            sessionDate: sectionSessionEvents.sessionDate
          })
          .from(sectionSessionEvents)
          .where(
            inArray(sectionSessionEvents.sectionId, [
              ...new Set(meetings.map((meeting) => meeting.sectionId))
            ])
          ),
        db
          .select({ sectionId: classNotes.sectionId, sessionDate: classNotes.date })
          .from(classNotes)
          .where(
            and(
              eq(classNotes.userId, user.id),
              gte(classNotes.date, earliestDate),
              lte(classNotes.date, today)
            )
          ),
        db
          .select({
            sectionId: sectionLessonState.sectionId,
            sessionDate: sectionLessonState.lastTaughtDate
          })
          .from(sectionLessonState)
          .innerJoin(sections, eq(sectionLessonState.sectionId, sections.id))
          .innerJoin(courses, eq(sections.courseId, courses.id))
          .where(
            and(
              eq(courses.teacherId, user.id),
              gte(sectionLessonState.lastTaughtDate, earliestDate),
              lte(sectionLessonState.lastTaughtDate, today)
            )
          )
      ]);

      const overrideRows = await db
        .select({
          date: scheduleDateOverrides.date,
          kind: scheduleDateOverrides.kind,
          rotationDay: scheduleDateOverrides.rotationDay,
          replaceWeeklySchedule: scheduleDateOverrides.replaceWeeklySchedule
        })
        .from(scheduleDateOverrides)
        .where(
          and(
            eq(scheduleDateOverrides.teacherId, user.id),
            gte(scheduleDateOverrides.date, earliestDate),
            lte(scheduleDateOverrides.date, today)
          )
        );

      const holidays = new Set(holidayRows.map((holiday) => String(holiday.date)));
      const overridesByDate = new Map(
        overrideRows.map((override) => [String(override.date), override])
      );
      const resolvedSessions = new Set(
        [...eventRows, ...noteRows, ...progressRows].map(
          (event) => `${event.sectionId}:${String(event.sessionDate)}`
        )
      );
      const pendingSessions: Array<{
        sectionId: string;
        sessionDate: string;
        courseName: string;
        sectionName: string;
        meetingTime: string | null;
      }> = [];

      for (let daysAgo = 0; daysAgo <= 14; daysAgo += 1) {
        const date = dateDaysAgo(daysAgo);
        const sessionDate = dateToIso(date);
        if (holidays.has(sessionDate)) continue;
        const override = overridesByDate.get(sessionDate);
        if (override?.kind === 'no_school' || override?.replaceWeeklySchedule) continue;
        const weekday = override?.rotationDay ?? dayName(date);

        for (const meeting of meetings) {
          if (
            meeting.day !== weekday ||
            !hasMeetingPassed(meeting.meetingTime, meeting.meetingEndTime, date, today)
          )
            continue;
          if (resolvedSessions.has(`${meeting.sectionId}:${sessionDate}`)) continue;
          pendingSessions.push({
            sectionId: meeting.sectionId,
            sessionDate,
            courseName: meeting.courseName,
            sectionName: meeting.sectionName,
            meetingTime: meeting.meetingTime ? meeting.meetingTime.slice(0, 5) : null
          });
        }
      }

      return { pendingSessions: pendingSessions.slice(0, 5) };
    }
  );

  app.post(
    '/v1/classroom/check-in',
    {
      schema: {
        body: ClassroomCheckinResolveRequestSchema,
        response: { 200: ClassroomCheckinResolveResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = ClassroomCheckinResolveRequestSchema.parse(request.body);

      const [ownedSection] = await db
        .select({ id: sections.id })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .where(and(eq(sections.id, body.sectionId), eq(courses.teacherId, user.id)))
        .limit(1);
      if (!ownedSection) {
        (reply as any).code(404);
        return { error: 'Section not found', requestId: request.id };
      }

      const [event] = await db
        .insert(sectionSessionEvents)
        .values({
          sectionId: body.sectionId,
          userId: user.id,
          sessionDate: body.sessionDate,
          outcome: body.outcome,
          coveredPlannedLesson: body.coveredPlannedLesson,
          note: body.note
        })
        .onConflictDoUpdate({
          target: [sectionSessionEvents.sectionId, sectionSessionEvents.sessionDate],
          set: {
            outcome: body.outcome,
            coveredPlannedLesson: body.coveredPlannedLesson,
            note: body.note,
            updatedAt: new Date()
          }
        })
        .returning({ id: sectionSessionEvents.id });
      if (!event) throw new Error('Failed to save classroom check-in');

      const carryForward = body.outcome !== 'taught' && !body.coveredPlannedLesson;
      return {
        eventId: event.id,
        carryForward,
        message: carryForward
          ? 'Your next planned lesson stays next, so the remaining sequence rolls forward.'
          : 'This class is marked as covered, so your lesson sequence can continue as planned.'
      };
    }
  );

  app.get(
    '/v1/schedule',
    {
      schema: {
        response: {
          200: GetScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const activeTemplate = await loadActiveScheduleTemplate(user.id);

      const rows = await db
        .select({
          sectionId: sections.id,
          sectionName: sections.name,
          courseId: courses.id,
          courseName: courses.name,
          day: sectionMeetings.day,
          meetingTime: sectionMeetings.meetingTime,
          meetingEndTime: sectionMeetings.meetingEndTime,
          room: sectionMeetings.room
        })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(
          and(
            eq(courses.teacherId, user.id),
            activeTemplate
              ? eq(sectionMeetings.scheduleTemplateId, activeTemplate.id)
              : isNull(sectionMeetings.scheduleTemplateId)
          )
        );

      const holidayRows = await db
        .select({
          id: schoolHolidays.id,
          date: schoolHolidays.date,
          name: schoolHolidays.name
        })
        .from(schoolHolidays)
        .where(eq(schoolHolidays.schoolId, schoolId))
        .orderBy(asc(schoolHolidays.date));

      const [blockRows, overrideRows, overrideMeetingRows] = await Promise.all([
        activeTemplate
          ? db
              .select({
                day: scheduleBlocks.day,
                startTime: scheduleBlocks.startTime,
                endTime: scheduleBlocks.endTime,
                label: scheduleBlocks.label,
                kind: scheduleBlocks.kind
              })
              .from(scheduleBlocks)
              .where(eq(scheduleBlocks.scheduleTemplateId, activeTemplate.id))
              .orderBy(asc(scheduleBlocks.startTime))
          : Promise.resolve([]),
        db
          .select({
            id: scheduleDateOverrides.id,
            date: scheduleDateOverrides.date,
            label: scheduleDateOverrides.label,
            kind: scheduleDateOverrides.kind,
            rotationDay: scheduleDateOverrides.rotationDay,
            replaceWeeklySchedule: scheduleDateOverrides.replaceWeeklySchedule
          })
          .from(scheduleDateOverrides)
          .where(eq(scheduleDateOverrides.teacherId, user.id))
          .orderBy(asc(scheduleDateOverrides.date)),
        db
          .select({
            overrideId: scheduleDateOverrides.id,
            courseName: courses.name,
            sectionName: sections.name,
            meetingTime: scheduleDateOverrideMeetings.meetingTime,
            meetingEndTime: scheduleDateOverrideMeetings.meetingEndTime,
            room: scheduleDateOverrideMeetings.room
          })
          .from(scheduleDateOverrideMeetings)
          .innerJoin(
            scheduleDateOverrides,
            eq(scheduleDateOverrideMeetings.scheduleDateOverrideId, scheduleDateOverrides.id)
          )
          .innerJoin(sections, eq(scheduleDateOverrideMeetings.sectionId, sections.id))
          .innerJoin(courses, eq(sections.courseId, courses.id))
          .where(eq(scheduleDateOverrides.teacherId, user.id))
      ]);

      const bySection = new Map<
        string,
        {
          sectionId: string;
          courseId: string;
          courseName: string;
          sectionName: string;
          meetings: Array<{
            day: string;
            time: string | null;
            endTime: string | null;
            room: string | null;
          }>;
        }
      >();

      rows.forEach((row) => {
        if (!bySection.has(row.sectionId)) {
          bySection.set(row.sectionId, {
            sectionId: row.sectionId,
            courseId: row.courseId,
            courseName: row.courseName,
            sectionName: row.sectionName,
            meetings: []
          });
        }

        if (row.day) {
          bySection.get(row.sectionId)?.meetings.push({
            day: row.day,
            time: row.meetingTime ? row.meetingTime.slice(0, 5) : null,
            endTime: row.meetingEndTime ? row.meetingEndTime.slice(0, 5) : null,
            room: row.room
          });
        }
      });

      const meetingsByOverride = new Map<
        string,
        Array<z.infer<typeof ScheduleDateOverrideMeetingSchema>>
      >();
      for (const meeting of overrideMeetingRows) {
        const values = meetingsByOverride.get(meeting.overrideId) ?? [];
        values.push({
          courseName: meeting.courseName,
          sectionName: meeting.sectionName,
          startTime: meeting.meetingTime ? meeting.meetingTime.slice(0, 5) : null,
          endTime: meeting.meetingEndTime ? meeting.meetingEndTime.slice(0, 5) : null,
          room: meeting.room
        });
        meetingsByOverride.set(meeting.overrideId, values);
      }

      return {
        sections: Array.from(bySection.values()),
        holidays: holidayRows.map((row) => ({ id: row.id, date: row.date, name: row.name })),
        blocks: blockRows.map((block) => ({
          day: block.day,
          startTime: block.startTime ? block.startTime.slice(0, 5) : null,
          endTime: block.endTime ? block.endTime.slice(0, 5) : null,
          label: block.label,
          kind: block.kind
        })),
        overrides: overrideRows.map((override) => ({
          date: override.date,
          label: override.label,
          kind: override.kind,
          rotationDay: override.rotationDay,
          replaceWeeklySchedule: override.replaceWeeklySchedule,
          meetings: meetingsByOverride.get(override.id) ?? []
        })),
        hasScheduleSetup: Boolean(activeTemplate)
      };
    }
  );

  app.get(
    '/v1/courses',
    {
      schema: {
        response: {
          200: CourseListResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);

      const courseRows = await db
        .select({
          id: courses.id,
          name: courses.name,
          subject: courses.subject,
          gradeLevel: courses.gradeLevel,
          createdAt: courses.createdAt
        })
        .from(courses)
        .where(eq(courses.teacherId, user.id))
        .orderBy(desc(courses.createdAt));

      return {
        courses: courseRows.map((course) => ({
          id: course.id,
          name: course.name,
          subject: course.subject,
          gradeLevel: course.gradeLevel,
          createdAt: course.createdAt.toISOString()
        }))
      };
    }
  );

  app.post(
    '/v1/courses',
    {
      schema: {
        body: CourseCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const body = CourseCreateRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);

      const [course] = await db
        .insert(courses)
        .values({
          teacherId: user.id,
          schoolId,
          name: body.name,
          subject: body.subject,
          gradeLevel: body.gradeLevel
        })
        .returning({ id: courses.id });

      if (!course) throw new Error('Failed to create course');

      const detail = await buildCourseDetail(user.id, course.id);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.get(
    '/v1/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }
      return detail;
    }
  );

  app.patch(
    '/v1/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        body: CourseUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);
      const body = CourseUpdateRequestSchema.parse(request.body);

      const updates: Partial<typeof courses.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.subject !== undefined) updates.subject = body.subject;
      if (body.gradeLevel !== undefined) updates.gradeLevel = body.gradeLevel;

      const [updated] = await db
        .update(courses)
        .set(updates)
        .where(and(eq(courses.id, params.courseId), eq(courses.teacherId, user.id)))
        .returning({ id: courses.id });

      if (!updated) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.put(
    '/v1/courses/:courseId/pacing-plan',
    {
      schema: {
        params: CourseParamsSchema,
        body: CoursePacingPlanUpsertRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);
      const body = CoursePacingPlanUpsertRequestSchema.parse(request.body);

      const ownedCourse = await findOwnedCourse(user.id, params.courseId);
      if (!ownedCourse) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      await db
        .insert(coursePacingPlans)
        .values({
          courseId: params.courseId,
          startDate: body.startDate,
          weeks: body.weeks,
          meetingsPerWeek: body.meetingsPerWeek,
          plannedClassPeriods: body.plannedClassPeriods,
          classPeriodMinutes: body.classPeriodMinutes,
          notes: body.notes
        })
        .onConflictDoUpdate({
          target: coursePacingPlans.courseId,
          set: {
            startDate: body.startDate,
            weeks: body.weeks,
            meetingsPerWeek: body.meetingsPerWeek,
            plannedClassPeriods: body.plannedClassPeriods,
            classPeriodMinutes: body.classPeriodMinutes,
            notes: body.notes,
            updatedAt: new Date()
          }
        });

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/courses/:courseId',
    {
      schema: {
        params: CourseParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);

      const [deleted] = await db
        .delete(courses)
        .where(and(eq(courses.id, params.courseId), eq(courses.teacherId, user.id)))
        .returning({ id: courses.id });

      if (!deleted) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      return { deleted: true };
    }
  );

  app.post(
    '/v1/courses/:courseId/units',
    {
      schema: {
        params: CourseParamsSchema,
        body: UnitCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = CourseParamsSchema.parse(request.params);
      const body = UnitCreateRequestSchema.parse(request.body);

      const ownedCourse = await findOwnedCourse(user.id, params.courseId);
      if (!ownedCourse) {
        (reply as any).code(404);
        return { error: 'Course not found', requestId: request.id };
      }

      const [latestUnit] = await db
        .select({ orderIndex: units.orderIndex })
        .from(units)
        .where(eq(units.courseId, params.courseId))
        .orderBy(desc(units.orderIndex))
        .limit(1);

      await db.insert(units).values({
        courseId: params.courseId,
        title: body.title,
        description: body.description,
        orderIndex: body.orderIndex ?? (latestUnit?.orderIndex ?? -1) + 1
      });

      const detail = await buildCourseDetail(user.id, params.courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/units/:unitId',
    {
      schema: {
        params: UnitParamsSchema,
        body: UnitUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);
      const body = UnitUpdateRequestSchema.parse(request.body);

      const ownedCourseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!ownedCourseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      const updates: Partial<typeof units.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;

      await db.update(units).set(updates).where(eq(units.id, params.unitId));

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/units/:unitId',
    {
      schema: {
        params: UnitParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      await db.delete(units).where(eq(units.id, params.unitId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/units/:unitId/lessons',
    {
      schema: {
        params: UnitParamsSchema,
        body: LessonCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);
      const body = LessonCreateRequestSchema.parse(request.body);

      const courseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      const [latestLesson] = await db
        .select({ orderIndex: lessons.orderIndex })
        .from(lessons)
        .where(eq(lessons.unitId, params.unitId))
        .orderBy(desc(lessons.orderIndex))
        .limit(1);

      await db.insert(lessons).values({
        unitId: params.unitId,
        title: body.title,
        description: body.description,
        estimatedDurationMinutes: body.estimatedDurationMinutes,
        estimatedMeetings: body.estimatedMeetings,
        durationKind: body.durationKind,
        orderIndex: body.orderIndex ?? (latestLesson?.orderIndex ?? -1) + 1
      });

      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.put(
    '/v1/units/:unitId/lessons/order',
    {
      schema: {
        params: UnitParamsSchema,
        body: LessonReorderRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = UnitParamsSchema.parse(request.params);
      const body = LessonReorderRequestSchema.parse(request.body);

      const courseId = await findOwnedCourseIdForUnit(user.id, params.unitId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Unit not found', requestId: request.id };
      }

      const currentLessons = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.unitId, params.unitId));
      const currentIds = new Set(currentLessons.map((lesson) => lesson.id));
      const submittedIds = new Set(body.lessonIds);
      const isCompleteStack =
        body.lessonIds.length === currentIds.size &&
        submittedIds.size === currentIds.size &&
        [...submittedIds].every((id) => currentIds.has(id));

      if (!isCompleteStack) {
        (reply as any).code(400);
        return {
          error: 'Send every lesson in this unit exactly once when rearranging the stack.',
          requestId: request.id
        };
      }

      await db.transaction(async (transaction) => {
        for (const [orderIndex, lessonId] of body.lessonIds.entries()) {
          await transaction
            .update(lessons)
            .set({ orderIndex, updatedAt: new Date() })
            .where(and(eq(lessons.id, lessonId), eq(lessons.unitId, params.unitId)));
        }
      });

      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/lessons/:lessonId',
    {
      schema: {
        params: LessonParamsSchema,
        body: LessonUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);
      const body = LessonUpdateRequestSchema.parse(request.body);

      const ownedCourseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!ownedCourseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      const updates: Partial<typeof lessons.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.estimatedDurationMinutes !== undefined) {
        updates.estimatedDurationMinutes = body.estimatedDurationMinutes;
      }
      if (body.estimatedMeetings !== undefined) updates.estimatedMeetings = body.estimatedMeetings;
      if (body.durationKind !== undefined) updates.durationKind = body.durationKind;
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;

      await db.update(lessons).set(updates).where(eq(lessons.id, params.lessonId));

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/materials/:materialId',
    {
      schema: {
        params: MaterialParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = MaterialParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForMaterial(user.id, params.materialId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Material not found', requestId: request.id };
      }

      await db.delete(lessonMaterials).where(eq(lessonMaterials.id, params.materialId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/lessons/:lessonId/materials',
    {
      schema: {
        params: LessonParamsSchema,
        body: LessonMaterialCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);
      const body = LessonMaterialCreateRequestSchema.parse(request.body);

      const courseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      await db.insert(lessonMaterials).values({
        lessonId: params.lessonId,
        createdByUserId: user.id,
        label: body.label,
        url: body.url,
        kind: body.kind
      });

      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/lessons/:lessonId',
    {
      schema: {
        params: LessonParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      await db.delete(lessons).where(eq(lessons.id, params.lessonId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/lessons/:lessonId/segments',
    {
      schema: {
        params: LessonParamsSchema,
        body: SegmentCreateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = LessonParamsSchema.parse(request.params);
      const body = SegmentCreateRequestSchema.parse(request.body);

      const courseId = await findOwnedCourseIdForLesson(user.id, params.lessonId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Lesson not found', requestId: request.id };
      }

      const [latestSegment] = await db
        .select({ orderIndex: lessonSteps.orderIndex })
        .from(lessonSteps)
        .where(eq(lessonSteps.lessonId, params.lessonId))
        .orderBy(desc(lessonSteps.orderIndex))
        .limit(1);

      await db.insert(lessonSteps).values({
        lessonId: params.lessonId,
        title: body.title,
        description: body.description,
        estimatedMinutes: body.durationMinutes,
        orderIndex: body.orderIndex ?? (latestSegment?.orderIndex ?? -1) + 1
      });

      const detail = await buildCourseDetail(user.id, courseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.patch(
    '/v1/segments/:segmentId',
    {
      schema: {
        params: SegmentParamsSchema,
        body: SegmentUpdateRequestSchema,
        response: {
          200: CourseDetailResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SegmentParamsSchema.parse(request.params);
      const body = SegmentUpdateRequestSchema.parse(request.body);

      const ownedCourseId = await findOwnedCourseIdForSegment(user.id, params.segmentId);
      if (!ownedCourseId) {
        (reply as any).code(404);
        return { error: 'Segment not found', requestId: request.id };
      }

      const updates: Partial<typeof lessonSteps.$inferInsert> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.durationMinutes !== undefined) updates.estimatedMinutes = body.durationMinutes;
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;

      if (Object.keys(updates).length > 0) {
        await db.update(lessonSteps).set(updates).where(eq(lessonSteps.id, params.segmentId));
      }

      const detail = await buildCourseDetail(user.id, ownedCourseId);
      if (!detail) throw new Error('Failed to load course detail');
      return detail;
    }
  );

  app.delete(
    '/v1/segments/:segmentId',
    {
      schema: {
        params: SegmentParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = SegmentParamsSchema.parse(request.params);

      const courseId = await findOwnedCourseIdForSegment(user.id, params.segmentId);
      if (!courseId) {
        (reply as any).code(404);
        return { error: 'Segment not found', requestId: request.id };
      }

      await db.delete(lessonSteps).where(eq(lessonSteps.id, params.segmentId));
      return { deleted: true };
    }
  );

  app.post(
    '/v1/schedule/setup/weekly/parse',
    {
      schema: {
        body: ScheduleSetupSourceSchema,
        response: { 200: WeeklyScheduleProposalSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = ScheduleSetupSourceSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof ParseWeeklyScheduleSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        schemaName: 'weekly_schedule_proposal',
        schema: ParseWeeklyScheduleSchema,
        systemPrompt:
          "Extract a teacher's weekly or block schedule into a proposal the teacher will review. Group the teacher's classes into the most likely courses and sections. Preserve each distinct weekday or A-Day/B-Day meeting with its own start and end time. Times must be valid zero-padded 24-hour HH:MM values, for example 08:10 or 13:25; never combine a period number with a time. Put homeroom, lunch, nutrition breaks, prep, planning, duty, meetings, Mass, dismissal, and unassigned blocks in blocks, never courses. Use warnings for handwritten notes, missing times, ambiguous labels, conflicts, or anything that requires teacher confirmation. Do not invent classes or times. Return JSON only.",
        userPrompt: body.text
          ? `Create a reviewed weekly schedule proposal from this document:\n${body.text}`
          : 'Create a reviewed weekly schedule proposal from the supplied image. Return JSON only.',
        userImageDataUrls: body.imageBase64s,
        userImageDataUrl: body.imageBase64
      });
    }
  );

  app.post(
    '/v1/schedule/setup/calendar/parse',
    {
      schema: {
        body: ScheduleSetupSourceSchema,
        response: { 200: AnnualCalendarProposalSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = ScheduleSetupSourceSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof ParseAnnualCalendarSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        schemaName: 'annual_calendar_proposal',
        schema: ParseAnnualCalendarSchema,
        systemPrompt:
          'Extract a teacher-reviewed annual school calendar. Capture no-school dates, early releases, assemblies, testing, special schedules, and A-Day/B-Day labels when explicit. Expand stated date ranges into individual dates. Set replaceWeeklySchedule only when an explicit special bell schedule replaces normal classes. Include special-class meeting times only when the document clearly names the course/section and time. Use warnings instead of guesses. Return JSON only.',
        userPrompt: body.text
          ? `Create an annual calendar proposal from this document:\n${body.text}`
          : 'Create an annual calendar proposal from the supplied image. Return JSON only.',
        userImageDataUrls: body.imageBase64s,
        userImageDataUrl: body.imageBase64
      });
    }
  );

  app.post(
    '/v1/schedule/setup/apply',
    {
      schema: {
        body: ScheduleSetupApplyRequestSchema,
        response: { 200: ScheduleSetupApplyResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = ScheduleSetupApplyRequestSchema.parse(request.body);

      const result = await db.transaction(async (tx) => {
        const [currentTemplate] = await tx
          .select({ id: teacherScheduleTemplates.id })
          .from(teacherScheduleTemplates)
          .where(
            and(
              eq(teacherScheduleTemplates.teacherId, user.id),
              eq(teacherScheduleTemplates.isActive, true)
            )
          )
          .limit(1);
        if (currentTemplate) {
          await tx
            .update(teacherScheduleTemplates)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(teacherScheduleTemplates.id, currentTemplate.id));
        }

        const [template] = await tx
          .insert(teacherScheduleTemplates)
          .values({
            teacherId: user.id,
            schoolId,
            name: 'Imported weekly schedule',
            isActive: true
          })
          .returning({ id: teacherScheduleTemplates.id });
        if (!template) throw new Error('Failed to save weekly schedule');

        let coursesCreated = 0;
        let sectionsCreated = 0;
        let meetingsSaved = 0;
        const sectionIds = new Map<string, string>();

        for (const proposalCourse of body.weekly.courses) {
          const [existingCourse] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(and(eq(courses.teacherId, user.id), eq(courses.name, proposalCourse.name)))
            .limit(1);
          let courseId = existingCourse?.id;
          if (!courseId) {
            const [course] = await tx
              .insert(courses)
              .values({
                teacherId: user.id,
                schoolId,
                name: proposalCourse.name,
                subject: proposalCourse.subject,
                gradeLevel: proposalCourse.gradeLevel
              })
              .returning({ id: courses.id });
            if (!course) throw new Error('Failed to create course from schedule proposal');
            courseId = course.id;
            coursesCreated += 1;
          }

          for (const proposalSection of proposalCourse.sections) {
            const [existingSection] = await tx
              .select({ id: sections.id })
              .from(sections)
              .where(and(eq(sections.courseId, courseId), eq(sections.name, proposalSection.name)))
              .limit(1);
            let sectionId = existingSection?.id;
            if (!sectionId) {
              const [section] = await tx
                .insert(sections)
                .values({ courseId, name: proposalSection.name })
                .returning({ id: sections.id });
              if (!section) throw new Error('Failed to create section from schedule proposal');
              sectionId = section.id;
              sectionsCreated += 1;
            }
            sectionIds.set(`${proposalCourse.name}::${proposalSection.name}`, sectionId);

            if (proposalSection.meetings.length) {
              await tx.insert(sectionMeetings).values(
                proposalSection.meetings.map((meeting) => ({
                  sectionId,
                  scheduleTemplateId: template.id,
                  day: meeting.day,
                  meetingTime: meeting.startTime,
                  meetingEndTime: meeting.endTime,
                  room: meeting.room
                }))
              );
              meetingsSaved += proposalSection.meetings.length;
            }
          }
        }

        if (body.weekly.blocks.length) {
          await tx.insert(scheduleBlocks).values(
            body.weekly.blocks.map((block) => ({
              scheduleTemplateId: template.id,
              day: block.day,
              startTime: block.startTime,
              endTime: block.endTime,
              label: block.label,
              kind: block.kind
            }))
          );
        }

        let overridesSaved = 0;
        for (const override of body.annualCalendar?.overrides ?? []) {
          const [existingOverride] = await tx
            .select({ id: scheduleDateOverrides.id })
            .from(scheduleDateOverrides)
            .where(
              and(
                eq(scheduleDateOverrides.teacherId, user.id),
                eq(scheduleDateOverrides.date, override.date)
              )
            )
            .limit(1);
          let overrideId = existingOverride?.id;
          if (overrideId) {
            await tx
              .update(scheduleDateOverrides)
              .set({
                label: override.label,
                kind: override.kind,
                rotationDay: override.rotationDay,
                replaceWeeklySchedule: override.replaceWeeklySchedule,
                updatedAt: new Date()
              })
              .where(eq(scheduleDateOverrides.id, overrideId));
            await tx
              .delete(scheduleDateOverrideMeetings)
              .where(eq(scheduleDateOverrideMeetings.scheduleDateOverrideId, overrideId));
          } else {
            const [createdOverride] = await tx
              .insert(scheduleDateOverrides)
              .values({
                teacherId: user.id,
                schoolId,
                date: override.date,
                label: override.label,
                kind: override.kind,
                rotationDay: override.rotationDay,
                replaceWeeklySchedule: override.replaceWeeklySchedule
              })
              .returning({ id: scheduleDateOverrides.id });
            if (!createdOverride) throw new Error('Failed to save calendar override');
            overrideId = createdOverride.id;
          }

          if (override.meetings.length) {
            const values = override.meetings.map((meeting) => {
              const sectionId = sectionIds.get(`${meeting.courseName}::${meeting.sectionName}`);
              if (!sectionId) {
                throw new Error(
                  `Calendar override references ${meeting.courseName} / ${meeting.sectionName}, which is not in the reviewed weekly schedule`
                );
              }
              return {
                scheduleDateOverrideId: overrideId,
                sectionId,
                meetingTime: meeting.startTime,
                meetingEndTime: meeting.endTime,
                room: meeting.room
              };
            });
            await tx.insert(scheduleDateOverrideMeetings).values(values);
          }

          if (override.kind === 'no_school') {
            await tx
              .insert(schoolHolidays)
              .values({
                schoolId,
                date: override.date,
                name: override.label,
                createdByUserId: user.id
              })
              .onConflictDoUpdate({
                target: [schoolHolidays.schoolId, schoolHolidays.date],
                set: { name: override.label }
              });
          }
          overridesSaved += 1;
        }

        return {
          coursesCreated,
          sectionsCreated,
          meetingsSaved,
          blocksSaved: body.weekly.blocks.length,
          overridesSaved
        };
      });

      return result;
    }
  );

  app.post(
    '/v1/schedule/import',
    {
      schema: {
        body: ScheduleImportRequestSchema,
        response: {
          200: ScheduleImportResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const body = ScheduleImportRequestSchema.parse(request.body);

      if (!body.text && !body.imageBase64) {
        (reply as any).code(400);
        return { error: 'text or imageBase64 is required', requestId: request.id };
      }

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const response = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        schemaName: 'schedule_import',
        schema: InternalParseScheduleSchema,
        systemPrompt:
          "Extract a teacher's complete teaching schedule. Identify every unique course and section, including all meeting days, start times, end times, rooms, subject, and grade. For a repeating block schedule, use A-Day and B-Day when those labels are shown; otherwise use the named weekdays. Combine repeated occurrences of the same course and period into one class with all applicable days. Use valid zero-padded 24-hour HH:MM times. If an end time is not shown, return null rather than guessing. Ignore lunch, planning, duty, meetings, breaks, and non-teaching blocks. Return JSON only.",
        userPrompt: body.text
          ? `Parse this teacher schedule and assignments:\n${body.text}`
          : 'Parse the provided schedule image and return classes + assignments. Output JSON only.',
        userImageDataUrl: body.imageBase64
      });

      return ParseScheduleResponseSchema.parse(normalizeImportedScheduleTimes(response));
    }
  );

  app.post(
    '/v1/academic-calendar/parse',
    {
      schema: {
        body: AcademicCalendarParseRequestSchema,
        response: { 200: AcademicCalendarParseResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = AcademicCalendarParseRequestSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof AcademicCalendarParseResponseSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
        schemaName: 'academic_calendar',
        schema: AcademicCalendarParseResponseSchema,
        systemPrompt:
          'Extract every date when students are not in regular class from a school academic calendar. Expand multi-day breaks into one entry per date. Keep event names clear and practical. Return only dates that are explicit or unambiguously part of a stated date range; do not guess dates.',
        userPrompt: body.text
          ? `Academic calendar:\n${body.text}`
          : 'Extract all no-school dates from the provided academic-calendar image.',
        userImageDataUrl: body.imageBase64
      });
    }
  );

  app.post(
    '/v1/schedule/import/apply',
    {
      schema: {
        body: TeachingDataImportApplyRequestSchema,
        response: { 200: TeachingDataImportApplyResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = TeachingDataImportApplyRequestSchema.parse(request.body);
      let coursesCreated = 0;
      let sectionsCreated = 0;
      let meetingsCreated = 0;

      for (const importedClass of body.classes) {
        const [existingCourse] = await db
          .select({ id: courses.id })
          .from(courses)
          .where(and(eq(courses.teacherId, user.id), eq(courses.name, importedClass.name)))
          .limit(1);

        let courseId = existingCourse?.id;
        if (!courseId) {
          const [course] = await db
            .insert(courses)
            .values({
              teacherId: user.id,
              schoolId,
              name: importedClass.name,
              subject: importedClass.subject,
              gradeLevel: importedClass.grade || null
            })
            .returning({ id: courses.id });
          if (!course) throw new Error('Failed to create course from import');
          courseId = course.id;
          coursesCreated += 1;
        }

        const [existingSection] = await db
          .select({ id: sections.id })
          .from(sections)
          .where(and(eq(sections.courseId, courseId), eq(sections.name, importedClass.period)))
          .limit(1);
        let sectionId = existingSection?.id;
        if (!sectionId) {
          const [section] = await db
            .insert(sections)
            .values({ courseId, name: importedClass.period })
            .returning({ id: sections.id });
          if (!section) throw new Error('Failed to create section from import');
          sectionId = section.id;
          sectionsCreated += 1;
        }

        const existingMeetings = await db
          .select({
            day: sectionMeetings.day,
            meetingTime: sectionMeetings.meetingTime,
            meetingEndTime: sectionMeetings.meetingEndTime,
            room: sectionMeetings.room
          })
          .from(sectionMeetings)
          .where(eq(sectionMeetings.sectionId, sectionId));
        const missingMeetings = importedClass.days.filter(
          (day) =>
            !existingMeetings.some(
              (meeting) =>
                meeting.day === day &&
                (meeting.meetingTime ? meeting.meetingTime.slice(0, 5) : null) ===
                  importedClass.time &&
                (meeting.meetingEndTime ? meeting.meetingEndTime.slice(0, 5) : null) ===
                  importedClass.endTime &&
                meeting.room === importedClass.room
            )
        );
        if (missingMeetings.length) {
          await db.insert(sectionMeetings).values(
            missingMeetings.map((day) => ({
              sectionId,
              day,
              meetingTime: importedClass.time,
              meetingEndTime: importedClass.endTime,
              room: importedClass.room
            }))
          );
          meetingsCreated += missingMeetings.length;
        }
      }

      if (body.holidays.length) {
        await db
          .insert(schoolHolidays)
          .values(
            body.holidays.map((holiday) => ({
              schoolId,
              date: holiday.date,
              name: holiday.name,
              createdByUserId: user.id
            }))
          )
          .onConflictDoNothing({ target: [schoolHolidays.schoolId, schoolHolidays.date] });
      }

      return {
        coursesCreated,
        sectionsCreated,
        meetingsCreated,
        holidaysSaved: body.holidays.length
      };
    }
  );

  app.post(
    '/v1/holidays',
    {
      schema: {
        body: HolidaysUpsertRequestSchema,
        response: {
          200: HolidaysUpsertResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const schoolId = await loadTeacherSchoolId(user.id);
      const body = HolidaysUpsertRequestSchema.parse(request.body);

      if (!body.holidays.length) return { count: 0 };

      await db
        .insert(schoolHolidays)
        .values(
          body.holidays.map((holiday) => ({
            schoolId,
            date: holiday.date,
            name: holiday.name,
            createdByUserId: user.id
          }))
        )
        .onConflictDoNothing({
          target: [schoolHolidays.schoolId, schoolHolidays.date]
        });

      return { count: body.holidays.length };
    }
  );

  app.post(
    '/v1/lesson-progress/upsert',
    {
      schema: {
        body: LessonProgressUpsertRequestSchema,
        response: {
          200: LessonProgressUpsertResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      await ensureUserFromPrincipal(principal);
      const body = LessonProgressUpsertRequestSchema.parse(request.body);

      const [state] = await db
        .insert(sectionLessonState)
        .values({
          sectionId: body.sectionId,
          lessonId: body.lessonId,
          status: body.status,
          currentSegmentId: body.currentSegmentId,
          stoppedAtSegmentId: body.stoppedAtSegmentId,
          completedSegmentIds: body.completedSegmentIds,
          carryOverNote: body.carryOverNote,
          lastTaughtDate: body.lastTaughtDate
        })
        .onConflictDoUpdate({
          target: [sectionLessonState.sectionId, sectionLessonState.lessonId],
          set: {
            status: body.status,
            currentSegmentId: body.currentSegmentId,
            stoppedAtSegmentId: body.stoppedAtSegmentId,
            completedSegmentIds: body.completedSegmentIds,
            carryOverNote: body.carryOverNote,
            lastTaughtDate: body.lastTaughtDate,
            updatedAt: new Date()
          }
        })
        .returning({
          id: sectionLessonState.id,
          updatedAt: sectionLessonState.updatedAt
        });
      if (!state) throw new Error('Failed to upsert lesson state');

      return {
        stateId: state.id,
        updatedAt: state.updatedAt.toISOString()
      };
    }
  );

  app.get(
    '/v1/teacher-notes',
    {
      schema: {
        response: {
          200: TeacherNotesResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const rows = await db
        .select({
          id: teacherNotes.id,
          title: teacherNotes.title,
          content: teacherNotes.content,
          createdAt: teacherNotes.createdAt,
          updatedAt: teacherNotes.updatedAt
        })
        .from(teacherNotes)
        .where(eq(teacherNotes.userId, user.id))
        .orderBy(desc(teacherNotes.updatedAt));

      return {
        notes: rows.map((note) => ({
          id: note.id,
          title: note.title,
          content: note.content,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString()
        }))
      };
    }
  );

  app.post(
    '/v1/teacher-notes',
    {
      schema: {
        body: TeacherNoteCreateRequestSchema,
        response: {
          200: TeacherNoteSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = TeacherNoteCreateRequestSchema.parse(request.body);
      const [note] = await db
        .insert(teacherNotes)
        .values({ userId: user.id, title: body.title, content: body.content })
        .returning();
      if (!note) throw new Error('Failed to create teacher note');

      return {
        id: note.id,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString()
      };
    }
  );

  app.patch(
    '/v1/teacher-notes/:noteId',
    {
      schema: {
        params: TeacherNoteParamsSchema,
        body: TeacherNoteUpdateRequestSchema,
        response: {
          200: TeacherNoteSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = TeacherNoteParamsSchema.parse(request.params);
      const body = TeacherNoteUpdateRequestSchema.parse(request.body);
      const updates: Partial<typeof teacherNotes.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) updates.title = body.title;
      if (body.content !== undefined) updates.content = body.content;

      const [note] = await db
        .update(teacherNotes)
        .set(updates)
        .where(and(eq(teacherNotes.id, params.noteId), eq(teacherNotes.userId, user.id)))
        .returning();
      if (!note) {
        (reply as any).code(404);
        return { error: 'Note not found', requestId: request.id };
      }

      return {
        id: note.id,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString()
      };
    }
  );

  app.delete(
    '/v1/teacher-notes/:noteId',
    {
      schema: {
        params: TeacherNoteParamsSchema,
        response: {
          200: DeleteEntityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = TeacherNoteParamsSchema.parse(request.params);
      const [deleted] = await db
        .delete(teacherNotes)
        .where(and(eq(teacherNotes.id, params.noteId), eq(teacherNotes.userId, user.id)))
        .returning({ id: teacherNotes.id });
      if (!deleted) {
        (reply as any).code(404);
        return { error: 'Note not found', requestId: request.id };
      }
      return { deleted: true };
    }
  );

  app.post(
    '/v1/class-notes/upsert',
    {
      schema: {
        body: ClassNotesUpsertRequestSchema,
        response: {
          200: ClassNotesUpsertResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const body = ClassNotesUpsertRequestSchema.parse(request.body);

      const [note] = await db
        .insert(classNotes)
        .values({
          sectionId: body.sectionId,
          userId: user.id,
          date: body.date,
          noteType: body.noteType,
          content: body.content
        })
        .onConflictDoUpdate({
          target: [classNotes.sectionId, classNotes.userId, classNotes.date, classNotes.noteType],
          set: {
            content: body.content,
            updatedAt: new Date()
          }
        })
        .returning({
          id: classNotes.id,
          updatedAt: classNotes.updatedAt
        });
      if (!note) throw new Error('Failed to upsert class note');

      return {
        noteId: note.id,
        updatedAt: note.updatedAt.toISOString()
      };
    }
  );

  app.post(
    '/v1/files/sign-upload',
    {
      schema: {
        body: CreateUploadUrlRequestSchema,
        response: {
          200: CreateUploadUrlResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      await ensureUserFromPrincipal(principal);

      const body = CreateUploadUrlRequestSchema.parse(request.body);
      const s3Client = createS3Client(app.config);
      const objectKey = `materials/${randomUUID()}-${body.fileName}`;

      const uploadUrl = await createSignedUploadUrl({
        client: s3Client,
        bucket: app.config.S3_BUCKET,
        objectKey,
        contentType: body.contentType
      });

      if (!uploadUrl) {
        (reply as any).code(503);
        return { error: 'S3 is not configured', requestId: request.id };
      }

      return { objectKey, uploadUrl };
    }
  );

  app.post(
    '/v1/ai/parse-schedule/queue',
    {
      schema: {
        body: ScheduleImportRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = ScheduleImportRequestSchema.parse(request.body);
      if (!body.text && !body.imageBase64) {
        (reply as any).code(400);
        return { error: 'text or imageBase64 is required', requestId: request.id };
      }

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'parse_schedule',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      await enqueueAiJob(app.aiQueue, job.id);
      return {
        jobId: job.id,
        status: job.status
      };
    }
  );

  app.post(
    '/v1/ai/generate-segments/queue',
    {
      schema: {
        body: GenerateSegmentsRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = GenerateSegmentsRequestSchema.parse(request.body);

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_segments',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      await enqueueAiJob(app.aiQueue, job.id);
      return {
        jobId: job.id,
        status: job.status
      };
    }
  );

  app.post(
    '/v1/ai/generate-continuity/queue',
    {
      schema: {
        body: GenerateContinuityRequestSchema,
        response: {
          200: AiJobEnqueueResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = GenerateContinuityRequestSchema.parse(request.body);

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_continuity',
          status: 'queued',
          input: body
        })
        .returning({ id: aiJobs.id, status: aiJobs.status });
      if (!job) throw new Error('Failed to create AI job');

      await enqueueAiJob(app.aiQueue, job.id);
      return {
        jobId: job.id,
        status: job.status
      };
    }
  );

  app.get(
    '/v1/ai/jobs/:jobId',
    {
      schema: {
        params: z.object({ jobId: UuidSchema }),
        response: {
          200: AiJobStatusResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = AiJobParamsSchema.parse(request.params);

      const [job] = await db
        .select({
          id: aiJobs.id,
          type: aiJobs.type,
          status: aiJobs.status,
          output: aiJobs.output,
          error: aiJobs.error,
          cancelRequested: aiJobs.cancelRequested
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, params.jobId), eq(aiJobs.userId, user.id)))
        .limit(1);

      if (!job) {
        (reply as any).code(404);
        return { error: 'AI job not found', requestId: request.id };
      }

      let attemptsMade = 0;
      let maxAttempts = AI_JOB_MAX_ATTEMPTS;
      let progressPercent: number | null = null;

      if (app.aiQueue) {
        const queueJob = await app.aiQueue.getJob(job.id);
        if (queueJob) {
          attemptsMade = queueJob.attemptsMade;
          maxAttempts = queueJob.opts.attempts ?? AI_JOB_MAX_ATTEMPTS;
          progressPercent = normalizeProgressPercent(queueJob.progress);
        }
      }

      if (progressPercent === null) {
        if (job.status === 'queued') progressPercent = 5;
        else if (job.status === 'running') progressPercent = 45;
        else progressPercent = 100;
      }

      if (job.status === 'failed' && attemptsMade === 0) {
        attemptsMade = maxAttempts;
      }

      const canCancel = job.status === 'queued' || job.status === 'running';
      const canRetry = job.status === 'failed' || job.status === 'cancelled';

      return {
        jobId: job.id,
        type: job.type as 'parse_schedule' | 'generate_segments' | 'generate_continuity',
        status: job.status,
        output: job.output ?? null,
        error: job.error,
        cancelRequested: job.cancelRequested,
        attemptsMade,
        maxAttempts,
        progressPercent,
        canCancel,
        canRetry
      };
    }
  );

  app.post(
    '/v1/ai/jobs/:jobId/cancel',
    {
      schema: {
        params: AiJobParamsSchema,
        response: {
          200: AiJobControlResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = AiJobParamsSchema.parse(request.params);

      const [job] = await db
        .select({
          id: aiJobs.id,
          status: aiJobs.status
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, params.jobId), eq(aiJobs.userId, user.id)))
        .limit(1);

      if (!job) {
        (reply as any).code(404);
        return { error: 'AI job not found', requestId: request.id };
      }

      if (job.status === 'queued') {
        await db
          .update(aiJobs)
          .set({
            status: 'cancelled',
            cancelRequested: true,
            error: 'Cancelled by user',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, params.jobId));

        if (app.aiQueue) {
          await app.aiQueue.remove(params.jobId).catch(() => undefined);
        }

        return { jobId: params.jobId, status: 'cancelled', action: 'cancelled' };
      }

      if (job.status === 'running') {
        await db
          .update(aiJobs)
          .set({
            cancelRequested: true,
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, params.jobId));

        return { jobId: params.jobId, status: 'running', action: 'cancelled' };
      }

      return { jobId: params.jobId, status: job.status, action: 'cancelled' };
    }
  );

  app.post(
    '/v1/ai/jobs/:jobId/retry',
    {
      schema: {
        params: AiJobParamsSchema,
        response: {
          200: AiJobControlResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      const params = AiJobParamsSchema.parse(request.params);

      if (!app.aiQueue) {
        (reply as any).code(503);
        return { error: 'AI queue is unavailable. Configure REDIS_URL.', requestId: request.id };
      }

      const [job] = await db
        .select({
          id: aiJobs.id,
          status: aiJobs.status
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, params.jobId), eq(aiJobs.userId, user.id)))
        .limit(1);

      if (!job) {
        (reply as any).code(404);
        return { error: 'AI job not found', requestId: request.id };
      }

      if (job.status !== 'failed' && job.status !== 'cancelled') {
        (reply as any).code(409);
        return {
          error: 'Only failed or cancelled jobs can be retried',
          requestId: request.id
        };
      }

      await db
        .update(aiJobs)
        .set({
          status: 'queued',
          output: null,
          error: null,
          cancelRequested: false,
          updatedAt: new Date()
        })
        .where(eq(aiJobs.id, params.jobId));

      await enqueueAiJob(app.aiQueue, params.jobId);

      return { jobId: params.jobId, status: 'queued', action: 'requeued' };
    }
  );

  app.post(
    '/v1/ai/parse-schedule',
    {
      schema: {
        body: ScheduleImportRequestSchema,
        response: {
          200: ParseScheduleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      const body = ScheduleImportRequestSchema.parse(request.body);
      if (!body.text && !body.imageBase64) {
        (reply as any).code(400);
        return { error: 'text or imageBase64 is required', requestId: request.id };
      }

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const user = await ensureUserFromPrincipal(principal);
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'parse_schedule',
          status: 'running',
          input: body
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create AI job');

      try {
        const output = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_PARSE_SCHEDULE,
          schemaName: 'parse_schedule',
          schema: InternalParseScheduleSchema,
          systemPrompt:
            'Extract classes and assignments from a teacher schedule. Include start and end time for every class when shown, use HH:MM 24-hour time, return null for a missing end time, and skip non-teaching events. Return JSON only.',
          userPrompt: body.text
            ? `Parse this schedule and assignments:\n${body.text}`
            : 'Parse the supplied schedule image and return classes + assignments.'
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'parse_schedule',
          payload: output
        });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));

        return ParseScheduleResponseSchema.parse(normalizeImportedScheduleTimes(output));
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );

  app.post(
    '/v1/ai/generate-activity',
    {
      schema: {
        body: GenerateActivityRequestSchema,
        response: { 200: GenerateActivityResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateActivityRequestSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof GenerateActivityResponseSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_GENERATE_SEGMENTS,
        schemaName: 'classroom_activity',
        schema: GenerateActivityResponseSchema,
        systemPrompt:
          'Create a practical, classroom-ready activity. Sound like a skilled teaching colleague, not an AI assistant. Keep directions clear, age-appropriate, and immediately usable. Make the student handout self-contained, concise, and printable. Do not invent standards, links, citations, or facts.',
        userPrompt: `Course: ${body.courseName}\nSubject: ${body.subject ?? 'Not specified'}\nGrade: ${body.gradeLevel ?? 'Not specified'}\nLesson: ${body.lessonTitle}\nObjective: ${body.objective ?? 'Not specified'}\nClass time: ${body.durationMinutes} minutes\nActivity format: ${body.activityType}\nTeacher context: ${body.teacherNotes ?? 'None provided'}`
      });
    }
  );

  app.post(
    '/v1/ai/generate-semester',
    {
      schema: {
        body: GenerateSemesterRequestSchema,
        response: { 200: GenerateSemesterResponseSchema }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;
      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateSemesterRequestSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof GenerateSemesterResponseSchema>>({
        apiKey: app.config.OPENAI_API_KEY,
        model: app.config.OPENAI_MODEL_GENERATE_SEGMENTS,
        schemaName: 'semester_outline',
        schema: GenerateSemesterResponseSchema,
        systemPrompt:
          'Design a realistic teacher-owned semester outline. Use the requested number of units and distribute the requested total class meetings across them. Each lesson must be concise enough to review and edit. Favor coherent progression, formative checks, and practical pacing. Do not claim alignment to a standard unless the teacher supplied it.',
        userPrompt: `Course: ${body.courseName}\nSubject: ${body.subject ?? 'Not specified'}\nGrade: ${body.gradeLevel ?? 'Not specified'}\nTimeframe: ${body.timeframeWeeks} weeks, ${body.meetingsPerWeek} meetings each week\nRequested units: ${body.unitCount}\nTeacher priorities and constraints: ${body.teacherNotes ?? 'None provided'}`
      });
    }
  );

  app.post(
    '/v1/ai/generate-segments',
    {
      schema: {
        body: GenerateSegmentsRequestSchema,
        response: {
          200: GenerateSegmentsResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateSegmentsRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);

      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_segments',
          status: 'running',
          input: body
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create AI job');

      try {
        const output = await runStructuredPrompt<z.infer<typeof GenerateSegmentsResponseSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_GENERATE_SEGMENTS,
          schemaName: 'generate_segments',
          schema: GenerateSegmentsResponseSchema,
          systemPrompt:
            'Generate practical, classroom-ready lesson segments with realistic durations and concise descriptions.',
          userPrompt: `Lesson title: ${body.lessonTitle}\nObjective: ${body.objective ?? 'None'}\nTotal minutes: ${body.durationMinutes}`
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'generate_segments',
          payload: output
        });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );

  app.post(
    '/v1/ai/generate-continuity',
    {
      schema: {
        body: GenerateContinuityRequestSchema,
        response: {
          200: GenerateContinuityResponseSchema
        }
      }
    },
    async (request, reply) => {
      const principal = requirePrincipal(request, reply);
      if (!principal) return;

      if (!app.config.OPENAI_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENAI_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateContinuityRequestSchema.parse(request.body);
      const user = await ensureUserFromPrincipal(principal);

      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          type: 'generate_continuity',
          status: 'running',
          input: body
        })
        .returning({ id: aiJobs.id });
      if (!job) throw new Error('Failed to create AI job');

      try {
        const output = await runStructuredPrompt<z.infer<typeof GenerateContinuityResponseSchema>>({
          apiKey: app.config.OPENAI_API_KEY,
          model: app.config.OPENAI_MODEL_CONTINUITY,
          schemaName: 'generate_continuity',
          schema: GenerateContinuityResponseSchema,
          systemPrompt:
            'You are helping a teacher continue the next class smoothly. Keep output concise and practical.',
          userPrompt: `Lesson: ${body.lessonTitle}\nLast segment: ${body.lastSegmentTitle ?? 'Unknown'}\nLast note: ${body.lastNote ?? 'None'}\nPrevious summary: ${body.previousLessonSummary ?? 'None'}`
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'generate_continuity',
          payload: output
        });
        await db
          .update(aiJobs)
          .set({ status: 'succeeded', output, updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
          })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );
}
