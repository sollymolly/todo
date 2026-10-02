/* --------------------------------------------------------------------------
   Pure helpers and types for recurring habits.

   Separate from habit-actions.ts because that file is "use server", and such a
   module may only export async functions — a plain constant or a synchronous
   helper there is a build error. Same reason src/lib/owner.ts exists.
   -------------------------------------------------------------------------- */

/* Scheduling is a set of ISO weekdays (Monday = 1). Every cadence is just a
   particular set, so "Mon/Wed/Fri" needs no special case — see db/schema.sql. */
export const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS_ONLY = [1, 2, 3, 4, 5];
export const WEEKEND_ONLY = [6, 7];

export const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Every day", "Weekdays", "Weekends", "Every Tue", "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const d = [...new Set(days)].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (d.length === 0) return "Never";
  if (d.length === 7) return "Every day";
  if (d.length === 5 && d.every((n) => n <= 5)) return "Weekdays";
  if (d.length === 2 && d[0] === 6 && d[1] === 7) return "Weekends";
  if (d.length === 1) return `Every ${DAY_NAMES[d[0]]}`;
  return d.map((n) => DAY_NAMES[n]).join(", ");
}

/**
 * XP for the completion that brings a habit's streak to `streak`: 1% more per
 * day of the run, compounding, rounded, and capped at 10 — so +1 until day 42,
 * +10 from day 228. A miss costs 1 and resets the run. Mirrors habit_reward in
 * db/schema.sql — change both.
 */
export const HABIT_MISS_XP = -1;
export const HABIT_MAX_XP = 10;
export function habitReward(streak: number): number {
  return Math.min(
    HABIT_MAX_XP,
    Math.max(1, Math.round(Math.pow(1.01, Math.max(streak, 1) - 1)))
  );
}

/**
 * One settled day: a tick (done), a miss, or a miss covered by a streak
 * freeze (frozen: no XP moved, streak held) — and the XP it moved. `chosen`:
 * a miss the user set themselves, which won't get a freeze automatically
 * when its week is up.
 */
export type HabitDay = { done: boolean; frozen: boolean; xp: number; chosen?: boolean };

export type Habit = {
  id: string;
  title: string;
  notes: string | null;
  days: number[];
  streak: number;
  best_streak: number;
  active: boolean;
  /** The first local day the habit could be ticked, YYYY-MM-DD. */
  created_on: string;
  /** Optional stopping conditions; whichever comes first ends the habit. */
  ends_on: string | null;
  occurrences_limit: number | null;
  /** Days logged so far, ticked or missed — what the limit counts. */
  occurrences_made: number;
  /** True once a stopping condition has been reached. */
  finished: boolean;
  /** Whether today can be ticked: active, scheduled today and not over. */
  due_today: boolean;
  /** Whether today is already ticked. */
  done_today: boolean;
  /** Logged days by local date, YYYY-MM-DD. */
  log: Record<string, HabitDay>;
};

/** YYYY-MM-DD for a local date `offset` days from `day`. */
export function shiftDay(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a YYYY-MM-DD, Monday = 1. */
export function isoWeekday(day: string): number {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}
