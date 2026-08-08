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

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const SHORT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const LONG = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Today · 5:00 PM", "Tomorrow", "3 days overdue", "Mar 14" */
export function describeDue(iso: string): string {
  const d = new Date(iso);
  const days = daysAway(iso);
  const past = d.getTime() < Date.now();
  const atMidnight = d.getHours() === 0 && d.getMinutes() === 0;
  const time = atMidnight ? "" : ` · ${TIME.format(d)}`;

  if (days === 0) return past ? `Today${time} — late` : `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days === -1) return `Yesterday${time}`;
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days <= 6) return `${days} days${time}`;

  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? SHORT : LONG).format(d) + time;
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** Same idea as describeDue but without the time — for the narrow boxes. */
export function describeDueShort(iso: string): string {
  const d = new Date(iso);
  const days = daysAway(iso);
  const past = d.getTime() < Date.now();

  if (days === 0) return past ? "Today · late" : "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days <= 6) return WEEKDAY.format(d);

  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? SHORT : LONG).format(d);
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

/** 42 cells (6 weeks) covering the month `view` falls in, Sunday-first. */
export function monthMatrix(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
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
