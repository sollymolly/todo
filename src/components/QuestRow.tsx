"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { colorOf, XP } from "@/lib/game";
import {
  describeDue,
  describeDueShort,
  formatStamp,
  isOverdue,
  urgencyOf,
  type Urgency,
} from "@/lib/date";
import SubtaskList from "@/components/SubtaskList";
import type { Category, Subtask, Todo } from "@/lib/types";

const MENU_W = 190;

/* How soon a deadline reads at a glance. Written out in full rather than
   composed, because Tailwind only ships classes it can see as literal text. */
const URGENCY: Record<Urgency, string> = {
  overdue: "bg-red-100 text-red-700 ring-red-300",
  urgent: "bg-red-100 text-red-700 ring-red-300",
  soon: "bg-amber-100 text-amber-800 ring-amber-300",
  // grass stops at 700 in globals.css — 800 would render with no colour.
  later: "bg-grass-100 text-grass-700 ring-grass-300",
};

export default function QuestRow({
  todo,
  category,
  steps = [],
  compact = false,
  showCategory = true,
  onComplete,
  onUncomplete,
  onAbandon,
  onDelete,
  onEdit,
  onStepsChanged,
  onStepsToggle,
  draggable = false,
}: {
  todo: Todo;
  category?: Category;
  /** This quest's checklist, already filtered to it. */
  steps?: Subtask[];
  /** Denser padding and type, for the narrow category boxes. */
  compact?: boolean;
  showCategory?: boolean;
  onComplete: (todo: Todo, origin: { x: number; y: number }) => void;
  onUncomplete: (todo: Todo) => void;
  onAbandon: (todo: Todo, origin: { x: number; y: number }) => void;
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onStepsChanged?: () => void;
  /** Lets a fixed-height container grow while this checklist is open. */
  onStepsToggle?: (open: boolean) => void;
  draggable?: boolean;
}) {
  const [slashing, setSlashing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  // The category boxes only fit about three rows before they scroll, so steps
  // start collapsed there — the n/m chip is the glanceable part, and opening it
  // is one click. Roomier layouts show them straight away.
  const [showSteps, setShowSteps] = useState(!compact && steps.length > 0);
  const rowRef = useRef<HTMLLIElement>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const dotsRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const done = todo.status === "done";
  const failed = todo.status === "failed";
  const overdue = todo.status === "open" && isOverdue(todo.due_date);
  const c = colorOf(category?.color ?? "amber");

  const stepsDone = steps.filter((s) => s.done).length;

  /* The boxes scroll and clip their contents, so the menu is positioned in a
     portal against the viewport instead of inside the row. */
  useLayoutEffect(() => {
    if (!menuAt) return;

    const place = () => {
      const r = dotsRef.current?.getBoundingClientRect();
      if (!r) return;
      setMenuAt({
        left: Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8),
        top: Math.min(r.bottom + 6, window.innerHeight - 190),
      });
    };

    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menuAt]);

  useEffect(() => {
    if (!menuAt) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || dotsRef.current?.contains(t)) return;
      setMenuAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuAt(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuAt]);

  function openMenu() {
    const r = dotsRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuAt({
      left: Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8),
      top: Math.min(r.bottom + 6, window.innerHeight - 190),
    });
  }

  function centerOf(el: HTMLElement | null) {
    const r = el?.getBoundingClientRect();
    return r
      ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  /* An open checklist is several times the height of the row it hangs off, so
     inside a category box the steps can open below the fold. The container
     hears about it in the same commit, so by the time the frame lands the box
     has already grown and "nearest" has only the genuine overflow left to
     scroll away. */
  function toggleSteps(open: boolean) {
    setShowSteps(open);
    onStepsToggle?.(open);
    if (!open) return;
    requestAnimationFrame(() =>
      rowRef.current?.scrollIntoView({ block: "nearest" })
    );
  }

  function handleCheck() {
    if (done) return onUncomplete(todo);
    setSlashing(true);
    const origin = centerOf(boxRef.current);
    window.setTimeout(() => onComplete(todo, origin), 260);
  }

  return (
    <motion.li
      ref={rowRef}
      layout
      data-quest-row=""
      draggable={draggable && todo.status !== "done"}
      onDragStart={(ev) => {
        const e = ev as unknown as React.DragEvent;
        e.dataTransfer?.setData("text/quest-id", todo.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 30, scale: 0.95, transition: { duration: 0.24 } }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
      className={`group relative overflow-hidden rounded-xl border bg-white/80 shadow-sm transition hover:bg-white ${
        overdue ? "border-red-300" : "border-mud-200"
      } ${done ? "opacity-70" : ""} ${failed ? "border-red-300" : ""} ${
        dragging ? "opacity-40" : ""
      } ${draggable && todo.status !== "done" ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${c.dot} ${
          done ? "opacity-40" : ""
        }`}
      />

      {/* sword-slash sweep */}
      <AnimatePresence>
        {slashing && (
          <motion.span
            className="pointer-events-none absolute inset-y-0 z-10 w-20 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white to-transparent"
            initial={{ left: "-20%", opacity: 0.95 }}
            animate={{ left: "110%", opacity: 0 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <div className={`flex items-start gap-2.5 ${compact ? "py-2 pl-3.5 pr-1.5" : "py-3 pl-4 pr-2"}`}>
        {/* --------------------------------------------------------- check */}
        <button
          ref={boxRef}
          onClick={handleCheck}
          aria-label={done ? "Mark as not done" : "Complete quest"}
          className={`group/box relative mt-0.5 grid shrink-0 place-items-center rounded-full border-2 transition active:scale-90 ${
            done
              ? "border-grass-600 bg-grass-600"
              : "border-mud-300 bg-white hover:border-grass-500 hover:bg-grass-100"
          } ${compact ? "size-6" : "size-7"}`}
        >
          {done ? (
            <motion.svg
              viewBox="0 0 24 24"
              className="size-4 text-white"
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 16 }}
            >
              <path
                d="M4 12.5 L9.5 18 L20 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.svg>
          ) : (
            // A missed quest keeps the same hover affordance as an open one:
            // finishing it late is the point.
            <span className="scale-0 text-xs opacity-0 transition-all group-hover/box:scale-100 group-hover/box:opacity-100">
              ✓
            </span>
          )}
        </button>

        {/* ---------------------------------------------------------- body */}
        <div className="min-w-0 flex-1">
          <div className="relative inline-block max-w-full">
            <p
              className={`break-words pr-1 font-medium leading-snug ${
                compact ? "text-[13.5px]" : "text-[15px]"
              } ${done ? "text-mud-400" : "text-mud-900"}`}
            >
              {todo.title}
            </p>
            {/* Only a finished quest is struck through. A missed one is still
                waiting to be done, so it stays legible. */}
            {(done || slashing) && (
              <motion.span
                className="absolute left-0 top-1/2 h-[2px] bg-grass-600"
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 0.32, ease: "easeOut" }}
              />
            )}
          </div>

          {todo.notes && !compact && (
            <p className="mt-1 line-clamp-2 text-[13px] text-mud-500">{todo.notes}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
            {category && showCategory && (
              <span className={`rounded-md px-1.5 py-0.5 font-semibold ${c.soft} ${c.text} ring-1 ring-inset ${c.ring}`}>
                {category.name}
              </span>
            )}

            {todo.due_date ? (
              <span
                className={`rounded-md px-1.5 py-0.5 font-semibold ring-1 ring-inset ${
                  done
                    ? "bg-mud-50 text-mud-400 ring-mud-200"
                    : URGENCY[urgencyOf(todo.due_date)]
                }`}
              >
                {compact ? describeDueShort(todo.due_date) : describeDue(todo.due_date)}
              </span>
            ) : (
              !done &&
              !failed && (
                <span className="rounded-md bg-mud-50 px-1.5 py-0.5 text-mud-400 ring-1 ring-inset ring-mud-200">
                  no deadline
                </span>
              )
            )}

            {done && (
              <span className="rounded-md bg-grass-100 px-1.5 py-0.5 font-bold text-grass-700 ring-1 ring-inset ring-grass-300">
                +{todo.xp_awarded} XP
                {todo.completed_at && !compact && (
                  <span className="ml-1 font-normal opacity-70">
                    {formatStamp(todo.completed_at)}
                  </span>
                )}
              </span>
            )}

            {failed && (
              <span
                className="rounded-md bg-red-100 px-1.5 py-0.5 font-bold text-red-700 ring-1 ring-inset ring-red-300"
                title="Still completable — finishing it refunds this and pays the late award"
              >
                missed{todo.xp_awarded !== 0 ? ` · ${todo.xp_awarded} XP` : ""}
              </span>
            )}

            {/* Steps carry no XP of their own, so this reads as progress rather
                than as a score. */}
            {steps.length > 0 && (
              <button
                onClick={() => toggleSteps(!showSteps)}
                aria-expanded={showSteps}
                className={`rounded-md px-1.5 py-0.5 font-semibold ring-1 ring-inset transition ${
                  stepsDone === steps.length
                    ? "bg-grass-100 text-grass-700 ring-grass-300"
                    : "bg-mud-50 text-mud-500 ring-mud-200 hover:bg-mud-100"
                }`}
              >
                {stepsDone}/{steps.length} steps
                <span aria-hidden className="ml-1 opacity-60">
                  {showSteps ? "▴" : "▾"}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* --------------------------------------------------------- right */}
        <button
          ref={dotsRef}
          onClick={() => (menuAt ? setMenuAt(null) : openMenu())}
          aria-label="Quest options"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-mud-400 opacity-0 transition hover:bg-mud-100 hover:text-mud-800 focus:opacity-100 group-hover:opacity-100"
        >
          ⋯
        </button>
      </div>

      {/* A finished quest's steps are history — they stay visible if they were
          open, but there is nothing left to add. */}
      {/* Fades in, but leaves on the spot: no AnimatePresence, no exit.
          Wrapping this in one left the checklist stranded — the exit tween ran
          to opacity 0 and the unmount never followed it, so a collapsed quest
          went on holding the full height of an invisible list. The row's own
          `layout` animation already absorbs the height either way, which is
          what made the exit worth so little in the first place. */}
      {showSteps && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
        >
          <SubtaskList
            todoId={todo.id}
            steps={steps}
            compact={compact}
            onChanged={onStepsChanged}
          />
        </motion.div>
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {menuAt && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.13 }}
                style={{
                  position: "fixed",
                  left: menuAt.left,
                  top: menuAt.top,
                  width: MENU_W,
                  zIndex: 90,
                  background: "#fdf9f0",
                }}
                className="overflow-hidden rounded-xl border border-mud-300 py-1 text-sm shadow-xl shadow-mud-900/25"
              >
                {!done && (
                  <MenuItem
                    onClick={() => {
                      setMenuAt(null);
                      onEdit(todo);
                    }}
                  >
                    Edit quest
                  </MenuItem>
                )}
                {!done && (
                  <MenuItem
                    onClick={() => {
                      setMenuAt(null);
                      toggleSteps(true);
                    }}
                  >
                    {steps.length ? "Show steps" : "Break into steps"}
                  </MenuItem>
                )}
                {done && (
                  <MenuItem
                    onClick={() => {
                      setMenuAt(null);
                      onUncomplete(todo);
                    }}
                  >
                    Undo (return XP)
                  </MenuItem>
                )}
                {/* Two ways off the board, and the labels have to say which is
                    which: abandoning is a broken promise that costs XP and is
                    counted against the category, deleting is for a quest that
                    was written down wrong and should leave no mark at all. */}
                {todo.status === "open" && todo.due_date && (
                  <MenuItem
                    danger
                    onClick={(e) => {
                      setMenuAt(null);
                      onAbandon(todo, { x: e.clientX, y: e.clientY });
                    }}
                    hint="counts as a missed deadline"
                  >
                    Abandon ({XP.abandon} XP)
                  </MenuItem>
                )}
                <MenuItem
                  danger
                  onClick={() => {
                    setMenuAt(null);
                    onDelete(todo);
                  }}
                  hint="as if it never existed"
                >
                  Delete
                </MenuItem>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </motion.li>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
  hint,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  /** A second, quieter line — for the items whose consequence isn't obvious. */
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left font-medium transition hover:bg-mud-100 ${
        danger ? "text-red-700" : "text-mud-800"
      }`}
    >
      {children}
      {hint && (
        <span className="mt-0.5 block text-[10px] font-normal text-mud-400">
          {hint}
        </span>
      )}
    </button>
  );
}
