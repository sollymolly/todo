-- ===========================================================================
--  Migration 003 — body type, and eye colour replacing eye "style"
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  Neither change strictly breaks an existing database: the app merges every
--  appearance over its defaults on read, and rejects unknown values on write.
--  This just makes the stored rows agree with the catalogue so a profile read
--  straight out of SQL isn't misleading.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The column default only applies to new rows, so it has to be restated.
-- ---------------------------------------------------------------------------
alter table profiles alter column appearance set default '{
  "body": "male",
  "skin": "fair",
  "hair": "tousled",
  "hairColor": "chestnut",
  "eyes": "blue"
}'::jsonb;

-- ---------------------------------------------------------------------------
-- Existing characters predate the body choice — give them the old default,
-- which is what they have been rendering as all along.
-- ---------------------------------------------------------------------------
update profiles
   set appearance = jsonb_set(appearance, '{body}', '"male"')
 where not appearance ? 'body';

-- ---------------------------------------------------------------------------
-- Eyes used to be a style name ("bright", "sleepy", "fierce", "sparkle") with
-- no art behind it. They are now LPC colour sheets. Anything that isn't one of
-- the eight becomes "blue", which is what the head sheet already draws.
-- ---------------------------------------------------------------------------
update profiles
   set appearance = jsonb_set(appearance, '{eyes}', '"blue"')
 where coalesce(appearance ->> 'eyes', '') not in
       ('blue', 'brown', 'gray', 'green', 'orange', 'purple', 'red', 'yellow');
