-- ===========================================================================
--  Migration 013 — recurring habits
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  THE MODEL
--  ---------
--  A habit is a *definition*, not a quest. Each day it is due, one ordinary
--  todo is materialised from it, and that todo behaves like any other: it earns
--  XP, it can be missed, it sorts by deadline, it gets pruned when finished.
--
--  Materialising on read rather than spawning on completion is the important
--  choice. "Create tomorrow's copy when today's is ticked" breaks the moment
--  someone un-ticks it — you either double up or lose the next occurrence.
--  Reconciling instead ("does today have one? if not, make it") is idempotent,
--  so it can run on every page load and survives any amount of toggling. It is
--  the same shape as sweep_overdue and prune_finished.
--
--  TIMEZONE
--  --------
--  "The next day" only means something in a place. `profiles.timezone` holds an
--  IANA name and everything below reads it through
--  `coalesce(p.timezone, 'UTC')`, so the feature works with the column empty
--  and degrades to UTC. To remove timezone support entirely: drop the column
--  and delete src/lib/timezone.ts — the coalesce keeps every query valid.
-- ===========================================================================

alter table profiles add column if not exists timezone text;

create table if not exists habits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  title        text not null,
  notes        text,
  category_id  uuid references categories(id) on delete set null,
  cadence      text not null default 'daily'
                 check (cadence in ('daily', 'weekdays', 'weekly')),
  /* For 'weekly': ISO day of week, 1 = Monday. Ignored otherwise. */
  weekday      integer not null default 1 check (weekday between 1 and 7),
  /* Local time the day's instance is due, minutes past midnight. */
  due_minutes  integer not null default 1439 check (due_minutes between 0 and 1439),
  streak       integer not null default 0,
  best_streak  integer not null default 0,
  /* Local date of the last completion — what the streak is measured against. */
  last_done_on date,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists habits_user_idx on habits(user_id, active);

-- A quest that came from a habit. `on delete cascade` so deleting a habit takes
-- its outstanding instances with it; finished ones are already history.
alter table todos add column if not exists habit_id uuid
  references habits(id) on delete cascade;

create index if not exists todos_habit_idx on todos(habit_id, due_date desc);

