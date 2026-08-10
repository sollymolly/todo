-- ===========================================================================
--  Migration 009 — finished quests are kept for a week, and category strength
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  ⚠ This one DELETES DATA, permanently and on an ongoing basis. Completed
--  quests older than the retention window are removed on the owner's next page
--  load and cannot be recovered. Their titles, notes and deadlines are gone;
--  only the counts survive. That is the intended trade for storage, but it is
--  worth knowing before running it.
--
--  WHY COUNTERS RATHER THAN A LIVE QUERY
--  ------------------------------------
--  Every completion metric used to be a `count(*)` over todos. Delete the rows
--  and the metrics silently fall to zero. So each quest is rolled into durable
--  counters at the moment it is deleted.
--
--  Counting at deletion time is what makes this safe: a row can only be deleted
--  once, so it can only ever be counted once. Incrementing a counter on
--  completion instead would need the same reconciliation dance the XP economy
--  needed in migration 007 — and would double-count every toggle.
--
--  Live quests keep being counted from `todos`. Every total is therefore
--  "archived counter + live count", which stays correct across pruning.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Lifetime counters for quests that no longer exist.
--
-- `archived_late` exists because the on-time rate is onTime / (onTime + missed),
-- and a quest finished after its deadline feeds the *missed* side. Without it,
-- pruning would quietly flatter everyone's on-time percentage.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists archived_done    integer not null default 0;
alter table profiles add column if not exists archived_on_time integer not null default 0;
alter table profiles add column if not exists archived_late    integer not null default 0;

-- Per category, only what the strength bar needs. A missed quest is never
-- pruned — it stays on the board until it is finished or deleted — so the
-- other side of that ratio is always countable live.
alter table categories add column if not exists archived_done integer not null default 0;

-- ---------------------------------------------------------------------------
-- prune_finished — delete completed quests past the retention window, folding
-- them into the counters on the way out. Returns how many were removed.
--
-- Missed quests are deliberately untouched: they are still completable, so they
-- are not finished, and deleting them would take away the chance to redeem one.
-- ---------------------------------------------------------------------------
create or replace function prune_finished(p_user uuid, p_days integer default 7)
returns integer
language plpgsql
as $$
declare
  v_pruned integer;
begin
  -- One statement, so the delete and every counter move commit together. A
  -- data-modifying CTE always runs to completion even when nothing reads it,
  -- which is what lets the two counter updates hang off the same delete.
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
       set archived_done = c.archived_done + t.done
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
