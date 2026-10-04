"use client";

import { useEffect, useRef } from "react";
import { ATLAS, GROUND, T, inRect, lotFence, type Rect, type Theme, type World } from "@/components/village/world";

/* --------------------------------------------------------------------------
   The ground, painted once onto one canvas at 1× and scaled up with crisp
   pixels: grass everywhere, dirt streets and door paths, tilled empty lots, a
   stone plaza.
   -------------------------------------------------------------------------- */

/** The plaza's stones: the town hall's grey, a shade darker underfoot. */
const STONE = { faces: ["#aaa398", "#a59e93"], top: "#bbb4a9", shade: "#928b81", joint: "#6f6961" };
const STONE_W = 32;
const STONE_H = 16;

/**
 * The plaza, as rectangles to fill: stone blocks in a running bond, two
 * courses a tile, each course's joints half a block along from the last,
 * the same all the way across. Drawn rather than taken from the atlas,
 * whose stone is one picture spread over several tiles and doesn't repeat
 * cleanly from a single one. In px, at 1×.
 */
function stonePaving(r: Rect): { x: number; y: number; w: number; h: number; fill: string }[] {
  const x0 = r.x * T;
  const y0 = r.y * T;
  const x1 = (r.x + r.w) * T;
  const y1 = (r.y + r.h) * T;
  const out = [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: STONE.joint }];
  for (let y = y0; y < y1; y += STONE_H) {
    const course = y / STONE_H;
    const shift = course % 2 ? STONE_W / 2 : 0;
    for (let bx = x0 - shift; bx < x1; bx += STONE_W) {
      // Each block, cut off at the plaza's edge, with a 1px joint all round.
      const l = Math.max(bx, x0) + 1;
      const rgt = Math.min(bx + STONE_W, x1) - 1;
      const w = rgt - l;
      const h = STONE_H - 2;
      const face = STONE.faces[((bx / (STONE_W / 2)) * 7 + course * 3) & 1];
      out.push({ x: l, y: y + 1, w, h, fill: face });
      out.push({ x: l, y: y + 1, w, h: 1, fill: STONE.top });
      out.push({ x: l, y: y + h, w, h: 1, fill: STONE.shade });
    }
  }
  return out;
}

/** Each village's grass, washed over the meadow's (world.ts, Theme). */
const GRASS_TINT: Record<Theme, string | null> = {
  meadow: null,
  autumn: "rgba(214,140,40,0.35)",
  forest: "rgba(10,50,20,0.3)",
  spring: "rgba(170,230,120,0.22)",
  snowy: "rgba(240,246,255,0.82)",
};

/** The railway along the bottom: a gravel bed, sleepers, two rails. In px, at 1×. */
function railway(r: Rect): { x: number; y: number; w: number; h: number; fill: string }[] {
  const x0 = r.x * T;
  const y0 = r.y * T;
  const w = r.w * T;
  const h = r.h * T;
  const out = [{ x: x0, y: y0 + 6, w, h: h - 12, fill: "#8a7a66" }];
  for (let x = x0; x < x0 + w; x += 16) out.push({ x, y: y0 + 12, w: 7, h: h - 24, fill: "#5a4632" });
  out.push({ x: x0, y: y0 + 18, w, h: 3, fill: "#b8bcc0" }, { x: x0, y: y0 + h - 21, w, h: 3, fill: "#b8bcc0" });
  return out;
}

/**
 * An empty lot, as rectangles to fill: dark tilled soil in furrows — land
 * waiting for a house, nothing like the packed dirt of a road. `r` is the
 * soil in px, at 1×: the lot inside its fence (world.ts, lotFence), which
 * stands on the middle of the lot's edge tiles.
 */
function lotSoil(r: Rect): { x: number; y: number; w: number; h: number; fill: string }[] {
  const { x: x0, y: y0, w, h } = r;
  const out = [{ x: x0, y: y0, w, h, fill: "#6e4b30" }];
  for (let y = y0 + 6; y < y0 + h - 4; y += 10) {
    out.push({ x: x0 + 6, y, w: w - 12, h: 3, fill: "#5a3c25" });
    out.push({ x: x0 + 6, y: y + 3, w: w - 12, h: 1, fill: "#87603f" });
  }
  return out;
}

/**
 * Rows of tiles per canvas. The village grows downward as people arrive,
 * and one canvas can only be so big (iOS draws nothing past ~16M pixels),
 * so the ground is painted in strips of this many rows.
 */
const STRIP = 32;

export default function Ground({ world, scale }: { world: World; scale: number }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const strips = Math.ceil(world.h / STRIP);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const doors = new Set(world.plots.filter((p) => p.owner).map((p) => `${p.door.x},${p.door.y}`));
      // An empty lot is tilled soil inside its fence, from the fence's line
      // (the middle of the lot's edge tiles) to the path through its gate.
      const empty = world.plots.filter((p) => !p.owner);
      const lots = empty.map((p) => ({ x: (p.x + 1.5) * T, y: (p.y + 1.5) * T, w: 5 * T, h: 4.5 * T }));
      for (const p of empty) for (const g of lotFence(p.x, p.y).gate.tiles) doors.add(`${g.x},${g.y}`);
      const paving = [
        ...stonePaving(world.hall.plaza),
        ...stonePaving(world.station.platform),
        ...railway(world.station.track),
        ...lots.flatMap(lotSoil),
      ];
      const tint = GRASS_TINT[world.theme];
      refs.current.slice(0, strips).forEach((canvas, i) => {
        const ctx = canvas?.getContext("2d");
        if (!ctx) return;
        const top = i * STRIP;
        // Drawn in the village's own px; each strip shows its own rows.
        ctx.setTransform(1, 0, 0, 1, 0, -top * T);
        ctx.imageSmoothingEnabled = false;
        const tile = (t: readonly [number, number], x: number, y: number) =>
          ctx.drawImage(img, t[0] * T, t[1] * T, T, T, x * T, y * T, T, T);
        for (let y = top; y < Math.min(world.h, top + STRIP); y++)
          for (let x = 0; x < world.w; x++) {
            if (inRect(world.hall.plaza, x, y)) continue; // paved below
            if (world.streets.some((s) => inRect(s, x, y)) || doors.has(`${x},${y}`))
              tile((x * 7 + y * 13) % 5 === 0 ? GROUND.dirtPebbles : GROUND.dirt, x, y);
            else {
              tile(GROUND.grass, x, y);
              if (tint) {
                ctx.fillStyle = tint;
                ctx.fillRect(x * T, y * T, T, T);
              }
            }
          }
        for (const s of paving) {
          ctx.fillStyle = s.fill;
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        // A soft darkening at the forest's edge, so the margin reads as woods.
        const g = ctx.createLinearGradient(0, 0, 0, 4 * T);
        g.addColorStop(0, "rgba(20,40,20,0.35)");
        g.addColorStop(1, "rgba(20,40,20,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, world.w * T, 4 * T);
      });
    };
    img.src = ATLAS;
    return () => {
      cancelled = true;
    };
  }, [world, strips]);

  return (
    <>
      {Array.from({ length: strips }, (_, i) => {
        const rows = Math.min(STRIP, world.h - i * STRIP);
        return (
          <canvas
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            width={world.w * T}
            height={rows * T}
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: i * STRIP * T * scale,
              width: world.w * T * scale,
              height: rows * T * scale,
              imageRendering: "pixelated",
              background: "#7fae3f",
            }}
          />
        );
      })}
    </>
  );
}
