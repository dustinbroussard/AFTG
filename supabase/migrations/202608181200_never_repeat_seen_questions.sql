-- A question shown in a multiplayer game is considered seen by every player.
-- New sessions must only select questions outside the combined seen history.
-- Design: Per-player persistence + per-game exclusion.

create or replace function public.mark_game_question_seen(
  p_game_id uuid,
  p_question_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to reserve a question.' using errcode = '42501';
  end if;

  select player_ids
  into v_player_ids
  from public.games
  where id = p_game_id;

  if not found or coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'Game not found or has no players.' using errcode = 'P0002';
  end if;

  if not auth.uid() = any(v_player_ids) then
    raise exception 'Only a game participant can reserve its questions.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.questions where id = p_question_id) then
    raise exception 'Question not found.' using errcode = 'P0002';
  end if;

  insert into public.user_seen_questions (user_id, question_id)
  select distinct player_id, p_question_id
  from unnest(v_player_ids) as player_id
  on conflict (user_id, question_id) do nothing;
end;
$$;

revoke all on function public.mark_game_question_seen(uuid, uuid) from public;
grant execute on function public.mark_game_question_seen(uuid, uuid) to authenticated;

create or replace function public.get_session_questions(
  p_categories text[],
  p_count_per_category integer,
  p_exclude_question_ids uuid[] default '{}'::uuid[],
  p_user_ids uuid[] default '{}'::uuid[]
)
returns setof public.questions
language sql
security definer
set search_path = public
volatile
as $$
  with requested_categories as (
    select distinct unnest(coalesce(p_categories, '{}'::text[])) as category
  ),
  seen_questions as (
    select distinct usq.question_id
    from public.user_seen_questions usq
    where usq.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
  ),
  eligible_questions as (
    select q.*
    from public.questions q
    join requested_categories rc on rc.category = q.category
    left join seen_questions sq on sq.question_id = q.id
    where coalesce(q.validation_status::text, '') not in ('pending', 'rejected', 'flagged')
      and not (q.id = any(coalesce(p_exclude_question_ids, '{}'::uuid[])))
      and sq.question_id is null
  ),
  ranked_questions as (
    select
      eq.id,
      row_number() over (
        partition by eq.category
        order by random()
      ) as selection_rank
    from eligible_questions eq
  )
  select q.*
  from ranked_questions rq
  join public.questions q on q.id = rq.id
  where rq.selection_rank <= greatest(p_count_per_category, 0);
$$;

revoke all on function public.get_session_questions(text[], integer, uuid[], uuid[]) from public;
grant execute on function public.get_session_questions(text[], integer, uuid[], uuid[]) to authenticated;
