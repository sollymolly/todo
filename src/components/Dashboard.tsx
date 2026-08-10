"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import CharacterCard from "@/components/CharacterCard";
import CategoryBoard, { type InlineDraft } from "@/components/CategoryBoard";
import Scenery from "@/components/Scenery";
import CategoryManager from "@/components/CategoryManager";
import QuestForm, { type QuestDraft } from "@/components/QuestForm";
import QuestRow from "@/components/QuestRow";
import LevelUpModal from "@/components/LevelUpModal";
import { FxProvider, useFx } from "@/components/Fx";
import { levelFor, XP } from "@/lib/game";
import { isOverdue } from "@/lib/date";
import {
  abandonTodo,
  addTodo,
  completeTodo,
  deleteTodo,
  moveTodo,
  uncompleteTodo,
  updateTodo,
} from "@/lib/actions";
import { signOut } from "@/lib/auth-actions";
import { forgetPrivateKey } from "@/lib/crypto";
import type { Category, Profile, Todo } from "@/lib/types";

export default function Dashboard(props: {
  profile: Profile;
  categories: Category[];
  todos: Todo[];
  sweptCount: number;
  unread: number;
}) {
  return (
    <FxProvider>
      <Inner {...props} />
    </FxProvider>
  );
}

function Inner({
  profile,
  categories,
  todos: serverTodos,
  sweptCount,
  unread,
}: {
  profile: Profile;
  categories: Category[];
  todos: Todo[];
  sweptCount: number;
  unread: number;
}) {
  const router = useRouter();
  const { celebrate } = useFx();
  const [, startTransition] = useTransition();

  const [todos, setTodos] = useState(serverTodos);
  const [xp, setXp] = useState(profile.xp);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [composer, setComposer] = useState<{
    open: boolean;
    categoryId: string | null;
  }>({ open: false, categoryId: null });
  const [banner, setBanner] = useState<string | null>(
    sweptCount > 0
      ? `${sweptCount} ${sweptCount === 1 ? "oath was" : "oaths were"} broken while you were away.`
      : null
  );
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // The server is authoritative. useState only seeds the first render, so
  // without re-syncing, the list would never pick up rows added or changed by
  // a revalidation — which is exactly why new quests failed to appear.
  // Adjusting during render (rather than in an effect) is React's documented
  // pattern for this and avoids a second render pass.
  const [syncedTodos, setSyncedTodos] = useState(serverTodos);
  if (serverTodos !== syncedTodos) {
    setSyncedTodos(serverTodos);
    setTodos(serverTodos);
  }

  const [syncedXp, setSyncedXp] = useState(profile.xp);
  if (profile.xp !== syncedXp) {
    setSyncedXp(profile.xp);
    setXp(profile.xp);
  }

  /* ---------------------------------------------------------------- data */

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of todos) {
      // Missed quests still count as outstanding — they remain completable.
      if (t.status === "done" || !t.category_id) continue;
      m[t.category_id] = (m[t.category_id] ?? 0) + 1;
    }
    return m;
  }, [todos]);

  const openCount = todos.filter((t) => t.status !== "done").length;
  const overdueCount = todos.filter(
    (t) => t.status !== "done" && isOverdue(t.due_date)
  ).length;

  // Finished quests only. A missed quest hasn't reached its ending yet — it
  // stays on the board where it can still be completed.
  const chronicle = useMemo(
    () =>
      todos
        .filter((t) => t.status === "done")
        .sort((a, b) =>
          (b.completed_at ?? b.created_at).localeCompare(
            a.completed_at ?? a.created_at
          )
        )
        .slice(0, 60),
    [todos]
  );

  const stats = useMemo(() => {
    let done = 0,
      onTime = 0,
      missed = 0;
    for (const t of todos) {
      if (t.status === "done") {
        done++;
        if (t.due_date && t.completed_at && t.completed_at <= t.due_date) onTime++;
        else if (t.due_date) missed++;
      } else if (t.status === "failed") {
        missed++;
      }
    }
    return { done, open: openCount, onTime, missed };
  }, [todos, openCount]);

  /* ------------------------------------------------------------- helpers */

  function applyXp(newXp: number) {
    const before = levelFor(xp);
    const after = levelFor(newXp);
    setXp(newXp);
    if (after > before) window.setTimeout(() => setLevelUp(after), 650);
  }

  function patch(id: string, next: Partial<Todo>) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...next } : t)));
  }

  async function guard(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      startTransition(() => router.refresh());
    }
  }

  /* ------------------------------------------------------------- actions */

  const handleComplete = (todo: Todo, origin: { x: number; y: number }) =>
    guard(async () => {
      const res = await completeTodo(todo.id);
      celebrate({ ...origin, xp: res.delta, label: res.reason });
      patch(todo.id, {
        status: "done",
        completed_at: new Date().toISOString(),
        xp_awarded: res.awarded,
      });
      applyXp(res.xp);
    });

  const handleUncomplete = (todo: Todo) =>
    guard(async () => {
      const res = await uncompleteTodo(todo.id);
      // The server decides where it lands: a quest whose deadline is long past
      // goes back to missed, not open, so the XP settles in one step.
      const missedAgain =
        !!todo.due_date &&
        new Date(todo.due_date).getTime() < Date.now() - XP.graceHours * 3_600_000;
      patch(todo.id, {
        status: missedAgain ? "failed" : "open",
        completed_at: null,
        xp_awarded: res.awarded,
      });
      setXp(res.xp);
    });

  const handleAbandon = (todo: Todo, origin: { x: number; y: number }) =>
    guard(async () => {
      const res = await abandonTodo(todo.id);
      celebrate({ ...origin, xp: res.delta, tone: "bad", label: "oath broken" });
      patch(todo.id, { status: "failed", xp_awarded: res.awarded });
      applyXp(res.xp);
    });

  const handleDelete = (todo: Todo) =>
    guard(async () => {
      setTodos((prev) => prev.filter((t) => t.id !== todo.id));
      await deleteTodo(todo.id);
    });

  const handleAdd = async (draft: QuestDraft) => {
    const created = await addTodo({
      title: draft.title,
      notes: draft.notes,
      dueDate: draft.dueDate,
      categoryId: draft.categoryId,
    });
    // Show it straight away; the revalidation that follows just confirms it.
    if (created) setTodos((prev) => [created, ...prev]);
    setComposer({ open: false, categoryId: null });
  };

  const handleEditSave = async (draft: QuestDraft) => {
    if (!editing) return;
    await updateTodo(editing.id, {
      title: draft.title,
      notes: draft.notes,
      dueDate: draft.dueDate,
      categoryId: draft.categoryId,
    });
    patch(editing.id, {
      title: draft.title,
      notes: draft.notes || null,
      due_date: draft.dueDate,
      category_id: draft.categoryId,
    });
    setEditing(null);
  };

  // The boxes add inline, so this only needs the title/date/category.
  const handleInlineAdd = async (draft: InlineDraft) => {
    const created = await addTodo({
      title: draft.title,
      notes: null,
      dueDate: draft.dueDate,
      categoryId: draft.categoryId,
    });
    if (created) setTodos((prev) => [created, ...prev]);
  };

  const handleMove = (todoId: string, categoryId: string | null) =>
    guard(async () => {
      patch(todoId, { category_id: categoryId });
      await moveTodo(todoId, categoryId);
    });

  function quickAdd(categoryId: string | null) {
    setComposer({ open: true, categoryId });
    requestAnimationFrame(() =>
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    );
  }

  const handlers = {
    onComplete: handleComplete,
    onUncomplete: handleUncomplete,
    onAbandon: handleAbandon,
    onDelete: handleDelete,
    onEdit: (t: Todo) => setEditing(t),
  };

  /* ---------------------------------------------------------------- view */

  return (
    <>
      <Scenery />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
            Questline
          </h1>
          <p className="text-xs font-semibold text-mud-600">
            {openCount > 0
              ? `${openCount} quest${openCount === 1 ? " awaits" : "s await"} you.`
              : "No quests pending. Rest, or find trouble."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/friends"
            className="relative rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            Companions
            {unread > 0 && (
              <span
                aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
          <Link
            href="/account"
            title="Account"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            Account
          </Link>
          <form action={signOut}>
            <button
              onClick={() => forgetPrivateKey()}
              className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-red-400 hover:bg-red-50 hover:text-red-700"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 rounded-xl bg-red-100 px-4 py-2.5 text-sm font-semibold text-red-800 ring-1 ring-inset ring-red-300">
              <span>{banner}</span>
              <button
                onClick={() => setBanner(null)}
                className="shrink-0 text-red-500 transition hover:text-red-800"
              >
                ✕
              </button>
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-100 px-4 py-2.5 text-sm font-semibold text-red-800 ring-1 ring-inset ring-red-300"
          >
            <span>{error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {/* -------------------------------------------------------- left */}
        <div className="lg:sticky lg:top-6">
          <CharacterCard
            name={profile.display_name}
            xp={xp}
            appearance={profile.appearance}
            equipped={profile.equipped}
            stats={stats}
          />
        </div>

        {/* ------------------------------------------------------- right */}
        <div className="min-w-0 space-y-4">
          {/* ------------------------------------------------- composer */}
          {/* Sits above the board: each box below is a layout-animated
              (transformed) element, which would otherwise paint over the
              due-date popover. */}
          <div ref={composerRef} className="relative z-30">
            {composer.open ? (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="panel rounded-2xl p-4"
              >
                <QuestForm
                  key={composer.categoryId ?? "none"}
                  categories={categories}
                  defaultCategoryId={composer.categoryId}
                  autoFocus
                  onSubmit={handleAdd}
                  onCancel={() => setComposer({ open: false, categoryId: null })}
                />
              </motion.div>
            ) : (
              <button
                onClick={() => quickAdd(null)}
                className="panel panel-hover flex w-full items-center gap-2.5 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold text-mud-500 transition hover:text-grass-700"
              >
                                What must be done?
              </button>
            )}
          </div>

          {/* ---------------------------------------------------- board */}
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="font-display text-sm font-bold tracking-wide text-mud-800 drop-shadow-sm">
              Quests
              {overdueCount > 0 && (
                <span className="ml-2 font-sans text-xs font-bold text-red-700">
                  · {overdueCount} past deadline
                </span>
              )}
            </h2>
            <button
              onClick={() => setManaging(true)}
              className="rounded-lg border border-mud-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
              aria-label="Manage categories"
              title="Manage categories"
            >
              Manage
            </button>
          </div>

          <CategoryBoard
            categories={categories}
            todos={todos}
            handlers={handlers}
            onInlineAdd={handleInlineAdd}
            onMove={handleMove}
            onCategoriesChanged={() => startTransition(() => router.refresh())}
          />

          {/* ------------------------------------------------ chronicle */}
          {chronicle.length > 0 && (
            <div>
              <button
                onClick={() => setShowChronicle((v) => !v)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left font-display text-sm font-bold tracking-wide text-mud-800 drop-shadow-sm transition hover:text-grass-700"
              >
                <span className={showChronicle ? "rotate-90" : ""}>▸</span>
                Chronicle
                <span className="font-sans text-xs font-semibold text-mud-500">
                  ({chronicle.length})
                </span>
              </button>

              <AnimatePresence initial={false}>
                {showChronicle && (
                  <motion.ul
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-2 overflow-hidden pt-2"
                  >
                    {chronicle.map((t) => (
                      <QuestRow
                        key={t.id}
                        todo={t}
                        category={categories.find((c) => c.id === t.category_id)}
                        {...handlers}
                      />
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- overlays */}
      <AnimatePresence>
        {managing && (
          <CategoryManager
            categories={categories}
            counts={counts}
            onClose={() => setManaging(false)}
            onChanged={() => startTransition(() => router.refresh())}
          />
        )}

        {editing && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditing(null)}
          >
            <motion.div
              className="panel w-full max-w-lg rounded-2xl p-6"
              initial={{ scale: 0.94, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-3 font-display text-xl font-bold tracking-wide text-mud-900">
                Edit quest
              </h2>
              <QuestForm
                categories={categories}
                initial={editing}
                submitLabel="Save changes"
                autoFocus
                onSubmit={handleEditSave}
                onCancel={() => setEditing(null)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <LevelUpModal
          level={levelUp}
          appearance={profile.appearance}
          equipped={profile.equipped}
          onClose={() => {
            setLevelUp(null);
            startTransition(() => router.refresh());
          }}
        />
      </main>
    </>
  );
}
