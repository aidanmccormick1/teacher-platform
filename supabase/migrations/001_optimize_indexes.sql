-- Performance optimization: Add missing indexes
-- Run these in Supabase SQL editor to improve query performance

-- Index for fast course + sections joins
create index if not exists idx_sections_course_id_meeting_time
  on sections (course_id, meeting_time);

-- GIN index for meeting_days array searches (helps with schedule filtering)
create index if not exists idx_sections_meeting_days_gin
  on sections using gin (meeting_days);

-- Composite index for courses by teacher (already exists, but ensure present)
-- create index if not exists idx_courses_teacher on courses (teacher_id);

-- Index for schedule overrides lookups
create index if not exists idx_schedule_overrides_section_date
  on schedule_overrides (section_id, override_date);

-- Index for lesson progress timeline queries
create index if not exists idx_lesson_progress_date_section
  on lesson_progress (date_taught, section_id);

-- Index for materials by course (helps with material lookups)
create index if not exists idx_materials_course_shared
  on materials (course_id, is_shared);

-- Index for faster user school lookups
create index if not exists idx_users_school_id
  on users (school_id);
