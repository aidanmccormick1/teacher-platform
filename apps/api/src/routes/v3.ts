import { and, asc, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AcademicYearInputSchema,
  AccountTimezoneSchema,
  CalendarEventInputSchema,
  ClassGroupInputSchema,
  ClassroomProgressInputSchema,
  ClassroomStateSchema,
  ClassGroupUnitPlanInputSchema,
  InitializeTimezoneRequestSchema,
  LessonStepProgressInputSchema,
  LessonTemplateInputSchema,
  MeetingGenerationPreviewSchema,
  PlanAllocationInputSchema,
  PlanAllocationMoveRequestSchema,
  PlannedPercentageSchema,
  ResourceInputSchema,
  ScheduleSetupApplyRequestSchema,
  ScheduleOverrideInputSchema,
  UpdateTimezoneRequestSchema,
  V3CourseDetailSchema
} from '@teacheros/contracts';
import {
  academicYears,
  calendarEvents,
  classGroupLessonStepProgress,
  classGroups,
  classGroupUnitPlans,
  courses,
  db,
  lessonSteps,
  lessonTemplateSteps,
  lessonTemplates,
  lessons,
  meetingInstances,
  meetingRuleDays,
  meetingRules,
  planAllocations,
  resourcesV3,
  scheduleOverrideMeetingsV3,
  scheduleOverridesV3,
  teacherProfiles,
  units
} from '@teacheros/db';

import { ensureUserFromPrincipal } from '../services/user-service.js';
import {
  buildV3CourseDetail,
  getClassroomState,
  getPlannedPercentage,
  initializeTimezone,
  loadAccountTimezone,
  recalculateMeetingInstances,
  saveLessonProgress,
  toMeetingInstance,
  updateTimezone
} from '../services/teacheros-v3-service.js';

const UuidParams = z.object({ id: z.string().uuid() });
const CourseParams = z.object({ courseId: z.string().uuid() });
const GroupParams = z.object({ classGroupId: z.string().uuid() });
const AllocationParams = z.object({ allocationId: z.string().uuid() });
const UnitParams = z.object({ classGroupId: z.string().uuid(), unitId: z.string().uuid() });
const StepParams = z.object({ classGroupId: z.string().uuid() });
const LessonBankParams = z.object({ lessonId: z.string().uuid() });
const TemplateParams = z.object({ templateId: z.string().uuid() });
const weekdayByName: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

function principalOrReply(request: FastifyRequest, reply: FastifyReply) {
  if (!request.principal) {
    reply.code(401).send({ error: 'Unauthorized', requestId: request.id });
    return null;
  }
  return request.principal;
}

async function ownedAcademicYear(userId: string, academicYearId: string) {
  const [year] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(and(eq(academicYears.id, academicYearId), eq(academicYears.teacherId, userId)))
    .limit(1);
  return year ?? null;
}

async function ownedCourse(userId: string, courseId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.teacherId, userId)))
    .limit(1);
  return course ?? null;
}

async function assertLessonBelongsToCourse(
  courseId: string,
  lessonId: string,
  lessonStepId: string | null
) {
  const [lesson] = await db
    .select({ id: lessons.id, unitId: lessons.unitId })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(and(eq(lessons.id, lessonId), eq(units.courseId, courseId)))
    .limit(1);
  if (!lesson) throw new Error('Lesson is not part of this Class Group’s Course.');
  if (lessonStepId) {
    const [step] = await db
      .select({ id: lessonSteps.id })
      .from(lessonSteps)
      .where(and(eq(lessonSteps.id, lessonStepId), eq(lessonSteps.lessonId, lessonId)))
      .limit(1);
    if (!step) throw new Error('Lesson Step is not part of the selected Lesson.');
  }
}

async function ownedClassGroupCourse(userId: string, classGroupId: string) {
  const [group] = await db
    .select({
      id: classGroups.id,
      courseId: classGroups.courseId,
      academicYearId: classGroups.academicYearId
    })
    .from(classGroups)
    .innerJoin(courses, eq(classGroups.courseId, courses.id))
    .where(and(eq(classGroups.id, classGroupId), eq(courses.teacherId, userId)))
    .limit(1);
  return group ?? null;
}

async function assertScheduledMeetingBelongsToGroup(
  classGroupId: string,
  meetingInstanceId: string
) {
  const [meeting] = await db
    .select({ id: meetingInstances.id })
    .from(meetingInstances)
    .where(
      and(
        eq(meetingInstances.id, meetingInstanceId),
        eq(meetingInstances.classGroupId, classGroupId),
        eq(meetingInstances.state, 'scheduled')
      )
    )
    .limit(1);
  if (!meeting) throw new Error('Meeting is not a scheduled Meeting for this Class Group.');
}

