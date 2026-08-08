"use client";

import { useEffect, useRef, useState } from "react";
import DuePicker from "@/components/DuePicker";
import StakeRow from "@/components/StakeRow";
import { colorOf } from "@/lib/game";
import { isoToLocalInput, localInputToIso } from "@/lib/date";
import type { Category, Todo } from "@/lib/types";

export type QuestDraft = {
  title: string;
  notes: string;
  dueDate: string | null;
  categoryId: string | null;
};

export default function QuestForm({
  categories,
  initial,
  defaultCategoryId,
  submitLabel = "Add quest",
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  categories: Category[];
  initial?: Todo;
  defaultCategoryId?: string | null;
  submitLabel?: string;
  autoFocus?: boolean;
  onSubmit: (draft: QuestDraft) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [due, setDue] = useState(isoToLocalInput(initial?.due_date ?? null));
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.category_id ?? defaultCategoryId ?? null
  );
  const [showNotes, setShowNotes] = useState(!!initial?.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title, notes, dueDate: localInputToIso(due), categoryId });
      if (!initial) {
        setTitle("");
        setNotes("");
        setDue("");
        setShowNotes(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What must be done?"
        maxLength={200}
        className="field w-full rounded-xl px-4 py-3 text-base font-medium"
      />

      {/* ------------------------------------------------------- category */}
      {categories.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-mud-500">
            Category
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {categories.map((cat) => {
              const c = colorOf(cat.color);
              const on = categoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryId(on ? null : cat.id)}
                  className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-semibold transition ${
                    on
                      ? `${c.solid} border-transparent text-white shadow-sm`
                      : "border-mud-200 bg-white/60 text-mud-600 hover:border-mud-400 hover:bg-white"
                  }`}
                >
                  <span className="text-base">{cat.icon}</span>
                  <span className="truncate">{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ due */}
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-mud-500">
          Deadline
        </p>
        <DuePicker value={due} onChange={setDue} />
      </div>

      <StakeRow hasDeadline={!!due} />

      {showNotes ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Details, links, notes to self…"
          rows={2}
          maxLength={2000}
          className="field w-full resize-y rounded-xl px-3.5 py-2.5 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="text-xs font-semibold text-mud-500 underline-offset-4 transition hover:text-grass-700 hover:underline"
        >
          + add notes
        </button>
      )}

      {error && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-xs text-red-800 ring-1 ring-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-xl bg-grass-600 px-5 py-2.5 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-mud-300 disabled:shadow-none"
        >
          {busy ? "…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-mud-500 transition hover:bg-mud-100 hover:text-mud-800"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
