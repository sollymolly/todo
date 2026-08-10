"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import QuestRow from "@/components/QuestRow";
import DuePicker from "@/components/DuePicker";
import { COLOR_KEYS, colorOf } from "@/lib/game";
import { byDeadline, isOverdue, localInputToIso } from "@/lib/date";
import { addCategory, deleteCategory } from "@/lib/actions";
import type { Category, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   One box per category. Every box is the same height — tall enough for three
   quests — whether or not it's full, so the board reads as a tidy grid. Past
   three, the list scrolls inside the box rather than growing it.
   -------------------------------------------------------------------------- */

const LIST_H = 234; // ~3 compact rows
const HEADER_H = 45; // the box header, so the add tile matches a box exactly

type RowHandlers = {
  onComplete: (todo: Todo, origin: { x: number; y: number }) => void;
  onUncomplete: (todo: Todo) => void;
  onAbandon: (todo: Todo, origin: { x: number; y: number }) => void;
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
};

export type InlineDraft = {
  title: string;
  dueDate: string | null;
  categoryId: string | null;
};

export default function CategoryBoard({
  categories,
  todos,
  handlers,
  onInlineAdd,
  onMove,
  onCategoriesChanged,
}: {
  categories: Category[];
  todos: Todo[];
  handlers: RowHandlers;
  onInlineAdd: (draft: InlineDraft) => Promise<void>;
  onMove: (todoId: string, categoryId: string | null) => void;
  onCategoriesChanged: () => void;
}) {
  // Everything not finished, so a missed quest stays put and can still be
  // completed late rather than disappearing into the chronicle.
  const unfinished = useMemo(
    () => todos.filter((t) => t.status !== "done"),
    [todos]
  );
  const loose = unfinished.filter((t) => !t.category_id);

  const boxes: { key: string; category: Category | null; items: Todo[] }[] = [
    ...categories.map((c) => ({
      key: c.id,
      category: c,
      items: unfinished.filter((t) => t.category_id === c.id),
    })),
    ...(loose.length ? [{ key: "__none", category: null, items: loose }] : []),
  ];

  // Walk the palette so two categories made back-to-back never match. The
  // manager is still there if you want to pick a specific colour.
  const nextColor = COLOR_KEYS[categories.length % COLOR_KEYS.length];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {boxes.map((box) => (
        <Box
          key={box.key}
          category={box.category}
          items={box.items}
          handlers={handlers}
          onInlineAdd={onInlineAdd}
          onMove={onMove}
          onChanged={onCategoriesChanged}
        />
      ))}
      <AddCategoryTile color={nextColor} onAdded={onCategoriesChanged} />
    </div>
  );
}

function Box({
  category,
  items,
  handlers,
  onInlineAdd,
  onMove,
  onChanged,
}: {
  category: Category | null;
  items: Todo[];
  handlers: RowHandlers;
  onInlineAdd: (draft: InlineDraft) => Promise<void>;
  onMove: (todoId: string, categoryId: string | null) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const c = colorOf(category?.color ?? "amber");

  // Deadline order, always. There is deliberately no manual override: a quest
  // has to land in the right place the moment its deadline is edited, and a
  // stored position would silently outrank the date it was meant to reflect.
  const sorted = [...items].sort(byDeadline);

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
      // Dragging still moves a quest between categories — it just no longer
      // decides where in the list it lands, because the deadline does.
      onDragOver={(e) => {
        // Only claim the drop if a quest is what's being dragged.
        if (!e.dataTransfer.types.includes("text/quest-id")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/quest-id");
        setOver(false);
        if (!id) return;
        e.preventDefault();
        onMove(id, category?.id ?? null);
      }}
      className={`panel flex flex-col overflow-hidden rounded-2xl transition ${
        // Loud enough to find at a glance across a full board: a stronger
        // border plus a soft red halo, rather than a hairline tint.
        overdue > 0 ? "border-red-400 ring-2 ring-red-300/70" : ""
      } ${over ? "scale-[1.01] border-grass-500 ring-2 ring-grass-400" : ""}`}
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
        className="overflow-y-auto overscroll-contain p-2"
        style={{ height: LIST_H }}
      >
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

        {sorted.length === 0 && !adding ? (
          <button
            onClick={startAdding}
            className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-mud-200 px-3 text-xs font-semibold text-mud-400 transition hover:border-grass-400 hover:bg-grass-50 hover:text-grass-700"
          >
            + Add a quest
          </button>
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {sorted.map((t) => (
                <QuestRow
                  key={t.id}
                  todo={t}
                  category={category ?? undefined}
                  compact
                  draggable
                  showCategory={false}
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
