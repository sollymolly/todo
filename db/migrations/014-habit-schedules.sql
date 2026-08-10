-- ===========================================================================
--  Migration 014 — arbitrary weekdays, and an end to the repeating
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  WHAT CHANGES
--  ------------
--  Scheduling moves from (cadence, weekday) to a single `days integer[]` of ISO
--  weekdays. One source of truth instead of two co-operating columns, and
--  "Mon/Wed/Fri" stops being a special case — it is just {1,3,5}. Every old
--  cadence is expressible:
--
--      daily     -> {1,2,3,4,5,6,7}
--      weekdays  -> {1,2,3,4,5}
--      weekly n  -> {n}
--      custom    -> whatever was picked
--
--  `cadence` and `weekday` are left in place but are no longer consulted by
--  anything — the same treatment `todos.position` got. The app derives its
--  label from `days` ("Every day", "Weekdays", "Every Tue", "Mon, Wed, Fri").
--
--  A habit can also now stop: on a date, or after a number of occurrences.
-- ===========================================================================

-- Added nullable and backfilled, then made not-null. That ordering is what
-- makes the migration re-runnable: on a second pass no row is null, so the
-- backfill matches nothing and cannot clobber days someone has since chosen.
alter table habits add column if not exists days integer[];

update habits
   set days = case cadence
                when 'daily'    then '{1,2,3,4,5,6,7}'::integer[]
                when 'weekdays' then '{1,2,3,4,5}'::integer[]
                when 'weekly'   then array[weekday]
                else '{1,2,3,4,5,6,7}'::integer[]
              end
 where days is null;

alter table habits alter column days set default '{1,2,3,4,5,6,7}'::integer[];
alter table habits alter column days set not null;

-- At least one day, and only real ISO weekdays. A habit due on no days would
-- sit in the list forever producing nothing.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'habits_days_valid') then
    -- cardinality(), not array_length(): array_length('{}', 1) is NULL, and a
    -- CHECK only rejects FALSE — so the obvious spelling lets an empty day set
    -- straight through. cardinality('{}') is 0.
    alter table habits add constraint habits_days_valid check (
      cardinality(days) between 1 and 7
      and days <@ '{1,2,3,4,5,6,7}'::integer[]
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Stopping conditions. Both optional and independent: whichever is reached
-- first ends the habit.
--
--   ends_on           last local date an occurrence may be created
--   occurrences_limit how many occurrences in total
--   occurrences_made  how many have been created so far
--
-- Counting occurrences *created* rather than completed is deliberate: "repeat
-- 10 times" should end after ten appearances, whether or not each was done.
-- Counting completions would keep a neglected habit alive indefinitely.
-- ---------------------------------------------------------------------------
alter table habits add column if not exists ends_on           date;
alter table habits add column if not exists occurrences_limit integer;
alter table habits add column if not exists occurrences_made  integer not null default 0;

-- Existing habits have already produced instances; count them so a limit added
-- later doesn't start from zero and over-run.
update habits h
   set occurrences_made = (
     select count(*)::integer from todos t where t.habit_id = h.id
   )
 where h.occurrences_made = 0;

-- ---------------------------------------------------------------------------
-- is_habit_due(days, day)
-- ---------------------------------------------------------------------------
create or replace function is_habit_due(p_days integer[], p_day date)
returns boolean
language sql immutable as $$
  select extract(isodow from p_day)::integer = any(p_days);
$$;

-- ---------------------------------------------------------------------------
-- habit_over(habit, today) — has this habit reached its end?
-- ---------------------------------------------------------------------------
create or replace function habit_over(
  p_ends_on date,
  p_limit    integer,
  p_made     integer,
  p_today    date
) returns boolean
language sql immutable as $$
  select (p_ends_on is not null and p_today > p_ends_on)
      or (p_limit   is not null and p_made >= p_limit);
$$;

-- ---------------------------------------------------------------------------
-- materialise_habits — now respects the schedule and the stopping conditions,
-- and counts each occurrence it creates.
-- ---------------------------------------------------------------------------
create or replace function materialise_habits(p_user uuid)
returns integer
language plpgsql
as $$
declare
  v_zone  text;
  v_today date;
  v_made  integer := 0;
  h       habits%rowtype;
  v_due   timestamptz;
begin
  select coalesce(timezone, 'UTC') into v_zone from profiles where id = p_user;
  if v_zone is null then return 0; end if;

  v_today := (now() at time zone v_zone)::date;

  for h in select * from habits where user_id = p_user and active loop
    if not is_habit_due(h.days, v_today) then
      continue;
    end if;

    if habit_over(h.ends_on, h.occurrences_limit, h.occurrences_made, v_today) then
      continue;
    end if;

    -- Already have today's? Nothing to do, however that instance has since
    -- been completed, un-completed or missed.
    if exists (
      select 1 from todos t
       where t.habit_id = h.id
         and (t.due_date at time zone v_zone)::date = v_today
    ) then
      continue;
    end if;

    v_due := (v_today + make_interval(mins => h.due_minutes)) at time zone v_zone;

    insert into todos (user_id, title, notes, due_date, category_id, habit_id)
    values (p_user, h.title, h.notes, v_due, h.category_id, h.id);

    -- Counted here, next to the insert, so the two can never disagree.
    update habits set occurrences_made = occurrences_made + 1 where id = h.id;

    v_made := v_made + 1;
  end loop;

  return v_made;
end;
$$;

-- ---------------------------------------------------------------------------
-- The streak helpers, on the new signature.
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

  select * into h from habits where id = p_habit and user_id = p_user for update;
  if not found then return 0; end if;

  v_today := (now() at time zone v_zone)::date;
  if h.last_done_on = v_today then
    return h.streak; -- already counted today
  end if;

  -- Back to the previous day this habit was actually due, so a gap the schedule
  -- never asked for cannot break the run.
  v_prev := v_today - 1;
  while v_prev > v_today - 8 and not is_habit_due(h.days, v_prev) loop
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

  select * into h from habits where id = p_habit and user_id = p_user for update;
  if not found then return 0; end if;

  v_today := (now() at time zone v_zone)::date;
  if h.last_done_on is distinct from v_today then
    return h.streak;
  end if;

  v_prev := v_today - 1;
  while v_prev > v_today - 8 and not is_habit_due(h.days, v_prev) loop
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
    while v_prev > v_today - 8 and not is_habit_due(h.days, v_prev) loop
      v_prev := v_prev - 1;
    end loop;

    if h.last_done_on is null or h.last_done_on < v_prev then
      update habits set streak = 0 where id = h.id;
    end if;
  end loop;
end;
$$;

-- The three-argument version is now unreferenced; dropping it keeps the two
-- from being confused at a call site.
drop function if exists is_habit_due(text, integer, date);
