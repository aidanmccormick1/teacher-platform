import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const MeetingDaySchema = z.enum([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'A-Day',
  'B-Day'
]);

export const SectionMeetingSchema = z.object({
  day: MeetingDaySchema,
  time: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable().default(null),
  room: z.string().nullable()
});

export const ScheduleBlockKindSchema = z.enum([
  'homeroom',
  'lunch',
  'break',
  'planning',
  'duty',
  'meeting',
  'dismissal',
  'other'
]);

export const ScheduleBlockProposalSchema = z.object({
  day: MeetingDaySchema,
  startTime: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable(),
  label: z.string().min(1),
  kind: ScheduleBlockKindSchema
});

export const ScheduleMeetingProposalSchema = z.object({
  day: MeetingDaySchema,
  startTime: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable(),
  room: z.string().nullable()
});

export const ScheduleSectionProposalSchema = z.object({
  name: z.string().min(1),
  meetings: z.array(ScheduleMeetingProposalSchema).min(1)
});

export const ScheduleCourseProposalSchema = z.object({
  name: z.string().min(1),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  sections: z.array(ScheduleSectionProposalSchema).min(1)
});

export const ScheduleDateOverrideKindSchema = z.enum([
  'no_school',
  'early_release',
  'assembly',
  'testing',
  'special_schedule',
  'other'
]);

export const ScheduleDateOverrideMeetingSchema = z.object({
  courseName: z.string().min(1),
  sectionName: z.string().min(1),
  startTime: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable(),
  room: z.string().nullable()
});

export const ScheduleDateOverrideProposalSchema = z.object({
  date: IsoDateSchema,
  label: z.string().min(1),
  kind: ScheduleDateOverrideKindSchema,
  rotationDay: z.enum(['A-Day', 'B-Day']).nullable(),
  replaceWeeklySchedule: z.boolean().default(false),
  meetings: z.array(ScheduleDateOverrideMeetingSchema).default([])
});

export const WeeklyScheduleProposalSchema = z.object({
  courses: z.array(ScheduleCourseProposalSchema),
  blocks: z.array(ScheduleBlockProposalSchema),
  warnings: z.array(z.string())
});

export const AnnualCalendarProposalSchema = z.object({
  overrides: z.array(ScheduleDateOverrideProposalSchema),
  warnings: z.array(z.string())
});

export const ScheduleClassSchema = z.object({
  name: z.string().min(1),
  period: z.string().min(1),
  days: z.array(MeetingDaySchema).min(1),
  time: IsoTimeSchema.nullable(),
  endTime: IsoTimeSchema.nullable(),
  room: z.string().nullable(),
  subject: z.string().min(1),
  grade: z.string().optional().default('')
});

export const AssignmentItemSchema = z.object({
  name: z.string().min(1),
  courseName: z.string().min(1),
  dueDate: IsoDateSchema.nullable(),
  description: z.string().nullable()
});

export const OnboardingRequestSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().nullable(),
  workEmail: z.string().email().nullable(),
  schoolName: z.string().min(1),
  district: z.string().nullable(),
  state: z.string().nullable(),
  role: z.enum(['teacher', 'department_head', 'admin']).default('teacher'),
  subjects: z.array(z.string()).default([]),
  grades: z.array(z.string()).default([])
});

export const OnboardingResponseSchema = z.object({
  userId: UuidSchema,
  schoolId: UuidSchema,
  onboarded: z.literal(true)
});

export const DashboardTodayResponseSchema = z.object({
  date: IsoDateSchema,
  currentClass: z
    .object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      meetingEndTime: IsoTimeSchema.nullable(),
      room: z.string().nullable()
    })
    .nullable(),
  nextClass: z
    .object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      meetingEndTime: IsoTimeSchema.nullable()
    })
    .nullable(),
  todaySchedule: z.array(
    z.object({
      sectionId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetingTime: IsoTimeSchema.nullable(),
      meetingEndTime: IsoTimeSchema.nullable(),
      room: z.string().nullable(),
      isInSession: z.boolean()
    })
  ),
  holiday: z
    .object({
      id: UuidSchema,
      date: IsoDateSchema,
      name: z.string()
    })
    .nullable(),
  specialDay: z
    .object({
      label: z.string(),
      kind: ScheduleDateOverrideKindSchema
    })
    .nullable(),
  needsScheduleSetup: z.boolean().default(false)
});

