-- 002_add_calendar_fields.sql
-- Run this in your Supabase SQL editor to apply the updates for the Smart Schedule features.

-- 1. Add Start/End Date to Class Periods (sections)
ALTER TABLE sections 
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

-- 2. Add duration and specific date targeting to lessons
ALTER TABLE lessons 
ADD COLUMN IF NOT EXISTS duration_periods INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS target_date DATE;

-- 3. Create School Holidays table for custom non-teaching days (Holidays/PD)
CREATE TABLE IF NOT EXISTS school_holidays (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (teacher_id, date)
);

-- Note: We add RLS to school_holidays so only the creating teacher can access them
ALTER TABLE school_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holidays_select" ON school_holidays
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "holidays_insert" ON school_holidays
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "holidays_update" ON school_holidays
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY "holidays_delete" ON school_holidays
  FOR DELETE USING (teacher_id = auth.uid());
