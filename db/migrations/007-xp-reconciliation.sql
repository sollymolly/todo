-- ===========================================================================
--  Migration 007 — one-time XP per quest, and missed quests stay in the box
--
--  Run once in the Neon SQL Editor. Safe to re-run (the backfill is a no-op
--  the second time, because it only touches rows that disagree).
--
--  THE BUG
--  -------
--  XP was applied incrementally: each action added or subtracted a delta and
--  wrote the *last* delta into todos.xp_awarded. Undoing a completion set the
--  quest back to 'open' with its deadline still in the past, so the next page
--  load swept it and charged the -15 again. Complete-late then un-complete and
--  the penalty was paid twice; do it again and it was paid three times. One
--  quest in this database had four ledger entries summing to -30 for a single
--  missed deadline.
--
--  THE FIX
--  -------
--  Stop adding deltas and start reconciling. A quest's XP contribution is a
--  pure function of its state:
--
--      done    ->  quest_xp(due, completed_at)      +25 / +8 / +5
--      failed  ->  quest_penalty() if it had a deadline, else 0
--      open    ->  0
--
--  Every transition computes `target - already_applied` and moves only the
--  difference. Applying the same transition twice moves nothing the second
--  time, so a penalty can only ever be charged once and an award can only ever
--  be credited once, no matter how often the checkbox is toggled.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- What a quest should be contributing, given its current state.
-- ---------------------------------------------------------------------------
create or replace function quest_target_xp(
  p_status    text,
  p_due       timestamptz,
  p_completed timestamptz
) returns integer
language sql immutable as $$
  select case
    when p_status = 'done'   then quest_xp(p_due, coalesce(p_completed, p_due))
    when p_status = 'failed' then case when p_due is null then 0 else quest_penalty() end
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- What a quest's ledger says it has actually moved. Used only by the backfill;
-- from here on todos.xp_awarded carries the same number.
-- ---------------------------------------------------------------------------
create or replace function quest_applied_xp(p_todo uuid)
returns integer
language sql stable as $$
  select coalesce(sum(delta), 0)::integer from xp_events where todo_id = p_todo;
$$;

-- ===========================================================================
-- The single place a quest changes state. Every action below funnels through
-- it, which is what makes the accounting impossible to double up.
-- ===========================================================================
create or replace function quest_transition(
  p_user      uuid,
  p_todo      uuid,
  p_status    text,
  p_completed timestamptz,
  p_reason    text
) returns json
language plpgsql
as $$
declare
  v_todo    todos%rowtype;
  v_target  integer;
  v_delta   integer;
  v_before  integer;
  v_applied integer;
  v_xp      integer;
