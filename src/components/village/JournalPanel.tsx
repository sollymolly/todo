"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/village/panels";
import { deleteJournalEntry, listJournal, saveJournalEntry } from "@/lib/journal-actions";
import { JOURNAL_MAX, type JournalEntry } from "@/lib/journal";

/* --------------------------------------------------------------------------
   The notebook on the desk at home: a list of what you've written, and a page
   to write on. It saves as you write — a moment after you stop typing, when
   you go back, close it, or leave the tab — so nothing is lost for want of a
   Save button.
   -------------------------------------------------------------------------- */

const BTN =
  "rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-grass-500 disabled:opacity-50";

/** How long after the last key before the page saves itself. */
const SAVE_AFTER_MS = 1200;

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** An entry's first line, to tell it apart in the list. */
const firstLine = (body: string) => body.split("\n").find((l) => l.trim())?.trim() ?? "";

type Editing = { entry: JournalEntry | null; n: number };

export default function JournalPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [problem, setProblem] = useState<"missing" | "failed" | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

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
          <button onClick={() => setEditing({ entry: null, n: Date.now() })} className={`${PRIMARY} w-full py-2 text-sm`}>
            ✎ New entry
          </button>
          {entries.length === 0 ? (
            <p className="mt-3 text-sm text-mud-500">Nothing written yet. The first page is blank.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setEditing({ entry: e, n: Date.now() })}
                    className="block w-full rounded-lg px-3 py-2 text-left ring-1 ring-mud-200 hover:bg-mud-100"
                  >
                    <span className="block text-[11px] text-mud-500">{when(e.at)}</span>
                    <span className="mt-0.5 block truncate text-sm text-mud-900">{firstLine(e.body)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
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
  const [text, setText] = useState(entry?.body ?? "");
  const [status, setStatus] = useState<Status>(entry ? "saved" : "new");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  /** The date over a page not yet saved: when I sat down to write it. */
  const [sat] = useState(() => Date.now());

  /** The entry's id once it has one (after the first save), and what's been saved. */
  const idRef = useRef<string | null>(entry?.id ?? null);
  const textRef = useRef(text);
  const savedRef = useRef(entry?.body ?? "");
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
      const body = textRef.current;
      // Nothing to save: a blank page, or no change since the last save.
      if (deleted.current || !body.trim() || body === savedRef.current) return;
      setStatus("saving");
      const r = await saveJournalEntry(idRef.current, body).catch(() => null);
      if (deleted.current) return;
      if (r && r.ok) {
        idRef.current = r.entry.id;
        savedRef.current = body;
        onSavedRef.current(r.entry);
        setError("");
        setStatus(textRef.current === body ? "saved" : "typing");
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

  function change(value: string) {
    setText(value);
    textRef.current = value;
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

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onBack} className={BTN}>
          ‹ All entries
        </button>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-mud-500">{when(entry ? entry.at : sat)}</span>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => change(e.target.value)}
        maxLength={JOURNAL_MAX}
        placeholder="Dear journal…"
        aria-label="Journal entry"
        className="h-64 w-full resize-none rounded-lg border border-mud-300 bg-white/80 p-3 text-sm leading-relaxed text-mud-900 focus:border-grass-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <span role="status" className={`min-w-0 flex-1 text-xs ${status === "error" ? "text-red-700" : "text-mud-500"}`}>
          {label}
          {text.length > JOURNAL_MAX * 0.9 && ` · ${text.length.toLocaleString()} of ${JOURNAL_MAX.toLocaleString()}`}
        </span>
        {status === "error" && (
          <button onClick={() => void flush()} className={BTN}>
            Try again
          </button>
        )}
        {entry || text ? (
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
