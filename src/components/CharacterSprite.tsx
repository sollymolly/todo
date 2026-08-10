"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import manifest from "../../public/sprites/lpc/manifest.json";
import {
  DEFAULT_BODY,
  DEFAULT_EYES,
  DYE_SLOTS,
  dyeForSlot,
  findItem,
  type DyeKind,
} from "@/lib/game";
import type { Appearance, BodyType, DyeSlot, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   Draws the character by compositing LPC sprite layers onto a canvas.

   Every sheet is a 9x4 grid of 64px frames (walk cycle: up / left / down /
   right). We only ever draw column 0 of the "down" row — the standing pose.

   Skin and hair colour are palette swaps: the shipped art uses one ramp, and
   we remap those exact pixels to another ramp from the LPC palette
   definitions. That is how the upstream generator recolours too, so the
   shading stays correct instead of being tinted flat.
   -------------------------------------------------------------------------- */

const FRAME = manifest.frame; // 64
const DOWN_ROW = 2;
const WALK_FRAMES = [1, 2, 3, 4, 5, 6, 7, 8];

/** LPC leaves headroom above the skull for tall helmets; trim most of it. */
const CROP_TOP = 7;
const VIEW_H = FRAME - CROP_TOP;

type Layer = {
  src: string;
  z: number;
  baseRamp?: string;
  /**
   * Present on gear the fetch script found to be painted in a single cloth or
   * metal ramp. That pair — the family and the ramp within it — is everything
   * needed to dye the sheet: remap `palettes[dyeKind][baseRamp]` to the ramp
   * the wearer picked.
   */
  dyeKind?: string;
};

/** A dye as the renderer needs it: a palette family plus a ramp within it. */
type AppliedDye = { kind: DyeKind; id: string };

/** Every item ships one layer list per body type — gear doesn't line up across them. */
type SlotTable = Record<string, { name: string; bodies: Record<string, Layer[]> }>;

const SLOTS = manifest.slots as unknown as Record<string, SlotTable>;
const PALETTES = manifest.palettes as unknown as Record<
  string,
  Record<string, string[]>
>;

/* Fallbacks only — the fetch script records the real base ramp per sheet in
   the manifest, detected from the shipped pixels. */
const BASE_BODY_RAMP = "light";
const BASE_HAIR_RAMP = "orange";

/* Our catalogue ids -> LPC palette names. */
/**
 * One distinct LPC ramp per tone, ordered light to dark by the mid-tone
 * luminance of each ramp: light 179, amber 173, olive 122, taupe 113,
 * brown 89, black 47.
 *
 * `bronze` deliberately resolves to LPC's *taupe* rather than its `bronze`
 * ramp: that one's mid-tone (#7F4C31) sits a single luminance step from
 * `brown` (#76513A), so the two read as the same colour on a 64px sprite —
 * exactly the duplicate this mapping exists to avoid.
 *
 * `porcelain` is retired but kept here: a profile saved before the change
 * still renders correctly until its owner next touches the Armoury.
 */
const SKIN_RAMP: Record<string, string> = {
  fair: "light",
  tan: "amber",
  olive: "olive",
  bronze: "taupe",
  deep: "brown",
  ebony: "black",
  porcelain: "light", // legacy — same ramp Fair uses, so nothing shifts
};

/**
 * Our labels -> LPC hair ramps, chosen so the name matches what renders. LPC's
 * ramp names are not reliable descriptions of their colour, which is where the
 * previous mapping went wrong:
 *
 *   `platinum` is a tan blonde, not a silver  -> "Silver" looked blonde
 *   `ash`      is a rosy brown, not a grey    -> "Ash" wasn't grey either
 *   `ginger`   is orange                      -> "Ember" never looked red
 *   `violet`   is almost pure blue (hue 255)  -> "Violet" looked blue
 *
 * Every ramp here is 6 entries, matching the `orange` ramp the hair sheets are
 * drawn in. That matters: drawLayer remaps pairwise up to the shorter of the
 * two, so a target with fewer stops would leave the tail of each strand
 * stubbornly orange.
 */
const HAIR_RAMP: Record<string, string> = {
  raven: "raven",       // blue-black
  chestnut: "chestnut", // warm reddish brown
  auburn: "redhead",    // dark red-brown
  ash: "gray",          // true neutral grey
  gold: "gold",         // bright golden blonde
  silver: "white",      // pale silver
  ember: "red",         // actually red
  moss: "green",
  violet: "purple",     // the purple people expect
};

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Nearest available ramp name, so an unknown id still renders. */
function ramp(kind: string, want: string, fallback: string): string[] {
  const table = PALETTES?.[kind] ?? {};
  return table[want] ?? table[fallback] ?? [];
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function load(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed: ${src}`));
      img.src = src;
    });
    imageCache.set(src, p);
  }
  return p;
}

/** Draw one 64px frame, optionally remapping a colour ramp. */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
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

  if (recolor && recolor.from.length && recolor.to.length) {
    const n = Math.min(recolor.from.length, recolor.to.length);
    const from = recolor.from.slice(0, n).map(hexToRgb);
    const to = recolor.to.slice(0, n).map(hexToRgb);

    const data = bctx.getImageData(0, 0, FRAME, FRAME);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      for (let k = 0; k < n; k++) {
        if (px[i] === from[k][0] && px[i + 1] === from[k][1] && px[i + 2] === from[k][2]) {
          px[i] = to[k][0];
          px[i + 1] = to[k][1];
          px[i + 2] = to[k][2];
          break;
        }
      }
    }
    bctx.putImageData(data, 0, 0);
  }

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

      const skinTo = ramp("body", SKIN_RAMP[appearance.skin] ?? "light", "light");
      const hairTo = ramp("hair", HAIR_RAMP[appearance.hairColor] ?? "black", "black");

      // Build the draw list, sorted by the z-order LPC ships with.
      const jobs: { layer: Layer; recolor?: { from: string[]; to: string[] } }[] = [];

      /** The dye on a slot, as a family plus a ramp within it. */
      const dyeOf = (slot: DyeSlot): AppliedDye | null => {
        const item = findItem(slot, equipped[slot]);
        const id = dyeForSlot(equipped, slot);
        return item?.dye && id ? { kind: item.dye.kind, id } : null;
      };

      const push = (
        slot: string,
        id: string | undefined,
        tint?: { kind: "body" | "hair"; to: string[]; fallback: string },
        dye?: AppliedDye | null
      ) => {
        if (!id || id === "none") return;
        const item = SLOTS[slot]?.[id];
        if (!item) return;
        const layers = item.bodies[body] ?? item.bodies[DEFAULT_BODY] ?? [];
        for (const layer of layers) {
          let recolor;
          if (tint?.to.length) {
            // Each sheet declares the ramp it was drawn in; without that we
            // would be remapping colours that aren't there.
            const from = ramp(tint.kind, layer.baseRamp ?? tint.fallback, tint.fallback);
            if (from.length) recolor = { from, to: tint.to };
          } else if (dye && layer.dyeKind && layer.baseRamp) {
            // Same swap, one family over: gear declares which ramp it ships in
            // and the dye names the ramp to land on. A layer the fetch script
            // couldn't pin to a single ramp carries no dyeKind and is left
            // alone, which is why buckles and trim survive a dye job.
            const from = PALETTES[layer.dyeKind]?.[layer.baseRamp] ?? [];
            const to = PALETTES[dye.kind]?.[dye.id] ?? [];
            if (from.length && to.length) recolor = { from, to };
          }
          jobs.push({ layer, recolor });
        }
      };

      // Heavy armour brings matching greaves and sabatons with it.
      const heavy = new Set(["chain", "plate", "gilded", "dragonscale"]);
      const armoured = heavy.has(equipped.torso);

      const torsoDye = dyeOf("torso");

      const skin = { kind: "body" as const, to: skinTo, fallback: BASE_BODY_RAMP };
      push("base", "body", skin);
      push("base", "head", skin);
      // The head sheet has blue eyes painted on; this covers them. Not tinted —
      // each colour is its own sheet, so a palette swap would fight the art.
      // Values saved before eyes had art aren't colours, hence the fallback.
      push("eyes", SLOTS.eyes?.[appearance.eyes] ? appearance.eyes : DEFAULT_EYES);
      push("cape", equipped.cape, undefined, dyeOf("cape"));
      // The greaves and sabatons are part of the suit, not a separate garment,
      // so they take the armour's dye — gilded plate would look odd above bare
      // steel shins. Cloth legs keep their own colour: the torso dye is the
      // shirt's, and dyeing the trousers to match makes a jumpsuit.
      push("legs", armoured ? "armour" : "cloth", undefined, armoured ? torsoDye : null);
      push("feet", armoured ? "armour" : "boots", undefined, armoured ? torsoDye : null);
      push("torso", equipped.torso, undefined, torsoDye);
      push("hair", appearance.hair, {
        kind: "hair",
        to: hairTo,
        fallback: BASE_HAIR_RAMP,
      });
      push("head", equipped.head, undefined, dyeOf("head"));
      push("offhand", equipped.offhand);
      push("weapon", equipped.weapon);

      jobs.sort((a, b) => a.layer.z - b.layer.z);

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
