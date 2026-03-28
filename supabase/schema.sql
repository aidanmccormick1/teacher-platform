-- ============================================================
-- Teacher Platform — Supabase Schema + RLS
-- Run this in the Supabase SQL editor for a fresh project
-- ============================================================

-- ─── Extensions ─────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Enums ──────────────────────────────────────────────────
create type user_role as enum ('teacher', 'department_head', 'admin');
create type lesson_status as enum ('not_started', 'in_progress', 'completed', 'skipped');

-- ─── Tables ─────────────────────────────────────────────────

create table schools (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  district    text,
  state       text,
  created_at  timestamptz default now()
);

create table users (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  full_name   text,
  role        user_role not null default 'teacher',
  school_id   uuid references schools(id),
  onboarded   boolean default false,
  created_at  timestamptz default now()
);

create table courses (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  subject     text,
  grade_level text,
  teacher_id  uuid not null references users(id) on delete cascade,
  school_id   uuid references schools(id),
  created_at  timestamptz default now()
);

create table sections (
  id            uuid primary key default uuid_generate_v4(),
  course_id     uuid not null references courses(id) on delete cascade,
  name          text not null,
  meeting_days  text[] not null default '{}',
  meeting_time  time,
  room          text,
  created_at    timestamptz default now()
);

create table units (
  id          uuid primary key default uuid_generate_v4(),
  course_id   uuid not null references courses(id) on delete cascade,
  title       text not null,
  description text,
  order_index integer not null default 0,
  standards   text[] default '{}',
  created_at  timestamptz default now()
);

create table lessons (
  id                        uuid primary key default uuid_generate_v4(),
  unit_id                   uuid not null references units(id) on delete cascade,
  title                     text not null,
  description               text,
  order_index               integer not null default 0,
  estimated_duration_minutes integer,
  created_at                timestamptz default now()
);

create table lesson_segments (
  id               uuid primary key default uuid_generate_v4(),
  lesson_id        uuid not null references lessons(id) on delete cascade,
  title            text not null,
  description      text,
  duration_minutes integer,
  order_index      integer not null default 0
);

create table lesson_progress (
  id                          uuid primary key default uuid_generate_v4(),
  lesson_id                   uuid not null references lessons(id) on delete cascade,
  section_id                  uuid not null references sections(id) on delete cascade,
  date_taught                 date,
  status                      lesson_status not null default 'not_started',
  last_segment_completed_index integer default -1,
  skip_reason                 text,
  carry_over_note             text,
  completed_at                timestamptz,
  updated_at                  timestamptz default now(),
  unique (lesson_id, section_id, date_taught)
);

create table materials (
  id          uuid primary key default uuid_generate_v4(),
  course_id   uuid not null references courses(id) on delete cascade,
  uploaded_by uuid not null references users(id),
  title       text not null,
  file_url    text,
  file_type   text,
  tags        text[] default '{}',
  is_shared   boolean default false,
  created_at  timestamptz default now()
);

create table schedule_overrides (
  id            uuid primary key default uuid_generate_v4(),
  section_id    uuid not null references sections(id) on delete cascade,
  override_date date not null,
  reason        text,
  cancelled     boolean default false,
  new_time      time,
  created_at    timestamptz default now(),
  unique (section_id, override_date)
);

-- ─── Indexes ────────────────────────────────────────────────
create index idx_lesson_progress_section_lesson_date
  on lesson_progress (section_id, lesson_id, date_taught);

create index idx_courses_teacher on courses (teacher_id);
create index idx_sections_course on sections (course_id);
create index idx_units_course on units (course_id, order_index);
create index idx_lessons_unit on lessons (unit_id, order_index);
create index idx_segments_lesson on lesson_segments (lesson_id, order_index);
create index idx_overrides_section_date on schedule_overrides (section_id, override_date);

-- ─── Row Level Security ─────────────────────────────────────

alter table schools enable row level security;
alter table users enable row level security;
alter table courses enable row level security;
alter table sections enable row level security;
alter table units enable row level security;
alter table lessons enable row level security;
alter table lesson_segments enable row level security;
alter table lesson_progress enable row level security;
alter table materials enable row level security;
alter table schedule_overrides enable row level security;

-- Helper: get the current user's row
create or replace function current_user_row()
returns users language sql security definer stable as $$
  select * from users where id = auth.uid();
$$;

-- Helper: get current user's school_id
create or replace function current_school_id()
returns uuid language sql security definer stable as $$
  select school_id from users where id = auth.uid();
$$;

-- Helper: get current user's role
create or replace function current_user_role()
returns user_role language sql security definer stable as $$
  select role from users where id = auth.uid();
$$;

-- schools: read own school; admins read all in their school
create policy "schools_select" on schools
  for select using (
    id = current_school_id()
    or current_user_role() = 'admin'
  );

create policy "schools_insert" on schools
  for insert with check (true); -- anyone can create a school on signup

-- users: read own row; admins can read all in their school
create policy "users_select_own" on users
  for select using (
    id = auth.uid()
    or (school_id = current_school_id() and current_user_role() in ('admin', 'department_head'))
  );

create policy "users_insert_own" on users
  for insert with check (id = auth.uid());

create policy "users_update_own" on users
  for update using (id = auth.uid());

-- courses: teacher owns; admin sees all in school
create policy "courses_select" on courses
  for select using (
    teacher_id = auth.uid()
    or (school_id = current_school_id() and current_user_role() in ('admin', 'department_head'))
  );

