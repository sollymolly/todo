-- ===========================================================================
--  Migration 010 — retire the duplicate skin tone
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  "Porcelain" and "Fair" were two swatches that produced one face: both
--  resolved to LPC's `light` body ramp, so picking between them changed
--  nothing on screen. Porcelain is gone from the catalogue.
--
--  Nobody's character changes appearance. These profiles were already being
--  drawn with the `light` ramp, which is exactly what Fair uses — this only
--  makes the stored value match a tone that still exists.
-- ===========================================================================

update profiles
   set appearance = jsonb_set(appearance, '{skin}', '"fair"')
 where appearance ->> 'skin' = 'porcelain';

-- Anything else unrecognised also lands on Fair, matching the validation in
-- saveAppearance() so a profile read straight out of SQL agrees with the app.
update profiles
   set appearance = jsonb_set(appearance, '{skin}', '"fair"')
 where coalesce(appearance ->> 'skin', '') not in
       ('fair', 'tan', 'olive', 'bronze', 'deep', 'ebony');

-- The column default still named the retired tone.
alter table profiles alter column appearance set default '{
  "body": "male",
  "skin": "fair",
  "hair": "tousled",
  "hairColor": "chestnut",
  "eyes": "blue"
}'::jsonb;
