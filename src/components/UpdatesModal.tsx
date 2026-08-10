"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { markUpdatesSeen } from "@/lib/feedback-actions";
import { formatWeek, type Update } from "@/lib/updates";

/* --------------------------------------------------------------------------
   The weekly changelog, shown once on the first visit of a week in which
   something shipped.

   Dismissal is optimistic on purpose: the modal closes immediately and the
   "seen" write happens behind it. If that write fails the worst case is being
   shown the same notes again later, which is a far better failure than a modal
   that sits there while a request is in flight.
   -------------------------------------------------------------------------- */

export default function UpdatesModal({ update }: { update: Update }) {
  const [open, setOpen] = useState(true);

  function dismiss() {
    setOpen(false);
    void markUpdatesSeen(update.week);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-mud-900/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
        >
          <motion.div
            className="panel flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
            initial={{ scale: 0.95, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="What's new"
          >
            <header className="border-b border-mud-200 bg-mud-100 px-5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-mud-500">
                What&apos;s new · week of {formatWeek(update.week)}
              </p>
              <h2 className="mt-0.5 font-display text-lg font-bold text-mud-900">
                {update.title}
              </h2>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ul className="space-y-2.5">
                {update.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-sm leading-relaxed text-mud-700"
                  >
                    <span aria-hidden className="mt-0.5 shrink-0 text-mud-400">
                      •
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <footer className="flex items-center gap-2 border-t border-mud-200 bg-mud-50 px-5 py-3">
              <Link
                href="/feedback"
                onClick={dismiss}
                className="text-xs font-semibold text-mud-500 underline-offset-2 transition hover:text-grass-700 hover:underline"
              >
                Send feedback
              </Link>
              <Link
                href="/updates"
                onClick={dismiss}
                className="text-xs font-semibold text-mud-500 underline-offset-2 transition hover:text-grass-700 hover:underline"
              >
                All updates
              </Link>
              <button
                onClick={dismiss}
                autoFocus
                className="ml-auto rounded-xl bg-grass-600 px-4 py-2 font-display text-sm font-bold tracking-wide text-white transition hover:bg-grass-500 active:scale-[0.98]"
              >
                Onwards
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
