"use client";

import Link from "next/link";
import CharacterSprite from "@/components/CharacterSprite";
import XPBar from "@/components/XPBar";
import type { Appearance, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   The character, as one slim strip above the quests.

   It used to be a whole column — a large sprite, the gear list, stat tiles —
   and it took a third of the page from the thing the page is for. Now it's a
   glance: who you are, how far to the next level, and three numbers.

   The whole strip is the way into the Armoury. It's the obvious thing to
   click, so anything smaller — a "Customize" link beside the name, or the
   sprite alone — just made people hunt for the right spot.
   -------------------------------------------------------------------------- */

export default function CharacterCard({
  name,
  xp,
  appearance,
  equipped,
  stats,
}: {
  name: string;
  xp: number;
  appearance: Appearance;
  equipped: Equipped;
  stats: { done: number; open: number; onTime: number; missed: number };
}) {
  const rate =
    stats.onTime + stats.missed > 0
      ? Math.round((stats.onTime / (stats.onTime + stats.missed)) * 100)
      : null;

  return (
    <Link
      href="/character"
      aria-label={`${name} — customize your character`}
      className="panel panel-hover group flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-grass-400"
    >
      <div className="shrink-0 transition-transform group-hover:-translate-y-0.5">
        <CharacterSprite appearance={appearance} equipped={equipped} scale={1} />
      </div>

      <div className="min-w-0 flex-1 basis-56">
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold text-mud-900">{name}</h2>
          <span className="shrink-0 text-xs font-medium text-mud-400 transition group-hover:text-grass-700">
            Customize →
          </span>
        </div>
        <XPBar xp={xp} compact />
      </div>

      <div className="flex gap-5">
        <Stat value={stats.done} label="completed" />
        <Stat value={stats.open} label="in progress" />
        <Stat
          value={rate === null ? "—" : `${rate}%`}
          label="on time"
          tone={rate !== null && rate >= 70 ? "good" : rate !== null ? "warn" : undefined}
        />
      </div>
    </Link>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="text-right">
      <p
        className={`text-base font-semibold leading-tight tabular-nums ${
          tone === "good"
            ? "text-grass-600"
            : tone === "warn"
              ? "text-amber-600"
              : "text-mud-900"
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-mud-500">{label}</p>
    </div>
  );
}
