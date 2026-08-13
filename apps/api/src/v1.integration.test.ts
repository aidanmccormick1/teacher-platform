import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aiJobs,
  classGroupLessonProgress,
  db,
  lessons,
  meetingInstances,
  planAllocations,
  pool,
  users
} from '@teacheros/db';

import { createApp } from './app.js';
import type { AppConfig } from './config.js';

let app: Awaited<ReturnType<typeof createApp>>;
const runIntegration = process.env.RUN_INTEGRATION_DB_TESTS === '1';
const describeIf = runIntegration ? describe : describe.skip;

const teacherHeaders = {
  'x-dev-user-id': 'teacher-dev-1',
  'x-dev-user-email': 'teacher1@example.com'
};

const otherTeacherHeaders = {
  'x-dev-user-id': 'teacher-dev-2',
  'x-dev-user-email': 'teacher2@example.com'
};

type V3Meeting = {
  id: string;
  localDate: string;
  startTime: string;
  endTime: string;
  meetingNumber: number;
  state: 'scheduled' | 'superseded' | 'cancelled';
};

const onboardingBody = {
  fullName: 'Teacher One',
  phone: null,
  workEmail: 'teacher1@example.com',
  schoolName: 'Integration Test School',
  district: 'Test District',
  state: 'CA',
  role: 'teacher' as const,
  subjects: ['Math'],
  grades: ['8']
};

async function runMigrations() {
  const migrationsDir = path.resolve(process.cwd(), '../../packages/db/migrations');
  const migrationFiles = [
    '0000_initial.sql',
    '0001_ai_jobs_cancel_status.sql',
    '0002_lesson_materials.sql',
    '0003_section_session_events.sql',
    '0004_schedule_templates_and_overrides.sql',
    '0005_teacher_notes_and_course_pacing.sql',
    '0006_teacheros_v3_calendar_foundation.sql'
  ];

  for (const fileName of migrationFiles) {
    const sql = await readFile(path.join(migrationsDir, fileName), 'utf8');
    await pool.query(sql);
  }
}

