DO $$ BEGIN
  CREATE TYPE class_session_outcome AS ENUM ('taught', 'substitute', 'cancelled', 'shortened');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS section_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  outcome class_session_outcome NOT NULL,
  covered_planned_lesson boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_section_session_events_date
  ON section_session_events(section_id, session_date);
