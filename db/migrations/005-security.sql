-- ===========================================================================
--  Migration 005 — security hardening
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  Run this one BEFORE deploying the matching code. Rate limiting fails open
--  if the table is missing, so nothing breaks either way — but until the table
--  exists, sign-in has no brute-force ceiling.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- rate_limits: one fixed window per bucket.
--
-- Verifying a password runs scrypt at ~16 MB and ~100 ms. Without a ceiling in
-- front of it, an unauthenticated attacker gets both a free password oracle
-- and cheap memory exhaustion against the server.
-- ---------------------------------------------------------------------------
create table if not exists rate_limits (
  bucket        text primary key,
  window_start  timestamptz not null default now(),
  hits          integer not null default 0
);

create index if not exists rate_limits_window_idx on rate_limits(window_start);

-- ---------------------------------------------------------------------------
-- New accounts have always been written as auth_version 2; the column default
-- still said 1, so any row created outside the app was born unable to sign in.
-- ---------------------------------------------------------------------------
alter table users alter column auth_version set default 2;

-- ---------------------------------------------------------------------------
-- friendships: the unique constraint only covered (requester, addressee), so
-- two people pressing "add" at the same instant could create both (A,B) and
-- (B,A). The application checks for that, but a check-then-insert is a race.
-- This index makes the pair unique whichever way round it is stored.
-- ---------------------------------------------------------------------------
create unique index if not exists friendships_pair_uniq
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- ---------------------------------------------------------------------------
-- Housekeeping for the limiter. Old windows are dead weight; drop anything
-- that hasn't been touched in a day. Re-run whenever, or leave it — the table
-- stays small on its own for a personal instance.
-- ---------------------------------------------------------------------------
delete from rate_limits where window_start < now() - interval '1 day';
