import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['teacher', 'department_head', 'admin']);
export const lessonStateStatusEnum = pgEnum('lesson_state_status', [
  'not_started',
  'in_progress',
  'stopped_at_segment',
  'completed',
  'carried_over',
  'skipped',
  'needs_reteach'
]);
export const aiJobStatusEnum = pgEnum('ai_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);
export const classNoteTypeEnum = pgEnum('class_note_type', ['raw', 'cleaned']);
export const classSessionOutcomeEnum = pgEnum('class_session_outcome', [
  'taught',
  'substitute',
  'cancelled',
  'shortened'
]);
export const lessonMaterialKindEnum = pgEnum('lesson_material_kind', [
  'google_drive',
  'pdf',
  'canvas',
  'web'
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  /** IANA timezone selected once during setup and editable by the teacher. */
  timezone: text('timezone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const schools = pgTable('schools', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  district: text('district'),
  state: text('state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const teacherProfiles = pgTable(
  'teacher_profiles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull().default('teacher'),
    onboarded: boolean('onboarded').notNull().default(false),
    phone: text('phone'),
    workEmail: text('work_email'),
    subjects: text('subjects').array().notNull().default([]),
    grades: text('grades').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    index('idx_teacher_profiles_school').on(table.schoolId)
  ]
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject'),
    gradeLevel: text('grade_level'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_courses_teacher').on(table.teacherId),
    index('idx_courses_school').on(table.schoolId)
  ]
);

export const coursePacingPlans = pgTable('course_pacing_plans', {
  courseId: uuid('course_id')
    .primaryKey()
    .references(() => courses.id, { onDelete: 'cascade' }),
  startDate: date('start_date'),
  weeks: integer('weeks'),
  meetingsPerWeek: integer('meetings_per_week'),
  plannedClassPeriods: integer('planned_class_periods'),
  classPeriodMinutes: integer('class_period_minutes').notNull().default(50),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_sections_course').on(table.courseId)]
);

export const sectionMeetings = pgTable(
  'section_meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    meetingTime: time('meeting_time'),
    meetingEndTime: time('meeting_end_time'),
    room: text('room'),
    scheduleTemplateId: uuid('schedule_template_id').references(() => teacherScheduleTemplates.id, {
      onDelete: 'cascade'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_section_meetings_section').on(table.sectionId)]
);

export const teacherScheduleTemplates = pgTable(
  'teacher_schedule_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Weekly schedule'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_teacher_schedule_templates_teacher').on(table.teacherId),
    index('idx_teacher_schedule_templates_active').on(table.teacherId, table.isActive)
  ]
);

export const scheduleBlocks = pgTable(
  'schedule_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleTemplateId: uuid('schedule_template_id')
      .notNull()
      .references(() => teacherScheduleTemplates.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    label: text('label').notNull(),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_schedule_blocks_template').on(table.scheduleTemplateId)]
);

export const scheduleDateOverrides = pgTable(
  'schedule_date_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    label: text('label').notNull(),
    kind: text('kind').notNull(),
    rotationDay: text('rotation_day'),
    replaceWeeklySchedule: boolean('replace_weekly_schedule').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_schedule_date_override_teacher_date').on(table.teacherId, table.date),
    index('idx_schedule_date_override_teacher_date').on(table.teacherId, table.date)
  ]
);

export const scheduleDateOverrideMeetings = pgTable(
  'schedule_date_override_meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleDateOverrideId: uuid('schedule_date_override_id')
      .notNull()
      .references(() => scheduleDateOverrides.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    meetingTime: time('meeting_time'),
    meetingEndTime: time('meeting_end_time'),
    room: text('room'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_schedule_override_meetings_override').on(table.scheduleDateOverrideId)]
);

export const schoolHolidays = pgTable(
  'school_holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: text('name').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [unique('uniq_school_holiday_date').on(table.schoolId, table.date)]
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    orderIndex: integer('order_index').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    durationKind: text('duration_kind'),
    estimatedWeeks: integer('estimated_weeks'),
    estimatedMeetings: integer('estimated_meetings'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_units_course_order').on(table.courseId, table.orderIndex)]
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    orderIndex: integer('order_index').notNull().default(0),
    estimatedDurationMinutes: integer('estimated_duration_minutes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    durationKind: text('duration_kind'),
    estimatedMeetings: integer('estimated_meetings'),
    // The database migration owns this self-reference; avoiding an eager Drizzle
    // callback keeps the schema initializer acyclic under strict TypeScript.
    sourceLessonId: uuid('source_lesson_id'),
    sourceCourseId: uuid('source_course_id').references(() => courses.id, { onDelete: 'set null' }),
    sourceUnitId: uuid('source_unit_id').references(() => units.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_lessons_unit_order').on(table.unitId, table.orderIndex)]
);

export const lessonSegments = pgTable(
  'lesson_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes'),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_segments_lesson_order').on(table.lessonId, table.orderIndex)]
);

export const lessonMaterials = pgTable(
  'lesson_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    url: text('url').notNull(),
    kind: lessonMaterialKindEnum('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_lesson_materials_lesson_created_at').on(table.lessonId, table.createdAt)]
);

export const sectionLessonState = pgTable(
  'section_lesson_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    status: lessonStateStatusEnum('status').notNull().default('not_started'),
    currentSegmentId: uuid('current_segment_id').references(() => lessonSegments.id, {
      onDelete: 'set null'
    }),
    stoppedAtSegmentId: uuid('stopped_at_segment_id').references(() => lessonSegments.id, {
      onDelete: 'set null'
    }),
    completedSegmentIds: jsonb('completed_segment_ids').$type<string[]>().notNull().default([]),
    carryOverNote: text('carry_over_note'),
    lastTaughtDate: date('last_taught_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_section_lesson_state').on(table.sectionId, table.lessonId),
    index('idx_section_lesson_state_status').on(table.sectionId, table.status)
  ]
);

export const classNotes = pgTable(
  'class_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    noteType: classNoteTypeEnum('note_type').notNull().default('raw'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_note').on(table.sectionId, table.userId, table.date, table.noteType)
  ]
);

/** Private planning notes, visible only to the teacher who created them. */
export const teacherNotes = pgTable(
  'teacher_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_teacher_notes_user_updated').on(table.userId, table.updatedAt)]
);

export const sectionSessionEvents = pgTable(
  'section_session_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionDate: date('session_date').notNull(),
    outcome: classSessionOutcomeEnum('outcome').notNull(),
    coveredPlannedLesson: boolean('covered_planned_lesson').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_section_session_event').on(table.sectionId, table.sessionDate),
    index('idx_section_session_events_date').on(table.sectionId, table.sessionDate)
  ]
);

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: aiJobStatusEnum('status').notNull().default('queued'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_ai_jobs_user_status').on(table.userId, table.status)]
);

export const aiOutputs = pgTable(
  'ai_outputs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    outputType: text('output_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_ai_outputs_job').on(table.jobId)]
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_audit_events_entity').on(table.entityType, table.entityId)]
);

// TeacherOS v3 calendar-first domain. Legacy v2 schedule tables remain exported
// for a controlled rollout; new routes only use the models below.
export const meetingInstanceSourceEnum = pgEnum('meeting_instance_source', [
  'generated',
  'override',
  'manual'
]);
export const meetingInstanceStateEnum = pgEnum('meeting_instance_state', [
  'scheduled',
  'superseded',
  'cancelled'
]);
export const overrideMeetingActionEnum = pgEnum('override_meeting_action', [
  'replace',
  'add',
  'cancel'
]);
export const progressOverrideStatusEnum = pgEnum('progress_override_status', [
  'not_started',
  'in_progress',
  'completed',
  'skipped'
]);

export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_academic_years_teacher').on(table.teacherId)]
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull().default('other'),
    instructional: boolean('instructional').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_calendar_events_year_dates').on(table.academicYearId, table.startDate, table.endDate)
  ]
);

