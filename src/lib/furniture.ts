import type { Tier } from "@/lib/village";

/* --------------------------------------------------------------------------
   Inside a house: how big the room is, what it can hold, and
   the rules a layout must follow. Shared by the decorating screen and the
   server, which re-checks everything before saving.

   Coordinates are floor tiles: (0,0) is the back-left corner of the floor,
   against the back wall. Wall hangings sit on the back wall above floor
   column x. The door is in the middle of the front wall, and the two tiles
   in front of it are kept clear so you can always get in and out.
   -------------------------------------------------------------------------- */

export type FurnitureKind =
  | "bed" | "table" | "chair" | "stool" | "plant" | "rug" | "lamp" | "chest"
  | "bookshelf" | "desk" | "sofa" | "armorstand" | "fireplace" | "trophy" | "throne"
  | "painting" | "window" | "clock" | "mirror" | "banner"
  | "piano" | "aquarium" | "telescope" | "stainedglass";

export type Layer = "floor" | "rug" | "wall";

/** `shop`: sold at the village store as "furniture:<kind>" (src/lib/shop.ts), not unlocked by level. */
export const FURNITURE: Record<FurnitureKind, { label: string; w: number; h: number; layer: Layer; level: number; shop?: boolean }> = {
  bed: { label: "Bed", w: 2, h: 2, layer: "floor", level: 1 },
  table: { label: "Table", w: 2, h: 1, layer: "floor", level: 1 },
  chair: { label: "Chair", w: 1, h: 1, layer: "floor", level: 1 },
  stool: { label: "Stool", w: 1, h: 1, layer: "floor", level: 1 },
  plant: { label: "Potted plant", w: 1, h: 1, layer: "floor", level: 1 },
  rug: { label: "Rug", w: 3, h: 2, layer: "rug", level: 1 },
  lamp: { label: "Lamp", w: 1, h: 1, layer: "floor", level: 2 },
  chest: { label: "Chest", w: 1, h: 1, layer: "floor", level: 2 },
  bookshelf: { label: "Bookshelf", w: 2, h: 1, layer: "floor", level: 3 },
  desk: { label: "Desk", w: 2, h: 1, layer: "floor", level: 3 },
  sofa: { label: "Sofa", w: 2, h: 1, layer: "floor", level: 4 },
  armorstand: { label: "Armour stand", w: 1, h: 1, layer: "floor", level: 5 },
  fireplace: { label: "Fireplace", w: 2, h: 1, layer: "floor", level: 6 },
  trophy: { label: "Trophy", w: 1, h: 1, layer: "floor", level: 9 },
  throne: { label: "Throne", w: 2, h: 1, layer: "floor", level: 15 },
  painting: { label: "Painting", w: 1, h: 1, layer: "wall", level: 1 },
  window: { label: "Window", w: 1, h: 1, layer: "wall", level: 1 },
  clock: { label: "Clock", w: 1, h: 1, layer: "wall", level: 3 },
  mirror: { label: "Mirror", w: 1, h: 1, layer: "wall", level: 5 },
  banner: { label: "Banner", w: 1, h: 1, layer: "wall", level: 8 },
  piano: { label: "Piano", w: 2, h: 1, layer: "floor", level: 1, shop: true },
  aquarium: { label: "Aquarium", w: 2, h: 1, layer: "floor", level: 1, shop: true },
  telescope: { label: "Telescope", w: 1, h: 1, layer: "floor", level: 1, shop: true },
  stainedglass: { label: "Stained glass", w: 1, h: 1, layer: "wall", level: 1, shop: true },
};

export const KIND_LIST = Object.keys(FURNITURE) as FurnitureKind[];

/**
 * Wallpapers and floors. `shop`: sold at the village store (src/lib/shop.ts),
 * the rest by level. A floor that's `tiles` is laid in squares, not boards.
 */
export const WALLS: { id: string; label: string; fill: string; line: string; level: number; shop?: boolean }[] = [
  { id: "cream", label: "Cream", fill: "#f1e6cc", line: "#e2d3b0", level: 1 },
  { id: "sage", label: "Sage", fill: "#cfdcbc", line: "#b9caa3", level: 1 },
  { id: "rose", label: "Rose", fill: "#ecd0c8", line: "#dcb9ae", level: 1 },
  { id: "sky", label: "Sky", fill: "#cfe0ea", line: "#b6cedb", level: 2 },
  { id: "stripes", label: "Stripes", fill: "#efe2c2", line: "#c9a877", level: 3 },
  { id: "panel", label: "Wood panel", fill: "#b98d5e", line: "#936b43", level: 4 },
  { id: "brick", label: "Brick", fill: "#b3643f", line: "#8c4a2e", level: 6 },
  { id: "stone", label: "Stone", fill: "#aaa49a", line: "#857f76", level: 8 },
  { id: "starry", label: "Starry night", fill: "#2c3a66", line: "#f2d27a", level: 1, shop: true },
  { id: "ivy", label: "Ivy trellis", fill: "#e4e9cf", line: "#5f8a3a", level: 1, shop: true },
  { id: "damask", label: "Rose damask", fill: "#7a2a3a", line: "#d99aa6", level: 1, shop: true },
  { id: "gilded", label: "Gilded panels", fill: "#3a2a1c", line: "#d9a92e", level: 1, shop: true },
];

