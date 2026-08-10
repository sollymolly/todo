-- ===========================================================================
--  Migration 008 — feedback, and the weekly updates popup
--
--  Run once in the Neon SQL Editor. Safe to re-run.
-- ===========================================================================

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
-- profiles.updates_seen — the week key (Monday, YYYY-MM-DD, UTC) of the last
-- changelog entry this person has been shown.
--
-- Deliberately `text` rather than `date`: the driver renders a `date` through
-- the session timezone, which turns "2026-08-10" into a timestamp seven hours
-- off and makes week comparisons lie. A plain string compares correctly and
-- means the same thing everywhere.
--
-- Existing accounts get null, so everyone sees the current entry once.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists updates_seen text;

-- ---------------------------------------------------------------------------
-- New accounts start already caught up: someone who has never used the app has
-- no reason to be handed a list of things that changed before they arrived.
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
