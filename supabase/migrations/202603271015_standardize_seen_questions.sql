create table if not exists public.user_seen_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, question_id)
);

alter table public.user_seen_questions enable row level security;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_seen_questions'
      and column_name = 'seen_at'
  ) then
    alter table public.user_seen_questions rename column seen_at to created_at;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_seen_questions'
      and column_name = 'id'
  ) then
    alter table public.user_seen_questions add column id uuid default gen_random_uuid();
    update public.user_seen_questions set id = gen_random_uuid() where id is null;
    alter table public.user_seen_questions alter column id set not null;
  end if;
end
$$;

do $$
declare
  existing_primary_key_name text;
begin
  select tc.constraint_name
  into existing_primary_key_name
  from information_schema.table_constraints tc
  where tc.table_schema = 'public'
    and tc.table_name = 'user_seen_questions'
    and tc.constraint_type = 'PRIMARY KEY';

  if existing_primary_key_name is not null and existing_primary_key_name <> 'user_seen_questions_pkey' then
    execute format('alter table public.user_seen_questions drop constraint %I', existing_primary_key_name);
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_seen_questions'
      and tc.constraint_name = 'user_seen_questions_pkey'
      and tc.constraint_type = 'PRIMARY KEY'
  ) then
    alter table public.user_seen_questions add constraint user_seen_questions_pkey primary key (id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_seen_questions_user_id_question_id_key'
  ) then
    alter table public.user_seen_questions
      add constraint user_seen_questions_user_id_question_id_key unique (user_id, question_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_seen_questions'
      and policyname = 'user_seen_questions_own_all'
  ) then
    create policy "user_seen_questions_own_all"
      on public.user_seen_questions
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'seen_questions'
  ) then
    insert into public.user_seen_questions (user_id, question_id, created_at)
    select profile_id, question_id, coalesce(seen_at, now())
    from public.seen_questions
    on conflict (user_id, question_id) do update
    set created_at = excluded.created_at;
  end if;
end
$$;
