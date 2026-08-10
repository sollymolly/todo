"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { signOut } from "@/lib/auth-actions";
import { forgetPrivateKey } from "@/lib/crypto";

/* --------------------------------------------------------------------------
   Everything that isn't a daily action, behind one button.

   Habits and Messages stay in the header because they're things you do; the
   rest — who you travel with, what changed, telling me it's broken, your
   password — are things you visit occasionally, and six competing buttons made
   none of them findable.
   -------------------------------------------------------------------------- */

const ITEMS: { href: string; label: string }[] = [
  { href: "/friends", label: "Companions" },
  { href: "/updates", label: "What's new" },
  { href: "/feedback", label: "Feedback" },
  { href: "/account", label: "Account" },
];

export default function HeaderMenu({
  name,
  /** Shows a dot on "What's new" when there's an entry not yet seen. */
  hasUnseenUpdate = false,
}: {
  name: string;
  hasUnseenUpdate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
      >
        <span className="max-w-[10ch] truncate">{name}</span>
        <span aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
        {hasUnseenUpdate && !open && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-600"
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.13 }}
            // Opaque: a floating menu must not read through to the board.
            style={{ background: "#fdf9f0" }}
            className="absolute right-0 z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-mud-300 py-1 shadow-xl shadow-mud-900/25"
          >
            {ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-3 py-2 text-sm font-medium text-mud-800 transition hover:bg-mud-100"
              >
                {item.label}
                {item.href === "/updates" && hasUnseenUpdate && (
                  <span aria-hidden className="size-2 rounded-full bg-red-600" />
                )}
              </Link>
            ))}

            <div className="my-1 h-px bg-mud-200" />

            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                onClick={() => forgetPrivateKey()}
                className="w-full px-3 py-2 text-left text-sm font-medium text-red-700 transition hover:bg-red-50"
              >
                Sign out
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
