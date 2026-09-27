-- ===========================================================================
--  Migration 026 — the village: presence, houses, notes, nudges, sessions
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  PRESENCE
--  --------
--  Everyone's village is laid out differently — it holds *their* friends —
--  so presence is a place, not a coordinate: at home, at the town hall, at
--  someone's house, or out on the square. Each viewer draws a friend at that
--  place in their own layout. A row is refreshed every few seconds while the
--  village is open; `seen_at` going stale is what "gone home" means.
--
--  HOUSES
--  ------
--  How big a house is follows its owner's level and is never stored. What's
--  stored is what they chose: a style (some unlock with level), a roof
--  colour and a garden. No row means the defaults.
--
--  NOTES AND NUDGES
--  ----------------
--  Door notes are short and plain text — unlike messages, not encrypted. A
--  nudge may point at one of the recipient's own open quests; only its
--  category and deadline are ever shown to anyone, and the pairing is checked
--  when it's written. How often one person can nudge another is enforced by
--  the app, from this table.
--
--  WORK SESSIONS
--  -------------
--  A session is a table at the town hall. Membership is kept as intervals —
--  join, leave, rejoin — so time worked is the sum of them. A member who
--  stops checking in for two minutes (closed the app, lost signal) is taken
--  off the table as of the last check-in. A session ends when its last
--  member leaves. With focus rounds on, everyone at the table shares one
--  25-minute-work / 5-minute-break clock, counted from `focus_from`.
--
--  Focus XP is paid per 25 minutes someone has been at a table: +3, or +4
--  if anyone was there with them, at most 12 a day in their own timezone.
--  It goes through xp_events like every other award.
-- ===========================================================================

create table if not exists village_presence (
  user_id  uuid primary key references users(id) on delete cascade,
  place    text not null default 'home' check (place in ('home', 'square', 'hall', 'house')),
  /* place = 'house': whose house they're standing at. */
  host_id  uuid references users(id) on delete set null,
  seen_at  timestamptz not null default now()
);

create table if not exists houses (
  user_id     uuid primary key references users(id) on delete cascade,
  style       text not null default 'timber' check (style in ('timber', 'stone', 'brick')),
  roof        text not null default 'red' check (length(roof) <= 20),
  garden      text not null default 'flowers' check (garden in ('flowers', 'vegetables', 'hedges')),
  updated_at  timestamptz not null default now()
);

create table if not exists door_notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  author_id  uuid not null references users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 140),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists door_notes_owner_idx on door_notes(owner_id, created_at desc);

create table if not exists nudges (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references users(id) on delete cascade,
  to_id      uuid not null references users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 80),
  todo_id    uuid references todos(id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);

create index if not exists nudges_to_idx on nudges(to_id, created_at desc);
create index if not exists nudges_pair_idx on nudges(from_id, to_id, created_at desc);

/* Receiving nudges at all, in the app and as notifications. */
alter table notification_prefs add column if not exists nudges boolean not null default true;

create table if not exists work_sessions (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references users(id) on delete cascade,
  focus       boolean not null default false,
  focus_from  timestamptz,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create index if not exists work_sessions_open_idx on work_sessions(ended_at) where ended_at is null;

create table if not exists session_members (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references work_sessions(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  /* What they're working on. Only its category is ever shown to others. */
  todo_id         uuid references todos(id) on delete set null,
  joined_at       timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  left_at         timestamptz,
  /* Whole 25-minute stretches of this stay already paid for. */
  rounds_paid     integer not null default 0
);

create index if not exists session_members_session_idx on session_members(session_id) where left_at is null;
create index if not exists session_members_user_idx on session_members(user_id, joined_at desc);
/* One table at a time. */
create unique index if not exists session_members_one_open
  on session_members(user_id) where left_at is null;

-- ---------------------------------------------------------------------------
-- award_focus_xp — pays for any whole 25-minute stretches a member has sat
-- through since last paid, within the daily cap. Returns the XP just added.
-- ---------------------------------------------------------------------------
create or replace function award_focus_xp(p_member uuid)
returns integer
language plpgsql
as $$
declare
  m          session_members%rowtype;
  v_zone     text;
  v_rounds   integer;
  v_today    integer;
  v_total    integer := 0;
  v_amount   integer;
  v_together boolean;
  v_before   integer;
begin
  select * into m from session_members where id = p_member for update;
  if not found then return 0; end if;

  v_rounds := floor(extract(epoch from (coalesce(m.left_at, m.last_seen) - m.joined_at)) / 1500)::integer;
  if v_rounds <= m.rounds_paid then return 0; end if;

  select coalesce((select name from pg_timezone_names where name = p.timezone), 'UTC')
    into v_zone from profiles p where p.id = m.user_id;
  v_zone := coalesce(v_zone, 'UTC');

  select coalesce(sum(delta), 0) into v_today from xp_events
   where user_id = m.user_id and reason like 'focus%'
     and (created_at at time zone v_zone)::date = (now() at time zone v_zone)::date;

  -- Was anyone else at the table during this stay?
  select exists (
    select 1 from session_members o
     where o.session_id = m.session_id and o.user_id <> m.user_id
       and o.joined_at < coalesce(m.left_at, m.last_seen)
       and coalesce(o.left_at, o.last_seen) > m.joined_at
  ) into v_together;

  for i in (m.rounds_paid + 1)..v_rounds loop
    v_amount := least(case when v_together then 4 else 3 end, greatest(0, 12 - v_today));
    exit when v_amount <= 0;
    select xp into v_before from profiles where id = m.user_id for update;
    update profiles set xp = v_before + v_amount where id = m.user_id;
    insert into xp_events (user_id, todo_id, delta, reason)
    values (m.user_id, null, v_amount,
            case when v_together then 'focus round, together' else 'focus round' end);
    v_today := v_today + v_amount;
    v_total := v_total + v_amount;
  end loop;

  -- Rounds past the cap still count as paid: they aren't owed tomorrow.
  update session_members set rounds_paid = v_rounds where id = p_member;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- quest_hint — a quest described without its title: its category and when
-- it's due, in its owner's timezone. "your Work quest due 5:00 PM", or with
-- 'their' for the person nudging. Titles never leave their owner.
-- ---------------------------------------------------------------------------
create or replace function quest_hint(p_todo uuid, p_whose text default 'your')
returns text
language sql
stable
as $$
  select p_whose || ' ' || coalesce(c.name || ' ', '') || 'quest ' ||
    case
      when t.due_date is null then 'with no deadline'
      when t.due_date < now()
           and (t.due_date at time zone z.tz)::date = (now() at time zone z.tz)::date
        then 'that was due at ' || to_char(t.due_date at time zone z.tz, 'FMHH12:MI AM')
      when t.due_date < now()
        then 'that was due ' || to_char(t.due_date at time zone z.tz, 'Mon FMDD')
      when (t.due_date at time zone z.tz)::date = (now() at time zone z.tz)::date
        then 'due at ' || to_char(t.due_date at time zone z.tz, 'FMHH12:MI AM')
      else 'due ' || to_char(t.due_date at time zone z.tz, 'Mon FMDD')
    end
  from todos t
  left join categories c on c.id = t.category_id
  cross join lateral (
    select coalesce((select name from pg_timezone_names where name = pr.timezone), 'UTC') as tz
      from profiles pr where pr.id = t.user_id
  ) z
  where t.id = p_todo
$$;