export const ClassSessionOutcomeSchema = z.enum(['taught', 'substitute', 'cancelled', 'shortened']);

export const ClassroomCheckinPendingSchema = z.object({
  sectionId: UuidSchema,
  sessionDate: IsoDateSchema,
  courseName: z.string(),
  sectionName: z.string(),
  meetingTime: IsoTimeSchema.nullable()
});

export const ClassroomCheckinResponseSchema = z.object({
  pendingSessions: z.array(ClassroomCheckinPendingSchema)
});

export const ClassroomCheckinResolveRequestSchema = z.object({
  sectionId: UuidSchema,
  sessionDate: IsoDateSchema,
  outcome: ClassSessionOutcomeSchema,
  coveredPlannedLesson: z.boolean().default(false),
  note: z.string().nullable()
});

export const ClassroomCheckinResolveResponseSchema = z.object({
  eventId: UuidSchema,
  carryForward: z.boolean(),
  message: z.string()
});

export const GetScheduleResponseSchema = z.object({
  sections: z.array(
    z.object({
      sectionId: UuidSchema,
      courseId: UuidSchema,
      courseName: z.string(),
      sectionName: z.string(),
      meetings: z.array(SectionMeetingSchema)
    })
  ),
  holidays: z.array(
    z.object({
      id: UuidSchema,
      date: IsoDateSchema,
      name: z.string()
    })
  ),
  blocks: z.array(
    z.object({
      day: MeetingDaySchema,
      startTime: IsoTimeSchema.nullable(),
      endTime: IsoTimeSchema.nullable(),
      label: z.string(),
      kind: ScheduleBlockKindSchema
    })
  ),
  overrides: z.array(ScheduleDateOverrideProposalSchema),
  hasScheduleSetup: z.boolean()
});

export const ScheduleSetupSourceSchema = z
  .object({
    text: z.string().min(1).optional(),
    imageBase64: z.string().min(1).optional(),
    imageBase64s: z.array(z.string().min(1)).min(1).max(3).optional()
  })
  .refine((value) => Boolean(value.text || value.imageBase64 || value.imageBase64s?.length), {
    message: 'text, imageBase64, or imageBase64s is required'
  });

export const ParseWeeklyScheduleResponseSchema = WeeklyScheduleProposalSchema;
export const ParseAnnualCalendarResponseSchema = AnnualCalendarProposalSchema;

export const ScheduleSetupApplyRequestSchema = z.object({
  weekly: WeeklyScheduleProposalSchema,
  annualCalendar: AnnualCalendarProposalSchema.optional()
});

export const ScheduleSetupApplyResponseSchema = z.object({
  coursesCreated: z.number().int().nonnegative(),
  sectionsCreated: z.number().int().nonnegative(),
  meetingsSaved: z.number().int().nonnegative(),
  blocksSaved: z.number().int().nonnegative(),
  overridesSaved: z.number().int().nonnegative()
});

export const ScheduleImportRequestSchema = z.object({
  text: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional()
});

export const ScheduleImportResponseSchema = z.object({
  classes: z.array(ScheduleClassSchema),
  assignments: z.array(AssignmentItemSchema)
});

export const AcademicCalendarParseRequestSchema = z
  .object({
    text: z.string().min(1).optional(),
    imageBase64: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.text || value.imageBase64), {
    message: 'text or imageBase64 is required'
  });

export const AcademicCalendarParseResponseSchema = z.object({
  holidays: z.array(
    z.object({
      date: IsoDateSchema,
      name: z.string().min(1)
    })
  )
});

export const TeachingDataImportApplyRequestSchema = z.object({
  classes: z.array(ScheduleClassSchema),
  holidays: z.array(
    z.object({
      date: IsoDateSchema,
      name: z.string().min(1)
    })
  )
});

export const TeachingDataImportApplyResponseSchema = z.object({
  coursesCreated: z.number().int().nonnegative(),
  sectionsCreated: z.number().int().nonnegative(),
  meetingsCreated: z.number().int().nonnegative(),
  holidaysSaved: z.number().int().nonnegative()
});

export const HolidaysUpsertRequestSchema = z.object({
  holidays: z.array(
    z.object({
      date: IsoDateSchema,
      name: z.string().min(1)
    })
  )
});

export const HolidaysUpsertResponseSchema = z.object({
  count: z.number().int().nonnegative()
});

