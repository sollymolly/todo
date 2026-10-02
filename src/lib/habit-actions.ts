"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { EVERY_DAY, type Habit, type HabitDay } from "@/lib/habits";

export type { Habit };

/* --------------------------------------------------------------------------
   Habits: the recurring definitions, and a daily log of ticks and misses.

   A habit never puts anything on the quest board. Today is
   ticked straight from the Habits grid; any due day that ends without a tick
   is settled as a miss by settle_habits, which is also what charges it.
   -------------------------------------------------------------------------- */

export type HabitResult = { ok: true } | { ok: false; error: string };

export type HabitBoard = {
  /** The caller's local date, YYYY-MM-DD. */
  today: string;
  /** The timezone stored on the profile, which "today" was measured in. */
  zone: string | null;
  /** Streak freezes left this month, shared by every habit. */
  freezes: number;
  habits: Habit[];
};

export type HabitTick =
  | {
      ok: true;
      done: boolean;
      /** Everything that moved on the profile — also today's reward. */
      delta: number;
      streak: number;
      xp: number;
    }
  | { ok: false; error: string };

const MAX_HABITS = 40;

/** How far back the grid can page. */
const HISTORY_DAYS = 180;

/** Only real ISO weekdays, deduped and sorted; at least one. */
function cleanDays(days: number[]): number[] | null {
  const d = [...new Set(days.map((n) => Math.trunc(n)))]
    .filter((n) => n >= 1 && n <= 7)
    .sort((a, b) => a - b);
  return d.length ? d : null;
}

/**
 * Settles every due day that has ended without a tick: -1 XP and the streak
 * resets. A streak freeze is only spent where the user puts one (setHabitDay).
 * Idempotent, so it runs on every load next to sweepOverdue.
 * Returns the XP it moved (zero or negative).
 */
export async function syncHabits(): Promise<number> {
  const userId = await requireUserId();
  try {
    const rows = (await sql`
      select settle_habits(${userId}::uuid) as n
    `) as { n: number }[];
    return rows[0]?.n ?? 0;
  } catch {
    // An out-of-date database must not take the whole board down with it.
    return 0;
  }
}

/** A date column as YYYY-MM-DD, whether the driver sent a Date or a string. */
function isoDay(v: unknown): string | null {
  if (!v) return null;
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}

export async function listHabits(): Promise<HabitBoard> {
  const userId = await requireUserId();

  const [meRows, rows, logs] = await Promise.all([
    sql`
      select (now() at time zone coalesce(timezone, 'UTC'))::date::text as today,
             timezone as zone,
             streak_freezes_left(id, (now() at time zone coalesce(timezone, 'UTC'))::date)
               as freezes
        from profiles where id = ${userId}::uuid
    `,
    sql`
      with me as (
        select (now() at time zone coalesce(timezone, 'UTC'))::date as today,
               coalesce(timezone, 'UTC') as zone
          from profiles where id = ${userId}::uuid
      )
      select h.*,
             (h.created_at at time zone me.zone)::date::text as created_on,
             (select count(*)::int from habit_log l where l.habit_id = h.id) as logged,
             exists (select 1 from habit_log l
                      where l.habit_id = h.id and l.day = me.today and l.done) as done_today,
             is_habit_due(h.days, me.today) as scheduled_today,
             -- Today's own tick doesn't count against the limit, or ticking
             -- the last occurrence would lock it the moment it was done.
             habit_over(
               h.ends_on, h.occurrences_limit,
               (select count(*)::int from habit_log l
                 where l.habit_id = h.id and l.day < me.today),
               me.today
             ) as finished
        from habits h, me
       where h.user_id = ${userId}::uuid
       order by h.active desc, h.created_at
    `,
    sql`
      select habit_id, day::text as day, done, frozen, xp, chosen
        from habit_log
       where user_id = ${userId}::uuid
         and day > current_date - ${HISTORY_DAYS}::int
    `,
  ]);

  const byHabit: Record<string, Record<string, HabitDay>> = {};
  for (const l of logs as (HabitDay & { habit_id: string; day: string })[])
    (byHabit[l.habit_id] ??= {})[l.day] = { done: l.done, frozen: l.frozen, xp: l.xp, chosen: l.chosen };

  const me = (meRows as { today: string; zone: string | null; freezes: number }[])[0];
  const today = me?.today ?? new Date().toISOString().slice(0, 10);

  return {
    today,
    zone: me?.zone ?? null,
    freezes: me?.freezes ?? 2,
    habits: (rows as Record<string, unknown>[]).map((r) => {
      const finished = r.finished as boolean;
      return {
        id: r.id as string,
        title: r.title as string,
        notes: r.notes as string | null,
        days: (r.days ?? EVERY_DAY) as number[],
        streak: r.streak as number,
        best_streak: r.best_streak as number,
        active: r.active as boolean,
        created_on: r.created_on as string,
        ends_on: isoDay(r.ends_on),
        occurrences_limit: r.occurrences_limit as number | null,
        occurrences_made: r.logged as number,
        finished,
        due_today: (r.active as boolean) && (r.scheduled_today as boolean) && !finished,
        done_today: r.done_today as boolean,
        log: byHabit[r.id as string] ?? {},
      };
    }),
  };
}

/**
 * Ticks today, or un-ticks it. `day` is the day the grid thinks is today; the
 * server refuses it once that day has ended in the user's timezone (the box
 * closes at 23:59:59 local) or if it hasn't begun. `zone` is the device's
 * timezone, stored before the toggle so "today" is always the user's own.
 */
