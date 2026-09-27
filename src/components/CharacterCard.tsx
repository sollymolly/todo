"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import CharacterSprite from "@/components/CharacterSprite";
import XPBar from "@/components/XPBar";
import type { Appearance, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   The character, as one slim strip above the quests.

   It used to be a whole column — a large sprite, the gear list, stat tiles —
   and it took a third of the page from the thing the page is for. Now it's a
   glance: who you are, how far to the next level, and three numbers. The gear
   lives one click away in the Armoury.
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
  const [poke, setPoke] = useState(0);

  const rate =
    stats.onTime + stats.missed > 0
      ? Math.round((stats.onTime / (stats.onTime + stats.missed)) * 100)
      : null;

  return (
    <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-2.5">
      <div className="relative shrink-0">
        <CharacterSprite
          appearance={appearance}
          equipped={equipped}
          scale={1}
          interactive
          onPoke={() => setPoke((n) => n + 1)}
          className="relative"
        />
        <Sparkles trigger={poke} />
      </div>

      <div className="min-w-0 flex-1 basis-56">
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold text-mud-900">{name}</h2>
          <Link
            href="/character"
            className="shrink-0 text-xs font-medium text-mud-500 underline-offset-2 transition hover:text-grass-700 hover:underline"
          >
            Customize
          </Link>
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
    </div>
  );
}

/** A quick puff of sparkles when the character is poked. */
function Sparkles({ trigger }: { trigger: number }) {
  if (trigger === 0) return null;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={trigger}
        className="pointer-events-none absolute inset-0 grid place-items-center"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1 }}
      >
        {["✦", "✧", "★", "✦", "◆", "✧"].map((g, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <motion.span
              key={i}
              className="absolute text-xs"
              initial={{ x: 0, y: 4, scale: 0.4, opacity: 0 }}
              animate={{
                x: Math.cos(a) * 34,
                y: Math.sin(a) * 26 - 6,
                scale: 1.05,
                opacity: [0, 1, 0],
              }}
              transition={{ duration: 0.85, ease: "easeOut" }}
            >
              {g}
            </motion.span>
          );
        })}
      </motion.div>
    </AnimatePresence>
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
