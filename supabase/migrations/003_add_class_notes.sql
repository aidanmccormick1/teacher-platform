-- ============================================================
-- Migration: 003_add_class_notes
-- Defines the `class_notes` table for period-specific reminders
-- ============================================================

create table if not exists class_notes (
  id          uuid primary key default uuid_generate_v4(),
  teacher_id  uuid not null references users(id) on delete cascade,
  section_id  uuid not null references sections(id) on delete cascade,
  date        text not null, -- formatted as YYYY-MM-DD
  content     text not null default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (teacher_id, section_id, date)
);

-- Indexes
create index if not exists idx_class_notes_teacher_section on class_notes (teacher_id, section_id, date);

-- Row Level Security
alter table class_notes enable row level security;

-- Policies
create policy "class_notes_select_own" on class_notes
  for select using (teacher_id = auth.uid());

create policy "class_notes_insert_own" on class_notes
  for insert with check (teacher_id = auth.uid());

create policy "class_notes_update_own" on class_notes
  for update using (teacher_id = auth.uid());

create policy "class_notes_delete_own" on class_notes
  for delete using (teacher_id = auth.uid());
