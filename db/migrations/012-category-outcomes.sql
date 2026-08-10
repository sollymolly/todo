-- ===========================================================================
--  Migration 012 — per-category on-time / late counters
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  The Strengths panel now reports a *missed* percentage, and finishing
--  something late counts as missed — you did blow the deadline. That needs one
--  more fact per category than we were keeping: whether a completed quest beat
--  its deadline or not.
--
--  It has to be a counter for the same reason the others are: completed quests
--  are deleted after a week, so counting them live would quietly walk every
--  category's history back to zero.
-- ===========================================================================

alter table categories add column if not exists archived_on_time integer not null default 0;
alter table categories add column if not exists archived_late    integer not null default 0;

-- ---------------------------------------------------------------------------
-- prune_finished — unchanged except that the per-category update now carries
-- the on-time / late split alongside the total.
-- ---------------------------------------------------------------------------
create or replace function prune_finished(p_user uuid, p_days integer default 7)
returns integer
language plpgsql
as $$
declare
  v_pruned integer;
begin
  with gone as (
    delete from todos
     where user_id = p_user
       and status  = 'done'
       and completed_at is not null
       and completed_at < now() - make_interval(days => p_days)
    returning category_id, due_date, completed_at
  ),
  tally as (
    select
      category_id,
      count(*)::integer as done,
      count(*) filter (
        where due_date is not null and completed_at <= due_date
      )::integer as on_time,
      count(*) filter (
        where due_date is not null and completed_at > due_date
      )::integer as late
    from gone
    group by category_id
  ),
  totals as (
    select
      coalesce(sum(done), 0)::integer    as done,
      coalesce(sum(on_time), 0)::integer as on_time,
      coalesce(sum(late), 0)::integer    as late
    from tally
  ),
  bump_categories as (
    update categories c
       set archived_done    = c.archived_done    + t.done,
           archived_on_time = c.archived_on_time + t.on_time,
           archived_late    = c.archived_late    + t.late
      from tally t
     where t.category_id = c.id
       and c.user_id = p_user
    returning 1
  ),
  bump_profile as (
    update profiles p
       set archived_done    = p.archived_done    + (select done    from totals),
           archived_on_time = p.archived_on_time + (select on_time from totals),
           archived_late    = p.archived_late    + (select late    from totals)
     where p.id = p_user
       and (select done from totals) > 0
    returning 1
  )
  select done into v_pruned from totals;

  return coalesce(v_pruned, 0);
end;
$$;
