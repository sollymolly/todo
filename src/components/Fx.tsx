"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/* --------------------------------------------------------------------------
   A tiny effects layer. Anything in the tree can call useFx().celebrate({...})
   with a screen coordinate and get particles, a rune ring and a floating XP
   number rendered above the whole app.
   -------------------------------------------------------------------------- */

type Tone = "good" | "great" | "bad";

export type Celebration = {
  x: number;
  y: number;
  xp: number;
  tone?: Tone;
  label?: string;
};

type Bit = {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
  dur: number;
  glyph: string;
};

type Live = Celebration & { id: number; tone: Tone; bits: Bit[] };

const FxContext = createContext<{ celebrate: (c: Celebration) => void }>({
  celebrate: () => {},
});

export function useFx() {
  return useContext(FxContext);
}

const GLYPHS = {
  good: ["✨", "⭐️", "🪙", "💫"],
  great: ["⚔️", "✨", "🪙", "👑", "💎", "⭐️"],
  bad: ["💀", "🌫️", "🖤"],
} as const;

/** Trajectories are rolled once, in the event handler, never during render. */
function scatter(tone: Tone): Bit[] {
  const count = tone === "great" ? 20 : tone === "bad" ? 10 : 14;
  const glyphs = GLYPHS[tone];

  return Array.from({ length: count }, (_, i) => {
    const angle =
      tone === "bad"
        ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6
        : (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = tone === "bad" ? 40 + Math.random() * 50 : 70 + Math.random() * 110;

    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - (tone === "bad" ? 30 : 0),
      rot: (Math.random() - 0.5) * 540,
      scale: 0.7 + Math.random() * 0.8,
      dur: 0.75 + Math.random() * 0.55,
      glyph: glyphs[i % glyphs.length],
    };
  });
}

export function FxProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState<Live[]>([]);
  const seq = useRef(0);

  const celebrate = useCallback((c: Celebration) => {
    const tone: Tone = c.tone ?? (c.xp < 0 ? "bad" : c.xp >= 25 ? "great" : "good");
    const id = ++seq.current;
    setLive((prev) => [...prev, { ...c, id, tone, bits: scatter(tone) }]);
    window.setTimeout(
      () => setLive((prev) => prev.filter((e) => e.id !== id)),
      1800
    );
  }, []);

  const value = useMemo(() => ({ celebrate }), [celebrate]);

  return (
    <FxContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        <AnimatePresence>
          {live.map((e) => (
            <Burst key={e.id} e={e} />
          ))}
        </AnimatePresence>
      </div>
    </FxContext.Provider>
  );
}

function Burst({ e }: { e: Live }) {
  const ringColor =
    e.tone === "bad"
      ? "rgba(244,63,94,0.55)"
      : e.tone === "great"
        ? "rgba(253,224,71,0.75)"
        : "rgba(167,243,208,0.6)";

  return (
    <div
      className="absolute"
      style={{ left: e.x, top: e.y, transform: "translate(-50%,-50%)" }}
    >
      {/* expanding rune ring */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ border: `2px solid ${ringColor}` }}
        initial={{ scale: 0.3, opacity: 0.9 }}
        animate={{ scale: 2.4, opacity: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />
      {e.tone !== "bad" && (
        <motion.div
          className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(253,224,71,0.6) 0%, transparent 70%)",
          }}
          initial={{ scale: 0.2, opacity: 1 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}

      {/* particles */}
      {e.bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute left-0 top-0 select-none text-lg"
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{
            x: b.dx,
            y: b.dy,
            opacity: 0,
            scale: b.scale,
            rotate: b.rot,
          }}
          transition={{ duration: b.dur, ease: [0.15, 0.6, 0.35, 1] }}
        >
          {b.glyph}
        </motion.span>
      ))}

      {/* floating XP counter */}
      <motion.div
        className={`absolute left-0 top-0 whitespace-nowrap font-display text-xl font-bold drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] ${
          e.xp < 0 ? "text-red-600" : "text-grass-700"
        }`}
        initial={{ y: 0, opacity: 0, scale: 0.7 }}
        animate={{ y: -62, opacity: [0, 1, 1, 0], scale: 1.15 }}
        transition={{ duration: 1.4, ease: "easeOut", times: [0, 0.15, 0.7, 1] }}
      >
        {e.xp >= 0 ? "+" : ""}
        {e.xp} XP
      </motion.div>

      {e.label && (
        <motion.div
          className="absolute left-0 top-0 whitespace-nowrap text-xs font-bold uppercase tracking-widest text-mud-700"
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: -32, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.4, ease: "easeOut", times: [0, 0.2, 0.7, 1] }}
        >
          {e.label}
        </motion.div>
      )}
    </div>
  );
}
