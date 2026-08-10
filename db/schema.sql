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
  equipped      jsonb not null default '{
                   "torso": "rags",
                   "weapon": "stick",
                   "head": "none",
                   "cape": "none",
                   "offhand": "none"
                 }'::jsonb,
  -- Week key (Monday, YYYY-MM-DD, UTC) of the last changelog entry shown.
  -- Text, not date: a date column comes back through the session timezone and
  -- makes week comparisons lie. See migration 008.
  updates_seen  text,
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
