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
const HEADER_H = 38; // the box header, so the add tile matches a box exactly

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

/** Where a carried section would land: before the index-th other section. */
type Slot = {
  index: number;
  /** The drop marker, in the grid's own coordinates. */
  bar: { left: number; top: number; width: number; height: number };
};

/** The drag id a section's header registers under, next to the quests' ids. */
const SECTION = "section:";

type Carrying = {
  width: number;
  /** Where it was grabbed, so the ghost doesn't jump. */
  grab: { x: number; y: number };
  start: { x: number; y: number };
} & ({ kind: "quest"; todo: Todo } | { kind: "section"; category: Category });

export default function CategoryBoard({
  categories,
  todos,
  steps,
  handlers,
  onInlineAdd,
  onPlace,
  onReorderSections,
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
  /** Every category's id, in the order the sections were just dragged into. */
  onReorderSections: (orderedIds: string[]) => void;
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
  const [slot, setSlot] = useState<Slot | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef<Target | null>(null);
  const slotRef = useRef<Slot | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Undoes everything a drag set up: listeners and the frame loop. */
  const teardown = useRef<(() => void) | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  // The order a dropped section was given, shown straight away and dropped
  // again as soon as the server's order arrives to replace it.
  const [order, setOrder] = useState<string[] | null>(null);
  const [syncedCategories, setSyncedCategories] = useState(categories);
  if (categories !== syncedCategories) {
    setSyncedCategories(categories);
    setOrder(null);
  }
  const sections = order
    ? [
        ...order.flatMap((id) => categories.filter((c) => c.id === id)),
        ...categories.filter((c) => !order.includes(c.id)),
      ]
    : categories;

  const boxes: { key: string; category: Category | null; items: Todo[] }[] = [
    ...sections.map((c) => ({
      key: c.id,
      category: c,
      items: boardOrder(unfinished.filter((t) => t.category_id === c.id)),
    })),
    // Shown while something is being carried even when it's empty, so a quest
    // can be taken out of its category without another loose one to join.
    ...(loose.length || carrying?.kind === "quest"
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
    slotRef.current = null;
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const ev = e.activatorEvent as MouseEvent | TouchEvent;
    const p = "touches" in ev ? ev.touches[0] : ev;
    if (!p) return;
    const start = { x: p.clientX, y: p.clientY };

    // A section is carried by its header, a quest by its row. Either way the
    // ghost starts as a copy of what was picked up, held where it was grabbed.
    const category = id.startsWith(SECTION)
      ? categories.find((c) => c.id === id.slice(SECTION.length))
      : undefined;
    const todo = category ? undefined : unfinished.find((t) => t.id === id);
    const el = document.querySelector<HTMLElement>(
      category ? `[data-section="${category.id}"] header` : `[data-quest-id="${id}"]`
    );
    if (!el || (!category && !todo)) return;

    const r = el.getBoundingClientRect();
    const held = { width: r.width, grab: { x: start.x - r.left, y: start.y - r.top }, start };
    pointer.current = start;
    setCarrying(
      category ? { kind: "section", category, ...held } : { kind: "quest", todo: todo!, ...held }
    );
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
        scrollNear(at.x, at.y, !category);
        if (category) {
          const next = gridRef.current && locateSection(gridRef.current, at.x, at.y, category.id);
          if (JSON.stringify(next) !== JSON.stringify(slotRef.current)) {
            slotRef.current = next;
            setSlot(next);
          }
        } else {
          const next = locate(at.x, at.y, id);
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
    const at = targetRef.current;
    const landing = slotRef.current;
    stopTracking();
    setCarrying(null);
    setTarget(null);
    setSlot(null);
    if (!drop || !carrying) return;

    if (carrying.kind === "section") {
      if (!landing) return;
      const current = sections.map((c) => c.id);
      const next = current.filter((id) => id !== carrying.category.id);
      next.splice(landing.index, 0, carrying.category.id);
      if (next.every((id, i) => id === current[i])) return;
      setOrder(next);
      onReorderSections(next);
      return;
    }

    const carried = carrying.todo;
    if (!at) return;

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
      <div ref={gridRef} className="relative grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {/* Where a carried section will land: a bar in the gap before the
            section it would push along. Absolute, so it takes no grid cell. */}
        {slot && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 rounded-full bg-grass-500 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]"
            style={slot.bar}
          />
        )}
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
            carryingId={carrying?.kind === "quest" ? carrying.todo.id : null}
            carryingSection={carrying?.kind === "section" && carrying.category.id === box.key}
            target={target?.boxKey === box.key ? target : null}
          />
        ))}
        <AddCategoryTile color={nextColor} onAdded={onCategoriesChanged} />
      </div>

      {carrying && <Ghost ref={ghostRef} carrying={carrying} categories={categories} />}
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
 * Where a carried section would land among the others, in reading order.
 *
 * On a phone the sections stack in one column, so it's above or below the
 * middle of each; in a grid, a section counts as passed once the pointer is
 * below its row, or level with it and past its middle.
 */
