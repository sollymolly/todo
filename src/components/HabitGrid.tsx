"use client";

import { useState } from "react";
import { deleteHabit, setHabitActive, toggleHabit } from "@/lib/habit-actions";
import {
  describeDays,
  habitReward,
  isoWeekday,
  shiftDay,
  type Habit,
} from "@/lib/habits";

/* --------------------------------------------------------------------------
   The habit grid, shared by the Habits page and the dashboard.

   One row per habit, one column per day: a green check for a day kept, a red
   x for a day missed. Only today's cell can be pressed — once a day is over it
   is settled one way or the other and stays that way.
   -------------------------------------------------------------------------- */

export type HabitTicked = {
  delta: number;
  xp: number;
  origin: { x: number; y: number };
};

const DAY_LETTER = ["", "M", "T", "W", "T", "F", "S", "S"];

/** "Every day · until 30 Sep" / "Mon, Wed, Fri · 3 of 10" */
function describe(h: Habit): string {
  const parts = [describeDays(h.days)];
  if (h.occurrences_limit)
    parts.push(`${h.occurrences_made} of ${h.occurrences_limit}`);
  else if (h.ends_on)
    parts.push(
      `until ${new Date(`${h.ends_on}T00:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })}`
    );
  return parts.join(" · ");
}

export default function HabitGrid({
  habits: initial,
  today,
  span = 14,
  manage = false,
  onTicked,
  onChanged,
}: {
  habits: Habit[];
  today: string;
  /** How many days the grid shows at once. */
  span?: number;
  /** Show pause and delete on each row. */
  manage?: boolean;
  /** After a tick or un-tick, with what moved — for the XP bar and effects. */
  onTicked?: (t: HabitTicked) => void;
  /** After a pause, resume or delete, so the caller can re-read. */
  onChanged: () => void;
}) {
  // Local copy so a tick shows at once; a new server list replaces it.
  const [habits, setHabits] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    setHabits(initial);
  }

  const [end, setEnd] = useState(today); // last column shown
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = Array.from({ length: span }, (_, i) => shiftDay(end, i - span + 1));
  const earliest = shiftDay(today, -179);

  async function tick(h: Habit, e: React.MouseEvent) {
    if (busy) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setBusy(h.id);
    setError(null);
    const res = await toggleHabit(h.id);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      onChanged();
      return;
    }
    setHabits((prev) =>
      prev.map((x) => {
        if (x.id !== h.id) return x;
        const log = { ...x.log };
        if (res.done) log[today] = { done: true, xp: res.delta };
        else delete log[today];
        return {
          ...x,
          log,
          done_today: res.done,
          streak: res.streak,
          best_streak: Math.max(x.best_streak, res.streak),
        };
      })
    );
    onTicked?.({ delta: res.delta, xp: res.xp, origin });
  }

  return (
    <div className="panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-mud-200 px-3 py-2">
        <button
          onClick={() => setEnd((d) => shiftDay(d, -7))}
          disabled={shiftDay(end, -span + 1) <= earliest}
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-mud-600 transition hover:bg-mud-100 disabled:opacity-30"
        >
          ← Earlier
        </button>
        <span className="text-[11px] font-semibold text-mud-500">
          {fmtRange(days[0], days[days.length - 1])}
        </span>
        <button
          onClick={() => setEnd((d) => (shiftDay(d, 7) > today ? today : shiftDay(d, 7)))}
          disabled={end >= today}
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-mud-600 transition hover:bg-mud-100 disabled:opacity-30"
        >
          Later →
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-36 bg-mud-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mud-400">
                Habit
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`px-0.5 py-1.5 text-center text-[10px] font-semibold leading-tight ${
                    d === today ? "text-grass-700" : "text-mud-400"
                  }`}
                >
                  {DAY_LETTER[isoWeekday(d)]}
                  <br />
                  <span className={d === today ? "font-bold" : ""}>{Number(d.slice(8))}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map((h) => (
              <tr key={h.id} className={`border-t border-mud-200/70 ${h.active ? "" : "opacity-60"}`}>
                <td className="sticky left-0 z-10 max-w-48 bg-mud-50 px-3 py-2 align-middle">
                  <p className="truncate font-display text-sm font-bold text-mud-900" title={h.title}>
                    {h.title}
                  </p>
                  <p className="truncate text-[10px] text-mud-500">
                    {describe(h)}
                    {h.finished ? " · finished" : !h.active ? " · paused" : ""}
                  </p>
                  <p className="text-[10px] font-semibold text-mud-600">
                    <span title="Current streak">🔥 {h.streak}</span>
                    {h.best_streak > h.streak && (
                      <span className="text-mud-400"> · best {h.best_streak}</span>
                    )}
                    {h.active && !h.finished && (
                      <span
                        className="text-grass-700"
                        title="XP for the next tick: 1% more per day of streak, up to +10"
                      >
                        {" · "}+{habitReward(h.done_today ? h.streak : h.streak + 1)} XP
                      </span>
                    )}
                  </p>
                  {manage && (
                    <div className="mt-1 flex gap-1">
                      <button
                        onClick={async () => {
                          await setHabitActive(h.id, !h.active);
                          onChanged();
                        }}
                        className="rounded-md border border-mud-300 bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-mud-600 transition hover:border-grass-500 hover:text-grass-700"
                      >
                        {h.active ? "Pause" : "Resume"}
                      </button>
                      <Remove
                        onConfirm={async () => {
                          await deleteHabit(h.id);
                          onChanged();
                        }}
                      />
                    </div>
                  )}
                </td>
                {days.map((d) => (
                  <td key={d} className={`px-0.5 py-1 text-center ${d === today ? "bg-grass-50/60" : ""}`}>
                    <Cell
                      habit={h}
                      day={d}
                      today={today}
                      busy={busy === h.id}
                      onTick={(e) => tick(h, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="border-t border-mud-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

function Cell({
  habit: h,
  day,
  today,
  busy,
  onTick,
}: {
  habit: Habit;
  day: string;
  today: string;
  busy: boolean;
  onTick: (e: React.MouseEvent) => void;
}) {
  const entry = h.log[day];
  const box = "mx-auto flex size-7 items-center justify-center rounded-lg text-sm font-bold";

  if (day === today && (h.due_today || entry)) {
    const done = !!entry?.done;
    return (
      <button
        onClick={onTick}
        disabled={busy}
        aria-pressed={done}
        aria-label={done ? `Un-tick ${h.title} for today` : `Tick ${h.title} for today`}
        title={done ? `Done today (+${entry.xp} XP) — press to undo` : "Tick off today"}
        className={`${box} transition ${
          done
            ? "bg-grass-600 text-white shadow-sm hover:bg-grass-500"
            : "border-2 border-dashed border-amber-400 bg-white text-transparent hover:border-grass-500 hover:text-grass-400"
        } ${busy ? "animate-pulse" : ""}`}
      >
        ✓
      </button>
    );
  }

  if (entry?.done)
    return (
      <span className={`${box} bg-grass-600 text-white`} title={`Kept (+${entry.xp} XP)`}>
        ✓
      </span>
    );

  if (entry)
    return (
      <span className={`${box} bg-red-500 text-white`} title={`Missed (${entry.xp} XP)`}>
        ✕
      </span>
    );

  // Not scheduled, not yet started, after it ended, or a day that was paused.
  const scheduled =
    h.days.includes(isoWeekday(day)) && day >= h.created_on && day < today;
  return (
    <span
      className={`${box} ${scheduled ? "text-mud-300" : "text-mud-200"}`}
      title={day > today ? undefined : scheduled ? "Not tracked" : "Rest day"}
    >
      {day > today ? "" : "·"}
    </span>
  );
}

function fmtRange(a: string, b: string): string {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `${f(a)} – ${f(b)}`;
}

function Remove({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        onClick={() => setAsking(true)}
        className="rounded-md border border-mud-300 bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-mud-600 transition hover:border-red-400 hover:text-red-700"
      >
        Delete
      </button>
    );
  return (
    <>
      <button
        onClick={onConfirm}
        title="Deletes the habit and its history"
        className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white transition hover:bg-red-700"
      >
        Delete
      </button>
      <button
        onClick={() => setAsking(false)}
        className="rounded-md px-1 py-0.5 text-[10px] font-semibold text-mud-500 hover:text-mud-900"
      >
        No
      </button>
    </>
  );
}
