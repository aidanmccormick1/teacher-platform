import { useMemo } from 'react';

import type {
  AiJobControlResponse,
  AiJobEnqueueResponse,
  AiJobStatusResponse,
  AcademicCalendarParseRequest,
  AcademicCalendarParseResponse,
  ClassroomCheckinResolveRequest,
  ClassroomCheckinResolveResponse,
  ClassroomCheckinResponse,
  ClassNotesUpsertRequest,
  ClassNotesUpsertResponse,
  CourseCreateRequest,
  CourseDetailResponse,
  CoursePacingPlanUpsertRequest,
  CourseListResponse,
  CourseUpdateRequest,
  DashboardTodayResponse,
  DeleteEntityResponse,
  GenerateContinuityRequest,
  GenerateContinuityResponse,
  GenerateActivityRequest,
  GenerateActivityResponse,
  GenerateSegmentsRequest,
  GenerateSegmentsResponse,
  GenerateSemesterRequest,
  GenerateSemesterResponse,
  GetScheduleResponse,
  HolidaysUpsertRequest,
  HolidaysUpsertResponse,
  LessonProgressUpsertRequest,
  LessonProgressUpsertResponse,
  LessonCreateRequest,
  LessonMaterialCreateRequest,
  LessonReorderRequest,
  LessonUpdateRequest,
  OnboardingRequest,
  OnboardingResponse,
  ParseScheduleResponse,
  SegmentCreateRequest,
  SegmentUpdateRequest,
  ScheduleImportRequest,
  ScheduleSetupApplyRequest,
  ScheduleSetupApplyResponse,
  ScheduleSetupSource,
  WeeklyScheduleProposal,
  AnnualCalendarProposal,
  TeachingDataImportApplyRequest,
  TeachingDataImportApplyResponse,
  TeacherNote,
  TeacherNoteCreateRequest,
  TeacherNotesResponse,
  TeacherNoteUpdateRequest,
  UnitCreateRequest,
  UnitUpdateRequest
} from '@teacheros/contracts';

import { useAppAuth } from './auth.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const AI_IMPORT_REQUEST_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function request<TResponse>(
  path: string,
  init: RequestInit,
  auth: ReturnType<typeof useAppAuth>,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<TResponse> {
  const token = await auth.getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (auth.mode === 'dev' && auth.userId) {
    headers.set('x-dev-user-id', auth.userId);
    if (auth.email) headers.set('x-dev-user-email', auth.email);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const retries = options.retries ?? 0;
  let response: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
      break;
    } catch (error) {
      if (attempt === retries) {
        const timedOut = error instanceof DOMException && error.name === 'AbortError';
        throw new ApiError(
          timedOut
            ? 'This is taking longer than expected. Please try again in a moment.'
            : 'We could not reach TeacherOS. Check your connection and try again.',
          timedOut ? 504 : 503
        );
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  if (!response) throw new ApiError('We could not reach TeacherOS. Please try again.', 503);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status);
  }

  return (await response.json()) as TResponse;
}