export async function toggleHabit(
  id: string,
  day: string,
  zone?: string
): Promise<HabitTick> {
  const userId = await requireUserId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "Could not update that habit." };
  const tz = zone && /^[A-Za-z0-9+_\-/]{1,64}$/.test(zone) ? zone : null;
  try {
    const rows = (await sql`
      select toggle_habit_day(${userId}::uuid, ${id}::uuid, ${day}::date, ${tz}::text) as result
    `) as {
      result: { done: boolean; delta: number; streak: number; xp: number };
    }[];
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true, ...rows[0].result };
  } catch (e) {
    // The function's own exceptions are written for people; anything else
    // isn't worth showing.
    const msg = e instanceof Error ? e.message : "";
    if (/toggle_habit_day.* does not exist/i.test(msg))
      return { ok: false, error: "Run db/schema.sql to tick habits." };
    return {
      ok: false,
      error: /^That (habit|day)/.test(msg) ? msg : "Could not update that habit.",
    };
  }
}

/** What a closed day can be made into. */
export type DayState = "done" | "missed" | "frozen";

/**
 * Changes a closed day from the last week: ticks it late, marks it missed,
 * or spends a streak freeze on it (the user's choice of which miss gets one).
 * `done` in the result is whether the day ends up kept.
 */
export async function setHabitDay(
  id: string,
  day: string,
  to: DayState,
  zone?: string
): Promise<HabitTick> {
  const userId = await requireUserId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !["done", "missed", "frozen"].includes(to))
    return { ok: false, error: "Could not update that habit." };
  const tz = zone && /^[A-Za-z0-9+_\-/]{1,64}$/.test(zone) ? zone : null;
  try {
    const rows = (await sql`
      select set_habit_day(${userId}::uuid, ${id}::uuid, ${day}::date, ${to}, ${tz}::text) as result
    `) as {
      result: { done: boolean; delta: number; streak: number; xp: number };
    }[];
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true, ...rows[0].result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/set_habit_day.* does not exist/i.test(msg))
      return { ok: false, error: "Run db/schema.sql to change past days." };
    return {
      ok: false,
      error: /^That (habit|day)/.test(msg) ? msg : "Could not update that habit.",
    };
  }
}

export type HabitInput = {
  title: string;
  /** ISO weekdays it runs on, Monday = 1. */
  days: number[];
  /** Last date an occurrence may appear, YYYY-MM-DD. */
  endsOn?: string | null;
  /** Total number of occurrences before it stops. */
  occurrencesLimit?: number | null;
};

/** The checked, normalised form of a HabitInput, or what's wrong with it. */
function cleanInput(
  input: HabitInput
):
  | { ok: true; title: string; days: number[]; endsOn: string | null; limit: number | null }
  | { ok: false; error: string } {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the habit a name." };

  const days = cleanDays(input.days ?? []);
  if (!days) return { ok: false, error: "Pick at least one day." };

  const endsOn =
    input.endsOn && /^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) ? input.endsOn : null;

  // A limit of zero would create a habit that never appears, which reads as a
  // bug rather than a choice.
  const limit =
    input.occurrencesLimit && input.occurrencesLimit > 0
      ? Math.min(3650, Math.trunc(input.occurrencesLimit))
      : null;

  return { ok: true, title, days, endsOn, limit };
}

export async function addHabit(input: HabitInput): Promise<HabitResult> {
  const userId = await requireUserId();

  const clean = cleanInput(input);
  if (!clean.ok) return clean;
  const { title, days, endsOn, limit } = clean;

  try {
    const count = (await sql`
      select count(*)::int as n from habits where user_id = ${userId}::uuid
    `) as { n: number }[];
    if ((count[0]?.n ?? 0) >= MAX_HABITS)
      return { ok: false, error: `That's the limit of ${MAX_HABITS} habits.` };

    // settled_through starts at yesterday: a habit made today owes nothing
    // for the days before it existed.
    await sql`
      insert into habits
        (user_id, title, days, ends_on, occurrences_limit, settled_through)
      values (
        ${userId}::uuid,
        ${title},
        ${days}::integer[],
        ${endsOn}::date,
        ${limit},
        (select (now() at time zone coalesce(timezone, 'UTC'))::date - 1
           from profiles where id = ${userId}::uuid)
      )
    `;

    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[habits] add", e);
    return { ok: false, error: "Could not add that habit." };
  }
}

/**
 * Changes a habit's name, schedule or ending. Days already over are settled
 * first, under the schedule they had, so an edit only shapes what's to come:
 * the history, the streak and the XP already moved stay as they are.
 */
export async function updateHabit(id: string, input: HabitInput): Promise<HabitResult> {
  const userId = await requireUserId();

  const clean = cleanInput(input);
  if (!clean.ok) return clean;
  const { title, days, endsOn, limit } = clean;

  try {
    await syncHabits();
    await sql`
      update habits set
        title             = ${title},
        days              = ${days}::integer[],
        ends_on           = ${endsOn}::date,
        occurrences_limit = ${limit}
       where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[habits] update", e);
    return { ok: false, error: "Could not save that habit." };
  }
}

/**
 * Pausing keeps the streak and the history; paused days are neither due nor
 * missed. Days before the pause are settled first, and resuming moves the
 * settled mark up to yesterday so the pause itself costs nothing.
 */
export async function setHabitActive(
  id: string,
  active: boolean
): Promise<HabitResult> {
  const userId = await requireUserId();
  try {
    await syncHabits();
    await sql`
      update habits set
        settled_through = case
          when ${active} and not active then greatest(
            settled_through,
            (select (now() at time zone coalesce(timezone, 'UTC'))::date - 1
               from profiles where id = ${userId}::uuid)
          )
          else settled_through
        end,
        active = ${active}
       where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
    revalidatePath("/habits");
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update that habit." };
  }
}

/**
 * Deleting a habit takes its log with it. XP it already paid or charged
 * stays, as a deleted quest's ledger rows do.
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
