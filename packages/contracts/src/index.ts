import { z } from 'zod';

export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

function isSupportedIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const IanaTimezoneSchema = z.string().min(1).refine(isSupportedIanaTimezone, {
  message: 'Provide a valid IANA timezone such as America/Los_Angeles.'
});

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
  // Warnings are intentionally part of the reviewed proposal rather than server-side
  // logging: the teacher needs to see ambiguity before anything is saved.
  warnings: z.array(z.string()).default([])
});

/**
 * Shared by the API and queue worker so that every schedule-reader entry point
 * receives the same semantic instructions. The JSON schema enforces shape; this
 * prompt explains the meaning of the Course → Class Group relationship.
 */
export const SCHEDULE_HIERARCHY_SYSTEM_PROMPT = `You are reading a teacher schedule into TeacherOS's strict hierarchy:
Course → Class Group → Meeting Times.

A Course is shared curriculum. A Class Group is one actual group of students taking that Course. Reason about that hierarchy from the layout, repeated labels, and nearby headings BEFORE returning structured output.

Follow this process:
1. Identify subject/discipline names.
2. Decide whether an adjacent number is a grade level, curriculum/course level, period number, or a group/section identifier.
3. If a number changes the curriculum level, include it in the Course name. Spanish 5, Spanish 6, Math 6, English 7, and French 2 are normally distinct Course names, not groups under Spanish, Math, English, or French.
4. Identify repeated actual groups for each Course. Letter labels A/B/C normally identify Class Groups under the nearest appropriate numbered Course.
5. Labels such as Period, Per., Section, Group, Block, and Class are strong evidence that the following value is a Class Group, not part of the Course name. US History + Period 5 means Course US History / Class Group Period 5. Spanish 5 + Period 2 means Course Spanish 5 / Class Group Period 2.
6. Give every Class Group its own meeting days, start time, end time, and room when shown. A Class Group belongs to exactly one Course. Group names are only unique within a Course: Spanish 5 / A and Spanish 6 / A are distinct valid groups.
7. Check for suspicious collapsed structures before returning. Never collapse Spanish 5, Spanish 6, Spanish 7, and Spanish 8 into one Spanish Course. If the source is genuinely ambiguous, preserve the most supported interpretation and add a precise warning for teacher review instead of inventing a hierarchy.

Examples:
Input: Spanish 5A; Mon Wed Fri; 8:00-8:50; Spanish 5B; Tue Thu; 9:00-10:15.
Output hierarchy: Course Spanish 5 → Class Group A (Mon/Wed/Fri 08:00-08:50), Class Group B (Tue/Thu 09:00-10:15).

Input: Spanish 5; A; B; C; Spanish 6; A; B; C.
Output hierarchy: Course Spanish 5 → A, B, C; Course Spanish 6 → A, B, C.

Input: 7th Grade Math A; 7th Grade Math B.
Output hierarchy: Course 7th Grade Math → A, B. Never create Course Math with groups 7th Grade, A, and B.

Input: French 1 A; French 1 B; French 2 A; French 2 B.
Output hierarchy: Course French 1 → A, B; Course French 2 → A, B.

Return only the requested structured JSON. Do not invent classes, groups, days, or times.`;

type WeeklyScheduleProposalValue = z.infer<typeof WeeklyScheduleProposalSchema>;

const LEVEL_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12'
};

function normalizeScheduleLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeCourseName(value: string): string {
  const normalized = normalizeScheduleLabel(value);
  const wordLevel = normalized.match(
    /^(.*\S)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/i
  );
  return wordLevel ? `${wordLevel[1]!} ${LEVEL_WORDS[wordLevel[2]!.toLowerCase()]!}` : normalized;
}

function canonicalCourseLabel(value: string): string {
  return normalizeCourseName(value).toLocaleLowerCase();
}

function deduplicateWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.map(normalizeScheduleLabel).filter(Boolean))];
}

function isBareNumericGroup(value: string): boolean {
  return /^\d{1,2}$/.test(normalizeScheduleLabel(value));
}

