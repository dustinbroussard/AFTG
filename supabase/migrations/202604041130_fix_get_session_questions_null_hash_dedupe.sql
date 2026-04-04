create or replace function public.get_session_questions(
  p_categories text[],
  p_count_per_category integer,
  p_exclude_question_ids uuid[] default '{}'::uuid[],
  p_user_ids uuid[] default '{}'::uuid[]
)
returns setof public.questions
language sql
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
    select
      q.*,
      (random() / greatest(q.used_count + 1, 1)::double precision) as fairness_score
    from public.questions q
    join requested_categories rc on rc.category = q.category
    left join seen_questions sq on sq.question_id = q.id
    where q.validation_status = 'approved'
      and not (q.id = any(coalesce(p_exclude_question_ids, '{}'::uuid[])))
      and sq.question_id is null
  ),
  deduped_questions as (
    select distinct on (eq.category, coalesce(eq.question_hash, eq.id::text))
      eq.*
    from eligible_questions eq
    order by
      eq.category,
      coalesce(eq.question_hash, eq.id::text),
      eq.fairness_score desc,
      eq.used_count asc,
      eq.created_at asc,
      random()
  ),
  ranked_questions as (
    select
      dq.id,
      row_number() over (
        partition by dq.category
        order by dq.fairness_score desc, random()
      ) as selection_rank
    from deduped_questions dq
  )
  select q.*
  from ranked_questions rq
  join public.questions q on q.id = rq.id
  where rq.selection_rank <= greatest(p_count_per_category, 0);
$$;
