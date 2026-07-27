import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AiJobControlResponseSchema,
  AiJobEnqueueResponseSchema,
  AiJobStatusResponseSchema,
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
  TeachingDataImportApplyRequestSchema,
  TeachingDataImportApplyResponseSchema,
  UnitCreateRequestSchema,
  UnitUpdateRequestSchema,
  LessonCreateRequestSchema,
  LessonMaterialCreateRequestSchema,
  LessonUpdateRequestSchema,
  UuidSchema
} from '@teacheros/contracts';
import {
  aiJobs,
  aiOutputs,
  classNotes,
  courses,
  db,
  lessonSegments,
  lessonMaterials,
  lessons,
  schoolHolidays,
  sectionLessonState,
  sectionSessionEvents,
  sectionMeetings,
  sections,
  teacherProfiles,
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

function isInSession(meetingTime: string | null): boolean {
  if (!meetingTime) return false;
  const parts = meetingTime.split(':');
  const hours = Number(parts[0] ?? Number.NaN);
  const minutes = Number(parts[1] ?? Number.NaN);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;

  const now = new Date();
  const startMinutes = hours * 60 + minutes;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMinutes >= startMinutes && nowMinutes <= startMinutes + 55;
}

function dateDaysAgo(daysAgo: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}

function hasMeetingPassed(meetingTime: string | null, date: Date, today: string): boolean {
  const isoDate = dateToIso(date);
  if (isoDate < today) return true;
  if (isoDate > today || !meetingTime) return false;

  const [hours, minutes] = meetingTime.split(':').map(Number);
  if (hours === undefined || minutes === undefined || !Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return false;
  }
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes() > hours * 60 + minutes + 55;
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
    .from(lessonSegments)
    .innerJoin(lessons, eq(lessonSegments.lessonId, lessons.id))
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(and(eq(lessonSegments.id, segmentId), eq(courses.teacherId, userId)))
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
            estimatedDurationMinutes: lessons.estimatedDurationMinutes
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
            id: lessonSegments.id,
            lessonId: lessonSegments.lessonId,
            title: lessonSegments.title,
            description: lessonSegments.description,
            durationMinutes: lessonSegments.durationMinutes,
            orderIndex: lessonSegments.orderIndex
          })
          .from(lessonSegments)
          .where(inArray(lessonSegments.lessonId, lessonIds))
          .orderBy(asc(lessonSegments.orderIndex), asc(lessonSegments.createdAt))
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

      const rows = await db
        .select({
          sectionId: sections.id,
          sectionName: sections.name,
          courseName: courses.name,
          meetingTime: sectionMeetings.meetingTime,
          room: sectionMeetings.room
        })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .innerJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(and(eq(courses.teacherId, user.id), eq(sectionMeetings.day, weekday)))
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
        room: row.room,
        isInSession: isInSession(row.meetingTime ? row.meetingTime.slice(0, 5) : null)
      }));

      const nowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      const withMinutes = todaySchedule.map((entry) => ({
        ...entry,
        startMinutes: entry.meetingTime
          ? Number(entry.meetingTime.slice(0, 2)) * 60 + Number(entry.meetingTime.slice(3, 5))
          : Number.MAX_SAFE_INTEGER
      }));

      const currentClass = withMinutes.find(
        (entry) => nowMinutes >= entry.startMinutes && nowMinutes <= entry.startMinutes + 55
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
              room: currentClass.room
            }
          : null,
        nextClass: nextClass
          ? {
              sectionId: nextClass.sectionId,
              courseName: nextClass.courseName,
              sectionName: nextClass.sectionName,
              meetingTime: nextClass.meetingTime
            }
          : null,
        todaySchedule: todaySchedule.map(({ sectionId, courseName, sectionName, meetingTime, room, isInSession: inSession }) => ({
          sectionId,
          courseName,
          sectionName,
          meetingTime,
          room,
          isInSession: inSession
        })),
        holiday: holiday
          ? {
              id: holiday.id,
              date: holiday.date,
              name: holiday.name
            }
          : null
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

      const meetings = await db
        .select({
          sectionId: sections.id,
          sectionName: sections.name,
          courseName: courses.name,
          day: sectionMeetings.day,
          meetingTime: sectionMeetings.meetingTime
        })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .innerJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(eq(courses.teacherId, user.id));

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
          .select({ sectionId: sectionLessonState.sectionId, sessionDate: sectionLessonState.lastTaughtDate })
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

      const holidays = new Set(holidayRows.map((holiday) => String(holiday.date)));
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
        const weekday = dayName(date);

        for (const meeting of meetings) {
          if (meeting.day !== weekday || !hasMeetingPassed(meeting.meetingTime, date, today))
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

      const rows = await db
        .select({
          sectionId: sections.id,
          sectionName: sections.name,
          courseId: courses.id,
          courseName: courses.name,
          day: sectionMeetings.day,
          meetingTime: sectionMeetings.meetingTime,
          room: sectionMeetings.room
        })
        .from(sections)
        .innerJoin(courses, eq(sections.courseId, courses.id))
        .leftJoin(sectionMeetings, eq(sectionMeetings.sectionId, sections.id))
        .where(eq(courses.teacherId, user.id));

      const holidayRows = await db
        .select({
          id: schoolHolidays.id,
          date: schoolHolidays.date,
          name: schoolHolidays.name
        })
        .from(schoolHolidays)
        .where(eq(schoolHolidays.schoolId, schoolId))
        .orderBy(asc(schoolHolidays.date));

      const bySection = new Map<
        string,
        {
          sectionId: string;
          courseId: string;
          courseName: string;
          sectionName: string;
          meetings: Array<{ day: string; time: string | null; room: string | null }>;
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
            room: row.room
          });
        }
      });

      return {
        sections: Array.from(bySection.values()),
        holidays: holidayRows.map((row) => ({ id: row.id, date: row.date, name: row.name }))
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
        orderIndex: body.orderIndex ?? (latestLesson?.orderIndex ?? -1) + 1
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
        .select({ orderIndex: lessonSegments.orderIndex })
        .from(lessonSegments)
        .where(eq(lessonSegments.lessonId, params.lessonId))
        .orderBy(desc(lessonSegments.orderIndex))
        .limit(1);

      await db.insert(lessonSegments).values({
        lessonId: params.lessonId,
        title: body.title,
        description: body.description,
        durationMinutes: body.durationMinutes,
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

      const updates: Partial<typeof lessonSegments.$inferInsert> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes;
      if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;

      if (Object.keys(updates).length > 0) {
        await db.update(lessonSegments).set(updates).where(eq(lessonSegments.id, params.segmentId));
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

      await db.delete(lessonSegments).where(eq(lessonSegments.id, params.segmentId));
      return { deleted: true };
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

      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
      }

      const response = await runStructuredPrompt<z.infer<typeof InternalParseScheduleSchema>>({
        apiKey: app.config.OPENROUTER_API_KEY,
        model: app.config.OPENROUTER_MODEL_PARSE_SCHEDULE,
        schemaName: 'schedule_import',
        schema: InternalParseScheduleSchema,
        systemPrompt:
          'Extract schedule classes and assignments. Return JSON only. Ignore non-teaching blocks like lunch/planning.',
        userPrompt: body.text
          ? `Parse this teacher schedule and assignments:\n${body.text}`
          : 'Parse the provided schedule image and return classes + assignments. Output JSON only.',
        userImageDataUrl: body.imageBase64
      });

      return ParseScheduleResponseSchema.parse(response);
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
      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
      }

      const body = AcademicCalendarParseRequestSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof AcademicCalendarParseResponseSchema>>({
        apiKey: app.config.OPENROUTER_API_KEY,
        model: app.config.OPENROUTER_MODEL_PARSE_SCHEDULE,
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
          .select({ day: sectionMeetings.day, meetingTime: sectionMeetings.meetingTime, room: sectionMeetings.room })
          .from(sectionMeetings)
          .where(eq(sectionMeetings.sectionId, sectionId));
        const missingMeetings = importedClass.days.filter(
          (day) =>
            !existingMeetings.some(
              (meeting) =>
                meeting.day === day &&
                (meeting.meetingTime ? meeting.meetingTime.slice(0, 5) : null) === importedClass.time &&
                meeting.room === importedClass.room
            )
        );
        if (missingMeetings.length) {
          await db.insert(sectionMeetings).values(
            missingMeetings.map((day) => ({
              sectionId,
              day,
              meetingTime: importedClass.time,
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

      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
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
          apiKey: app.config.OPENROUTER_API_KEY,
          model: app.config.OPENROUTER_MODEL_PARSE_SCHEDULE,
          schemaName: 'parse_schedule',
          schema: InternalParseScheduleSchema,
          systemPrompt:
            'Extract classes and assignments from teacher schedule text. Return JSON only and skip non-teaching events.',
          userPrompt: body.text
            ? `Parse this schedule and assignments:\n${body.text}`
            : 'Parse the supplied schedule image and return classes + assignments.'
        });

        await db.insert(aiOutputs).values({
          jobId: job.id,
          outputType: 'parse_schedule',
          payload: output
        });
        await db.update(aiJobs).set({ status: 'succeeded', output, updatedAt: new Date() }).where(eq(aiJobs.id, job.id));

        return ParseScheduleResponseSchema.parse(output);
      } catch (error) {
        await db
          .update(aiJobs)
          .set({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown error', updatedAt: new Date() })
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
      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateActivityRequestSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof GenerateActivityResponseSchema>>({
        apiKey: app.config.OPENROUTER_API_KEY,
        model: app.config.OPENROUTER_MODEL_GENERATE_SEGMENTS,
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
      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
      }

      const body = GenerateSemesterRequestSchema.parse(request.body);
      return runStructuredPrompt<z.infer<typeof GenerateSemesterResponseSchema>>({
        apiKey: app.config.OPENROUTER_API_KEY,
        model: app.config.OPENROUTER_MODEL_GENERATE_SEGMENTS,
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

      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
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
          apiKey: app.config.OPENROUTER_API_KEY,
          model: app.config.OPENROUTER_MODEL_GENERATE_SEGMENTS,
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
        await db.update(aiJobs).set({ status: 'succeeded', output, updatedAt: new Date() }).where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown error', updatedAt: new Date() })
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

      if (!app.config.OPENROUTER_API_KEY) {
        (reply as any).code(503);
        return { error: 'OPENROUTER_API_KEY is not configured', requestId: request.id };
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
          apiKey: app.config.OPENROUTER_API_KEY,
          model: app.config.OPENROUTER_MODEL_CONTINUITY,
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
        await db.update(aiJobs).set({ status: 'succeeded', output, updatedAt: new Date() }).where(eq(aiJobs.id, job.id));
        return output;
      } catch (error) {
        await db
          .update(aiJobs)
          .set({ status: 'failed', error: error instanceof Error ? error.message : 'Unknown error', updatedAt: new Date() })
          .where(eq(aiJobs.id, job.id));
        throw error;
      }
    }
  );
}
