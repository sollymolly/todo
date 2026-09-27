"use client";

import { useMemo, useRef, useState } from "react";
import { colorOf } from "@/lib/game";
import {
  byDeadline,
  daysAway,
  describeDue,
  isoToLocalInput,
  isOverdue,
  localInputToIso,
  urgencyOf,
  type Urgency,
} from "@/lib/date";
import type { Category, Subtask, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   Every quest in one table, edited in place — the same data as the board,
   laid out for scanning and quick changes rather than for doing.

   Modelled on a Notion table: quiet grey headers, hairline grid, and every
   cell you'd want to change changeable where it sits. Click a name to rename
   it, pick a category from its tag, click a date to move it, and type into the
   "+ New" row to add one. Sorting and filtering happen on the quests already
   loaded, so they cost no request.
   -------------------------------------------------------------------------- */

type Status = "overdue" | "missed" | "open" | "done";

/** Most pressing first, which is also the order the status sort uses. */
const STATUSES: { key: Status; label: string; tag: string }[] = [
  { key: "overdue", label: "Overdue", tag: "bg-red-100 text-red-700" },
  { key: "missed", label: "Missed", tag: "bg-red-100 text-red-700" },
  { key: "open", label: "Open", tag: "bg-mud-100 text-mud-600" },
  { key: "done", label: "Done", tag: "bg-grass-100 text-grass-700" },
];

/* Past the deadline but inside the 24h grace is "overdue" — still on time to
   finish late for the full late award. Past the grace, the sweep marks it
   failed, which reads as "missed". */
function statusOf(t: Todo): Status {
  if (t.status === "done") return "done";
  if (t.status === "failed") return "missed";
  return isOverdue(t.due_date) ? "overdue" : "open";
}

/* Same colours as the tags on the board. Written out in full because
   Tailwind only ships classes it can see as literal text. */
const URGENCY: Record<Urgency, string> = {
  overdue: "bg-red-100 text-red-700",
  urgent: "bg-red-100 text-red-700",
  soon: "bg-amber-100 text-amber-800",
  later: "bg-grass-100 text-grass-700",
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

/** What can be changed from a cell. */
export type QuickEdit = Partial<Pick<Todo, "title" | "due_date" | "category_id">>;

type Handlers = {
  onComplete: (todo: Todo, origin: { x: number; y: number }) => void;
  onUncomplete: (todo: Todo) => void;
  onAbandon: (todo: Todo, origin: { x: number; y: number }) => void;
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
};

/* A cell's quiet resting look, and the same box once it's being edited. */
const CELL = "border-b border-r border-mud-200 px-2 py-1.5 align-middle last:border-r-0";
const PILL =
  "appearance-none rounded-md bg-mud-100 px-2 py-1 text-[12px] text-mud-700 outline-none transition hover:bg-mud-200 focus:ring-2 focus:ring-grass-400";

export default function TaskTable({
  todos,
  categories,
  steps,
  handlers,
  onUpdate,
  onAdd,
}: {
  todos: Todo[];
  /** In board order, which is also how the category column sorts. */
  categories: Category[];
  steps: Record<string, Subtask[]>;
  handlers: Handlers;
  /** A single cell changed. */
  onUpdate: (todo: Todo, changes: QuickEdit) => void;
  /** Typed into the "+ New" row. */
  onAdd: (draft: { title: string; dueDate: string | null; categoryId: string | null }) => Promise<void>;
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
    <div className="panel overflow-hidden rounded-xl">
      {/* -------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-mud-200 px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search quests"
          className="min-w-0 flex-1 basis-32 rounded-md bg-transparent px-2 py-1 text-[13px] text-mud-900 outline-none placeholder:text-mud-400 hover:bg-mud-100 focus:bg-mud-100"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className={PILL}
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
          className={PILL}
        >
          {DUE_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => {
            const on = statuses.has(s.key);
            return (
              <button
                key={s.key}
                onClick={() => toggleStatus(s.key)}
                aria-pressed={on}
                className={`rounded-md px-2 py-1 text-[12px] transition ${
                  on ? s.tag : "text-mud-400 line-through decoration-mud-300 hover:bg-mud-100"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <span className="ml-auto whitespace-nowrap pl-1 text-[12px] text-mud-400">
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
            className="rounded-md px-2 py-1 text-[12px] text-mud-500 transition hover:bg-mud-100 hover:text-mud-800"
          >
            Reset
          </button>
        )}
      </div>

      {/* ---------------------------------------------------------- table */}
      {/* Scrolls sideways inside itself on a phone, so the page never does.
          `relative` matters: the screen-reader-only header labels are
          absolutely positioned, and without a positioned ancestor inside the
          scroller they escape it and widen the whole page. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[13.5px] text-mud-900">
          <thead>
            <tr className="text-[12px] text-mud-500">
              <th className={`${CELL} w-9`}>
                <span className="sr-only">Done</span>
              </th>
              <SortHeader label="Name" k="title" sort={sort} onSort={sortBy} />
              <SortHeader label="Category" k="category" sort={sort} onSort={sortBy} className="w-40" />
              <SortHeader label="Due" k="due" sort={sort} onSort={sortBy} className="w-44" />
              <SortHeader label="Status" k="status" sort={sort} onSort={sortBy} className="w-32" />
              <SortHeader label="Created" k="created" sort={sort} onSort={sortBy} className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="border-b border-mud-200 px-3 py-8 text-center text-[13px] text-mud-400">
                  {todos.length === 0 ? "No quests yet." : "Nothing matches these filters."}
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const s = statusOf(t);
              const meta = STATUSES.find((x) => x.key === s)!;
              const done = s === "done";
              const list = steps[t.id] ?? [];
              return (
                <tr key={t.id} className="group hover:bg-mud-100/60">
                  <td className={CELL}>
                    <button
                      onClick={(e) =>
                        done ? handlers.onUncomplete(t) : handlers.onComplete(t, centerOf(e))
                      }
                      aria-label={done ? `Mark "${t.title}" as not done` : `Complete "${t.title}"`}
                      className={`check mx-auto ${done ? "is-checked" : ""}`}
                    >
                      {done && (
                        <svg viewBox="0 0 24 24" className="size-3" aria-hidden>
                          <path
                            d="M4 12.5 L9.5 18 L20 6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </td>

                  {/* ------------------------------------------------ name */}
                  <td className={CELL}>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        {done ? (
                          <span className="block truncate px-1 text-mud-400 line-through" title={t.title}>
                            {t.title}
                          </span>
                        ) : (
                          <EditableText
                            value={t.title}
                            label="Quest name"
                            onSave={(title) => onUpdate(t, { title })}
                          />
                        )}
                      </div>
                      {list.length > 0 && (
                        <span className="shrink-0 text-[11px] tabular-nums text-mud-400">
                          {list.filter((x) => x.done).length}/{list.length}
                        </span>
                      )}
                      {/* Row actions surface on hover, as in Notion; always
                          there on a touchscreen, which has no hover. */}
                      <div className="flex shrink-0 gap-0.5 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        {!done && <RowAction onClick={() => handlers.onEdit(t)}>Open</RowAction>}
                        {!done && (
                          <RowAction onClick={(e) => handlers.onAbandon(t, centerOf(e))} danger>
                            Abandon
                          </RowAction>
                        )}
                        <RowAction onClick={() => handlers.onDelete(t)} danger>
                          Delete
                        </RowAction>
                      </div>
                    </div>
                  </td>

                  {/* -------------------------------------------- category */}
                  <td className={CELL}>
                    <CategoryCell
                      value={t.category_id}
                      categories={categories}
                      disabled={done}
                      onChange={(category_id) => onUpdate(t, { category_id })}
                    />
                  </td>

                  {/* ------------------------------------------------- due */}
                  <td className={`${CELL} whitespace-nowrap`}>
                    <DueCell
                      value={t.due_date}
                      done={done}
                      onChange={(due_date) => onUpdate(t, { due_date })}
                    />
                  </td>

                  {/* ---------------------------------------------- status */}
                  <td className={`${CELL} whitespace-nowrap`}>
                    <span className={`rounded px-1.5 py-0.5 text-[12px] ${meta.tag}`}>
                      {meta.label}
                    </span>
                    {t.xp_awarded !== 0 && (
                      <span className="ml-1.5 text-[11px] tabular-nums text-mud-400">
                        {t.xp_awarded > 0 ? "+" : ""}
                        {t.xp_awarded} XP
                      </span>
                    )}
                  </td>

                  <td className={`${CELL} whitespace-nowrap text-[12px] text-mud-500`}>
                    {new Date(t.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              );
            })}
            <NewRow
              categoryId={category !== "all" && category !== "none" ? category : null}
              onAdd={onAdd}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Cells                                                                      */
/* ========================================================================== */

/**
 * Text that turns into an input when clicked. Enter or clicking away saves,
 * Escape puts it back. An emptied name isn't saved — a quest needs one.
 */
function EditableText({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  if (draft === null) {
    return (
      <button
        onClick={() => {
          cancelled.current = false;
          setDraft(value);
        }}
        className="block w-full cursor-text truncate rounded px-1 py-0.5 text-left hover:bg-mud-200/60"
        title={value}
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (!cancelled.current && next && next !== value) onSave(next.slice(0, 200));
  };

  return (
    <input
      autoFocus
      value={draft}
      aria-label={label}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-full rounded bg-white px-1 py-0.5 outline-none ring-2 ring-grass-400"
    />
  );
}

/** The category as a coloured tag that is also the picker. */
function CategoryCell({
  value,
  categories,
  disabled,
  onChange,
}: {
  value: string | null;
  categories: Category[];
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const current = categories.find((c) => c.id === value);
  const c = colorOf(current?.color ?? "amber");
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Category"
      className={`max-w-full cursor-pointer appearance-none truncate rounded px-1.5 py-0.5 text-[12px] outline-none transition focus:ring-2 focus:ring-grass-400 disabled:cursor-default ${
        current ? `${c.head} ${c.text}` : "bg-transparent text-mud-400 hover:bg-mud-200/60"
      }`}
    >
      <option value="">{current ? "Uncategorised" : "Empty"}</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The deadline as a tag; click it for a date-and-time input. Clearing the
 * input removes the deadline. Escape leaves it as it was.
 */
function DueCell({
  value,
  done,
  onChange,
}: {
  value: string | null;
  done: boolean;
  onChange: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  if (!editing) {
    const label = value ? describeDue(value) : "Empty";
    return (
      <button
        onClick={() => {
          if (done) return;
          cancelled.current = false;
          setDraft(isoToLocalInput(value));
          setEditing(true);
        }}
        disabled={done}
        className={`rounded px-1.5 py-0.5 text-[12px] transition disabled:cursor-default ${
          !value
            ? "text-mud-400 hover:bg-mud-200/60"
            : done
              ? "bg-mud-100 text-mud-500"
              : URGENCY[urgencyOf(value)]
        }`}
      >
        {label}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const next = localInputToIso(draft);
    const before = value ? new Date(value).getTime() : null;
    const after = next ? new Date(next).getTime() : null;
    if (before !== after) onChange(next);
  };

  return (
    <input
      type="datetime-local"
      autoFocus
      value={draft}
      aria-label="Due date"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-full rounded bg-white px-1 py-0.5 text-[12px] outline-none ring-2 ring-grass-400"
    />
  );
}

/**
 * The "+ New" row. Stays open after each Enter, so a list can be typed out in
 * one go; Escape or clicking away with it empty closes it. A quest added here
 * joins the category being filtered to, if there is one.
 */
function NewRow({
  categoryId,
  onAdd,
}: {
  categoryId: string | null;
  onAdd: (draft: { title: string; dueDate: string | null; categoryId: string | null }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onAdd({ title: name, dueDate: null, categoryId });
      setTitle("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td colSpan={6} className="px-2 py-1">
        {open ? (
          <input
            autoFocus
            value={title}
            disabled={busy}
            placeholder="Type a name, press Enter"
            aria-label="New quest name"
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title.trim() && setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setTitle("");
                setOpen(false);
              }
            }}
            className="w-full rounded bg-white px-2 py-1 text-[13.5px] outline-none ring-2 ring-grass-400 placeholder:text-mud-400"
          />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="w-full rounded px-2 py-1 text-left text-[13px] text-mud-400 transition hover:bg-mud-100 hover:text-mud-700"
          >
            + New
          </button>
        )}
      </td>
    </tr>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={`${CELL} font-normal ${className}`}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-mud-100 hover:text-mud-800 ${
          active ? "text-mud-800" : ""
        }`}
      >
        {label}
        {active && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
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
      className={`rounded px-1.5 py-0.5 text-[11px] transition ${
        danger
          ? "text-mud-500 hover:bg-red-50 hover:text-red-700"
          : "text-mud-500 hover:bg-mud-200/70 hover:text-mud-800"
      }`}
    >
      {children}
    </button>
  );
}
