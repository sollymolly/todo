"use client";

import { motion } from "motion/react";
import { progressFor } from "@/lib/game";

export default function XPBar({
  xp,
  compact = false,
}: {
  xp: number;
  compact?: boolean;
}) {
  const p = progressFor(xp);

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-mud-800 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-mud-50">
            Lv {p.level}
          </span>
          <span className="font-display text-sm font-bold tracking-wide text-mud-900">
            {p.title}
          </span>
        </div>
        <span className="font-mono text-[11px] font-bold tabular-nums text-mud-500">
          {p.into} / {p.needed}
        </span>
      </div>

      <div
        className={`w-full overflow-hidden rounded-full border border-mud-300 bg-mud-100 ${
          compact ? "h-2.5" : "h-3.5"
        }`}
      >
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-grass-400 to-grass-600"
          initial={false}
          animate={{ width: `${Math.max(2, p.pct * 100)}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        />
      </div>

      {!compact && (
        <p className="mt-1.5 text-[11px] font-medium text-mud-500">
          {p.ceiling - xp} XP to{" "}
          <span className="font-bold text-grass-700">level {p.level + 1}</span>
        </p>
      )}
    </div>
  );
}
