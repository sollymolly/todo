-- ===========================================================================
--  Migration 018 — abandoning a quest removes it, and a miss outlives the row
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  WHAT CHANGES
--  ------------
--  Abandoning and deleting were two names for "get this off my board", which
--  left neither doing its job properly. They are now genuinely different acts:
--
--    Abandon  — you promised this and you are calling it off. Costs -5 XP, the
--               deadline is recorded as missed, and the quest is gone.
--    Delete   — this quest should never have existed (wrong title, wrong day,
--               typed twice). Costs nothing, counts as nothing, and any XP it
--               had already moved is put back.
--
--  Abandoning used to charge the full -10 missed-deadline penalty and leave a
--  failed row sitting on the board for ever. -5 is the price of saying so out
--  loud and early, which should be cheaper than letting the deadline go by in
--  silence (still -10, unchanged).
--
--  WHY archived_missed
--  -------------------
--  The Strengths panel counted misses by counting failed rows, so deleting one
--  erased the miss along with the quest — and a category with nothing but
--  broken promises read as "no deadlines resolved yet" rather than 0%. Now that
--  abandoning deletes the row, the count has to survive it, exactly as the
--  on-time / late counters already survive retention (migrations 009, 012).
--
--  WHY habit_skips
--  ---------------
--  materialise_habits puts back any missing instance for today, so deleting
--  today's habit quest would have it reappear on the next page load, reading as
--  though the removal had failed. A skip row records "not this day" for that
--  habit; tomorrow is unaffected, and so is the streak logic, which measures
--  completions rather than the presence of a row.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Deadlines that were missed and then removed. The counter is the only record
-- left of them, so it is never decremented — see delete_quest for the one act
-- that is allowed to leave no trace at all.
-- ---------------------------------------------------------------------------
alter table categories add column if not exists archived_missed integer not null default 0;
alter table profiles   add column if not exists archived_missed integer not null default 0;

-- ---------------------------------------------------------------------------
-- A habit day that was deliberately cleared. Keyed by the habit's *local* day,
-- the same key materialise_habits uses to decide whether today already has an
-- instance, so the two can't disagree.
-- ---------------------------------------------------------------------------
create table if not exists habit_skips (
  habit_id  uuid not null references habits(id) on delete cascade,
  day       date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);

-- ---------------------------------------------------------------------------
-- The price of calling a quest off yourself. Mirrored as XP.abandon in
-- src/lib/game.ts — change both.
-- ---------------------------------------------------------------------------
create or replace function quest_abandon_penalty()
returns integer language sql immutable as $$ select -5; $$;

-- ---------------------------------------------------------------------------
-- Clear today's slot for a habit instance that is being removed by hand, so
-- materialisation doesn't put it straight back. A no-op for ordinary quests.
--
-- The day is read off the quest's own deadline rather than from now(): an
-- instance is removed *for the day it belongs to*, which is not necessarily the
-- day you got round to removing it.
-- ---------------------------------------------------------------------------
create or replace function skip_habit_day(p_user uuid, p_todo todos)
returns void
language plpgsql
as $$
declare
  v_zone text;
  v_day  date;
begin
  if p_todo.habit_id is null then return; end if;

  select coalesce(timezone, 'UTC') into v_zone from profiles where id = p_user;
  v_zone := coalesce(v_zone, 'UTC');

  v_day := (coalesce(p_todo.due_date, now()) at time zone v_zone)::date;

  insert into habit_skips (habit_id, day) values (p_todo.habit_id, v_day)
  on conflict (habit_id, day) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- abandon_quest — give up on a deadline by hand: charge the penalty, record