begin
  select * into v_todo from todos
    where id = p_todo and user_id = p_user
    for update;
  if not found then raise exception 'Quest not found'; end if;

  v_target := quest_target_xp(p_status, v_todo.due_date, p_completed);
  v_delta  := v_target - v_todo.xp_awarded;

  select xp into v_before from profiles where id = p_user for update;
  if v_before is null then raise exception 'Profile not found'; end if;

  -- XP is floored at zero, so a penalty bigger than the balance is only partly
  -- charged. Recording what actually *moved* rather than what was intended is
  -- what keeps this reconcilable: the next transition sees the true figure and
  -- corrects from there, instead of refunding XP that was never taken.
  v_applied := greatest(0, v_before + v_delta) - v_before;

  update todos set
    status       = p_status,
    completed_at = p_completed,
    xp_awarded   = v_todo.xp_awarded + v_applied
  where id = p_todo;

  update profiles set xp = v_before + v_applied
   where id = p_user
  returning xp into v_xp;

  -- A no-op transition leaves no trace, so the ledger stays readable.
  if v_applied <> 0 then
    insert into xp_events (user_id, todo_id, delta, reason)
    values (p_user, p_todo, v_applied, p_reason);
  end if;

  -- `delta` is what just moved (what to celebrate); `awarded` is the quest's
  -- running total (what the row should display).
  return json_build_object(
    'delta', v_applied, 'awarded', v_todo.xp_awarded + v_applied,
    'xp', v_xp, 'reason', p_reason
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_quest — works from 'open' *or* 'failed'. Completing a missed quest
-- refunds the penalty and pays the late award in one move; redemption is
-- always available and is worth exactly the same as any other late finish.
-- ---------------------------------------------------------------------------
create or replace function complete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo   todos%rowtype;
  v_now    timestamptz := now();
  v_reason text;
begin
  select * into v_todo from todos where id = p_todo and user_id = p_user;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status = 'done' then raise exception 'Quest already completed'; end if;

  v_reason := case
    when v_todo.due_date is null  then 'completed (no deadline)'
    when v_now <= v_todo.due_date then 'completed on time'
    else                               'completed late'
  end;

  return quest_transition(p_user, p_todo, 'done', v_now, v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- uncomplete_quest — puts the quest back exactly where it would have been had
-- it never been completed: missed if the deadline is already past the grace
-- period, open otherwise.
--
-- Going straight to 'failed' matters. Returning it to 'open' with a long-past
-- deadline is what caused the double charge: the refund landed immediately and
-- the penalty came back on the next page load, reading as XP vanishing twice.
-- ---------------------------------------------------------------------------
create or replace function uncomplete_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo   todos%rowtype;
  v_status text;
begin
  select * into v_todo from todos where id = p_todo and user_id = p_user;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'done' then raise exception 'Quest is not completed'; end if;

  v_status := case
    when v_todo.due_date is not null
     and v_todo.due_date < now() - interval '24 hours' then 'failed'
    else 'open'
  end;

  return quest_transition(p_user, p_todo, v_status, null, 'undid a completion');
end;
$$;

-- ---------------------------------------------------------------------------
-- abandon_quest — give up on a deadline by hand.
-- ---------------------------------------------------------------------------
create or replace function abandon_quest(p_user uuid, p_todo uuid)
returns json
language plpgsql
as $$
declare
  v_todo todos%rowtype;
begin
  select * into v_todo from todos where id = p_todo and user_id = p_user;
  if not found then raise exception 'Quest not found'; end if;
  if v_todo.status <> 'open' then raise exception 'Quest is not open'; end if;

  return quest_transition(p_user, p_todo, 'failed', null, 'abandoned the quest');
end;
$$;

-- ---------------------------------------------------------------------------
-- sweep_overdue — auto-fail anything more than 24h past its deadline.
--
-- Only picks status = 'open', so an already-missed quest is never re-swept.
-- Even if it were, the transition would move zero XP.
-- ---------------------------------------------------------------------------
create or replace function sweep_overdue(p_user uuid)
returns json
language plpgsql
as $$
declare
  v_ids   uuid[];
  v_id    uuid;
  v_res   json;
  v_count integer := 0;
  v_total integer := 0;
  v_xp    integer;
begin
  select array_agg(id) into v_ids
    from todos
   where user_id  = p_user
     and status   = 'open'
     and due_date is not null
     and due_date < now() - interval '24 hours';

  if v_ids is null then
    select xp into v_xp from profiles where id = p_user;
    return json_build_object('count', 0, 'delta', 0, 'xp', coalesce(v_xp, 0));
  end if;

  foreach v_id in array v_ids loop
    v_res   := quest_transition(p_user, v_id, 'failed', null, 'deadline passed');
    v_count := v_count + 1;
    v_total := v_total + (v_res ->> 'delta')::integer;
  end loop;

  select xp into v_xp from profiles where id = p_user;
  return json_build_object('count', v_count, 'delta', v_total, 'xp', coalesce(v_xp, 0));
end;
$$;

-- ===========================================================================
-- Backfill. Three statements, and the order matters: both of the first two
-- read the pre-correction ledger, so the correcting events must be written
-- *after* the balances are adjusted, not before.
-- ===========================================================================

-- 1. Give back (or take) the difference between what each quest should have
--    contributed and what it actually did. This is where a doubly-charged
--    penalty is refunded.
update profiles p
   set xp = greatest(0, p.xp + d.total)
  from (
    select t.user_id,
           sum(quest_target_xp(t.status, t.due_date, t.completed_at)
               - quest_applied_xp(t.id))::integer as total
      from todos t
     group by t.user_id
  ) d
 where d.user_id = p.id
   and d.total <> 0;

-- 2. Record the correction, so profiles.xp still equals the sum of the ledger.
insert into xp_events (user_id, todo_id, delta, reason)
select t.user_id,
       t.id,
       quest_target_xp(t.status, t.due_date, t.completed_at) - quest_applied_xp(t.id),
       'ledger correction'
  from todos t
 where quest_target_xp(t.status, t.due_date, t.completed_at) <> quest_applied_xp(t.id);

-- 3. Restate every quest's contribution under the new meaning of xp_awarded:
--    the net XP this quest has moved, not the size of the last change to it.
update todos t
   set xp_awarded = quest_target_xp(t.status, t.due_date, t.completed_at)
 where t.xp_awarded <> quest_target_xp(t.status, t.due_date, t.completed_at);
