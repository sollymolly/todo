"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragStartEvent,
} from "@dnd-kit/core";
import QuestRow, { type RowDrag } from "@/components/QuestRow";
import DuePicker from "@/components/DuePicker";
import { COLOR_KEYS, colorOf } from "@/lib/game";
import { byDeadline, describeDueShort, isOverdue, localInputToIso } from "@/lib/date";
import { addCategory, deleteCategory } from "@/lib/actions";
import type { Category, Subtask, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   One box per category. Every box is the same height — tall enough for three
   quests — whether or not it's full, so the board reads as a tidy grid. Past
   three, the list scrolls inside the box rather than growing it.

   The one exception is an open checklist. A quest with its steps showing is
   several times the height of the row it replaces, and holding the box at its
   resting height left the steps to fight over a three-row window with the
   quests around them. So a box with steps open grows to fit, up to EXPANDED_H,
   and drops back the moment they close. The grid is `items-start` so that
   growth stays local to the one box rather than stretching its whole row.
   -------------------------------------------------------------------------- */

const LIST_H = 234; // ~3 compact rows
const EXPANDED_H = 468; // twice that, the ceiling while a checklist is open
const HEADER_H = 45; // the box header, so the add tile matches a box exactly

/** The key the Uncategorised box goes by, since it has no category id. */
const LOOSE = "__none";

type RowHandlers = {
  onComplete: (todo: Todo, origin: { x: number; y: number }) => void;
  onUncomplete: (todo: Todo) => void;
  onAbandon: (todo: Todo, origin: { x: number; y: number }) => void;
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onStepsChanged: () => void;
};

export type InlineDraft = {
  title: string;
  dueDate: string | null;
  categoryId: string | null;
};

/**
 * The order a box shows its quests in.
 *
 * A quest you have dragged keeps the place you gave it. One you haven't — a new
 * quest, today's habit, or one whose deadline or category was just edited —
 * has no position, and is slotted in by deadline: ahead of the first quest that
 * is due later than it. So a board nobody has rearranged reads in plain
 * deadline order, exactly as it used to, and a new quest still lands where its
 * date says rather than at the bottom of a hand-made list.
 */
export function boardOrder(items: Todo[]): Todo[] {
  const placed = items
    .filter((t) => t.position != null)
    .sort((a, b) => a.position! - b.position! || byDeadline(a, b));
  const out = [...placed];
  for (const t of items.filter((t) => t.position == null).sort(byDeadline)) {
    const at = out.findIndex((o) => byDeadline(t, o) < 0);
    out.splice(at === -1 ? out.length : at, 0, t);
  }
  return out;
}

/** Where a carried quest would land: which box, and before which row. */
type Target = {
  boxKey: string;
  index: number;
  /** The drop line's offset inside the box's scrolling list, in px. */
  y: number;
};

/** How close to an edge dragging starts to scroll, and how fast at most. */
const EDGE = 56;
const LIST_EDGE = 32;
const MAX_SPEED = 16;

type Carrying = {
  todo: Todo;
  width: number;
  /** Where on the row it was grabbed, so the ghost doesn't jump. */
  grab: { x: number; y: number };
  start: { x: number; y: number };
};

export default function CategoryBoard({
  categories,
  todos,
  steps,
  handlers,
  onInlineAdd,
  onPlace,
  onCategoriesChanged,
}: {
  categories: Category[];
  todos: Todo[];
  /** Every quest's checklist, keyed by quest id. */
  steps: Record<string, Subtask[]>;
  handlers: RowHandlers;
  onInlineAdd: (draft: InlineDraft) => Promise<void>;
  /**
   * A quest dropped into a box. `orderedIds` is that box's whole list in its
   * new order, the dropped quest included.
   */
  onPlace: (todoId: string, categoryId: string | null, orderedIds: string[]) => void;
  onCategoriesChanged: () => void;
}) {
  // Everything not finished, so a missed quest stays put and can still be
  // completed late rather than disappearing into the chronicle.
  const unfinished = useMemo(
    () => todos.filter((t) => t.status !== "done"),
    [todos]
  );
  const loose = unfinished.filter((t) => !t.category_id);

  /* -------------------------------------------------------------- dragging

     dnd-kit supplies the sensors — a mouse drag starts after 5px of movement,
     a touch one after a quarter-second hold, which is what lets a finger still
     scroll the page — and swallows the click that would otherwise follow a
     drop. Everything else is done here against the live DOM: which box is
     under the pointer, where between its rows, and the auto-scroll. The boxes
     scroll independently and the page scrolls behind them, and reading real
     rects every frame is the one way to stay right through all of that. */

  const [carrying, setCarrying] = useState<Carrying | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef<Target | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  /** Undoes everything a drag set up: listeners and the frame loop. */
  const teardown = useRef<(() => void) | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const boxes: { key: string; category: Category | null; items: Todo[] }[] = [
    ...categories.map((c) => ({
      key: c.id,
      category: c,
      items: boardOrder(unfinished.filter((t) => t.category_id === c.id)),
    })),
    // Shown while something is being carried even when it's empty, so a quest
    // can be taken out of its category without another loose one to join.
    ...(loose.length || carrying
      ? [{ key: LOOSE, category: null, items: boardOrder(loose) }]
      : []),
  ];

  // Nothing about a drag may outlive the board.
  useEffect(() => () => teardown.current?.(), []);

  function stopTracking() {
    teardown.current?.();
    teardown.current = null;
    pointer.current = null;
    targetRef.current = null;
  }

  function handleDragStart(e: DragStartEvent) {
    const todo = unfinished.find((t) => t.id === e.active.id);
    const row = document.querySelector<HTMLElement>(
      `[data-quest-id="${String(e.active.id)}"]`
    );
    const ev = e.activatorEvent as MouseEvent | TouchEvent;
    const p = "touches" in ev ? ev.touches[0] : ev;
    if (!todo || !row || !p) return;

    const r = row.getBoundingClientRect();
    const start = { x: p.clientX, y: p.clientY };
    pointer.current = start;
    setCarrying({
      todo,
      width: r.width,
      grab: { x: start.x - r.left, y: start.y - r.top },
      start,
    });
    // A short buzz where supported, so a finger knows the hold has taken.
    if ("touches" in ev) navigator.vibrate?.(10);

    const track = (ev: MouseEvent | TouchEvent) => {
      const at = "touches" in ev ? ev.touches[0] : ev;
      if (at) pointer.current = { x: at.clientX, y: at.clientY };
    };
    window.addEventListener("mousemove", track, { passive: true });
    window.addEventListener("touchmove", track, { passive: true });

    let frame = 0;
    const tick = () => {
      const at = pointer.current;
      if (at) {
        if (ghostRef.current)
          ghostRef.current.style.transform = `translate(${at.x}px, ${at.y}px)`;
        scrollNear(at.x, at.y);
        const next = locate(at.x, at.y, todo.id);
        const prev = targetRef.current;
        if (
          next?.boxKey !== prev?.boxKey ||
          next?.index !== prev?.index ||
          next?.y !== prev?.y
        ) {
          targetRef.current = next;
          setTarget(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    teardown.current = () => {
      window.removeEventListener("mousemove", track);
      window.removeEventListener("touchmove", track);
      cancelAnimationFrame(frame);
    };
  }

  function finish(drop: boolean) {
    const carried = carrying?.todo;
    const at = targetRef.current;
    stopTracking();
    setCarrying(null);
    setTarget(null);
    if (!drop || !carried || !at) return;

    const box = boxes.find((b) => b.key === at.boxKey);
    if (!box) return;
    const current = box.items.map((t) => t.id);
    const next = current.filter((id) => id !== carried.id);
    next.splice(at.index, 0, carried.id);

    // Dropped back exactly where it was.
    if (next.length === current.length && next.every((id, i) => id === current[i]))
      return;

    onPlace(carried.id, box.category?.id ?? null, next);
  }

  // Walk the palette so two categories made back-to-back never match. The
  // manager is still there if you want to pick a specific colour.
  const nextColor = COLOR_KEYS[categories.length % COLOR_KEYS.length];

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragEnd={() => finish(true)}
      onDragCancel={() => finish(false)}
    >
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {boxes.map((box) => (
          <Box
            key={box.key}
            boxKey={box.key}
            category={box.category}
            items={box.items}
            steps={steps}
            handlers={handlers}
            onInlineAdd={onInlineAdd}
            onChanged={onCategoriesChanged}
            carryingId={carrying?.todo.id ?? null}
            target={target?.boxKey === box.key ? target : null}
          />
        ))}
        <AddCategoryTile color={nextColor} onAdded={onCategoriesChanged} />
      </div>

      {carrying && (
        <Ghost
          ref={ghostRef}
          carrying={carrying}
          category={categories.find((c) => c.id === carrying.todo.category_id)}
        />
      )}
    </DndContext>
  );
}

/** Which box is under the pointer, and which gap between its rows. */
function locate(x: number, y: number, carriedId: string): Target | null {
  const box = document
    .elementsFromPoint(x, y)
    .map((el) => el.closest<HTMLElement>("[data-drop-box]"))
    .find(Boolean);
  const list = box?.querySelector<HTMLElement>("[data-drop-list]");
  if (!box || !list) return null;

  const rects = Array.from(list.querySelectorAll<HTMLElement>("[data-quest-row]"))
    .filter((r) => r.dataset.questId !== carriedId)
    .map((r) => r.getBoundingClientRect());
  const index = rects.filter((r) => r.top + r.height / 2 < y).length;

  // Halfway into the 6px gap between rows, measured in the list's own
  // scrolled coordinates so the line scrolls with its content.
  const top = list.getBoundingClientRect().top - list.scrollTop;
  const lineY = !rects.length
    ? 4
    : index < rects.length
      ? rects[index].top - top - 3
      : rects[rects.length - 1].bottom - top + 3;

  return { boxKey: box.dataset.dropBox!, index, y: Math.round(lineY) };
}

/**
 * Scrolls the page near the top or bottom of the window, and a box's list near
 * the top or bottom of the box. On a touchscreen this is the only way to
 * reach anything off-screen: the finger is busy carrying.
 */
function scrollNear(x: number, y: number) {
  const speed = (depth: number, edge: number, max: number) =>
    Math.ceil((Math.min(depth, edge) / edge) * max);

  if (y < EDGE) window.scrollBy(0, -speed(EDGE - y, EDGE, MAX_SPEED));
  else if (y > window.innerHeight - EDGE)
    window.scrollBy(0, speed(y - window.innerHeight + EDGE, EDGE, MAX_SPEED));

  const list = document
    .elementsFromPoint(x, y)
    .map((el) => el.closest<HTMLElement>("[data-drop-list]"))
    .find(Boolean);
  if (!list) return;
  const r = list.getBoundingClientRect();
  if (y < r.top + LIST_EDGE)
    list.scrollTop -= speed(r.top + LIST_EDGE - y, LIST_EDGE, MAX_SPEED / 2);
  else if (y > r.bottom - LIST_EDGE)
    list.scrollTop += speed(y - r.bottom + LIST_EDGE, LIST_EDGE, MAX_SPEED / 2);
}

/* The copy of a quest that follows the pointer. Deliberately a light sketch of
   the row rather than the row itself: the real one owns menus, portals and a
   checklist, none of which should exist twice. The drag loop moves it by
   writing a transform straight to the node, so following the pointer costs no
   render per frame. */
function Ghost({
  ref,
  carrying: { todo, width, grab, start },
  category,
}: {
  ref: React.Ref<HTMLDivElement>;
  carrying: Carrying;
  category?: Category;
}) {
  const c = colorOf(category?.color ?? "amber");
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100]"
      style={{ transform: `translate(${start.x}px, ${start.y}px)` }}
    >
      <div
        className="relative -rotate-2 overflow-hidden rounded-xl border border-mud-300 bg-white py-2 pl-3.5 pr-3 shadow-2xl shadow-mud-900/30"
        style={{ width, marginLeft: -grab.x, marginTop: -grab.y }}
      >
        <span className={`absolute inset-y-0 left-0 w-1.5 ${c.dot}`} />
        <p className="truncate text-[13.5px] font-medium text-mud-900">{todo.title}</p>
        {todo.due_date && (
          <p className="mt-0.5 text-[11px] font-semibold text-mud-500">
            {describeDueShort(todo.due_date)}
          </p>
        )}
      </div>
    </div>
  );
}

/* Registers a row with the drag context. The row itself stays put while it is
   carried — the ghost is what moves — so the transform useDraggable offers is
   deliberately ignored. */
function DraggableRow(props: React.ComponentProps<typeof QuestRow>) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: props.todo.id });
  const drag: RowDrag = {
    ref: setNodeRef,
    listeners: listeners as RowDrag["listeners"],
    active: isDragging,
  };
  return <QuestRow {...props} drag={drag} />;
}

