"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  MONTH_YEAR,
  TIME_PRESETS,
  WEEKDAYS,
  describeDue,
  fromLocalInput,
  timeOf,
  withTimeString,
  monthMatrix,
  presetDue,
  sameDay,
  toLocalInput,
  withDate,
  withTime,
  type Preset,
} from "@/lib/date";

/* --------------------------------------------------------------------------
   Due-date control: a summary button that opens a popover with one-tap
   presets, a month calendar and time chips. Value is a `datetime-local`
   string; "" means no deadline.

   The popover renders through a portal into <body>. Inline, it was competing
   with the layout-animated category boxes (each of which is transformed, and
   so forms its own stacking context) and with nested backdrop-filter panels.
   A portal sidesteps both problems permanently.
   -------------------------------------------------------------------------- */

const PANEL_W = 304;
/**
 * The panel's real content height, measured rather than guessed. It was 430
 * against content of 547, so the bottom 119px — the time chips, the custom time
 * field and the footer — sat below the clip with no way to reach them, since a
 * fixed-position element has no page scroll to bring it back.
 *
 * Keep this in step if rows are added. `maxHeight` below is the safety net for
 * viewports too short to show the whole panel; it scrolls internally there.
 */
const PANEL_H = 512;

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "weekend", label: "Weekend" },
  { key: "week", label: "Next week" },
];

export default function DuePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const selected = fromLocalInput(value);
  const [view, setView] = useState(() => selected ?? new Date());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Track the trigger so the panel stays glued to it while scrolling.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;

      /* The panel is fixed-position, so anything hanging off the viewport is
         simply unreachable — there is no page scroll that would bring it back.
         That is what hid the time controls: with a hard 430px and no bound,
         a trigger low on a tall form put the bottom of the panel off-screen.

         So measure both gaps, take the roomier side, and hand the panel a
         maxHeight to scroll inside when neither side can hold it whole. */
      const GAP = 8;
      const below = window.innerHeight - r.bottom - GAP * 2;
      const above = r.top - GAP * 2;
      const flip = below < PANEL_H && above > below;
      const room = Math.max(200, flip ? above : below);
      const maxHeight = Math.min(PANEL_H, room);

      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
        top: flip
          ? Math.max(GAP, r.top - maxHeight - GAP)
          : Math.min(r.bottom + GAP, window.innerHeight - maxHeight - GAP),
        maxHeight,
      });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = useMemo(() => monthMatrix(view), [view]);
  const today = new Date();

  function pickPreset(key: Preset) {
    const next = presetDue(key);
    onChange(next);
    setView(fromLocalInput(next) ?? new Date());
    setOpen(false);
  }

  const panel = (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width: PANEL_W,
        maxHeight: pos?.maxHeight,
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        // Opaque on purpose — a floating panel must not read through.
        background: "#fdf9f0",
      }}
      className="rounded-2xl border border-mud-300 p-3 shadow-2xl shadow-mud-900/30"
    >
      {/* --------------------------------------------------------- presets */}
      <div className="grid shrink-0 grid-cols-2 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => pickPreset(p.key)}
            className="rounded-lg border-2 border-mud-200 bg-white px-2.5 py-2 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="my-3 h-px shrink-0 bg-mud-200" />

      {/* -------------------------------------------------------- calendar */}
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <button
          type="button"
          onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
          aria-label="Previous month"
          className="grid size-7 place-items-center rounded-lg text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
        >
          ‹
        </button>
        <span className="font-display text-sm font-bold tracking-wide text-mud-900">
          {MONTH_YEAR.format(view)}
        </span>
        <button
          type="button"
          onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
          aria-label="Next month"
          className="grid size-7 place-items-center rounded-lg text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
        >
          ›
        </button>
      </div>

      {/* Only the month grid scrolls. The presets, the time controls and the
          footer stay pinned, so on a short viewport the thing that gets cut is
          a few rows of dates — reachable by scrolling — rather than the time
          controls, which previously fell off the bottom entirely. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
      >
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((d, i) => (
          <span
            key={i}
            className="pb-1 text-[10px] font-bold uppercase text-mud-400"
          >
            {d}
          </span>
        ))}

        {days.map((d, i) => {
          const outside = d.getMonth() !== view.getMonth();
          const isToday = sameDay(d, today);
          const isSelected = selected ? sameDay(d, selected) : false;

          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(withDate(value, d))}
              className={`grid h-8 place-items-center rounded-lg text-xs transition ${
                isSelected
                  ? "bg-grass-600 font-bold text-white"
                  : isToday
                    ? "bg-grass-100 font-bold text-grass-700 ring-1 ring-inset ring-grass-400"
                    : outside
                      ? "text-mud-300 hover:bg-mud-100"
                      : "text-mud-800 hover:bg-mud-100"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      </div>

      <div className="my-2 h-px shrink-0 bg-mud-200" />

      {/* ------------------------------------------------------------ time */}
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {TIME_PRESETS.map((t) => {
          const on =
            selected?.getHours() === t.h && selected?.getMinutes() === t.m;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() =>
                onChange(withTime(value || toLocalInput(new Date()), t.h, t.m))
              }
              className={`rounded-lg px-2 py-1 text-[11px] transition ring-1 ring-inset ${
                on
                  ? "bg-grass-600 text-white ring-grass-700"
                  : "bg-white text-mud-600 ring-mud-200 hover:bg-mud-100 hover:text-mud-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <label className="mt-2 flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-semibold text-mud-500">At</span>
        <input
          type="time"
          value={timeOf(value)}
          onChange={(e) => {
            const next = withTimeString(value, e.target.value);
            // Null while the field is empty or half-typed; ignoring it keeps a
            // deadline from being wiped mid-keystroke.
            if (next) onChange(next);
          }}
          className="field min-w-0 flex-1 rounded-lg px-2 py-1 text-xs"
        />
      </label>

      <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="rounded-lg px-2 py-1.5 text-xs font-semibold text-mud-500 transition hover:text-red-700"
        >
          No deadline
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg bg-mud-800 px-3 py-1.5 text-xs font-bold text-mud-50 transition hover:bg-mud-900"
        >
          Done
        </button>
      </div>
    </motion.div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
          selected
            ? "border-sky-400 bg-sky-50 text-sky-900 font-semibold"
            : "border-mud-300 bg-white/70 text-mud-500 hover:border-mud-500"
        }`}
      >
                <span className="flex-1 truncate">
          {selected ? describeDue(selected.toISOString()) : "No deadline"}
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear deadline"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onChange("");
              }
            }}
            className="rounded px-1 text-mud-400 transition hover:text-red-700"
          >
            ✕
          </span>
        )}
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>{open && pos && panel}</AnimatePresence>,
          document.body
        )}
    </>
  );
}
