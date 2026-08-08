import type { Appearance, BodyType, Equipped, Slot } from "./types";

/* ==========================================================================
   XP economy — these mirror the SQL functions in db/schema.sql.
   If you change a number here, change it there too (SQL is the source of
   truth; these values only drive the previews shown in the UI).
   ========================================================================== */

export const XP = {
  noDeadline: 5,
  onTime: 25,
  late: 8,
  penalty: -15,
  /** Hours past the deadline before a quest auto-fails. */
  graceHours: 24,
} as const;

/** What the user would earn if they finished this quest right now. */
export function previewXp(due: string | null): number {
  if (!due) return XP.noDeadline;
  return Date.now() <= new Date(due).getTime() ? XP.onTime : XP.late;
}

/* ==========================================================================
   Ranks
   ========================================================================== */

export type Rank = { level: number; title: string; xp: number };

export const RANKS: Rank[] = [
  { level: 1, title: "Ragged Peasant", xp: 0 },
  { level: 2, title: "Wanderer", xp: 50 },
  { level: 3, title: "Squire", xp: 130 },
  { level: 4, title: "Footman", xp: 250 },
  { level: 5, title: "Man-at-Arms", xp: 420 },
  { level: 6, title: "Sellsword", xp: 650 },
  { level: 7, title: "Knight", xp: 950 },
  { level: 8, title: "Knight-Errant", xp: 1330 },
  { level: 9, title: "Champion", xp: 1800 },
  { level: 10, title: "Crusader", xp: 2370 },
  { level: 11, title: "Paladin", xp: 3050 },
  { level: 12, title: "Warlord", xp: 3850 },
  { level: 13, title: "Vanguard", xp: 4780 },
  { level: 14, title: "Highlord", xp: 5850 },
  { level: 15, title: "Dragonslayer", xp: 7070 },
  { level: 16, title: "Archon", xp: 8450 },
  { level: 17, title: "Grandmaster", xp: 10000 },
  { level: 18, title: "Warden of Dawn", xp: 11730 },
  { level: 19, title: "Immortal", xp: 13650 },
  { level: 20, title: "Living Legend", xp: 15770 },
];

/** XP required to reach a level, extending past the named ranks. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const named = RANKS[level - 1];
  if (named) return named.xp;
  const last = RANKS[RANKS.length - 1];
  return last.xp + (level - last.level) * 2500;
}

export type Progress = {
  level: number;
  title: string;
  xp: number;
  floor: number;
  ceiling: number;
  into: number;
  needed: number;
  /** 0–1 through the current level. */
  pct: number;
};

export function progressFor(xp: number): Progress {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;

  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const title =
    RANKS[level - 1]?.title ?? `Living Legend ${level - RANKS.length + 1}`;

  return {
    level,
    title,
    xp,
    floor,
    ceiling,
    into: xp - floor,
    needed: ceiling - floor,
    pct: Math.min(1, (xp - floor) / (ceiling - floor)),
  };
}

export function levelFor(xp: number): number {
  return progressFor(xp).level;
}

/* ==========================================================================
   Wardrobe — unlocked by level, equipped freely once unlocked.
   ========================================================================== */

export type Item = {
  id: string;
  slot: Slot;
  name: string;
  level: number;
  blurb: string;
};

export const SLOTS: { slot: Slot; label: string }[] = [
  { slot: "torso", label: "Armor" },
  { slot: "weapon", label: "Weapon" },
  { slot: "head", label: "Headgear" },
  { slot: "cape", label: "Cloak" },
  { slot: "offhand", label: "Off-hand" },
];

