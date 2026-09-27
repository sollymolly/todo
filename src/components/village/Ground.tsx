"use client";

import { useEffect, useRef } from "react";
import { ATLAS, GROUND, T, inRect, type World } from "@/components/village/world";

/* --------------------------------------------------------------------------
   The ground, painted once onto one canvas at 1× and scaled up with crisp
   pixels: grass everywhere, dirt streets and door paths, a stone plaza.
   -------------------------------------------------------------------------- */

export default function Ground({ world, scale }: { world: World; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.imageSmoothingEnabled = false;
      const tile = (t: readonly [number, number], x: number, y: number) =>
        ctx.drawImage(img, t[0] * T, t[1] * T, T, T, x * T, y * T, T, T);

      const doors = new Set(world.plots.filter((p) => p.owner).map((p) => `${p.door.x},${p.door.y}`));
      for (let y = 0; y < world.h; y++)
        for (let x = 0; x < world.w; x++) {
          if (inRect(world.hall.plaza, x, y)) tile(GROUND.stone, x, y);
          else if (world.streets.some((s) => inRect(s, x, y)) || doors.has(`${x},${y}`))
            tile((x * 7 + y * 13) % 5 === 0 ? GROUND.dirtPebbles : GROUND.dirt, x, y);
          else tile(GROUND.grass, x, y);
        }
      // A soft darkening at the forest's edge, so the margin reads as woods.
      const g = ctx.createLinearGradient(0, 0, 0, 4 * T);
      g.addColorStop(0, "rgba(20,40,20,0.35)");
      g.addColorStop(1, "rgba(20,40,20,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, world.w * T, 4 * T);
    };
    img.src = ATLAS;
    return () => {
      cancelled = true;
    };
  }, [world]);

  return (
    <canvas
      ref={ref}
      width={world.w * T}
      height={world.h * T}
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: world.w * T * scale,
        height: world.h * T * scale,
        imageRendering: "pixelated",
        background: "#7fae3f",
      }}
    />
  );
}
