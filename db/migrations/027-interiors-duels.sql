-- ===========================================================================
--  Migration 027 — inside houses, talking in shared spaces, and duels
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  INTERIORS
--  ---------
--  A house's inside is one layout, the same for everyone who walks in, so
--  unlike the village outside (different for every viewer) a room is a real
--  shared space: presence there carries a position. The owner decorates it:
--  wallpaper, floor, and furniture on a grid, kept as one jsonb document on
--  the house. Null means the default room for the house's size.
--
--  SPACES AND TALK
--  ---------------
--  People in the same space — inside the same house, in the arena, at the
--  town hall — can talk. Lines are short, plain text, and deleted after an
--  hour: this is saying something out loud, not messaging (that's encrypted,
--  and stays in /friends).
--
--  DUELS
--  -----
--  Two companions in the arena can duel. Each round both pick a move at once
--  — strike, guard or feint — and the round resolves when both have picked
--  or its time runs out. Gear sets each side's numbers when the duel starts.
--  No XP changes hands; wins and losses are just a record.
-- ===========================================================================

/* Presence can now be inside a house or in the arena, with a position there. */
alter table village_presence drop constraint if exists village_presence_place_check;
alter table village_presence add constraint village_presence_place_check
  check (place in ('home', 'square', 'hall', 'house', 'inside', 'arena'));
alter table village_presence add column if not exists x real;
alter table village_presence add column if not exists y real;
alter table village_presence add column if not exists facing smallint;

alter table houses add column if not exists interior jsonb;

create table if not exists space_chat (
  id         uuid primary key default gen_random_uuid(),
  /* 'inside:<owner id>', 'arena' or 'hall' */
  space      text not null check (length(space) <= 60),
  author_id  uuid not null references users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 140),
  created_at timestamptz not null default now()
);

create index if not exists space_chat_space_idx on space_chat(space, created_at desc);

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

create index if not exists duels_open_idx on duels(status) where status in ('pending', 'active');
create index if not exists duels_a_idx on duels(a_id, created_at desc);
create index if not exists duels_b_idx on duels(b_id, created_at desc);
