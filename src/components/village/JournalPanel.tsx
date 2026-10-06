"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/village/panels";
import { deleteJournalEntry, listJournal, saveJournalEntry } from "@/lib/journal-actions";
import { JOURNAL_MAX, MOODS, TOPIC_MAX, WEATHER, type JournalDraft, type JournalEntry } from "@/lib/journal";

/* --------------------------------------------------------------------------
   The notebook on the desk at home: your entries, month by month, and a
   page to write on — its day and time, a topic, how the day felt and the
   weather, then the writing itself, on ruled paper. It saves as you write —
   a moment after you stop, when you go back, close it, or leave the tab —
   so nothing is lost for want of a Save button.
   -------------------------------------------------------------------------- */

const BTN =
  "rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-grass-500 disabled:opacity-50";

/** How long after the last change before the page saves itself. */
const SAVE_AFTER_MS = 1200;

/** The ruled lines on the page, px apart; the writing sits on them. */
const LINE = 26;
const PAPER = "#fffdf6";
const RULED: React.CSSProperties = {
  backgroundColor: PAPER,
  backgroundImage: `linear-gradient(to right, transparent 27px, #e9a8a0 27px, #e9a8a0 28px, transparent 28px), repeating-linear-gradient(to bottom, transparent 0, transparent ${LINE - 1}px, #d5e0ec ${LINE - 1}px, #d5e0ec ${LINE}px)`,
  backgroundAttachment: "local",
  lineHeight: `${LINE}px`,
};

const dayLong = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const monthOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" });
/** For a datetime-local input: the local day and time, to the minute. */
const toInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** An entry's first line, to tell it apart in the list. */
const firstLine = (body: string) => body.split("\n").find((l) => l.trim())?.trim() ?? "";
const words = (body: string) => body.split(/\s+/).filter(Boolean).length;
const iconOf = (list: readonly { id: string; icon: string }[], id: string | null) => list.find((c) => c.id === id)?.icon;

type Editing = { entry: JournalEntry | null; n: number };