export const classGroups = pgTable(
  'class_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    periodLabel: text('period_label'),
    room: text('room'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_group_course_year_name').on(
      table.courseId,
      table.academicYearId,
      table.name
    ),
    index('idx_class_groups_course').on(table.courseId),
    index('idx_class_groups_year').on(table.academicYearId)
  ]
);

export const meetingRules = pgTable(
  'meeting_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    effectiveStart: date('effective_start'),
    effectiveEnd: date('effective_end'),
    room: text('room'),
    recurrenceKind: text('recurrence_kind').notNull().default('weekly'),
    rotationKey: text('rotation_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_meeting_rules_group').on(table.classGroupId)]
);

export const meetingRuleDays = pgTable(
  'meeting_rule_days',
  {
    meetingRuleId: uuid('meeting_rule_id')
      .notNull()
      .references(() => meetingRules.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull()
  },
  (table) => [primaryKey({ columns: [table.meetingRuleId, table.weekday] })]
);

export const scheduleOverridesV3 = pgTable(
  'schedule_overrides_v3',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull().default('special_schedule'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_schedule_overrides_v3_year_date').on(table.academicYearId, table.date)]
);

export const scheduleOverrideMeetingsV3 = pgTable(
  'schedule_override_meetings_v3',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleOverrideId: uuid('schedule_override_id')
      .notNull()
      .references(() => scheduleOverridesV3.id, { onDelete: 'cascade' }),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    action: overrideMeetingActionEnum('action').notNull().default('replace'),
    startTime: time('start_time'),
    endTime: time('end_time'),
    room: text('room'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_override_meetings_v3_override').on(table.scheduleOverrideId)]
);

export const meetingInstances = pgTable(
  'meeting_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    localDate: date('local_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    meetingNumber: integer('meeting_number').notNull(),
    source: meetingInstanceSourceEnum('source').notNull().default('generated'),
    state: meetingInstanceStateEnum('state').notNull().default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_meeting_instance_group_year_number').on(
      table.classGroupId,
      table.academicYearId,
      table.meetingNumber
    ),
    unique('uniq_meeting_instance_group_date_start').on(
      table.classGroupId,
      table.localDate,
      table.startTime
    ),
    index('idx_meeting_instances_group_date').on(
      table.classGroupId,
      table.localDate,
      table.startTime
    )
  ]
);

export const lessonSteps = pgTable(
  'lesson_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    estimatedMinutes: integer('estimated_minutes'),
    isOptional: boolean('is_optional').notNull().default(false),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_lesson_steps_lesson_order').on(table.lessonId, table.orderIndex)]
);

export const classGroupUnitPlans = pgTable(
  'class_group_unit_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    planKind: text('plan_kind'),
    estimatedWeeks: integer('estimated_weeks'),
    estimatedMeetings: integer('estimated_meetings'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [unique('uniq_class_group_unit_plan').on(table.classGroupId, table.unitId)]
);

export const planAllocations = pgTable(
  'plan_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    meetingInstanceId: uuid('meeting_instance_id')
      .notNull()
      .references(() => meetingInstances.id, { onDelete: 'restrict' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    lessonStepId: uuid('lesson_step_id').references(() => lessonSteps.id, { onDelete: 'set null' }),
    orderIndex: integer('order_index').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_plan_allocations_group_meeting').on(
      table.classGroupId,
      table.meetingInstanceId,
      table.orderIndex
    ),
    index('idx_plan_allocations_lesson').on(table.lessonId)
  ]
);

export const classGroupLessonProgress = pgTable(
  'class_group_lesson_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    status: progressOverrideStatusEnum('status').notNull().default('not_started'),
    manualOverride: boolean('manual_override').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    actualStartMeetingId: uuid('actual_start_meeting_id').references(() => meetingInstances.id, {
      onDelete: 'set null'
    }),
    actualCompletionMeetingId: uuid('actual_completion_meeting_id').references(
      () => meetingInstances.id,
      {
        onDelete: 'set null'
      }
    ),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_group_lesson_progress').on(table.classGroupId, table.lessonId),
    index('idx_class_group_lesson_progress_group_status').on(table.classGroupId, table.status)
  ]
);

export const classGroupLessonStepProgress = pgTable(
  'class_group_lesson_step_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    lessonStepId: uuid('lesson_step_id')
      .notNull()
      .references(() => lessonSteps.id, { onDelete: 'cascade' }),
    status: progressOverrideStatusEnum('status').notNull().default('not_started'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    meetingInstanceId: uuid('meeting_instance_id').references(() => meetingInstances.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_group_lesson_step_progress').on(table.classGroupId, table.lessonStepId)
  ]
);

export const classGroupUnitProgressOverrides = pgTable(
  'class_group_unit_progress_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    status: progressOverrideStatusEnum('status').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_class_group_unit_progress_override').on(table.classGroupId, table.unitId)
  ]
);

