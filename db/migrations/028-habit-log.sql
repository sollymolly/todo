-- ===========================================================================
--  Migration 028 — habits become their own thing: a daily log, not quests
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  WHAT CHANGES
--  ------------
--  Habits stop materialising todos. A habit is ticked straight from the
--  Habits grid, and each due day ends up as one row in habit_log: done (a
--  check) or missed (an x). Nothing lands on the quest board any more.
--
--  Only today can be ticked. Once a due day is over without a tick it is
--  settled as missed — it does not linger as an overdue quest that can still
--  be done late.
--
--  XP — "1% better every day"
--  --------------------------
--  A completion pays round(1.01 ^ (streak - 1)), capped at 10, where streak
--  counts this completion. So day 1 pays +1, day 42 is the first +2, and the
--  cap of +10 is reached on day 228. A miss costs -1 and resets that habit's
--  streak, so the next completion is back to +1. Mirrored in habitReward() in
--  src/lib/habits.ts — change both.
--
--  XP moves through habit_move_xp, which applies the same floor and level
--  ratchet as quest_transition (migration 011): a rank once reached is kept.
--
--  SETTLING
--  --------
--  settle_habits walks each active habit from the day after `settled_through`
--  to yesterday and writes a miss for every due day with no tick. Idempotent
--  (a day with a log row is skipped, and settled_through only moves forward),
--  so it runs on every page load. A paused habit is not settled; resuming
--  moves settled_through up to yesterday so the paused days cost nothing.
--
--  EXISTING DATA
--  -------------
--  * Past habit quests become log rows (done -> check, missed -> x), with 0
--    XP recorded, since the XP they moved has already been paid or charged.
--  * Then every habit quest is deleted from the board. The XP they moved
--    stays where it is — the ledger rows remain, only their todo link is
--    nulled.
--  * settled_through starts at yesterday, so nothing already past is charged.
--  * Streaks are kept, except where the last logged day was a miss (then 0).
-- ===========================================================================

