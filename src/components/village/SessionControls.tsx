"use client";

import { useEffect, useState } from "react";
import { myOpenQuests, setSessionQuest, startSession } from "@/lib/village-actions";
import { checkIn } from "@/lib/session-store";

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

export function StartSessionForm({ onDone }: { onDone?: () => void }) {
  const quests = useMyQuests();
  const [todo, setTodo] = useState("");
  const [focus, setFocus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await startSession({ focus, todoId: todo || null });
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
      <label className="flex items-center gap-2 text-sm text-mud-800">
        <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} className="size-4 accent-grass-600" />
        Focus rounds <span className="text-xs text-mud-500">(25 min work, 5 min break, shared)</span>
      </label>
      {error && <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
      <button
        onClick={start}
        disabled={busy}
        className="w-full rounded-lg bg-grass-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-grass-500 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start a work session"}
      </button>
      <p className="text-[11px] leading-snug text-mud-500">
        Friends can join you at the town hall. Every 25 minutes at the table earns 3 XP (4 with company), up to 12 a
        day.
      </p>
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
