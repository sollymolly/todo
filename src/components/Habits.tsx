"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addHabit, deleteHabit, setHabitActive } from "@/lib/habit-actions";
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  WEEKEND_ONLY,
  describeDays,
  type Habit,
} from "@/lib/habits";
import { colorOf } from "@/lib/game";
import type { Category } from "@/lib/types";

/* --------------------------------------------------------------------------
   The recurring habits page.

   Each habit is a definition; the quest you tick lives on the board with
   everything else. This page is for the shape of the commitment — how often,
   in which category, how long the run is — not for doing today's.
   -------------------------------------------------------------------------- */

/** Shortcuts that just fill in the day set; "Custom" leaves it to the chips. */
const PRESETS: { label: string; days: number[] | null }[] = [
  { label: "Every day", days: EVERY_DAY },
  { label: "Weekdays", days: WEEKDAYS_ONLY },
  { label: "Weekends", days: WEEKEND_ONLY },
  { label: "Custom", days: null },
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

/** "Every day · until 30 Sep" / "Mon, Wed, Fri · 3 of 10" */
function describe(h: Habit): string {
  const parts = [describeDays(h.days)];
  if (h.occurrences_limit)
    parts.push(`${h.occurrences_made} of ${h.occurrences_limit}`);
  else if (h.ends_on)
    parts.push(
      `until ${new Date(`${h.ends_on}T00:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })}`
    );
  return parts.join(" · ");
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
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
  const [days, setDays] = useState<number[]>(EVERY_DAY);
  const [custom, setCustom] = useState(false);
  const [stop, setStop] = useState<"never" | "on" | "after">("never");
  const [endsOn, setEndsOn] = useState("");
  const [times, setTimes] = useState("10");
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
      days,
      categoryId: categoryId || null,
      endsOn: stop === "on" ? endsOn || null : null,
      occurrencesLimit: stop === "after" ? Number(times) || null : null,
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
            {PRESETS.map((p) => {
              const on = p.days
                ? !custom && sameDays(days, p.days)
                : custom;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    if (p.days) {
                      setCustom(false);
                      setDays(p.days);
                    } else {
                      setCustom(true);
                    }
                  }}
                  className={`rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition ${
                    on
                      ? "border-grass-600 bg-grass-600 text-white"
                      : "border-mud-200 bg-white/70 text-mud-600 hover:border-mud-400"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {custom && (
            <div className="mt-2">
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() =>
                      setDays((cur) =>
                        cur.includes(d.n)
                          ? cur.filter((n) => n !== d.n)
                          : [...cur, d.n].sort((a, b) => a - b)
                      )
                    }
                    className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                      days.includes(d.n)
                        ? "bg-mud-800 text-mud-50"
                        : "bg-white/70 text-mud-500 hover:bg-white"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {days.length === 0 && (
                <p className="mt-1 text-[11px] font-semibold text-red-700">
                  Pick at least one day.
                </p>
              )}
            </div>
          )}

          {/* ------------------------------------------------------- ending */}
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-mud-500">
            Ends
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {([
              ["never", "Never"],
              ["on", "On a date"],
              ["after", "After N times"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStop(id)}
                className={`rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition ${
                  stop === id
                    ? "border-grass-600 bg-grass-600 text-white"
                    : "border-mud-200 bg-white/70 text-mud-600 hover:border-mud-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {stop === "on" && (
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="field mt-2 w-full rounded-lg px-3 py-2 text-sm"
            />
          )}
          {stop === "after" && (
            <label className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={times}
                onChange={(e) => setTimes(e.target.value)}
                className="field w-24 rounded-lg px-3 py-2 text-sm"
              />
              <span className="text-xs text-mud-500">
                occurrences, then it stops
              </span>
            </label>
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
            disabled={busy || !title.trim() || days.length === 0}
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
                      {h.finished ? " · finished" : !h.active ? " · paused" : ""}
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
                  {h.active && !h.finished && h.due_today && (
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
