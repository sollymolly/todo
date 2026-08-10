-- ===========================================================================
--  Questline — schema (plain PostgreSQL, tested on Neon)
--  Run once in the Neon SQL Editor, or: psql "$DATABASE_URL" -f db/schema.sql
--  Safe to re-run: everything is idempotent.
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- users: credentials only. Passwords are scrypt hashes written by the app.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles: XP and the character's look, one row per user.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key references users(id) on delete cascade,
  display_name  text not null default 'Adventurer',
  xp            integer not null default 0,
  appearance    jsonb not null default '{
                   "body": "male",
                   "skin": "fair",
                   "hair": "tousled",
                   "hairColor": "chestnut",
                   "eyes": "blue"
                 }'::jsonb,
  -- Gear ids, plus the chosen dye per dyeable slot. An absent or unrecognised
  -- dye falls back to the item's own default, so `dyes` may be empty and rows
  -- written before dyes existed need no backfill. See migration 016.
  equipped      jsonb not null default '{
                   "torso": "rags",
                   "weapon": "stick",
                   "head": "none",
                   "cape": "none",
                   "offhand": "none",
                   "dyes": {}
                 }'::jsonb,
  -- Week key (Monday, YYYY-MM-DD, UTC) of the last changelog entry shown.
  -- Text, not date: a date column comes back through the session timezone and
  -- makes week comparisons lie. See migration 008.
  updates_seen  text,
  -- Completed quests are deleted after a week, so their contribution to the
  -- metrics is folded in here on the way out. Every total the app shows is
  -- "archived counter + live count". See migration 009.
  archived_done     integer not null default 0,
  archived_on_time  integer not null default 0,
  archived_late     integer not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories: user-defined buckets (Work, Fitness, Music, ...)
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  -- Legacy. Categories are identified by name and colour; nothing reads this.
  icon        text not null default '',
  color       text not null default 'amber',
  sort_order  integer not null default 0,
  -- Pruned finished quests, split by outcome, for the Strengths figure. Kept
  -- as counters because completed quests are deleted after a week.
  archived_done     integer not null default 0,
  archived_on_time  integer not null default 0,
  archived_late     integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists categories_user_idx on categories(user_id, sort_order);

-- ---------------------------------------------------------------------------
-- todos ("quests").  status: open | done | failed
-- ---------------------------------------------------------------------------
create table if not exists todos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  category_id   uuid references categories(id) on delete set null,
  title         text not null,
  notes         text,
  due_date      timestamptz,
  status        text not null default 'open' check (status in ('open','done','failed')),
  completed_at  timestamptz,
  xp_awarded    integer not null default 0,
  -- Legacy. Quests are ordered by due_date now, so nothing reads this.
  position      double precision,
  created_at    timestamptz not null default now()
);
create index if not exists todos_user_idx on todos(user_id, status, due_date);
create index if not exists todos_position_idx on todos(user_id, position);

-- ---------------------------------------------------------------------------
-- feedback
--
-- `user_id` is nullable, and that nullability *is* the anonymity. When someone
-- ticks "send anonymously" no identifier is written at all — there is no
-- `anonymous` flag sitting next to a user id that the reader could simply
-- ignore. If the column is null, the link genuinely does not exist and cannot
-- be recovered.
--
-- `created_at` is rounded to the hour for anonymous submissions. Full-precision
-- timestamps are a correlation handle: whoever reads the inbox can also see who
-- was active, and a to-the-second stamp on a short user list often identifies
-- the author. The hour is plenty to know when something was said.
--
-- Named feedback keeps `on delete set null`, so deleting an account leaves the
-- feedback but drops the attribution rather than destroying the message.
-- ---------------------------------------------------------------------------
create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_created_idx on feedback(created_at desc);

-- ---------------------------------------------------------------------------
-- policy_acceptances: append-only record of agreement to the privacy policy.
-- Answers "who agreed, to which version, when"; the text of each version is
-- in git. Deliberately does not record IP or user agent — see migration 006.
-- ---------------------------------------------------------------------------
create table if not exists policy_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  version      integer not null,
  accepted_at  timestamptz not null default now()
);
create index if not exists policy_acceptances_user_idx
  on policy_acceptances(user_id, accepted_at desc);
