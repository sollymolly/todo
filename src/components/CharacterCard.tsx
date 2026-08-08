"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import CharacterSprite from "@/components/CharacterSprite";
import XPBar from "@/components/XPBar";
import { findItem, SLOTS } from "@/lib/game";
import type { Appearance, Equipped } from "@/lib/types";

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
    <div className="panel rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate font-display text-lg font-bold tracking-wide text-mud-900">
          {name}
        </h2>
        <Link
          href="/character"
          className="shrink-0 rounded-lg border border-mud-300 bg-white/70 px-2.5 py-1 text-xs font-semibold text-mud-600 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
        >
          Customize
        </Link>
      </div>

      <motion.div
        className="relative mx-auto w-fit"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        <CharacterSprite
          appearance={appearance}
          equipped={equipped}
          scale={4}
          interactive
          onPoke={() => setPoke((n) => n + 1)}
          className="relative drop-shadow-[0_8px_10px_rgba(42,30,19,0.35)]"
        />
        <Sparkles trigger={poke} />
      </motion.div>

      <div className="mt-2">
        <XPBar xp={xp} />
      </div>

      {/* Each slot links straight into the Armoury with that tab open. */}
      <ul className="mt-4 space-y-1">
        {SLOTS.map(({ slot, label }) => {
          const item = findItem(slot, equipped[slot]);
          return (
            <li key={slot}>
              <Link
                href={`/character?slot=${slot}`}
                className="group flex items-center gap-2 rounded-lg border border-transparent bg-white/60 px-2.5 py-1.5 text-xs transition hover:border-grass-400 hover:bg-grass-50"
              >
                <span className="w-16 shrink-0 font-semibold text-mud-500">
                  {label}
                </span>
                <span className="truncate font-medium text-mud-900">
                  {item?.name ?? "—"}
                </span>
                <span className="ml-auto shrink-0 text-mud-300 transition group-hover:text-grass-600">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* stats */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
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
              className="absolute text-lg"
              initial={{ x: 0, y: 6, scale: 0.4, opacity: 0 }}
              animate={{
                x: Math.cos(a) * 74,
                y: Math.sin(a) * 58 - 10,
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
    <div className="rounded-xl border border-mud-200 bg-white/70 px-2 py-2">
      <p
        className={`font-display text-lg font-bold tabular-nums ${
          tone === "good"
            ? "text-grass-600"
            : tone === "warn"
              ? "text-amber-600"
              : "text-mud-900"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-mud-400">
        {label}
      </p>
    </div>
  );
}
