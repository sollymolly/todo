"use client";

import { useState } from "react";
import { deleteHabit, setHabitActive } from "@/lib/habit-actions";
import { describeDays, type Habit } from "@/lib/habits";
import { colorOf } from "@/lib/game";
import type { Category } from "@/lib/types";

/* --------------------------------------------------------------------------
   The running-habits list, shared by the Habits page and the dashboard.

   A habit is a definition; the quest you tick lives on the board with
   everything else. So this list is about the shape of the commitment — how
   often, in which category, how long the run is — and the only doing it offers
   is pausing or dropping one. It appears in both places because the two
   questions ("what am I keeping up?" and "what's left today?") are asked at
   the same moment, and a separate page made the first one invisible.
   -------------------------------------------------------------------------- */

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

export default function HabitList({
  habits,
  categories,
  onChanged,
  compact = false,
}: {
  habits: Habit[];
  categories: Category[];
  /** Called after a pause, resume or delete, so the caller can re-read. */
  onChanged: () => void;
  /** Denser padding and type, for the dashboard's narrower column. */
  compact?: boolean;
}) {
  const active = habits.filter((h) => h.active);
  const paused = habits.filter((h) => !h.active);

  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2"}>
      {[...active, ...paused].map((h) => {
        const cat = categories.find((c) => c.id === h.category_id);
        const col = colorOf(cat?.color ?? "amber");
        return (
          <li
            key={h.id}
            className={`panel rounded-2xl ${compact ? "p-3" : "p-4"} ${
              h.active ? "" : "opacity-60"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-display font-bold text-mud-900 ${
                    compact ? "text-sm" : "text-base"
                  }`}
                >
                  {h.title}
                </p>
                <p className="mt-0.5 text-[11px] text-mud-500">
                  {describe(h)}
                  {cat && (
                    <>
                      {" · "}
                      <span className={`font-semibold ${col.text}`}>
                        {cat.name}
                      </span>
                    </>
                  )}
                  {h.finished ? " · finished" : !h.active ? " · paused" : ""}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-bold tabular-nums text-mud-800">
                  {h.streak}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-mud-400">
                  {h.streak === 1 ? "day" : "days"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {h.active && !h.finished && h.due_today && (
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                    h.done_today
                      ? "bg-grass-100 text-grass-700 ring-grass-300"
                      : "bg-amber-100 text-amber-800 ring-amber-300"
                  }`}
                >
                  {h.done_today ? "done today" : "waiting on the board"}
                </span>
              )}
              {h.best_streak > h.streak && (
                <span className="rounded-md bg-mud-100 px-1.5 py-0.5 text-[11px] font-semibold text-mud-500">
                  best {h.best_streak}
                </span>
              )}

              <span className="ml-auto flex gap-1.5">
                <button
                  onClick={async () => {
                    await setHabitActive(h.id, !h.active);
                    onChanged();
                  }}
                  className="rounded-lg border border-mud-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
                >
                  {h.active ? "Pause" : "Resume"}
                </button>
                <Remove
                  onConfirm={async () => {
                    await deleteHabit(h.id);
                    onChanged();
                  }}
                />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Remove({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        onClick={() => setAsking(true)}
        className="rounded-lg border border-mud-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-red-400 hover:bg-red-50 hover:text-red-700"
      >
        Delete
      </button>
    );
  return (
    <>
      <button
        onClick={onConfirm}
        title="Deletes the habit and any instance still outstanding"
        className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-red-700"
      >
        Delete
      </button>
      <button
        onClick={() => setAsking(false)}
        className="rounded-lg px-2 py-1 text-[11px] font-semibold text-mud-500 hover:text-mud-900"
      >
        No
      </button>
    </>
  );
}
