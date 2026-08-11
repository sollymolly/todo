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
--  BALANCES
--  --------
--  Every balance is divided by the same 2.5 as the awards, which is what keeps
--  a character exactly where it stood: the curve moved by that factor too, so
--  50 XP of 130 towards Squire becomes 20 of 50 towards Squire. Rounding is
--  never allowed to cost a rank — a balance that lands a hair under its own
--  floor is lifted back to it.
--
--  Leaving those balances alone was the alternative, and it inverts the board:
--  98 XP earned at 25 a quest is level 3 on a curve where Squire costs 50, so
--  the character sitting below the cap would vault over the two being reset
--  down to it. Dividing everything by one number avoids having to reason about
--  that at all.
--
--  THE RESET
--  ---------
--  Then every character still above level 3 is set back to level 3, at the
--  bottom of it — 50 XP, an empty bar.
--
--  This is the one thing here that cannot be undone: profiles.level is a ratchet
--  (migration 011) precisely so a level can never be lost, and this migration
--  reaches past that on purpose. There is no record of the old level other than
--  the xp_events row it writes, so read that before you decide you want it back.
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
-- 3. Re-price every balance, then cap at level 3.
--
--    `kept` is the divided balance, lifted to the floor of the rank the
--    character had already earned so that rounding cannot demote anyone: the
--    thresholds were rounded to tens, and a couple of them rounded up, which is
--    enough to leave an exactly-on-the-line balance one XP short of its own
--    rank.
--
--    The cap reads the level off `kept` rather than off the level column,
--    because the new curve derives a level from XP whatever the column says —
--    XPBar does exactly that — so capping one without the other would leave the
--    two disagreeing, the precise split migration 011 exists to prevent.
--
--    One statement, so the ledger sees the balances as they were: every CTE
--    here reads the same snapshot, which is what lets `before` hold the old
--    numbers while the update is already overwriting them.
--
--    This is the one step here that is not safe to repeat — dividing an already
--    divided balance would quietly halve it again — so unlike everything else in
--    this file it is guarded by a marker rather than by being idempotent. The
--    marker row is written in the same statement as the work, so the two cannot
--    come apart.
-- ---------------------------------------------------------------------------
create table if not exists xp_rebalance_017 (
  applied_at timestamptz primary key default now()
);

do $$
begin
  if exists (select 1 from xp_rebalance_017) then
    raise notice 'migration 017 has already re-priced balances — skipping step 3';
    return;
  end if;

  with before as (
    select
      id,
      xp    as old_xp,
      level as old_level,
      greatest(round(xp / 2.5)::integer, xp_for_level(level)) as kept
    from profiles
  ),
  priced as (
    select
      id, old_xp, old_level,
      level_for_xp(kept) > 3 as capped,
      case when level_for_xp(kept) > 3 then xp_for_level(3) else kept end as new_xp,
      case when level_for_xp(kept) > 3 then 3 else level_for_xp(kept) end as new_level
    from before
  ),
  written as (
    update profiles p
       set xp    = q.new_xp,
           level = q.new_level
      from priced q
     where q.id = p.id
       and (p.xp <> q.new_xp or p.level <> q.new_level)
    returning p.id
  )
  insert into xp_events (user_id, todo_id, delta, reason)
  select
    q.id, null::uuid, q.new_xp - q.old_xp,
    case when q.capped
      then 'reset to level 3 (was ' || q.old_level || ', ' || q.old_xp || ' XP)'
      else 'rebalanced to the new XP prices (was ' || q.old_xp || ' XP)'
    end
  from written w
  join priced q on q.id = w.id
  where q.new_xp <> q.old_xp;

  insert into xp_rebalance_017 default values;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Re-price past quests: finished ones at today's award, everything else
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
-- 5. An earlier draft of this migration converted balances onto the new curve
--    without a cap, and kept a per-profile snapshot table to do it. Step 3
--    supersedes it; drop it if it is there.
-- ---------------------------------------------------------------------------
drop table if exists xp_rebalance_017_profiles;
