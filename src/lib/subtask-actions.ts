"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { MAX_STEPS } from "@/lib/game";
import type { Subtask } from "@/lib/types";

/* --------------------------------------------------------------------------
   Steps within a quest.

   Nothing here touches XP, and that is the point — see migration 015. A step is
   a title and a tick. The quest keeps its single award.

   Same rule as actions.ts: every statement is scoped by user_id. Never drop the
   `and user_id = ${userId}` clause from a query in this file.
   -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubtaskResult =
  | { ok: true; subtask: Subtask }
  | { ok: false; error: string };

function row(r: Record<string, unknown>): Subtask {
  return {
    id: String(r.id),
    todo_id: String(r.todo_id),
    title: String(r.title),
    done: Boolean(r.done),
    position: Number(r.position),
  };
}

/**
 * Appends a step. add_subtask() does the ownership check, the blank-title check
 * and the cap in one statement, so an empty result means one of the three
 * failed rather than that something went wrong.
 */
export async function addSubtask(
  todoId: string,
  title: string
): Promise<SubtaskResult> {
  const userId = await requireUserId();
  // Guarded before the cast so a malformed id can't come back as a Postgres
  // error message.
  if (!UUID.test(todoId)) return { ok: false, error: "Unknown quest." };

  const clean = title.trim().slice(0, 200);
  if (!clean) return { ok: false, error: "Give the step a name." };

  try {
    const rows = (await sql`
      select * from add_subtask(${userId}::uuid, ${todoId}::uuid, ${clean})
    `) as Record<string, unknown>[];

    if (!rows[0])
      return { ok: false, error: `A quest holds at most ${MAX_STEPS} steps.` };

    revalidatePath("/");
    return { ok: true, subtask: row(rows[0]) };
  } catch (e) {
    console.error("[subtasks] add", e);
    return { ok: false, error: "Could not add that step." };
  }
}

export async function setSubtaskDone(
  id: string,
  done: boolean
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  if (!UUID.test(id)) return { ok: false };

  try {
    await sql`
      update subtasks set done = ${done}
       where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[subtasks] toggle", e);
    return { ok: false };
  }
}

export async function deleteSubtask(id: string): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  if (!UUID.test(id)) return { ok: false };

  try {
    await sql`
      delete from subtasks
       where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[subtasks] delete", e);
    return { ok: false };
  }
}
