"use client";

import { useEffect } from "react";

/* --------------------------------------------------------------------------
   Between villages: a few seconds aboard, the countryside going by, then
   the station at the other end. Shorter with reduced motion.
   -------------------------------------------------------------------------- */

const RIDE_MS = 3200;

export default function TrainRide({ to, onDone }: { to: string; onDone: () => void }) {
  useEffect(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const id = setTimeout(onDone, still ? 900 : RIDE_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-[80000] overflow-hidden bg-gradient-to-b from-[#9fd3f2] to-[#e8f4d8]">
      {/* Far hills, near hills, then the line */}
      <div className="ride-far absolute inset-x-0 bottom-[30%] h-[30%]">
        <svg viewBox="0 0 800 120" preserveAspectRatio="none" className="h-full w-[200%]" aria-hidden>
          <path d="M0 120 L0 60 Q100 10 200 60 T400 60 T600 60 T800 60 L800 120 Z" fill="#8bbf6a" />
        </svg>
      </div>
      <div className="ride-near absolute inset-x-0 bottom-[18%] h-[22%]">
        <svg viewBox="0 0 800 100" preserveAspectRatio="none" className="h-full w-[200%]" aria-hidden>
          <path d="M0 100 L0 50 Q60 10 120 50 T240 50 T360 50 T480 50 T600 50 T720 50 T800 50 L800 100 Z" fill="#5f8f34" />
          {[60, 210, 330, 470, 610, 740].map((x) => (
            <g key={x}>
              <rect x={x} y="30" width="6" height="20" fill="#6b4a2b" />
              <circle cx={x + 3} cy="26" r="14" fill="#3f7a2a" />
            </g>
          ))}
        </svg>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[18%] bg-[#7a6a52]">
        <div className="ride-sleepers absolute inset-x-0 top-3 h-3 w-[200%] bg-[repeating-linear-gradient(90deg,#4a3a2a_0_10px,transparent_10px_28px)]" />
        <div className="absolute inset-x-0 top-2 h-1 bg-[#c0c4c8]" />
        <div className="absolute inset-x-0 top-6 h-1 bg-[#c0c4c8]" />
      </div>
      {/* The train */}
      <div className="ride-train absolute bottom-[17%] left-1/2 w-[min(90%,520px)] -translate-x-1/2">
        <svg viewBox="0 0 520 120" className="w-full" shapeRendering="crispEdges" aria-hidden>
          <g className="ride-smoke" opacity="0.8">
            <rect x="420" y="0" width="16" height="16" fill="#e6e2dc" />
            <rect x="404" y="-14" width="20" height="20" fill="#efece7" />
          </g>
          {/* Carriages */}
          {[0, 150].map((x) => (
            <g key={x}>
              <rect x={x + 10} y="40" width="130" height="58" rx="6" fill="#8a3a29" stroke="#3b2a1c" strokeWidth="3" />
              <rect x={x + 10} y="40" width="130" height="10" fill="#6b2a1d" />
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={x + 22 + i * 30} y="56" width="20" height="18" fill="#ffd66b" stroke="#5a3e28" strokeWidth="2" />
              ))}
              <circle cx={x + 40} cy="102" r="10" fill="#3b2a1c" />
              <circle cx={x + 110} cy="102" r="10" fill="#3b2a1c" />
            </g>
          ))}
          {/* The engine */}
          <rect x="300" y="50" width="150" height="48" rx="6" fill="#2f5d8a" stroke="#3b2a1c" strokeWidth="3" />
          <rect x="300" y="26" width="56" height="40" fill="#2f5d8a" stroke="#3b2a1c" strokeWidth="3" />
          <rect x="310" y="34" width="36" height="18" fill="#ffd66b" stroke="#5a3e28" strokeWidth="2" />
          <rect x="418" y="18" width="20" height="34" fill="#3b2a1c" />
          <path d="M450 98 L480 98 L450 74 Z" fill="#c0392b" stroke="#3b2a1c" strokeWidth="2" />
          {[330, 380, 430].map((x) => (
            <circle key={x} cx={x} cy="102" r="12" fill="#3b2a1c" />
          ))}
        </svg>
      </div>
      <p className="panel absolute left-1/2 top-[18%] -translate-x-1/2 rounded-xl px-4 py-2 font-display text-lg font-bold text-mud-900 shadow-lg">
        All aboard for {to}…
      </p>
    </div>
  );
}