function isLetterGroup(value: string): boolean {
  return /^[A-Za-z]$/.test(normalizeScheduleLabel(value));
}

function hasMeaningfulCourseLevel(courseName: string): boolean {
  return /(?:\bgrade\s*\d+|\b\d+(?:st|nd|rd|th)\s+grade|\b\d{1,2})\s*$/i.test(
    normalizeScheduleLabel(courseName)
  );
}

/**
 * Detects the common unsafe shape: a base course with grade/level numbers and
 * letters all promoted to sibling Class Groups. We deliberately do not guess
 * which letter group belongs to which numbered level in that case.
 */
export function findScheduleHierarchyProblems(proposal: {
  courses: Array<{ name: string; sections: Array<{ name: string }> }>;
}): string[] {
  const problems: string[] = [];
  for (const course of proposal.courses) {
    const groups = course.sections.map((section) => normalizeScheduleLabel(section.name));
    const numericGroups = groups.filter(isBareNumericGroup);
    if (!hasMeaningfulCourseLevel(course.name) && numericGroups.length >= 2) {
      const letterGroups = groups.filter(isLetterGroup);
      problems.push(
        `Needs hierarchy review: “${normalizeScheduleLabel(course.name)}” has level-like groups ${numericGroups.join(', ')}${letterGroups.length ? ` and letter groups ${letterGroups.join(', ')}` : ''}. Create separate Courses for the curriculum levels before saving.`
      );
    }
  }
  return problems;
}

function normalizeMeetings<
  T extends { day: string; startTime: string | null; endTime: string | null; room: string | null }
