CREATE TABLE "teacher_schedule_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "teacher_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "school_id" uuid NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT 'Weekly schedule',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "section_meetings" ADD COLUMN "meeting_end_time" time;
ALTER TABLE "section_meetings" ADD COLUMN "schedule_template_id" uuid REFERENCES "teacher_schedule_templates"("id") ON DELETE CASCADE;

CREATE TABLE "schedule_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_template_id" uuid NOT NULL REFERENCES "teacher_schedule_templates"("id") ON DELETE CASCADE,
  "day" text NOT NULL,
  "start_time" time,
  "end_time" time,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "schedule_date_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "teacher_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "school_id" uuid NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "rotation_day" text,
  "replace_weekly_schedule" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uniq_schedule_date_override_teacher_date" UNIQUE("teacher_id", "date")
);

CREATE TABLE "schedule_date_override_meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_date_override_id" uuid NOT NULL REFERENCES "schedule_date_overrides"("id") ON DELETE CASCADE,
  "section_id" uuid NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "meeting_time" time,
  "meeting_end_time" time,
  "room" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_teacher_schedule_templates_teacher" ON "teacher_schedule_templates" ("teacher_id");
CREATE INDEX "idx_teacher_schedule_templates_active" ON "teacher_schedule_templates" ("teacher_id", "is_active");
CREATE INDEX "idx_schedule_blocks_template" ON "schedule_blocks" ("schedule_template_id");
CREATE INDEX "idx_schedule_date_override_teacher_date" ON "schedule_date_overrides" ("teacher_id", "date");
CREATE INDEX "idx_schedule_override_meetings_override" ON "schedule_date_override_meetings" ("schedule_date_override_id");