export const FLOORS: { id: string; label: string; a: string; b: string; level: number; shop?: boolean; tiles?: boolean }[] = [
  { id: "oak", label: "Oak", a: "#d4a66c", b: "#c49359", level: 1 },
  { id: "walnut", label: "Walnut", a: "#8f6240", b: "#7d5436", level: 1 },
  { id: "checker", label: "Checker", a: "#efe6d4", b: "#6e6258", level: 2, tiles: true },
  { id: "carpet", label: "Red carpet", a: "#a8453b", b: "#9a3d34", level: 3 },
  { id: "moss", label: "Moss carpet", a: "#6f8f4a", b: "#65843f", level: 3 },
  { id: "stone", label: "Flagstone", a: "#b9b2a6", b: "#a39c90", level: 5 },
  { id: "marble", label: "Marble", a: "#f2efe9", b: "#d9d3c8", level: 1, shop: true },
  { id: "cherry", label: "Cherry wood", a: "#a8503a", b: "#8c3f2c", level: 1, shop: true },
  { id: "bluetile", label: "Blue tile", a: "#eef3f8", b: "#3a6aa8", level: 1, shop: true, tiles: true },
  { id: "straw", label: "Woven straw", a: "#e3c27a", b: "#c9a55a", level: 1, shop: true },
];

export type Placed = { k: FurnitureKind; x: number; y: number };
export type Interior = { wall: string; floor: string; items: Placed[] };

export const MAX_ITEMS = 40;

/** Floor size, in tiles, by the size of the house. */
export const ROOM: Record<Tier, { cols: number; rows: number }> = {
  tent: { cols: 6, rows: 4 },
  hut: { cols: 7, rows: 5 },
  cottage: { cols: 9, rows: 6 },
  house: { cols: 11, rows: 7 },
  manor: { cols: 13, rows: 8 },
  keep: { cols: 15, rows: 9 },
};

/** The door's column, and the tiles in front of it that must stay clear. */
export function doorOf(tier: Tier) {
  const { cols, rows } = ROOM[tier];
  const x = Math.floor(cols / 2);
  return { x, clear: [{ x, y: rows - 1 }, { x, y: rows - 2 }] };
}

/** A furnished room for a house that hasn't been decorated yet. */
export function defaultInterior(tier: Tier): Interior {
  const { cols, rows } = ROOM[tier];
  const items: Placed[] = [
    { k: "window", x: 1, y: 0 },
    { k: "painting", x: cols - 2, y: 0 },
    { k: "bed", x: 0, y: 0 },
    { k: "plant", x: cols - 1, y: 0 },
  ];
  if (cols >= 7) {
    items.push({ k: "rug", x: Math.floor(cols / 2) - 1, y: Math.max(1, Math.floor(rows / 2) - 1) });
    items.push({ k: "table", x: cols - 3, y: rows - 2 }, { k: "chair", x: cols - 4, y: rows - 2 });
  } else {
    items.push({ k: "stool", x: cols - 1, y: rows - 1 });
  }
  if (cols >= 9) items.push({ k: "chest", x: 0, y: rows - 1 }, { k: "window", x: cols - 4, y: 0 });
  if (cols >= 11) items.push({ k: "bookshelf", x: 3, y: 0 }, { k: "lamp", x: 2, y: 0 });
  return { wall: "cream", floor: "oak", items: cleanItems(items, tier, 99) };
}

/**
 * A layout made safe to keep: known pieces the owner has unlocked, inside
 * the room, not stacked on each other (a rug can go under things), and
 * never in front of the door. Anything that breaks a rule is dropped.
 */
/**
 * A room's layout made safe. `owned` (what they've bought, src/lib/shop.ts)
 * is checked when saving; a room already saved is shown as it is.
 */
export function cleanInterior(raw: unknown, tier: Tier, level: number, owned?: Set<string>): Interior {
  const r = (raw ?? {}) as Partial<Interior>;
  const has = (item: string) => !owned || owned.has(item);
  const wall = WALLS.find((w) => w.id === r.wall && level >= w.level && (!w.shop || has(`wall:${w.id}`)))?.id ?? "cream";
  const floor = FLOORS.find((f) => f.id === r.floor && level >= f.level && (!f.shop || has(`floor:${f.id}`)))?.id ?? "oak";
  return { wall, floor, items: cleanItems(Array.isArray(r.items) ? r.items : [], tier, level, has) };
}

function cleanItems(raw: unknown[], tier: Tier, level: number, has: (item: string) => boolean = () => true): Placed[] {
  const { cols, rows } = ROOM[tier];
  const door = doorOf(tier);
  const taken = new Set<string>(door.clear.map((c) => `f:${c.x},${c.y}`));
  const rugs = new Set<string>();
  const out: Placed[] = [];
  for (const it of raw.slice(0, MAX_ITEMS * 2)) {
    const p = it as Partial<Placed>;
    const spec = p.k && FURNITURE[p.k as FurnitureKind];
    if (!spec || level < spec.level || (spec.shop && !has(`furniture:${p.k}`))) continue;
    const x = Math.round(Number(p.x));
    const y = Math.round(Number(p.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (spec.layer === "wall") {
      if (y !== 0 || x < 0 || x >= cols || taken.has(`w:${x}`)) continue;
      taken.add(`w:${x}`);
      out.push({ k: p.k as FurnitureKind, x, y: 0 });
    } else {
      if (x < 0 || y < 0 || x + spec.w > cols || y + spec.h > rows) continue;
      const cells: string[] = [];
      for (let dy = 0; dy < spec.h; dy++) for (let dx = 0; dx < spec.w; dx++) cells.push(`${x + dx},${y + dy}`);
      const set = spec.layer === "rug" ? rugs : taken;
      const blockedByDoor = spec.layer !== "rug" && cells.some((c) => taken.has(`f:${c}`));
      if (blockedByDoor || cells.some((c) => set.has(spec.layer === "rug" ? c : `f:${c}`))) continue;
      for (const c of cells) set.add(spec.layer === "rug" ? c : `f:${c}`);
      out.push({ k: p.k as FurnitureKind, x, y });
    }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}
