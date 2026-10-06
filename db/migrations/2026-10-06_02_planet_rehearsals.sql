-- A planet's weekly rehearsals, set by its owner in the app (src/lib/planet-actions.ts).
-- Everyone on the planet is reminded 15 minutes before; the reminders need
-- 2026-10-06_03_rehearsal_reminders.sql too. Safe to re-run.

begin;

create table if not exists planet_rehearsals (
  id         serial primary key,
  planet_id  integer not null references planets(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  minute     smallint not null check (minute between 0 and 1439),
  tz         text not null default 'UTC' check (length(tz) <= 64),
  label      text not null default 'Rehearsal' check (length(label) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists planet_rehearsals_planet_idx on planet_rehearsals(planet_id);

commit;
