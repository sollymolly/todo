"use client";

import { useEffect, useState } from "react";
import { myOpenQuests, setSessionQuest, startSession } from "@/lib/village-actions";
import { checkIn } from "@/lib/session-store";
import { focusXp, RHYTHMS, type Rhythm, type Spot } from "@/lib/village";

/* --------------------------------------------------------------------------
   Starting a work session, and picking what you're working on — used at the
   town hall and from the menu. The quest you pick is shown to your friends
   only by its category.
   -------------------------------------------------------------------------- */

export function useMyQuests() {
  const [quests, setQuests] = useState<{ id: string; title: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    myOpenQuests()
      .then((q) => live && setQuests(q))
      .catch(() => live && setQuests([]));
    return () => {
      live = false;
    };
  }, []);
  return quests;
}

export function QuestPicker({
  value,
  onChange,
  quests,
}: {
  value: string;
  onChange: (id: string) => void;
  quests: { id: string; title: string }[] | null;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="What you're working on"
      className="w-full rounded-md bg-mud-100 px-2 py-1.5 text-[13px] text-mud-800 outline-none focus:ring-2 focus:ring-grass-400"
    >
      <option value="">Nothing in particular</option>
      {(quests ?? []).map((q) => (
        <option key={q.id} value={q.id}>
          {q.title}
        </option>
      ))}
    </select>
  );
}

/** Starting a table: by the town hall, or at a desk in the library or a table in the bakery (`spot`). */
export function StartSessionForm({ onDone, spot = "hall" }: { onDone?: () => void; spot?: Spot }) {
  const quests = useMyQuests();
  const [todo, setTodo] = useState("");
  const [rhythm, setRhythm] = useState<Rhythm | null>(RHYTHMS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await startSession({ rhythm, todoId: todo || null, spot });
      if (!r.ok) setError(r.error);
      else {
        await checkIn(null);
        onDone?.();
      }
    } catch {
      setError("Couldn't start the session. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <label className="block text-xs font-semibold text-mud-600">
        Working on
        <div className="mt-1">
          <QuestPicker value={todo} onChange={setTodo} quests={quests} />
        </div>
      </label>
      <div className="text-xs font-semibold text-mud-600">
        Focus rounds <span className="font-normal text-mud-500">(minutes of work / break, shared by the table)</span>
        <div className="mt-1">
          <RhythmPicker value={rhythm} onChange={setRhythm} />
        </div>
      </div>
      {error && <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
      <button
        onClick={start}
        disabled={busy}
        className="w-full rounded-lg bg-grass-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-grass-500 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start a work session"}
      </button>
      <p className="text-[11px] leading-snug text-mud-500">
        Friends can join you at your table. Every 25 minutes at it earns {focusXp(0)} XP, plus 1 for each person working
        with you (up to {focusXp(3)}), for four stretches a day.
      </p>
    </div>
  );
}

/** A table's focus clock: none, or one of RHYTHMS. */
export function RhythmPicker({ value, onChange }: { value: Rhythm | null; onChange: (r: Rhythm | null) => void }) {
  const options: { r: Rhythm | null; label: string; blurb: string }[] = [
    { r: null, label: "None", blurb: "Just a timer" },
    ...RHYTHMS.map((k) => ({ r: { work: k.work, rest: k.rest }, label: k.label, blurb: k.blurb })),
  ];
  return (
    <div role="radiogroup" aria-label="Focus rounds" className="grid grid-cols-4 gap-1 rounded-lg bg-mud-100 p-1">
      {options.map((o) => {
        const on = o.r ? value?.work === o.r.work && value.rest === o.r.rest : !value;
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.blurb}
            onClick={() => onChange(o.r)}
            className={`rounded-md px-1 py-1 text-center leading-tight transition ${on ? "bg-white text-mud-900 shadow-sm" : "text-mud-500 hover:text-mud-800"}`}
          >
            <span className="block text-xs font-bold tabular-nums">{o.label}</span>
            <span className="block text-[10px] font-normal">{o.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Change what I'm working on, mid-session. */
export function MyQuestSwitch() {
  const quests = useMyQuests();
  const [todo, setTodo] = useState("");
  return (
    <QuestPicker
      value={todo}
      quests={quests}
      onChange={(id) => {
        setTodo(id);
        void setSessionQuest(id || null).then(() => checkIn(null));
      }}
    />
  );
}