create table if not exists habit_log (
  habit_id   uuid not null references habits(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  /* The habit owner's local date. */
  day        date not null,
  done       boolean not null,
  /* What actually moved on the profile: +reward for a tick, -1 (or less, at
     the level floor) for a miss. Un-ticking gives this back. */
  xp         integer not null default 0,
  /* The streak this row left the habit on. 0 for a miss. */
  streak     integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);

create index if not exists habit_log_user_idx on habit_log(user_id, day desc);

alter table habits add column if not exists settled_through date;

-- ---------------------------------------------------------------------------
-- habit_reward(streak) — XP for the completion that makes the streak this long.
-- ---------------------------------------------------------------------------
create or replace function habit_reward(p_streak integer)
returns integer
language sql immutable as $$
  select least(10, greatest(1, round(power(1.01, greatest(p_streak, 1) - 1))::integer));
$$;

-- ---------------------------------------------------------------------------
-- habit_move_xp — add (or take) XP with the level floor and ratchet. Returns
-- what actually moved.
-- ---------------------------------------------------------------------------
create or replace function habit_move_xp(
  p_user   uuid,
  p_delta  integer,
  p_reason text
) returns integer
language plpgsql
as $$
declare
  v_before  integer;
  v_level   integer;
  v_applied integer;
  v_xp      integer;
begin
  if p_delta = 0 then return 0; end if;

  select xp, level into v_before, v_level from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  v_applied := greatest(xp_for_level(v_level), v_before + p_delta) - v_before;
  if v_applied = 0 then return 0; end if;

  update profiles set xp = v_before + v_applied where id = p_user
  returning xp into v_xp;

  if level_for_xp(v_xp) > v_level then
    update profiles set level = level_for_xp(v_xp) where id = p_user;
  end if;

  insert into xp_events (user_id, todo_id, delta, reason)
  values (p_user, null, v_applied, p_reason);

  return v_applied;
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_habits — write a miss for every due day that ended without a tick.
-- Returns the XP moved (zero or negative).
-- ---------------------------------------------------------------------------
create or replace function settle_habits(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_zone   text;
  v_today  date;
  v_to     date;
  v_day    date;
  v_logged integer;
  v_moved  integer;
  v_total  integer := 0;
  h        habits%rowtype;
begin
  select coalesce(timezone, 'UTC') into v_zone from profiles where id = p_user;
  if v_zone is null then return 0; end if;
  v_today := (now() at time zone v_zone)::date;

  for h in
    select * from habits
     where user_id = p_user and active
       and (settled_through is null or settled_through < v_today - 1)
     for update
  loop
    v_day := coalesce(h.settled_through + 1, (h.created_at at time zone v_zone)::date);
    v_to  := v_today - 1;
    if h.ends_on is not null and h.ends_on < v_to then v_to := h.ends_on; end if;

    select count(*)::integer into v_logged from habit_log where habit_id = h.id;

    while v_day <= v_to loop
      exit when h.occurrences_limit is not null and v_logged >= h.occurrences_limit;

      if is_habit_due(h.days, v_day)
         and not exists (select 1 from habit_log l where l.habit_id = h.id and l.day = v_day)
      then
        v_moved := habit_move_xp(p_user, -1, 'missed habit: ' || h.title);
        insert into habit_log (habit_id, user_id, day, done, xp, streak)
        values (h.id, p_user, v_day, false, v_moved, 0);
        h.streak := 0;
        v_logged := v_logged + 1;
        v_total  := v_total + v_moved;
      end if;

      v_day := v_day + 1;
    end loop;

    update habits set
      streak          = h.streak,
      settled_through = v_today - 1
    where id = h.id;
  end loop;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- toggle_habit — tick today, or un-tick it. Settles first so the streak the
-- reward is priced on is already honest about any miss.
-- ---------------------------------------------------------------------------
create or replace function toggle_habit(p_user uuid, p_habit uuid)
returns json
language plpgsql
as $$
declare
  v_zone   text;
  v_today  date;
  v_logged integer;
  v_streak integer;
  v_moved  integer;
  v_log    habit_log%rowtype;
  h        habits%rowtype;
begin
  perform settle_habits(p_user);

  select coalesce(timezone, 'UTC') into v_zone from profiles where id = p_user;
  v_today := (now() at time zone v_zone)::date;

  select * into h from habits where id = p_habit and user_id = p_user for update;
  if not found then raise exception 'Habit not found'; end if;

  select * into v_log from habit_log where habit_id = h.id and day = v_today;

  if found then
    -- Un-tick: give back exactly what the tick moved.
    v_moved := habit_move_xp(p_user, -v_log.xp, 'un-ticked habit: ' || h.title);
    delete from habit_log where habit_id = h.id and day = v_today;
    v_streak := greatest(0, h.streak - 1);
    update habits set
      streak       = v_streak,
      last_done_on = (select max(day) from habit_log where habit_id = h.id and done)
    where id = h.id;
    return json_build_object(
      'done', false, 'delta', v_moved, 'streak', v_streak,
      'xp', (select xp from profiles where id = p_user)
    );
  end if;

  if not h.active then raise exception 'That habit is paused.'; end if;
  if not is_habit_due(h.days, v_today) then raise exception 'That habit isn''t due today.'; end if;
  select count(*)::integer into v_logged from habit_log where habit_id = h.id;
  if habit_over(h.ends_on, h.occurrences_limit, v_logged, v_today) then
    raise exception 'That habit has finished.';
  end if;

  v_streak := h.streak + 1;
  v_moved  := habit_move_xp(p_user, habit_reward(v_streak), 'habit: ' || h.title);

  insert into habit_log (habit_id, user_id, day, done, xp, streak)
  values (h.id, p_user, v_today, true, v_moved, v_streak);

  update habits set
    streak       = v_streak,
    best_streak  = greatest(best_streak, v_streak),
    last_done_on = v_today
  where id = h.id;

  return json_build_object(
    'done', true, 'delta', v_moved, 'streak', v_streak,
    'xp', (select xp from profiles where id = p_user)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The old machinery, retired. Kept as no-ops rather than dropped so a
-- deployment still running the previous code can't put habit quests back on
-- the board.
-- ---------------------------------------------------------------------------
create or replace function materialise_habits(p_user uuid)
returns integer language sql as $$ select 0; $$;

create or replace function break_stale_streaks(p_user uuid)
returns void language plpgsql as $$ begin end; $$;

-- ---------------------------------------------------------------------------
-- Existing data (see the header).
-- ---------------------------------------------------------------------------
insert into habit_log (habit_id, user_id, day, done, xp, streak)
select distinct on (t.habit_id, (t.due_date at time zone coalesce(p.timezone, 'UTC'))::date)
       t.habit_id, t.user_id,
       (t.due_date at time zone coalesce(p.timezone, 'UTC'))::date,
       t.status = 'done', 0, 0
  from todos t
  join profiles p on p.id = t.user_id
 where t.habit_id is not null
   and t.due_date is not null
   and t.status in ('done', 'failed')
 order by t.habit_id, (t.due_date at time zone coalesce(p.timezone, 'UTC'))::date,
          (t.status = 'done') desc
on conflict (habit_id, day) do nothing;

delete from todos where habit_id is not null;

-- A streak whose last settled day was a miss is already broken; the old
-- break_stale_streaks may not have run since, so make it say so.
update habits h
   set streak = 0
 where h.streak > 0
   and (select not l.done from habit_log l
         where l.habit_id = h.id order by l.day desc limit 1);

update habits h
   set settled_through = (now() at time zone coalesce(p.timezone, 'UTC'))::date - 1
  from profiles p
 where p.id = h.user_id
   and h.settled_through is null;