export function useApiClient() {
  const auth = useAppAuth();

  return useMemo(
    () => ({
      onboarding: (body: OnboardingRequest) =>
        request<OnboardingResponse>(
          '/v1/onboarding',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      dashboardToday: () =>
        request<DashboardTodayResponse>('/v1/dashboard/today', { method: 'GET' }, auth),
      classroomCheckin: () =>
        request<ClassroomCheckinResponse>('/v1/classroom/check-in', { method: 'GET' }, auth),
      resolveClassroomCheckin: (body: ClassroomCheckinResolveRequest) =>
        request<ClassroomCheckinResolveResponse>(
          '/v1/classroom/check-in',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      getSchedule: () => request<GetScheduleResponse>('/v1/schedule', { method: 'GET' }, auth),
      listCourses: () => request<CourseListResponse>('/v1/courses', { method: 'GET' }, auth),
      getCourseDetail: (courseId: string) =>
        request<CourseDetailResponse>(`/v1/courses/${courseId}`, { method: 'GET' }, auth),
      createCourse: (body: CourseCreateRequest) =>
        request<CourseDetailResponse>(
          '/v1/courses',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateCourse: (courseId: string, body: CourseUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/courses/${courseId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      updateCoursePacingPlan: (courseId: string, body: CoursePacingPlanUpsertRequest) =>
        request<CourseDetailResponse>(
          `/v1/courses/${courseId}/pacing-plan`,
          { method: 'PUT', body: JSON.stringify(body) },
          auth
        ),
      deleteCourse: (courseId: string) =>
        request<DeleteEntityResponse>(`/v1/courses/${courseId}`, { method: 'DELETE' }, auth),
      createUnit: (courseId: string, body: UnitCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/courses/${courseId}/units`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateUnit: (unitId: string, body: UnitUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/units/${unitId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteUnit: (unitId: string) =>
        request<DeleteEntityResponse>(`/v1/units/${unitId}`, { method: 'DELETE' }, auth),
      createLesson: (unitId: string, body: LessonCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/units/${unitId}/lessons`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      reorderLessons: (unitId: string, body: LessonReorderRequest) =>
        request<CourseDetailResponse>(
          `/v1/units/${unitId}/lessons/order`,
          { method: 'PUT', body: JSON.stringify(body) },
          auth
        ),
      createLessonMaterial: (lessonId: string, body: LessonMaterialCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/lessons/${lessonId}/materials`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateLesson: (lessonId: string, body: LessonUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/lessons/${lessonId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteLesson: (lessonId: string) =>
        request<DeleteEntityResponse>(`/v1/lessons/${lessonId}`, { method: 'DELETE' }, auth),
      deleteLessonMaterial: (materialId: string) =>
        request<DeleteEntityResponse>(`/v1/materials/${materialId}`, { method: 'DELETE' }, auth),
      createSegment: (lessonId: string, body: SegmentCreateRequest) =>
        request<CourseDetailResponse>(
          `/v1/lessons/${lessonId}/segments`,
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateSegment: (segmentId: string, body: SegmentUpdateRequest) =>
        request<CourseDetailResponse>(
          `/v1/segments/${segmentId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteSegment: (segmentId: string) =>
        request<DeleteEntityResponse>(`/v1/segments/${segmentId}`, { method: 'DELETE' }, auth),
      importSchedule: (body: ScheduleImportRequest) =>
        request<ParseScheduleResponse>(
          '/v1/schedule/import',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      parseAcademicCalendar: (body: AcademicCalendarParseRequest) =>
        request<AcademicCalendarParseResponse>(
          '/v1/academic-calendar/parse',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      applyTeachingDataImport: (body: TeachingDataImportApplyRequest) =>
        request<TeachingDataImportApplyResponse>(
          '/v1/schedule/import/apply',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      parseWeeklyScheduleSetup: (body: ScheduleSetupSource) =>
        request<WeeklyScheduleProposal>(
          '/v1/schedule/setup/weekly/parse',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          { timeoutMs: AI_IMPORT_REQUEST_TIMEOUT_MS, retries: 1 }
        ),
      parseAnnualCalendarSetup: (body: ScheduleSetupSource) =>
        request<AnnualCalendarProposal>(
          '/v1/schedule/setup/calendar/parse',
          { method: 'POST', body: JSON.stringify(body) },
          auth,
          { timeoutMs: AI_IMPORT_REQUEST_TIMEOUT_MS, retries: 1 }
        ),
      applyScheduleSetup: (body: ScheduleSetupApplyRequest) =>
        request<ScheduleSetupApplyResponse>(
          '/v1/schedule/setup/apply',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      enqueueParseSchedule: (body: ScheduleImportRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/parse-schedule/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      enqueueGenerateSegments: (body: GenerateSegmentsRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/generate-segments/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      enqueueGenerateContinuity: (body: GenerateContinuityRequest) =>
        request<AiJobEnqueueResponse>(
          '/v1/ai/generate-continuity/queue',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      getAiJobStatus: (jobId: string) =>
        request<AiJobStatusResponse>(`/v1/ai/jobs/${jobId}`, { method: 'GET' }, auth),
      cancelAiJob: (jobId: string) =>
        request<AiJobControlResponse>(`/v1/ai/jobs/${jobId}/cancel`, { method: 'POST' }, auth),
      retryAiJob: (jobId: string) =>
        request<AiJobControlResponse>(`/v1/ai/jobs/${jobId}/retry`, { method: 'POST' }, auth),
      upsertHolidays: (body: HolidaysUpsertRequest) =>
        request<HolidaysUpsertResponse>(
          '/v1/holidays',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      upsertLessonProgress: (body: LessonProgressUpsertRequest) =>
        request<LessonProgressUpsertResponse>(
          '/v1/lesson-progress/upsert',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      upsertClassNote: (body: ClassNotesUpsertRequest) =>
        request<ClassNotesUpsertResponse>(
          '/v1/class-notes/upsert',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      listTeacherNotes: () =>
        request<TeacherNotesResponse>('/v1/teacher-notes', { method: 'GET' }, auth),
      createTeacherNote: (body: TeacherNoteCreateRequest) =>
        request<TeacherNote>(
          '/v1/teacher-notes',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      updateTeacherNote: (noteId: string, body: TeacherNoteUpdateRequest) =>
        request<TeacherNote>(
          `/v1/teacher-notes/${noteId}`,
          { method: 'PATCH', body: JSON.stringify(body) },
          auth
        ),
      deleteTeacherNote: (noteId: string) =>
        request<DeleteEntityResponse>(`/v1/teacher-notes/${noteId}`, { method: 'DELETE' }, auth),
      generateSegments: (body: GenerateSegmentsRequest) =>
        request<GenerateSegmentsResponse>(
          '/v1/ai/generate-segments',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      generateActivity: (body: GenerateActivityRequest) =>
        request<GenerateActivityResponse>(
          '/v1/ai/generate-activity',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      generateSemester: (body: GenerateSemesterRequest) =>
        request<GenerateSemesterResponse>(
          '/v1/ai/generate-semester',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        ),
      generateContinuity: (body: GenerateContinuityRequest) =>
        request<GenerateContinuityResponse>(
          '/v1/ai/generate-continuity',
          { method: 'POST', body: JSON.stringify(body) },
          auth
        )
    }),
    [auth]
  );
}
