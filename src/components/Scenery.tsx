"use client";

import { useEffect, useState } from "react";

/* --------------------------------------------------------------------------
   A quiet medieval countryside behind the UI, tiled from the LPC Tile Atlas
   (32px tiles, CC-BY-SA 3.0 / GPL 3.0 — public/sprites/tiles/Attribution.txt).

   Three rules keep it reading as scenery rather than a game screenshot:

   1. Never stretch. The ground is a seamless 4x4 block repeated by CSS at an
      exact integer scale, so tiles stay square at any viewport size. The
      previous version scaled a fixed canvas to cover, which squashed the
      pixels and was most of why it looked wrong.
   2. Keep the middle calm. Trees and rocks are anchored to the left and right
      margins, where the panels don't sit, so nothing fights the text.
   3. Sit it back. A warm parchment wash and vignette drop the saturation to
      match the panels.

   Everything is painted once on mount. Nothing moves.
   -------------------------------------------------------------------------- */

const T = 32; // atlas tile size
const S = 2; // integer upscale
const BLOCK = 4; // tiles per seamless repeat

const ATLAS = "/sprites/tiles/terrain_atlas.png";

/* Interior tiles only — LPC terrain blocks are 3x3 autotiles whose edges are
   grass-to-nothing transitions, and those tile as dark seams.

   Mixing tiles from different blocks reads as a brightness checkerboard at
   this scale, so the ground uses one tile and lets the wash carry the depth. */
const GRASS: [number, number][] = [[1, 23]];

/** [col, row, widthPx, heightPx] */
const PROPS = {
  pine: [24, 15, 96, 96],
  bush: [24, 14, 64, 64],
  boulder: [26, 22, 64, 64],
  rocks: [26, 24, 64, 64],
  stump: [23, 18, 32, 32],
} as const;

type PropName = keyof typeof PROPS;

/* Fixed placements as a fraction of viewport height, hugging each margin. */
const LEFT: { prop: PropName; top: number; x: number }[] = [
  { prop: "pine", top: 0.03, x: 16 },
  { prop: "bush", top: 0.26, x: 104 },
  { prop: "pine", top: 0.41, x: 4 },
  { prop: "boulder", top: 0.62, x: 92 },
  { prop: "pine", top: 0.73, x: 12 },
  { prop: "rocks", top: 0.91, x: 96 },
];

const RIGHT: { prop: PropName; top: number; x: number }[] = [
  { prop: "pine", top: 0.02, x: 10 },
  { prop: "rocks", top: 0.21, x: 100 },
  { prop: "pine", top: 0.35, x: 18 },
  { prop: "bush", top: 0.55, x: 104 },
  { prop: "stump", top: 0.69, x: 44 },
  { prop: "pine", top: 0.79, x: 8 },
];

function cut(
  img: HTMLImageElement,
  col: number,
  row: number,
  w: number,
  h: number
): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, col * T, row * T, w, h, 0, 0, w, h);
  return c.toDataURL();
}

export default function Scenery() {
  const [ground, setGround] = useState<string | null>(null);
  const [art, setArt] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = ATLAS;

    img.onload = () => {
      if (cancelled) return;

      // ---- seamless ground block ----------------------------------------
      const c = document.createElement("canvas");
      c.width = BLOCK * T;
      c.height = BLOCK * T;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;

      for (let r = 0; r < BLOCK; r++) {
        for (let col = 0; col < BLOCK; col++) {
          // Irregular pick so the repeat isn't obvious at a glance.
          const [tc, tr] = GRASS[(col * 3 + r * 5) % GRASS.length];
          ctx.drawImage(img, tc * T, tr * T, T, T, col * T, r * T, T, T);
        }
      }
      setGround(c.toDataURL());

      // ---- props ---------------------------------------------------------
      const out: Record<string, string> = {};
      for (const [name, spec] of Object.entries(PROPS)) {
        const [col, row, w, h] = spec;
        out[name] = cut(img, col, row, w, h);
      }
      setArt(out);
    };

    return () => {
      cancelled = true;
    };
  }, []);

  const propStyle = (name: PropName) => {
    const [, , w, h] = PROPS[name];
    return {
      backgroundImage: `url(${art[name]})`,
      backgroundSize: "100% 100%",
      width: w * S,
      height: h * S,
      imageRendering: "pixelated" as const,
    };
  };

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#5f8a3f]">
      {ground && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${ground})`,
            backgroundRepeat: "repeat",
            backgroundSize: `${BLOCK * T * S}px ${BLOCK * T * S}px`,
            imageRendering: "pixelated",
          }}
        />
      )}

      {/* Margin planting — hidden on narrow screens, where there is no margin. */}
      {Object.keys(art).length > 0 && (
        <>
          <div className="absolute inset-y-0 left-0 hidden w-[230px] xl:block">
            {LEFT.map((p, i) => (
              <div
                key={i}
                className="absolute"
                style={{ ...propStyle(p.prop), top: `${p.top * 100}%`, left: p.x }}
              />
            ))}
          </div>
          <div className="absolute inset-y-0 right-0 hidden w-[230px] xl:block">
            {RIGHT.map((p, i) => (
              <div
                key={i}
                className="absolute"
                style={{ ...propStyle(p.prop), top: `${p.top * 100}%`, right: p.x }}
              />
            ))}
          </div>
        </>
      )}

      {/* Parchment wash — ties the scene to the panels and drops its contrast. */}
      <div className="absolute inset-0 bg-[#f4ead6]/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#fdf8ef]/70 via-transparent to-[#fdf8ef]/55" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 42%, transparent 32%, rgba(90,68,40,0.20) 100%)",
        }}
      />
    </div>
  );
}
