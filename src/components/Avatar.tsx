"use client";

import { useEffect, useState } from "react";
import { composeSheet } from "@/lib/sprite";
import type { Appearance, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   Someone's knight, head and shoulders, in a circle — the profile picture
   for messaging. Cut from the same composed walk sheet the village uses, so
   it's their real hair, helmet and dyes, and it's built once per look.
   -------------------------------------------------------------------------- */

export default function Avatar({
  appearance,
  equipped,
  size = 40,
  online = false,
}: {
  appearance: Appearance;
  equipped: Equipped;
  size?: number;
  /** A small green dot: they're in the village right now. */
  online?: boolean;
}) {
  const [sheet, setSheet] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void composeSheet(appearance, equipped).then((url) => live && setSheet(url || null));
    return () => {
      live = false;
    };
  }, [appearance, equipped]);

  // The face sits around (32, 150) of the 576×256 sheet (down-facing row,
  // frame 0); show a 32px window of it, scaled to `size`.
  const s = size / 32;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="block size-full overflow-hidden rounded-full bg-[#d5e5bd] ring-1 ring-mud-300"
        style={{
          backgroundImage: sheet ? `url(${sheet})` : undefined,
          backgroundSize: `${576 * s}px ${256 * s}px`,
          backgroundPosition: `${-16 * s}px ${-(128 + 7) * s}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
      {online && (
        <span className="absolute bottom-0 right-0 size-[28%] min-h-2.5 min-w-2.5 rounded-full bg-grass-500 ring-2 ring-mud-50" />
      )}
    </span>
  );
}
