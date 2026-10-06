-- ===========================================================================
--  Questline — schema (plain PostgreSQL, tested on Neon)
--  Run in the Neon SQL Editor, or: psql "$DATABASE_URL" -f db/schema.sql
--  Safe to re-run: everything is idempotent.
--
--  This is the whole database. Changes are made here, in place; there is no
--  separate migrations folder. When a change touches an existing database
--  (a new column, a changed default), write the matching `alter table ... if
--  not exists` and run it once by hand — `create table if not exists` will not
--  add columns to a table that is already there.
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ===========================================================================
-- Accounts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- users: credentials, handle, and key material for end-to-end encrypted DMs.
--
--   public_key            SPKI, base64. Published to friends.
--   wrapped_private_key   PKCS8 sealed with a key derived from the password in
--                         the browser. The server never sees it unwrapped.
--   escrowed_private_key  The same key sealed with AES-256-GCM under
--                         MESSAGE_KEY_SECRET (environment, never the database),
--                         so a password reset doesn't lose message history.
--                         Whoever holds both the database and the secret can
--                         read messages; the privacy policy says so.
--   auth_version          1 = legacy (server received the raw password)
--                         2 = the browser derives an auth secret; the raw
--                             password never leaves it
--   privacy_version       The accepted policy version; 0 routes the account
--                         through the consent gate.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id                    uuid primary key default gen_random_uuid(),
  email                 citext not null unique,
  username              citext not null unique,
  password_hash         text not null,
  auth_version          integer not null default 2,
  public_key            text,
  wrapped_private_key   text,
  escrowed_private_key  text,
  privacy_version       integer not null default 0,
  privacy_accepted_at   timestamptz,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles: XP, level and the character's look, one row per user.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key references users(id) on delete cascade,
  display_name  text not null default 'Adventurer',
  xp            integer not null default 0,
  -- A high-water mark: a rank once reached is kept, and XP is floored at the
  -- bottom of it rather than at zero. So level_for_xp(xp) = level always.
  level         integer not null default 1,
  appearance    jsonb not null default '{
                   "body": "male",
                   "skin": "fair",
                   "hair": "tousled",
                   "hairColor": "chestnut",
                   "eyes": "blue"
                 }'::jsonb,
  -- Gear ids, plus the chosen dye per dyeable slot. An absent or unrecognised
  -- dye falls back to the item's own default, so `dyes` may be empty.
  equipped      jsonb not null default '{
                   "torso": "rags",
                   "weapon": "stick",
                   "head": "none",
                   "cape": "none",
                   "offhand": "none",
                   "dyes": {}
                 }'::jsonb,
  -- IANA name. Everything reads it through coalesce(timezone, 'UTC').
  timezone      text,
  -- Week key (Monday, YYYY-MM-DD, UTC) of the last changelog entry shown.
  -- Text, not date: a date column comes back through the session timezone and
  -- makes week comparisons lie.
  updates_seen  text,
  -- The table view's layout (columns shown, order, widths, sort). Null means
  -- the default layout.
  table_layout  jsonb,
  -- Completed quests are deleted after a week, so their contribution to the
  -- metrics is folded in here on the way out. Every total the app shows is
  -- "archived counter + live count".
  archived_done     integer not null default 0,
  archived_on_time  integer not null default 0,
  archived_late     integer not null default 0,
  -- Deadlines that were missed and then removed by abandoning the quest. The
  -- row is gone, so this counter is the whole record.
  archived_missed   integer not null default 0,
  -- Unused: streak freezes are now counted from habit_log (see
  -- streak_freezes_left). Kept so older rows still load.
  streak_freezes    integer not null default 2,
  freezes_month     date,
  created_at    timestamptz not null default now()
);
alter table profiles add column if not exists streak_freezes integer not null default 2;
alter table profiles add column if not exists freezes_month  date;
-- The village store (src/lib/shop.ts). Coins are earned as XP is — one for
-- every ten — so a balance is xp / 10 less coins_spent; nothing else to keep
-- in step. bonus_freezes: streak freezes bought there, on top of the two a
-- month (streak_freezes_left).
alter table profiles add column if not exists coins_spent   integer not null default 0;
alter table profiles add column if not exists bonus_freezes integer not null default 0;

