-- ===========================================================================
--  Migration 019 — abandon anything you haven't finished
--
--  Run once in the Neon SQL Editor. Safe to re-run. Needs 018.
--
--  WHAT CHANGES
--  ------------
--  Abandoning was only offered on an open quest with a deadline, which left the
--  two quests you most want rid of stuck to the board: the one whose deadline
--  went by (missed, still sitting there offering redemption) and the one you
--  wrote down without a date and are never going to do. Both can be abandoned
--  now. Only a finished quest cannot — it is already over.
--
--  WHAT IT COSTS
--  -------------
--  Never more than the -5, and never a refund:
--
--      open, dated or not   -5   the price of saying so
--      missed               0    the deadline already cost you -10
--
--  That second line is the whole point of using least() rather than charging a
--  flat -5. Reconciling to -5 would hand back 5 XP for giving up on a quest you
--  had already blown, making abandonment *cheaper* than the miss it follows —
--  so the winning move would be to abandon every missed quest on sight. Giving
--  up is allowed to be free once you have already paid; it is never profitable.
--
--  The miss is still recorded on archived_missed when the quest had a deadline,
--  which for a missed quest moves the fact from the row (about to be deleted)
--  onto the counter. No double count: both happen in the same transaction, and
--  the Strengths figure reads one or the other, never both.
-- ===========================================================================

create or replace function abandon_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo    todos%rowtype;
  v_before  integer;
  v_level   integer;
  v_floor   integer;
  v_target  integer;
  v_delta   integer;
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status = 'done' then
    raise exception 'Quest is already finished';
  end if;

  select xp, level into v_before, v_level from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  -- Whichever is worse for the character: the abandon penalty, or what this
  -- quest has already taken. Abandoning can cost XP, and can cost nothing, but
  -- it can never pay.
  v_floor   := xp_for_level(v_level);
  v_target  := least(quest_abandon_penalty(), v_todo.xp_awarded);
  v_delta   := v_target - v_todo.xp_awarded;
  v_applied := greatest(v_floor, v_before + v_delta) - v_before;

  update profiles set xp = v_before + v_applied
   where id = p_user
  returning xp into v_xp;

  if v_applied <> 0 then
    insert into xp_events (user_id, todo_id, delta, reason)
    values (p_user, p_todo, v_applied,
            'abandoned "' || left(v_todo.title, 60) || '"');
  end if;

  -- A quest with no deadline promised nothing, so it is left out of both sides
  -- of the Strengths figure rather than counted as a miss. The XP still goes:
  -- you did say you would do it.
  if v_todo.due_date is not null then
    update categories set archived_missed = archived_missed + 1
     where id = v_todo.category_id and user_id = p_user;
    update profiles set archived_missed = archived_missed + 1
     where id = p_user;
  end if;

  perform skip_habit_day(p_user, v_todo);

  delete from todos where id = p_todo and user_id = p_user;

  return json_build_object(
    'delta', v_applied, 'awarded', 0, 'xp', v_xp, 'reason', 'oath broken'
  );
end;
$$;