function locateSection(grid: HTMLElement, x: number, y: number, carriedId: string): Slot | null {
  const rects = Array.from(grid.querySelectorAll<HTMLElement>("[data-section]"))
    .filter((el) => el.dataset.section !== carriedId)
    .map((el) => el.getBoundingClientRect());
  if (!rects.length) return null;

  const g = grid.getBoundingClientRect();
  const oneColumn = getComputedStyle(grid).gridTemplateColumns.split(" ").length === 1;
  const index = rects.filter((r) =>
    oneColumn
      ? r.top + r.height / 2 < y
      : y > r.bottom || (y >= r.top && x > r.left + r.width / 2)
  ).length;

  // Centred in the 12px grid gap, beside or above the section it lands before
  // — or after the last one.
  const at = rects[Math.min(index, rects.length - 1)];
  const after = index >= rects.length;
  const bar = oneColumn
    ? { left: 0, width: g.width, height: 4, top: (after ? at.bottom + 6 : at.top - 6) - g.top - 2 }
    : { top: at.top - g.top, height: at.height, width: 4, left: (after ? at.right + 6 : at.left - 6) - g.left - 2 };

  return { index, bar: { ...bar, top: Math.round(bar.top), left: Math.round(bar.left) } };
}

/**
 * Scrolls the page near the top or bottom of the window, and a box's list near
 * the top or bottom of the box. On a touchscreen this is the only way to
 * reach anything off-screen: the finger is busy carrying.
 */
