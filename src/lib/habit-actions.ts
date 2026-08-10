"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/* --------------------------------------------------------------------------
   Habits: the recurring definitions, and the reconcile that keeps today's
   instances in step.

   Instances are ordinary todos, so nothing here touches XP — completing a
   habit runs the same complete_quest as any other quest. All this file does is
   define, list, and materialise.
   -------------------------------------------------------------------------- */

export type Cadence = "daily" | "weekdays" | "weekly";

export type Habit = {
  id: string;
  title: string;
  notes: string | null;
  category_id: string | null;
  cadence: Cadence;
  weekday: number;
  due_minutes: number;
  streak: number;
  best_streak: number;
  last_done_on: string | null;
  active: boolean;
  /** Whether today's instance is already ticked off. */
  done_today: boolean;
  /** Whether an instance exists for today at all (it may not be due). */
  due_today: boolean;
};

export type HabitResult = { ok: true } | { ok: false; error: string };

const CADENCES: Cadence[] = ["daily", "weekdays", "weekly"];
const MAX_HABITS = 40;

/**
 * Creates any missing instances for today and breaks streaks that lapsed.
 * Idempotent, so it runs on every dashboard load next to sweepOverdue.
 */
export async function syncHabits(): Promise<number> {
  const userId = await requireUserId();
  try {
    await sql`select break_stale_streaks(${userId}::uuid)`;
    const rows = (await sql`
      select materialise_habits(${userId}::uuid) as n
    `) as { n: number }[];
    return rows[0]?.n ?? 0;
  } catch {
    // A missing migration must not take the whole board down with it.
    return 0;
  }
}

export async function listHabits(): Promise<Habit[]> {
  const userId = await requireUserId();

  const rows = (await sql`
    select h.*,
           coalesce(t.status = 'done', false) as done_today,
           (t.id is not null)                 as due_today
      from habits h
      left join todos t
        on t.habit_id = h.id
       and (t.due_date at time zone coalesce(
              (select timezone from profiles where id = ${userId}::uuid), 'UTC'
            ))::date
           = (now() at time zone coalesce(
              (select timezone from profiles where id = ${userId}::uuid), 'UTC'
            ))::date
     where h.user_id = ${userId}::uuid
     order by h.active desc, h.streak desc, h.title
  `) as (Habit & Record<string, unknown>)[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    category_id: r.category_id,
    cadence: r.cadence,
    weekday: r.weekday,
    due_minutes: r.due_minutes,
    streak: r.streak,
    best_streak: r.best_streak,
    last_done_on: r.last_done_on ? String(r.last_done_on).slice(0, 10) : null,
    active: r.active,
    done_today: r.done_today,
    due_today: r.due_today,
  }));
}

export async function addHabit(input: {
  title: string;
  cadence: Cadence;
  weekday?: number;
  categoryId?: string | null;
  dueMinutes?: number;
}): Promise<HabitResult> {
  const userId = await requireUserId();

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the habit a name." };
  if (!CADENCES.includes(input.cadence))
    return { ok: false, error: "Pick how often it repeats." };

  const weekday = Math.min(7, Math.max(1, Math.trunc(input.weekday ?? 1)));
  const dueMinutes = Math.min(
    1439,
    Math.max(0, Math.trunc(input.dueMinutes ?? 1439))
  );

  try {
    const count = (await sql`
      select count(*)::int as n from habits where user_id = ${userId}::uuid
    `) as { n: number }[];
    if ((count[0]?.n ?? 0) >= MAX_HABITS)
      return { ok: false, error: `That's the limit of ${MAX_HABITS} habits.` };

    // Same ownership check the quest actions use: a category id from the client
    // is only accepted if it belongs to the caller.
    await sql`
      insert into habits (user_id, title, cadence, weekday, due_minutes, category_id)
      values (
        ${userId}::uuid,
        ${title.slice(0, 200)},
        ${input.cadence},
        ${weekday},
        ${dueMinutes},
        (select id from categories
          where id = ${input.categoryId || null}::uuid
            and user_id = ${userId}::uuid)
      )
    `;

    await syncHabits();
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[habits] add", e);
    return { ok: false, error: "Could not add that habit." };
  }
}

/** Pausing keeps the streak and the history; it just stops materialising. */
export async function setHabitActive(
  id: string,
  active: boolean
): Promise<HabitResult> {
  const userId = await requireUserId();
  try {
    await sql`
      update habits set active = ${active}
       where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
    if (active) await syncHabits();
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update that habit." };
  }
}

/**
 * Deleting a habit takes its outstanding instances with it (the foreign key
 * cascades), but finished ones are already history and stay counted.
 */
export async function deleteHabit(id: string): Promise<HabitResult> {
  const userId = await requireUserId();
  try {
    await sql`
      delete from habits where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete that habit." };
  }
}
