-- ===========================================================================
--  Migration 025 — push notifications
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  THE MODEL
--  ---------
--  push_subscriptions  One row per device that said yes. The endpoint is the
--                      push service's address for that browser; the two keys
--                      encrypt what's sent to it. A device that's gone (the
--                      service answers 404/410) is deleted when found.
--
--  notification_prefs  What a person wants, for all their devices. No row
--                      means the defaults below.
--
--  notification_log    What's been sent, so the every-five-minutes job never
--                      sends the same thing twice. A deadline reminder is keyed
--                      by quest *and* deadline, so moving a deadline earns a
--                      fresh reminder; a morning summary by the local date.
--                      Rows older than a few days are pruned by the job.
-- ===========================================================================

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
  updated_at      timestamptz not null default now()
);

create table if not exists notification_log (
  user_id  uuid not null references users(id) on delete cascade,
  kind     text not null check (kind in ('due', 'morning')),
  ref      text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

create index if not exists notification_log_sent_idx on notification_log(sent_at);
