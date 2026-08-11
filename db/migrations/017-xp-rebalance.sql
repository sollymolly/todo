-- ===========================================================================
--  Migration 017 — smaller XP awards, and a rank curve to match
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  WHAT CHANGES
--  ------------
--  The awards shrink to numbers a person can hold in their head:
--
--                        before    after
--      no deadline         +5        +5     (unchanged)
--      on time            +25       +10
--      late                +8        +3
--      missed             -15       -10
--
--  The rank curve is divided by the same 2.5 and rounded to tens, so the game
--  is priced in *quests*, not XP, and the pace is exactly what it was: two
--  on-time quests to reach Wanderer, three more for Squire, and so on. Past
--  Living Legend a level costs 1000 instead of 2500 — a hundred on-time
--  quests, as before.
--
--  A missed deadline now costs one on-time quest rather than most of one, which
--  is the real point of the change: the penalty stings without wiping out a day.
--
--  WHY EXISTING BALANCES ARE REWRITTEN
--  -----------------------------------
--  Lowering the curve under characters who banked XP at the old rates would
--  hand out several levels at once, and profiles.level is a ratchet (migration
--  011) — those levels could never be taken back. So every character is moved
--  onto the new curve at the *same rank and the same position within it*: if
--  your bar was two thirds of the way to Knight, it still is. Nobody gains or
--  loses a level here, and no level-up is skipped.
--
--  todos.xp_awarded — what a quest has contributed, which is what stops a
--  penalty being charged or refunded twice — is restated at the new prices, the
--  same backfill migration 007 ran. Every quest is then worth what a quest of
--  its kind is worth today, so toggling one nets zero rather than farming the
--  gap between the two economies.
--
--  The profile rewrite works from a snapshot table whose rows are marked as
--  they are applied, which is what makes re-running this file a no-op — it
--  neither rebases twice nor rolls back XP earned since the first run. The
--  snapshot is also the only record of the old balances; drop it once you are
--  happy:
--    drop table xp_rebalance_017_profiles;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot, using the OLD curve — this must happen before ranks is touched.
--
--    `pct` is how far through the current rank the character was, 0 to 1. That
--    is the quantity worth preserving; the raw XP is an implementation detail
--    of the old prices. Stored as numeric so the position survives the trip.
--
--    `applied` is what makes step 4 safe to re-run: without it, a second run
--    would overwrite XP the character had earned in the meantime.
-- ---------------------------------------------------------------------------
create table if not exists xp_rebalance_017_profiles (
  id      uuid primary key references profiles(id) on delete cascade,
  old_xp  integer not null,
  level   integer not null,
  pct     numeric not null,
  applied boolean not null default false
);

insert into xp_rebalance_017_profiles (id, old_xp, level, pct)
select
  p.id,
  p.xp,
  p.level,
  case
    when xp_for_level(p.level + 1) > xp_for_level(p.level)
      then least(1, greatest(0,
        (p.xp - xp_for_level(p.level))::numeric
        / (xp_for_level(p.level + 1) - xp_for_level(p.level))))
    else 0
  end
from profiles p
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The new awards. Mirrored in XP in src/lib/game.ts — change both.
-- ---------------------------------------------------------------------------
create or replace function quest_xp(p_due timestamptz, p_done timestamptz)
returns integer language sql immutable as $$
  select case
    when p_due is null    then 5
    when p_done <= p_due  then 10
    else                       3
  end;
$$;

create or replace function quest_penalty()
returns integer language sql immutable as $$ select -10; $$;

-- ---------------------------------------------------------------------------
-- 3. The new curve. Same numbers as RANKS in src/lib/game.ts — change both.
-- ---------------------------------------------------------------------------
insert into ranks (level, xp) values
  (1, 0), (2, 20), (3, 50), (4, 100), (5, 170),
  (6, 260), (7, 380), (8, 530), (9, 720), (10, 950),
  (11, 1220), (12, 1540), (13, 1910), (14, 2340), (15, 2830),
  (16, 3380), (17, 4000), (18, 4690), (19, 5460), (20, 6310)
on conflict (level) do update set xp = excluded.xp;

-- Past the named ranks the curve stays linear, at 1000 a level.
create or replace function xp_for_level(p_level integer)
returns integer
language sql stable as $$
  select case
    when p_level <= 1 then 0
    else coalesce(
      (select r.xp from ranks r where r.level = p_level),
      (select max(r.xp) + (p_level - max(r.level)) * 1000 from ranks r)
    )
  end;
$$;

create or replace function level_for_xp(p_xp integer)
returns integer
language sql stable as $$
  with top as (select max(level) as level, max(xp) as xp from ranks)
  select case
    when p_xp >= (select xp from top)
      then (select level from top) + ((p_xp - (select xp from top)) / 1000)
    else coalesce((select max(r.level) from ranks r where r.xp <= p_xp), 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Move every character onto the new curve, rank and position intact.
--
--    Clamped one XP below the next threshold so rounding cannot promote
--    someone who had not actually finished the rank — a level-up belongs to a
--    completed quest, with the card that goes with it, not to a migration.
-- ---------------------------------------------------------------------------
do $$
begin
  update profiles p set xp = greatest(
    xp_for_level(s.level),
    least(
      xp_for_level(s.level + 1) - 1,
      xp_for_level(s.level)
        + round(s.pct * (xp_for_level(s.level + 1) - xp_for_level(s.level)))::integer
    )
  )
  from xp_rebalance_017_profiles s
  where s.id = p.id and not s.applied;

  -- The ledger is append-only, so the rebase is recorded rather than hidden.
  -- todo_id is null because no single quest caused it.
  insert into xp_events (user_id, todo_id, delta, reason)
  select p.id, null::uuid, p.xp - s.old_xp, 'xp rebalance'
    from profiles p
    join xp_rebalance_017_profiles s on s.id = p.id
   where not s.applied and p.xp <> s.old_xp;

  update xp_rebalance_017_profiles set applied = true where not applied;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Restate every quest's contribution at the new prices — the same backfill
--    migration 007 ran, and idempotent for the same reason: it compares each
--    row against what the current functions say it should be.
--
--    Doing this by rule rather than by scaling is what keeps a toggle honest.
--    A quest with no deadline is worth +5 today and was worth +5 before, so its
--    contribution must stay 5; had it been scaled with the rest, un-completing
--    it would have taken back less than completing it paid, forever.
-- ---------------------------------------------------------------------------
update todos t
   set xp_awarded = quest_target_xp(t.status, t.due_date, t.completed_at)
 where t.xp_awarded <> quest_target_xp(t.status, t.due_date, t.completed_at);

-- ---------------------------------------------------------------------------
-- 6. Belt and braces: the invariant migration 011 relies on is that XP never
--    sits below the floor of the earned level. Anything that slipped through
--    (a profile created between the snapshot and now, say) is lifted.
-- ---------------------------------------------------------------------------
update profiles set xp = xp_for_level(level) where xp < xp_for_level(level);
update profiles set level = level_for_xp(xp) where level_for_xp(xp) > level;
