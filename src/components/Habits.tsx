"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HabitGrid from "@/components/HabitGrid";
import TimezoneSync from "@/components/TimezoneSync";
import { useFx } from "@/components/Fx";
import { addHabit, updateHabit } from "@/lib/habit-actions";
import {
  EVERY_DAY,
  WEEKDAYS_ONLY,
  WEEKEND_ONLY,
  type Habit,
} from "@/lib/habits";

/* --------------------------------------------------------------------------
   The recurring habits page.

   Habits are their own section, apart from the quest board: ticked here (or
   in the dashboard's copy of the grid), never turned into quests. What's
   unique to this page is the composer and the pause/delete controls.
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

/** A selectable pill: solid green when chosen, a clear outline when not. */
function chip(on: boolean): string {
  return `rounded-xl border-2 px-3.5 py-2 text-xs font-bold shadow-sm transition ${
    on
      ? "border-grass-700 bg-grass-600 text-white"
      : "border-mud-300 bg-white text-mud-700 hover:border-grass-500 hover:text-grass-700"
  }`;
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

export default function Habits({
  habits,
  today,
  zone,
  freezes,
}: {
  habits: Habit[];
  today: string;
  /** Streak freezes left this month. */
  freezes: number;
  /** The timezone the server measured `today` in. */
  zone: string | null;
}) {
  const router = useRouter();
  const { celebrate } = useFx();
  const [title, setTitle] = useState("");
  const [days, setDays] = useState<number[]>(EVERY_DAY);
  const [custom, setCustom] = useState(false);
  const [stop, setStop] = useState<"never" | "on" | "after">("never");
  const [endsOn, setEndsOn] = useState("");
  const [times, setTimes] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The habit the form is editing; null when it's adding a new one. */
  const [editing, setEditing] = useState<Habit | null>(null);
  const formRef = useRef<HTMLElement>(null);

  const refresh = () => router.refresh();

  // The habit being edited was deleted: the form goes back to adding.
  if (editing && !habits.some((h) => h.id === editing.id)) reset();

  function reset() {
    setEditing(null);
    setTitle("");
    setDays(EVERY_DAY);
    setCustom(false);
    setStop("never");
    setEndsOn("");
    setTimes("10");
    setError(null);
  }

  function edit(h: Habit) {
    setEditing(h);
    setTitle(h.title);
    setDays(h.days);
    setCustom(!PRESETS.some((p) => p.days && sameDays(h.days, p.days)));
    setStop(h.occurrences_limit ? "after" : h.ends_on ? "on" : "never");
    setEndsOn(h.ends_on ?? "");
    setTimes(String(h.occurrences_limit ?? 10));
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const input = {
      title,
      days,
      endsOn: stop === "on" ? endsOn || null : null,
      occurrencesLimit: stop === "after" ? Number(times) || null : null,
    };
    const res = editing ? await updateHabit(editing.id, input) : await addHabit(input);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (editing) reset();
    else setTitle("");
    refresh();
  }

  const active = habits.filter((h) => h.active);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <TimezoneSync stored={zone} />
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
            Habits
          </h1>
          <p className="text-xs font-semibold text-mud-600">
            {active.length === 0
              ? "Things you mean to do again and again."
              : `${active.length} running · tick today's off below.`}
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
      <section ref={formRef} className="panel scroll-mt-4 rounded-2xl p-5">
        <h2 className="font-display text-sm font-bold tracking-wide text-mud-800">
          {editing ? "Edit habit" : "New habit"}
        </h2>
        <form onSubmit={save} className="mt-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Go for a run"
            maxLength={200}
            className="field w-full rounded-xl px-3.5 py-2.5 text-sm"
          />

          <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-mud-500">
            Repeats
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
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
                    } else if (!custom) {
                      setCustom(true);
                      setDays([]);
                    }
                  }}
                  className={chip(on)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {custom && (
            <div className="mt-2.5">
              <div className="flex flex-wrap gap-1.5">
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
                    className={`${chip(days.includes(d.n))} w-14 text-center`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {days.length === 0 && (
                <p className="mt-1 text-[11px] font-semibold text-mud-500">
                  Pick the days it runs on.
                </p>
              )}
            </div>
          )}

          {/* ------------------------------------------------------- ending */}
          <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-mud-500">
            Ends
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {([
              ["never", "Never"],
              ["on", "On a date"],
              ["after", "After N times"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStop(id)}
                className={chip(stop === id)}
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

          {error && (
            <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
              {error}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim() || days.length === 0}
              className="w-full rounded-xl bg-grass-600 px-4 py-2.5 font-display text-sm font-bold tracking-wide text-white transition hover:bg-grass-500 disabled:bg-mud-300"
            >
              {editing
                ? busy ? "Saving…" : "Save changes"
                : busy ? "Adding…" : "Add habit"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-mud-300 bg-white/80 px-4 py-2.5 text-sm font-semibold text-mud-700 transition hover:border-mud-400"
              >
                Cancel
              </button>
            )}
          </div>
          {editing && (
            <p className="mt-2 text-[10px] leading-relaxed text-mud-400">
              Changes apply from today on. Days already over keep what they were.
            </p>
          )}
        </form>

      </section>

      {/* --------------------------------------------------------- running */}
      {habits.length > 0 && (
        <div className="mt-6">
          <HabitGrid
            habits={habits}
            today={today}
            freezes={freezes}
            manage
            onEdit={edit}
            onChanged={refresh}
            onTicked={({ delta, origin }) =>
              delta !== 0 && celebrate({ ...origin, xp: delta, label: delta > 0 ? "habit kept" : undefined })
            }
          />
        </div>
      )}
    </main>
  );
}
