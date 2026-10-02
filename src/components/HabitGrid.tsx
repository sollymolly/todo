"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteHabit,
  setHabitActive,
  setHabitDay,
  toggleHabit,
  type DayState,
} from "@/lib/habit-actions";
import {
  describeDays,
  habitReward,
  isoWeekday,
  shiftDay,
  type Habit,
  type HabitDay,
} from "@/lib/habits";

/* --------------------------------------------------------------------------
   The habit grid, shared by the Habits page and the dashboard.

   One row per habit, one column per day: a green check for a day kept, a red
   x for a day missed, a snowflake for a day a streak freeze covered. Today's
   cell can be pressed until 23:59:59 in the user's timezone; after that a day
   is settled as kept or missed. For a week more it can still be changed from
   a little menu on its box: ticked late (the penalty or freeze comes back and
   the streak joins up), marked missed after all (the reward comes back off
   and the streak breaks there), or given a streak freeze: which miss gets
   one is the user's call. A miss left alone for its whole week gets one
   then, if any are left (settle_habits); one set to missed by hand doesn't.
   -------------------------------------------------------------------------- */

export type HabitTicked = {
  delta: number;
  xp: number;
  origin: { x: number; y: number };
};

const DAY_NAME = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The small bordered buttons: paging, edit, pause, delete. */
const SMALL_BUTTON =
  "rounded-lg border-2 border-mud-300 bg-white px-2.5 py-1 text-[11px] font-bold text-mud-700 shadow-sm transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-30 disabled:hover:border-mud-300 disabled:hover:text-mud-700";

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