export const ITEMS: Item[] = [
  // ---- torso -------------------------------------------------------------
  { id: "rags", slot: "torso", name: "Rags", level: 1, blurb: "Barely cloth. Everyone starts here." },
  { id: "tunic", slot: "torso", name: "Linen Tunic", level: 2, blurb: "Clean, if unremarkable." },
  { id: "jerkin", slot: "torso", name: "Leather Jerkin", level: 4, blurb: "Boiled hide. Stops a knife, mostly." },
  { id: "scale", slot: "torso", name: "Scale Mail", level: 6, blurb: "Overlapping plates, jingles when you walk." },
  { id: "chain", slot: "torso", name: "Chainmail", level: 8, blurb: "Ten thousand rings, hand-riveted." },
  { id: "plate", slot: "torso", name: "Knight's Plate", level: 11, blurb: "You clank now. It suits you." },
  { id: "gilded", slot: "torso", name: "Gilded Plate", level: 15, blurb: "Gold-chased steel, fit for a court." },
  { id: "dragonscale", slot: "torso", name: "Dragonscale", level: 19, blurb: "Still warm." },

  // ---- weapon ------------------------------------------------------------
  { id: "stick", slot: "weapon", name: "Pointy Stick", level: 1, blurb: "Technically a weapon." },
  { id: "dagger", slot: "weapon", name: "Rusty Dagger", level: 2, blurb: "Tetanus included at no charge." },
  { id: "shortsword", slot: "weapon", name: "Shortsword", level: 3, blurb: "An honest blade." },
  { id: "axe", slot: "weapon", name: "Hand Axe", level: 5, blurb: "Chops wood and arguments." },
  { id: "hammer", slot: "weapon", name: "Warhammer", level: 7, blurb: "Subtlety is not the point." },
  { id: "longsword", slot: "weapon", name: "Longsword", level: 9, blurb: "Balanced, keen, quietly proud." },
  { id: "flamebrand", slot: "weapon", name: "Flamebrand", level: 13, blurb: "Lights the room. And the drapes." },
  { id: "runeblade", slot: "weapon", name: "Runeblade", level: 17, blurb: "It hums when tasks are near." },
  { id: "dragonfang", slot: "weapon", name: "Dragonfang", level: 20, blurb: "Pulled from the source." },

  // ---- head --------------------------------------------------------------
  { id: "none", slot: "head", name: "Bare-headed", level: 1, blurb: "Wind in the hair." },
  { id: "bandana", slot: "head", name: "Bandana", level: 3, blurb: "Keeps sweat out of your eyes." },
  { id: "cap", slot: "head", name: "Leather Cap", level: 5, blurb: "Modest, practical." },
  { id: "helm", slot: "head", name: "Iron Helm", level: 8, blurb: "Dented in all the right places." },
  { id: "greathelm", slot: "head", name: "Great Helm", level: 12, blurb: "You see the world through a slit." },
  { id: "crown", slot: "head", name: "Winged Crown", level: 16, blurb: "People stand up when you enter." },
  { id: "dragoncrown", slot: "head", name: "Dragon Crown", level: 20, blurb: "Horns. Earned ones." },

  // ---- cape --------------------------------------------------------------
  { id: "none", slot: "cape", name: "No Cloak", level: 1, blurb: "Nothing to catch the wind." },
  { id: "tattered", slot: "cape", name: "Tattered Cloak", level: 4, blurb: "More hole than cloth." },
  { id: "traveler", slot: "cape", name: "Traveller's Cloak", level: 6, blurb: "Waxed wool. Sheds rain." },
  { id: "heraldic", slot: "cape", name: "Heraldic Cape", level: 10, blurb: "Your own colours at last." },
  { id: "mantle", slot: "cape", name: "Royal Mantle", level: 14, blurb: "Ermine-trimmed, absurdly heavy." },
  { id: "starcloak", slot: "cape", name: "Starcloak", level: 18, blurb: "It holds a small night sky." },

  // ---- offhand -----------------------------------------------------------
  { id: "none", slot: "offhand", name: "Empty Hand", level: 1, blurb: "Free to gesture." },
  { id: "buckler", slot: "offhand", name: "Wooden Buckler", level: 4, blurb: "Small, round, splintery." },
  { id: "kite", slot: "offhand", name: "Kite Shield", level: 7, blurb: "Covers you shoulder to shin." },
  { id: "tower", slot: "offhand", name: "Tower Shield", level: 12, blurb: "A wall you can carry." },
  { id: "lantern", slot: "offhand", name: "Warding Lantern", level: 15, blurb: "Burns without fuel." },
  { id: "aegis", slot: "offhand", name: "Phoenix Aegis", level: 19, blurb: "Reforges itself each dawn." },
];

export function itemsForSlot(slot: Slot): Item[] {
  return ITEMS.filter((i) => i.slot === slot);
}

export function findItem(slot: Slot, id: string): Item | undefined {
  return ITEMS.find((i) => i.slot === slot && i.id === id);
}

export function isUnlocked(item: Item, xp: number): boolean {
  return levelFor(xp) >= item.level;
}

/** Items that became available on this exact level — used by the level-up card. */
export function unlockedAtLevel(level: number): Item[] {
  return ITEMS.filter((i) => i.level === level);
}

/* ==========================================================================
   Appearance — always free, never level-gated.
   ========================================================================== */

export const SKINS: { id: string; label: string; hex: string; shade: string }[] = [
  { id: "porcelain", label: "Porcelain", hex: "#f8ddc8", shade: "#e6bd9e" },
  { id: "fair", label: "Fair", hex: "#f1c9a5", shade: "#d9a377" },
  { id: "olive", label: "Olive", hex: "#dcae82", shade: "#bd8a5c" },
  { id: "tan", label: "Tan", hex: "#c68a5f", shade: "#a36a43" },
  { id: "bronze", label: "Bronze", hex: "#a5673f", shade: "#834e2c" },
  { id: "deep", label: "Deep", hex: "#7a4a2b", shade: "#5c351d" },
  { id: "ebony", label: "Ebony", hex: "#563122", shade: "#3d2117" },
];