async function assertStepBelongsToCourse(courseId: string, lessonStepId: string) {
  const [step] = await db
    .select({ id: lessonSteps.id })
    .from(lessonSteps)
    .innerJoin(lessons, eq(lessonSteps.lessonId, lessons.id))
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(and(eq(lessonSteps.id, lessonStepId), eq(units.courseId, courseId)))
    .limit(1);
  if (!step) throw new Error('Lesson Step is not part of this Class Group’s Course.');
}

function detectResourceProvider(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('drive.google.com') || hostname.includes('docs.google.com'))
      return 'google';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('instructure.com') || hostname.includes('canvaslms.com')) return 'canvas';
  } catch {
    // ResourceInputSchema validates URLs; keep the fallback defensive.
  }
  return 'web';
}

async function resolveOwnedResourceCourseId(
  userId: string,
  target: {
    courseId: string | null;
    unitId: string | null;
    lessonId: string | null;
    lessonStepId: string | null;
  }
): Promise<string | null> {
  if (target.courseId) return (await ownedCourse(userId, target.courseId))?.id ?? null;
  if (target.unitId) {
    const [row] = await db
      .select({ courseId: courses.id })
      .from(units)
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(and(eq(units.id, target.unitId), eq(courses.teacherId, userId)))
      .limit(1);
    return row?.courseId ?? null;
  }
  if (target.lessonId) {
    const [row] = await db
      .select({ courseId: courses.id })
      .from(lessons)
      .innerJoin(units, eq(lessons.unitId, units.id))
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(and(eq(lessons.id, target.lessonId), eq(courses.teacherId, userId)))
      .limit(1);
    return row?.courseId ?? null;
  }
  if (target.lessonStepId) {
    const [row] = await db
      .select({ courseId: courses.id })
      .from(lessonSteps)
      .innerJoin(lessons, eq(lessonSteps.lessonId, lessons.id))
      .innerJoin(units, eq(lessons.unitId, units.id))
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(and(eq(lessonSteps.id, target.lessonStepId), eq(courses.teacherId, userId)))
      .limit(1);
    return row?.courseId ?? null;
  }
  return null;
}

