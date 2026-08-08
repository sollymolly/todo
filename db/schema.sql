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
                   "skin": "fair",
                   "hair": "tousled",
                   "hairColor": "chestnut",
                   "eyes": "bright"
                 }'::jsonb,
  equipped      jsonb not null default '{
                   "torso": "rags",
                   "weapon": "stick",
                   "head": "none",
                   "cape": "none",
                   "offhand": "none"
                 }'::jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories: user-defined buckets (Work, Fitness, Music, ...)
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  icon        text not null default '📜',
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
  -- Manual drag order within a category. Sparse (steps of ~1024) so a quest
  -- can be dropped between two others without renumbering the whole list.
  position      double precision,
  created_at    timestamptz not null default now()
);
create index if not exists todos_user_idx on todos(user_id, status, due_date);
create index if not exists todos_position_idx on todos(user_id, position);

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
  insert into profiles (id, display_name)
  values (p_user, coalesce(nullif(trim(p_name), ''), 'Adventurer'))
  on conflict (id) do nothing;

  insert into categories (user_id, name, icon, color, sort_order)
  select p_user, v.name, v.icon, v.color, v.ord
    from (values
      ('Work',     '⚒️', 'amber',   0),
      ('Fitness',  '💪', 'rose',    1),
      ('Music',    '🎻', 'violet',  2),
      ('Personal', '🏡', 'emerald', 3)
    ) as v(name, icon, color, ord)
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
-- complete_quest → { delta, xp, reason }
-- ---------------------------------------------------------------------------
create or replace function complete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo   todos%rowtype;
  v_now    timestamptz := now();
  v_delta  integer;
  v_xp     integer;
  v_reason text;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;

  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status = 'done' then raise exception 'Quest already completed'; end if;

  v_delta := quest_xp(v_todo.due_date, v_now);

  -- Redeeming a failed quest: refund the penalty taken, then award normally.
  if v_todo.status = 'failed' then
    v_delta := v_delta - v_todo.xp_awarded;   -- xp_awarded is negative here
  end if;

  v_reason := case
    when v_todo.due_date is null  then 'completed (no deadline)'
    when v_now <= v_todo.due_date then 'completed on time'
    else                               'completed late'
  end;

  update todos
     set status = 'done', completed_at = v_now, xp_awarded = v_delta
   where id = p_todo;

  update profiles
     set xp = greatest(0, xp + v_delta)
   where id = p_user
  returning xp into v_xp;

  insert into xp_events (user_id, todo_id, delta, reason)
  values (p_user, p_todo, v_delta, v_reason);

  return json_build_object('delta', v_delta, 'xp', v_xp, 'reason', v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- uncomplete_quest — undo, reversing whatever XP was granted.
-- ---------------------------------------------------------------------------
create or replace function uncomplete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo todos%rowtype;
  v_xp   integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;

  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'done' then raise exception 'Quest is not completed'; end if;

  update todos
     set status = 'open', completed_at = null, xp_awarded = 0
   where id = p_todo;

  update profiles
     set xp = greatest(0, xp - v_todo.xp_awarded)
   where id = p_user
  returning xp into v_xp;

  insert into xp_events (user_id, todo_id, delta, reason)
  values (p_user, p_todo, -v_todo.xp_awarded, 'undid a completion');

  return json_build_object('delta', -v_todo.xp_awarded, 'xp', v_xp);
end;
$$;

-- ---------------------------------------------------------------------------
-- abandon_quest — give up on a deadline quest, take the hit.
-- ---------------------------------------------------------------------------
create or replace function abandon_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo  todos%rowtype;
  v_delta integer;
  v_xp    integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;

  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'open' then raise exception 'Quest is not open'; end if;

  -- Only a promised deadline can be broken. No deadline, no penalty.
  v_delta := case when v_todo.due_date is null then 0 else quest_penalty() end;

  update todos
     set status = 'failed', xp_awarded = v_delta
   where id = p_todo;

  update profiles
     set xp = greatest(0, xp + v_delta)
   where id = p_user
  returning xp into v_xp;

  insert into xp_events (user_id, todo_id, delta, reason)
  values (p_user, p_todo, v_delta, 'abandoned the quest');

  return json_build_object('delta', v_delta, 'xp', v_xp);
end;
$$;

-- ---------------------------------------------------------------------------
-- sweep_overdue — called on dashboard load. Quests more than 24h past their
-- deadline auto-fail. The grace period keeps it from feeling punitive.
-- ---------------------------------------------------------------------------
create or replace function sweep_overdue(p_user uuid)
returns json
language plpgsql
as $$
declare
  v_ids   uuid[];
  v_count integer;
  v_delta integer;
  v_xp    integer;
begin
  select array_agg(id) into v_ids
    from todos
   where user_id  = p_user
     and status   = 'open'
     and due_date is not null
     and due_date < now() - interval '24 hours';

  v_count := coalesce(array_length(v_ids, 1), 0);

  if v_count = 0 then
    select xp into v_xp from profiles where id = p_user;
    return json_build_object('count', 0, 'delta', 0, 'xp', coalesce(v_xp, 0));
  end if;

  v_delta := v_count * quest_penalty();

  update todos
     set status = 'failed', xp_awarded = quest_penalty()
   where id = any(v_ids);

  insert into xp_events (user_id, todo_id, delta, reason)
  select p_user, t.id, quest_penalty(), 'deadline passed'
    from unnest(v_ids) as t(id);

  update profiles
     set xp = greatest(0, xp + v_delta)
   where id = p_user
  returning xp into v_xp;

  return json_build_object('count', v_count, 'delta', v_delta, 'xp', v_xp);
end;
$$;