export const LessonProgressStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'stopped_at_segment',
  'completed',
  'carried_over',
  'skipped',
  'needs_reteach'
]);

export const LessonProgressUpsertRequestSchema = z.object({
  sectionId: UuidSchema,
  lessonId: UuidSchema,
  status: LessonProgressStatusSchema,
  currentSegmentId: UuidSchema.nullable(),
  stoppedAtSegmentId: UuidSchema.nullable(),
  completedSegmentIds: z.array(UuidSchema),
  carryOverNote: z.string().nullable(),
  lastTaughtDate: IsoDateSchema.nullable()
});

export const LessonProgressUpsertResponseSchema = z.object({
  stateId: UuidSchema,
  updatedAt: z.string()
});

export const ClassNotesUpsertRequestSchema = z.object({
  sectionId: UuidSchema,
  date: IsoDateSchema,
  noteType: z.enum(['raw', 'cleaned']).default('raw'),
  content: z.string().min(1)
});

export const ClassNotesUpsertResponseSchema = z.object({
  noteId: UuidSchema,
  updatedAt: z.string()
});

export const ParseScheduleRequestSchema = z.object({
  text: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional()
});

export const ParseScheduleResponseSchema = ScheduleImportResponseSchema;

export const GenerateSegmentsRequestSchema = z.object({
  lessonTitle: z.string().min(1),
  objective: z.string().nullable(),
  durationMinutes: z.number().int().positive().default(45)
});

export const GenerateSegmentsResponseSchema = z.object({
  segments: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      durationMinutes: z.number().int().positive()
    })
  )
});

export const GenerateContinuityRequestSchema = z.object({
  lessonTitle: z.string().min(1),
  lastSegmentTitle: z.string().nullable(),
  lastNote: z.string().nullable(),
  previousLessonSummary: z.string().nullable()
});

export const GenerateContinuityResponseSchema = z.object({
  recap: z.string(),
  nextStep: z.string(),
  adjustment: z.string().nullable()
});

export const GenerateActivityRequestSchema = z.object({
  courseName: z.string().min(1),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  lessonTitle: z.string().min(1),
  objective: z.string().nullable(),
  durationMinutes: z.number().int().positive().max(180),
  activityType: z.string().min(1),
  teacherNotes: z.string().nullable()
});

export const GenerateActivityResponseSchema = z.object({
  title: z.string(),
  teacherSummary: z.string(),
  materials: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      directions: z.string(),
      durationMinutes: z.number().int().positive()
    })
  ),
  studentHandout: z.object({
    title: z.string(),
    directions: z.string(),
    questions: z.array(z.string())
  })
});

export const GenerateSemesterRequestSchema = z.object({
  courseName: z.string().min(1),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  timeframeWeeks: z.number().int().min(1).max(52),
  meetingsPerWeek: z.number().int().min(1).max(7),
  unitCount: z.number().int().min(1).max(12),
  teacherNotes: z.string().nullable()
});

export const GenerateSemesterResponseSchema = z.object({
  overview: z.string(),
  units: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      lessons: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          estimatedDurationMinutes: z.number().int().positive()
        })
      )
    })
  )
});

export const AiJobTypeSchema = z.enum([
  'parse_schedule',
  'generate_segments',
  'generate_continuity'
]);

export const AiJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const AiJobControlActionSchema = z.enum(['cancelled', 'requeued']);

export const AiJobEnqueueResponseSchema = z.object({
  jobId: UuidSchema,
  status: AiJobStatusSchema
});

export const AiJobStatusResponseSchema = z.object({
  jobId: UuidSchema,
  type: AiJobTypeSchema,
  status: AiJobStatusSchema,
  output: z.record(z.any()).nullable(),
  error: z.string().nullable(),
  cancelRequested: z.boolean(),
  attemptsMade: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  progressPercent: z.number().int().min(0).max(100),
  canCancel: z.boolean(),
  canRetry: z.boolean()
});

export const AiJobControlResponseSchema = z.object({
  jobId: UuidSchema,
  status: AiJobStatusSchema,
  action: AiJobControlActionSchema
});

export const CourseSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable(),
  createdAt: z.string()
});

