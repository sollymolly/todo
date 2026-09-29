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
   x for a day missed, a snowflake for a day a streak freeze covered. Only
   today's cell can be pressed, until 23:59:59 in the user's timezone — once a
   day is over it is settled one way or the other and stays that way.
   -------------------------------------------------------------------------- */

export type HabitTicked = {
  delta: number;
  xp: number;
  origin: { x: number; y: number };
};

const DAY_NAME = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The small bordered buttons: paging, edit, pause, delete. */
const SMALL_BUTTON =
  "rounded-lg border-2 border-mud-300 bg-white px-2.5 py-1 text-[11px] font-bold text-mud-700 shadow-sm transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-30 disabled:hover:border-mud-300 disabled:hover:text-mud-700";

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
  freezes,
  span = 7,
  manage = false,
  onEdit,
  onTicked,
  onChanged,
}: {
  habits: Habit[];
  today: string;
  /** Streak freezes left this month, shown in the header. */
  freezes?: number;
  /** How many days the grid shows at once. */
  span?: number;
  /** Show pause and delete on each row. */
  manage?: boolean;
  /** With `manage`: open this habit for editing. */
  onEdit?: (h: Habit) => void;
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

  const [start, setStart] = useState(today); // first column shown
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = Array.from({ length: span }, (_, i) => shiftDay(start, i));
  const earliest = shiftDay(today, -179);

  async function tick(h: Habit, day: string, e: React.MouseEvent) {
    if (busy || day !== today) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setBusy(h.id);
    setError(null);
    // The device's own zone rides along, so "today" on the server is the
    // user's today even if the stored zone is stale.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await toggleHabit(h.id, day, zone);
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
        if (res.done) log[day] = { done: true, frozen: false, xp: res.delta };
        else delete log[day];
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
      <div className="flex items-center justify-between gap-2 border-b-2 border-mud-200 px-4 py-3">
        <button
          onClick={() =>
            setStart((d) => (shiftDay(d, -7) < earliest ? earliest : shiftDay(d, -7)))
          }
          disabled={start <= earliest}
          className={SMALL_BUTTON}
        >
          ← Earlier
        </button>
        <span className="flex flex-col items-center leading-tight">
          <span className="font-display text-sm font-bold text-mud-800">
            {fmtRange(days[0], days[days.length - 1])}
          </span>
          {freezes !== undefined && (
            <span
              className="text-[11px] font-semibold text-sky-700"
              title="A missed day spends one instead of breaking the streak. Two each month, shared by every habit."
            >
              ❄ {freezes} streak freeze{freezes === 1 ? "" : "s"} left this month
            </span>
          )}
        </span>
        <button
          onClick={() => setStart((d) => (shiftDay(d, 7) > today ? today : shiftDay(d, 7)))}
          disabled={start >= today}
          className={SMALL_BUTTON}
        >
          Later →
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[36%]" />
            {days.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-mud-100/70">
              <th className="sticky left-0 z-10 bg-mud-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-mud-500">
                Habit
              </th>
              {days.map((d) => (
                <th key={d} className="px-1 py-2 text-center">
                  <span
                    className={`mx-auto flex w-11 flex-col items-center rounded-lg py-1 leading-tight ${
                      d === today ? "bg-grass-600 text-white shadow-sm" : "text-mud-500"
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide">
                      {DAY_NAME[isoWeekday(d)]}
                    </span>
                    <span className="text-base font-bold">{Number(d.slice(8))}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map((h) => (
              <tr
                key={h.id}
                className={`border-t-2 border-mud-200/70 ${h.active ? "" : "opacity-60"}`}
              >
                <td className="sticky left-0 z-10 bg-mud-50 px-4 py-3 align-middle">
                  <p className="truncate font-display text-base font-bold text-mud-900" title={h.title}>
                    {h.title}
                  </p>
                  <p className="truncate text-[11px] text-mud-500">
                    {describe(h)}
                    {h.finished ? " · finished" : !h.active ? " · paused" : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] font-bold">
                    <span
                      className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800"
                      title={
                        h.best_streak > h.streak
                          ? `Current streak · best ${h.best_streak}`
                          : "Current streak"
                      }
                    >
                      🔥 {h.streak}
                      {h.best_streak > h.streak && (
                        <span className="font-semibold text-amber-600"> · best {h.best_streak}</span>
                      )}
                    </span>
                    {h.active && !h.finished && (
                      <span
                        className="rounded-md border border-grass-300 bg-grass-100 px-1.5 py-0.5 text-grass-700"
                        title="XP for the next tick: 1% more per day of streak, up to +10"
                      >
                        +{habitReward(h.done_today ? h.streak : h.streak + 1)} XP
                      </span>
                    )}
                  </div>
                  {manage && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {onEdit && (
                        <button onClick={() => onEdit(h)} className={SMALL_BUTTON}>
                          Edit
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          await setHabitActive(h.id, !h.active);
                          onChanged();
                        }}
                        className={SMALL_BUTTON}
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
                  <td
                    key={d}
                    className={`px-1 py-3 text-center ${d === today ? "bg-grass-100/50" : ""}`}
                  >
                    <Cell
                      habit={h}
                      day={d}
                      today={today}
                      busy={busy === h.id}
                      onTick={(e) => tick(h, d, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="border-t-2 border-mud-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-800">
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
  const box =
    "mx-auto flex size-10 items-center justify-center rounded-xl border-2 text-lg font-bold";

  // Today is the only day that can be pressed.
  if (day === today && (h.due_today || entry)) {
    const done = !!entry?.done;
    return (
      <button
        onClick={onTick}
        disabled={busy}
        aria-pressed={done}
        aria-label={done ? `Un-tick ${h.title} for today` : `Tick ${h.title} for today`}
        title={
          done
            ? `Done today (+${entry.xp} XP) — press to undo`
            : "Tick off today — open until 11:59:59 pm"
        }
        className={`${box} transition ${
          done
            ? "border-grass-700 bg-grass-600 text-white shadow-sm hover:bg-grass-500"
            : "border-amber-400 bg-amber-50 text-transparent shadow-sm hover:border-grass-500 hover:bg-white hover:text-grass-400"
        } ${busy ? "animate-pulse" : ""}`}
      >
        ✓
      </button>
    );
  }

  // A settled day: kept, frozen or missed. Read-only.
  if (entry) {
    if (entry.done)
      return (
        <span className={`${box} border-grass-700 bg-grass-600 text-white`} title={`Kept (+${entry.xp} XP)`}>
          ✓
        </span>
      );
    if (entry.frozen)
      return (
        <span
          className={`${box} border-sky-400 bg-sky-100 text-sky-600`}
          title="Missed, but a streak freeze held the streak"
        >
          ❄
        </span>
      );
    return (
      <span className={`${box} border-red-600 bg-red-500 text-white`} title={`Missed (${entry.xp} XP)`}>
        ✕
      </span>
    );
  }

  // Not on the schedule at all: a faded box, so the gap reads as a rest day
  // rather than something missing.
  if (!h.days.includes(isoWeekday(day)))
    return (
      <span
        className={`${box} border-dashed border-mud-200 bg-mud-100/50 text-xs text-mud-300`}
        title="Rest day"
      >
        –
      </span>
    );

  // Coming up: an empty box on each day it is due, pressable once it is today.
  if (day > today) {
    const upcoming =
      h.active && !h.finished && (!h.ends_on || day <= h.ends_on);
    return upcoming ? (
      <span className={`${box} border-mud-300 bg-white`} title="Coming up" />
    ) : (
      <span className={`${box} border-transparent`} />
    );
  }

  // A scheduled day that wasn't tracked: before the habit existed, while it
  // was paused, or after it ended.
  return (
    <span className={`${box} border-transparent text-mud-300`} title="Not tracked">
      ·
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
        className="rounded-lg border-2 border-mud-300 bg-white px-2.5 py-1 text-[11px] font-bold text-mud-700 shadow-sm transition hover:border-red-400 hover:text-red-700"
      >
        Delete
      </button>
    );
  return (
    <>
      <button
        onClick={onConfirm}
        title="Deletes the habit and its history"
        className="rounded-lg border-2 border-red-700 bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-red-700"
      >
        Delete
      </button>
      <button
        onClick={() => setAsking(false)}
        className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-mud-500 hover:text-mud-900"
      >
        No
      </button>
    </>
  );
}