function Box({
  boxKey,
  category,
  items,
  steps,
  handlers,
  onInlineAdd,
  onChanged,
  carryingId,
  target,
}: {
  boxKey: string;
  category: Category | null;
  /** Already in display order. */
  items: Todo[];
  steps: Record<string, Subtask[]>;
  handlers: RowHandlers;
  onInlineAdd: (draft: InlineDraft) => Promise<void>;
  onChanged: () => void;
  carryingId: string | null;
  /** Set while a carried quest would land in this box. */
  target: Target | null;
}) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const c = colorOf(category?.color ?? "amber");

  // Read against the quests actually on show, so a quest that leaves the box
  // while its steps are open — completed, deleted, dragged elsewhere — can't
  // leave the box standing tall with nothing expanded in it.
  const grown = items.some((t) => openSteps.has(t.id));

  function setStepsOpen(todoId: string, open: boolean) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (open) next.add(todoId);
      else next.delete(todoId);
      return next;
    });
  }

  const overdue = items.filter((t) => isOverdue(t.due_date)).length;

  function startAdding() {
    setAdding(true);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
  }

  async function remove() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCategory(category.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that category");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section
      data-drop-box={boxKey}
      className={`panel flex flex-col overflow-hidden rounded-2xl transition ${
        // Loud enough to find at a glance across a full board: a stronger
        // border plus a soft red halo, rather than a hairline tint.
        overdue > 0 ? "border-red-500 ring-[3px] ring-red-400/80 shadow-[0_0_0_1px_rgba(220,38,38,0.35),0_8px_24px_-8px_rgba(220,38,38,0.5)]" : ""
      } ${target ? "scale-[1.01] border-grass-500 ring-2 ring-grass-400" : ""}`}
    >
      {/* --------------------------------------------------------- header */}
      <header
        className={`flex items-center gap-2 border-b border-mud-200 px-3 py-2 ${c.head}`}
      >
        <h3 className={`flex-1 truncate font-display text-sm font-bold tracking-wide ${c.text}`}>
          {category?.name ?? "Uncategorised"}
        </h3>

        {overdue > 0 && (
          <span
            className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
            title={`${overdue} past deadline`}
          >
            {overdue} late
          </span>
        )}

        <span className="rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-mud-600">
          {items.length}
        </span>

        <button
          onClick={startAdding}
          aria-label={`Add a quest to ${category?.name ?? "Uncategorised"}`}
          title="Add a quest here"
          className="grid size-6 place-items-center rounded-lg text-lg leading-none text-mud-500 transition hover:bg-white/70 hover:text-grass-700"
        >
          +
        </button>

        {/* Uncategorised isn't a real row, so there's nothing to delete. */}
        {category && (
          <button
            onClick={() => setConfirming(true)}
            aria-label={`Delete the ${category.name} category`}
            title="Delete this category"
            className="grid size-6 place-items-center rounded-lg text-mud-400 transition hover:bg-red-100 hover:text-red-700"
          >
            <TrashIcon />
          </button>
        )}
      </header>

      {/* -------------------------------------------------------- confirm */}
      {confirming && category ? (
        <div
          className="grid place-items-center p-4 text-center"
          style={{ height: LIST_H }}
        >
          <div>
            <p className="font-display text-sm font-bold text-mud-900">
              Delete &ldquo;{category.name}&rdquo;?
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-mud-500">
              {items.length === 0
                ? "It has no quests."
                : `Its ${items.length} quest${items.length === 1 ? "" : "s"} won't be
                   deleted — ${items.length === 1 ? "it becomes" : "they become"} uncategorised.`}
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:bg-mud-300"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
      /* ---------------------------------------------------------- items */
      <div
        ref={listRef}
        data-drop-list=""
        className="relative overflow-y-auto overscroll-contain p-2"
        style={
          grown
            ? { minHeight: LIST_H, maxHeight: EXPANDED_H }
            : { height: LIST_H }
        }
      >
        {/* Where the carried quest will land. Absolute, so showing it never
            shifts the rows it is measured against. */}
        {target && items.length > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-2 z-10 h-[3px] -translate-y-1/2 rounded-full bg-grass-500 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]"
            style={{ top: target.y }}
          />
        )}
        {error && (
          <p className="mb-2 rounded-lg bg-red-100 px-2 py-1.5 text-[11px] font-semibold text-red-800">
            {error}
          </p>
        )}
        <AnimatePresence initial={false}>
          {adding && (
            <InlineComposer
              key="composer"
              categoryId={category?.id ?? null}
              onCancel={() => setAdding(false)}
              onSave={async (draft) => {
                await onInlineAdd(draft);
                setAdding(false);
              }}
            />
          )}
        </AnimatePresence>

        {items.length === 0 && !adding ? (
          <button
            onClick={startAdding}
            className={`flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed px-3 text-xs font-semibold transition ${
              carryingId
                ? "border-grass-400 bg-grass-50/70 text-grass-700"
                : "border-mud-200 text-mud-400 hover:border-grass-400 hover:bg-grass-50 hover:text-grass-700"
            }`}
          >
            {carryingId ? "Drop here" : "+ Add a quest"}
          </button>
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {items.map((t) => (
                <DraggableRow
                  key={t.id}
                  todo={t}
                  category={category ?? undefined}
                  steps={steps[t.id] ?? []}
                  compact
                  showCategory={false}
                  onStepsToggle={(open) => setStepsOpen(t.id, open)}
                  {...handlers}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      )}
    </section>
  );
}

/* Drawn rather than typed: an emoji trash can would put emoji back into a UI
   that deliberately has none. */
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

/* ========================================================================== */
/* Add-a-category tile — the dashed box that trails the real ones             */
/* ========================================================================== */

function AddCategoryTile({
  color,
  onAdded,
}: {
  color: string;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addCategory({ name: trimmed, color });
      setName("");
      setAdding(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that category");
    } finally {
      setBusy(false);
    }
  }

  return (
    /* A parchment fill of its own: the real boxes get theirs from `panel`, and
       without one this tile was a faint outline floating on the scenery. */
    <section
      className="flex flex-col rounded-2xl border-2 border-dashed border-mud-400 bg-mud-50/70 shadow-[0_10px_22px_-14px_rgba(42,30,19,0.45)] backdrop-blur-[2px] transition hover:border-grass-500 hover:bg-grass-50/80"
      style={{ minHeight: LIST_H + HEADER_H }}
    >
      {adding ? (
        <div className="grid h-full place-items-center p-4">
          <div className="w-full">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") {
                  setAdding(false);
                  setName("");
                  setError(null);
                }
              }}
              placeholder="Category name"
              maxLength={40}
              className="field w-full rounded-lg px-3 py-2 text-center text-sm"
            />
            {error && (
              <p className="mt-2 rounded-lg bg-red-100 px-2 py-1.5 text-center text-[11px] font-semibold text-red-800">
                {error}
              </p>
            )}
            <div className="mt-2 flex justify-center gap-2">
              <button
                onClick={save}
                disabled={busy || !name.trim()}
                className="rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
              >
                {busy ? "Adding…" : "Add"}
              </button>
              <button
                onClick={() => {
                  setAdding(false);
                  setName("");
                  setError(null);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-mud-400">
              Enter to save · Esc to cancel
            </p>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="group/add flex h-full w-full flex-1 flex-col items-center justify-center gap-2 rounded-2xl px-3 text-mud-600 transition hover:text-grass-700"
        >
          <span className="grid size-10 place-items-center rounded-full border-2 border-mud-400 text-2xl leading-none transition group-hover/add:border-grass-500 group-hover/add:bg-white/70">
            +
          </span>
          <span className="font-display text-sm font-bold tracking-wide">
            Add a category
          </span>
        </button>
      )}
    </section>
  );
}

/* ========================================================================== */
/* Inline composer — a blank quest card that appears inside the box            */
/* ========================================================================== */

function InlineComposer({
  categoryId,
  onSave,
  onCancel,
}: {
  categoryId: string | null;
  onSave: (draft: InlineDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({
        title,
        dueDate: localInputToIso(due),
        categoryId,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16 }}
      className="mb-1.5 rounded-xl border-2 border-grass-400 bg-white p-2 shadow-sm"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="New quest…"
        maxLength={200}
        className="w-full bg-transparent text-[13.5px] font-medium text-mud-900 outline-none placeholder:text-mud-400"
      />

      <div className="mt-1.5">
        <DuePicker value={due} onChange={setDue} />
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          onClick={save}
          disabled={!title.trim() || busy}
          className="rounded-lg bg-grass-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
        >
          {busy ? "…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-mud-500 transition hover:bg-mud-100"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-mud-400">↵ to save</span>
      </div>
    </motion.div>
  );
}
