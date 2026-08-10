-- ===========================================================================
--  Migration 006 — recorded agreement to the privacy policy
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  Run this BEFORE deploying the matching code. Existing accounts land on
--  privacy_version 0, which is what routes them through the consent gate on
--  their next request.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- users: the currently accepted version, denormalised for a cheap read at
-- sign-in. 0 means "has never agreed to anything", which is the correct
-- starting point for every account that predates this.
-- ---------------------------------------------------------------------------
alter table users add column if not exists privacy_version     integer not null default 0;
alter table users add column if not exists privacy_accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- policy_acceptances: the audit trail. Append-only by convention — one row per
-- act of agreement, never updated, so re-consenting to a new version leaves
-- the older record intact and the history stays readable.
--
-- Deliberately narrow. Demonstrating consent needs to answer "who, to which
-- version, and when", and the exact text of every version lives in git under
-- src/app/privacy. IP address and user agent are *not* recorded: they would be
-- a new category of personal data collected about people, retained
-- indefinitely, for a marginal gain in evidential weight on a personal app.
-- Collecting less is the more defensible reading of the policy this records.
-- ---------------------------------------------------------------------------
create table if not exists policy_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  version      integer not null,
  accepted_at  timestamptz not null default now()
);

create index if not exists policy_acceptances_user_idx
  on policy_acceptances(user_id, accepted_at desc);

-- One record per user per version: pressing the button twice is not two
-- separate acts of consent, and this keeps the trail honest.
create unique index if not exists policy_acceptances_once
  on policy_acceptances(user_id, version);
