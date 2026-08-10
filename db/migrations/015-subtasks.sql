-- ===========================================================================
--  Migration 015 — steps within a quest
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  WHY A SEPARATE TABLE, NOT todos.parent_id
--  -----------------------------------------
--  The obvious shape is a self-reference on todos, the way habit_id works. It
--  was the wrong call here. Thirty-nine places read the todos table, and every
--  one of them would need `and parent_id is null` bolted on. Miss the one in
--  sweep_overdue and each unchecked step charges its own -10 XP penalty at
--  midnight; miss the one in social-actions and a friend who ticks off six
--  steps reads as six quests completed. The XP economy is calibrated per quest
--  and its invariants live in those queries, so the safest change is one that
--  cannot reach them at all.
--
--  A step is therefore not a quest. It has a title and a tick, and that is all.
--
--  NO XP
--  -----
--  Steps deliberately pay nothing. If each one awarded XP, splitting a quest
--  into five steps would pay five times over for identical work — the cheapest
--  possible exploit in a game whose only currency is XP. The quest keeps its
--  single award; the steps just show you where you are inside it.
-- ===========================================================================

create table if not exists subtasks (
  id         uuid primary key default gen_random_uuid(),
  todo_id    uuid not null references todos(id)  on delete cascade,
  -- Denormalised from the parent so every write can be scoped with
  -- `and user_id = $me` in a single statement, matching the ownership pattern
  -- the quest actions use. The two can never disagree: the insert derives this
  -- column from a todos row already filtered by the caller's id.
  user_id    uuid not null references users(id)  on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 200),
  done       boolean not null default false,
  -- Steps are a sequence the user chose, not a deadline order, so unlike
  -- todos.position this one is actually read.
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists subtasks_todo_idx on subtasks (todo_id, position);
create index if not exists subtasks_user_idx on subtasks (user_id);

-- ---------------------------------------------------------------------------
-- add_subtask — append a step, enforcing ownership and the cap in one
-- statement so neither can be raced.
--
-- Returns the new row, or nothing if the quest isn't the caller's or is full.
-- ---------------------------------------------------------------------------
create or replace function add_subtask(
  p_user  uuid,
  p_todo  uuid,
  p_title text
) returns setof subtasks
language sql
as $$
  insert into subtasks (todo_id, user_id, title, position)
  select t.id,
         t.user_id,
         btrim(p_title),
         coalesce((select max(s.position) + 1 from subtasks s where s.todo_id = t.id), 0)
    from todos t
   where t.id = p_todo
     and t.user_id = p_user
     and btrim(p_title) <> ''
     -- Twenty is plenty for a checklist and keeps a single quest from being
     -- used as unbounded storage.
     and (select count(*) from subtasks s where s.todo_id = t.id) < 20
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- subtask_progress — how far into a quest its steps are.
--
-- A view rather than counters on todos: there are at most twenty rows per
-- quest, so counting is cheap, and a derived number cannot drift out of step
-- with the rows it describes.
-- ---------------------------------------------------------------------------
create or replace view subtask_progress as
  select todo_id,
         count(*)::integer                                as total,
         count(*) filter (where done)::integer            as done
    from subtasks
group by todo_id;
