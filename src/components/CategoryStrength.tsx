"use client";

import { colorOf } from "@/lib/game";
import type { Category, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   How often a promise in each area gets broken.

   The number is the share of *deadlines* that were missed, and finishing
   something late still counts as missed — the deadline went by, and no amount
   of catching up later changes that. So the figure can't be improved by
   completing an overdue quest; only by meeting the next one on time.

   Quests with no deadline are left out of both sides. There was nothing to
   miss, so counting them would dilute the number towards zero and make a
   neglected area look healthy.

   Lower is better here, and worst is listed first: the point is to surface the
   area being neglected, not to sort it alphabetically and bury it.
   -------------------------------------------------------------------------- */

type Row = {
  id: string;
  name: string;
  color: string;
  onTime: number;
  late: number;
  failed: number;
  /** Percent of deadlines missed, or null when none have resolved yet. */
  rate: number | null;
};

function build(categories: Category[], todos: Todo[]): Row[] {
  const rows = categories.map((c) => {
    const mine = todos.filter((t) => t.category_id === c.id);
    const done = mine.filter((t) => t.status === "done" && t.due_date);

    // Completed quests are deleted after a week, so the live counts are only
    // the recent tail — the archived counters are the rest of the history.
    const onTime =
      (c.archived_on_time ?? 0) +
      done.filter((t) => t.completed_at && t.completed_at <= t.due_date!).length;
    const late =
      (c.archived_late ?? 0) +
      done.filter((t) => t.completed_at && t.completed_at > t.due_date!).length;
    // Missed quests are never pruned, so this side is always countable live.
    const failed = mine.filter((t) => t.status === "failed").length;

    const resolved = onTime + late + failed;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      onTime,
      late,
      failed,
      rate: resolved > 0 ? Math.round(((late + failed) / resolved) * 100) : null,
    };
  });

  return rows.sort((a, b) => {
    // Nothing resolved yet isn't a weakness, so it sinks to the bottom.
    if (a.rate === null && b.rate === null) return a.name.localeCompare(b.name);
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return b.rate - a.rate || b.failed - a.failed;
  });
}

/** Inverted against the old scale: this bar measures failure, so full is bad. */
const BAR = (rate: number) =>
  rate >= 50 ? "bg-red-500" : rate >= 20 ? "bg-amber-400" : "bg-grass-500";

export default function CategoryStrength({
  categories,
  todos,
}: {
  categories: Category[];
  todos: Todo[];
}) {
  const rows = build(categories, todos);
  if (rows.length === 0) return null;

  return (
    <div className="panel rounded-2xl p-5">
      <h2 className="font-display text-sm font-bold tracking-wide text-mud-800">
        Strengths
      </h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-mud-500">
        Share of deadlines missed. Finishing late still counts as missed.
      </p>

      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => {
          const col = colorOf(r.color);
          const missed = r.late + r.failed;
          return (
            <li key={r.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`truncate text-xs font-bold ${col.text}`}
                  title={r.name}
                >
                  {r.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-mud-600">
                  {r.rate === null ? "—" : `${r.rate}% missed`}
                </span>
              </div>

              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-mud-200">
                {r.rate !== null && (
                  <div
                    className={`h-full rounded-full transition-all ${BAR(r.rate)}`}
                    style={{ width: `${Math.max(r.rate, r.rate > 0 ? 2 : 0)}%` }}
                  />
                )}
              </div>

              <p className="mt-1 text-[10px] text-mud-400">
                {r.rate === null
                  ? "no deadlines resolved yet"
                  : `${missed} of ${r.onTime + missed} missed${
                      r.late > 0 ? ` · ${r.late} finished late` : ""
                    }`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