-- ---------------------------------------------------------------------------
-- policy_acceptances: append-only record of agreement to the privacy policy.
-- Answers "who agreed, to which version, when"; the text of each version is
-- in git. Deliberately does not record IP or user agent.
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
-- password_resets: only the SHA-256 of each 256-bit token is stored, so a read
-- of this table yields nothing usable. 30 minutes, single use, and asking for
-- a new link kills older ones.
-- ---------------------------------------------------------------------------
create table if not exists password_resets (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists password_resets_user_idx on password_resets(user_id);

-- ---------------------------------------------------------------------------
-- feedback
--
-- `user_id` is nullable, and that nullability *is* the anonymity: "send
-- anonymously" writes no identifier at all, rather than a flag next to one.
-- `created_at` is rounded to the hour for anonymous submissions, because a
-- to-the-second stamp on a short user list often identifies the author.
-- ---------------------------------------------------------------------------
create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback(created_at desc);

-- ===========================================================================
-- Quests
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- categories: user-defined buckets (Work, Fitness, Music, ...)
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  color       text not null default 'amber',
  sort_order  integer not null default 0,
  -- Pruned and abandoned quests, split by outcome, for the Strengths figure.
  -- Counters because those rows are deleted.
  archived_done     integer not null default 0,
  archived_on_time  integer not null default 0,
  archived_late     integer not null default 0,
  archived_missed   integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists categories_user_idx on categories(user_id, sort_order);

-- ---------------------------------------------------------------------------
-- habits: a schedule of ISO weekdays, ticked from the Habits grid. Each due
-- day ends up as one habit_log row (done or missed); habits never put
-- anything on the quest board.
-- ---------------------------------------------------------------------------
create table if not exists habits (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  title              text not null,
  notes              text,
  days               integer[] not null default '{1,2,3,4,5,6,7}'::integer[],
  streak             integer not null default 0,
  best_streak        integer not null default 0,
  active             boolean not null default true,
  -- Optional stopping conditions; whichever is reached first ends the habit.
  -- The occurrence count is the number of habit_log rows.
  ends_on            date,
  occurrences_limit  integer,
  -- Every due day up to here has a log row. Only moves forward.
  settled_through    date,
  created_at         timestamptz not null default now(),
  -- cardinality(), not array_length(): array_length('{}', 1) is null, and a
  -- CHECK only rejects false, so that spelling lets an empty set through.
  constraint habits_days_valid check (
    cardinality(days) between 1 and 7
    and days <@ '{1,2,3,4,5,6,7}'::integer[]
  )
);
create index if not exists habits_user_idx on habits(user_id, active);

create table if not exists habit_log (
  habit_id   uuid not null references habits(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  /* The habit owner's local date. */
  day        date not null,
  done       boolean not null,
  /* What actually moved on the profile: +reward for a tick, -1 (or less, at
     the level floor) for a miss. Un-ticking gives this back. */
  xp         integer not null default 0,
  /* The streak this row left the habit on. 0 for a miss; unchanged for a
     frozen day. */
  streak     integer not null default 0,
  /* A due day that went unticked but spent a streak freeze: not done, no XP
     moved, and the streak held where it was. */
  frozen     boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);
alter table habit_log add column if not exists frozen boolean not null default false;
-- A miss the user set themselves (miss_habit_day), which the week-old safety
-- net in settle_habits leaves alone.
alter table habit_log add column if not exists chosen boolean not null default false;
-- How far settle_habits' safety net has looked: every miss up to here that
-- was left alone for its week has had its chance at a freeze. Habits from
-- before the net start from where they'd settled, so old misses stay as
-- they were.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'habits' and column_name = 'netted_through') then
    alter table habits add column netted_through date;
    update habits set netted_through = settled_through;
  end if;
end $$;
create index if not exists habit_log_user_idx on habit_log(user_id, day desc);

-- ---------------------------------------------------------------------------
-- todos ("quests").  status: open | done | failed
-- ---------------------------------------------------------------------------
create table if not exists todos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  category_id     uuid references categories(id) on delete set null,
  -- Legacy: habits used to create quests. Nothing sets it any more.
  habit_id        uuid references habits(id) on delete cascade,
  title           text not null,
  notes           text,
  due_date        timestamptz,
  status          text not null default 'open' check (status in ('open','done','failed')),
  completed_at    timestamptz,
  -- The net XP this quest has moved, so no transition can pay or charge twice.
  xp_awarded      integer not null default 0,
  -- Manual order within the category box on the board. Null = slotted in by
  -- deadline; editing the deadline or category clears it.
  position        double precision,
  -- Manual order in the table view, one flat list across categories.
  table_position  double precision,
  created_at      timestamptz not null default now()
);
create index if not exists todos_user_idx on todos(user_id, status, due_date);
create index if not exists todos_position_idx on todos(user_id, position);

-- ---------------------------------------------------------------------------
-- subtasks: steps within a quest. Deliberately not rows in todos (every quest
-- query would need a parent filter, and missing one in sweep_overdue would
-- charge a penalty per step), and deliberately worth no XP (splitting a quest
-- would pay several times for the same work).
-- ---------------------------------------------------------------------------
create table if not exists subtasks (
  id         uuid primary key default gen_random_uuid(),
  todo_id    uuid not null references todos(id) on delete cascade,
  -- Denormalised from the parent so every write can be scoped by owner.
  user_id    uuid not null references users(id) on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 200),
  done       boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists subtasks_todo_idx on subtasks (todo_id, position);
create index if not exists subtasks_user_idx on subtasks (user_id);

-- ---------------------------------------------------------------------------
-- Custom table-view columns (like Notion properties) and their per-quest
-- values. Values are jsonb, validated against the column's kind in
-- src/lib/table-columns.ts before they're written.
-- ---------------------------------------------------------------------------
create table if not exists table_columns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null check (length(name) between 1 and 40),
  kind        text not null check (kind in ('text', 'number', 'checkbox', 'select', 'date')),
  /* For select columns: [{ "id", "label", "color" }]. Empty otherwise. */
  options     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists table_columns_user_idx on table_columns(user_id);

create table if not exists todo_values (
  todo_id    uuid not null references todos(id) on delete cascade,
  column_id  uuid not null references table_columns(id) on delete cascade,
  /* Denormalised owner, so every read and write can be scoped by it. */
  user_id    uuid not null references users(id) on delete cascade,
  value      jsonb not null,
  primary key (todo_id, column_id)
);
create index if not exists todo_values_user_idx on todo_values(user_id);

-- ---------------------------------------------------------------------------
-- xp_events: append-only ledger so the character's history is auditable.
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

-- ---------------------------------------------------------------------------
-- ranks: the level curve. Same numbers as RANKS in src/lib/game.ts — change
-- both. Past the last named rank each level costs 1000.
-- ---------------------------------------------------------------------------
create table if not exists ranks (
  level integer primary key,
  xp    integer not null
);

insert into ranks (level, xp) values
  (1, 0), (2, 20), (3, 50), (4, 100), (5, 170),
  (6, 260), (7, 380), (8, 530), (9, 720), (10, 950),
  (11, 1220), (12, 1540), (13, 1910), (14, 2340), (15, 2830),
  (16, 3380), (17, 4000), (18, 4690), (19, 5460), (20, 6310)
on conflict (level) do update set xp = excluded.xp;

-- ===========================================================================
-- Social
-- ===========================================================================

-- friendships: one row per pair, stored with the requester first.
create table if not exists friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references users(id) on delete cascade,
  addressee_id  uuid not null references users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint friendship_pair unique (requester_id, addressee_id),
  constraint friendship_not_self check (requester_id <> addressee_id)
);
create index if not exists friendships_requester_idx on friendships(requester_id, status);
create index if not exists friendships_addressee_idx on friendships(addressee_id, status);
-- The pair is unique whichever way round it is stored, so two people pressing
-- "add" at the same instant can't create both (A,B) and (B,A).
create unique index if not exists friendships_pair_uniq
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- messages: ciphertext only. `iv` and `body` are base64 AES-GCM under a key
-- derived by ECDH between the two users' keypairs, so both ends decrypt the
-- same row.
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references users(id) on delete cascade,
  recipient_id  uuid not null references users(id) on delete cascade,
  iv            text not null,
  body          text not null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists messages_pair_idx
  on messages(least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);
create index if not exists messages_inbox_idx on messages(recipient_id, read_at);