create unique index if not exists policy_acceptances_once
  on policy_acceptances(user_id, version);

-- ---------------------------------------------------------------------------
-- rate_limits: fixed-window counters guarding the expensive auth paths.
-- Verifying a password costs ~16 MB and ~100 ms of scrypt, so an unbounded
-- sign-in endpoint is both a password oracle and a memory-exhaustion lever.
-- ---------------------------------------------------------------------------
create table if not exists rate_limits (
  bucket        text primary key,
  window_start  timestamptz not null default now(),
  hits          integer not null default 0
);
create index if not exists rate_limits_window_idx on rate_limits(window_start);

-- ---------------------------------------------------------------------------
-- xp_events: append-only ledger so the character's history is auditable
-- ---------------------------------------------------------------------------
create table if not exists xp_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  todo_id     uuid references todos(id) on delete set null,
  delta       integer not null,
  reason      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists xp_events_user_idx on xp_events(user_id, created_at desc);

-- ===========================================================================
-- Bootstrap: give a brand-new user a profile and starter categories.
-- Called by the app immediately after inserting the user row.
-- ===========================================================================
create or replace function bootstrap_user(p_user uuid, p_name text)
returns void
language plpgsql
as $$
begin
  insert into profiles (id, display_name, updates_seen)
  values (
    p_user,
    coalesce(nullif(trim(p_name), ''), 'Adventurer'),
    to_char(date_trunc('week', (now() at time zone 'utc')), 'YYYY-MM-DD')
  )
  on conflict (id) do nothing;

  insert into categories (user_id, name, color, sort_order)
  select p_user, v.name, v.color, v.ord
    from (values
      ('Work',     'amber',   0),
      ('Fitness',  'rose',    1),
      ('Music',    'violet',  2),
      ('Personal', 'emerald', 3)
    ) as v(name, color, ord)
   where not exists (select 1 from categories where user_id = p_user);
end;
$$;

-- ===========================================================================
-- XP economy. All arithmetic lives here so a compromised client cannot
-- inflate its own score, and every mutation is one atomic statement.
--
-- Every function takes p_user explicitly and filters on it, so a quest id
-- belonging to someone else simply will not match.
-- ===========================================================================

-- Awards for finishing a quest.
--   no due date       → +5   (minimal, per the honour system)
--   due date, on time → +25  (early counts the same as on time)
--   due date, late    → +8   (partial credit for finishing at all)
create or replace function quest_xp(p_due timestamptz, p_done timestamptz)
returns integer language sql immutable as $$
  select case
    when p_due is null    then 5
    when p_done <= p_due  then 25
    else                       8
  end;
$$;

-- Penalty for a quest that was promised with a deadline and not delivered.
create or replace function quest_penalty()
returns integer language sql immutable as $$ select -15; $$;

-- ---------------------------------------------------------------------------
-- What a quest should be contributing, given its current state.
-- ---------------------------------------------------------------------------
create or replace function quest_target_xp(
  p_status    text,
  p_due       timestamptz,
  p_completed timestamptz
) returns integer
language sql immutable as $$
  select case
    when p_status = 'done'   then quest_xp(p_due, coalesce(p_completed, p_due))
    when p_status = 'failed' then case when p_due is null then 0 else quest_penalty() end
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- What a quest's ledger says it has actually moved. Used only by the backfill;
-- from here on todos.xp_awarded carries the same number.
-- ---------------------------------------------------------------------------
create or replace function quest_applied_xp(p_todo uuid)
returns integer
language sql stable as $$
  select coalesce(sum(delta), 0)::integer from xp_events where todo_id = p_todo;
$$;

