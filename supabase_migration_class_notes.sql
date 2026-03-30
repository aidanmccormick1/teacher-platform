-- Migration: class_notes table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS class_notes (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id  uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  section_id  uuid REFERENCES sections(id) ON DELETE CASCADE NOT NULL,
  date        date NOT NULL DEFAULT CURRENT_DATE,
  content     text NOT NULL DEFAULT '',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- One note per teacher per section per date
CREATE UNIQUE INDEX IF NOT EXISTS class_notes_teacher_section_date
  ON class_notes (teacher_id, section_id, date);

-- RLS
ALTER TABLE class_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "class_notes_select" ON class_notes;
CREATE POLICY "class_notes_select" ON class_notes
  FOR SELECT TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "class_notes_insert" ON class_notes;
CREATE POLICY "class_notes_insert" ON class_notes
  FOR INSERT TO authenticated WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "class_notes_update" ON class_notes;
CREATE POLICY "class_notes_update" ON class_notes
  FOR UPDATE TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "class_notes_delete" ON class_notes;
CREATE POLICY "class_notes_delete" ON class_notes
  FOR DELETE TO authenticated USING (teacher_id = auth.uid());

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON class_notes TO authenticated;
