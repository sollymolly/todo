"use client";

import { colorOf } from "@/lib/game";
import type { Category, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   Where you deliver, and where you don't.

   The bar is completed / (completed + missed) — a rate over *resolved*
   outcomes. An open quest isn't a success or a failure yet, so counting it
   either way would be a guess; it is shown as a separate number instead so a
   category quietly filling up with work is still visible.

   Weakest first, on purpose. The point is to surface the area being neglected,
   and sorting alphabetically buries it.
   -------------------------------------------------------------------------- */

type Row = {
  id: string;
  name: string;
  color: string;
  completed: number;
  missed: number;
  open: number;
  /** Null when nothing has resolved yet — no bar, rather than a damning 0%. */
  rate: number | null;
};

function build(categories: Category[], todos: Todo[]): Row[] {
  const rows = categories.map((c) => {
    const mine = todos.filter((t) => t.category_id === c.id);
    // Finished quests are deleted after a week, so the live count alone would
    // shrink over time. The archived counter is the rest of the history.
    const completed =
      (c.archived_done ?? 0) + mine.filter((t) => t.status === "done").length;
    // Missed quests are never pruned — they stay until finished or deleted —
    // so this side is always countable live.
    const missed = mine.filter((t) => t.status === "failed").length;
    const open = mine.filter((t) => t.status === "open").length;
    const resolved = completed + missed;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      completed,
      missed,
      open,
      rate: resolved > 0 ? Math.round((completed / resolved) * 100) : null,
    };
  });

  return rows.sort((a, b) => {
    // Categories with no history sink to the bottom; they aren't weaknesses.
    if (a.rate === null && b.rate === null) return a.name.localeCompare(b.name);
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return a.rate - b.rate || b.missed - a.missed;
  });
}

const BAR = (rate: number) =>
  rate >= 80 ? "bg-grass-500" : rate >= 50 ? "bg-amber-400" : "bg-red-500";

export default function CategoryStrength({
  categories,
  todos,
}: {
  categories: Category[];
  todos: Todo[];
}) {
  const rows = build(categories, todos);
  if (rows.length === 0) return null;

  const weakest = rows.find((r) => r.rate !== null && r.rate < 50);

  return (
    <div className="panel rounded-2xl p-5">
      <h2 className="font-display text-sm font-bold tracking-wide text-mud-800">
        Strengths
      </h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-mud-500">
        {weakest
          ? `${weakest.name} is where oaths break most. Worth some attention.`
          : "How often you deliver once a quest has an outcome."}
      </p>

      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => {
          const col = colorOf(r.color);
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
                  {r.rate === null ? "—" : `${r.rate}%`}
                </span>
              </div>

              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-mud-200">
                {r.rate !== null && (
                  <div
                    className={`h-full rounded-full transition-all ${BAR(r.rate)}`}
                    style={{ width: `${Math.max(r.rate, 2)}%` }}
                  />
                )}
              </div>

              <p className="mt-1 text-[10px] text-mud-400">
                {r.rate === null
                  ? r.open > 0
                    ? `${r.open} in progress · nothing finished yet`
                    : "nothing here yet"
                  : `${r.completed} done · ${r.missed} missed${
                      r.open > 0 ? ` · ${r.open} open` : ""
                    }`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
