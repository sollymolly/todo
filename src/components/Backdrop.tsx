"use client";

import { useBackdropMotion } from "@/lib/motion-pref";

/* --------------------------------------------------------------------------
   What sits behind the panels on every page but the Armoury.

   The warm paper gradient itself is the body's background (globals.css), so
   pages that never render this — sign-in, password reset — still get it.
   This adds the one bit of life: a soft wash of window light from the top
   corner, and a few motes of dust drifting through it. Slow, faint, and off
   with a switch in the menu or for anyone who asks their system for reduced
   motion.
   -------------------------------------------------------------------------- */

export default function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Light falling in from the upper left, as if from a window. */}
      <div className="absolute -left-1/4 -top-1/4 h-[90vh] w-[80vw] rotate-[-18deg] bg-[radial-gradient(ellipse_at_center,rgba(255,250,235,0.75),rgba(255,250,235,0)_65%)]" />
      <Motes />
    </div>
  );
}

/* Positions, sizes and timings are fixed rather than random: the server and
   the browser must render identical markup, and a hand-placed scatter looks
   less like a screensaver than a random one anyway. [left %, top %, size px,
   seconds per drift, delay s] */
const MOTES: [number, number, number, number, number][] = [
  [8, 22, 3, 26, 0],
  [14, 58, 2, 31, 6],
  [21, 12, 2, 24, 11],
  [27, 40, 3, 34, 3],
  [33, 75, 2, 29, 15],
  [41, 30, 2, 27, 8],
  [48, 64, 3, 33, 19],
  [56, 18, 2, 30, 4],
  [63, 48, 2, 25, 13],
  [71, 80, 3, 32, 9],
  [78, 26, 2, 28, 17],
  [86, 56, 3, 35, 2],
  [92, 36, 2, 26, 21],
];

export function Motes() {
  const [on] = useBackdropMotion();
  if (!on) return null;
  return (
    <>
      {MOTES.map(([left, top, size, dur, delay], i) => (
        <span
          key={i}
          className="mote absolute rounded-full"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: size,
            height: size,
            animationDuration: `${dur}s`,
            animationDelay: `-${delay}s`,
          }}
        />
      ))}
    </>
  );
}