-- ---------------------------------------------------------------------------
-- Push notifications.
--
--   push_subscriptions  One row per device that said yes. A device the push
--                       service reports gone (404/410) is deleted when found.
--   notification_prefs  Per person, for all their devices. No row = defaults.
--   notification_log    What's been sent, so the five-minute job never sends
--                       the same thing twice. A deadline reminder is keyed by
--                       quest *and* deadline; a morning summary by local date.
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique check (length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) <= 200),
  auth        text not null check (length(auth) <= 100),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

create table if not exists notification_prefs (
  user_id         uuid primary key references users(id) on delete cascade,
  /* A reminder this long before each quest's deadline. */
  due_soon        boolean not null default true,
  lead_minutes    integer not null default 60
                    check (lead_minutes in (15, 30, 60, 120, 240, 1440)),
  /* One summary each morning, at this local time (minutes past midnight). */
  morning         boolean not null default true,
  morning_minutes integer not null default 480
                    check (morning_minutes between 0 and 1439),
  /* A new message from a companion. */
  messages        boolean not null default true,
  /* Receiving nudges at all, in the app and as notifications. */
  nudges          boolean not null default true,
  /* A reminder at 6pm and 9pm local while a habit due today is unticked. */
  habits          boolean not null default true,
  updated_at      timestamptz not null default now()
);
alter table notification_prefs add column if not exists habits boolean not null default true;

create table if not exists notification_log (
  user_id  uuid not null references users(id) on delete cascade,
  kind     text not null,
  ref      text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
-- 'habit' is keyed by local date and hour: "2026-09-29@18".
alter table notification_log drop constraint if exists notification_log_kind_check;
alter table notification_log add constraint notification_log_kind_check
  check (kind in ('due', 'morning', 'habit'));
create index if not exists notification_log_sent_idx on notification_log(sent_at);

-- ===========================================================================
-- The village
--
-- One village for everyone, laid out the same on every screen, so presence
-- carries a position everywhere in it — outside, inside a house, in the
-- arena — along with the place it's at. "home" is being in the app but not
-- the village (no position). A row is refreshed every few seconds while the
-- village is open; a stale `seen_at` is what "offline" means.
-- ===========================================================================
create table if not exists village_presence (
  user_id  uuid primary key references users(id) on delete cascade,
  place    text not null default 'home'
             constraint village_presence_place_check
             check (place in ('home', 'square', 'hall', 'house', 'inside', 'arena', 'library', 'store', 'bakery')),
  /* place = 'house' or 'inside': whose house. */
  host_id  uuid references users(id) on delete set null,
  x        real,
  y        real,
  facing   smallint,
  /* Which of their devices this is (an id each open app makes up). Signed
     in on two, the first one here keeps the row until it's closed — stops
     checking in, or says it's going — so the two never fight over it.
     Null: no device's, or let go of. */
  device   text,
  seen_at  timestamptz not null default now()
);
alter table village_presence add column if not exists device text;
-- Which village they're in: there's a new one for every 24 houses (plot / 24:
-- four rows of six),
-- each with its own town hall and arena, joined by trains.
alter table village_presence add column if not exists village integer not null default 0;
-- Inside a village's library, store or bakery, too (each its own room, like the arena).
alter table village_presence drop constraint if exists village_presence_place_check;
alter table village_presence add constraint village_presence_place_check
  check (place in ('home', 'square', 'hall', 'house', 'inside', 'arena', 'library', 'store', 'bakery'));

-- A house's size follows its owner's level and is never stored. `interior`
-- holds wallpaper, floor and furniture; null is the default room.
create table if not exists houses (
  user_id     uuid primary key references users(id) on delete cascade,
  style       text not null default 'timber' check (style in ('timber', 'stone', 'brick')),
  roof        text not null default 'red' check (length(roof) <= 20),
  garden      text not null default 'flowers' check (garden in ('flowers', 'vegetables', 'hedges')),
  interior    jsonb,
  updated_at  timestamptz not null default now()
);
-- Where the house stands. The village is one map for everyone, and plot n
-- is in the same place on every screen (src/components/village/world.ts,
-- plotAt). Given on a first visit, near the owner's companions; they can
-- move to any empty lot. plot_at: when it was last given or moved, so
-- everyone's village can notice and redraw.
alter table houses add column if not exists plot    integer check (plot >= 0);
alter table houses add column if not exists plot_at timestamptz;
create unique index if not exists houses_plot_key on houses(plot) where plot is not null;

-- Things bought at the store to keep (a roof colour, a wallpaper…), one row
-- each. Things used up (streak freezes) are counted on the profile instead.
create table if not exists purchases (
  user_id   uuid not null references users(id) on delete cascade,
  item      text not null check (length(item) <= 40),
  bought_at timestamptz not null default now(),
  primary key (user_id, item)
);

-- Door notes are short plain text — unlike messages, not encrypted.
create table if not exists door_notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  author_id  uuid not null references users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 140),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists door_notes_owner_idx on door_notes(owner_id, created_at desc);
-- Journal entries, written in the notebook on the desk at home (the village;
-- src/lib/journal-actions.ts). Private to their owner and only ever read back
-- to them, but plain text like quest notes — unlike messages, not encrypted.
create table if not exists journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journal_entries_user_idx on journal_entries(user_id, created_at desc);

-- An entry also has a topic, how the day felt and the weather (ids from
-- src/lib/journal.ts), and its day and time (created_at) can be changed. One
-- with a topic and nothing written yet is kept.
alter table journal_entries add column if not exists topic text not null default '' check (length(topic) <= 80);
alter table journal_entries add column if not exists mood text check (length(mood) <= 20);
alter table journal_entries add column if not exists weather text check (length(weather) <= 20);
alter table journal_entries drop constraint if exists journal_entries_body_check;
alter table journal_entries add constraint journal_entries_body_check
  check (length(body) <= 10000 and (length(body) >= 1 or length(topic) >= 1));

-- A treat from the village bakery (src/lib/bakery.ts) can come with a note, or
-- be left on its own: then the note may be empty.
alter table door_notes add column if not exists treat text check (length(treat) <= 20);
alter table door_notes drop constraint if exists door_notes_body_check;
alter table door_notes add constraint door_notes_body_check
  check (length(body) <= 140 and (length(body) >= 1 or treat is not null));

