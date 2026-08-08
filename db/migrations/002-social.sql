-- ===========================================================================
--  Migration 002 — friends, unique usernames, and end-to-end encrypted DMs
--
--  Run once in the Neon SQL Editor. Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- users: a unique handle, plus the key material for E2EE messaging.
--
--   public_key           SPKI, base64. Published to friends.
--   wrapped_private_key  PKCS8 encrypted with a key derived from the password
--                        in the browser. The server never sees the unwrapped
--                        key, and never sees the password under auth_version 2.
--   auth_version         1 = legacy (server received the raw password)
--                        2 = client derives an auth secret; raw password stays
--                            in the browser
-- ---------------------------------------------------------------------------
alter table users add column if not exists username            citext;
alter table users add column if not exists auth_version        integer not null default 1;
alter table users add column if not exists public_key          text;
alter table users add column if not exists wrapped_private_key text;

-- Backfill handles from the email local-part, de-duplicated with a suffix.
with candidate as (
  select
    id,
    regexp_replace(split_part(email::text, '@', 1), '[^a-zA-Z0-9_]', '', 'g') as base,
    row_number() over (
      partition by regexp_replace(split_part(email::text, '@', 1), '[^a-zA-Z0-9_]', '', 'g')
      order by created_at
    ) as rn
  from users
  where username is null
)
update users u
   set username = case when c.rn = 1 then c.base else c.base || c.rn::text end
  from candidate c
 where c.id = u.id;

-- Anything left blank (e.g. an email that was all punctuation) gets a fallback.
update users
   set username = 'adventurer' || substr(id::text, 1, 6)
 where username is null or trim(username::text) = '';

alter table users alter column username set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_username_key'
  ) then
    alter table users add constraint users_username_key unique (username);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- friendships: one row per pair, stored with the requester first.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- messages: ciphertext only. The server cannot read these.
--
-- `iv` and `body` are base64. `body` is AES-GCM output under a key derived by
-- ECDH between the two users' keypairs, so both ends decrypt the same row and
-- no second copy is needed.
-- ---------------------------------------------------------------------------
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
-- are_friends(a, b) — used to gate every social read.
-- ---------------------------------------------------------------------------
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