function scrollNear(x: number, y: number, lists = true) {
  const speed = (depth: number, edge: number, max: number) =>
    Math.ceil((Math.min(depth, edge) / edge) * max);

  if (y < EDGE) window.scrollBy(0, -speed(EDGE - y, EDGE, MAX_SPEED));
  else if (y > window.innerHeight - EDGE)
    window.scrollBy(0, speed(y - window.innerHeight + EDGE, EDGE, MAX_SPEED));
  if (!lists) return;

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

/* The copy of whatever is being carried that follows the pointer. Deliberately
   a light sketch rather than the real thing: a row owns menus, portals and a
   checklist, and a section owns a whole list, none of which should exist
   twice. The drag loop moves it by writing a transform straight to the node,
   so following the pointer costs no render per frame. */
function Ghost({
  ref,
  carrying,
  categories,
}: {
  ref: React.Ref<HTMLDivElement>;
  carrying: Carrying;
  categories: Category[];
}) {
  const { width, grab, start } = carrying;
  const category =
    carrying.kind === "section"
      ? carrying.category
      : categories.find((c) => c.id === carrying.todo.category_id);
  const c = colorOf(category?.color ?? "amber");
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100]"
      style={{ transform: `translate(${start.x}px, ${start.y}px)` }}
    >
      <div
        className={`relative -rotate-2 overflow-hidden rounded-xl border border-mud-300 py-2 pl-3.5 pr-3 shadow-2xl shadow-mud-900/30 ${
          carrying.kind === "section" ? c.head : "bg-white"
        }`}
        style={{ width, marginLeft: -grab.x, marginTop: -grab.y }}
      >
        <span className={`absolute inset-y-0 left-0 w-1.5 ${c.dot}`} />
        {carrying.kind === "section" ? (
          <p className={`truncate text-sm font-semibold ${c.text}`}>
            {carrying.category.name}
          </p>
        ) : (
          <>
            <p className="truncate text-[13.5px] font-medium text-mud-900">
              {carrying.todo.title}
            </p>
            {carrying.todo.due_date && (
              <p className="mt-0.5 text-[11px] font-semibold text-mud-500">
                {describeDueShort(carrying.todo.due_date)}
              </p>
            )}
          </>
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
  carryingSection,
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
  /** This whole section is the one being carried. */
  carryingSection: boolean;
  /** Set while a carried quest would land in this box. */
  target: Target | null;
}) {
  // Sections are picked up by the header. Uncategorised always trails the
  // real categories, so it can't be.
  const { setNodeRef: sectionRef, listeners: sectionListeners } = useDraggable({
    id: `${SECTION}${category?.id ?? LOOSE}`,
    disabled: !category,
  });
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
      data-section={category?.id}
      className={`panel flex flex-col overflow-hidden rounded-xl transition ${
        // A red edge is enough to find a late box on a calm board; the red
        // "late" tag in the header says how many.
        overdue > 0 ? "border-red-300" : ""
      } ${target ? "border-grass-500 ring-2 ring-grass-400" : ""} ${
        carryingSection ? "opacity-40" : ""
      }`}
    >
      {/* --------------------------------------------------------- header */}
      <header
        ref={sectionRef}
        {...(category ? sectionListeners : {})}
        title={category ? "Drag to move this section" : undefined}
        className={`flex items-center gap-1.5 px-3 pb-1 pt-2.5 ${
          category ? "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]" : ""
        }`}
      >
        {/* The name as a coloured tag, the way a board groups by a select
            property. The box itself stays neutral. */}
        <h3 className="min-w-0 flex-1 truncate">
          <span
            className={`rounded px-1.5 py-0.5 text-[13px] font-medium ${
              category ? `${c.head} ${c.text}` : "bg-mud-200 text-mud-700"
            }`}
          >
            {category?.name ?? "Uncategorised"}
          </span>
          <span className="ml-1.5 text-[12px] tabular-nums text-mud-400">{items.length}</span>
        </h3>

        {overdue > 0 && (
          <span
            className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700"
            title={`${overdue} past deadline`}
          >
            {overdue} late
          </span>
        )}

        <button
          onClick={startAdding}
          aria-label={`Add a quest to ${category?.name ?? "Uncategorised"}`}
          title="Add a quest here"
          className="grid size-6 place-items-center rounded-md text-lg leading-none text-mud-400 transition hover:bg-mud-100 hover:text-mud-800"
        >
          +
        </button>

        {/* Uncategorised isn't a real row, so there's nothing to delete. */}
        {category && (
          <button
            onClick={() => setConfirming(true)}
            aria-label={`Delete the ${category.name} category`}
            title="Delete this category"
            className="grid size-6 place-items-center rounded-md text-mud-400 transition hover:bg-red-50 hover:text-red-700"
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
            <p className="text-sm font-semibold text-mud-900">
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
        // No overscroll-contain: once the list hits its top or bottom, the
        // wheel or swipe should carry on and scroll the page, not stop dead.
        className="relative overflow-y-auto p-2"
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
            className={`flex h-full w-full items-center justify-center rounded-lg px-3 text-[13px] transition ${
              carryingId
                ? "border border-dashed border-grass-400 bg-grass-100/60 text-grass-700"
                : "text-mud-400 hover:bg-mud-100 hover:text-mud-700"
            }`}
          >
            {carryingId ? "Drop here" : "+ New"}
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
    /* A translucent ivory fill of its own: the real boxes get theirs from
       `panel`, and without one this tile was a faint outline on the scenery. */
    <section
      className="flex flex-col rounded-xl border border-dashed border-mud-400/70 bg-mud-50/60 backdrop-blur-[2px] transition hover:border-mud-500 hover:bg-mud-50/85"
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
          className="flex h-full w-full flex-1 items-center justify-center rounded-xl px-3 text-sm text-mud-500 transition hover:text-mud-800"
        >
          + Add a category
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
      className="mb-1.5 rounded-lg border border-mud-300 bg-white p-2 shadow-[0_1px_2px_rgba(15,15,15,0.06)] focus-within:border-grass-500"
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
