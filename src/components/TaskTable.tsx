"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COLOR_KEYS, colorOf } from "@/lib/game";
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
import {
  addColumn,
  deleteColumn,
  renameColumn,
  saveTableLayout,
  setCellValue,
  setColumnOptions,
} from "@/lib/column-actions";
import {
  BUILTINS,
  DEFAULT_CUSTOM_WIDTH,
  DEFAULT_LAYOUT,
  KINDS,
  LOCKED,
  MAX_CUSTOM_COLUMNS,
  clampWidth,
  cleanLayout,
  customKey,
  optionId,
  type BuiltinKey,
  type CellValue,
  type ColumnKind,
  type ColumnValues,
  type TableColumn,
  type TableLayout,
} from "@/lib/table-columns";
import type { Category, Subtask, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   Every quest in one table, edited in place — the same data as the board,
   laid out for scanning and quick changes rather than for doing.

   Modelled on a Notion table: quiet grey headers, a hairline grid, every cell
   editable where it sits, and columns that are yours to arrange. Drag a
   header's edge to resize it; open its menu to sort, rename, hide or delete
   it; "+" adds a column of your own — text, number, checkbox, select or date
   — or brings back a hidden one. The layout is saved to the account, so it's
   the same on every device (migration 023).

   Sorting and filtering happen on the quests already loaded, so they cost no
   request.
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

/** What can be changed from a built-in cell. */
export type QuickEdit = Partial<Pick<Todo, "title" | "due_date" | "category_id" | "notes">>;

type Handlers = {
  onComplete: (todo: Todo, origin: { x: number; y: number }) => void;
  onUncomplete: (todo: Todo) => void;
  onAbandon: (todo: Todo, origin: { x: number; y: number }) => void;
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
};

/** A column as rendered: a built-in, or one of the person's own. */
type Col =
  | { key: string; width: number; builtin: BuiltinKey; label: string }
  | { key: string; width: number; custom: TableColumn; label: string };

const CHECK_W = 36;
const PLUS_W = 44;

const CELL = "border-b border-r border-mud-200 px-2 py-1.5 align-middle";
const PILL =
  "appearance-none rounded-md bg-mud-100 px-2 py-1 text-[12px] text-mud-700 outline-none transition hover:bg-mud-200 focus:ring-2 focus:ring-grass-400";

const KIND_ICON: Record<ColumnKind | "builtin", string> = {
  text: "≡",
  number: "#",
  checkbox: "☑",
  select: "◉",
  date: "▦",
  builtin: "",
};

export default function TaskTable({
  todos,
  categories,
  steps,
  handlers,
  onUpdate,
  onAdd,
  columns: serverColumns,
  values: serverValues,
  layout: serverLayout,
}: {
  todos: Todo[];
  /** In board order, which is also how the category column sorts. */
  categories: Category[];
  steps: Record<string, Subtask[]>;
  handlers: Handlers;
  /** A built-in cell changed. */
  onUpdate: (todo: Todo, changes: QuickEdit) => void;
  /** Typed into the "+ New" row. */
  onAdd: (draft: { title: string; dueDate: string | null; categoryId: string | null }) => Promise<void>;
  /** The person's own columns, their values, and the saved layout. */
  columns: TableColumn[];
  values: ColumnValues;
  layout: unknown;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [statuses, setStatuses] = useState<ReadonlySet<Status>>(DEFAULT_STATUSES);
  const [due, setDue] = useState<DueFilter>("any");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "due", dir: 1 });
  const [error, setError] = useState<string | null>(null);

  /* Custom columns, values and layout are edited here and saved behind the
     scenes; a fresh copy from the server (after any refresh) replaces them.
     Adjusting during render is React's pattern for that, as in Dashboard. */
  const [defs, setDefs] = useState(serverColumns);
  const [vals, setVals] = useState(serverValues);
  const [layout, setLayout] = useState<TableLayout>(() =>
    serverLayout ? cleanLayout(serverLayout) : DEFAULT_LAYOUT
  );
  const [synced, setSynced] = useState({ serverColumns, serverValues, serverLayout });
  if (
    synced.serverColumns !== serverColumns ||
    synced.serverValues !== serverValues ||
    synced.serverLayout !== serverLayout
  ) {
    setSynced({ serverColumns, serverValues, serverLayout });
    setDefs(serverColumns);
    setVals(serverValues);
    if (serverLayout) setLayout(cleanLayout(serverLayout));
  }

  const catById = useMemo(() => new Map(categories.map((c, i) => [c.id, { c, i }])), [categories]);
  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);

  /** The layout, resolved to things that exist — a deleted column just drops out. */
  const cols: Col[] = useMemo(
    () =>
      layout.columns.flatMap((lc): Col[] => {
        if (lc.key.startsWith("custom:")) {
          const def = defById.get(lc.key.slice(7));
          return def ? [{ key: lc.key, width: lc.width, custom: def, label: def.name }] : [];
        }
        const b = BUILTINS.find((x) => x.key === lc.key);
        return b ? [{ key: lc.key, width: lc.width, builtin: b.key, label: b.label }] : [];
      }),
    [layout, defById]
  );

  const hidden = useMemo(() => {
    const shown = new Set(cols.map((c) => c.key));
    return [
      ...BUILTINS.filter((b) => !shown.has(b.key)).map((b) => ({ key: b.key, label: b.label, kind: "builtin" as const })),
      ...defs
        .filter((d) => !shown.has(customKey(d.id)))
        .map((d) => ({ key: customKey(d.id), label: d.name, kind: d.kind })),
    ];
  }, [cols, defs]);

  /* ------------------------------------------------------------ sorting */

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

    const cmp = comparator(sort.key, { catById, defById, steps, vals });
    // Ties fall back to deadline order, so every sort still reads sensibly.
    return filtered.sort((a, b) => sort.dir * cmp(a, b) || byDeadline(a, b));
  }, [todos, statuses, category, query, due, sort, catById, defById, steps, vals]);

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

  /* ------------------------------------------------------------- saving */

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "Couldn't save that change.");
  }

  function persist(next: TableLayout) {
    setLayout(next);
    saveTableLayout(next).catch(fail);
  }

  function resize(key: string, width: number, save: boolean) {
    const next = {
      columns: layout.columns.map((c) => (c.key === key ? { ...c, width: clampWidth(width) } : c)),
    };
    if (save) persist(next);
    else setLayout(next);
  }

  function hide(key: string) {
    if (LOCKED.has(key)) return;
    persist({ columns: layout.columns.filter((c) => c.key !== key) });
  }

  function show(key: string) {
    const b = BUILTINS.find((x) => x.key === key);
    persist({
      columns: [...layout.columns, { key, width: b?.width ?? DEFAULT_CUSTOM_WIDTH }],
    });
  }

  async function create(name: string, kind: ColumnKind) {
    setError(null);
    try {
      const col = await addColumn({ name, kind });
      setDefs((prev) => [...prev, col]);
      persist({ columns: [...layout.columns, { key: customKey(col.id), width: DEFAULT_CUSTOM_WIDTH }] });
    } catch (e) {
      fail(e);
    }
  }

  function rename(def: TableColumn, name: string) {
    setDefs((prev) => prev.map((d) => (d.id === def.id ? { ...d, name } : d)));
    renameColumn(def.id, name).catch(fail);
  }

  function remove(def: TableColumn) {
    setDefs((prev) => prev.filter((d) => d.id !== def.id));
    setVals((prev) => {
      const next: ColumnValues = {};
      for (const [todoId, row] of Object.entries(prev)) {
        const rest = { ...row };
        delete rest[def.id];
        next[todoId] = rest;
      }
      return next;
    });
    persist({ columns: layout.columns.filter((c) => c.key !== customKey(def.id)) });
    deleteColumn(def.id).catch(fail);
  }

  function setCell(todo: Todo, def: TableColumn, value: CellValue | null) {
    setVals((prev) => {
      const row = { ...(prev[todo.id] ?? {}) };
      if (value === null || value === "") delete row[def.id];
      else row[def.id] = value;
      return { ...prev, [todo.id]: row };
    });
    setCellValue(todo.id, def.id, value).catch(fail);
  }

  /** Adds a select option and returns its id, saving the column's new list. */
  function addOption(def: TableColumn, label: string): string {
    const option = {
      id: optionId(),
      label: label.trim().slice(0, 40),
      color: COLOR_KEYS[def.options.length % COLOR_KEYS.length],
    };
    const options = [...def.options, option];
    setDefs((prev) => prev.map((d) => (d.id === def.id ? { ...d, options } : d)));
    setColumnOptions(def.id, options).catch(fail);
    return option.id;
  }

  function centerOf(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  const tableWidth = CHECK_W + PLUS_W + cols.reduce((sum, c) => sum + c.width, 0);

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

      {error && (
        <p className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-800">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss" className="text-red-500 hover:text-red-800">
            ✕
          </button>
        </p>
      )}

      {/* ---------------------------------------------------------- table */}
      {/* Scrolls sideways inside itself when the columns outgrow the page.
          `relative` matters: the screen-reader-only header labels are
          absolutely positioned, and without a positioned ancestor inside the
          scroller they escape it and widen the whole page. */}
      <div className="relative overflow-x-auto">
        <table
          className="table-fixed border-collapse text-left text-[13.5px] text-mud-900"
          style={{ width: tableWidth, minWidth: "100%" }}
        >
          <colgroup>
            <col style={{ width: CHECK_W }} />
            {cols.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: PLUS_W }} />
          </colgroup>
          <thead>
            <tr className="text-[12px] text-mud-500">
              <th className={CELL}>
                <span className="sr-only">Done</span>
              </th>
              {cols.map((c) => (
                <HeaderCell
                  key={c.key}
                  col={c}
                  sort={sort}
                  onSort={(dir) => setSort({ key: c.key, dir })}
                  onResize={(w, save) => resize(c.key, w, save)}
                  onHide={() => hide(c.key)}
                  onRename={"custom" in c ? (name) => rename(c.custom, name) : undefined}
                  onDelete={"custom" in c ? () => remove(c.custom) : undefined}
                />
              ))}
              <th className="border-b border-mud-200 px-1 py-1 align-middle">
                <AddColumn
                  hidden={hidden}
                  atLimit={defs.length >= MAX_CUSTOM_COLUMNS}
                  onShow={show}
                  onCreate={create}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="border-b border-mud-200 px-3 py-8 text-center text-[13px] text-mud-400">
                  {todos.length === 0 ? "No quests yet." : "Nothing matches these filters."}
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const done = statusOf(t) === "done";
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
                      {done && <Tick />}
                    </button>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={`${CELL} overflow-hidden`}>
                      {"custom" in c ? (
                        <CustomCell
                          def={c.custom}
                          value={vals[t.id]?.[c.custom.id]}
                          onChange={(v) => setCell(t, c.custom, v)}
                          onAddOption={(label) => addOption(c.custom, label)}
                        />
                      ) : (
                        <BuiltinCell
                          k={c.builtin}
                          todo={t}
                          done={done}
                          categories={categories}
                          steps={steps[t.id] ?? []}
                          handlers={handlers}
                          onUpdate={onUpdate}
                          centerOf={centerOf}
                        />
                      )}
                    </td>
                  ))}
                  <td className="border-b border-mud-200" />
                </tr>
              );
            })}
            <NewRow
              span={cols.length + 2}
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
/* Sorting                                                                    */
/* ========================================================================== */

