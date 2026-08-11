const DAY = 86_400_000;

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Whole days from today to the given date (negative = in the past). */
export function daysAway(iso: string): number {
  return Math.round(
    (startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / DAY
  );
}

export function isOverdue(iso: string | null): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
}

/* --------------------------------------------------------------------------
   Ordering and urgency.

   Both live here so the board, the row colour and the server ORDER BY can
   never drift apart — the bug that made a quest keep its old slot after its
   deadline was edited.
   -------------------------------------------------------------------------- */

export type Urgency = "overdue" | "urgent" | "soon" | "later";

/** overdue · due today or tomorrow · 2–4 days · 5 days or more. */
export function urgencyOf(iso: string): Urgency {
  if (isOverdue(iso)) return "overdue";
  const days = daysAway(iso);
  if (days <= 1) return "urgent";
  if (days <= 4) return "soon";
  return "later";
}

/**
 * Soonest deadline first, undated quests last, creation time as the tiebreak
 * so the order is total and never wobbles between renders.
 *
 * ISO strings compare correctly as text — they're fixed-width and UTC — so
 * this needs no Date parsing.
 */
export function byDeadline(
  a: { due_date: string | null; created_at: string },
  b: { due_date: string | null; created_at: string }
): number {
  if (a.due_date && b.due_date) {
    return (
      a.due_date.localeCompare(b.due_date) ||
      a.created_at.localeCompare(b.created_at)
    );
  }
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return a.created_at.localeCompare(b.created_at);
}

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const SHORT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/**
 * "08/14", or "08/14/27" when the deadline isn't in the current year.
 *
 * The year is only added when it differs, because a bare "01/15" seen in
 * December reads as three weeks ago rather than eleven months away.
 */
function shortDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (d.getFullYear() === new Date().getFullYear()) return `${mm}/${dd}`;
  return `${mm}/${dd}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * Midnight means "some time that day" rather than an appointment at 00:00 —
 * nothing in the picker produces it, so a deadline carrying it was set by date
 * alone and showing it a clock time would be inventing precision.
 */
function atMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0;
}

/**
 * "Today · 5:00 PM", "Tomorrow · 9:00 AM", "08/14".
 *
 * Only today and tomorrow get words — every other deadline is the date, so
 * scanning a board never means converting "in 3 days" into a real one. How
 * urgent it is comes from the chip colour instead.
 */
export function describeDue(iso: string): string {
  const d = new Date(iso);
  const days = daysAway(iso);
  const past = d.getTime() < Date.now();
  const time = atMidnight(d) ? "" : ` · ${TIME.format(d)}`;

  if (days === 0) return past ? `Today${time} — late` : `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  return shortDate(d);
}

/**
 * Same idea as describeDue, trimmed for the narrow category boxes: "5:00 PM",
 * "Tomorrow", "08/14".
 *
 * A quest due today shows the hour rather than the word. "Today" is the one
 * label that tells you nothing you can act on — of course it's today, it's in
 * the box with a red chip — whereas the time is the whole question: whether
 * this is still doable before the deadline or already gone. It needs no "Today"
 * in front of it, because a bare clock time is only ever shown for today; every
 * other deadline reads as a weekday word or a date.
 */
export function describeDueShort(iso: string): string {
  const d = new Date(iso);
  const days = daysAway(iso);
  const past = d.getTime() < Date.now();

  if (days === 0) {
    // A date-only deadline has no hour to show, so it keeps the word.
    const label = atMidnight(d) ? "Today" : TIME.format(d);
    return past ? `${label} · late` : label;
  }
  if (days === 1) return "Tomorrow";
  return shortDate(d);
}

export function formatStamp(iso: string): string {
  const d = new Date(iso);
  const days = daysAway(iso);
  if (days === 0) return `Today · ${TIME.format(d)}`;
  if (days === -1) return `Yesterday · ${TIME.format(d)}`;
  return `${SHORT.format(d)} · ${TIME.format(d)}`;
}

/* --------------------------------------------------------------------------
   The due-date value passed around the UI is a `datetime-local` string
   ("2026-08-14T18:00"), which is timezone-free and round-trips cleanly through
   form state. It becomes an ISO instant only at the moment it hits the server.
   -------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Converts a datetime-local input value to an ISO string. */
export function localInputToIso(v: string): string | null {
  return fromLocalInput(v)?.toISOString() ?? null;
}

/** Converts an ISO string to a datetime-local input value. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : toLocalInput(d);
}

export type Preset = "today" | "tomorrow" | "weekend" | "week";

/** Shortcut buttons on the due-date picker. */
export function presetDue(kind: Preset): string {
  const d = new Date();
  d.setSeconds(0, 0);

  switch (kind) {
    case "today":
      d.setHours(23, 59, 0, 0);
      break;
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      break;
    case "weekend": {
      // The coming Saturday; if today is Saturday, next Saturday.
      const delta = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
      d.setHours(12, 0, 0, 0);
      break;
    }
    case "week":
      d.setDate(d.getDate() + 7);
      d.setHours(18, 0, 0, 0);
      break;
  }

  return toLocalInput(d);
}

/* --------------------------------------------------------------------------
   Calendar grid
   -------------------------------------------------------------------------- */

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Up to 42 cells (6 weeks) covering the month `view` falls in, Sunday-first.
 *
 * A trailing week made entirely of the next month is dropped. Six rows are
 * only ever needed for months that genuinely span them, and the fixed sixth row
 * was costing the picker ~35px of height it could not spare — which is what
 * pushed the time controls out of reach.
 */
export function monthMatrix(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const lastWeek = cells.slice(35);
  const spills = lastWeek.every((d) => d.getMonth() !== view.getMonth());
  return spills ? cells.slice(0, 35) : cells;
}

export const MONTH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Times offered as one-tap chips in the picker. */
export const TIME_PRESETS: { label: string; h: number; m: number }[] = [
  { label: "9:00 AM", h: 9, m: 0 },
  { label: "12:00 PM", h: 12, m: 0 },
  { label: "6:00 PM", h: 18, m: 0 },
  { label: "End of day", h: 23, m: 59 },
];

/** The time half of a datetime-local value, shaped for <input type="time">. */
export function timeOf(value: string): string {
  const d = fromLocalInput(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
}

/**
 * Applies an "HH:MM" string to a value, keeping its date. Returns null for
 * anything malformed — a time input can be momentarily empty or partial while
 * being typed, and that must not wipe the deadline.
 */
export function withTimeString(value: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return withTime(value || toLocalInput(new Date()), h, min);
}

export function withTime(value: string, h: number, m: number): string {
  const base = fromLocalInput(value) ?? new Date();
  base.setHours(h, m, 0, 0);
  return toLocalInput(base);
}

export function withDate(value: string, day: Date): string {
  const base = fromLocalInput(value);
  const next = new Date(day);
  next.setHours(base?.getHours() ?? 23, base?.getMinutes() ?? 59, 0, 0);
  return toLocalInput(next);
}
