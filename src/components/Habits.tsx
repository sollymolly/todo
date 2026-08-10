"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addHabit,
  deleteHabit,
  setHabitActive,
  type Cadence,
  type Habit,
} from "@/lib/habit-actions";
import { colorOf } from "@/lib/game";
import type { Category } from "@/lib/types";

/* --------------------------------------------------------------------------
   The recurring habits page.

   Each habit is a definition; the quest you tick lives on the board with
   everything else. This page is for the shape of the commitment — how often,
   in which category, how long the run is — not for doing today's.
   -------------------------------------------------------------------------- */

const CADENCES: { id: Cadence; label: string; hint: string }[] = [
  { id: "daily", label: "Every day", hint: "appears every morning" },
  { id: "weekdays", label: "Weekdays", hint: "Monday to Friday" },
  { id: "weekly", label: "Once a week", hint: "on a day you choose" },
];

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

function describe(h: Habit): string {
  if (h.cadence === "daily") return "Every day";
  if (h.cadence === "weekdays") return "Weekdays";
  return `Every ${DAYS.find((d) => d.n === h.weekday)?.label ?? "Mon"}`;
}

export default function Habits({
  habits,
  categories,
  timezone,
}: {
  habits: Habit[];
  categories: Category[];
  timezone: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [weekday, setWeekday] = useState(1);
  const [categoryId, setCategoryId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await addHabit({
      title,
      cadence,
      weekday,
      categoryId: categoryId || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setTitle("");
    refresh();
  }

  const active = habits.filter((h) => h.active);
  const paused = habits.filter((h) => !h.active);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
            Habits
          </h1>
          <p className="text-xs font-semibold text-mud-600">
            {active.length === 0
              ? "Things you mean to do again and again."
              : `${active.length} running · a fresh quest appears each time one is due.`}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
        >
          ← Back to quests
        </Link>
      </header>

      {/* ------------------------------------------------------------- new */}
      <section className="panel rounded-2xl p-5">
        <h2 className="font-display text-sm font-bold tracking-wide text-mud-800">
          New habit
        </h2>
        <form onSubmit={create} className="mt-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Go for a run"
            maxLength={200}
            className="field w-full rounded-xl px-3.5 py-2.5 text-sm"
          />

          <div className="mt-3 flex flex-wrap gap-1.5">
            {CADENCES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCadence(c.id)}
                title={c.hint}
                className={`rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition ${
                  cadence === c.id
                    ? "border-grass-600 bg-grass-600 text-white"
                    : "border-mud-200 bg-white/70 text-mud-600 hover:border-mud-400"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {cadence === "weekly" && (
            <div className="mt-2 flex flex-wrap gap-1">
              {DAYS.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => setWeekday(d.n)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                    weekday === d.n
                      ? "bg-mud-800 text-mud-50"
                      : "bg-white/70 text-mud-500 hover:bg-white"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}

          {categories.length > 0 && (
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="field mt-3 w-full rounded-xl px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="mt-3 w-full rounded-xl bg-grass-600 px-4 py-2.5 font-display text-sm font-bold tracking-wide text-white transition hover:bg-grass-500 disabled:bg-mud-300"
          >
            {busy ? "Adding…" : "Add habit"}
          </button>
        </form>

        <p className="mt-3 text-[10px] leading-relaxed text-mud-400">
          Due at the end of the day
          {timezone ? ` in ${timezone.replace(/_/g, " ")}` : " (UTC)"}. Each one
          becomes a normal quest on the board, worth the usual XP.
        </p>
      </section>

      {/* --------------------------------------------------------- running */}
      {habits.length > 0 && (
        <ul className="mt-6 space-y-2">
          {[...active, ...paused].map((h) => {
            const cat = categories.find((c) => c.id === h.category_id);
            const col = colorOf(cat?.color ?? "amber");
            return (
              <li
                key={h.id}
                className={`panel rounded-2xl p-4 ${h.active ? "" : "opacity-60"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-bold text-mud-900">
                      {h.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-mud-500">
                      {describe(h)}
                      {cat && (
                        <>
                          {" · "}
                          <span className={`font-semibold ${col.text}`}>
                            {cat.name}
                          </span>
                        </>
                      )}
                      {!h.active && " · paused"}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-bold tabular-nums text-mud-800">
                      {h.streak}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-mud-400">
                      {h.streak === 1 ? "day" : "days"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {h.active && h.due_today && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                        h.done_today
                          ? "bg-grass-100 text-grass-700 ring-grass-300"
                          : "bg-amber-100 text-amber-800 ring-amber-300"
                      }`}
                    >
                      {h.done_today ? "done today" : "waiting on the board"}
                    </span>
                  )}
                  {h.best_streak > h.streak && (
                    <span className="rounded-md bg-mud-100 px-1.5 py-0.5 text-[11px] font-semibold text-mud-500">
                      best {h.best_streak}
                    </span>
                  )}

                  <span className="ml-auto flex gap-1.5">
                    <button
                      onClick={async () => {
                        await setHabitActive(h.id, !h.active);
                        refresh();
                      }}
                      className="rounded-lg border border-mud-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
                    >
                      {h.active ? "Pause" : "Resume"}
                    </button>
                    <Remove
                      onConfirm={async () => {
                        await deleteHabit(h.id);
                        refresh();
                      }}
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function Remove({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        onClick={() => setAsking(true)}
        className="rounded-lg border border-mud-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-red-400 hover:bg-red-50 hover:text-red-700"
      >
        Delete
      </button>
    );
  return (
    <>
      <button
        onClick={onConfirm}
        title="Deletes the habit and any instance still outstanding"
        className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-red-700"
      >
        Delete
      </button>
      <button
        onClick={() => setAsking(false)}
        className="rounded-lg px-2 py-1 text-[11px] font-semibold text-mud-500 hover:text-mud-900"
      >
        No
      </button>
    </>
  );
}
