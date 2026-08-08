-- ===========================================================================
--  Migration 001 — manual quest ordering
--
--  Adds todos.position so quests can be dragged into any order, not just
--  sorted by deadline. Safe to run more than once.
--
--  `create table if not exists` in db/schema.sql skips tables that already
--  exist, so it will NOT add this column to an existing database. Run this
--  file once in the Neon SQL Editor.
-- ===========================================================================

alter table todos add column if not exists position double precision;

-- Backfill in the order quests are displayed today (deadline first, undated
-- last), so nothing appears to jump when the new sort takes over.
with ordered as (
  select
    id,
    row_number() over (
      partition by user_id
      order by (due_date is null), due_date, created_at desc
    ) as rn
  from todos
)
update todos t
   set position = o.rn * 1024
  from ordered o
 where o.id = t.id
   and t.position is null;

create index if not exists todos_position_idx on todos(user_id, position);