/** Each hair colour carries three tones so strands can be shaded, not flat. */
export const HAIR_COLORS: {
  id: string;
  label: string;
  hex: string;
  shade: string;
  light: string;
}[] = [
  { id: "raven",    label: "Raven",    hex: "#2b2430", shade: "#15111a", light: "#4d4257" },
  { id: "chestnut", label: "Chestnut", hex: "#6b4226", shade: "#402616", light: "#96603a" },
  { id: "auburn",   label: "Auburn",   hex: "#8f3b1f", shade: "#5c2210", light: "#bd5730" },
  { id: "ash",      label: "Ash",      hex: "#8a8378", shade: "#5e5951", light: "#b0a99e" },
  { id: "gold",     label: "Gold",     hex: "#d9a441", shade: "#a37422", light: "#f5d489" },
  { id: "silver",   label: "Silver",   hex: "#cfd4dc", shade: "#98a0ab", light: "#f2f5f9" },
  { id: "ember",    label: "Ember",    hex: "#c2410c", shade: "#8a2c08", light: "#ee7224" },
  { id: "moss",     label: "Moss",     hex: "#4d7c4a", shade: "#325233", light: "#72a46d" },
  { id: "violet",   label: "Violet",   hex: "#7c5cbf", shade: "#523a86", light: "#a689e0" },
];

export const HAIR_STYLES: { id: string; label: string }[] = [
  { id: "tousled", label: "Tousled" },
  { id: "long", label: "Long" },
  { id: "braided", label: "Braided" },
  { id: "ponytail", label: "Ponytail" },
  { id: "curly", label: "Curly" },
  { id: "buzz", label: "Buzzed" },
  { id: "topknot", label: "Topknot" },
  { id: "bald", label: "Bald" },
];

/**
 * Eye colour, not eye shape. LPC ships these eight as real sheets under
 * `eyes/human/adult`; the ids are the filenames, so this list is the art
 * rather than a description of it. `hex` is the iris colour lifted from each
 * sheet, which is what makes a swatch match what you get.
 *
 * The head sheet already has blue eyes painted on, so "blue" is the default
 * and is what an unrecognised value falls back to.
 */
export const EYE_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "blue",   label: "Blue",   hex: "#50d4ec" },
  { id: "brown",  label: "Brown",  hex: "#7e4e20" },
  { id: "gray",   label: "Grey",   hex: "#ada18f" },
  { id: "green",  label: "Green",  hex: "#84ec50" },
  { id: "orange", label: "Amber",  hex: "#ea9b71" },
  { id: "purple", label: "Violet", hex: "#eba0e0" },
  { id: "red",    label: "Crimson", hex: "#ff3d62" },
  { id: "yellow", label: "Gold",   hex: "#fedf47" },
];

export const DEFAULT_EYES = "blue";

/**
 * The two LPC body sheets. Labelled by silhouette rather than by identity,
 * because that is honestly all the art encodes — every other appearance and
 * gear option is shared between them.
 */
export const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: "male", label: "Masculine" },
  { id: "female", label: "Feminine" },
];

export const DEFAULT_BODY: BodyType = "male";

export const DEFAULT_APPEARANCE: Appearance = {
  body: DEFAULT_BODY,
  skin: "fair",
  hair: "tousled",
  hairColor: "chestnut",
  eyes: DEFAULT_EYES,
};

export const DEFAULT_EQUIPPED: Equipped = {
  torso: "rags",
  weapon: "stick",
  head: "none",
  cape: "none",
  offhand: "none",
};

/* ==========================================================================
   Category palette
   ========================================================================== */

/** Tuned for the light parchment theme: readable text, solid fills for chips. */
export const CATEGORY_COLORS: Record<
  string,
  { dot: string; soft: string; ring: string; text: string; solid: string; head: string }
> = {
  amber:   { dot: "bg-amber-500",   soft: "bg-amber-50",   ring: "ring-amber-300",   text: "text-amber-800",   solid: "bg-amber-500",   head: "bg-amber-100" },
  rose:    { dot: "bg-rose-500",    soft: "bg-rose-50",    ring: "ring-rose-300",    text: "text-rose-800",    solid: "bg-rose-500",    head: "bg-rose-100" },
  violet:  { dot: "bg-violet-500",  soft: "bg-violet-50",  ring: "ring-violet-300",  text: "text-violet-800",  solid: "bg-violet-500",  head: "bg-violet-100" },
  emerald: { dot: "bg-emerald-500", soft: "bg-emerald-50", ring: "ring-emerald-300", text: "text-emerald-800", solid: "bg-emerald-600", head: "bg-emerald-100" },
  sky:     { dot: "bg-sky-500",     soft: "bg-sky-50",     ring: "ring-sky-300",     text: "text-sky-800",     solid: "bg-sky-500",     head: "bg-sky-100" },
  fuchsia: { dot: "bg-fuchsia-500", soft: "bg-fuchsia-50", ring: "ring-fuchsia-300", text: "text-fuchsia-800", solid: "bg-fuchsia-500", head: "bg-fuchsia-100" },
  lime:    { dot: "bg-lime-500",    soft: "bg-lime-50",    ring: "ring-lime-400",    text: "text-lime-800",    solid: "bg-lime-600",    head: "bg-lime-100" },
  orange:  { dot: "bg-orange-500",  soft: "bg-orange-50",  ring: "ring-orange-300",  text: "text-orange-800",  solid: "bg-orange-500",  head: "bg-orange-100" },
};

export const COLOR_KEYS = Object.keys(CATEGORY_COLORS);

export function colorOf(key: string) {
  return CATEGORY_COLORS[key] ?? CATEGORY_COLORS.amber;
}

