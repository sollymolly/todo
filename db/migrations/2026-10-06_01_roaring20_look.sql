-- Roaring 20's look: a planet look nobody picks for themselves
-- (world.ts, SPECIAL_LOOKS). Allowed in planets.look, and on one planet at most.
-- Safe to re-run.

begin;

alter table planets drop constraint if exists planets_look_check;
alter table planets add constraint planets_look_check
  check (look in ('dust', 'moon', 'nebula', 'glacier', 'roaring20'));

create unique index if not exists planets_special_look_key on planets(look) where look in ('roaring20');

commit;
