"use client";

import { useMemo, useState } from "react";
import { colorOf } from "@/lib/game";
import { byDeadline, daysAway, describeDue, isOverdue, urgencyOf, type Urgency } from "@/lib/date";
import type { Category, Subtask, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   Every quest in one sortable, filterable table — the same data as the board,
   laid out for scanning rather than for doing. Everything happens on the
   quests already loaded, so sorting and filtering cost no request.
   -------------------------------------------------------------------------- */

type Status = "overdue" | "missed" | "open" | "done";

/** Most pressing first, which is also the order the status sort uses. */
const STATUSES: { key: Status; label: string; chip: string }[] = [
  { key: "overdue", label: "Overdue", chip: "bg-red-100 text-red-700 ring-red-300" },
  { key: "missed", label: "Missed", chip: "bg-red-100 text-red-700 ring-red-300" },
  { key: "open", label: "Open", chip: "bg-mud-50 text-mud-600 ring-mud-200" },
  { key: "done", label: "Done", chip: "bg-grass-100 text-grass-700 ring-grass-300" },
];

/* Past the deadline but inside the 24h grace is "overdue" — still on time to
   finish late for the full late award. Past the grace, the sweep marks it
   failed, which reads as "missed". */
function statusOf(t: Todo): Status {
  if (t.status === "done") return "done";
  if (t.status === "failed") return "missed";
  return isOverdue(t.due_date) ? "overdue" : "open";
}

/* Same colours as the chips on the board. Written out in full because
   Tailwind only ships classes it can see as literal text. */
const URGENCY: Record<Urgency, string> = {
  overdue: "bg-red-100 text-red-700 ring-red-300",
  urgent: "bg-red-100 text-red-700 ring-red-300",
  soon: "bg-amber-100 text-amber-800 ring-amber-300",
  later: "bg-grass-100 text-grass-700 ring-grass-300",
};

type SortKey = "title" | "category" | "due" | "status" | "created";
type DueFilter = "any" | "today" | "week" | "late" | "none";

const DUE_FILTERS: { key: DueFilter; label: string }[] = [
  { key: "any", label: "Any date" },
  { key: "late", label: "Past deadline" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Due in 7 days" },
  { key: "none", label: "No deadline" },
];

/** Unfinished by default: this is a view of what's current. */
const DEFAULT_STATUSES: ReadonlySet<Status> = new Set(["overdue", "missed", "open"]);

type Handlers = {
  onComplete: (todo: Todo, origin: { x: number; y: number }) => void;
  onUncomplete: (todo: Todo) => void;
  onAbandon: (todo: Todo, origin: { x: number; y: number }) => void;
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
};

export default function TaskTable({
  todos,
  categories,
  steps,
  handlers,
}: {
  todos: Todo[];
  /** In board order, which is also how the category column sorts. */
  categories: Category[];
  steps: Record<string, Subtask[]>;
  handlers: Handlers;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [statuses, setStatuses] = useState<ReadonlySet<Status>>(DEFAULT_STATUSES);
  const [due, setDue] = useState<DueFilter>("any");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due", dir: 1 });

  const catById = useMemo(() => new Map(categories.map((c, i) => [c.id, { c, i }])), [categories]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = todos.filter((t) => {
      if (!statuses.has(statusOf(t))) return false;
      if (category === "none" ? t.category_id : category !== "all" && t.category_id !== category)
        return false;
      if (q && !t.title.toLowerCase().includes(q) && !(t.notes ?? "").toLowerCase().includes(q))
        return false;
      switch (due) {
        case "none":
          return !t.due_date;
        case "late":
          return !!t.due_date && t.status !== "done" && isOverdue(t.due_date);
        case "today":
          return !!t.due_date && daysAway(t.due_date) === 0;
        case "week": {
          if (!t.due_date) return false;
          const d = daysAway(t.due_date);
          return d >= 0 && d <= 7;
        }
        default:
          return true;
      }
    });

    const rank = (s: Status) => STATUSES.findIndex((x) => x.key === s);
    // Uncategorised sorts after every real category.
    const catRank = (t: Todo) => (t.category_id ? (catById.get(t.category_id)?.i ?? 999) : 1000);
    const compare: Record<SortKey, (a: Todo, b: Todo) => number> = {
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      category: (a, b) => catRank(a) - catRank(b),
      due: byDeadline,
      status: (a, b) => rank(statusOf(a)) - rank(statusOf(b)),
      created: (a, b) => a.created_at.localeCompare(b.created_at),
    };
    // Ties fall back to deadline order, so every sort still reads sensibly.
    return filtered.sort(
      (a, b) => sort.dir * compare[sort.key](a, b) || byDeadline(a, b)
    );
  }, [todos, statuses, category, query, due, sort, catById]);

  const filtering =
    query.trim() !== "" ||
    category !== "all" ||
    due !== "any" ||
    statuses.size !== DEFAULT_STATUSES.size ||
    [...statuses].some((s) => !DEFAULT_STATUSES.has(s));

  function toggleStatus(s: Status) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function sortBy(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function centerOf(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  return (
    <div className="panel rounded-2xl">
      {/* -------------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-mud-200 p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search quests…"
          aria-label="Search quests"
          className="field min-w-0 flex-1 basis-40 rounded-lg px-3 py-1.5 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="field rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Uncategorised</option>
        </select>
        <select
          value={due}
          onChange={(e) => setDue(e.target.value as DueFilter)}
          aria-label="Filter by deadline"
          className="field rounded-lg px-2 py-1.5 text-sm"
        >
          {DUE_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        <div className="flex w-full flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => {
            const on = statuses.has(s.key);
            return (
              <button
                key={s.key}
                onClick={() => toggleStatus(s.key)}
                aria-pressed={on}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition ${
                  on ? s.chip : "bg-transparent text-mud-400 ring-mud-200 hover:text-mud-600"
                }`}
              >
                {on ? "✓ " : ""}
                {s.label}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] font-semibold text-mud-500">
            {rows.length} of {todos.length}
          </span>
          {filtering && (
            <button
              onClick={() => {
                setQuery("");
                setCategory("all");
                setDue("any");
                setStatuses(DEFAULT_STATUSES);
              }}
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-mud-500 underline-offset-2 transition hover:text-grass-700 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- table */}
      {/* Scrolls sideways inside itself on a phone, so the page never does.
          `relative` matters: the screen-reader-only header labels are
          absolutely positioned, and without a positioned ancestor inside the
          scroller they escape it and widen the whole page. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-mud-200 text-[11px] uppercase tracking-wider text-mud-500">
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Done</span>
              </th>
              <SortHeader label="Quest" k="title" sort={sort} onSort={sortBy} />
              <SortHeader label="Category" k="category" sort={sort} onSort={sortBy} />
              <SortHeader label="Due" k="due" sort={sort} onSort={sortBy} />
              <SortHeader label="Status" k="status" sort={sort} onSort={sortBy} />
              <SortHeader label="Added" k="created" sort={sort} onSort={sortBy} />
              <th className="px-3 py-2 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-mud-400">
                  {todos.length === 0 ? "No quests yet." : "Nothing matches these filters."}
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const s = statusOf(t);
              const meta = STATUSES.find((x) => x.key === s)!;
              const cat = t.category_id ? catById.get(t.category_id)?.c : undefined;
              const c = colorOf(cat?.color ?? "amber");
              const done = s === "done";
              const list = steps[t.id] ?? [];
              return (
                <tr key={t.id} className="border-b border-mud-100 last:border-0 hover:bg-white/60">
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => (done ? handlers.onUncomplete(t) : handlers.onComplete(t, centerOf(e)))}
                      aria-label={done ? `Mark "${t.title}" as not done` : `Complete "${t.title}"`}
                      className={`grid size-5 place-items-center rounded-full border-2 text-[10px] text-white transition ${
                        done
                          ? "border-grass-600 bg-grass-600"
                          : "border-mud-300 bg-white hover:border-grass-500 hover:bg-grass-100"
                      }`}
                    >
                      {done ? "✓" : ""}
                    </button>
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    <button
                      onClick={() => !done && handlers.onEdit(t)}
                      disabled={done}
                      className={`block w-full truncate text-left font-medium ${
                        done ? "text-mud-400 line-through" : "text-mud-900 hover:text-grass-700"
                      }`}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                    {list.length > 0 && (
                      <span className="text-[11px] text-mud-500">
                        {list.filter((x) => x.done).length}/{list.length} steps
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {cat ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-mud-700">
                        <span className={`size-2 rounded-full ${c.dot}`} />
                        {cat.name}
                      </span>
                    ) : (
                      <span className="text-[12px] text-mud-400">Uncategorised</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {t.due_date ? (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                          done ? "bg-mud-50 text-mud-400 ring-mud-200" : URGENCY[urgencyOf(t.due_date)]
                        }`}
                      >
                        {describeDue(t.due_date)}
                      </span>
                    ) : (
                      <span className="text-[12px] text-mud-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${meta.chip}`}>
                      {meta.label}
                      {t.xp_awarded !== 0 && (
                        <span className="ml-1 font-normal opacity-80">
                          {t.xp_awarded > 0 ? "+" : ""}
                          {t.xp_awarded} XP
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-mud-500">
                    {new Date(t.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!done && (
                      <RowAction onClick={() => handlers.onEdit(t)}>Edit</RowAction>
                    )}
                    {!done && (
                      <RowAction onClick={(e) => handlers.onAbandon(t, centerOf(e))} danger>
                        Abandon
                      </RowAction>
                    )}
                    <RowAction onClick={() => handlers.onDelete(t)} danger>
                      Delete
                    </RowAction>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      className="px-3 py-2"
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider transition hover:text-grass-700 ${
          active ? "text-mud-900" : ""
        }`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-30"}>
          {active && sort.dir === -1 ? "▾" : "▴"}
        </span>
      </button>
    </th>
  );
}

function RowAction({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`ml-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition ${
        danger ? "text-red-600 hover:bg-red-50" : "text-mud-600 hover:bg-mud-100"
      }`}
    >
      {children}
    </button>
  );
}