-- A nudge may point at one of the recipient's own quests; only its category
-- and deadline are ever shown (quest_hint). Frequency is enforced by the app.
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

-- ---------------------------------------------------------------------------
-- Work sessions: a table at the town hall. Membership is kept as intervals, so
-- time worked is their sum. A member silent for two minutes is taken off as of
-- their last check-in; a session ends when its last member leaves. With focus
-- on, everyone shares one clock counted from `focus_from`: focus_work minutes
-- of work, then focus_rest of break (25/5, 50/10 or 90/15; village.ts RHYTHMS).
-- ---------------------------------------------------------------------------
create table if not exists work_sessions (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references users(id) on delete cascade,
  focus       boolean not null default false,
  focus_from  timestamptz,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists work_sessions_open_idx on work_sessions(ended_at) where ended_at is null;
-- The village whose town hall the table is in.
alter table work_sessions add column if not exists village integer not null default 0;
-- Where the table is: out by the town hall, or at a desk in the library.
alter table work_sessions add column if not exists spot text not null default 'hall';
alter table work_sessions drop constraint if exists work_sessions_spot_check;
alter table work_sessions add constraint work_sessions_spot_check check (spot in ('hall', 'library', 'bakery'));
alter table work_sessions add column if not exists focus_work integer not null default 25
  check (focus_work between 5 and 180);
alter table work_sessions add column if not exists focus_rest integer not null default 5
  check (focus_rest between 1 and 60);

create table if not exists session_members (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references work_sessions(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  /* What they're working on. Only its category is ever shown to others. */
  todo_id         uuid references todos(id) on delete set null,
  joined_at       timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  left_at         timestamptz,
  /* Whole 25-minute stretches of this stay already paid for (whatever the
     table's focus rhythm: pay goes by time at the table). */
  rounds_paid     integer not null default 0
);
create index if not exists session_members_session_idx on session_members(session_id) where left_at is null;
create index if not exists session_members_user_idx on session_members(user_id, joined_at desc);
/* One table at a time. */
create unique index if not exists session_members_one_open
  on session_members(user_id) where left_at is null;

-- Talk in a shared space. Short, plain text, deleted after an hour.
create table if not exists space_chat (
  id         uuid primary key default gen_random_uuid(),
  /* 'inside:<owner id>' (on a planet, 'inside:<owner id>:<village>'), 'arena:<village>', 'hall:<village>'… */
  space      text not null check (length(space) <= 60),
  author_id  uuid not null references users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 140),
  created_at timestamptz not null default now()
);
create index if not exists space_chat_space_idx on space_chat(space, created_at desc);

-- Duels: each round both pick strike, guard or feint; it resolves when both
-- have picked or time runs out. Gear sets the numbers at the start. No XP
-- changes hands.
create table if not exists duels (
  id          uuid primary key default gen_random_uuid(),
  a_id        uuid not null references users(id) on delete cascade, -- challenger
  b_id        uuid not null references users(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'active', 'done', 'declined', 'expired', 'cancelled')),
  /* Fixed at the start from each side's gear. */
  a_hp        integer, b_hp integer,
  a_max       integer, b_max integer,
  a_atk       integer, b_atk integer,
  a_def       integer, b_def integer,
  round       integer not null default 0,
  a_move      text check (a_move in ('strike', 'guard', 'feint')),
  b_move      text check (b_move in ('strike', 'guard', 'feint')),
  round_ends  timestamptz,
  winner      uuid references users(id) on delete set null,
  /* Every resolved round: [{ r, a, b, ad, bd }] — moves and damage taken. */
  log         jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (a_id <> b_id)
);
-- The village whose arena it's fought in: one duel at a time in each.
alter table duels add column if not exists village integer not null default 0;
create index if not exists duels_open_idx on duels(status) where status in ('pending', 'active');
-- Duels are fought live in the one arena (src/lib/duel.ts): only one may be
-- open at a time. Anything time has already settled is closed first, so a
-- stale row can't block the index being built.
update duels set status = 'expired', updated_at = now()
 where status = 'pending' and created_at < now() - interval '60 seconds';
update duels set status = 'done', round_ends = null, updated_at = now(),
       winner = case when a_hp > b_hp then a_id when b_hp > a_hp then b_id end
 where status = 'active' and (round_ends is null or round_ends <= now());
-- One duel at a time in each village's arena.
drop index if exists duels_one_at_a_time;
create unique index if not exists duels_one_per_arena on duels (village)
 where status in ('pending', 'active');
