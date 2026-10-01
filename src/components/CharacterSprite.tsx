"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BODY, DYE_SLOTS, dyeForSlot } from "@/lib/game";
import type { Appearance, BodyType, Equipped } from "@/lib/types";
import {
  CROP_TOP,
  DOWN_ROW,
  FRAME,
  load,
  recolorPixels,
  spriteJobs,
  VIEW_H,
  WALK_FRAMES,
} from "@/lib/sprite";

/* --------------------------------------------------------------------------
   Draws the character by compositing LPC sprite layers onto a canvas.

   Every sheet is a 9x4 grid of 64px frames (walk cycle: up / left / down /
   right). We only ever draw column 0 of the "down" row — the standing pose.

   Skin and hair colour are palette swaps: the shipped art uses one ramp, and
   we remap those exact pixels to another ramp from the LPC palette
   definitions. That is how the upstream generator recolours too, so the
   shading stays correct instead of being tinted flat.
   -------------------------------------------------------------------------- */

/** Draw one 64px frame, optionally remapping a colour ramp. */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  col: number,
  recolor?: { from: string[]; to: string[] }
) {
  const buf = document.createElement("canvas");
  buf.width = FRAME;
  buf.height = FRAME;
  const bctx = buf.getContext("2d", { willReadFrequently: true });
  if (!bctx) return;

  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(img, col * FRAME, DOWN_ROW * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME);

  if (recolor && recolor.from.length && recolor.to.length) recolorPixels(bctx, FRAME, FRAME, recolor);

  ctx.drawImage(buf, 0, -CROP_TOP);
}

export default function CharacterSprite({
  appearance,
  equipped,
  className = "",
  scale = 4,
  idle = true,
  interactive = false,
  onPoke,
}: {
  appearance: Appearance;
  equipped: Equipped;
  className?: string;
  /** Integer upscale; keeps pixels crisp. */
  scale?: number;
  idle?: boolean;
  /** Clicking plays the walk cycle in place. */
  interactive?: boolean;
  onPoke?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const timer = useRef<number | null>(null);

  // Friends' profiles are raw jsonb and predate this field, so don't trust it.
  const body: BodyType = appearance.body === "female" ? "female" : DEFAULT_BODY;

  const key = [
    body,
    appearance.skin,
    appearance.hair,
    appearance.hairColor,
    appearance.eyes,
    equipped.torso,
    equipped.weapon,
    equipped.head,
    equipped.cape,
    equipped.offhand,
    DYE_SLOTS.map((s) => dyeForSlot(equipped, s) ?? "-").join(","),
    frame,
  ].join("|");

  useEffect(() => {
    let cancelled = false;

    async function paint() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const jobs = spriteJobs(appearance, equipped);

      const images = await Promise.all(
        jobs.map((j) => load(j.layer.src).catch(() => null))
      );
      if (cancelled) return;

      canvas.width = FRAME;
      canvas.height = VIEW_H;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, FRAME, VIEW_H);

      images.forEach((img, i) => {
        if (img) drawLayer(ctx, img, frame, jobs[i].recolor);
      });

      setReady(true);
    }

    void paint();
    return () => {
      cancelled = true;
    };
    // `key` is the joined value of every field paint() reads, so it alone
    // captures when a repaint is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Don't leave a half-finished walk running if this unmounts.
  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    []
  );

  const poke = useCallback(() => {
    if (timer.current) return; // already strutting
    onPoke?.();

    let i = 0;
    timer.current = window.setInterval(() => {
      if (i >= WALK_FRAMES.length) {
        window.clearInterval(timer.current!);
        timer.current = null;
        setFrame(0);
        return;
      }
      setFrame(WALK_FRAMES[i++]);
    }, 80);
  }, [onPoke]);

  const art = (
    <canvas
      ref={canvasRef}
      width={FRAME}
      height={VIEW_H}
      aria-hidden
      style={{
        width: "100%",
        height: "100%",
        imageRendering: "pixelated",
        opacity: ready ? 1 : 0,
        transition: "opacity 180ms ease",
      }}
    />
  );

  const box = { width: FRAME * scale, height: VIEW_H * scale };

  if (!interactive) {
    return (
      <div
        className={`${className} ${idle ? "char-idle" : ""}`}
        role="img"
        aria-label="Your adventurer"
        style={box}
      >
        {art}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={poke}
      aria-label="Poke your adventurer"
      title="Poke me"
      className={`${className} ${idle ? "char-idle" : ""} cursor-pointer transition-transform active:scale-95`}
      style={box}
    >
      {art}
    </button>
  );
}