async function resetIntegrationSchema() {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

async function resetDatabase() {
  await pool.query(`
    TRUNCATE TABLE
      ai_outputs,
      ai_jobs,
      class_notes,
      teacher_notes,
      course_pacing_plans,
      lesson_template_steps,
      lesson_templates,
      resources_v3,
      meeting_history,
      class_group_unit_progress_overrides,
      class_group_lesson_step_progress,
      class_group_lesson_progress,
      plan_allocations,
      class_group_unit_plans,
      lesson_steps,
      meeting_instances,
      schedule_override_meetings_v3,
      schedule_overrides_v3,
      meeting_rule_days,
      meeting_rules,
      class_groups,
      calendar_events,
      academic_years,
      section_lesson_state,
      lesson_materials,
      lesson_segments,
      lessons,
      units,
      section_meetings,
      sections,
      courses,
      teacher_profiles,
      schools,
      users,
      audit_events
    RESTART IDENTITY CASCADE
  `);
}

async function createV3Fixture() {
  const onboarding = await app.inject({
    method: 'POST',
    url: '/v1/onboarding',
    headers: teacherHeaders,
    payload: onboardingBody
  });
  expect(onboarding.statusCode).toBe(200);

  const timezone = await app.inject({
    method: 'POST',
    url: '/v3/account/timezone/initialize',
    headers: teacherHeaders,
    payload: { timezone: 'America/Los_Angeles' }
  });
  expect(timezone.statusCode).toBe(200);

  const courseResponse = await app.inject({
    method: 'POST',
    url: '/v1/courses',
    headers: teacherHeaders,
    payload: { name: 'Shared Biology', subject: 'Science', gradeLevel: '10' }
  });
  expect(courseResponse.statusCode).toBe(200);
  const course = courseResponse.json<{ course: { id: string } }>().course;

  const unitResponse = await app.inject({
    method: 'POST',
    url: `/v1/courses/${course.id}/units`,
    headers: teacherHeaders,
    payload: { title: 'Cell Biology', description: null, orderIndex: 0 }
  });
  expect(unitResponse.statusCode).toBe(200);
  const unit = unitResponse.json<{ course: { units: Array<{ id: string }> } }>().course.units[0];
  if (!unit) throw new Error('Unit fixture was not created.');

  const lessonResponse = await app.inject({
    method: 'POST',
    url: `/v1/units/${unit.id}/lessons`,
    headers: teacherHeaders,
    payload: {
      title: 'Cell membrane transport',
      description: null,
      estimatedDurationMinutes: 45,
      estimatedMeetings: null,
      durationKind: 'minutes'
    }
  });
  expect(lessonResponse.statusCode).toBe(200);
  const lesson = lessonResponse
    .json<{ course: { units: Array<{ lessons: Array<{ id: string }> }> } }>()
    .course.units.flatMap((entry) => entry.lessons)[0];
  if (!lesson) throw new Error('Lesson fixture was not created.');

  const yearResponse = await app.inject({
    method: 'POST',
    url: '/v3/academic-years',
    headers: teacherHeaders,
    payload: {
      name: '2026–2027',
      startDate: '2026-10-12',
      endDate: '2026-10-23',
      isActive: true
    }
  });
  expect(yearResponse.statusCode).toBe(200);
  const year = yearResponse.json<{ year: { id: string } }>().year;

  const createGroup = async (name: string, startTime: string) => {
    const groupResponse = await app.inject({
      method: 'POST',
      url: '/v3/class-groups',
      headers: teacherHeaders,
      payload: {
        courseId: course.id,
        academicYearId: year.id,
        name,
        periodLabel: name,
        room: 'B-12',
        meetingRules: [
          {
            weekdays: [1, 3, 5],
            startTime,
            endTime: startTime === '10:00' ? '10:50' : '11:50',
            effectiveStart: null,
            effectiveEnd: null,
            room: 'B-12'
          }
        ]
      }
    });
    expect(groupResponse.statusCode).toBe(200);
    const group = groupResponse.json<{ classGroup: { id: string } }>().classGroup;
    const recalculate = await app.inject({
      method: 'POST',
      url: `/v3/class-groups/${group.id}/meetings/recalculate`,
      headers: teacherHeaders,
      payload: { mode: 'meetings_only' }
    });
    expect(recalculate.statusCode).toBe(200);
    const meetingsResponse = await app.inject({
      method: 'GET',
      url: `/v3/class-groups/${group.id}/meetings`,
      headers: teacherHeaders
    });
    expect(meetingsResponse.statusCode).toBe(200);
    return {
      group,
      meetings: meetingsResponse.json<{ meetings: V3Meeting[] }>().meetings
    };
  };

  const firstGroup = await createGroup('Period 3', '10:00');
  const secondGroup = await createGroup('Period 5', '11:00');
  return { course, unit, lesson, year, firstGroup, secondGroup };
}

describeIf('v1 integration (requires RUN_INTEGRATION_DB_TESTS=1 and local Postgres)', () => {
  beforeAll(async () => {
    await resetIntegrationSchema();
    await runMigrations();

    const config: AppConfig = {
      NODE_ENV: 'test',
      API_PORT: 3001,
      REQUEST_ID_HEADER: 'x-request-id',
      CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/teacheros_test',
      OPENAI_MODEL_CONTINUITY: 'gpt-5.6-luna',
      OPENAI_MODEL_GENERATE_SEGMENTS: 'gpt-5.6-luna',
      OPENAI_MODEL_PARSE_SCHEDULE: 'gpt-5.6-luna',
      REDIS_URL: undefined,
      OPENAI_API_KEY: undefined,
      CLERK_SECRET_KEY: undefined,
      S3_REGION: 'us-east-1',
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      SENTRY_DSN: undefined
    };

    app = await createApp(config);
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns an empty schedule setup state before a teacher completes onboarding', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/schedule',
      headers: teacherHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sections: [],
      holidays: [],
      blocks: [],
      overrides: [],
      hasScheduleSetup: false
    });
  });

  describe('v1 curriculum CRUD', () => {
    it('supports full nested curriculum CRUD for an onboarded teacher', async () => {
      const onboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      expect(onboarding.statusCode).toBe(200);

      const createCourse = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: {
          name: 'Algebra I',
          subject: 'Math',
          gradeLevel: '8'
        }
      });
      expect(createCourse.statusCode).toBe(200);
      const createdCourse = createCourse.json<{
        course: { id: string; name: string; units: Array<{ id: string }> };
      }>();
      expect(createdCourse.course.name).toBe('Algebra I');
      expect(createdCourse.course.units).toEqual([]);

      const createUnit = await app.inject({
        method: 'POST',
        url: `/v1/courses/${createdCourse.course.id}/units`,
        headers: teacherHeaders,
        payload: {
          title: 'Linear Equations',
          description: 'Solving one-step and two-step equations',
          orderIndex: 0
        }
      });
      expect(createUnit.statusCode).toBe(200);
      const withUnit = createUnit.json<{
        course: { units: Array<{ id: string; title: string; lessons: Array<{ id: string }> }> };
      }>();
      expect(withUnit.course.units).toHaveLength(1);
      expect(withUnit.course.units[0]?.title).toBe('Linear Equations');
      const unitId = withUnit.course.units[0]?.id ?? '';
      expect(unitId).not.toBe('');

      const createLesson = await app.inject({
        method: 'POST',
        url: `/v1/units/${unitId}/lessons`,
        headers: teacherHeaders,
        payload: {
          title: 'Solving for X',
          description: 'Balance method',
          estimatedDurationMinutes: 45
        }
      });
      expect(createLesson.statusCode).toBe(200);
      const withLesson = createLesson.json<{
        course: {
          units: Array<{
            id: string;
            lessons: Array<{ id: string; title: string; segments: Array<{ id: string }> }>;
          }>;
        };
      }>();
      const lesson = withLesson.course.units.find((item) => item.id === unitId)?.lessons[0];
      expect(lesson?.title).toBe('Solving for X');
      const lessonId = lesson?.id ?? '';
      expect(lessonId).not.toBe('');

      const createMaterial = await app.inject({
        method: 'POST',
        url: `/v1/lessons/${lessonId}/materials`,
        headers: teacherHeaders,
        payload: {
          label: 'Primary source packet',
          url: 'https://drive.google.com/file/d/example/view',
          kind: 'google_drive'
        }
      });
      expect(createMaterial.statusCode).toBe(200);
      const withMaterial = createMaterial.json<{
        course: {
          units: Array<{
            id: string;
            lessons: Array<{ id: string; materials: Array<{ label: string; kind: string }> }>;
          }>;
        };
      }>();
      const material = withMaterial.course.units
        .find((item) => item.id === unitId)
        ?.lessons.find((item) => item.id === lessonId)?.materials[0];
      expect(material?.label).toBe('Primary source packet');
      expect(material?.kind).toBe('google_drive');

      const createSegment = await app.inject({
        method: 'POST',
        url: `/v1/lessons/${lessonId}/segments`,
        headers: teacherHeaders,
        payload: {
          title: 'Do Now',
          description: 'Warm-up questions',
          durationMinutes: 7
        }
      });
      expect(createSegment.statusCode).toBe(200);
      const withSegment = createSegment.json<{
        course: {
          units: Array<{
            lessons: Array<{ id: string; segments: Array<{ id: string; title: string }> }>;
          }>;
        };
      }>();
      const segment = withSegment.course.units
        .flatMap((unit) => unit.lessons)
        .find((item) => item.id === lessonId)?.segments[0];
      expect(segment?.title).toBe('Do Now');
      const segmentId = segment?.id ?? '';
      expect(segmentId).not.toBe('');

      const updateSegment = await app.inject({
        method: 'PATCH',
        url: `/v1/segments/${segmentId}`,
        headers: teacherHeaders,
        payload: {
          title: 'Do Now + Attendance'
        }
      });
      expect(updateSegment.statusCode).toBe(200);

      const fetchCourse = await app.inject({
        method: 'GET',
        url: `/v1/courses/${createdCourse.course.id}`,
        headers: teacherHeaders
      });
      expect(fetchCourse.statusCode).toBe(200);
      const fetched = fetchCourse.json<{
        course: {
          units: Array<{
            lessons: Array<{ segments: Array<{ title: string }> }>;
          }>;
        };
      }>();
      expect(fetched.course.units[0]?.lessons[0]?.segments[0]?.title).toBe('Do Now + Attendance');

      const forbiddenFetch = await app.inject({
        method: 'GET',
        url: `/v1/courses/${createdCourse.course.id}`,
        headers: otherTeacherHeaders
      });
      expect(forbiddenFetch.statusCode).toBe(404);

      const deleteSegment = await app.inject({
        method: 'DELETE',
        url: `/v1/segments/${segmentId}`,
        headers: teacherHeaders
      });
      expect(deleteSegment.statusCode).toBe(200);
      expect(deleteSegment.json()).toEqual({ deleted: true });
    });
  });

  describe('v1 AI job controls', () => {
    it('supports cancel, retry, and status fields for AI jobs', async () => {
      const onboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      expect(onboarding.statusCode).toBe(200);

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, teacherHeaders['x-dev-user-id']))
        .limit(1);
      expect(user).toBeDefined();
      const userId = user?.id ?? '';
      expect(userId).not.toBe('');

      const [queuedJob] = await db
        .insert(aiJobs)
        .values({
          userId,
          type: 'parse_schedule',
          status: 'queued',
          input: { text: 'period 1 algebra' },
          cancelRequested: false
        })
        .returning({ id: aiJobs.id });
      expect(queuedJob).toBeDefined();

      const [runningJob] = await db
        .insert(aiJobs)
        .values({
          userId,
          type: 'generate_segments',
          status: 'running',
          input: { lessonTitle: 'Warm up', durationMinutes: 40 },
          cancelRequested: false
        })
        .returning({ id: aiJobs.id });
      expect(runningJob).toBeDefined();

      const [failedJob] = await db
        .insert(aiJobs)
        .values({
          userId,
          type: 'generate_continuity',
          status: 'failed',
          input: { lessonTitle: 'Recap block' },
          error: 'Timeout'
        })
        .returning({ id: aiJobs.id });
      expect(failedJob).toBeDefined();

      const fakeQueue = {
        add: vi.fn(async () => ({ id: failedJob?.id ?? 'x' })),
        remove: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        getJob: vi.fn(async (jobId: string) => {
          if (jobId === failedJob?.id) {
            return {
              attemptsMade: 2,
              opts: { attempts: 3 },
              progress: 70
            };
          }
          return null;
        })
      };
      (app as any).aiQueue = fakeQueue;

      const cancelQueued = await app.inject({
        method: 'POST',
        url: `/v1/ai/jobs/${queuedJob?.id}/cancel`,
        headers: teacherHeaders
      });
      expect(cancelQueued.statusCode).toBe(200);
      expect(cancelQueued.json()).toEqual({
        jobId: queuedJob?.id,
        status: 'cancelled',
        action: 'cancelled'
      });

      const cancelRunning = await app.inject({
        method: 'POST',
        url: `/v1/ai/jobs/${runningJob?.id}/cancel`,
        headers: teacherHeaders
      });
      expect(cancelRunning.statusCode).toBe(200);
      expect(cancelRunning.json()).toEqual({
        jobId: runningJob?.id,
        status: 'running',
        action: 'cancelled'
      });

      const [runningAfterCancel] = await db
        .select({
          cancelRequested: aiJobs.cancelRequested
        })
        .from(aiJobs)
        .where(eq(aiJobs.id, runningJob?.id ?? ''))
        .limit(1);
      expect(runningAfterCancel?.cancelRequested).toBe(true);

      const retryFailed = await app.inject({
        method: 'POST',
        url: `/v1/ai/jobs/${failedJob?.id}/retry`,
        headers: teacherHeaders
      });
      expect(retryFailed.statusCode).toBe(200);
      expect(retryFailed.json()).toEqual({
        jobId: failedJob?.id,
        status: 'queued',
        action: 'requeued'
      });
      expect(fakeQueue.add).toHaveBeenCalledTimes(1);

      const status = await app.inject({
        method: 'GET',
        url: `/v1/ai/jobs/${failedJob?.id}`,
        headers: teacherHeaders
      });
      expect(status.statusCode).toBe(200);
      const payload = status.json<{
        status: string;
        canCancel: boolean;
        canRetry: boolean;
        attemptsMade: number;
        maxAttempts: number;
        progressPercent: number;
        cancelRequested: boolean;
        error: string | null;
      }>();

      expect(payload.status).toBe('queued');
      expect(payload.canCancel).toBe(true);
      expect(payload.canRetry).toBe(false);
      expect(payload.attemptsMade).toBe(2);
      expect(payload.maxAttempts).toBe(3);
      expect(payload.progressPercent).toBe(70);
      expect(payload.cancelRequested).toBe(false);
      expect(payload.error).toBeNull();

      const [retriedJob] = await db
        .select({
          status: aiJobs.status,
          cancelRequested: aiJobs.cancelRequested
        })
        .from(aiJobs)
        .where(and(eq(aiJobs.id, failedJob?.id ?? ''), eq(aiJobs.userId, userId)))
        .limit(1);

      expect(retriedJob?.status).toBe('queued');
      expect(retriedJob?.cancelRequested).toBe(false);
    });
  });

  describe('v3 calendar-first persistence', () => {
    it('initializes an account timezone once and permits only an explicit later change', async () => {
      const account = await app.inject({
        method: 'GET',
        url: '/v3/account',
        headers: teacherHeaders
      });
      expect(account.statusCode).toBe(200);
      expect(account.json()).toEqual({ timezone: null });

      const initialized = await app.inject({
        method: 'POST',
        url: '/v3/account/timezone/initialize',
        headers: teacherHeaders,
        payload: { timezone: 'America/Los_Angeles' }
      });
      expect(initialized.statusCode).toBe(200);
      expect(initialized.json()).toEqual({ timezone: 'America/Los_Angeles' });

      const travelingBrowser = await app.inject({
        method: 'POST',
        url: '/v3/account/timezone/initialize',
        headers: teacherHeaders,
        payload: { timezone: 'America/New_York' }
      });
      expect(travelingBrowser.statusCode).toBe(200);
      expect(travelingBrowser.json()).toEqual({ timezone: 'America/Los_Angeles' });

      const edited = await app.inject({
        method: 'PATCH',
        url: '/v3/account/timezone',
        headers: teacherHeaders,
        payload: { timezone: 'America/New_York' }
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toEqual({ timezone: 'America/New_York' });
    });

    it('preserves history, remaps planned curriculum, applies exclusions before overrides, and keeps Class Group state isolated', async () => {
      const { course, lesson, year, firstGroup, secondGroup } = await createV3Fixture();
      const historicalMeeting = firstGroup.meetings.find(
        (meeting) => meeting.localDate === '2026-10-12'
      );
      const plannedMeeting = firstGroup.meetings.find(
        (meeting) => meeting.localDate === '2026-10-14'
      );
      expect(historicalMeeting).toBeDefined();
      expect(plannedMeeting).toBeDefined();

      const allocationResponse = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/allocations`,
        headers: teacherHeaders,
        payload: {
          meetingInstanceId: plannedMeeting?.id,
          lessonId: lesson.id,
          lessonStepId: null,
          notes: 'Teach after the holiday',
          orderIndex: 0
        }
      });
      expect(allocationResponse.statusCode).toBe(200);
      const allocation = allocationResponse.json<{ allocation: { id: string } }>().allocation;

      const progress = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/progress`,
        headers: teacherHeaders,
        payload: {
          lessonId: lesson.id,
          status: 'in_progress',
          meetingInstanceId: historicalMeeting?.id,
          manualOverride: false,
          notes: null
        }
      });
      expect(progress.statusCode).toBe(200);

      for (const [date, label] of [
        ['2026-10-12', 'Recorded class day'],
        ['2026-10-14', 'Holiday'],
        ['2026-10-19', 'School closure']
      ]) {
        const event = await app.inject({
          method: 'POST',
          url: `/v3/academic-years/${year.id}/calendar-events`,
          headers: teacherHeaders,
          payload: { startDate: date, endDate: date, label, type: 'holiday', instructional: false }
        });
        expect(event.statusCode).toBe(200);
      }

      const override = await app.inject({
        method: 'POST',
        url: `/v3/academic-years/${year.id}/schedule-overrides`,
        headers: teacherHeaders,
        payload: {
          date: '2026-10-19',
          label: 'Minimum day that must not recreate instruction',
          type: 'minimum_day',
          meetings: [
            {
              classGroupId: firstGroup.group.id,
              action: 'replace',
              startTime: '09:20',
              endTime: '09:55',
              room: 'B-12'
            }
          ]
        }
      });
      expect(override.statusCode).toBe(200);

      const preview = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/meetings/recalculate`,
        headers: teacherHeaders,
        payload: { mode: 'preview' }
      });
      expect(preview.statusCode).toBe(200);
      expect(
        preview.json<{ affectedPlanned: number; historicalPreserved: number }>().affectedPlanned
      ).toBe(1);
      expect(
        preview.json<{ historicalPreserved: number }>().historicalPreserved
      ).toBeGreaterThanOrEqual(1);

      const shifted = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/meetings/recalculate`,
        headers: teacherHeaders,
        payload: { mode: 'shift' }
      });
      expect(shifted.statusCode).toBe(200);

      const meetingsResponse = await app.inject({
        method: 'GET',
        url: `/v3/class-groups/${firstGroup.group.id}/meetings`,
        headers: teacherHeaders
      });
      const meetings = meetingsResponse.json<{ meetings: V3Meeting[] }>().meetings;
      expect(meetings.some((meeting) => meeting.localDate === '2026-10-12')).toBe(true);
      expect(meetings.some((meeting) => meeting.localDate === '2026-10-14')).toBe(false);
      expect(meetings.some((meeting) => meeting.localDate === '2026-10-19')).toBe(false);

      const [remapped] = await db
        .select({
          allocationId: planAllocations.id,
          meetingId: meetingInstances.id,
          localDate: meetingInstances.localDate,
          state: meetingInstances.state
        })
        .from(planAllocations)
        .innerJoin(meetingInstances, eq(planAllocations.meetingInstanceId, meetingInstances.id))
        .where(eq(planAllocations.id, allocation.id))
        .limit(1);
      expect(remapped).toMatchObject({
        allocationId: allocation.id,
        localDate: '2026-10-16',
        state: 'scheduled'
      });

      const target = meetings.find((meeting) => meeting.localDate === '2026-10-21');
      expect(target).toBeDefined();
      const moved = await app.inject({
        method: 'PATCH',
        url: `/v3/allocations/${allocation.id}/move`,
        headers: teacherHeaders,
        payload: { targetMeetingInstanceId: target?.id, shiftFollowing: false }
      });
      expect(moved.statusCode).toBe(200);
      const undone = await app.inject({
        method: 'PATCH',
        url: `/v3/allocations/${allocation.id}/move`,
        headers: teacherHeaders,
        payload: { targetMeetingInstanceId: remapped?.meetingId, shiftFollowing: false }
      });
      expect(undone.statusCode).toBe(200);

      const progressRows = await db
        .select({ classGroupId: classGroupLessonProgress.classGroupId })
        .from(classGroupLessonProgress)
        .where(eq(classGroupLessonProgress.lessonId, lesson.id));
      expect(progressRows).toEqual([{ classGroupId: firstGroup.group.id }]);
      expect(secondGroup.group.id).not.toBe(firstGroup.group.id);

      const otherOnboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: otherTeacherHeaders,
        payload: { ...onboardingBody, fullName: 'Teacher Two', workEmail: 'teacher2@example.com' }
      });
      expect(otherOnboarding.statusCode).toBe(200);
      const hiddenGroups = await app.inject({
        method: 'GET',
        url: `/v3/class-groups?academicYearId=${year.id}`,
        headers: otherTeacherHeaders
      });
      expect(hiddenGroups.statusCode).toBe(200);
      expect(hiddenGroups.json<{ classGroups: unknown[] }>().classGroups).toEqual([]);
      const forbiddenAllocation = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/allocations`,
        headers: otherTeacherHeaders,
        payload: {
          meetingInstanceId: remapped?.meetingId,
          lessonId: lesson.id,
          lessonStepId: null,
          notes: null
        }
      });
      expect(forbiddenAllocation.statusCode).toBe(404);
      expect(course.id).toBeTruthy();
    });

    it('previews weekday-box changes without writing them, then persists the reviewed Class Group schedule', async () => {
      const { course, firstGroup } = await createV3Fixture();
      const before = firstGroup.meetings;
      expect(before.filter((meeting) => meeting.localDate === '2026-10-16')).toHaveLength(1);

      const preview = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/meeting-impact-preview`,
        headers: teacherHeaders,
        payload: {
          name: 'Period 3',
          periodLabel: 'Period 3',
          room: 'B-12',
          meetingRules: [
            {
              weekdays: [1, 3],
              startTime: '10:00',
              endTime: '10:50',
              effectiveStart: null,
              effectiveEnd: null,
              room: 'B-12'
            }
          ]
        }
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json<{ removedUnused: number }>().removedUnused).toBe(2);

      const unchanged = await app.inject({
        method: 'GET',
        url: `/v3/class-groups/${firstGroup.group.id}/meetings`,
        headers: teacherHeaders
      });
      expect(unchanged.json<{ meetings: V3Meeting[] }>().meetings).toHaveLength(before.length);

      const update = await app.inject({
        method: 'PATCH',
        url: `/v3/class-groups/${firstGroup.group.id}`,
        headers: teacherHeaders,
        payload: {
          name: 'Period 3',
          periodLabel: 'Period 3',
          room: 'B-12',
          meetingRules: [
            {
              weekdays: [1, 3],
              startTime: '10:00',
              endTime: '10:50',
              effectiveStart: null,
              effectiveEnd: null,
              room: 'B-12'
            }
          ]
        }
      });
      expect(update.statusCode).toBe(200);
      expect(update.json<{ requiresRecalculation: boolean }>().requiresRecalculation).toBe(true);

      const applied = await app.inject({
        method: 'POST',
        url: `/v3/class-groups/${firstGroup.group.id}/meetings/recalculate`,
        headers: teacherHeaders,
        payload: { mode: 'meetings_only' }
      });
      expect(applied.statusCode).toBe(200);
      const after = await app.inject({
        method: 'GET',
        url: `/v3/class-groups/${firstGroup.group.id}/meetings`,
        headers: teacherHeaders
      });
      expect(
        after
          .json<{ meetings: V3Meeting[] }>()
          .meetings.some((meeting) => meeting.localDate === '2026-10-16')
      ).toBe(false);

      const forbidden = await app.inject({
        method: 'PATCH',
        url: `/v3/class-groups/${firstGroup.group.id}`,
        headers: otherTeacherHeaders,
        payload: { name: 'Not this teacher’s class' }
      });
      expect(forbidden.statusCode).toBe(404);
      expect(course.id).toBeTruthy();
    });

    it('reindexes sibling Lesson order inside a persisted transaction', async () => {
      const onboarding = await app.inject({
        method: 'POST',
        url: '/v1/onboarding',
        headers: teacherHeaders,
        payload: onboardingBody
      });
      expect(onboarding.statusCode).toBe(200);
      const courseResponse = await app.inject({
        method: 'POST',
        url: '/v1/courses',
        headers: teacherHeaders,
        payload: { name: 'Reindexing', subject: 'Math', gradeLevel: '8' }
      });
      const courseId = courseResponse.json<{ course: { id: string } }>().course.id;
      const unitResponse = await app.inject({
        method: 'POST',
        url: `/v1/courses/${courseId}/units`,
        headers: teacherHeaders,
        payload: { title: 'Order', description: null, orderIndex: 0 }
      });
      const unitId = unitResponse.json<{ course: { units: Array<{ id: string }> } }>().course
        .units[0]?.id;
      expect(unitId).toBeTruthy();
      for (const title of ['First', 'Second', 'Third']) {
        const lesson = await app.inject({
          method: 'POST',
          url: `/v1/units/${unitId}/lessons`,
          headers: teacherHeaders,
          payload: {
            title,
            description: null,
            estimatedDurationMinutes: null,
            estimatedMeetings: null,
            durationKind: null
          }
        });
        expect(lesson.statusCode).toBe(200);
      }
      const detail = await app.inject({
        method: 'GET',
        url: `/v1/courses/${courseId}`,
        headers: teacherHeaders
      });
      const lessonIds = detail
        .json<{ course: { units: Array<{ lessons: Array<{ id: string }> }> } }>()
        .course.units[0]?.lessons.map((lesson) => lesson.id);
      expect(lessonIds).toHaveLength(3);
      const reorderedIds = [lessonIds?.[2], lessonIds?.[0], lessonIds?.[1]];
      const reorder = await app.inject({
        method: 'PUT',
        url: `/v1/units/${unitId}/lessons/order`,
        headers: teacherHeaders,
        payload: { lessonIds: reorderedIds }
      });
      expect(reorder.statusCode).toBe(200);
      const persisted = await db
        .select({ id: lessons.id, orderIndex: lessons.orderIndex })
        .from(lessons)
        .where(eq(lessons.unitId, unitId ?? ''))
        .orderBy(asc(lessons.orderIndex));
      expect(persisted.map((lesson) => lesson.id)).toEqual(reorderedIds);
      expect(persisted.map((lesson) => lesson.orderIndex)).toEqual([0, 1, 2]);
    });
  });
});
