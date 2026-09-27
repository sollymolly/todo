-- ===========================================================================
--  Migration 020 — quests can be dragged into any order again
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  WHAT CHANGES
--  ------------
--  Migration 004 stopped reading todos.position because a stored position
--  always outranked the deadline, so editing a quest's date never moved it.
--  Manual order is back, with that problem designed out rather than accepted:
--
--    * Dragging a quest renumbers the whole box it lands in, in the order it
--      was shown (placeTodo).
--    * A quest with no position — new, today's habit instance, or one whose
--      deadline or category was just edited — is slotted in by deadline among
--      the placed ones (boardOrder in CategoryBoard.tsx).
--    * Editing a quest's deadline or category clears its position (updateTodo),
--      so it lands where the new date says.
--
--  The column was only nulled, never dropped, unless someone ran 004's
--  optional clean-up. This puts it back in that case; otherwise it's a no-op.
-- ===========================================================================

alter table todos add column if not exists position double precision;

create index if not exists todos_position_idx on todos(user_id, position);