export const CoursePacingPlanSchema = z.object({
  courseId: UuidSchema,
  startDate: IsoDateSchema.nullable(),
  weeks: z.number().int().positive().nullable(),
  meetingsPerWeek: z.number().int().min(1).max(10).nullable(),
  plannedClassPeriods: z.number().int().positive().nullable(),
  classPeriodMinutes: z.number().int().min(10).max(240),
  notes: z.string().nullable(),
  updatedAt: z.string()
});

export const CoursePacingPlanUpsertRequestSchema = z.object({
  startDate: IsoDateSchema.nullable(),
  weeks: z.number().int().positive().nullable(),
  meetingsPerWeek: z.number().int().min(1).max(10).nullable(),
  plannedClassPeriods: z.number().int().positive().nullable(),
  classPeriodMinutes: z.number().int().min(10).max(240).default(50),
  notes: z.string().max(10_000).nullable()
});

export const CourseListResponseSchema = z.object({
  courses: z.array(CourseSummarySchema)
});

export const CourseCreateRequestSchema = z.object({
  name: z.string().min(1),
  subject: z.string().nullable(),
  gradeLevel: z.string().nullable()
});

export const CourseUpdateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().nullable().optional(),
  gradeLevel: z.string().nullable().optional()
});

export const SegmentSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  orderIndex: z.number().int()
});

export const LessonMaterialKindSchema = z.enum(['google_drive', 'pdf', 'canvas', 'web']);

export const LessonMaterialSchema = z.object({
  id: UuidSchema,
  label: z.string(),
  url: z.string().url(),
  kind: LessonMaterialKindSchema,
  createdAt: z.string()
});

export const LessonSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int(),
  estimatedDurationMinutes: z.number().int().nullable(),
  segments: z.array(SegmentSchema),
  materials: z.array(LessonMaterialSchema)
});

export const UnitSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int(),
  lessons: z.array(LessonSchema)
});

export const CourseDetailResponseSchema = z.object({
  course: CourseSummarySchema.extend({
    pacingPlan: CoursePacingPlanSchema.nullable(),
    units: z.array(UnitSchema)
  })
});

export const UnitCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const UnitUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const LessonCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  estimatedDurationMinutes: z.number().int().positive().nullable(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const LessonUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

/** Replaces the order of every lesson in a single stack (unit). */
export const LessonReorderRequestSchema = z.object({
  lessonIds: z.array(UuidSchema).min(1)
});

export const TeacherNoteSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const TeacherNotesResponseSchema = z.object({
  notes: z.array(TeacherNoteSchema)
});

export const TeacherNoteCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().max(10_000).default('')
});

export const TeacherNoteUpdateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    content: z.string().max(10_000).optional()
  })
  .refine((body) => body.title !== undefined || body.content !== undefined, {
    message: 'Provide a title or note text to update.'
  });

export const SegmentCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const SegmentUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional()
});

export const DeleteEntityResponseSchema = z.object({
  deleted: z.literal(true)
});

export const LessonMaterialCreateRequestSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  kind: LessonMaterialKindSchema
});

export const CreateUploadUrlRequestSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1)
});

export const CreateUploadUrlResponseSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string().url()
});

export const ApiErrorSchema = z.object({
  error: z.string(),
  requestId: z.string().optional()
});

