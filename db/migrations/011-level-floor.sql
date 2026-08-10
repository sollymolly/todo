-- ===========================================================================
--  Migration 011 — a level, once earned, is never lost
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  THE PROBLEM
--  -----------
--  Level was derived from XP alone, so a missed deadline could drop you back
--  below a rank threshold. That is bad on its own, but it also silently took
--  gear away: saveEquipped re-checks each item's level requirement, so the next
--  save would quietly strip armour you had already earned.
--
--  THE FIX
--  -------
--  profiles.level is a high-water mark, and XP is floored at the *bottom of
--  that level* instead of at zero. So the worst a bad week can do is empty the
--  progress bar for your current rank — 0 XP into the level, never out of it.
--
--  Because XP can no longer fall below the level's floor, level_for_xp(xp) and
--  profiles.level always agree, which keeps every derived display honest
--  without a second source of truth.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The rank curve, so the database can work out a level without the app.
-- These are the same numbers as RANKS in src/lib/game.ts — change both.
-- ---------------------------------------------------------------------------
create table if not exists ranks (
  level integer primary key,
  xp    integer not null
);

insert into ranks (level, xp) values
  (1, 0), (2, 50), (3, 130), (4, 250), (5, 420),
  (6, 650), (7, 950), (8, 1330), (9, 1800), (10, 2370),
  (11, 3050), (12, 3850), (13, 4780), (14, 5850), (15, 7070),
  (16, 8450), (17, 10000), (18, 11730), (19, 13650), (20, 15770)
on conflict (level) do update set xp = excluded.xp;

-- Past the named ranks the curve is linear, mirroring xpForLevel().
create or replace function xp_for_level(p_level integer)
returns integer
language sql stable as $$
  select case
    when p_level <= 1 then 0
    else coalesce(
      (select r.xp from ranks r where r.level = p_level),
      (select max(r.xp) + (p_level - max(r.level)) * 2500 from ranks r)
    )
  end;
$$;

create or replace function level_for_xp(p_xp integer)
returns integer
language sql stable as $$
  with top as (select max(level) as level, max(xp) as xp from ranks)
  select case
    when p_xp >= (select xp from top)
      then (select level from top) + ((p_xp - (select xp from top)) / 2500)
    else coalesce((select max(r.level) from ranks r where r.xp <= p_xp), 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The high-water level. Seeded from what everyone currently has — a peak that
-- was passed and then lost isn't recoverable from the data, so today's level is
-- the honest starting point.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists level integer not null default 1;

update profiles set level = level_for_xp(xp) where level <> level_for_xp(xp);

-- ---------------------------------------------------------------------------
-- quest_transition — same reconciliation as before, but the floor is now the
-- bottom of the earned level rather than zero, and the level ratchets upward
-- whenever XP crosses the next threshold.
-- ---------------------------------------------------------------------------
create or replace function quest_transition(
  p_user      uuid,
  p_todo      uuid,
  p_status    text,
  p_completed timestamptz,
  p_reason    text
) returns json
language plpgsql
as $$
declare
  v_todo    todos%rowtype;
  v_target  integer;
  v_delta   integer;
  v_before  integer;
  v_level   integer;
  v_floor   integer;
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  if not found then raise exception 'Quest not found'; end if;

  v_target := quest_target_xp(p_status, v_todo.due_date, p_completed);
  v_delta  := v_target - v_todo.xp_awarded;

  select xp, level into v_before, v_level from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  -- A rank already reached is kept, so XP stops at the bottom of it.
  v_floor := xp_for_level(v_level);

  -- Record what actually *moved*, not what was intended: a penalty bigger than
  -- the room above the floor is only partly charged, and the next transition
  -- has to see the true figure or it will refund XP that was never taken.
  v_applied := greatest(v_floor, v_before + v_delta) - v_before;

  update todos set
    status       = p_status,
    completed_at = p_completed,
    xp_awarded   = v_todo.xp_awarded + v_applied
  where id = p_todo;

  update profiles set xp = v_before + v_applied
   where id = p_user
  returning xp into v_xp;

  -- Ratchet, never reverse.
  if level_for_xp(v_xp) > v_level then
    update profiles set level = level_for_xp(v_xp) where id = p_user;
  end if;

  if v_applied <> 0 then
    insert into xp_events (user_id, todo_id, delta, reason)
    values (p_user, p_todo, v_applied, p_reason);
  end if;

  -- `delta` is what just moved (what to celebrate); `awarded` is the quest's
  -- running total (what the row should display).
  return json_build_object(
    'delta', v_applied, 'awarded', v_todo.xp_awarded + v_applied,
    'xp', v_xp, 'reason', p_reason
  );
end;
$$;
