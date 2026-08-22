-- Make question flagging operational.
-- The question_flags table existed only in supabase/schema.sql (never deployed).
-- This migration deploys it, adds a flag_question RPC that records a flag and
-- sets validation_status='flagged' (auto-excluded from get_session_questions),
-- and adds an admin-gated review/restore path via profiles.is_admin.

-- 1. question_flags table (repo DDL + unique reporter constraint + index)
create table if not exists public.question_flags (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  reporter_profile_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint question_flags_question_reporter_unique unique (question_id, reporter_profile_id)
);

create index if not exists question_flags_question_idx on public.question_flags (question_id);
create index if not exists question_flags_reporter_idx on public.question_flags (reporter_profile_id);

alter table public.question_flags enable row level security;

drop policy if exists "question_flags_authenticated_insert" on public.question_flags;
create policy "question_flags_authenticated_insert"
  on public.question_flags
  for insert
  with check (auth.uid() = reporter_profile_id);

drop policy if exists "question_flags_own_select" on public.question_flags;
create policy "question_flags_own_select"
  on public.question_flags
  for select
  using (auth.uid() = reporter_profile_id or auth.role() = 'service_role');

-- 2. Admin concept on profiles (no column exists live today)
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- 3. flag_question: records the flag and marks the question 'flagged' so
--    get_session_questions stops serving it to everyone.
create or replace function public.flag_question(
  p_question_id uuid,
  p_reason text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter_id uuid := auth.uid();
begin
  if v_reporter_id is null then
    raise exception 'Authentication is required to flag a question.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.questions where id = p_question_id) then
    raise exception 'Question not found.' using errcode = 'P0002';
  end if;

  insert into public.question_flags (question_id, reporter_profile_id, reason, details)
  values (p_question_id, v_reporter_id, p_reason, p_details)
  on conflict (question_id, reporter_profile_id) do nothing;

  update public.questions
  set validation_status = 'flagged',
      review_notes = case
        when review_notes is null or review_notes = '' then 'FLAGGED by ' || v_reporter_id::text || ' at ' || now()::text
        else review_notes || E'\n' || 'FLAGGED by ' || v_reporter_id::text || ' at ' || now()::text
      end
  where id = p_question_id
    and validation_status is distinct from 'flagged';
end;
$$;

revoke all on function public.flag_question(uuid, text, jsonb) from public;
grant execute on function public.flag_question(uuid, text, jsonb) to authenticated;

-- 4. list_flagged_questions: admin-only queue for the review panel.
create or replace function public.list_flagged_questions()
returns table (
  question_id uuid,
  question_text text,
  category text,
  difficulty text,
  validation_status text,
  flag_count bigint,
  reporters uuid[],
  reasons text[],
  first_flagged_at timestamptz,
  last_flagged_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  select p.is_admin into v_admin from public.profiles p where p.id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Admin privileges are required to review flagged questions.' using errcode = '42501';
  end if;

  return query
  select
    q.id as question_id,
    coalesce(q.question, q.content) as question_text,
    q.category,
    q.difficulty_level as difficulty,
    coalesce(q.validation_status::text, '') as validation_status,
    count(qf.id)::bigint as flag_count,
    array_agg(qf.reporter_profile_id) as reporters,
    array_agg(qf.reason) filter (where qf.reason is not null) as reasons,
    min(qf.created_at) as first_flagged_at,
    max(qf.created_at) as last_flagged_at
  from public.question_flags qf
  join public.questions q on q.id = qf.question_id
  group by q.id, q.category, q.difficulty_level, q.validation_status, coalesce(q.question, q.content)
  order by last_flagged_at desc;
end;
$$;

revoke all on function public.list_flagged_questions() from public;
grant execute on function public.list_flagged_questions() to authenticated;

-- 5. clear_question_flag: admin restore — deletes flag rows and resets status.
create or replace function public.clear_question_flag(
  p_question_id uuid,
  p_restore_status text default 'approved'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  if p_restore_status not in ('approved', 'pending', 'rejected', 'flagged') then
    raise exception 'Invalid restore status.' using errcode = '22023';
  end if;

  select p.is_admin into v_admin from public.profiles p where p.id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Admin privileges are required to restore a flagged question.' using errcode = '42501';
  end if;

  delete from public.question_flags where question_id = p_question_id;

  update public.questions
  set validation_status = p_restore_status
  where id = p_question_id;
end;
$$;

revoke all on function public.clear_question_flag(uuid, text) from public;
grant execute on function public.clear_question_flag(uuid, text) to authenticated;

-- 6. Designate the host (Dustin) as admin.
update public.profiles
set is_admin = true
where id = '4b4ec333-8424-4a09-942b-81f844d31def'
  and is_admin = false;