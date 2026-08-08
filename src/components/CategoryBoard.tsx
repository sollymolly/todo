"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import QuestRow from "@/components/QuestRow";
import DuePicker from "@/components/DuePicker";
import { colorOf } from "@/lib/game";
import { isOverdue, localInputToIso } from "@/lib/date";
import type { Category, Todo } from "@/lib/types";

/* --------------------------------------------------------------------------
   One box per category. Every box is the same height — tall enough for three
   quests — whether or not it's full, so the board reads as a tidy grid. Past
   three, the list scrolls inside the box rather than growing it.
   -------------------------------------------------------------------------- */

const LIST_H = 234; // ~3 compact rows

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
}: {
  categories: Category[];
  todos: Todo[];
  handlers: RowHandlers;
  onInlineAdd: (draft: InlineDraft) => Promise<void>;
  onMove: (todoId: string, categoryId: string | null, before: Todo | null, after: Todo | null) => void;
}) {
  const open = useMemo(() => todos.filter((t) => t.status === "open"), [todos]);
  const loose = open.filter((t) => !t.category_id);

  const boxes: { key: string; category: Category | null; items: Todo[] }[] = [
    ...categories.map((c) => ({
      key: c.id,
      category: c,
      items: open.filter((t) => t.category_id === c.id),
    })),
    ...(loose.length ? [{ key: "__none", category: null, items: loose }] : []),
  ];

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
        />
      ))}
    </div>
  );
}

function Box({
  category,
  items,
  handlers,
  onInlineAdd,
  onMove,
}: {
  category: Category | null;
  items: Todo[];
  handlers: RowHandlers;
  onInlineAdd: (draft: InlineDraft) => Promise<void>;
  onMove: (todoId: string, categoryId: string | null, before: Todo | null, after: Todo | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState(false);
  const [gap, setGap] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const c = colorOf(category?.color ?? "amber");

  // Manual drag order wins. Anything never dragged falls back to the old
  // rule: soonest deadline first, undated quests at the very bottom.
  const sorted = [...items].sort((a, b) => {
    if (a.position != null && b.position != null) return a.position - b.position;
    if (a.position != null) return -1;
    if (b.position != null) return 1;
    if (!a.due_date && !b.due_date) return b.created_at.localeCompare(a.created_at);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });

  const overdue = items.filter((t) => isOverdue(t.due_date)).length;

  function startAdding() {
    setAdding(true);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
  }

  return (
    <section
      onDragOver={(e) => {
        // Only claim the drop if a quest is what's being dragged.
        if (!e.dataTransfer.types.includes("text/quest-id")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);

        // Which gap between rows is the pointer nearest?
        const rows = Array.from(
          listRef.current?.querySelectorAll<HTMLElement>("[data-quest-row]") ?? []
        );
        let idx = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) {
            idx = i;
            break;
          }
        }
        setGap(idx);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOver(false);
          setGap(null);
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/quest-id");
        const idx = gap ?? sorted.length;
        setOver(false);
        setGap(null);
        if (!id) return;
        e.preventDefault();

        // Neighbours in the target list, ignoring the row being moved.
        const without = sorted.filter((t) => t.id !== id);
        const clamped = Math.min(idx, without.length);
        onMove(
          id,
          category?.id ?? null,
          without[clamped - 1] ?? null,
          without[clamped] ?? null
        );
      }}
      className={`panel flex flex-col overflow-hidden rounded-2xl transition ${
        overdue > 0 ? "border-red-300" : ""
      } ${over ? "scale-[1.01] border-grass-500 ring-2 ring-grass-400" : ""}`}
    >
      {/* --------------------------------------------------------- header */}
      <header
        className={`flex items-center gap-2 border-b border-mud-200 px-3 py-2 ${c.head}`}
      >
        <span className="text-base">{category?.icon ?? "📥"}</span>
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
      </header>

      {/* ---------------------------------------------------------- items */}
      <div
        ref={listRef}
        className="overflow-y-auto overscroll-contain p-2"
        style={{ height: LIST_H }}
      >
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
              {sorted.map((t, i) => (
                <Fragment key={t.id}>
                  {over && gap === i && <Caret />}
                  <QuestRow
                    todo={t}
                    category={category ?? undefined}
                    compact
                    draggable
                    showCategory={false}
                    {...handlers}
                  />
                </Fragment>
              ))}
            </AnimatePresence>
            {over && (gap === null || gap >= sorted.length) && <Caret />}
          </ul>
        )}
      </div>
    </section>
  );
}

function Caret() {
  return (
    <li aria-hidden className="h-1 rounded-full bg-grass-500 shadow-[0_0_6px_rgba(88,154,53,0.6)]" />
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
