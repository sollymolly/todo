-- ===========================================================================
--  Migration 004 — deadline ordering, and categories without emoji icons
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  Nothing here is required for the app to work — it stopped reading both
--  columns in the same change. This clears the data they held so the tables
--  don't keep claiming something the UI no longer honours.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Quests are ordered by due_date now. `position` held a manual drag order that
-- always outranked the deadline, which is why editing a quest's date never
-- moved it. The column is left in place (dropping it is irreversible) but is
-- no longer written or read.
-- ---------------------------------------------------------------------------
update todos set position = null where position is not null;

-- ---------------------------------------------------------------------------
-- Categories are identified by name and colour; the emoji icon is gone from
-- the UI, so blank the stored values and stop handing out a default.
-- ---------------------------------------------------------------------------
alter table categories alter column icon set default '';

update categories set icon = '' where icon <> '';

-- ---------------------------------------------------------------------------
-- Optional: reclaim the columns entirely. Irreversible, so it's left commented
-- out — run these only if you're sure you won't want the data back.
-- ---------------------------------------------------------------------------
-- drop index if exists todos_position_idx;
-- alter table todos drop column if exists position;
-- alter table categories drop column if exists icon;
