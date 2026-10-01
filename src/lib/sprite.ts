"use client";

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
   How a knight is dressed: which LPC sheets are layered, in what order, and
   how each is recoloured — shared by the portrait (CharacterSprite) and the
   village's walkers, so the two can never disagree about what someone wears.

   Every sheet is a 9x4 grid of 64px frames: a walk cycle facing up, left,
   down and right. (A few weapons ship on 128px frames; load() trims them.)
   -------------------------------------------------------------------------- */

export const FRAME = manifest.frame; // 64
export const DOWN_ROW = 2;
export const WALK_FRAMES = [1, 2, 3, 4, 5, 6, 7, 8];

/** LPC leaves headroom above the skull for tall helmets; trim most of it. */
export const CROP_TOP = 7;
export const VIEW_H = FRAME - CROP_TOP;

export type Layer = {
  src: string;
  z: number;
  /** Frame size when it isn't 64: long weapons' swings (128 or 192). */
  frame?: number;
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

/**
 * Every item ships one layer list per body type — gear doesn't line up
 * across them — for walking, and per duel animation (fetch-lpc-attack.py).
 */
type SlotTable = Record<string, { name: string; bodies: Record<string, Layer[]>; anims?: Partial<Record<Anim, Record<string, Layer[]>>> }>;

/** A duel animation: the swing, and the thrust a pointy stick does instead. */
export type Anim = "slash" | "thrust";
const ANIM_FRAMES: Record<Anim, number> = { slash: 6, thrust: 8 };

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

export function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Nearest available ramp name, so an unknown id still renders. */
export function ramp(kind: string, want: string, fallback: string): string[] {
  const table = PALETTES?.[kind] ?? {};
  return table[want] ?? table[fallback] ?? [];
}

const imageCache = new Map<string, Promise<CanvasImageSource>>();
const rawCache = new Map<string, Promise<HTMLImageElement>>();

/** A sheet as it is. */
function loadRaw(src: string): Promise<HTMLImageElement> {
  let p = rawCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed: ${src}`));
      img.src = src;
    });
    rawCache.set(src, p);
  }
  return p;
}

/**
 * One layer's sheet, as the usual 9×4 grid of 64px frames. A few weapons
 * (the katana and scimitar: runeblade, dragonfang) are drawn on 128px
 * frames so their blades have room; the knight sits in the middle of each,
 * so the middle 64px of each is the frame that lines up with everything
 * else. A blade that reaches past it is trimmed at the frame's edge, as
 * every other weapon's is.
 */
function asFrames(img: HTMLImageElement): CanvasImageSource {
  const size = img.naturalHeight / 4;
  if (size === FRAME) return img;
  const pad = (size - FRAME) / 2;
  const out = document.createElement("canvas");
  out.width = FRAME * 9;
  out.height = FRAME * 4;
  const ctx = out.getContext("2d");
  if (!ctx) return img;
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 9; col++)
      ctx.drawImage(img, col * size + pad, row * size + pad, FRAME, FRAME, col * FRAME, row * FRAME, FRAME, FRAME);
  return out;
}

/** A walk sheet, as 64px frames (asFrames). */
export function load(src: string): Promise<CanvasImageSource> {
  let p = imageCache.get(src);
  if (!p) {
    p = loadRaw(src).then(asFrames);
    imageCache.set(src, p);
  }
  return p;
}

/** One layer to draw, and where it goes in the stack (`z`: its own, unless it's held — see below). */
export type Job = { layer: Layer; recolor?: { from: string[]; to: string[] }; z: number };

/**
 * Weapons and shields go underneath the knight, whatever z-order LPC gives
 * them: what's held shows around the body, never over it. (A hand axe held
 * across the chest is mostly hidden facing forward; its swing still shows.)
 */
const HELD = new Set(["weapon", "offhand"]);
const UNDER = -1000;

/**
 * The layers that make up this knight, bottom first, each with its
 * recolour: walking, or in a duel animation.
 */
export function spriteJobs(appearance: Appearance, equipped: Equipped, anim?: Anim): Job[] {
  // Friends' profiles are raw jsonb and predate this field, so don't trust it.
  const body: BodyType = appearance.body === "female" ? "female" : DEFAULT_BODY;

  const skinTo = ramp("body", SKIN_RAMP[appearance.skin] ?? "light", "light");
  const hairTo = ramp("hair", HAIR_RAMP[appearance.hairColor] ?? "black", "black");

  // Build the draw list, sorted by the z-order LPC ships with.
  const jobs: Job[] = [];

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
    const sheets = anim ? item.anims?.[anim] : item.bodies;
    const layers = sheets?.[body] ?? sheets?.[DEFAULT_BODY] ?? [];
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
      jobs.push({ layer, recolor, z: HELD.has(slot) ? layer.z + UNDER : layer.z });
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

  jobs.sort((a, b) => a.z - b.z);
  return jobs;
}

/** Remaps exact colours in place, pairwise along two ramps. */
export function recolorPixels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  recolor: { from: string[]; to: string[] }
) {
  const n = Math.min(recolor.from.length, recolor.to.length);
  if (!n) return;
  const from = recolor.from.slice(0, n).map(hexToRgb);
  const to = recolor.to.slice(0, n).map(hexToRgb);
  const data = ctx.getImageData(0, 0, w, h);
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
  ctx.putImageData(data, 0, 0);
}

export function spriteKey(appearance: Appearance, equipped: Equipped): string {
  return [
    appearance.body,
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
  ].join("|");
}

const sheets = new Map<string, Promise<string>>();

/**
 * The whole walk sheet for this knight — every direction, every frame —
 * layered and recoloured once, as an image URL. Walking is then only a
 * matter of which part of it shows, which is what lets a village of them
 * move without redrawing a pixel.
 */
export function composeSheet(appearance: Appearance, equipped: Equipped): Promise<string> {
  const key = spriteKey(appearance, equipped);
  let p = sheets.get(key);
  if (!p) {
    p = (async () => {
      const jobs = spriteJobs(appearance, equipped);
      const images = await Promise.all(jobs.map((j) => load(j.layer.src).catch(() => null)));
      const W = FRAME * 9;
      const H = FRAME * 4;
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const octx = out.getContext("2d");
      if (!octx) return "";
      octx.imageSmoothingEnabled = false;
      const buf = document.createElement("canvas");
      buf.width = W;
      buf.height = H;
      const bctx = buf.getContext("2d", { willReadFrequently: true });
      if (!bctx) return "";
      bctx.imageSmoothingEnabled = false;
      images.forEach((img, i) => {
        if (!img) return;
        bctx.clearRect(0, 0, W, H);
        bctx.drawImage(img, 0, 0, W, H, 0, 0, W, H);
        const r = jobs[i].recolor;
        if (r && r.from.length && r.to.length) recolorPixels(bctx, W, H, r);
        octx.drawImage(buf, 0, 0);
      });
      return out.toDataURL("image/png");
    })();
    sheets.set(key, p);
  }
  return p;
}

/** A knight's duel sheet: `cols` frames a row, four rows, each frame `frame` px square. */
export type AttackSheet = { url: string; frame: number; cols: number; anim: Anim };

/**
 * Which duel animation a knight has: the swing — or, for a weapon drawn
 * without one (the pointy stick), the thrust, which suits it anyway.
 */
export function attackAnim(equipped: Equipped): Anim {
  const weapon = SLOTS.weapon?.[equipped.weapon];
  return !weapon || weapon.anims?.slash ? "slash" : weapon.anims?.thrust ? "thrust" : "slash";
}

const attacks = new Map<string, Promise<AttackSheet | null>>();

/**
 * This knight's duel animation, layered and recoloured like the walk sheet.
 * Long weapons swing on bigger frames (128 or 192px) so the blade has room;
 * every layer is centred in a frame as big as the biggest, so the knight
 * stands in the same place in all of them as in their walk frames.
 */
export function composeAttack(appearance: Appearance, equipped: Equipped): Promise<AttackSheet | null> {
  const key = spriteKey(appearance, equipped);
  let p = attacks.get(key);
  if (!p) {
    p = (async () => {
      const anim = attackAnim(equipped);
      const cols = ANIM_FRAMES[anim];
      const jobs = spriteJobs(appearance, equipped, anim);
      if (!jobs.length) return null;
      const images = await Promise.all(jobs.map((j) => loadRaw(j.layer.src).catch(() => null)));
      const F = Math.max(FRAME, ...jobs.map((j) => j.layer.frame ?? FRAME));
      const out = document.createElement("canvas");
      out.width = F * cols;
      out.height = F * 4;
      const octx = out.getContext("2d");
      if (!octx) return null;
      octx.imageSmoothingEnabled = false;
      images.forEach((img, i) => {
        if (!img) return;
        const f = jobs[i].layer.frame ?? FRAME;
        const w = f * cols;
        const buf = document.createElement("canvas");
        buf.width = w;
        buf.height = f * 4;
        const bctx = buf.getContext("2d", { willReadFrequently: true });
        if (!bctx) return;
        bctx.imageSmoothingEnabled = false;
        // Only the frames this animation uses: some sheets are padded wider.
        bctx.drawImage(img, 0, 0, w, f * 4, 0, 0, w, f * 4);
        const r = jobs[i].recolor;
        if (r && r.from.length && r.to.length) recolorPixels(bctx, w, f * 4, r);
        const pad = (F - f) / 2;
        for (let row = 0; row < 4; row++)
          for (let col = 0; col < cols; col++)
            octx.drawImage(buf, col * f, row * f, f, f, col * F + pad, row * F + pad, f, f);
      });
      return { url: out.toDataURL("image/png"), frame: F, cols, anim };
    })();
    attacks.set(key, p);
  }
  return p;
}