function comparator(
  key: string,
  ctx: {
    catById: Map<string, { c: Category; i: number }>;
    defById: Map<string, TableColumn>;
    steps: Record<string, Subtask[]>;
    vals: ColumnValues;
  }
): (a: Todo, b: Todo) => number {
  const rank = (s: Status) => STATUSES.findIndex((x) => x.key === s);
  // Blanks sort after everything, in either direction's natural reading.
  const blanksLast = <T,>(get: (t: Todo) => T | null | undefined, cmp: (x: T, y: T) => number) =>
    (a: Todo, b: Todo) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return cmp(x, y);
    };
  const text = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base" });
  const num = (x: number, y: number) => x - y;

  if (key.startsWith("custom:")) {
    const def = ctx.defById.get(key.slice(7));
    if (!def) return () => 0;
    const get = (t: Todo) => ctx.vals[t.id]?.[def.id];
    switch (def.kind) {
      case "number":
        return blanksLast((t) => get(t) as number | undefined, num);
      case "checkbox":
        return (a, b) => Number(!!get(b)) - Number(!!get(a));
      case "select": {
        const order = (t: Todo) => {
          const i = def.options.findIndex((o) => o.id === get(t));
          return i === -1 ? null : i;
        };
        return blanksLast(order, num);
      }
      default:
        return blanksLast((t) => get(t) as string | undefined, text);
    }
  }

  switch (key as BuiltinKey) {
    case "title":
      return (a, b) => text(a.title, b.title);
    case "category":
      // Uncategorised sorts after every real category.
      return (a, b) => {
        const r = (t: Todo) => (t.category_id ? (ctx.catById.get(t.category_id)?.i ?? 999) : 1000);
        return r(a) - r(b);
      };
    case "status":
      return (a, b) => rank(statusOf(a)) - rank(statusOf(b));
    case "xp":
      return (a, b) => a.xp_awarded - b.xp_awarded;
    case "created":
      return (a, b) => a.created_at.localeCompare(b.created_at);
    case "notes":
      return blanksLast((t) => t.notes, text);
    case "steps":
      return blanksLast((t) => {
        const s = ctx.steps[t.id] ?? [];
        return s.length ? s.filter((x) => x.done).length / s.length : null;
      }, num);
    case "completed":
      return blanksLast((t) => t.completed_at, text);
    default:
      return byDeadline;
  }
}

