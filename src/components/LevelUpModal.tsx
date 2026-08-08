"use client";

import { AnimatePresence, motion } from "motion/react";
import CharacterSprite from "@/components/CharacterSprite";
import { RANKS, unlockedAtLevel } from "@/lib/game";
import type { Appearance, Equipped } from "@/lib/types";

export default function LevelUpModal({
  level,
  appearance,
  equipped,
  onClose,
}: {
  level: number | null;
  appearance: Appearance;
  equipped: Equipped;
  onClose: () => void;
}) {
  const unlocked = level ? unlockedAtLevel(level) : [];
  const title = level ? rankTitle(level) : "";

  return (
    <AnimatePresence>
      {level !== null && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-mud-900/70 p-5 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="panel relative w-full max-w-md overflow-hidden rounded-2xl p-7 text-center"
            initial={{ scale: 0.85, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* rotating god-rays behind the character */}
            <motion.div
              className="pointer-events-none absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 opacity-30"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, rgba(253,224,71,0.55) 12deg, transparent 26deg, transparent 45deg, rgba(253,224,71,0.55) 57deg, transparent 72deg, transparent 90deg, rgba(253,224,71,0.55) 102deg, transparent 118deg, transparent 140deg, rgba(253,224,71,0.55) 152deg, transparent 168deg, transparent 190deg, rgba(253,224,71,0.55) 202deg, transparent 218deg, transparent 245deg, rgba(253,224,71,0.55) 257deg, transparent 273deg, transparent 300deg, rgba(253,224,71,0.55) 312deg, transparent 328deg)",
                maskImage:
                  "radial-gradient(circle, black 20%, transparent 68%)",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 22, ease: "linear", repeat: Infinity }}
            />

            <div className="relative">
              <motion.p
                className="font-display text-xs font-bold uppercase tracking-[0.35em] text-grass-700"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                Level Up
              </motion.p>

              <motion.h2
                className="mt-1 font-display text-5xl font-bold text-mud-900"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
              >
                {level}
              </motion.h2>

              <p className="font-display text-lg font-bold tracking-wide text-grass-700">
                {title}
              </p>

              <motion.div
                className="mx-auto mt-2 w-fit"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <CharacterSprite
                  appearance={appearance}
                  equipped={equipped}
                  scale={3}
                  className="drop-shadow-[0_8px_12px_rgba(42,30,19,0.35)]"
                />
              </motion.div>

              {unlocked.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-mud-500">
                    New gear unlocked
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {unlocked.map((item, i) => (
                      <motion.li
                        key={`${item.slot}-${item.id}`}
                        className="flex items-center justify-center gap-2 rounded-lg bg-grass-50 px-3 py-1.5 text-sm ring-1 ring-grass-300"
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.35 + i * 0.09 }}
                      >
                        <span>
                        </span>
                        <span className="font-bold text-grass-700">
                          {item.name}
                        </span>
                        <span className="text-mud-500">— {item.blurb}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-sm text-mud-500">
                  Your legend grows. Keep going.
                </p>
              )}

              <button
                onClick={onClose}
                className="mt-5 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white transition hover:bg-grass-500 active:scale-[0.98]"
              >
                Onward
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function rankTitle(level: number) {
  return RANKS[level - 1]?.title ?? `Living Legend ${level - RANKS.length + 1}`;
}
