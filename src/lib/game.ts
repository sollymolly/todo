import type { Appearance, BodyType, DyeSlot, Equipped, Slot } from "./types";

/* ==========================================================================
   XP economy — these mirror the SQL functions in db/schema.sql.
   If you change a number here, change it there too (SQL is the source of
   truth; these values only drive the previews shown in the UI).
   ========================================================================== */

/**
 * How long a finished quest is kept before it is deleted. Only the counts
 * survive; the title, notes and deadline do not. Mirrored as the default in
 * prune_finished() — change both.
 */
export const FINISHED_RETENTION_DAYS = 7;

/**
 * How many steps one quest may hold. Enough for a real checklist, and low
 * enough that a quest can't be used as unbounded storage. Mirrored in
 * add_subtask() — change both.
 *
 * It lives here rather than in subtask-actions.ts because that module is
 * `"use server"`, and such a module may only export async functions.
 */
export const MAX_STEPS = 20;

export const XP = {
  noDeadline: 5,
  onTime: 10,
  late: 3,
  penalty: -10,
  /**
   * Calling a quest off yourself. Cheaper than letting the deadline pass in
   * silence, which is the point: saying so is worth something. Mirrored in
   * quest_abandon_penalty() — change both.
   */
  abandon: -5,
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

/**
 * The curve is set in quests, not in XP: two on-time quests to reach level 2,
 * three more for level 3, and so on. The numbers below are those counts priced
 * at XP.onTime, which is why they moved when the awards did — the pace of the
 * game is unchanged, only the units it is counted in.
 *
 * Mirrored in the `ranks` table (migration 017) — change both.
 */
export const RANKS: Rank[] = [
  { level: 1, title: "Ragged Peasant", xp: 0 },
  { level: 2, title: "Wanderer", xp: 20 },
  { level: 3, title: "Squire", xp: 50 },
  { level: 4, title: "Footman", xp: 100 },
  { level: 5, title: "Man-at-Arms", xp: 170 },
  { level: 6, title: "Sellsword", xp: 260 },
  { level: 7, title: "Knight", xp: 380 },
  { level: 8, title: "Knight-Errant", xp: 530 },
  { level: 9, title: "Champion", xp: 720 },
  { level: 10, title: "Crusader", xp: 950 },
  { level: 11, title: "Paladin", xp: 1220 },
  { level: 12, title: "Warlord", xp: 1540 },
  { level: 13, title: "Vanguard", xp: 1910 },
  { level: 14, title: "Highlord", xp: 2340 },
  { level: 15, title: "Dragonslayer", xp: 2830 },
  { level: 16, title: "Archon", xp: 3380 },
  { level: 17, title: "Grandmaster", xp: 4000 },
  { level: 18, title: "Warden of Dawn", xp: 4690 },
  { level: 19, title: "Immortal", xp: 5460 },
  { level: 20, title: "Living Legend", xp: 6310 },
];

/** Flat cost per level past the named ranks — 100 on-time quests each. */
export const XP_PER_LEGEND_LEVEL = 1000;

/** XP required to reach a level, extending past the named ranks. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const named = RANKS[level - 1];
  if (named) return named.xp;
  const last = RANKS[RANKS.length - 1];
  return last.xp + (level - last.level) * XP_PER_LEGEND_LEVEL;
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
  /**
   * Which palette family this item's art may be recoloured within, and the dye
   * it wears when its owner hasn't chosen one. Absent means the item cannot be
   * dyed — an empty slot, or a sheet painted in several ramps at once.
   *
   * The family is not a style choice: it is which ramp the shipped pixels are
   * actually drawn in, detected per sheet by scripts/fetch-lpc.py and recorded
   * in the manifest. Steel plate is therefore offered metal finishes and a
   * linen tunic cloth colours, because that is what a palette swap of each can
   * honestly produce.
   */
  dye?: { kind: DyeKind; default?: string };
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
  { id: "rags", slot: "torso", name: "Rags", level: 1, blurb: "Barely cloth. Everyone starts here.", dye: { kind: "cloth", default: "brown" } },
  { id: "tunic", slot: "torso", name: "Linen Tunic", level: 2, blurb: "Clean, if unremarkable.", dye: { kind: "cloth", default: "white" } },
  { id: "jerkin", slot: "torso", name: "Leather Jerkin", level: 4, blurb: "Boiled hide. Stops a knife, mostly.", dye: { kind: "cloth", default: "leather" } },
  { id: "scale", slot: "torso", name: "Scale Mail", level: 6, blurb: "Overlapping plates, jingles when you walk.", dye: { kind: "metal", default: "steel" } },
  { id: "chain", slot: "torso", name: "Chainmail", level: 8, blurb: "Ten thousand rings, hand-riveted.", dye: { kind: "metal", default: "steel" } },
  { id: "plate", slot: "torso", name: "Knight's Plate", level: 11, blurb: "You clank now. It suits you.", dye: { kind: "metal", default: "steel" } },
  { id: "gilded", slot: "torso", name: "Gilded Plate", level: 15, blurb: "Gold-chased steel, fit for a court.", dye: { kind: "metal", default: "gold" } },
  { id: "dragonscale", slot: "torso", name: "Dragonscale", level: 19, blurb: "Still warm.", dye: { kind: "metal", default: "copper" } },

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
  { id: "bandana", slot: "head", name: "Bandana", level: 3, blurb: "Keeps sweat out of your eyes.", dye: { kind: "cloth", default: "red" } },
  { id: "cap", slot: "head", name: "Leather Cap", level: 5, blurb: "Modest, practical.", dye: { kind: "cloth", default: "brown" } },
  { id: "helm", slot: "head", name: "Iron Helm", level: 8, blurb: "Dented in all the right places.", dye: { kind: "metal", default: "steel" } },
  { id: "greathelm", slot: "head", name: "Great Helm", level: 12, blurb: "You see the world through a slit.", dye: { kind: "metal", default: "steel" } },
  { id: "crown", slot: "head", name: "Winged Crown", level: 16, blurb: "People stand up when you enter.", dye: { kind: "metal", default: "gold" } },
  { id: "dragoncrown", slot: "head", name: "Dragon Crown", level: 20, blurb: "Horns. Earned ones.", dye: { kind: "metal", default: "bronze" } },

  // ---- cape --------------------------------------------------------------
  { id: "none", slot: "cape", name: "No Cloak", level: 1, blurb: "Nothing to catch the wind." },
  { id: "tattered", slot: "cape", name: "Tattered Cloak", level: 4, blurb: "More hole than cloth.", dye: { kind: "cloth", default: "gray" } },
  { id: "traveler", slot: "cape", name: "Traveller's Cloak", level: 6, blurb: "Waxed wool. Sheds rain.", dye: { kind: "cloth", default: "brown" } },
  { id: "heraldic", slot: "cape", name: "Heraldic Cape", level: 10, blurb: "Your own colours at last.", dye: { kind: "cloth", default: "red" } },
  { id: "mantle", slot: "cape", name: "Royal Mantle", level: 14, blurb: "Ermine-trimmed, absurdly heavy.", dye: { kind: "cloth", default: "maroon" } },
  { id: "starcloak", slot: "cape", name: "Starcloak", level: 18, blurb: "It holds a small night sky.", dye: { kind: "cloth", default: "navy" } },

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
   Dyes — free, never level-gated. Earning the armour is the achievement;
   choosing its colour is not.
   ========================================================================== */

/**
 * The two palette families gear is painted in. LPC ships a ramp per colour,
 * six stops dark-to-light, and recolouring means remapping those six exactly —
 * so a dyed sprite keeps its shading instead of being tinted flat.
 *
 * Cloth and metal are kept apart because the ramps are built differently:
 * metal ones carry a specular near-white that fabric ramps don't. Dyeing plate
 * with a cloth ramp technically works and looks like painted tin.
 */
export type DyeKind = "cloth" | "metal";

export type Dye = { id: string; label: string; hex: string };

/**
 * Ids are LPC ramp names — they index straight into the manifest palettes, so
 * a swatch cannot drift from the colour it produces. `hex` is the ramp's
 * second-lightest stop, which is the colour that dominates a lit surface;
 * taking it from the art rather than picking it by eye is what keeps the
 * swatch honest.
 *
 * Labels are ours. LPC's names describe pigments, not what a player sees, and
 * the wardrobe already reads as a fantasy shop.
 */
export const DYES: Record<DyeKind, Dye[]> = {
  cloth: [
    { id: "brown",    label: "Umber",    hex: "#744B30" },
    { id: "leather",  label: "Leather",  hex: "#75502D" },
    { id: "tan",      label: "Sand",     hex: "#B7996A" },
    { id: "yellow",   label: "Ochre",    hex: "#F3C03F" },
    { id: "orange",   label: "Rust",     hex: "#EF7E19" },
    { id: "red",      label: "Crimson",  hex: "#AB1E1E" },
    { id: "maroon",   label: "Wine",     hex: "#832121" },
    { id: "pink",     label: "Rose",     hex: "#C36072" },
    { id: "lavender", label: "Lilac",    hex: "#A966DD" },
    { id: "purple",   label: "Royal",    hex: "#621E78" },
    { id: "navy",     label: "Midnight", hex: "#3C49AD" },
    { id: "blue",     label: "Azure",    hex: "#466AC9" },
    { id: "teal",     label: "Teal",     hex: "#0098B2" },
    { id: "forest",   label: "Forest",   hex: "#134507" },
    { id: "green",    label: "Moss",     hex: "#2F8136" },
    { id: "white",    label: "Bone",     hex: "#E5E6C7" },
    { id: "gray",     label: "Ash",      hex: "#797580" },
    { id: "charcoal", label: "Charcoal", hex: "#4A5057" },
  ],
  metal: [
    { id: "iron",    label: "Iron",   hex: "#484152" },
    { id: "steel",   label: "Steel",  hex: "#C4B59F" },
    { id: "silver",  label: "Silver", hex: "#D6E1D3" },
    { id: "gold",    label: "Gold",   hex: "#FFC95A" },
    { id: "brass",   label: "Brass",  hex: "#FDD082" },
    { id: "bronze",  label: "Bronze", hex: "#E7A820" },
    { id: "copper",  label: "Copper", hex: "#EC855C" },
    { id: "ceramic", label: "Clay",   hex: "#BA9069" },
  ],
};

/** Armour, headgear and cloaks. Ordered as the Armoury shows them. */
export const DYE_SLOTS: DyeSlot[] = ["torso", "head", "cape"];

export function isDyeSlot(slot: Slot): slot is DyeSlot {
  return (DYE_SLOTS as Slot[]).includes(slot);
}

/** The swatches an item offers; empty when its art can't be recoloured. */
export function dyesFor(item: Item | undefined): Dye[] {
  return item?.dye ? DYES[item.dye.kind] : [];
}

/**
 * The dye an item is actually drawn in: the owner's pick if that item can wear
 * it, else the item's own default, else null for "as the art ships".
 *
 * A pick from the wrong family is not an error — it is what a slot holds after
 * you dye a tunic crimson and then put plate on over it. The stored pick is
 * kept rather than overwritten, so taking the plate off again brings the
 * crimson tunic back.
 */
export function resolveDye(item: Item | undefined, chosen?: string | null): string | null {
  if (!item?.dye) return null;
  if (chosen && DYES[item.dye.kind].some((d) => d.id === chosen)) return chosen;
  return item.dye.default ?? null;
}

/** As resolveDye, for a slot of a whole loadout. */
export function dyeForSlot(equipped: Equipped, slot: DyeSlot): string | null {
  return resolveDye(findItem(slot, equipped[slot]), equipped.dyes?.[slot]);
}

/* ==========================================================================
   Appearance — always free, never level-gated.
   ========================================================================== */

/**
 * Six tones, each mapped to a *different* LPC body ramp — see SKIN_RAMP in
 * CharacterSprite. There used to be seven, but "Porcelain" and "Fair" both
 * resolved to the `light` ramp and so rendered identically: two swatches, one
 * face. Porcelain is gone and its profiles moved to Fair, which is a no-op on
 * screen because that is what they were already drawing.
 *
 * `hex` and `shade` are lifted from the ramps themselves rather than picked by
 * eye, so a swatch is the colour you actually get.
 */
export const SKINS: { id: string; label: string; hex: string; shade: string }[] = [
  { id: "fair", label: "Fair", hex: "#e4a47c", shade: "#cc8665" },
  { id: "tan", label: "Tan", hex: "#ea9f54", shade: "#d28144" },
  { id: "olive", label: "Olive", hex: "#ae6b3f", shade: "#7f4c31" },
  { id: "bronze", label: "Bronze", hex: "#936849", shade: "#785946" },
  { id: "deep", label: "Deep", hex: "#76513a", shade: "#5f4539" },
  { id: "ebony", label: "Ebony", hex: "#442725", shade: "#2e1f1c" },
];

/**
 * Each hair colour carries three tones so strands can be shaded, not flat, and
 * all three are lifted straight from the LPC ramp the sprite is recoloured to
 * (indices 3/2/4) — so the swatch is the hair you actually get.
 *
 * Four of these used to point at ramps that didn't match their names: "Silver"
 * resolved to LPC's `platinum`, which is a tan blonde, and "Ash" to its `ash`,
 * which is rosy brown — hence a grey that looked blonde. "Ember" was `ginger`
 * (orange) and "Violet" was `violet`, which is very nearly blue. See
 * HAIR_RAMP in CharacterSprite for the corrected mapping.
 */
export const HAIR_COLORS: {
  id: string;
  label: string;
  hex: string;
  shade: string;
  light: string;
}[] = [
  { id: "raven",    label: "Raven",    hex: "#071f2a", shade: "#061421", light: "#0d384d" },
  { id: "chestnut", label: "Chestnut", hex: "#81310a", shade: "#63200b", light: "#b6550e" },
  { id: "auburn",   label: "Auburn",   hex: "#9e1f1f", shade: "#73171e", light: "#c7341b" },
  { id: "ash",      label: "Ash",      hex: "#777777", shade: "#4b4b4b", light: "#aaaaaa" },
  { id: "gold",     label: "Gold",     hex: "#ffa913", shade: "#e47100", light: "#ffe453" },
  { id: "silver",   label: "Silver",   hex: "#b8bbbc", shade: "#8b9498", light: "#d8dcdc" },
  { id: "ember",    label: "Ember",    hex: "#cb0000", shade: "#a40712", light: "#e21414" },
  { id: "moss",     label: "Moss",     hex: "#005000", shade: "#002d00", light: "#007c00" },
  { id: "violet",   label: "Violet",   hex: "#7141b2", shade: "#402e82", light: "#a966dd" },
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
  dyes: {},
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

