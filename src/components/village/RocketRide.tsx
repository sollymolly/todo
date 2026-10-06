"use client";

import { useEffect } from "react";

/* --------------------------------------------------------------------------
   To a planet, or back from one: a few seconds among the stars, the planet
   ahead growing as it comes in, then its station. Shorter with reduced
   motion. TrainRide's counterpart.
   -------------------------------------------------------------------------- */

const RIDE_MS = 3400;

/** Stars scattered over a tile twice the screen's height, the same every ride: each half alike, so the scroll joins up. */
function Stars({ n, seed, r }: { n: number; seed: number; r: number }) {
  return (
    <svg viewBox="0 0 400 800" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      {Array.from({ length: n }).flatMap((_, i) => {
        const x = (i * 97 + seed * 31) % 400;
        const y = (i * 211 + seed * 53) % 400;
        const o = 0.5 + (i % 3) * 0.2;
        return [0, 400].map((dy) => <rect key={`${i}-${dy}`} x={x} y={y + dy} width={r} height={r * 2.5} fill="#fff" opacity={o} />);
      })}
    </svg>
  );
}

export default function RocketRide({ to, color, onDone }: { to: string; /** The world ahead. */ color: string; onDone: () => void }) {
  useEffect(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const id = setTimeout(onDone, still ? 900 : RIDE_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-[80000] overflow-hidden bg-gradient-to-b from-[#05060f] via-[#141433] to-[#2a1f4a]">
      {/* Far stars, near stars */}
      <div className="rocket-far absolute inset-x-0 -top-full h-[200%]">
        <Stars n={60} seed={1} r={1.5} />
      </div>
      <div className="rocket-near absolute inset-x-0 -top-full h-[200%]">
        <Stars n={18} seed={7} r={2.5} />
      </div>
      {/* The world ahead */}
      <div className="absolute left-1/2 top-[6%] -translate-x-1/2">
        <div className="rocket-planet size-40 rounded-full shadow-[0_0_60px_rgba(255,255,255,0.25)]" style={{ background: `radial-gradient(circle at 35% 30%, #ffffff55, ${color} 45%, #00000088)` }} />
      </div>
      {/* The rocket */}
      <div className="absolute bottom-[16%] left-1/2 w-[min(28%,110px)] -translate-x-1/2">
        <svg viewBox="0 0 60 130" className="rocket-ship w-full" shapeRendering="crispEdges" aria-hidden>
          <g className="rocket-flame">
            <path d="M22 100 L30 128 L38 100 Z" fill="#ffb347" />
            <path d="M26 100 L30 116 L34 100 Z" fill="#fff3b0" />
          </g>
          {/* Fins */}
          <path d="M14 70 L2 96 L16 96 Z" fill="#c0392b" stroke="#2a1f1a" strokeWidth="2" />
          <path d="M46 70 L58 96 L44 96 Z" fill="#c0392b" stroke="#2a1f1a" strokeWidth="2" />
          {/* Body and nose */}
          <path d="M30 2 Q46 22 46 52 L46 100 L14 100 L14 52 Q14 22 30 2 Z" fill="#eceff3" stroke="#2a1f1a" strokeWidth="2.5" />
          <path d="M30 2 Q40 14 43 26 L17 26 Q20 14 30 2 Z" fill="#c0392b" />
          <circle cx="30" cy="48" r="8" fill="#6fc4dc" stroke="#2a1f1a" strokeWidth="2.5" />
          <rect x="14" y="86" width="32" height="6" fill="#a7a9b0" />
        </svg>
      </div>
      <p className="panel absolute bottom-[3%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl px-4 py-2 font-display text-lg font-bold text-mud-900 shadow-lg">
        Lift-off for {to}…
      </p>
    </div>
  );
}