export default function HabitGrid({
  habits: initial,
  today,
  freezes,
  span = 7,
  manage = false,
  onEdit,
  onTicked,
  onChanged,
}: {
  habits: Habit[];
  today: string;
  /** Streak freezes left this month, shown in the header. */
  freezes?: number;
  /** How many days the grid shows at once. */
  span?: number;
  /** Show pause and delete on each row. */
  manage?: boolean;
  /** With `manage`: open this habit for editing. */
  onEdit?: (h: Habit) => void;
  /** After a tick or un-tick, with what moved — for the XP bar and effects. */
  onTicked?: (t: HabitTicked) => void;
  /** After a pause, resume or delete, so the caller can re-read. */
  onChanged: () => void;
}) {
  // Local copy so a tick shows at once; a new server list replaces it.
  const [habits, setHabits] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    setHabits(initial);
  }

  const [start, setStart] = useState(today); // first column shown
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = Array.from({ length: span }, (_, i) => shiftDay(start, i));
  const earliest = shiftDay(today, -179);

  // A closed day's menu: what it can be changed to, under its box.
  const [menu, setMenu] = useState<{ habit: Habit; day: string; at: DOMRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  /** Today's box toggles; a closed day from the last week is set to `to`. */
  async function change(h: Habit, day: string, to: DayState | null, at: DOMRect) {
    const late = to !== null;
    if (busy || (late && !changeable(h, day, today))) return;
    const origin = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
    setMenu(null);
    setBusy(h.id);
    setError(null);
    // The device's own zone rides along, so "today" on the server is the
    // user's today even if the stored zone is stale.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = late ? await setHabitDay(h.id, day, to, zone) : await toggleHabit(h.id, day, zone);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      onChanged();
      return;
    }
    setHabits((prev) =>
      prev.map((x) => {
        if (x.id !== h.id) return x;
        const log = { ...x.log };
        if (late)
          log[day] = { done: to === "done", frozen: to === "frozen", xp: (log[day]?.xp ?? 0) + res.delta, chosen: to === "missed" };
        else if (res.done) log[day] = { done: true, frozen: false, xp: res.delta };
        else delete log[day]; // today's goes back to open
        return {
          ...x,
          log,
          done_today: late ? x.done_today : res.done,
          streak: res.streak,
          best_streak: Math.max(x.best_streak, res.streak),
        };
      })
    );
    onTicked?.({ delta: res.delta, xp: res.xp, origin });
    // A closed day moves a freeze or a penalty and the days after it.
    if (late) onChanged();
  }

  return (
    <div className="panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-2 border-b-2 border-mud-200 px-4 py-3">
        <button
          onClick={() =>
            setStart((d) => (shiftDay(d, -7) < earliest ? earliest : shiftDay(d, -7)))
          }
          disabled={start <= earliest}
          className={SMALL_BUTTON}
        >
          ← Earlier
        </button>
        <span className="flex flex-col items-center leading-tight">
          <span className="font-display text-sm font-bold text-mud-800">
            {fmtRange(days[0], days[days.length - 1])}
          </span>
          {freezes !== undefined && (
            <span
              className="text-[11px] font-semibold text-sky-700"
              title="Press a missed day from the last week to spend one on it: the streak holds instead of breaking. Two each month, shared by every habit."
            >
              ❄ {freezes} streak freeze{freezes === 1 ? "" : "s"} left this month
            </span>
          )}
        </span>
        <button
          onClick={() => setStart((d) => (shiftDay(d, 7) > today ? today : shiftDay(d, 7)))}
          disabled={start >= today}
          className={SMALL_BUTTON}
        >
          Later →
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[36%]" />
            {days.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-mud-100/70">
              <th className="sticky left-0 z-10 bg-mud-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-mud-500">
                Habit
              </th>
              {days.map((d) => (
                <th key={d} className="px-1 py-2 text-center">
                  <span
                    className={`mx-auto flex w-11 flex-col items-center rounded-lg py-1 leading-tight ${
                      d === today ? "bg-grass-600 text-white shadow-sm" : "text-mud-500"
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide">
                      {DAY_NAME[isoWeekday(d)]}
                    </span>
                    <span className="text-base font-bold">{Number(d.slice(8))}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map((h) => (
              <tr
                key={h.id}
                className={`border-t-2 border-mud-200/70 ${h.active ? "" : "opacity-60"}`}
              >
                <td className="sticky left-0 z-10 bg-mud-50 px-4 py-3 align-middle">
                  <p className="truncate font-display text-base font-bold text-mud-900" title={h.title}>
                    {h.title}
                  </p>
                  <p className="truncate text-[11px] text-mud-500">
                    {describe(h)}
                    {h.finished ? " · finished" : !h.active ? " · paused" : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[11px] font-bold">
                    <span
                      className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800"
                      title={
                        h.best_streak > h.streak
                          ? `Current streak · best ${h.best_streak}`
                          : "Current streak"
                      }
                    >
                      🔥 {h.streak}
                      {h.best_streak > h.streak && (
                        <span className="font-semibold text-amber-600"> · best {h.best_streak}</span>
                      )}
                    </span>
                    {h.active && !h.finished && (
                      <span
                        className="rounded-md border border-grass-300 bg-grass-100 px-1.5 py-0.5 text-grass-700"
                        title="XP for the next tick: 1% more per day of streak, up to +10"
                      >
                        +{habitReward(h.done_today ? h.streak : h.streak + 1)} XP
                      </span>
                    )}
                  </div>
                  {manage && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {onEdit && (
                        <button onClick={() => onEdit(h)} className={SMALL_BUTTON}>
                          Edit
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          await setHabitActive(h.id, !h.active);
                          onChanged();
                        }}
                        className={SMALL_BUTTON}
                      >
                        {h.active ? "Pause" : "Resume"}
                      </button>
                      <Remove
                        onConfirm={async () => {
                          await deleteHabit(h.id);
                          onChanged();
                        }}
                      />
                    </div>
                  )}
                </td>
                {days.map((d) => (
                  <td
                    key={d}
                    className={`px-1 py-3 text-center ${d === today ? "bg-grass-100/50" : ""}`}
                  >
                    <Cell
                      habit={h}
                      day={d}
                      today={today}
                      busy={busy === h.id}
                      open={menu?.habit.id === h.id && menu.day === d}
                      onTick={(e) => change(h, d, null, e.currentTarget.getBoundingClientRect())}
                      onMenu={(e) => {
                        const at = e.currentTarget.getBoundingClientRect();
                        setMenu((m) => (m?.habit.id === h.id && m.day === d ? null : { habit: h, day: d, at }));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="border-t-2 border-mud-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-800">
          {error}
        </p>
      )}

      {menu && menu.habit.log[menu.day] && (
        <DayMenu
          entry={menu.habit.log[menu.day]}
          day={menu.day}
          today={today}
          at={menu.at}
          freezes={freezes}
          onPick={(to) => change(menu.habit, menu.day, to, menu.at)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

/** What a closed day can be changed to. */
const STATES: { to: DayState; icon: string; label: string; tone: string }[] = [
  { to: "done", icon: "✓", label: "Did it after all", tone: "bg-grass-600 text-white" },
  { to: "frozen", icon: "❄", label: "Use a streak freeze", tone: "bg-sky-100 text-sky-600" },
  { to: "missed", icon: "✕", label: "Missed it", tone: "bg-red-500 text-white" },
];

function stateOf(entry: HabitDay): DayState {
  return entry.done ? "done" : entry.frozen ? "frozen" : "missed";
}

/**
 * The menu under a closed day's box: the two things it isn't, and what each
 * does. Fixed to the page, so the grid's scrolling can't clip it; it goes on
 * a scroll, a press elsewhere or Escape.
 */
function DayMenu({
  entry,
  day,
  today,
  at,
  freezes,
  onPick,
  onClose,
}: {
  entry: HabitDay;
  day: string;
  today: string;
  at: DOMRect;
  freezes?: number;
  onPick: (to: DayState) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      // Its own box toggles it, on the click that follows.
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('[aria-expanded="true"]')) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const now = stateOf(entry);
  // A freeze comes out of the month of the day after; the count shown is this
  // month's, so it only rules one out for a day that falls in it.
  const noFreeze = freezes === 0 && shiftDay(day, 1).slice(0, 7) === today.slice(0, 7);
  const hint: Record<DayState, string> = {
    done: "XP back, the streak joins up",
    frozen: noFreeze
      ? "None left this month"
      : `The streak holds${freezes !== undefined ? ` · ${freezes} left` : ""}`,
    missed: `${now === "done" ? "Reward back off" : "Freeze back"}, -1, streak breaks for good`,
  };
  const below = at.bottom + 130 < window.innerHeight;
  const left = Math.min(Math.max(8, at.left + at.width / 2 - 104), window.innerWidth - 216);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Change ${day}`}
      className="panel fixed z-50 w-52 rounded-xl p-1 shadow-lg"
      style={below ? { top: at.bottom + 6, left } : { top: at.top - 6, left, transform: "translateY(-100%)" }}
    >
      {STATES.filter((s) => s.to !== now).map((s) => (
        <button
          key={s.to}
          role="menuitem"
          disabled={s.to === "frozen" && noFreeze}
          onClick={() => onPick(s.to)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-mud-100 focus:bg-mud-100 focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${s.tone}`}>
            {s.icon}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-xs font-bold text-mud-900">{s.label}</span>
            <span className="block text-[11px] text-mud-500">{hint[s.to]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Cell({
  habit: h,
  day,
  today,
  busy,
  open,
  onTick,
  onMenu,
}: {
  habit: Habit;
  day: string;
  today: string;
  busy: boolean;
  /** This day's menu is showing. */
  open: boolean;
  onTick: (e: React.MouseEvent<HTMLElement>) => void;
  /** Open a closed day's menu. */
  onMenu: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const entry = h.log[day];
  const box =
    "mx-auto flex size-10 items-center justify-center rounded-xl border-2 text-lg font-bold";

  // Today is the only day that can be pressed.
  if (day === today && (h.due_today || entry)) {
    const done = !!entry?.done;
    return (
      <button
        onClick={onTick}
        disabled={busy}
        aria-pressed={done}
        aria-label={done ? `Un-tick ${h.title} for today` : `Tick ${h.title} for today`}
        title={
          done
            ? `Done today (+${entry.xp} XP) — press to undo`
            : "Tick off today — open until 11:59:59 pm"
        }
        className={`${box} transition ${
          done
            ? "border-grass-700 bg-grass-600 text-white shadow-sm hover:bg-grass-500"
            : "border-amber-400 bg-amber-50 text-transparent shadow-sm hover:border-grass-500 hover:bg-white hover:text-grass-400"
        } ${busy ? "animate-pulse" : ""}`}
      >
        ✓
      </button>
    );
  }

  // A settled day: kept, frozen or missed. For a week it opens a menu to
  // change it; after that it's read-only.
  if (entry) {
    const look = {
      done: { tone: "border-grass-700 bg-grass-600 text-white", icon: "✓", title: `Kept (+${entry.xp} XP)` },
      frozen: { tone: "border-sky-400 bg-sky-100 text-sky-600", icon: "❄", title: "Missed, but a streak freeze held the streak" },
      missed: { tone: "border-red-600 bg-red-500 text-white", icon: "✕", title: `Missed (${entry.xp} XP)` },
    }[stateOf(entry)];
    // Left alone, a miss gets a freeze when its week is up, if there's one left.
    const net = !entry.done && !entry.frozen && !entry.chosen;
    if (!changeable(h, day, today))
      return (
        <span className={`${box} ${look.tone}`} title={look.title}>
          {look.icon}
        </span>
      );
    return (
      <button
        onClick={onMenu}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${h.title}, ${day}: ${look.title}. Change it`}
        title={`${look.title}. Press to change it, for up to a week${
          net ? " — left as it is, it gets a streak freeze then, if one's left" : ""
        }.`}
        className={`${box} ${look.tone} shadow-sm transition hover:ring-2 hover:ring-amber-400 hover:ring-offset-1 ${
          open ? "ring-2 ring-amber-400 ring-offset-1" : ""
        } ${busy ? "animate-pulse" : ""}`}
      >
        {look.icon}
      </button>
    );
  }

  // Not on the schedule at all: a faded box, so the gap reads as a rest day
  // rather than something missing.
  if (!h.days.includes(isoWeekday(day)))
    return (
      <span
        className={`${box} border-dashed border-mud-200 bg-mud-100/50 text-xs text-mud-300`}
        title="Rest day"
      >
        –
      </span>
    );

  // Coming up: an empty box on each day it is due, pressable once it is today.
  if (day > today) {
    const upcoming =
      h.active && !h.finished && (!h.ends_on || day <= h.ends_on);
    return upcoming ? (
      <span className={`${box} border-mud-300 bg-white`} title="Coming up" />
    ) : (
      <span className={`${box} border-transparent`} />
    );
  }

  // A scheduled day that wasn't tracked: before the habit existed, while it
  // was paused, or after it ended.
  return (
    <span className={`${box} border-transparent text-mud-300`} title="Not tracked">
      ·
    </span>
  );
}

/** A settled day from the last week, which can still be changed. */
function changeable(h: Habit, day: string, today: string): boolean {
  return !!h.log[day] && day < today && day >= shiftDay(today, -7);
}

function fmtRange(a: string, b: string): string {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `${f(a)} – ${f(b)}`;
}

function Remove({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        onClick={() => setAsking(true)}
        className="rounded-lg border-2 border-mud-300 bg-white px-2.5 py-1 text-[11px] font-bold text-mud-700 shadow-sm transition hover:border-red-400 hover:text-red-700"
      >
        Delete
      </button>
    );
  return (
    <>
      <button
        onClick={onConfirm}
        title="Deletes the habit and its history"
        className="rounded-lg border-2 border-red-700 bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-red-700"
      >
        Delete
      </button>
      <button
        onClick={() => setAsking(false)}
        className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-mud-500 hover:text-mud-900"
      >
        No
      </button>
    </>
  );
}