export const meetingHistory = pgTable(
  'meeting_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingInstanceId: uuid('meeting_instance_id')
      .notNull()
      .references(() => meetingInstances.id, { onDelete: 'restrict' }),
    classGroupId: uuid('class_group_id')
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    activeLessonId: uuid('active_lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    note: text('note'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique('uniq_meeting_history_instance').on(table.meetingInstanceId),
    index('idx_meeting_history_group').on(table.classGroupId, table.createdAt)
  ]
);

export const resourcesV3 = pgTable('resources_v3', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
  lessonStepId: uuid('lesson_step_id').references(() => lessonSteps.id, { onDelete: 'cascade' }),
  title: text('title'),
  url: text('url').notNull(),
  provider: text('provider').notNull().default('web'),
  resourceType: text('resource_type').notNull().default('link'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const lessonTemplates = pgTable(
  'lesson_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('idx_lesson_templates_teacher').on(table.teacherId)]
);

export const lessonTemplateSteps = pgTable('lesson_template_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonTemplateId: uuid('lesson_template_id')
    .notNull()
    .references(() => lessonTemplates.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  estimatedMinutes: integer('estimated_minutes'),
  isOptional: boolean('is_optional').notNull().default(false),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const usersRelations = relations(users, ({ many, one }) => ({
  teacherProfile: one(teacherProfiles),
  courses: many(courses),
  classNotes: many(classNotes),
  teacherNotes: many(teacherNotes)
}));

export const coursesRelations = relations(courses, ({ many, one }) => ({
  sections: many(sections),
  units: many(units),
  pacingPlan: one(coursePacingPlans),
  teacher: one(users, {
    fields: [courses.teacherId],
    references: [users.id]
  })
}));