export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;
export type DashboardTodayResponse = z.infer<typeof DashboardTodayResponseSchema>;
export type ClassroomCheckinResponse = z.infer<typeof ClassroomCheckinResponseSchema>;
export type ClassroomCheckinResolveRequest = z.infer<typeof ClassroomCheckinResolveRequestSchema>;
export type ClassroomCheckinResolveResponse = z.infer<typeof ClassroomCheckinResolveResponseSchema>;
export type GetScheduleResponse = z.infer<typeof GetScheduleResponseSchema>;
export type ScheduleSetupSource = z.infer<typeof ScheduleSetupSourceSchema>;
export type WeeklyScheduleProposal = z.infer<typeof WeeklyScheduleProposalSchema>;
export type AnnualCalendarProposal = z.infer<typeof AnnualCalendarProposalSchema>;
export type ScheduleSetupApplyRequest = z.infer<typeof ScheduleSetupApplyRequestSchema>;
export type ScheduleSetupApplyResponse = z.infer<typeof ScheduleSetupApplyResponseSchema>;
export type ScheduleImportRequest = z.infer<typeof ScheduleImportRequestSchema>;
export type ScheduleImportResponse = z.infer<typeof ScheduleImportResponseSchema>;
export type AcademicCalendarParseRequest = z.infer<typeof AcademicCalendarParseRequestSchema>;
export type AcademicCalendarParseResponse = z.infer<typeof AcademicCalendarParseResponseSchema>;
export type TeachingDataImportApplyRequest = z.infer<typeof TeachingDataImportApplyRequestSchema>;
export type TeachingDataImportApplyResponse = z.infer<typeof TeachingDataImportApplyResponseSchema>;
export type HolidaysUpsertRequest = z.infer<typeof HolidaysUpsertRequestSchema>;
export type HolidaysUpsertResponse = z.infer<typeof HolidaysUpsertResponseSchema>;
export type LessonProgressUpsertRequest = z.infer<typeof LessonProgressUpsertRequestSchema>;
export type LessonProgressUpsertResponse = z.infer<typeof LessonProgressUpsertResponseSchema>;
export type ClassNotesUpsertRequest = z.infer<typeof ClassNotesUpsertRequestSchema>;
export type ClassNotesUpsertResponse = z.infer<typeof ClassNotesUpsertResponseSchema>;
export type ParseScheduleRequest = z.infer<typeof ParseScheduleRequestSchema>;
export type ParseScheduleResponse = z.infer<typeof ParseScheduleResponseSchema>;
export type GenerateSegmentsRequest = z.infer<typeof GenerateSegmentsRequestSchema>;
export type GenerateSegmentsResponse = z.infer<typeof GenerateSegmentsResponseSchema>;
export type GenerateContinuityRequest = z.infer<typeof GenerateContinuityRequestSchema>;
export type GenerateContinuityResponse = z.infer<typeof GenerateContinuityResponseSchema>;
export type GenerateActivityRequest = z.infer<typeof GenerateActivityRequestSchema>;
export type GenerateActivityResponse = z.infer<typeof GenerateActivityResponseSchema>;
export type GenerateSemesterRequest = z.infer<typeof GenerateSemesterRequestSchema>;
export type GenerateSemesterResponse = z.infer<typeof GenerateSemesterResponseSchema>;
export type CreateUploadUrlRequest = z.infer<typeof CreateUploadUrlRequestSchema>;
export type CreateUploadUrlResponse = z.infer<typeof CreateUploadUrlResponseSchema>;
export type AiJobEnqueueResponse = z.infer<typeof AiJobEnqueueResponseSchema>;
export type AiJobStatusResponse = z.infer<typeof AiJobStatusResponseSchema>;
export type AiJobControlResponse = z.infer<typeof AiJobControlResponseSchema>;
export type CourseListResponse = z.infer<typeof CourseListResponseSchema>;
export type CourseDetailResponse = z.infer<typeof CourseDetailResponseSchema>;
export type CourseCreateRequest = z.infer<typeof CourseCreateRequestSchema>;
export type CourseUpdateRequest = z.infer<typeof CourseUpdateRequestSchema>;
export type CoursePacingPlan = z.infer<typeof CoursePacingPlanSchema>;
export type CoursePacingPlanUpsertRequest = z.infer<typeof CoursePacingPlanUpsertRequestSchema>;
export type UnitCreateRequest = z.infer<typeof UnitCreateRequestSchema>;
export type UnitUpdateRequest = z.infer<typeof UnitUpdateRequestSchema>;
export type LessonCreateRequest = z.infer<typeof LessonCreateRequestSchema>;
export type LessonUpdateRequest = z.infer<typeof LessonUpdateRequestSchema>;
export type LessonReorderRequest = z.infer<typeof LessonReorderRequestSchema>;
export type TeacherNote = z.infer<typeof TeacherNoteSchema>;
export type TeacherNotesResponse = z.infer<typeof TeacherNotesResponseSchema>;
export type TeacherNoteCreateRequest = z.infer<typeof TeacherNoteCreateRequestSchema>;
export type TeacherNoteUpdateRequest = z.infer<typeof TeacherNoteUpdateRequestSchema>;
export type SegmentCreateRequest = z.infer<typeof SegmentCreateRequestSchema>;
export type SegmentUpdateRequest = z.infer<typeof SegmentUpdateRequestSchema>;
export type DeleteEntityResponse = z.infer<typeof DeleteEntityResponseSchema>;
export type LessonMaterialKind = z.infer<typeof LessonMaterialKindSchema>;
export type LessonMaterialCreateRequest = z.infer<typeof LessonMaterialCreateRequestSchema>;