/* ========================================================================== */
/* Header                                                                     */
/* ========================================================================== */

function HeaderCell({
  col,
  sort,
  onSort,
  onResize,
  onHide,
  onRename,
  onDelete,
}: {
  col: Col;
  sort: { key: string; dir: 1 | -1 };
  onSort: (dir: 1 | -1) => void;
  onResize: (width: number, save: boolean) => void;
  onHide: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}) {
  const active = sort.key === col.key;
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const icon = "custom" in col ? KIND_ICON[col.custom.kind] : "";

  /* Resizing: drag the right edge. Pointer events with capture, so it works
     with a mouse, a pen or a finger, and keeps tracking off the handle. */
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = startW + ev.clientX - startX;
      onResize(last, false);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onResize(last, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function close() {
    setMenu(false);
    setRenaming(null);
    setConfirming(false);
  }

  return (
    <th
      className={`${CELL} group/th relative font-normal`}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          onClick={() => onSort(active && sort.dir === 1 ? -1 : 1)}
          className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 transition hover:bg-mud-100 hover:text-mud-800 ${
            active ? "text-mud-800" : ""
          }`}
          title={`Sort by ${col.label}`}
        >
          {icon && <span aria-hidden className="text-mud-400">{icon}</span>}
          <span className="truncate">{col.label}</span>
          {active && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
        </button>
        <button
          ref={menuBtn}
          onClick={() => (menu ? close() : setMenu(true))}
          aria-label={`${col.label} column options`}
          className="ml-auto shrink-0 rounded px-1 text-mud-400 opacity-0 transition hover:bg-mud-100 hover:text-mud-800 focus:opacity-100 group-hover/th:opacity-100"
        >
          ⋯
        </button>
      </div>

      {/* The resize handle: a thin strip over the column's right border. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${col.label}`}
        onPointerDown={startResize}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1 after:left-[3px] after:w-0.5 after:rounded after:bg-grass-500 after:opacity-0 after:transition hover:after:opacity-100"
      />

      {menu && (
        <Popover anchor={menuBtn} onClose={close}>
          {renaming !== null && onRename ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = renaming.trim();
                if (name) onRename(name.slice(0, 40));
                close();
              }}
              className="p-1"
            >
              <input
                autoFocus
                value={renaming}
                maxLength={40}
                onChange={(e) => setRenaming(e.target.value)}
                aria-label="Column name"
                className="field w-full rounded-md px-2 py-1 text-[13px]"
              />
            </form>
          ) : confirming && onDelete ? (
            <div className="p-2 text-[12px] text-mud-700">
              <p>
                Delete <b>{col.label}</b>? Everything filled in under it goes too.
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => {
                    onDelete();
                    close();
                  }}
                  className="rounded-md bg-red-600 px-2 py-1 text-[12px] font-semibold text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-[12px] hover:bg-mud-100">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {"custom" in col && (
                <p className="px-2 pb-1 pt-0.5 text-[11px] text-mud-400">
                  {KINDS.find((k) => k.kind === col.custom.kind)?.label} column
                </p>
              )}
              {onRename && <MenuItem onClick={() => setRenaming(col.label)}>Rename</MenuItem>}
              <MenuItem onClick={() => { onSort(1); close(); }}>Sort ascending</MenuItem>
              <MenuItem onClick={() => { onSort(-1); close(); }}>Sort descending</MenuItem>
              {!LOCKED.has(col.key) && (
                <MenuItem onClick={() => { onHide(); close(); }}>Hide column</MenuItem>
              )}
              {onDelete && (
                <MenuItem danger onClick={() => setConfirming(true)}>
                  Delete column
                </MenuItem>
              )}
            </>
          )}
        </Popover>
      )}
    </th>
  );
}