-- the miss, and remove the quest.
--
-- The charge reconciles rather than simply subtracting: whatever this quest had
-- already moved is reversed first, so giving up costs the penalty and nothing
-- else, however the quest got to where it is. Same floor as every other
-- transition — XP stops at the bottom of the rank already earned (migration
-- 011) — and the ledger records what actually moved.
--
-- The xp_events row is written before the delete, so the ledger keeps the
-- entry; its todo_id is set null by the foreign key on the way out, which is
-- why the title goes into the reason. It is the only trace left of the quest.
-- ---------------------------------------------------------------------------
create or replace function abandon_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo    todos%rowtype;
  v_before  integer;
  v_level   integer;
  v_floor   integer;
  v_delta   integer;
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'open' then raise exception 'Quest is not open'; end if;

  select xp, level into v_before, v_level from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  v_floor   := xp_for_level(v_level);
  v_delta   := quest_abandon_penalty() - v_todo.xp_awarded;
  v_applied := greatest(v_floor, v_before + v_delta) - v_before;

  update profiles set xp = v_before + v_applied
   where id = p_user
  returning xp into v_xp;

  if v_applied <> 0 then
    insert into xp_events (user_id, todo_id, delta, reason)
    values (p_user, p_todo, v_applied,
            'abandoned "' || left(v_todo.title, 60) || '"');
  end if;

  -- A quest with no deadline promised nothing, so it is left out of both sides
  -- of the Strengths figure rather than counted as a miss. The XP still goes:
  -- you did say you would do it.
  if v_todo.due_date is not null then
    update categories set archived_missed = archived_missed + 1
     where id = v_todo.category_id and user_id = p_user;
    update profiles set archived_missed = archived_missed + 1
     where id = p_user;
  end if;

  perform skip_habit_day(p_user, v_todo);

  delete from todos where id = p_todo and user_id = p_user;

  return json_build_object(
    'delta', v_applied, 'awarded', 0, 'xp', v_xp, 'reason', 'oath broken'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_quest — remove a quest as though it had never been written down.
--
-- Nothing is counted, and the XP it moved is put back: a quest deleted because
-- it was a mistake should leave the character exactly where it would have been
-- had it never existed. That cuts both ways — deleting a finished quest hands
-- back the award — which is what makes "delete" the wrong tool for tidying up
-- and "abandon" the right one for giving up.
--
-- The floor still applies, and the refund is reconciling, so deleting a quest
-- whose penalty was only partly charged returns only the part that was taken.
-- ---------------------------------------------------------------------------
create or replace function delete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo    todos%rowtype;
  v_before  integer;
  v_level   integer;
  v_floor   integer;
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  -- Deleting something that is already gone is a success, not an error: the
  -- board can be a click behind the database.
  if not found then
    select xp into v_xp from profiles where id = p_user;
    return json_build_object('delta', 0, 'awarded', 0, 'xp', coalesce(v_xp, 0),
                             'reason', 'quest deleted');
  end if;

  select xp, level into v_before, v_level from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  v_floor   := xp_for_level(v_level);
  v_applied := greatest(v_floor, v_before - v_todo.xp_awarded) - v_before;

  update profiles set xp = v_before + v_applied
   where id = p_user
  returning xp into v_xp;

  if v_applied <> 0 then
    insert into xp_events (user_id, todo_id, delta, reason)
    values (p_user, p_todo, v_applied,
            'deleted "' || left(v_todo.title, 60) || '"');
  end if;

  perform skip_habit_day(p_user, v_todo);

  delete from todos where id = p_todo and user_id = p_user;

  return json_build_object(
    'delta', v_applied, 'awarded', 0, 'xp', v_xp, 'reason', 'quest deleted'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- materialise_habits — as migration 014, plus the skip check. Everything else
-- is unchanged; the guard sits next to the "already have today's" one because
-- it answers the same question: is this day already settled?
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

    -- Today's was abandoned or deleted by hand. Leave the day alone.
    if exists (
      select 1 from habit_skips s where s.habit_id = h.id and s.day = v_today
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

-- ===========================================================================
--  Backfilling misses that were already lost
--  -----------------------------------------
--  Quests abandoned before this migration were charged and then deleted by
--  hand, and nothing about them survives except an xp_events row with a null
--  todo_id — so the category they belonged to is not recoverable from the data.
--  There is no honest automatic backfill. If you know where they were, add them
--  by hand; the counters are plain integers.
--
--    update categories set archived_missed = archived_missed + 2
--     where user_id = '<your user id>'::uuid and name = 'Music';
--    update profiles set archived_missed = archived_missed + 2
--     where id = '<your user id>'::uuid;
--
--  The per-category and profile counters are read independently (Strengths vs
--  the character card's on-time figure), so bump both by the same number.
-- ===========================================================================
