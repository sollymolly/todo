-- ===========================================================================
--  Migration 016 — dyed armour, headgear and cloaks
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  Nothing here is required for the app to work. The chosen colour per slot
--  lives under `equipped -> 'dyes'`, and every read treats a missing key as
--  "no choice made", which falls back to the item's own default. This only
--  makes a profile read straight out of SQL look like one the app just wrote.
--
--  Dyes are not level-gated and cost nothing, so there is no column to add and
--  no counter to reconcile — a dye is an LPC ramp name, validated on write in
--  saveEquipped() against the ramps the equipped item's art can actually be
--  recoloured to.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The column default only applies to new rows, so it has to be restated.
-- ---------------------------------------------------------------------------
alter table profiles alter column equipped set default '{
  "torso": "rags",
  "weapon": "stick",
  "head": "none",
  "cape": "none",
  "offhand": "none",
  "dyes": {}
}'::jsonb;

-- ---------------------------------------------------------------------------
-- Existing characters have never picked a dye. Give them the empty object the
-- app writes, which renders exactly as they render today.
-- ---------------------------------------------------------------------------
update profiles
   set equipped = jsonb_set(equipped, '{dyes}', '{}'::jsonb)
 where not equipped ? 'dyes';