/** The "+" at the end of the header: new columns, and hidden ones back. */
function AddColumn({
  hidden,
  atLimit,
  onShow,
  onCreate,
}: {
  hidden: { key: string; label: string; kind: ColumnKind | "builtin" }[];
  atLimit: boolean;
  onShow: (key: string) => void;
  onCreate: (name: string, kind: ColumnKind) => Promise<void>;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ColumnKind>("text");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    await onCreate(n.slice(0, 40), kind);
    setBusy(false);
    setName("");
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((v) => !v)}
        aria-label="Add a column"
        title="Add a column"
        className="grid size-7 place-items-center rounded-md text-lg leading-none text-mud-400 transition hover:bg-mud-100 hover:text-mud-800"
      >
        +
      </button>
      {open && (
        <Popover anchor={btn} onClose={() => setOpen(false)} align="right">
          {atLimit ? (
            <p className="px-2 py-1 text-[12px] text-mud-500">
              That&apos;s the most custom columns you can have. Delete one to add another.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-2 p-1">
              <input
                autoFocus
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                placeholder="Column name"
                aria-label="New column name"
                className="field w-full rounded-md px-2 py-1 text-[13px]"
              />
              <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Column type">
                {KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    role="radio"
                    aria-checked={kind === k.kind}
                    onClick={() => setKind(k.kind)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition ${
                      kind === k.kind ? "bg-grass-100 text-grass-700" : "hover:bg-mud-100"
                    }`}
                  >
                    <span aria-hidden className="w-3 text-center text-mud-400">
                      {KIND_ICON[k.kind]}
                    </span>
                    {k.label}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="w-full rounded-md bg-grass-600 px-2 py-1.5 text-[12px] font-semibold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
              >
                {busy ? "Adding…" : "Add column"}
              </button>
            </form>
          )}
          {hidden.length > 0 && (
            <div className="mt-1 border-t border-mud-200 pt-1">
              <p className="px-2 pb-0.5 pt-1 text-[11px] text-mud-400">Hidden columns</p>
              {hidden.map((h) => (
                <MenuItem
                  key={h.key}
                  onClick={() => {
                    onShow(h.key);
                    setOpen(false);
                  }}
                >
                  <span aria-hidden className="mr-1.5 inline-block w-3 text-center text-mud-400">
                    {KIND_ICON[h.kind]}
                  </span>
                  {h.label}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/**
 * A small floating menu. Portalled and fixed to the viewport: the table
 * scrolls sideways and clips its contents, which would cut a menu in half.
 */
function Popover({
  anchor,
  onClose,
  align = "left",
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const W = 220;

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = align === "right" ? r.right - W : r.left;
      setAt({
        left: Math.max(8, Math.min(left, window.innerWidth - W - 8)),
        top: r.bottom + 4,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  if (!at) return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: at.left, top: at.top, width: W, zIndex: 90 }}
      className="panel max-h-[70vh] overflow-y-auto rounded-lg p-1 text-[13px] font-normal text-mud-800 normal-case"
    >
      {children}
    </div>,
    document.body
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-md px-2 py-1 text-left transition hover:bg-mud-100 ${
        danger ? "text-red-700" : ""
      }`}
    >
      {children}
    </button>
  );
}

/* ========================================================================== */
/* Cells                                                                      */
/* ========================================================================== */

function Tick() {
  return (
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
  );
}

function BuiltinCell({
  k,
  todo: t,
  done,
  categories,
  steps,
  handlers,
  onUpdate,
  centerOf,
}: {
  k: BuiltinKey;
  todo: Todo;
  done: boolean;
  categories: Category[];
  steps: Subtask[];
  handlers: Handlers;
  onUpdate: (todo: Todo, changes: QuickEdit) => void;
  centerOf: (e: React.MouseEvent) => { x: number; y: number };
}) {
  switch (k) {
    case "title":
      return (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {done ? (
              <span className="block truncate px-1 text-mud-400 line-through" title={t.title}>
                {t.title}
              </span>
            ) : (
              <EditableText value={t.title} label="Quest name" onSave={(title) => onUpdate(t, { title })} />
            )}
          </div>
          {/* Row actions surface on hover, as in Notion; always there on a
              touchscreen, which has no hover. */}
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
      );

    case "category": {
      const current = categories.find((c) => c.id === t.category_id);
      const c = colorOf(current?.color ?? "amber");
      return (
        <select
          value={t.category_id ?? ""}
          disabled={done}
          onChange={(e) => onUpdate(t, { category_id: e.target.value || null })}
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

    case "due":
      return (
        <DateTimeCell
          value={t.due_date}
          done={done}
          onChange={(due_date) => onUpdate(t, { due_date })}
        />
      );

    case "status": {
      const meta = STATUSES.find((x) => x.key === statusOf(t))!;
      return <span className={`rounded px-1.5 py-0.5 text-[12px] ${meta.tag}`}>{meta.label}</span>;
    }

    case "xp":
      return t.xp_awarded !== 0 ? (
        <span className={`text-[12px] tabular-nums ${t.xp_awarded > 0 ? "text-grass-700" : "text-red-700"}`}>
          {t.xp_awarded > 0 ? "+" : ""}
          {t.xp_awarded}
        </span>
      ) : (
        <span className="text-[12px] text-mud-300">—</span>
      );

    case "created":
      return <span className="text-[12px] text-mud-500">{shortDate(t.created_at)}</span>;

    case "notes":
      return done ? (
        <span className="block truncate px-1 text-[12.5px] text-mud-500" title={t.notes ?? ""}>
          {t.notes}
        </span>
      ) : (
        <EditableText
          value={t.notes ?? ""}
          label="Notes"
          allowEmpty
          className="text-[12.5px] text-mud-600"
          onSave={(notes) => onUpdate(t, { notes: notes || null })}
        />
      );

    case "steps":
      return steps.length ? (
        <span className="text-[12px] tabular-nums text-mud-600">
          {steps.filter((s) => s.done).length}/{steps.length}
        </span>
      ) : (
        <span className="text-[12px] text-mud-300">—</span>
      );

    case "completed":
      return t.completed_at ? (
        <span className="text-[12px] text-mud-500">{shortDate(t.completed_at)}</span>
      ) : (
        <span className="text-[12px] text-mud-300">—</span>
      );
  }
}

function CustomCell({
  def,
  value,
  onChange,
  onAddOption,
}: {
  def: TableColumn;
  value: CellValue | undefined;
  onChange: (next: CellValue | null) => void;
  onAddOption: (label: string) => string;
}) {
  switch (def.kind) {
    case "text":
      return (
        <EditableText
          value={typeof value === "string" ? value : ""}
          label={def.name}
          allowEmpty
          onSave={(v) => onChange(v || null)}
        />
      );
    case "number":
      return (
        <EditableText
          value={typeof value === "number" ? String(value) : ""}
          label={def.name}
          allowEmpty
          numeric
          className="tabular-nums"
          onSave={(v) => {
            const n = Number(v);
            onChange(v.trim() && Number.isFinite(n) ? n : null);
          }}
        />
      );
    case "checkbox":
      return (
        <button
          onClick={() => onChange(value === true ? null : true)}
          aria-label={def.name}
          aria-pressed={value === true}
          className={`check ${value === true ? "is-checked" : ""}`}
        >
          {value === true && <Tick />}
        </button>
      );
    case "select":
      return <SelectCell def={def} value={typeof value === "string" ? value : null} onChange={onChange} onAddOption={onAddOption} />;
    case "date":
      return (
        <DateCell
          value={typeof value === "string" ? value : null}
          label={def.name}
          onChange={(v) => onChange(v)}
        />
      );
  }
}

/**
 * Text that turns into an input when clicked. Enter or clicking away saves,
 * Escape puts it back. Unless `allowEmpty`, an emptied value isn't saved —
 * a quest needs a name.
 */
function EditableText({
  value,
  label,
  onSave,
  allowEmpty = false,
  numeric = false,
  className = "",
}: {
  value: string;
  label: string;
  onSave: (next: string) => void;
  allowEmpty?: boolean;
  numeric?: boolean;
  className?: string;
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
        aria-label={value ? undefined : `Set ${label}`}
        className={`block min-h-[22px] w-full cursor-text truncate rounded px-1 py-0.5 text-left hover:bg-mud-200/60 ${className}`}
        title={value || undefined}
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (cancelled.current || next === value.trim()) return;
    if (!next && !allowEmpty) return;
    onSave(next.slice(0, 500));
  };

  return (
    <input
      autoFocus
      value={draft}
      aria-label={label}
      inputMode={numeric ? "decimal" : undefined}
      maxLength={500}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`w-full rounded bg-white px-1 py-0.5 outline-none ring-2 ring-grass-400 ${className}`}
    />
  );
}

/** A select column's cell: the chosen option as a tag, which is the picker. */
function SelectCell({
  def,
  value,
  onChange,
  onAddOption,
}: {
  def: TableColumn;
  value: string | null;
  onChange: (next: string | null) => void;
  onAddOption: (label: string) => string;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const current = def.options.find((o) => o.id === value);
  const c = colorOf(current?.color ?? "amber");

  if (adding) {
    return (
      <input
        autoFocus
        value={label}
        maxLength={40}
        placeholder="New option"
        aria-label={`New ${def.name} option`}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          setAdding(false);
          setLabel("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && label.trim()) {
            onChange(onAddOption(label));
            e.currentTarget.blur();
          }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="w-full rounded bg-white px-1 py-0.5 text-[12px] outline-none ring-2 ring-grass-400"
      />
    );
  }

  return (
    <select
      value={current ? current.id : ""}
      onChange={(e) => {
        if (e.target.value === "__new") setAdding(true);
        else onChange(e.target.value || null);
      }}
      aria-label={def.name}
      className={`max-w-full cursor-pointer appearance-none truncate rounded px-1.5 py-0.5 text-[12px] outline-none transition focus:ring-2 focus:ring-grass-400 ${
        current ? `${c.head} ${c.text}` : "bg-transparent text-mud-400 hover:bg-mud-200/60"
      }`}
    >
      <option value="">{current ? "Clear" : "Empty"}</option>
      {def.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
      <option value="__new">+ New option…</option>
    </select>
  );
}

/**
 * The deadline as a tag; click it for a date-and-time input. Clearing the
 * input removes the deadline. Escape leaves it as it was.
 */
function DateTimeCell({
  value,
  done,
  onChange,
}: {
  value: string | null;
  done: boolean;
  onChange: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  if (draft === null) {
    return (
      <button
        onClick={() => {
          if (done) return;
          cancelled.current = false;
          setDraft(isoToLocalInput(value));
        }}
        disabled={done}
        className={`max-w-full truncate rounded px-1.5 py-0.5 text-[12px] transition disabled:cursor-default ${
          !value
            ? "text-mud-400 hover:bg-mud-200/60"
            : done
              ? "bg-mud-100 text-mud-500"
              : URGENCY[urgencyOf(value)]
        }`}
      >
        {value ? describeDue(value) : "Empty"}
      </button>
    );
  }

  const commit = () => {
    const next = localInputToIso(draft);
    setDraft(null);
    if (cancelled.current) return;
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

/** A custom date column: a calendar date, no time. */
function DateCell({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string;
  onChange: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  if (draft === null) {
    return (
      <button
        onClick={() => {
          cancelled.current = false;
          setDraft(value ?? "");
        }}
        className={`max-w-full truncate rounded px-1.5 py-0.5 text-[12px] transition hover:bg-mud-200/60 ${
          value ? "text-mud-700" : "text-mud-400"
        }`}
      >
        {value ? shortDate(`${value}T12:00:00`) : "Empty"}
      </button>
    );
  }

  const commit = () => {
    const next = draft;
    setDraft(null);
    if (cancelled.current || next === (value ?? "")) return;
    onChange(next || null);
  };

  return (
    <input
      type="date"
      autoFocus
      value={draft}
      aria-label={label}
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The "+ New" row. Stays open after each Enter, so a list can be typed out in
 * one go; Escape or clicking away with it empty closes it. A quest added here
 * joins the category being filtered to, if there is one.
 */
function NewRow({
  span,
  categoryId,
  onAdd,
}: {
  span: number;
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
      <td colSpan={span} className="px-2 py-1">
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
            className="w-full max-w-md rounded bg-white px-2 py-1 text-[13.5px] outline-none ring-2 ring-grass-400 placeholder:text-mud-400"
          />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="rounded px-2 py-1 text-left text-[13px] text-mud-400 transition hover:bg-mud-100 hover:text-mud-700"
          >
            + New
          </button>
        )}
      </td>
    </tr>
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