-- ===========================================================================
-- The single place a quest changes state. Every action below funnels through
-- it, which is what makes the accounting impossible to double up.
-- ===========================================================================
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
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  if not found then raise exception 'Quest not found'; end if;

  v_target := quest_target_xp(p_status, v_todo.due_date, p_completed);
  v_delta  := v_target - v_todo.xp_awarded;

  select xp into v_before from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  -- XP is floored at zero, so a penalty bigger than the balance is only partly
  -- charged. Recording what actually *moved* rather than what was intended is
  -- what keeps this reconcilable: the next transition sees the true figure and
  -- corrects from there, instead of refunding XP that was never taken.
  v_applied := greatest(0, v_before + v_delta) - v_before;

  update todos set
    status       = p_status,
    completed_at = p_completed,
    xp_awarded   = v_todo.xp_awarded + v_applied
  where id = p_todo;

  update profiles set xp = v_before + v_applied
   where id = p_user
  returning xp into v_xp;

  -- A no-op transition leaves no trace, so the ledger stays readable.
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

-- ---------------------------------------------------------------------------
-- complete_quest — works from 'open' *or* 'failed'. Completing a missed quest
-- refunds the penalty and pays the late award in one move; redemption is
-- always available and is worth exactly the same as any other late finish.
-- ---------------------------------------------------------------------------
create or replace function complete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo   todos%rowtype;
  v_now    timestamptz := now();
  v_reason text;
begin
  select * into v_todo from todos where id = p_todo and user_id = p_user;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status = 'done' then raise exception 'Quest already completed'; end if;

  v_reason := case
    when v_todo.due_date is null  then 'completed (no deadline)'
    when v_now <= v_todo.due_date then 'completed on time'
    else                               'completed late'
  end;

  return quest_transition(p_user, p_todo, 'done', v_now, v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- uncomplete_quest — puts the quest back exactly where it would have been had
-- it never been completed: missed if the deadline is already past the grace
-- period, open otherwise.
--
-- Going straight to 'failed' matters. Returning it to 'open' with a long-past
-- deadline is what caused the double charge: the refund landed immediately and
-- the penalty came back on the next page load, reading as XP vanishing twice.
-- ---------------------------------------------------------------------------
create or replace function uncomplete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo   todos%rowtype;
  v_status text;
begin
  select * into v_todo from todos where id = p_todo and user_id = p_user;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'done' then raise exception 'Quest is not completed'; end if;

  v_status := case
    when v_todo.due_date is not null
     and v_todo.due_date < now() - interval '24 hours' then 'failed'
    else 'open'
  end;

  return quest_transition(p_user, p_todo, v_status, null, 'undid a completion');
end;
$$;

-- ---------------------------------------------------------------------------
-- abandon_quest — give up on a deadline by hand.
-- ---------------------------------------------------------------------------
create or replace function abandon_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo todos%rowtype;
begin
  select * into v_todo from todos where id = p_todo and user_id = p_user;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'open' then raise exception 'Quest is not open'; end if;

  return quest_transition(p_user, p_todo, 'failed', null, 'abandoned the quest');
end;
$$;

-- ---------------------------------------------------------------------------
-- sweep_overdue — auto-fail anything more than 24h past its deadline.
--
-- Only picks status = 'open', so an already-missed quest is never re-swept.
-- Even if it were, the transition would move zero XP.
-- ---------------------------------------------------------------------------
create or replace function sweep_overdue(p_user uuid)
returns json
language plpgsql
as $$
declare
  v_ids   uuid[];
  v_id    uuid;
  v_res   json;
  v_count integer := 0;
  v_total integer := 0;
  v_xp    integer;
begin
  select array_agg(id) into v_ids
    from todos
   where user_id  = p_user
     and status   = 'open'
     and due_date is not null
     and due_date < now() - interval '24 hours';

  if v_ids is null then
    select xp into v_xp from profiles where id = p_user;
    return json_build_object('count', 0, 'delta', 0, 'xp', coalesce(v_xp, 0));
  end if;

  foreach v_id in array v_ids loop
    v_res   := quest_transition(p_user, v_id, 'failed', null, 'deadline passed');
    v_count := v_count + 1;
    v_total := v_total + (v_res ->> 'delta')::integer;
  end loop;

  select xp into v_xp from profiles where id = p_user;
  return json_build_object('count', v_count, 'delta', v_total, 'xp', coalesce(v_xp, 0));
end;
$$;

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

-- ===========================================================================
-- Recurring habits (see migration 013 for the reasoning)
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
