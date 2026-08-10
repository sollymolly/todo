"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import CharacterCard from "@/components/CharacterCard";
import HabitList from "@/components/HabitList";
import CategoryBoard, { type InlineDraft } from "@/components/CategoryBoard";
import Scenery from "@/components/Scenery";
import CategoryManager from "@/components/CategoryManager";
import CategoryStrength from "@/components/CategoryStrength";
import QuestForm, { type QuestDraft } from "@/components/QuestForm";
import QuestRow from "@/components/QuestRow";
import LevelUpModal from "@/components/LevelUpModal";
import UpdatesModal from "@/components/UpdatesModal";
import TimezoneSync from "@/components/TimezoneSync";
import HeaderMenu from "@/components/HeaderMenu";
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
import { addHabit } from "@/lib/habit-actions";
import type { Habit } from "@/lib/habits";
import type { Category, Profile, Subtask, Todo } from "@/lib/types";
import type { Update } from "@/lib/updates";

export default function Dashboard(props: {
  profile: Profile;
  categories: Category[];
  todos: Todo[];
  steps: Record<string, Subtask[]>;
  /** The recurring definitions. Today's instances are already in `todos`. */
  habits: Habit[];
  sweptCount: number;
  unread: number;
  update: Update | null;
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
  steps,
  habits,
  sweptCount,
  unread,
  update,
}: {
  profile: Profile;
  categories: Category[];
  todos: Todo[];
  steps: Record<string, Subtask[]>;
  habits: Habit[];
  sweptCount: number;
  unread: number;
  update: Update | null;
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
  const [showHabits, setShowHabits] = useState(true);
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

  // Habits whose instance is on the board and still unticked. Read off the
  // habit rows rather than the todos, so "due today" means what the schedule
  // says even when the instance has been moved or renamed.
  const waitingToday = habits.filter(
    (h) => h.active && !h.finished && h.due_today && !h.done_today
  ).length;

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

  // Finished quests are deleted after a week, so a plain count over `todos`
  // would quietly slide back towards zero. Every total is the durable counter
  // plus whatever is still on the board.
  const stats = useMemo(() => {
    let done = profile.archived_done ?? 0;
    let onTime = profile.archived_on_time ?? 0;
    let missed = profile.archived_late ?? 0;
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
  }, [todos, openCount, profile.archived_done, profile.archived_on_time, profile.archived_late]);

  /* ------------------------------------------------------------- helpers */

  function applyXp(newXp: number) {
    // XP is floored at the current level's threshold server-side, so a level
    // can only ever go up — this just notices when it does.
    const before = levelFor(xp);
    const after = levelFor(newXp);
    setXp(newXp);
    if (after > before) window.setTimeout(() => setLevelUp(after), 650);
  }

  /** Local wall-clock minutes past midnight, for a habit's daily cut-off. */
  function minutesOfDay(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
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
    if (draft.repeatDays) {
      // A repeating quest is a habit, not a todo. The server creates the
      // definition and materialises today's instance, so there is nothing
      // sensible to add optimistically — refresh and let it appear.
      const res = await addHabit({
        title: draft.title,
        days: draft.repeatDays,
        categoryId: draft.categoryId,
        // Only the time matters to a habit; a repeating thing has no one date.
        dueMinutes: draft.dueDate ? minutesOfDay(draft.dueDate) : undefined,
        endsOn: draft.endsOn,
        occurrencesLimit: draft.occurrencesLimit,
      });
      if (!res.ok) throw new Error(res.error);
      setComposer({ open: false, categoryId: null });
      startTransition(() => router.refresh());
      return;
    }

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
    // Steps live on the server, not in `todos`, so a write there needs a
    // refresh to reach the progress chip.
    onStepsChanged: () => startTransition(() => router.refresh()),
  };

  /* ---------------------------------------------------------------- view */

  return (
    <>
      <Scenery />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
            HabitKnight
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/habits"
            title="Recurring habits"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            Habits
          </Link>
          {/* The badge lives on Messages rather than Companions: an unread
              count is about conversations, not about the friend list. */}
          <Link
            href="/friends"
            title="Your conversations"
            className="relative rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            Messages
            {unread > 0 && (
              <span
                aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>

          {/* Companions, What's new, Feedback, Account and Sign out all live in
              here. Six competing buttons made none of them findable. */}
          <HeaderMenu
            name={profile.display_name}
            hasUnseenUpdate={!!update}
          />
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

          {/* Matches the 24px grid gap either side, so the left column reads
              with the same rhythm as the rest of the board. */}
          <div className="mt-6">
            <CategoryStrength categories={categories} todos={todos} />
          </div>
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
            steps={steps}
            handlers={handlers}
            onInlineAdd={handleInlineAdd}
            onMove={handleMove}
            onCategoriesChanged={() => startTransition(() => router.refresh())}
          />

          {/* --------------------------------------------------- habits */}
          {/* Below the board, because the board is what gets done today and a
              habit is the standing commitment behind it. Collapsible for the
              same reason the chronicle is: forty habits shouldn't push the
              quests off the screen. */}
          <div>
            {/* The toggle and the link are siblings rather than nested: a link
                inside a button is neither valid nor clickable in peace. */}
            <div className="flex items-center gap-2 px-1">
              <button
                onClick={() => setShowHabits((v) => !v)}
                aria-expanded={showHabits}
                className="flex flex-1 items-center gap-2 rounded-lg py-1.5 text-left font-display text-sm font-bold tracking-wide text-mud-800 drop-shadow-sm transition hover:text-grass-700"
              >
                <span className={showHabits ? "rotate-90" : ""}>▸</span>
                Habits
                {habits.length > 0 && (
                  <span className="font-sans text-xs font-semibold text-mud-500">
                    ({habits.length})
                  </span>
                )}
                {waitingToday > 0 && (
                  <span className="font-sans text-xs font-bold text-amber-700">
                    · {waitingToday} waiting today
                  </span>
                )}
              </button>
              <Link
                href="/habits"
                className="shrink-0 rounded-lg border border-mud-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
              >
                {habits.length > 0 ? "Manage" : "New habit"}
              </Link>
            </div>

            <AnimatePresence initial={false}>
              {showHabits && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden pt-2"
                >
                  {habits.length === 0 ? (
                    <p className="panel rounded-2xl px-4 py-3 text-xs leading-relaxed text-mud-500">
                      Nothing recurring yet. Add a quest with a repeat and it
                      becomes a habit — a fresh quest appears on the board each
                      day it&apos;s due, and the streak is counted here.
                    </p>
                  ) : (
                    <HabitList
                      habits={habits}
                      categories={categories}
                      compact
                      onChanged={() => startTransition(() => router.refresh())}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
                        steps={steps[t.id] ?? []}
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

      {/* The changelog sits above the board but below nothing else, so it is
          the first thing seen on the first visit of the week. */}
      {update && <UpdatesModal update={update} />}

      {/* Reports the browser's timezone so habits roll over at the user's
          midnight. Delete this and src/lib/timezone.ts to drop the feature. */}
      <TimezoneSync stored={profile.timezone ?? null} />

      {/* Reports the browser's timezone so habits roll over at the user's
          midnight. Delete this and src/lib/timezone.ts to drop the feature. */}
      <TimezoneSync stored={profile.timezone ?? null} />

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
              /* Bounded and scrollable: with a long note plus an open date
                 picker this panel outgrows a short viewport, and without this
                 the overflow was simply unreachable. */
              className="panel max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-2xl p-6"
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