export default function JournalPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [problem, setProblem] = useState<"missing" | "failed" | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [search, setSearch] = useState("");
  const [opened] = useState(Date.now);

  useEffect(() => {
    let live = true;
    listJournal()
      .then((r) => {
        if (!live) return;
        if (r === null) setProblem("missing");
        else setEntries(r);
      })
      .catch(() => live && setProblem("failed"));
    return () => {
      live = false;
    };
  }, []);

  const upsert = useCallback((e: JournalEntry) => {
    setEntries((cur) => [e, ...(cur ?? []).filter((x) => x.id !== e.id)].sort((a, b) => b.at - a.at));
  }, []);

  /** The entries that match the search, by month, newest first. */
  const months = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: { month: string; entries: JournalEntry[] }[] = [];
    for (const e of entries ?? []) {
      if (q && !`${e.topic}\n${e.body}`.toLowerCase().includes(q)) continue;
      const month = monthOf(e.at);
      if (out.at(-1)?.month !== month) out.push({ month, entries: [] });
      out.at(-1)!.entries.push(e);
    }
    return out;
  }, [entries, search]);

  const thisMonth = entries?.filter((e) => monthOf(e.at) === monthOf(opened)).length ?? 0;

  return (
    <Panel wide title="Your journal" sub="Only you can read what's written here" onClose={onClose}>
      {editing ? (
        <Editor
          key={editing.n}
          entry={editing.entry}
          onSaved={upsert}
          onBack={() => setEditing(null)}
          onDeleted={(id) => {
            setEntries((cur) => (cur ?? []).filter((x) => x.id !== id));
            setEditing(null);
          }}
        />
      ) : problem === "missing" ? (
        <p className="text-sm text-mud-700">
          The journal isn&apos;t set up yet. Run <code>db/schema.sql</code> in the Neon SQL Editor, then reload.
        </p>
      ) : problem === "failed" ? (
        <p className="text-sm text-mud-700">Couldn&apos;t open your journal just now. Close this and try again.</p>
      ) : entries === null ? (
        <p className="text-sm text-mud-500">Opening your notebook…</p>
      ) : (
        <>
          <div className="flex gap-2">
            <button onClick={() => setEditing({ entry: null, n: Date.now() })} className={`${PRIMARY} shrink-0 px-4 py-2 text-sm`}>
              ✎ New entry
            </button>
            {entries.length > 0 && (
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your pages…"
                aria-label="Search your journal"
                className="field min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm"
              />
            )}
          </div>
          {entries.length === 0 ? (
            <p className="mt-4 rounded-xl px-4 py-6 text-center text-sm italic text-mud-500 ring-1 ring-mud-200" style={{ backgroundColor: PAPER }}>
              Nothing written yet. The first page is blank.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[11px] text-mud-500">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} · {thisMonth} this month
              </p>
              {months.length === 0 && <p className="mt-3 text-sm text-mud-500">No pages mention “{search.trim()}”.</p>}
              {months.map((m) => (
                <section key={m.month} className="mt-3">
                  <h3 className="mb-1.5 font-display text-xs font-bold uppercase tracking-widest text-mud-500">{m.month}</h3>
                  <ul className="space-y-1.5">
                    {m.entries.map((e) => (
                      <li key={e.id}>
                        <EntryRow entry={e} onOpen={() => setEditing({ entry: e, n: Date.now() })} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/** One entry in the list: its day like a calendar page, its topic, how it felt, a line of it. */
function EntryRow({ entry: e, onOpen }: { entry: JournalEntry; onOpen: () => void }) {
  const d = new Date(e.at);
  const line = firstLine(e.body);
  const mood = iconOf(MOODS, e.mood);
  const weather = iconOf(WEATHER, e.weather);
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-stretch gap-3 rounded-xl px-2.5 py-2 text-left ring-1 ring-mud-200 transition hover:ring-grass-500"
      style={{ backgroundColor: PAPER }}
    >
      <span className="flex w-11 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-mud-300">
        <span className="w-full bg-[#3f6b8f] text-center text-[9px] font-bold uppercase tracking-wider text-white">
          {d.toLocaleDateString(undefined, { weekday: "short" })}
        </span>
        <span className="font-display text-lg font-bold leading-6 text-mud-900">{d.getDate()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-mud-900">{e.topic || line || "Untitled"}</span>
          {(mood || weather) && (
            <span className="shrink-0 text-sm" aria-hidden>
              {mood}
              {weather}
            </span>
          )}
        </span>
        {e.topic && line && <span className="block truncate text-xs text-mud-600">{line}</span>}
        <span className="block text-[11px] text-mud-400">
          {time(e.at)} · {words(e.body).toLocaleString()} {words(e.body) === 1 ? "word" : "words"}
        </span>
      </span>
    </button>
  );
}

type Status = "new" | "typing" | "saving" | "saved" | "error";

function Editor({
  entry,
  onSaved,
  onBack,
  onDeleted,
}: {
  entry: JournalEntry | null;
  onSaved: (e: JournalEntry) => void;
  onBack: () => void;
  onDeleted: (id: string) => void;
}) {
  // A new page is dated when I sat down to write it.
  const [draft, setDraft] = useState<JournalDraft>(() => ({
    body: entry?.body ?? "",
    topic: entry?.topic ?? "",
    mood: entry?.mood ?? null,
    weather: entry?.weather ?? null,
    at: entry?.at ?? Date.now(),
  }));
  const [status, setStatus] = useState<Status>(entry ? "saved" : "new");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [dating, setDating] = useState(false);
  const [opened] = useState(Date.now);

  /** The entry's id once it has one (after the first save), and what's been saved. */
  const idRef = useRef<string | null>(entry?.id ?? null);
  const draftRef = useRef(draft);
  const savedRef = useRef(entry ? JSON.stringify(draft) : "");
  /** Saves go one after another, so a second never starts before the first has an id. */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deleted = useRef(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const d = draftRef.current;
      const key = JSON.stringify(d);
      // Nothing to save: a blank page, or no change since the last save.
      if (deleted.current || (!d.body.trim() && !d.topic.trim()) || key === savedRef.current) return;
      setStatus("saving");
      const r = await saveJournalEntry(idRef.current, d).catch(() => null);
      if (deleted.current) return;
      if (r && r.ok) {
        idRef.current = r.entry.id;
        savedRef.current = key;
        onSavedRef.current(r.entry);
        setError("");
        setStatus(JSON.stringify(draftRef.current) === key ? "saved" : "typing");
      } else {
        setError(r && !r.ok ? r.error : "Couldn't save just now.");
        setStatus("error");
      }
    });
    return chain.current;
  }, []);

  // Whatever is unsaved when this page is put away (back, closing the panel) is saved.
  useEffect(() => {
    const hidden = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      void flush();
    };
  }, [flush]);

  function change(patch: Partial<JournalDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setStatus("typing");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }

  async function remove() {
    clearTimeout(timer.current);
    // Let a save that's under way finish first, so it can't bring the entry back.
    await chain.current;
    deleted.current = true;
    const id = idRef.current;
    if (id) await deleteJournalEntry(id).catch(() => undefined);
    if (id) onDeleted(id);
    else onBack();
  }

  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? error
          : status === "typing"
            ? "Saves as you write"
            : "Saves as you write — begin whenever you like";
  const count = words(draft.body);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onBack} className={BTN}>
          ‹ All entries
        </button>
        <span role="status" className={`min-w-0 flex-1 truncate text-right text-[11px] ${status === "error" ? "text-red-700" : "text-mud-500"}`}>
          {label}
        </span>
      </div>

      {/* The page */}
      <div className="overflow-hidden rounded-xl shadow-sm ring-1 ring-mud-300" style={{ backgroundColor: PAPER }}>
        <div className="border-b border-dashed border-mud-300 px-4 pb-2.5 pt-3">
          {/* The day and time, which can be changed */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-bold leading-tight text-mud-900">{dayLong(draft.at)}</p>
              <p className="text-xs text-mud-500">{time(draft.at)}</p>
            </div>
            <button onClick={() => setDating((d) => !d)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-mud-500 hover:bg-mud-100 hover:text-grass-700">
              {dating ? "Done" : "Change date"}
            </button>
          </div>
          {dating && (
            <input
              type="datetime-local"
              value={toInput(draft.at)}
              max={toInput(opened + 86_400_000)}
              onChange={(e) => {
                const ms = new Date(e.target.value).getTime();
                if (Number.isFinite(ms)) change({ at: ms });
              }}
              aria-label="The day and time of this entry"
              className="field mt-2 w-full rounded-lg px-2 py-1 text-sm"
            />
          )}

          <input
            value={draft.topic}
            onChange={(e) => change({ topic: e.target.value })}
            maxLength={TOPIC_MAX}
            placeholder="Topic — what's this page about?"
            aria-label="Topic"
            className="mt-2.5 w-full border-b-2 border-mud-200 bg-transparent pb-1 font-display text-lg font-bold text-mud-900 placeholder:font-normal placeholder:italic placeholder:text-mud-400 focus:border-grass-500 focus:outline-none"
          />

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Choices label="Mood" list={MOODS} value={draft.mood} onPick={(mood) => change({ mood })} />
            <Choices label="Weather" list={WEATHER} value={draft.weather} onPick={(weather) => change({ weather })} />
          </div>
        </div>

        <textarea
          autoFocus={!entry}
          value={draft.body}
          onChange={(e) => change({ body: e.target.value })}
          maxLength={JOURNAL_MAX}
          placeholder="Dear journal…"
          aria-label="Journal entry"
          className="block h-72 w-full resize-none bg-transparent pb-2 pl-9 pr-4 pt-1 font-display text-[15px] text-mud-900 placeholder:italic placeholder:text-mud-400 focus:outline-none"
          style={RULED}
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-mud-500">
          {count.toLocaleString()} {count === 1 ? "word" : "words"}
          {draft.body.length > JOURNAL_MAX * 0.9 && ` · ${draft.body.length.toLocaleString()} of ${JOURNAL_MAX.toLocaleString()} characters`}
        </span>
        {status === "error" && (
          <button onClick={() => void flush()} className={BTN}>
            Try again
          </button>
        )}
        {entry || draft.body || draft.topic ? (
          confirming ? (
            <>
              <button onClick={() => void remove()} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500">
                Delete it
              </button>
              <button onClick={() => setConfirming(false)} className={BTN}>
                Keep
              </button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} className={BTN}>
              Delete
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

/** A row of little icons to pick one from (mood, weather); the one picked again un-picks it. */
function Choices({
  label,
  list,
  value,
  onPick,
}: {
  label: string;
  list: readonly { id: string; label: string; icon: string }[];
  value: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      <span className="mr-0.5 text-[10px] font-bold uppercase tracking-widest text-mud-400">{label}</span>
      {list.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id}
            role="radio"
            aria-checked={on}
            title={c.label}
            aria-label={c.label}
            onClick={() => onPick(on ? null : c.id)}
            className={`grid size-7 place-items-center rounded-full text-base transition ${
              on ? "scale-110 bg-grass-100 ring-2 ring-grass-500" : value ? "opacity-45 grayscale hover:opacity-100 hover:grayscale-0" : "hover:bg-mud-100"
            }`}
          >
            {c.icon}
          </button>
        );
      })}
    </div>
  );
}
