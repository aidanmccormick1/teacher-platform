CREATE TABLE "course_pacing_plans" (
  "course_id" uuid PRIMARY KEY REFERENCES "courses"("id") ON DELETE CASCADE,
  "start_date" date,
  "weeks" integer,
  "meetings_per_week" integer,
  "planned_class_periods" integer,
  "class_period_minutes" integer NOT NULL DEFAULT 50,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "teacher_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_teacher_notes_user_updated" ON "teacher_notes" ("user_id", "updated_at");
