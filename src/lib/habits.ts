/* --------------------------------------------------------------------------
   Pure helpers and types for recurring habits.

   Separate from habit-actions.ts because that file is "use server", and such a
   module may only export async functions — a plain constant or a synchronous
   helper there is a build error. Same reason src/lib/owner.ts exists.
   -------------------------------------------------------------------------- */

/* Scheduling is a set of ISO weekdays (Monday = 1). Every cadence is just a
   particular set, so "Mon/Wed/Fri" needs no special case — see migration 014. */
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

export type Habit = {
  id: string;
  title: string;
  notes: string | null;
  category_id: string | null;
  days: number[];
  due_minutes: number;
  streak: number;
  best_streak: number;
  last_done_on: string | null;
  active: boolean;
  /** Optional stopping conditions; whichever comes first ends the habit. */
  ends_on: string | null;
  occurrences_limit: number | null;
  occurrences_made: number;
  /** True once a stopping condition has been reached. */
  finished: boolean;
  /** Whether today's instance is already ticked off. */
  done_today: boolean;
  /** Whether an instance exists for today at all (it may not be due). */
  due_today: boolean;
};