create policy "courses_insert" on courses
  for insert with check (teacher_id = auth.uid());

create policy "courses_update" on courses
  for update using (teacher_id = auth.uid());

create policy "courses_delete" on courses
  for delete using (teacher_id = auth.uid());

-- sections: via course ownership
create policy "sections_select" on sections
  for select using (
    exists (
      select 1 from courses c
      where c.id = sections.course_id
        and (c.teacher_id = auth.uid()
          or (c.school_id = current_school_id() and current_user_role() in ('admin', 'department_head')))
    )
  );

create policy "sections_insert" on sections
  for insert with check (
    exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

create policy "sections_update" on sections
  for update using (
    exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

create policy "sections_delete" on sections
  for delete using (
    exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

-- units
create policy "units_select" on units
  for select using (
    exists (
      select 1 from courses c where c.id = units.course_id
        and (c.teacher_id = auth.uid()
          or (c.school_id = current_school_id() and current_user_role() in ('admin', 'department_head')))
    )
  );

create policy "units_insert" on units
  for insert with check (
    exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

create policy "units_update" on units
  for update using (
    exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

create policy "units_delete" on units
  for delete using (
    exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

-- lessons
create policy "lessons_select" on lessons
  for select using (
    exists (
      select 1 from units u
      join courses c on c.id = u.course_id
      where u.id = lessons.unit_id
        and (c.teacher_id = auth.uid()
          or (c.school_id = current_school_id() and current_user_role() in ('admin', 'department_head')))
    )
  );

create policy "lessons_insert" on lessons
  for insert with check (
    exists (
      select 1 from units u join courses c on c.id = u.course_id
      where u.id = unit_id and c.teacher_id = auth.uid()
    )
  );

create policy "lessons_update" on lessons
  for update using (
    exists (
      select 1 from units u join courses c on c.id = u.course_id
      where u.id = unit_id and c.teacher_id = auth.uid()
    )
  );

create policy "lessons_delete" on lessons
  for delete using (
    exists (
      select 1 from units u join courses c on c.id = u.course_id
      where u.id = unit_id and c.teacher_id = auth.uid()
    )
  );

-- lesson_segments: same chain
create policy "segments_select" on lesson_segments
  for select using (
    exists (
      select 1 from lessons l join units u on u.id = l.unit_id
      join courses c on c.id = u.course_id
      where l.id = lesson_segments.lesson_id
        and (c.teacher_id = auth.uid()
          or (c.school_id = current_school_id() and current_user_role() in ('admin', 'department_head')))
    )
  );

create policy "segments_insert" on lesson_segments
  for insert with check (
    exists (
      select 1 from lessons l join units u on u.id = l.unit_id
      join courses c on c.id = u.course_id
      where l.id = lesson_id and c.teacher_id = auth.uid()
    )
  );

create policy "segments_update" on lesson_segments
  for update using (
    exists (
      select 1 from lessons l join units u on u.id = l.unit_id
      join courses c on c.id = u.course_id
      where l.id = lesson_id and c.teacher_id = auth.uid()
    )
  );

create policy "segments_delete" on lesson_segments
  for delete using (
    exists (
      select 1 from lessons l join units u on u.id = l.unit_id
      join courses c on c.id = u.course_id
      where l.id = lesson_id and c.teacher_id = auth.uid()
    )
  );

-- lesson_progress: teacher owns (via section's course)
create policy "progress_select" on lesson_progress
  for select using (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = lesson_progress.section_id
        and (c.teacher_id = auth.uid()
          or (c.school_id = current_school_id() and current_user_role() in ('admin', 'department_head')))
    )
  );

create policy "progress_insert" on lesson_progress
  for insert with check (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = section_id and c.teacher_id = auth.uid()
    )
  );

create policy "progress_update" on lesson_progress
  for update using (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = section_id and c.teacher_id = auth.uid()
    )
  );

-- materials
create policy "materials_select" on materials
  for select using (
    uploaded_by = auth.uid()
    or (is_shared = true and exists (
      select 1 from courses c where c.id = materials.course_id
        and c.school_id = current_school_id()
    ))
  );

create policy "materials_insert" on materials
  for insert with check (uploaded_by = auth.uid());

create policy "materials_update" on materials
  for update using (uploaded_by = auth.uid());

create policy "materials_delete" on materials
  for delete using (uploaded_by = auth.uid());

-- schedule_overrides
create policy "overrides_select" on schedule_overrides
  for select using (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = schedule_overrides.section_id
        and (c.teacher_id = auth.uid()
          or (c.school_id = current_school_id() and current_user_role() in ('admin', 'department_head')))
    )
  );

create policy "overrides_insert" on schedule_overrides
  for insert with check (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = section_id and c.teacher_id = auth.uid()
    )
  );

create policy "overrides_update" on schedule_overrides
  for update using (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = section_id and c.teacher_id = auth.uid()
    )
  );

create policy "overrides_delete" on schedule_overrides
  for delete using (
    exists (
      select 1 from sections s join courses c on c.id = s.course_id
      where s.id = section_id and c.teacher_id = auth.uid()
    )
  );

-- ─── Trigger: auto-create user profile on signup ─────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── Storage bucket (run separately or via dashboard) ────────
-- insert into storage.buckets (id, name, public) values ('materials', 'materials', false);
