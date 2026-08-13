-- TeacherOS v3 keeps account identity intact and introduces the calendar-first domain.
-- Legacy v2 scheduling records are intentionally left untouched so deployment can be
-- rolled forward safely; v3 routes use only the tables defined below.

ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE units ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE units ADD COLUMN IF NOT EXISTS duration_kind text;
ALTER TABLE units ADD COLUMN IF NOT EXISTS estimated_weeks integer;
ALTER TABLE units ADD COLUMN IF NOT EXISTS estimated_meetings integer;

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS duration_kind text;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS estimated_meetings integer;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS source_lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS source_course_id uuid REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS source_unit_id uuid REFERENCES units(id) ON DELETE SET NULL;

DO $$ BEGIN
  CREATE TYPE meeting_instance_source AS ENUM ('generated', 'override', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE meeting_instance_state AS ENUM ('scheduled', 'superseded', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE override_meeting_action AS ENUM ('replace', 'add', 'cancel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE progress_override_status AS ENUM ('not_started', 'in_progress', 'completed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_academic_year_per_teacher
  ON academic_years(teacher_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_academic_years_teacher ON academic_years(teacher_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  label text NOT NULL,
  type text NOT NULL DEFAULT 'other',
  instructional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_year_dates
  ON calendar_events(academic_year_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS class_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,
  period_label text,
  room text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id, academic_year_id, name)
);
CREATE INDEX IF NOT EXISTS idx_class_groups_course ON class_groups(course_id);
CREATE INDEX IF NOT EXISTS idx_class_groups_year ON class_groups(academic_year_id);

CREATE TABLE IF NOT EXISTS meeting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  effective_start date,
  effective_end date,
  room text,
  recurrence_kind text NOT NULL DEFAULT 'weekly',
  rotation_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (effective_end IS NULL OR effective_start IS NULL OR effective_end >= effective_start)
);
CREATE INDEX IF NOT EXISTS idx_meeting_rules_group ON meeting_rules(class_group_id);

CREATE TABLE IF NOT EXISTS meeting_rule_days (
  meeting_rule_id uuid NOT NULL REFERENCES meeting_rules(id) ON DELETE CASCADE,
  weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  PRIMARY KEY(meeting_rule_id, weekday)
);

CREATE TABLE IF NOT EXISTS schedule_overrides_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  date date NOT NULL,
  label text NOT NULL,
  type text NOT NULL DEFAULT 'special_schedule',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(academic_year_id, date, label)
);
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_v3_year_date
  ON schedule_overrides_v3(academic_year_id, date);

CREATE TABLE IF NOT EXISTS schedule_override_meetings_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_override_id uuid NOT NULL REFERENCES schedule_overrides_v3(id) ON DELETE CASCADE,
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  action override_meeting_action NOT NULL DEFAULT 'replace',
  start_time time,
  end_time time,
  room text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'cancel') OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX IF NOT EXISTS idx_override_meetings_v3_override
  ON schedule_override_meetings_v3(schedule_override_id);

CREATE TABLE IF NOT EXISTS meeting_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  meeting_number integer NOT NULL,
  source meeting_instance_source NOT NULL DEFAULT 'generated',
  state meeting_instance_state NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_group_id, academic_year_id, meeting_number),
  UNIQUE(class_group_id, local_date, start_time),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_meeting_instances_group_date
  ON meeting_instances(class_group_id, local_date, start_time);

CREATE TABLE IF NOT EXISTS lesson_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  estimated_minutes integer,
  is_optional boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (estimated_minutes IS NULL OR estimated_minutes > 0)
);
CREATE INDEX IF NOT EXISTS idx_lesson_steps_lesson_order ON lesson_steps(lesson_id, order_index);

CREATE TABLE IF NOT EXISTS class_group_unit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  plan_kind text,
  estimated_weeks integer,
  estimated_meetings integer,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_group_id, unit_id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS plan_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  meeting_instance_id uuid NOT NULL REFERENCES meeting_instances(id) ON DELETE RESTRICT,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  lesson_step_id uuid REFERENCES lesson_steps(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_allocations_group_meeting
  ON plan_allocations(class_group_id, meeting_instance_id, order_index);
CREATE INDEX IF NOT EXISTS idx_plan_allocations_lesson ON plan_allocations(lesson_id);

CREATE TABLE IF NOT EXISTS class_group_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  status progress_override_status NOT NULL DEFAULT 'not_started',
  manual_override boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  actual_start_meeting_id uuid REFERENCES meeting_instances(id) ON DELETE SET NULL,
  actual_completion_meeting_id uuid REFERENCES meeting_instances(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_group_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_class_group_lesson_progress_group_status
  ON class_group_lesson_progress(class_group_id, status);

CREATE TABLE IF NOT EXISTS class_group_lesson_step_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  lesson_step_id uuid NOT NULL REFERENCES lesson_steps(id) ON DELETE CASCADE,
  status progress_override_status NOT NULL DEFAULT 'not_started',
  completed_at timestamptz,
  skipped_at timestamptz,
  meeting_instance_id uuid REFERENCES meeting_instances(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_group_id, lesson_step_id)
);

CREATE TABLE IF NOT EXISTS class_group_unit_progress_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  status progress_override_status NOT NULL,
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_group_id, unit_id)
);

CREATE TABLE IF NOT EXISTS meeting_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_instance_id uuid NOT NULL REFERENCES meeting_instances(id) ON DELETE RESTRICT,
  class_group_id uuid NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,
  active_lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL,
  note text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(meeting_instance_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_history_group ON meeting_history(class_group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS resources_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES units(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES lessons(id) ON DELETE CASCADE,
  lesson_step_id uuid REFERENCES lesson_steps(id) ON DELETE CASCADE,
  title text,
  url text NOT NULL,
  provider text NOT NULL DEFAULT 'web',
  resource_type text NOT NULL DEFAULT 'link',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(course_id, unit_id, lesson_id, lesson_step_id) = 1)
);

CREATE TABLE IF NOT EXISTS lesson_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lesson_templates_teacher ON lesson_templates(teacher_id);

CREATE TABLE IF NOT EXISTS lesson_template_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_template_id uuid NOT NULL REFERENCES lesson_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  estimated_minutes integer,
  is_optional boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