>(meetings: T[]): T[] {
  const seen = new Set<string>();
  return meetings.filter((meeting) => {
    const key = `${meeting.day}|${meeting.startTime ?? ''}|${meeting.endTime ?? ''}|${meeting.room ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalizes harmless formatting and safely repairs an AI result such as
 * Course “Spanish” / Group “5A” into Course “Spanish 5” / Group “A”. It never
 * guesses an assignment for standalone A/B/C groups beneath multiple levels;
 * those results remain visibly flagged for review.
 */
export function normalizeWeeklyScheduleProposal(
  proposal: WeeklyScheduleProposalValue
): WeeklyScheduleProposalValue {
  const coursesByName = new Map<string, WeeklyScheduleProposalValue['courses'][number]>();

  for (const rawCourse of proposal.courses) {
    const rawCourseName = normalizeScheduleLabel(rawCourse.name);
    const courseHasLevel = hasMeaningfulCourseLevel(rawCourseName);

    for (const rawSection of rawCourse.sections) {
      const rawSectionName = normalizeScheduleLabel(rawSection.name);
      const attachedLevelAndGroup = !courseHasLevel
        ? rawSectionName.match(/^(\d{1,2})\s*([A-Za-z])$/)
        : null;
      const courseName = normalizeCourseName(
        attachedLevelAndGroup ? `${rawCourseName} ${attachedLevelAndGroup[1]}` : rawCourseName
      );
      const sectionName = attachedLevelAndGroup
        ? attachedLevelAndGroup[2]!.toUpperCase()
        : rawSectionName;
      const canonicalName = canonicalCourseLabel(courseName);
      const existing = coursesByName.get(canonicalName);
      const normalizedSection = {
        name: sectionName,
        meetings: normalizeMeetings(rawSection.meetings)
      };

      if (!existing) {
        coursesByName.set(canonicalName, {
          name: courseName,
          subject: rawCourse.subject ? normalizeScheduleLabel(rawCourse.subject) : null,
          gradeLevel: rawCourse.gradeLevel ? normalizeScheduleLabel(rawCourse.gradeLevel) : null,
          sections: [normalizedSection]
        });
        continue;
      }

      const existingSection = existing.sections.find(
        (section) =>
          normalizeScheduleLabel(section.name).toLocaleLowerCase() ===
          sectionName.toLocaleLowerCase()
      );
      if (existingSection) {
        existingSection.meetings = normalizeMeetings([
          ...existingSection.meetings,
          ...normalizedSection.meetings
        ]);
      } else {
        existing.sections.push(normalizedSection);
      }
    }
  }

  const courses = [...coursesByName.values()];
  const warnings = deduplicateWarnings([
    ...proposal.warnings,
    ...findScheduleHierarchyProblems({ courses })
  ]);
  return { ...proposal, courses, warnings };
}

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
  grades: z.array(z.string()).default([]),
  timezone: IanaTimezoneSchema.nullable().default(null)
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
  assignments: z.array(AssignmentItemSchema),
  warnings: z.array(z.string()).default([])
});

/** Applies the same safe Course/Group split to the legacy flat import response. */
export function normalizeScheduleImportResponse(
  response: z.infer<typeof ScheduleImportResponseSchema>
): z.infer<typeof ScheduleImportResponseSchema> {
  const classes = response.classes.map((item) => {
    const name = normalizeCourseName(item.name);
    const period = normalizeScheduleLabel(item.period);
    const attachedLevelAndGroup = !hasMeaningfulCourseLevel(name)
      ? period.match(/^(\d{1,2})\s*([A-Za-z])$/)
      : null;
    return {
      ...item,
      name: attachedLevelAndGroup ? `${name} ${attachedLevelAndGroup[1]}` : name,
      period: attachedLevelAndGroup ? attachedLevelAndGroup[2]!.toUpperCase() : period
    };
  });
  const byCourse = new Map<string, { name: string; sections: { name: string }[] }>();
  for (const item of classes) {
    const key = canonicalCourseLabel(item.name);
    const entry = byCourse.get(key) ?? { name: item.name, sections: [] };
    entry.sections.push({ name: item.period });
    byCourse.set(key, entry);
  }
  const warnings = deduplicateWarnings([
    ...response.warnings,
    ...findScheduleHierarchyProblems({ courses: [...byCourse.values()] })
  ]);
  return { ...response, classes, warnings };
}

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
  estimatedMeetings: z.number().int().nullable(),
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
  estimatedMeetings: z.number().int().positive().nullable().default(null),
  durationKind: z.enum(['minutes', 'meetings']).nullable().default(null),
  orderIndex: z.number().int().nonnegative().optional()
});

export const LessonUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  estimatedMeetings: z.number().int().positive().nullable().optional(),
  durationKind: z.enum(['minutes', 'meetings']).nullable().optional(),
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

// Calendar-first v3 API contracts.
export const AccountTimezoneSchema = z.object({ timezone: IanaTimezoneSchema.nullable() });
export const InitializeTimezoneRequestSchema = z.object({ timezone: IanaTimezoneSchema });
export const UpdateTimezoneRequestSchema = z.object({ timezone: IanaTimezoneSchema });

export const AcademicYearSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  isActive: z.boolean()
});
export const AcademicYearInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    isActive: z.boolean().default(true)
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'End date must be on or after start date.'
  });

export const AcademicYearUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Academic Year field to update.'
  })
  .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
    message: 'End date must be on or after start date.'
  });

export const CalendarEventSchema = z.object({
  id: UuidSchema,
  academicYearId: UuidSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  label: z.string(),
  type: z.string(),
  instructional: z.boolean()
});
export const CalendarEventInputSchema = z
  .object({
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    label: z.string().trim().min(1).max(160),
    type: z.string().trim().min(1).max(60).default('other'),
    instructional: z.boolean().default(false)
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'End date must be on or after start date.'
  });

export const CalendarEventUpdateInputSchema = z
  .object({
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional(),
    label: z.string().trim().min(1).max(160).optional(),
    type: z.string().trim().min(1).max(60).optional(),
    instructional: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Calendar Event field to update.'
  })
  .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
    message: 'End date must be on or after start date.'
  });

export const MeetingRuleInputSchema = z
  .object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: IsoTimeSchema,
    endTime: IsoTimeSchema,
    effectiveStart: IsoDateSchema.nullable().default(null),
    effectiveEnd: IsoDateSchema.nullable().default(null),
    room: z.string().trim().max(80).nullable().default(null)
  })
  .refine((value) => value.endTime > value.startTime, {
    message: 'End time must be after start time.'
  })
  .refine(
    (value) =>
      !value.effectiveStart || !value.effectiveEnd || value.effectiveEnd >= value.effectiveStart,
    { message: 'Effective end must be on or after effective start.' }
  );

export const MeetingRuleSchema = z.object({
  id: UuidSchema,
  weekdays: z.array(z.number().int().min(0).max(6)),
  startTime: IsoTimeSchema,
  endTime: IsoTimeSchema,
  effectiveStart: IsoDateSchema.nullable(),
  effectiveEnd: IsoDateSchema.nullable(),
  room: z.string().nullable()
});

export const ClassGroupSchema = z.object({
  id: UuidSchema,
  courseId: UuidSchema,
  academicYearId: UuidSchema,
  name: z.string(),
  periodLabel: z.string().nullable(),
  room: z.string().nullable(),
  meetingRules: z.array(MeetingRuleSchema)
});
export const ClassGroupInputSchema = z.object({
  courseId: UuidSchema,
  academicYearId: UuidSchema,
  name: z.string().trim().min(1).max(120),
  periodLabel: z.string().trim().max(80).nullable().default(null),
  room: z.string().trim().max(80).nullable().default(null),
  meetingRules: z.array(MeetingRuleInputSchema).default([])
});
export const ClassGroupUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    periodLabel: z.string().trim().max(80).nullable().optional(),
    room: z.string().trim().max(80).nullable().optional(),
    meetingRules: z.array(MeetingRuleInputSchema).min(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Class Group field to update.'
  });

export const ScheduleOverrideMeetingInputSchema = z
  .object({
    classGroupId: UuidSchema,
    action: z.enum(['replace', 'add', 'cancel']).default('replace'),
    startTime: IsoTimeSchema.nullable().default(null),
    endTime: IsoTimeSchema.nullable().default(null),
    room: z.string().trim().max(80).nullable().default(null)
  })
  .refine(
    (value) =>
      value.action === 'cancel' ||
      (value.startTime !== null && value.endTime !== null && value.endTime > value.startTime),
    { message: 'Replacement and added meetings require a valid time range.' }
  );
export const ScheduleOverrideInputSchema = z.object({
  date: IsoDateSchema,
  label: z.string().trim().min(1).max(160),
  type: z.string().trim().min(1).max(60).default('special_schedule'),
  meetings: z.array(ScheduleOverrideMeetingInputSchema).min(1)
});
export const ScheduleOverrideUpdateInputSchema = z
  .object({
    date: IsoDateSchema.optional(),
    label: z.string().trim().min(1).max(160).optional(),
    type: z.string().trim().min(1).max(60).optional(),
    meetings: z.array(ScheduleOverrideMeetingInputSchema).min(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Schedule Override field to update.'
  });
export const ScheduleOverrideSchema = ScheduleOverrideInputSchema.extend({
  id: UuidSchema,
  academicYearId: UuidSchema
});

export const MeetingInstanceSchema = z.object({
  id: UuidSchema,
  classGroupId: UuidSchema,
  academicYearId: UuidSchema,
  localDate: IsoDateSchema,
  startTime: IsoTimeSchema,
  endTime: IsoTimeSchema,
  meetingNumber: z.number().int().positive(),
  source: z.enum(['generated', 'override', 'manual']),
  state: z.enum(['scheduled', 'superseded', 'cancelled'])
});

export const PlanAllocationInputSchema = z.object({
  meetingInstanceId: UuidSchema,
  lessonId: UuidSchema,
  lessonStepId: UuidSchema.nullable().default(null),
  orderIndex: z.number().int().nonnegative().optional(),
  notes: z.string().max(2_000).nullable().default(null)
});
export const PlanAllocationSchema = PlanAllocationInputSchema.extend({
  id: UuidSchema,
  classGroupId: UuidSchema
});
export const PlanAllocationMoveRequestSchema = z.object({
  targetMeetingInstanceId: UuidSchema,
  shiftFollowing: z.boolean().default(false)
});

export const ClassGroupUnitPlanInputSchema = z.object({
  unitId: UuidSchema,
  planKind: z.enum(['meetings', 'weeks', 'date_range']).nullable().default(null),
  estimatedWeeks: z.number().int().positive().nullable().default(null),
  estimatedMeetings: z.number().int().positive().nullable().default(null),
  startDate: IsoDateSchema.nullable().default(null),
  endDate: IsoDateSchema.nullable().default(null)
});

const ResourceFieldsSchema = z.object({
  courseId: UuidSchema.nullable().default(null),
  unitId: UuidSchema.nullable().default(null),
  lessonId: UuidSchema.nullable().default(null),
  lessonStepId: UuidSchema.nullable().default(null),
  title: z.string().trim().max(200).nullable().default(null),
  url: z.string().url().max(2_000),
  resourceType: z.string().trim().max(60).default('link')
});
export const ResourceInputSchema = ResourceFieldsSchema.superRefine((value, context) => {
  if (
    [value.courseId, value.unitId, value.lessonId, value.lessonStepId].filter(Boolean).length !== 1
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A Resource must be attached to exactly one curriculum item.'
    });
  }
});
export const ResourceSchema = ResourceFieldsSchema.extend({
  id: UuidSchema,
  provider: z.string()
});

export const LessonTemplateStepInputSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2_000).nullable().default(null),
  estimatedMinutes: z.number().int().positive().nullable().default(null),
  isOptional: z.boolean().default(false)
});
export const LessonTemplateInputSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2_000).nullable().default(null),
  steps: z.array(LessonTemplateStepInputSchema).min(1).max(40)
});
export const LessonTemplateSchema = LessonTemplateInputSchema.extend({ id: UuidSchema });

export const V3LessonStepSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  isOptional: z.boolean(),
  orderIndex: z.number().int()
});
export const V3LessonSchema = z.object({
  id: UuidSchema,
  unitId: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  estimatedDurationMinutes: z.number().int().nullable(),
  estimatedMeetings: z.number().int().nullable(),
  orderIndex: z.number().int(),
  steps: z.array(V3LessonStepSchema)
});
export const V3UnitSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int(),
  estimatedWeeks: z.number().int().nullable(),
  estimatedMeetings: z.number().int().nullable(),
  lessons: z.array(V3LessonSchema)
});
export const V3CourseDetailSchema = z.object({
  course: z.object({
    id: UuidSchema,
    name: z.string(),
    subject: z.string().nullable(),
    gradeLevel: z.string().nullable(),
    units: z.array(V3UnitSchema),
    classGroups: z.array(ClassGroupSchema)
  })
});

export const CurriculumProgressStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
  'skipped'
]);
export const ClassroomProgressInputSchema = z.object({
  lessonId: UuidSchema,
  status: CurriculumProgressStatusSchema,
  meetingInstanceId: UuidSchema.nullable().default(null),
  manualOverride: z.boolean().default(false),
  notes: z.string().max(2_000).nullable().default(null)
});
export const LessonStepProgressInputSchema = z.object({
  lessonStepId: UuidSchema,
  status: CurriculumProgressStatusSchema,
  meetingInstanceId: UuidSchema.nullable().default(null)
});
export const ClassroomStateSchema = z.object({
  now: z.string(),
  timezone: IanaTimezoneSchema.nullable(),
  activeClassGroupId: UuidSchema.nullable(),
  activeMeeting: MeetingInstanceSchema.nullable(),
  classGroups: z.array(
    z.object({
      id: UuidSchema,
      courseId: UuidSchema,
      name: z.string(),
      courseName: z.string(),
      periodLabel: z.string().nullable()
    })
  ),
  selected: z
    .object({
      classGroupId: UuidSchema,
      meeting: MeetingInstanceSchema.nullable(),
      currentLesson: V3LessonSchema.nullable(),
      lessonStatus: CurriculumProgressStatusSchema.nullable(),
      stepStatuses: z.record(CurriculumProgressStatusSchema),
      upcomingMeeting: MeetingInstanceSchema.nullable()
    })
    .nullable()
});

export const MeetingGenerationPreviewSchema = z.object({
  generated: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  removedUnused: z.number().int().nonnegative(),
  affectedPlanned: z.number().int().nonnegative(),
  affectedPlanAllocations: z.number().int().nonnegative(),
  historicalPreserved: z.number().int().nonnegative(),
  proposedRemappings: z.array(
    z.object({
      fromMeetingId: UuidSchema,
      fromMeetingNumber: z.number().int().positive(),
      toLocalDate: IsoDateSchema,
      toStartTime: IsoTimeSchema
    })
  ),
  unmappedPlanAllocations: z.number().int().nonnegative(),
  conflicts: z.array(z.string())
});
export const PlannedPercentageSchema = z.object({
  availableMeetings: z.number().int().nonnegative(),
  explicitMeetings: z.number().int().nonnegative(),
  estimatedMeetings: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  isApproximate: z.boolean(),
  overCapacityMeetings: z.number().int().nonnegative()
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
export type AccountTimezone = z.infer<typeof AccountTimezoneSchema>;
export type InitializeTimezoneRequest = z.infer<typeof InitializeTimezoneRequestSchema>;
export type UpdateTimezoneRequest = z.infer<typeof UpdateTimezoneRequestSchema>;
export type AcademicYear = z.infer<typeof AcademicYearSchema>;
export type AcademicYearInput = z.infer<typeof AcademicYearInputSchema>;
export type AcademicYearUpdateInput = z.infer<typeof AcademicYearUpdateInputSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CalendarEventInput = z.infer<typeof CalendarEventInputSchema>;
export type CalendarEventUpdateInput = z.infer<typeof CalendarEventUpdateInputSchema>;
export type ClassGroup = z.infer<typeof ClassGroupSchema>;
export type ClassGroupInput = z.infer<typeof ClassGroupInputSchema>;
export type ClassGroupUpdateInput = z.infer<typeof ClassGroupUpdateInputSchema>;
export type MeetingRuleInput = z.infer<typeof MeetingRuleInputSchema>;
export type ScheduleOverride = z.infer<typeof ScheduleOverrideSchema>;
export type ScheduleOverrideInput = z.infer<typeof ScheduleOverrideInputSchema>;
export type ScheduleOverrideUpdateInput = z.infer<typeof ScheduleOverrideUpdateInputSchema>;
export type MeetingInstance = z.infer<typeof MeetingInstanceSchema>;
export type PlanAllocation = z.infer<typeof PlanAllocationSchema>;
export type PlanAllocationInput = z.infer<typeof PlanAllocationInputSchema>;
export type PlanAllocationMoveRequest = z.infer<typeof PlanAllocationMoveRequestSchema>;
export type ResourceInput = z.infer<typeof ResourceInputSchema>;
export type LessonTemplateInput = z.infer<typeof LessonTemplateInputSchema>;
export type ClassGroupUnitPlanInput = z.infer<typeof ClassGroupUnitPlanInputSchema>;
export type V3CourseDetail = z.infer<typeof V3CourseDetailSchema>;
export type V3Lesson = z.infer<typeof V3LessonSchema>;
export type V3LessonStep = z.infer<typeof V3LessonStepSchema>;
export type ClassroomState = z.infer<typeof ClassroomStateSchema>;
export type ClassroomProgressInput = z.infer<typeof ClassroomProgressInputSchema>;
export type LessonStepProgressInput = z.infer<typeof LessonStepProgressInputSchema>;
export type MeetingGenerationPreview = z.infer<typeof MeetingGenerationPreviewSchema>;
export type PlannedPercentage = z.infer<typeof PlannedPercentageSchema>;