create index if not exists duels_a_idx on duels(a_id, created_at desc);
create index if not exists duels_b_idx on duels(b_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Planets: private, invite-only worlds (src/lib/planet-actions.ts). Each is a
-- village of its own — the same layout, with its own town hall, arena and
-- shops — that only its members can go to, by rocket from any station. Its
-- village number is 100000 + id (world.ts, PLANET_BASE), so presence, tables,
-- duels and talk key on it just as they do on a public village's.
--
-- Whoever founds one owns it: they name it, invite companions or share its
-- code, and can take anyone off it. Members have a house there of its own —
-- its own look, rooms and lot — apart from their house in the public villages.
-- ---------------------------------------------------------------------------
create table if not exists planets (
  id         serial primary key,
  owner_id   uuid not null references users(id) on delete cascade,
  name       text not null check (length(name) between 1 and 30),
  look       text not null default 'dust' check (look in ('dust', 'moon', 'nebula', 'glacier')),
  /* Anyone with it can join. The owner can change it, which stops the old one working. */
  code       text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);
create index if not exists planets_owner_idx on planets(owner_id);

-- Who's on each planet, the owner included.
create table if not exists planet_members (
  planet_id integer not null references planets(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (planet_id, user_id)
);
create index if not exists planet_members_user_idx on planet_members(user_id);

-- Invitations from the owner to a companion, waiting for a yes or no.
create table if not exists planet_invites (
  planet_id  integer not null references planets(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  invited_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (planet_id, user_id)
);
create index if not exists planet_invites_user_idx on planet_invites(user_id);

-- A member's house on a planet, on lot `slot` of its 24 (world.ts, plotAt):
-- like `houses`, but one per planet, and gone with the membership.
create table if not exists planet_houses (
  planet_id  integer not null,
  user_id    uuid not null,
  slot       integer not null check (slot between 0 and 23),
  slot_at    timestamptz not null default now(),
  style      text not null default 'timber' check (style in ('timber', 'stone', 'brick')),
  roof       text not null default 'red' check (length(roof) <= 20),
  garden     text not null default 'flowers' check (garden in ('flowers', 'vegetables', 'hedges')),
  interior   jsonb,
  updated_at timestamptz not null default now(),
  primary key (planet_id, user_id),
  foreign key (planet_id, user_id) references planet_members(planet_id, user_id) on delete cascade
);
create unique index if not exists planet_houses_slot_key on planet_houses(planet_id, slot);

-- ===========================================================================
-- Functions. Defined after every table: SQL-language bodies are checked
-- against the tables they name when they're created.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- bootstrap_user — a brand-new user's profile and starter categories. Called
-- by the app right after inserting the user row. New accounts start caught up
-- on the changelog.
-- ---------------------------------------------------------------------------
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

-- are_friends(a, b) — gates every social read.
create or replace function are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from friendships
     where status = 'accepted'
       and ((requester_id = p_a and addressee_id = p_b)
         or (requester_id = p_b and addressee_id = p_a))
  );
$$;

-- ---------------------------------------------------------------------------
-- reset_password — spends a token and replaces the credential, atomically.
-- Returns the account's id, or null when the token is unknown, spent or
-- expired; the first UPDATE claims the token, so a double submit is harmless.
--
-- The browser brings back the escrowed key re-sealed under the new password,
-- with the same public key, and messages carry on. Only when it had to make a
-- new keypair (no escrow) are the old messages deleted: no key opens them.
-- ---------------------------------------------------------------------------
create or replace function reset_password(
  p_token_hash  text,
  p_hash        text,
  p_public_key  text,
  p_wrapped     text,
  p_escrow      text
)
returns uuid
language plpgsql
as $$
declare
  v_user     uuid;
  v_old_key  text;
begin
  update password_resets
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning user_id into v_user;

  if v_user is null then return null; end if;

  select public_key into v_old_key from users where id = v_user for update;

  update users set
    password_hash        = p_hash,
    auth_version         = 2,
    public_key           = p_public_key,
    wrapped_private_key  = p_wrapped,
    -- A new escrow if one came with the reset; otherwise keep the old one only
    -- while it still belongs to this keypair.
    escrowed_private_key = case
                             when p_escrow is not null then p_escrow
                             when v_old_key is not distinct from p_public_key
                               then escrowed_private_key
                             else null
                           end
  where id = v_user;

  -- Any other link still in someone's inbox dies with this one.
  update password_resets
     set used_at = now()
   where user_id = v_user and used_at is null;

  if v_old_key is distinct from p_public_key then
    delete from messages where sender_id = v_user or recipient_id = v_user;
  end if;

  return v_user;
end;
$$;

-- ===========================================================================
-- XP economy. All arithmetic lives here so a compromised client cannot
-- inflate its own score, and every mutation is one atomic statement. Every
-- function takes p_user explicitly and filters on it, so a quest id belonging
-- to someone else simply will not match.
-- ===========================================================================

-- Awards for finishing a quest. Mirrored in XP in src/lib/game.ts.
--   no due date       → +5
--   due date, on time → +10
--   due date, late    → +3
create or replace function quest_xp(p_due timestamptz, p_done timestamptz)
returns integer language sql immutable as $$
  select case
    when p_due is null    then 5
    when p_done <= p_due  then 10
    else                       3
  end;
$$;

-- A deadline that went by: -10. Calling a quest off yourself: -5.
create or replace function quest_penalty()
returns integer language sql immutable as $$ select -10; $$;

create or replace function quest_abandon_penalty()
returns integer language sql immutable as $$ select -5; $$;

-- What a quest should be contributing, given its state. Every transition moves
-- `target - xp_awarded`, so repeating one moves nothing the second time.
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

create or replace function xp_for_level(p_level integer)
returns integer
language sql stable as $$
  select case
    when p_level <= 1 then 0
    else coalesce(
      (select r.xp from ranks r where r.level = p_level),
      (select max(r.xp) + (p_level - max(r.level)) * 1000 from ranks r)
    )
  end;
$$;

create or replace function level_for_xp(p_xp integer)
returns integer
language sql stable as $$
  with top as (select max(level) as level, max(xp) as xp from ranks)
  select case
    when p_xp >= (select xp from top)
      then (select level from top) + ((p_xp - (select xp from top)) / 1000)
    else coalesce((select max(r.level) from ranks r where r.xp <= p_xp), 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- quest_transition — the single place a quest changes state. Every action
-- funnels through it, which is what makes the accounting impossible to double.
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
-- refunds the penalty and pays the late award in one move.
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
-- uncomplete_quest — back to exactly where it would have been: missed if the
-- deadline is past the grace period, open otherwise. Going straight to
-- 'failed' matters; reopening a long-overdue quest would let the next sweep
-- charge the penalty a second time.
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
-- abandon_quest — call off anything unfinished: record the miss and remove it.
--
-- Costs whichever is worse, -5 or what the quest already took — never a
-- refund. Reconciling a missed quest (-10) up to -5 would make abandoning
-- every miss on sight the winning move.
--
-- The xp_events row is written before the delete; its todo_id is nulled on
-- the way out, which is why the title goes into the reason.
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
  v_target  integer;
  v_delta   integer;
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status = 'done' then
    raise exception 'Quest is already finished';
  end if;

  select xp, level into v_before, v_level from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  v_floor   := xp_for_level(v_level);
  v_target  := least(quest_abandon_penalty(), v_todo.xp_awarded);
  v_delta   := v_target - v_todo.xp_awarded;
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
  -- of the Strengths figure rather than counted as a miss.
  if v_todo.due_date is not null then
    update categories set archived_missed = archived_missed + 1
     where id = v_todo.category_id and user_id = p_user;
    update profiles set archived_missed = archived_missed + 1
     where id = p_user;
  end if;

  delete from todos where id = p_todo and user_id = p_user;

  return json_build_object(
    'delta', v_applied, 'awarded', 0, 'xp', v_xp, 'reason', 'oath broken'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_quest — remove a quest as though it had never been written down.
-- Nothing is counted and whatever XP it moved is put back (floor permitting),
-- which is what makes delete the tool for mistakes and abandon the one for
-- giving up.
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
  -- Already gone is a success: the board can be a click behind the database.
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

  delete from todos where id = p_todo and user_id = p_user;

  return json_build_object(
    'delta', v_applied, 'awarded', 0, 'xp', v_xp, 'reason', 'quest deleted'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- sweep_overdue — auto-fail anything more than 24h past its deadline. Only
-- picks 'open', and a repeat transition would move zero XP anyway.
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
-- One statement, so the delete and every counter move commit together; a row
-- can only be deleted once, so it can only be counted once. Missed quests are
-- untouched: they can still be redeemed.
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

-- ---------------------------------------------------------------------------
-- add_subtask — append a step, enforcing ownership and the cap of twenty in
-- one statement so neither can be raced. Returns nothing if the quest isn't
-- the caller's or is full.
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
     and (select count(*) from subtasks s where s.todo_id = t.id) < 20
  returning *;
$$;

-- ===========================================================================
-- Habits — "1% better every day"
--
-- A tick pays round(1.01 ^ (streak - 1)), capped at 10, where streak counts
-- this tick: +1 until day 42, +10 from day 228. A miss costs -1 and resets the
-- streak. Mirrored in habitReward() in src/lib/habits.ts — change both.
-- ===========================================================================

create or replace function is_habit_due(p_days integer[], p_day date)
returns boolean
language sql immutable as $$
  select extract(isodow from p_day)::integer = any(p_days);
$$;

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

create or replace function habit_reward(p_streak integer)
returns integer
language sql immutable as $$
  select least(10, greatest(1, round(power(1.01, greatest(p_streak, 1) - 1))::integer));
$$;

-- habit_move_xp — add (or take) XP with the same floor and ratchet as
-- quest_transition. Returns what actually moved.
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
-- streak_freezes_left — two a month (plus any bought), shared by every habit, counted straight
-- from the log: each frozen day is one spent. A freeze is spent on a missed
-- day of the user's choosing (freeze_habit_day) or, failing that, by
-- settle_habits once the miss is a week old; it comes out of the month of
-- the day after it (a freeze on the 30th of September is October's).
-- Ticking a frozen day late, or setting it back to missed, hands it back.
-- (profiles.streak_freezes / freezes_month are no longer read.)
-- ---------------------------------------------------------------------------
create or replace function streak_freezes_left(p_user uuid, p_today date)
returns integer
language sql stable as $$
  -- Two a month, then any bought at the store (profiles.bonus_freezes),
  -- which only go once a month's two have: every frozen day past two in a
  -- month, this month and before, used one of them up.
  with used as (
    select date_trunc('month', day + 1) as m, count(*)::integer as n
      from habit_log
     where user_id = p_user and frozen
     group by 1
  )
  select greatest(0, 2 - coalesce((select n from used where m = date_trunc('month', p_today)), 0))
       + greatest(0,
           coalesce((select bonus_freezes from profiles where id = p_user), 0)
           - coalesce((select sum(greatest(0, n - 2)) from used where m <= date_trunc('month', p_today)), 0)::integer);
$$;

-- use_streak_freeze — whether a freeze is left to spend on p_day. The caller
-- spends it by logging the day as frozen. The profile row is locked so two
-- settles can't both take the last one.
create or replace function use_streak_freeze(p_user uuid, p_day date)
returns boolean
language plpgsql
as $$
begin
  perform 1 from profiles where id = p_user for update;
  return streak_freezes_left(p_user, p_day + 1) > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_habits — settle every due day that ended without a tick as a miss:
-- -1 XP and the streak resets. The user picks which missed days get a streak
-- freeze (freeze_habit_day), for up to a week. As a safety net, a miss still
-- untouched when its week is up gets one then, if one is left and there's a
-- streak to keep; one the user set to missed themselves (chosen) doesn't.
-- Returns the XP moved. Idempotent (a logged day is
-- skipped, settled_through only moves forward), so it runs on every page load.
-- Paused habits aren't settled; resuming moves settled_through to yesterday.
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
  v_net    json;
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
        v_total  := v_total + v_moved;
        v_logged := v_logged + 1;
      end if;

      v_day := v_day + 1;
    end loop;

    update habits set
      streak          = h.streak,
      settled_through = v_today - 1
    where id = h.id;
  end loop;

  -- The safety net, oldest miss first, so a freeze carries the streak on to
  -- the next miss and that one can hold it too.
  for h in
    select * from habits
     where user_id = p_user
       and coalesce(netted_through, (created_at at time zone v_zone)::date - 1) < v_today - 8
     for update
  loop
    for v_day in
      select day from habit_log
       where habit_id = h.id and not done and not frozen and not chosen
         and day >  coalesce(h.netted_through, (h.created_at at time zone v_zone)::date - 1)
         and day <= v_today - 8
       order by day
    loop
      v_net := freeze_habit_day(p_user, h.id, v_day, true);
      if v_net is not null then v_total := v_total + (v_net->>'delta')::integer; end if;
    end loop;
    update habits set netted_through = v_today - 8 where id = h.id;
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
    update habits set streak = v_streak where id = h.id;
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
    streak      = v_streak,
    best_streak = greatest(best_streak, v_streak)
  where id = h.id;

  return json_build_object(
    'done', true, 'delta', v_moved, 'streak', v_streak,
    'xp', (select xp from profiles where id = p_user)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_habit_day — tick a missed or frozen day up to a week late, for when
-- it was done but not ticked in time. It's paid as the tick it would have
-- been: a miss gives its penalty back too, and a freeze goes back in the
-- pool. The run before the day carries on through it, so every later day in
-- the same unbroken run counts that much more (rewards already paid stand).
-- A kept day, or one more than a week old, stays as it is.
-- ---------------------------------------------------------------------------
create or replace function redeem_habit_day(p_user uuid, p_habit uuid, p_day date)
returns json
language plpgsql
as $$
declare
  v_today  date;
  v_streak integer;
  v_gain   integer;
  v_moved  integer;
  v_break  date;
  v_log    habit_log%rowtype;
  h        habits%rowtype;
begin
  perform settle_habits(p_user);

  select (now() at time zone coalesce(timezone, 'UTC'))::date into v_today
    from profiles where id = p_user;

  select * into h from habits where id = p_habit and user_id = p_user for update;
  if not found then raise exception 'Habit not found'; end if;

  select * into v_log from habit_log where habit_id = h.id and day = p_day for update;
  if not found or v_log.done or p_day < v_today - 7 then
    raise exception 'That day has closed — only a missed day from the last week can be ticked late.';
  end if;

  -- A frozen row holds the streak as it stood. A miss reset it to 0, so the
  -- run it broke is the day before's.
  if v_log.frozen then
    v_streak := v_log.streak + 1;
  else
    v_streak := coalesce((select l.streak from habit_log l
                           where l.habit_id = h.id and l.day < p_day
                           order by l.day desc limit 1), 0) + 1;
  end if;
  v_gain  := v_streak - v_log.streak;
  v_moved := habit_move_xp(p_user, habit_reward(v_streak) - v_log.xp, 'habit (late): ' || h.title);

  update habit_log set done = true, frozen = false, xp = v_log.xp + v_moved, streak = v_streak
   where habit_id = h.id and day = p_day;

  -- The run carries on until the first real miss after it.
  select min(day) into v_break from habit_log
   where habit_id = h.id and day > p_day and not done and not frozen;

  update habit_log set streak = streak + v_gain
   where habit_id = h.id and day > p_day and (v_break is null or day < v_break);

  update habits set
    streak      = case when v_break is null then streak + v_gain else streak end,
    best_streak = greatest(best_streak,
                           (select max(streak) from habit_log where habit_id = h.id))
   where id = h.id
  returning streak into v_streak;

  return json_build_object(
    'done', true, 'delta', v_moved, 'streak', v_streak,
    'xp', (select xp from profiles where id = p_user)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- miss_habit_day — the other way round: a kept or frozen day up to a week
-- old becomes a plain miss. A kept day's reward comes back off along with the
-- miss's -1 (a frozen one hands its freeze back), and the run it was part of
-- breaks there, so every later day in that run counts that much less
-- (rewards already paid stand, as above). Ticking it late puts it back.
-- A miss set here is the user's choice: the safety net won't freeze it.
-- ---------------------------------------------------------------------------
drop function if exists unkeep_habit_day(uuid, uuid, date);
create or replace function miss_habit_day(p_user uuid, p_habit uuid, p_day date)
returns json
language plpgsql
as $$
declare
  v_today  date;
  v_streak integer;
  v_moved  integer;
  v_break  date;
  v_log    habit_log%rowtype;
  h        habits%rowtype;
begin
  perform settle_habits(p_user);

  select (now() at time zone coalesce(timezone, 'UTC'))::date into v_today
    from profiles where id = p_user;

  select * into h from habits where id = p_habit and user_id = p_user for update;
  if not found then raise exception 'Habit not found'; end if;

  select * into v_log from habit_log where habit_id = h.id and day = p_day for update;
  if not found or not (v_log.done or v_log.frozen) or p_day < v_today - 7 then
    raise exception 'That day has closed — only a day from the last week can be changed.';
  end if;

  v_moved := habit_move_xp(p_user, -v_log.xp - 1,
               case when v_log.done then 'habit (not done after all): ' else 'missed habit: ' end || h.title);

  update habit_log set done = false, frozen = false, chosen = true, xp = v_log.xp + v_moved, streak = 0
   where habit_id = h.id and day = p_day;

  select min(day) into v_break from habit_log
   where habit_id = h.id and day > p_day and not done and not frozen;

  update habit_log set streak = greatest(0, streak - v_log.streak)
   where habit_id = h.id and day > p_day and (v_break is null or day < v_break);

  update habits set
    streak = case when v_break is null then greatest(0, streak - v_log.streak) else streak end
   where id = h.id
  returning streak into v_streak;

  return json_build_object(
    'done', false, 'delta', v_moved, 'streak', v_streak,
    'xp', (select xp from profiles where id = p_user)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- freeze_habit_day — spend a streak freeze on a missed day from the last
-- week, the user's pick of which. The miss's -1 comes back, the day holds the
-- streak as it stood the day before (it doesn't grow, so neither does the
-- reward), and the run carries on through it, so every later day in that run
-- counts that much more (rewards already paid stand). Only a day with a
-- streak to keep is worth one; one out of freezes for its month is refused.
-- p_auto is settle_habits' safety net: any age of miss, nothing settled
-- first, and null instead of a refusal.
-- ---------------------------------------------------------------------------
drop function if exists freeze_habit_day(uuid, uuid, date);
create or replace function freeze_habit_day(p_user uuid, p_habit uuid, p_day date, p_auto boolean default false)
returns json
language plpgsql
as $$
declare
  v_today  date;
  v_streak integer;
  v_moved  integer;
  v_break  date;
  v_log    habit_log%rowtype;
  h        habits%rowtype;
begin
  if not p_auto then perform settle_habits(p_user); end if;

  select (now() at time zone coalesce(timezone, 'UTC'))::date into v_today
    from profiles where id = p_user;

  select * into h from habits where id = p_habit and user_id = p_user for update;
  if not found then raise exception 'Habit not found'; end if;

  select * into v_log from habit_log where habit_id = h.id and day = p_day for update;
  if not found or v_log.done or v_log.frozen or (p_day < v_today - 7 and not p_auto) then
    if p_auto then return null; end if;
    raise exception 'That day has closed — only a missed day from the last week can take a freeze.';
  end if;

  v_streak := coalesce((select l.streak from habit_log l
                         where l.habit_id = h.id and l.day < p_day
                         order by l.day desc limit 1), 0);
  if v_streak = 0 then
    if p_auto then return null; end if;
    raise exception 'That day had no streak to keep — a freeze would be wasted on it.';
  end if;
  if not use_streak_freeze(p_user, p_day) then
    if p_auto then return null; end if;
    raise exception 'That day''s month has no streak freezes left — more at the village store.';
  end if;

  v_moved := habit_move_xp(p_user, -v_log.xp,
               case when p_auto then 'streak freeze (auto): ' else 'streak freeze: ' end || h.title);

  update habit_log set frozen = true, chosen = false, xp = v_log.xp + v_moved, streak = v_streak
   where habit_id = h.id and day = p_day;

  select min(day) into v_break from habit_log
   where habit_id = h.id and day > p_day and not done and not frozen;

  update habit_log set streak = streak + v_streak
   where habit_id = h.id and day > p_day and (v_break is null or day < v_break);

  update habits set
    streak      = case when v_break is null then streak + v_streak else streak end,
    best_streak = greatest(best_streak,
                           (select max(streak) from habit_log where habit_id = h.id))
   where id = h.id
  returning streak into v_streak;

  return json_build_object(
    'done', false, 'delta', v_moved, 'streak', v_streak,
    'xp', (select xp from profiles where id = p_user)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_habit_day — make a closed day from the last week kept ('done'),
-- missed ('missed') or covered by a streak freeze ('frozen'), whatever it is
-- now. A kept day goes to frozen by way of a miss, in the same statement, so
-- if the freeze is refused the day stays kept.
-- ---------------------------------------------------------------------------
create or replace function set_habit_day(
  p_user  uuid,
  p_habit uuid,
  p_day   date,
  p_to    text,
  p_zone  text default null
) returns json
language plpgsql
as $$
declare
  v_today date;
  v_log   habit_log%rowtype;
  v_first json;
  v_res   json;
begin
  if p_zone is not null and exists (select 1 from pg_timezone_names where name = p_zone) then
    update profiles set timezone = p_zone
     where id = p_user and coalesce(timezone, '') <> p_zone;
  end if;

  select (now() at time zone coalesce(timezone, 'UTC'))::date into v_today
    from profiles where id = p_user;
  if p_day >= v_today then
    raise exception 'That day is still open — tick it in its box.';
  end if;

  select l.* into v_log from habit_log l join habits h on h.id = l.habit_id
   where l.habit_id = p_habit and h.user_id = p_user and l.day = p_day;
  if not found or p_day < v_today - 7 then
    raise exception 'That day has closed — only a day from the last week can be changed.';
  end if;

  if p_to = 'done' then
    if v_log.done then raise exception 'That day is already kept.'; end if;
    return redeem_habit_day(p_user, p_habit, p_day);
  elsif p_to = 'missed' then
    if not (v_log.done or v_log.frozen) then raise exception 'That day is already missed.'; end if;
    return miss_habit_day(p_user, p_habit, p_day);
  elsif p_to = 'frozen' then
    if v_log.frozen then raise exception 'That day is already frozen.'; end if;
    if v_log.done then v_first := miss_habit_day(p_user, p_habit, p_day); end if;
    v_res := freeze_habit_day(p_user, p_habit, p_day);
    if v_first is null then return v_res; end if;
    return json_build_object(
      'done', false,
      'delta', (v_first->>'delta')::integer + (v_res->>'delta')::integer,
      'streak', v_res->'streak', 'xp', v_res->'xp'
    );
  end if;
  raise exception 'That day can only be kept, missed or frozen.';
end;
$$;

-- ---------------------------------------------------------------------------
-- toggle_habit_day — tick or un-tick a day, which must be today in the
-- user's own timezone: the box closes at 23:59:59 local, and days to come
-- can't be ticked early. p_zone is the device's timezone, stored first so
-- "today" is always theirs. A closed day from the last week is changed with
-- set_habit_day instead; one sent here just flips between kept and missed.
-- (Past-day editing and its restreak_habit are gone.)
-- ---------------------------------------------------------------------------
drop function if exists toggle_habit_day(uuid, uuid, date);
drop function if exists restreak_habit(uuid, date, integer);
create or replace function toggle_habit_day(
  p_user  uuid,
  p_habit uuid,
  p_day   date,
  p_zone  text default null
) returns json
language plpgsql
as $$
declare
  v_today date;
begin
  if p_zone is not null and exists (select 1 from pg_timezone_names where name = p_zone) then
    update profiles set timezone = p_zone
     where id = p_user and coalesce(timezone, '') <> p_zone;
  end if;

  select (now() at time zone coalesce(timezone, 'UTC'))::date into v_today
    from profiles where id = p_user;

  if p_day is not null and p_day < v_today then
    if exists (select 1 from habit_log l join habits h on h.id = l.habit_id
                where l.habit_id = p_habit and h.user_id = p_user and l.day = p_day and l.done) then
      return miss_habit_day(p_user, p_habit, p_day);
    end if;
    return redeem_habit_day(p_user, p_habit, p_day);
  end if;
  if p_day is not null and p_day > v_today then
    raise exception 'That day hasn''t come yet — habits can only be ticked on the day.';
  end if;

  return toggle_habit(p_user, p_habit);
end;
$$;

-- ===========================================================================
-- Village
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- award_focus_xp — pays for whole 25-minute stretches a member has sat
-- through since last paid: +3, and +1 for everyone else at the table for any
-- of that stretch, up to +3 (6 with three or more for company). At most four
-- stretches a day are paid, in their own timezone, so working alone tops out
-- at 12 and company is worth more. Returns the XP just added.
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
  v_with     integer;
  v_from     timestamptz;
  v_before   integer;
begin
  select * into m from session_members where id = p_member for update;
  if not found then return 0; end if;

  v_rounds := floor(extract(epoch from (coalesce(m.left_at, m.last_seen) - m.joined_at)) / 1500)::integer;
  if v_rounds <= m.rounds_paid then return 0; end if;

  select coalesce((select name from pg_timezone_names where name = p.timezone), 'UTC')
    into v_zone from profiles p where p.id = m.user_id;
  v_zone := coalesce(v_zone, 'UTC');

  -- Stretches already paid today: one xp_events row each.
  select count(*)::integer into v_today from xp_events
   where user_id = m.user_id and reason like 'focus%'
     and (created_at at time zone v_zone)::date = (now() at time zone v_zone)::date;

  for i in (m.rounds_paid + 1)..v_rounds loop
    exit when v_today >= 4;
    -- Who else was at the table for any of this stretch.
    v_from := m.joined_at + (i - 1) * interval '25 minutes';
    select count(distinct o.user_id)::integer into v_with from session_members o
     where o.session_id = m.session_id and o.user_id <> m.user_id
       and o.joined_at < v_from + interval '25 minutes'
       and coalesce(o.left_at, o.last_seen) > v_from;
    v_amount := 3 + least(3, v_with);
    select xp into v_before from profiles where id = m.user_id for update;
    update profiles set xp = v_before + v_amount where id = m.user_id;
    insert into xp_events (user_id, todo_id, delta, reason)
    values (m.user_id, null, v_amount,
            case when v_with = 0 then 'focus round' else 'focus round, with ' || v_with end);
    v_today := v_today + 1;
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
