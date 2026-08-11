-- ===========================================================================
--  Migration 017 — smaller XP awards, a rank curve to match, and a reset
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
--  THE RESET
--  ---------
--  Every character above level 3 is set back to level 3, at the bottom of it —
--  50 XP, an empty bar. Ranks earned at the old prices were earned against a
--  different curve, and this is a deliberate clean slate rather than an attempt
--  to convert them.
--
--  This is the one thing here that cannot be undone: profiles.level is a ratchet
--  (migration 011) precisely so a level can never be lost, and this migration
--  reaches past that on purpose. There is no record of the old level other than
--  the xp_events row it writes, so read that before you decide you want it back.
--
--  Characters at or below level 3 keep their XP. Some of them still move up a
--  rank, because the curve came down beneath them — a bar that was nearly full
--  at the old prices is over the line at the new ones. Nobody ends up above 3.
--
--  Gear is left alone. Someone reset from 11 to 3 keeps wearing the plate they
--  are wearing today: saveEquipped() starts from the stored loadout and only
--  overwrites a slot when the requested item is within level, so nothing strips
--  it. They cannot *re*-select it once they switch that slot to something else,
--  which is the honest consequence of the reset — but their character does not
--  get undressed by a database migration either.
--
--  PAST QUESTS
--  -----------
--  A finished quest's xp_awarded is restated at the new prices, so the badge on
--  a completed quest reads what that quest is worth today (+10, +3 or +5) rather
--  than what it paid last week.
--
--  Anything not finished is zeroed. xp_awarded exists to stop a quest paying or
--  charging twice, and after the balances above are rewritten no quest has
--  "already moved" anything — so the baseline has to be nothing. Leaving a
--  failed quest at -10 would have been worth +13 to whoever completed it late,
--  refunding a penalty the reset had already wiped; zeroed, it pays the +3 it
--  should. Finished quests are the exception because they must keep a number to
--  display, and holding their award means toggling one nets zero rather than
--  paying out again.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The new awards. Mirrored in XP in src/lib/game.ts — change both.
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
-- 2. The new curve. Same numbers as RANKS in src/lib/game.ts — change both.
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
-- 3. Back to level 3.
--
--    Both the stored level and the level the new curve derives from their XP
--    are checked: a character sitting on 3050 XP would read as level 20 on the
--    new curve whatever its level column says, so clamping one without the
--    other would leave the two disagreeing — the exact split migration 011
--    exists to prevent.
--
--    One statement, so the ledger sees the balances as they were: every CTE
--    here reads the same snapshot, which is what lets `before` hold the old XP
--    while the update is already rewriting it. Re-running finds nothing above
--    level 3 and writes nothing.
-- ---------------------------------------------------------------------------
with before as (
  select id, xp as old_xp, level as old_level
    from profiles
   where greatest(level, level_for_xp(xp)) > 3
),
reset as (
  update profiles p
     set level = 3,
         xp    = xp_for_level(3)
    from before b
   where b.id = p.id
  returning p.id, p.xp as new_xp
)
insert into xp_events (user_id, todo_id, delta, reason)
select r.id, null::uuid, r.new_xp - b.old_xp,
       'reset to level 3 (was ' || b.old_level || ', ' || b.old_xp || ' XP)'
  from reset r
  join before b on b.id = r.id
 where r.new_xp <> b.old_xp;

-- ---------------------------------------------------------------------------
-- 4. Everyone else: line the level column up with the curve it is now read
--    against. This only ever raises it — the characters whose XP outran level 3
--    were all caught above — and greatest() keeps the ratchet honest for any row
--    whose stored level was somehow ahead of its XP.
-- ---------------------------------------------------------------------------
update profiles set level = greatest(level, level_for_xp(xp))
 where level <> greatest(level, level_for_xp(xp));

-- XP never sits below the floor of the earned level; that is what makes
-- level_for_xp(xp) and profiles.level agree everywhere else in the app.
update profiles set xp = xp_for_level(level) where xp < xp_for_level(level);

-- ---------------------------------------------------------------------------
-- 5. Re-price past quests: finished ones at today's award, everything else
--    back to a clean nothing. Idempotent because it compares each row against
--    what the rule says it should hold.
-- ---------------------------------------------------------------------------
update todos t
   set xp_awarded = case
         when t.status = 'done'
           then quest_target_xp(t.status, t.due_date, t.completed_at)
         else 0
       end
 where t.xp_awarded <> case
         when t.status = 'done'
           then quest_target_xp(t.status, t.due_date, t.completed_at)
         else 0
       end;

-- ---------------------------------------------------------------------------
-- 6. An earlier draft of this migration converted balances onto the new curve
--    instead of resetting them, and kept a snapshot table to do it. The reset
--    supersedes it; drop it if it is there.
-- ---------------------------------------------------------------------------
drop table if exists xp_rebalance_017_profiles;
