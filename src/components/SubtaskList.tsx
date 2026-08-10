"use client";

import { useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  addSubtask,
  deleteSubtask,
  setSubtaskDone,
} from "@/lib/subtask-actions";
import { MAX_STEPS } from "@/lib/game";
import type { Subtask } from "@/lib/types";

/* --------------------------------------------------------------------------
   The checklist inside a quest.

   Ticking a step is a local state change first and a round trip second: these
   are the smallest interactions in the app and waiting on the network to redraw
   a checkbox reads as lag. Nothing here can move XP, so an optimistic tick that
   later fails costs a checkbox, not a score.
   -------------------------------------------------------------------------- */

export default function SubtaskList({
  todoId,
  steps: serverSteps,
  compact = false,
  onChanged,
}: {
  todoId: string;
  steps: Subtask[];
  compact?: boolean;
  /** Lets the parent re-sync its progress chip after a write lands. */
  onChanged?: () => void;
}) {
  const [steps, setSteps] = useState(serverSteps);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // The server stays authoritative — useState only seeds the first render, so
  // without this the list would never pick up a revalidation.
  const [synced, setSynced] = useState(serverSteps);
  if (serverSteps !== synced) {
    setSynced(serverSteps);
    setSteps(serverSteps);
  }

  const full = steps.length >= MAX_STEPS;

  function toggle(step: Subtask) {
    const next = !step.done;
    setSteps((prev) =>
      prev.map((s) => (s.id === step.id ? { ...s, done: next } : s))
    );
    startTransition(async () => {
      const res = await setSubtaskDone(step.id, next);
      // Put it back if the write was refused, rather than leaving the tick
      // showing something the database disagrees with.
      if (!res.ok) {
        setSteps((prev) =>
          prev.map((s) => (s.id === step.id ? { ...s, done: !next } : s))
        );
      }
      onChanged?.();
    });
  }

  function remove(step: Subtask) {
    setSteps((prev) => prev.filter((s) => s.id !== step.id));
    startTransition(async () => {
      const res = await deleteSubtask(step.id);
      if (!res.ok) setSteps((prev) => [...prev, step].sort((a, b) => a.position - b.position));
      onChanged?.();
    });
  }

  async function add() {
    const title = draft.trim();
    if (!title) return;

    setDraft("");
    setError(null);
    const res = await addSubtask(todoId, title);

    if (!res.ok) {
      setError(res.error);
      setDraft(title); // hand the text back rather than losing what was typed
      return;
    }
    setSteps((prev) => [...prev, res.subtask]);
    onChanged?.();
    // Adding steps comes in runs, so keep the field ready for the next one.
    inputRef.current?.focus();
  }

  return (
    <div className={`${compact ? "pl-8 pr-2" : "pl-11 pr-3"} pb-2.5`}>
      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>
          {steps.map((step) => (
            <motion.li
              key={step.id}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
              transition={{ duration: 0.15 }}
              className="group/step flex items-center gap-2 rounded-md py-0.5 pr-1 hover:bg-mud-50"
            >
              <button
                onClick={() => toggle(step)}
                aria-label={step.done ? "Mark step as not done" : "Complete step"}
                className={`grid size-4 shrink-0 place-items-center rounded border-2 transition active:scale-90 ${
                  step.done
                    ? "border-grass-600 bg-grass-600"
                    : "border-mud-300 bg-white hover:border-grass-500"
                }`}
              >
                {step.done && (
                  <svg viewBox="0 0 24 24" className="size-3 text-white">
                    <path
                      d="M4 12.5 L9.5 18 L20 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>

              <span
                className={`min-w-0 flex-1 break-words text-[12.5px] leading-snug ${
                  step.done ? "text-mud-400 line-through" : "text-mud-700"
                }`}
              >
                {step.title}
              </span>

              <button
                onClick={() => remove(step)}
                aria-label={`Delete step: ${step.title}`}
                className="shrink-0 rounded px-1 text-[11px] text-mud-400 opacity-0 transition hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover/step:opacity-100"
              >
                ✕
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {!full && (
        <div className="mt-1 flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
              // Otherwise Escape would reach the row menu's handler and the
              // quest would collapse mid-typing.
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft("");
              }
            }}
            placeholder="Add a step"
            maxLength={200}
            className="min-w-0 flex-1 rounded-md border border-mud-200 bg-white/70 px-2 py-1 text-[12.5px] text-mud-800 placeholder:text-mud-400 focus:border-grass-500 focus:outline-none"
          />
          <button
            onClick={() => void add()}
            disabled={!draft.trim()}
            className="shrink-0 rounded-md border border-mud-300 px-2 py-1 text-[11px] font-semibold text-mud-600 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700 disabled:opacity-40 disabled:hover:border-mud-300 disabled:hover:bg-transparent disabled:hover:text-mud-600"
          >
            Add
          </button>
        </div>
      )}

      {full && (
        <p className="mt-1 text-[11px] text-mud-400">
          That&apos;s the limit of {MAX_STEPS} steps.
        </p>
      )}

      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