export async function v3Routes(app: FastifyInstance) {
  app.get(
    '/v3/account',
    { schema: { response: { 200: AccountTimezoneSchema } } },
    async (request, reply) => {
      const principal = principalOrReply(request, reply);
      if (!principal) return;
      const user = await ensureUserFromPrincipal(principal);
      return { timezone: await loadAccountTimezone(user.id) };
    }
  );

  app.post('/v3/account/timezone/initialize', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = InitializeTimezoneRequestSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    return { timezone: await initializeTimezone(user.id, body.timezone) };
  });

  app.patch('/v3/account/timezone', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = UpdateTimezoneRequestSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    return { timezone: await updateTimezone(user.id, body.timezone) };
  });

  app.get('/v3/academic-years', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const years = await db
      .select({
        id: academicYears.id,
        name: academicYears.name,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
        isActive: academicYears.isActive
      })
      .from(academicYears)
      .where(eq(academicYears.teacherId, user.id))
      .orderBy(asc(academicYears.startDate));
    return { years };
  });

  app.post('/v3/academic-years', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = AcademicYearInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const [year] = await db.transaction(async (tx) => {
      if (body.isActive) {
        await tx
          .update(academicYears)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(academicYears.teacherId, user.id));
      }
      return tx
        .insert(academicYears)
        .values({ teacherId: user.id, ...body })
        .returning({
          id: academicYears.id,
          name: academicYears.name,
          startDate: academicYears.startDate,
          endDate: academicYears.endDate,
          isActive: academicYears.isActive
        });
    });
    return { year };
  });

  app.post('/v3/schedule/import/apply', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = ScheduleSetupApplyRequestSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const [year, profile, timezone] = await Promise.all([
      db
        .select()
        .from(academicYears)
        .where(and(eq(academicYears.teacherId, user.id), eq(academicYears.isActive, true)))
        .limit(1),
      db
        .select({ schoolId: teacherProfiles.schoolId })
        .from(teacherProfiles)
        .where(eq(teacherProfiles.userId, user.id))
        .limit(1),
      loadAccountTimezone(user.id)
    ]);
    const activeYear = year[0];
    const school = profile[0];
    if (!activeYear || !school || !timezone) {
      reply.code(400);
      return {
        error:
          'Set your TeacherOS timezone, create an active Academic Year, and complete profile setup before importing a schedule.'
      };
    }
    let coursesCreated = 0;
    let classGroupsCreated = 0;
    let meetingRulesSaved = 0;
    const groupByLabel = new Map<string, string>();
    for (const proposedCourse of body.weekly.courses) {
      let [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.teacherId, user.id), eq(courses.name, proposedCourse.name)))
        .limit(1);
      if (!course) {
        [course] = await db
          .insert(courses)
          .values({
            teacherId: user.id,
            schoolId: school.schoolId,
            name: proposedCourse.name,
            subject: proposedCourse.subject,
            gradeLevel: proposedCourse.gradeLevel
          })
          .returning({ id: courses.id });
        coursesCreated += 1;
      }
      if (!course) throw new Error('Unable to create imported Course.');
      for (const proposedGroup of proposedCourse.sections) {
        let [group] = await db
          .select({ id: classGroups.id })
          .from(classGroups)
          .where(
            and(
              eq(classGroups.courseId, course.id),
              eq(classGroups.academicYearId, activeYear.id),
              eq(classGroups.name, proposedGroup.name)
            )
          )
          .limit(1);
        if (!group) {
          [group] = await db
            .insert(classGroups)
            .values({
              courseId: course.id,
              academicYearId: activeYear.id,
              name: proposedGroup.name
            })
            .returning({ id: classGroups.id });
          classGroupsCreated += 1;
        }
        if (!group) throw new Error('Unable to create imported Class Group.');
        groupByLabel.set(`${proposedCourse.name}::${proposedGroup.name}`, group.id);
        await db.delete(meetingRules).where(eq(meetingRules.classGroupId, group.id));
        const byTime = new Map<string, typeof proposedGroup.meetings>();
        for (const meeting of proposedGroup.meetings) {
          const key = `${meeting.startTime ?? ''}|${meeting.endTime ?? ''}|${meeting.room ?? ''}`;
          byTime.set(key, [...(byTime.get(key) ?? []), meeting]);
        }
        for (const meetings of byTime.values()) {
          const startTime = meetings[0]?.startTime;
          const endTime = meetings[0]?.endTime;
          if (!startTime || !endTime) continue;
          const [rule] = await db
            .insert(meetingRules)
            .values({ classGroupId: group.id, startTime, endTime, room: meetings[0]?.room ?? null })
            .returning({ id: meetingRules.id });
          if (!rule) continue;
          const weekdays = meetings
            .map((meeting) => weekdayByName[meeting.day])
            .filter((value): value is number => value !== undefined);
          if (weekdays.length)
            await db
              .insert(meetingRuleDays)
              .values(
                [...new Set(weekdays)].map((weekday) => ({ meetingRuleId: rule.id, weekday }))
              );
          meetingRulesSaved += 1;
        }
      }
    }
    for (const calendarOverride of body.annualCalendar?.overrides ?? []) {
      if (calendarOverride.kind === 'no_school') {
        await db.insert(calendarEvents).values({
          academicYearId: activeYear.id,
          startDate: calendarOverride.date,
          endDate: calendarOverride.date,
          label: calendarOverride.label,
          type: 'holiday',
          instructional: false
        });
        continue;
      }
      if (!calendarOverride.meetings.length) continue;
      const [override] = await db
        .insert(scheduleOverridesV3)
        .values({
          academicYearId: activeYear.id,
          date: calendarOverride.date,
          label: calendarOverride.label,
          type: calendarOverride.kind
        })
        .returning({ id: scheduleOverridesV3.id });
      if (!override) continue;
      const rows = calendarOverride.meetings.flatMap((meeting) => {
        const classGroupId = groupByLabel.get(`${meeting.courseName}::${meeting.sectionName}`);
        return classGroupId && meeting.startTime && meeting.endTime
          ? [
              {
                scheduleOverrideId: override.id,
                classGroupId,
                action: 'replace' as const,
                startTime: meeting.startTime,
                endTime: meeting.endTime,
                room: meeting.room
              }
            ]
          : [];
      });
      if (rows.length) await db.insert(scheduleOverrideMeetingsV3).values(rows);
    }
    const classGroupIds = [...groupByLabel.values()];
    for (const classGroupId of classGroupIds)
      await recalculateMeetingInstances(user.id, classGroupId, 'meetings_only');
    return {
      coursesCreated,
      classGroupsCreated,
      meetingRulesSaved,
      meetingsGeneratedFor: classGroupIds.length
    };
  });

  app.get('/v3/academic-years/:id/calendar', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { id } = UuidParams.parse(request.params);
    const user = await ensureUserFromPrincipal(principal);
    if (!(await ownedAcademicYear(user.id, id))) {
      reply.code(404);
      return { error: 'Academic Year not found.' };
    }
    const [events, overrides] = await Promise.all([
      db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.academicYearId, id))
        .orderBy(asc(calendarEvents.startDate)),
      db
        .select()
        .from(scheduleOverridesV3)
        .where(eq(scheduleOverridesV3.academicYearId, id))
        .orderBy(asc(scheduleOverridesV3.date))
    ]);
    const overrideIds = overrides.map((override) => override.id);
    const meetings = overrideIds.length
      ? await db
          .select()
          .from(scheduleOverrideMeetingsV3)
          .where(inArray(scheduleOverrideMeetingsV3.scheduleOverrideId, overrideIds))
      : [];
    return {
      events,
      overrides: overrides.map((override) => ({
        ...override,
        meetings: meetings.filter((meeting) => meeting.scheduleOverrideId === override.id)
      }))
    };
  });

  app.post('/v3/academic-years/:id/calendar-events', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { id } = UuidParams.parse(request.params);
    const body = CalendarEventInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    if (!(await ownedAcademicYear(user.id, id))) {
      reply.code(404);
      return { error: 'Academic Year not found.' };
    }
    const [event] = await db
      .insert(calendarEvents)
      .values({ academicYearId: id, ...body })
      .returning();
    return { event };
  });

  app.post('/v3/academic-years/:id/schedule-overrides', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { id } = UuidParams.parse(request.params);
    const body = ScheduleOverrideInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    if (!(await ownedAcademicYear(user.id, id))) {
      reply.code(404);
      return { error: 'Academic Year not found.' };
    }
    const overrideGroups = await db
      .select({ id: classGroups.id })
      .from(classGroups)
      .innerJoin(courses, eq(classGroups.courseId, courses.id))
      .where(
        and(
          eq(courses.teacherId, user.id),
          eq(classGroups.academicYearId, id),
          inArray(
            classGroups.id,
            body.meetings.map((meeting) => meeting.classGroupId)
          )
        )
      );
    if (
      overrideGroups.length !== new Set(body.meetings.map((meeting) => meeting.classGroupId)).size
    ) {
      reply.code(404);
      return {
        error: 'A Schedule Override can only target your Class Groups in this Academic Year.'
      };
    }
    const [override] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scheduleOverridesV3)
        .values({ academicYearId: id, date: body.date, label: body.label, type: body.type })
        .returning();
      if (!created) throw new Error('Failed to create Schedule Override.');
      await tx
        .insert(scheduleOverrideMeetingsV3)
        .values(body.meetings.map((meeting) => ({ scheduleOverrideId: created.id, ...meeting })));
      return [created];
    });
    return { override };
  });

  app.get('/v3/class-groups', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const query = z.object({ academicYearId: z.string().uuid().optional() }).parse(request.query);
    const user = await ensureUserFromPrincipal(principal);
    const rows = await db
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
      .where(
        query.academicYearId
          ? and(
              eq(courses.teacherId, user.id),
              eq(classGroups.academicYearId, query.academicYearId)
            )
          : eq(courses.teacherId, user.id)
      )
      .orderBy(asc(classGroups.periodLabel), asc(classGroups.name));
    return { classGroups: rows };
  });

  app.post('/v3/class-groups', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = ClassGroupInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    if (
      !(await ownedCourse(user.id, body.courseId)) ||
      !(await ownedAcademicYear(user.id, body.academicYearId))
    ) {
      reply.code(404);
      return { error: 'Course or Academic Year not found.' };
    }
    const [group] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(classGroups)
        .values({
          courseId: body.courseId,
          academicYearId: body.academicYearId,
          name: body.name,
          periodLabel: body.periodLabel,
          room: body.room
        })
        .returning();
      if (!created) throw new Error('Failed to create Class Group.');
      for (const rule of body.meetingRules) {
        const [createdRule] = await tx
          .insert(meetingRules)
          .values({
            classGroupId: created.id,
            startTime: rule.startTime,
            endTime: rule.endTime,
            effectiveStart: rule.effectiveStart,
            effectiveEnd: rule.effectiveEnd,
            room: rule.room
          })
          .returning({ id: meetingRules.id });
        if (createdRule) {
          await tx
            .insert(meetingRuleDays)
            .values(rule.weekdays.map((weekday) => ({ meetingRuleId: createdRule.id, weekday })));
        }
      }
      return [created];
    });
    return { classGroup: group };
  });

  app.get(
    '/v3/courses/:courseId',
    { schema: { response: { 200: V3CourseDetailSchema } } },
    async (request, reply) => {
      const principal = principalOrReply(request, reply);
      if (!principal) return;
      const { courseId } = CourseParams.parse(request.params);
      const user = await ensureUserFromPrincipal(principal);
      const detail = await buildV3CourseDetail(user.id, courseId);
      if (!detail) {
        (reply as any).code(404);
        return { error: 'Course not found.' };
      }
      return detail;
    }
  );

  app.get('/v3/lesson-bank', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const query = z.object({ query: z.string().trim().max(160).optional() }).parse(request.query);
    const user = await ensureUserFromPrincipal(principal);
    const rows = await db
      .select({
        id: lessons.id,
        title: lessons.title,
        description: lessons.description,
        sourceLessonId: lessons.sourceLessonId,
        sourceCourseId: lessons.sourceCourseId,
        sourceUnitId: lessons.sourceUnitId,
        unitId: units.id,
        unitTitle: units.title,
        courseId: courses.id,
        courseName: courses.name
      })
      .from(lessons)
      .innerJoin(units, eq(lessons.unitId, units.id))
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(
        query.query
          ? and(eq(courses.teacherId, user.id), ilike(lessons.title, `%${query.query}%`))
          : eq(courses.teacherId, user.id)
      )
      .orderBy(asc(courses.name), asc(units.orderIndex), asc(lessons.orderIndex));
    return { lessons: rows };
  });

  app.post('/v3/lesson-bank/:lessonId/copy', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { lessonId } = LessonBankParams.parse(request.params);
    const body = z.object({ destinationUnitId: z.string().uuid() }).parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const [source] = await db
      .select({
        id: lessons.id,
        title: lessons.title,
        description: lessons.description,
        estimatedDurationMinutes: lessons.estimatedDurationMinutes,
        estimatedMeetings: lessons.estimatedMeetings,
        sourceUnitId: lessons.unitId,
        sourceCourseId: courses.id
      })
      .from(lessons)
      .innerJoin(units, eq(lessons.unitId, units.id))
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(and(eq(lessons.id, lessonId), eq(courses.teacherId, user.id)))
      .limit(1);
    const [destination] = await db
      .select({ courseId: units.courseId })
      .from(units)
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(and(eq(units.id, body.destinationUnitId), eq(courses.teacherId, user.id)))
      .limit(1);
    if (!source || !destination) {
      reply.code(404);
      return { error: 'Lesson or destination Unit not found.' };
    }
    const [copied] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(lessons)
        .values({
          unitId: body.destinationUnitId,
          title: source.title,
          description: source.description,
          estimatedDurationMinutes: source.estimatedDurationMinutes,
          estimatedMeetings: source.estimatedMeetings,
          orderIndex: 999999,
          sourceLessonId: source.id,
          sourceCourseId: source.sourceCourseId,
          sourceUnitId: source.sourceUnitId
        })
        .returning();
      if (!created) throw new Error('Unable to copy Lesson.');
      const steps = await tx.select().from(lessonSteps).where(eq(lessonSteps.lessonId, source.id));
      if (steps.length) {
        await tx.insert(lessonSteps).values(
          steps.map((step) => ({
            lessonId: created.id,
            title: step.title,
            description: step.description,
            estimatedMinutes: step.estimatedMinutes,
            isOptional: step.isOptional,
            orderIndex: step.orderIndex
          }))
        );
      }
      return [created];
    });
    return { lesson: copied };
  });

  app.get('/v3/courses/:courseId/resources', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { courseId } = CourseParams.parse(request.params);
    const user = await ensureUserFromPrincipal(principal);
    if (!(await ownedCourse(user.id, courseId))) {
      reply.code(404);
      return { error: 'Course not found.' };
    }
    const unitRows = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.courseId, courseId));
    const unitIds = unitRows.map((unit) => unit.id);
    const lessonRows = unitIds.length
      ? await db.select({ id: lessons.id }).from(lessons).where(inArray(lessons.unitId, unitIds))
      : [];
    const lessonIds = lessonRows.map((lesson) => lesson.id);
    const stepRows = lessonIds.length
      ? await db
          .select({ id: lessonSteps.id })
          .from(lessonSteps)
          .where(inArray(lessonSteps.lessonId, lessonIds))
      : [];
    const [courseResources, unitResources, lessonResources, stepResources] = await Promise.all([
      db.select().from(resourcesV3).where(eq(resourcesV3.courseId, courseId)),
      unitIds.length
        ? db.select().from(resourcesV3).where(inArray(resourcesV3.unitId, unitIds))
        : [],
      lessonIds.length
        ? db.select().from(resourcesV3).where(inArray(resourcesV3.lessonId, lessonIds))
        : [],
      stepRows.length
        ? db
            .select()
            .from(resourcesV3)
            .where(
              inArray(
                resourcesV3.lessonStepId,
                stepRows.map((step) => step.id)
              )
            )
        : []
    ]);
    return {
      resources: [...courseResources, ...unitResources, ...lessonResources, ...stepResources]
    };
  });

  app.post('/v3/resources', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = ResourceInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    if (!(await resolveOwnedResourceCourseId(user.id, body))) {
      reply.code(404);
      return { error: 'The selected Resource target was not found.' };
    }
    const [resource] = await db
      .insert(resourcesV3)
      .values({ ...body, provider: detectResourceProvider(body.url) })
      .returning();
    return { resource };
  });

  app.get('/v3/lesson-templates', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const user = await ensureUserFromPrincipal(principal);
    const templates = await db
      .select()
      .from(lessonTemplates)
      .where(eq(lessonTemplates.teacherId, user.id))
      .orderBy(asc(lessonTemplates.title));
    const templateIds = templates.map((template) => template.id);
    const steps = templateIds.length
      ? await db
          .select()
          .from(lessonTemplateSteps)
          .where(inArray(lessonTemplateSteps.lessonTemplateId, templateIds))
          .orderBy(asc(lessonTemplateSteps.orderIndex))
      : [];
    return {
      templates: templates.map((template) => ({
        ...template,
        steps: steps.filter((step) => step.lessonTemplateId === template.id)
      }))
    };
  });

  app.post('/v3/lesson-templates', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const body = LessonTemplateInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const [template] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(lessonTemplates)
        .values({ teacherId: user.id, title: body.title, description: body.description })
        .returning();
      if (!created) throw new Error('Unable to create Lesson Template.');
      await tx.insert(lessonTemplateSteps).values(
        body.steps.map((step, orderIndex) => ({
          ...step,
          lessonTemplateId: created.id,
          orderIndex
        }))
      );
      return [created];
    });
    return { template };
  });

  app.post('/v3/lessons/:lessonId/apply-template/:templateId', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { lessonId } = LessonBankParams.parse(request.params);
    const { templateId } = TemplateParams.parse(request.params);
    const user = await ensureUserFromPrincipal(principal);
    const [lesson] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(units, eq(lessons.unitId, units.id))
      .innerJoin(courses, eq(units.courseId, courses.id))
      .where(and(eq(lessons.id, lessonId), eq(courses.teacherId, user.id)))
      .limit(1);
    const [template] = await db
      .select({ id: lessonTemplates.id })
      .from(lessonTemplates)
      .where(and(eq(lessonTemplates.id, templateId), eq(lessonTemplates.teacherId, user.id)))
      .limit(1);
    if (!lesson || !template) {
      reply.code(404);
      return { error: 'Lesson or Lesson Template not found.' };
    }
    const templateSteps = await db
      .select()
      .from(lessonTemplateSteps)
      .where(eq(lessonTemplateSteps.lessonTemplateId, template.id))
      .orderBy(asc(lessonTemplateSteps.orderIndex));
    const [lastStep] = await db
      .select({ orderIndex: lessonSteps.orderIndex })
      .from(lessonSteps)
      .where(eq(lessonSteps.lessonId, lesson.id))
      .orderBy(desc(lessonSteps.orderIndex));
    const nextOrder = (lastStep?.orderIndex ?? -1) + 1;
    const created = templateSteps.length
      ? await db
          .insert(lessonSteps)
          .values(
            templateSteps.map((step, index) => ({
              lessonId: lesson.id,
              title: step.title,
              description: step.description,
              estimatedMinutes: step.estimatedMinutes,
              isOptional: step.isOptional,
              orderIndex: nextOrder + index
            }))
          )
          .returning()
      : [];
    return { steps: created };
  });

  app.post(
    '/v3/class-groups/:classGroupId/meetings/recalculate',
    { schema: { response: { 200: MeetingGenerationPreviewSchema } } },
    async (request, reply) => {
      const principal = principalOrReply(request, reply);
      if (!principal) return;
      const { classGroupId } = GroupParams.parse(request.params);
      const body = z
        .object({ mode: z.enum(['preview', 'meetings_only', 'shift']).default('preview') })
        .parse(request.body);
      const user = await ensureUserFromPrincipal(principal);
      return recalculateMeetingInstances(user.id, classGroupId, body.mode);
    }
  );

  app.get('/v3/class-groups/:classGroupId/meetings', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { classGroupId } = GroupParams.parse(request.params);
    const user = await ensureUserFromPrincipal(principal);
    // Ownership is checked by the planning service before any data is returned.
    await getPlannedPercentage(user.id, classGroupId);
    const meetings = await db
      .select()
      .from(meetingInstances)
      .where(eq(meetingInstances.classGroupId, classGroupId))
      .orderBy(asc(meetingInstances.localDate), asc(meetingInstances.startTime));
    return { meetings: meetings.map(toMeetingInstance) };
  });

  app.get(
    '/v3/class-groups/:classGroupId/planning',
    { schema: { response: { 200: PlannedPercentageSchema } } },
    async (request, reply) => {
      const principal = principalOrReply(request, reply);
      if (!principal) return;
      const { classGroupId } = GroupParams.parse(request.params);
      const user = await ensureUserFromPrincipal(principal);
      return getPlannedPercentage(user.id, classGroupId);
    }
  );

  app.put('/v3/class-groups/:classGroupId/unit-plans/:unitId', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { classGroupId, unitId } = UnitParams.parse(request.params);
    const body = ClassGroupUnitPlanInputSchema.parse({ ...(request.body as object), unitId });
    const user = await ensureUserFromPrincipal(principal);
    const [group] = await db
      .select({ courseId: classGroups.courseId })
      .from(classGroups)
      .innerJoin(courses, eq(classGroups.courseId, courses.id))
      .where(and(eq(classGroups.id, classGroupId), eq(courses.teacherId, user.id)))
      .limit(1);
    const [unit] = await db
      .select({ courseId: units.courseId })
      .from(units)
      .where(eq(units.id, unitId))
      .limit(1);
    if (!group || group.courseId !== unit?.courseId) {
      reply.code(404);
      return { error: 'Class Group or Unit not found.' };
    }
    const [plan] = await db
      .insert(classGroupUnitPlans)
      .values({ classGroupId, ...body })
      .onConflictDoUpdate({
        target: [classGroupUnitPlans.classGroupId, classGroupUnitPlans.unitId],
        set: { ...body, updatedAt: new Date() }
      })
      .returning();
    return { plan };
  });

  app.post('/v3/class-groups/:classGroupId/allocations', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { classGroupId } = GroupParams.parse(request.params);
    const body = PlanAllocationInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const group = await ownedClassGroupCourse(user.id, classGroupId);
    if (!group) {
      reply.code(404);
      return { error: 'Class Group not found.' };
    }
    await assertLessonBelongsToCourse(group.courseId, body.lessonId, body.lessonStepId);
    await assertScheduledMeetingBelongsToGroup(classGroupId, body.meetingInstanceId);
    const [allocation] = await db
      .insert(planAllocations)
      .values({ classGroupId, ...body, orderIndex: body.orderIndex ?? 0 })
      .returning();
    return { allocation };
  });

  app.get('/v3/class-groups/:classGroupId/allocations', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { classGroupId } = GroupParams.parse(request.params);
    const user = await ensureUserFromPrincipal(principal);
    await getPlannedPercentage(user.id, classGroupId);
    const allocations = await db
      .select({
        id: planAllocations.id,
        meetingInstanceId: planAllocations.meetingInstanceId,
        lessonId: planAllocations.lessonId,
        lessonStepId: planAllocations.lessonStepId,
        orderIndex: planAllocations.orderIndex,
        notes: planAllocations.notes,
        lessonTitle: lessons.title
      })
      .from(planAllocations)
      .innerJoin(lessons, eq(planAllocations.lessonId, lessons.id))
      .where(eq(planAllocations.classGroupId, classGroupId))
      .orderBy(asc(planAllocations.orderIndex));
    return { allocations };
  });

  app.patch('/v3/allocations/:allocationId/move', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { allocationId } = AllocationParams.parse(request.params);
    const body = PlanAllocationMoveRequestSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const [allocation] = await db
      .select()
      .from(planAllocations)
      .where(eq(planAllocations.id, allocationId))
      .limit(1);
    if (!allocation) {
      reply.code(404);
      return { error: 'Plan Allocation not found.' };
    }
    const group = await ownedClassGroupCourse(user.id, allocation.classGroupId);
    if (!group) {
      reply.code(404);
      return { error: 'Plan Allocation not found.' };
    }
    await assertScheduledMeetingBelongsToGroup(
      allocation.classGroupId,
      body.targetMeetingInstanceId
    );
    const [sourceMeeting] = await db
      .select()
      .from(meetingInstances)
      .where(
        and(
          eq(meetingInstances.id, allocation.meetingInstanceId),
          eq(meetingInstances.classGroupId, allocation.classGroupId),
          eq(meetingInstances.state, 'scheduled')
        )
      )
      .limit(1);
    if (!sourceMeeting) {
      reply.code(409);
      return {
        error:
          'This allocation belongs to a historical or superseded Meeting and cannot be moved automatically.'
      };
    }
    const scheduledMeetings = await db
      .select()
      .from(meetingInstances)
      .where(
        and(
          eq(meetingInstances.classGroupId, allocation.classGroupId),
          eq(meetingInstances.state, 'scheduled')
        )
      )
      .orderBy(asc(meetingInstances.localDate), asc(meetingInstances.startTime));
    const sourceIndex = scheduledMeetings.findIndex((meeting) => meeting.id === sourceMeeting.id);
    const targetIndex = scheduledMeetings.findIndex(
      (meeting) => meeting.id === body.targetMeetingInstanceId
    );
    let shiftedAllocations = 0;
    await db.transaction(async (tx) => {
      if (body.shiftFollowing && sourceIndex >= 0 && targetIndex > sourceIndex) {
        const betweenIds = scheduledMeetings
          .slice(sourceIndex + 1, targetIndex + 1)
          .map((meeting) => meeting.id);
        if (betweenIds.length) {
          const following = await tx
            .select({
              id: planAllocations.id,
              meetingInstanceId: planAllocations.meetingInstanceId
            })
            .from(planAllocations)
            .where(
              and(
                eq(planAllocations.classGroupId, allocation.classGroupId),
                inArray(planAllocations.meetingInstanceId, betweenIds)
              )
            );
          const idsByMeeting = new Map<string, string[]>();
          for (const row of following)
            idsByMeeting.set(row.meetingInstanceId, [
              ...(idsByMeeting.get(row.meetingInstanceId) ?? []),
              row.id
            ]);
          for (let index = targetIndex; index > sourceIndex; index -= 1) {
            const ids = idsByMeeting.get(scheduledMeetings[index]!.id) ?? [];
            const destination = scheduledMeetings[index + 1];
            if (!ids.length || !destination) continue;
            await tx
              .update(planAllocations)
              .set({ meetingInstanceId: destination.id, updatedAt: new Date() })
              .where(inArray(planAllocations.id, ids));
            shiftedAllocations += ids.length;
          }
        }
      }
      await tx
        .update(planAllocations)
        .set({ meetingInstanceId: body.targetMeetingInstanceId, updatedAt: new Date() })
        .where(eq(planAllocations.id, allocationId));
    });
    const [updated] = await db
      .select()
      .from(planAllocations)
      .where(eq(planAllocations.id, allocationId))
      .limit(1);
    return { allocation: updated, shiftFollowing: body.shiftFollowing, shiftedAllocations };
  });

  app.get(
    '/v3/classroom',
    { schema: { response: { 200: ClassroomStateSchema } } },
    async (request, reply) => {
      const principal = principalOrReply(request, reply);
      if (!principal) return;
      const query = z
        .object({
          classGroupId: z.string().uuid().optional(),
          instant: z.string().datetime({ offset: true }).optional()
        })
        .parse(request.query);
      const user = await ensureUserFromPrincipal(principal);
      return getClassroomState(
        user.id,
        query.classGroupId,
        query.instant ? new Date(query.instant) : undefined
      );
    }
  );

  app.post('/v3/class-groups/:classGroupId/progress', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { classGroupId } = GroupParams.parse(request.params);
    const body = ClassroomProgressInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    return { progress: await saveLessonProgress(user.id, classGroupId, body) };
  });

  app.post('/v3/class-groups/:classGroupId/step-progress', async (request, reply) => {
    const principal = principalOrReply(request, reply);
    if (!principal) return;
    const { classGroupId } = StepParams.parse(request.params);
    const body = LessonStepProgressInputSchema.parse(request.body);
    const user = await ensureUserFromPrincipal(principal);
    const group = await ownedClassGroupCourse(user.id, classGroupId);
    if (!group) {
      reply.code(404);
      return { error: 'Class Group not found.' };
    }
    await assertStepBelongsToCourse(group.courseId, body.lessonStepId);
    if (body.meetingInstanceId)
      await assertScheduledMeetingBelongsToGroup(classGroupId, body.meetingInstanceId);
    const now = new Date();
    const [progress] = await db
      .insert(classGroupLessonStepProgress)
      .values({
        classGroupId,
        lessonStepId: body.lessonStepId,
        status: body.status,
        meetingInstanceId: body.meetingInstanceId,
        completedAt: body.status === 'completed' ? now : null,
        skippedAt: body.status === 'skipped' ? now : null
      })
      .onConflictDoUpdate({
        target: [
          classGroupLessonStepProgress.classGroupId,
          classGroupLessonStepProgress.lessonStepId
        ],
        set: {
          status: body.status,
          meetingInstanceId: body.meetingInstanceId,
          completedAt: body.status === 'completed' ? now : null,
          skippedAt: body.status === 'skipped' ? now : null,
          updatedAt: now
        }
      })
      .returning();
    return { progress };
  });
}