-- ---------------------------------------------------------------------------
-- is_habit_due(cadence, weekday, day) — whether a habit runs on a given date.
-- ---------------------------------------------------------------------------
create or replace function is_habit_due(
  p_cadence text,
  p_weekday integer,
  p_day     date
) returns boolean
language sql immutable as $$
  select case p_cadence
    when 'daily'    then true
    when 'weekdays' then extract(isodow from p_day) between 1 and 5
    when 'weekly'   then extract(isodow from p_day) = p_weekday
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- materialise_habits — make sure every active, due habit has today's instance.
-- Returns how many were created. Safe to call on every page load.
--
-- The guard is "does an instance already exist for this habit on this local
-- day", which is what makes it idempotent: completing, un-completing and
-- missing all leave that instance in place, so nothing is ever duplicated.
-- ---------------------------------------------------------------------------
create or replace function materialise_habits(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_zone    text;
  v_today   date;
  v_made    integer := 0;
  h         habits%rowtype;
  v_due     timestamptz;
begin
  select coalesce(timezone, 'UTC') into v_zone from profiles where id = p_user;
  if v_zone is null then return 0; end if;

  v_today := (now() at time zone v_zone)::date;

  for h in
    select * from habits
     where user_id = p_user and active
  loop
    if not is_habit_due(h.cadence, h.weekday, v_today) then
      continue;
    end if;

    -- Already have today's? Then there is nothing to do, however that instance
    -- has since been completed, un-completed or missed.
    if exists (
      select 1 from todos t
       where t.habit_id = h.id
         and (t.due_date at time zone v_zone)::date = v_today
    ) then
      continue;
    end if;

    -- Local wall-clock time, converted back to an instant.
    v_due := (v_today + make_interval(mins => h.due_minutes)) at time zone v_zone;

    insert into todos (user_id, title, notes, due_date, category_id, habit_id)
    values (p_user, h.title, h.notes, v_due, h.category_id, h.id);

    v_made := v_made + 1;
  end loop;

  return v_made;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_habit_completion — advance the streak.
--
-- Idempotent for the same day: ticking, un-ticking and re-ticking today's
-- instance counts once, because the streak only moves when last_done_on
-- actually changes. A gap of more than one due day restarts at 1.
-- ---------------------------------------------------------------------------
create or replace function record_habit_completion(p_user uuid, p_habit uuid)
returns integer
language plpgsql
as $$
declare
  v_zone  text;
  v_today date;
  h       habits%rowtype;
  v_prev  date;
  v_next  integer;
begin
  select coalesce(p.timezone, 'UTC') into v_zone from profiles p where p.id = p_user;

  select * into h from habits
   where id = p_habit and user_id = p_user
   for update;
  if not found then return 0; end if;

  v_today := (now() at time zone v_zone)::date;
  if h.last_done_on = v_today then
    return h.streak; -- already counted today
  end if;

  -- Walk back to the previous day this habit was actually due. Missing a
  -- Saturday shouldn't break a weekdays-only streak.
  v_prev := v_today - 1;
  while v_prev > v_today - 8 and not is_habit_due(h.cadence, h.weekday, v_prev) loop
    v_prev := v_prev - 1;
  end loop;

  v_next := case when h.last_done_on = v_prev then h.streak + 1 else 1 end;

  update habits set
    streak       = v_next,
    best_streak  = greatest(best_streak, v_next),
    last_done_on = v_today
  where id = p_habit;

  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- break_stale_streaks — zero the streak of any habit that has gone past a due
-- day without being completed. Called alongside materialisation.
-- ---------------------------------------------------------------------------
create or replace function break_stale_streaks(p_user uuid)
returns void
language plpgsql
as $$
declare
  v_zone  text;
  v_today date;
  h       habits%rowtype;
  v_prev  date;
begin
  select coalesce(p.timezone, 'UTC') into v_zone from profiles p where p.id = p_user;
  v_today := (now() at time zone v_zone)::date;

  for h in select * from habits where user_id = p_user and active and streak > 0
  loop
    v_prev := v_today - 1;
    while v_prev > v_today - 8 and not is_habit_due(h.cadence, h.weekday, v_prev) loop
      v_prev := v_prev - 1;
    end loop;

    -- Never completed, or last completed before the previous due day: broken.
    if h.last_done_on is null or h.last_done_on < v_prev then
      update habits set streak = 0 where id = h.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_habit_uncompletion — undo today's tick.
--
-- Without this a streak could be banked and then kept by un-ticking, which
-- would make the number a claim rather than a record. Walking last_done_on back
-- to the previous due day is what lets tomorrow's check behave correctly.
-- ---------------------------------------------------------------------------
create or replace function record_habit_uncompletion(p_user uuid, p_habit uuid)
returns integer
language plpgsql
as $$
declare
  v_zone  text;
  v_today date;
  h       habits%rowtype;
  v_prev  date;
  v_next  integer;
begin
  select coalesce(p.timezone, 'UTC') into v_zone from profiles p where p.id = p_user;

  select * into h from habits
   where id = p_habit and user_id = p_user
   for update;
  if not found then return 0; end if;

  v_today := (now() at time zone v_zone)::date;
  if h.last_done_on is distinct from v_today then
    return h.streak; -- today was never counted, so nothing to undo
  end if;

  v_prev := v_today - 1;
  while v_prev > v_today - 8 and not is_habit_due(h.cadence, h.weekday, v_prev) loop
    v_prev := v_prev - 1;
  end loop;

  v_next := greatest(0, h.streak - 1);

  update habits set
    streak       = v_next,
    last_done_on = case when v_next > 0 then v_prev else null end
  where id = p_habit;

  return v_next;
end;
$$;
