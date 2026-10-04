import { doorOf, FURNITURE, ROOM, type Interior } from "@/lib/furniture";
import type { Tier } from "@/lib/village";
import { walkable, type Grid, type Table } from "@/components/village/world";

/* --------------------------------------------------------------------------
   The two kinds of shared room: inside a house, and the
   arena. Unlike the village outside, each is laid out the same for everyone
   in it, so positions mean the same thing on every screen.

   A room's grid, in tiles:

       row 0–1     back wall (wallpaper, wall hangings)
       rows 2…     the floor, `cols` wide, between two side walls
       last row    front wall, with the door in the middle

   Floor tile (fx, fy) is grid tile (fx + 1, fy + 2).
   -------------------------------------------------------------------------- */

export type RoomScene = Grid & {
  kind: "room";
  tier: Tier;
  cols: number;
  rows: number;
  interior: Interior;
  /** The door, in grid tiles; stepping onto it leaves. */
  door: { x: number; y: number };
};

export type ArenaScene = Grid & {
  kind: "arena";
  gate: { x: number; y: number };
  /** Where the challenger (a) and the challenged (b) stand to fight. */
  spots: { a: { x: number; y: number }; b: { x: number; y: number } };
  ring: { cx: number; cy: number; r: number };
};

export function buildRoom(tier: Tier, interior: Interior): RoomScene {
  const { cols, rows } = ROOM[tier];
  const w = cols + 2;
  const h = rows + 3;
  const blocked = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => y < 2 || y === h - 1 || x === 0 || x === w - 1)
  );
  for (const it of interior.items) {
    const spec = FURNITURE[it.k];
    if (spec.layer !== "floor") continue;
    for (let dy = 0; dy < spec.h; dy++)
      for (let dx = 0; dx < spec.w; dx++) {
        const gy = it.y + dy + 2;
        const gx = it.x + dx + 1;
        if (blocked[gy]) blocked[gy][gx] = true;
      }
  }
  const door = { x: doorOf(tier).x + 1, y: h - 1 };
  blocked[door.y][door.x] = false;
  return { kind: "room", w, h, blocked, tier, cols, rows, interior, door };
}

/**
 * Where I wake up, as a grid tile: beside my bed (at its foot first), or just
 * inside the door if there's no bed, or nowhere beside it to stand.
 */
export function wakeSpot(room: RoomScene): { x: number; y: number } {
  const bed = room.interior.items.find((it) => it.k === "bed");
  if (bed) {
    // The bed's top-left in grid tiles, and the ring of floor round it, foot first.
    const gx = bed.x + 1;
    const gy = bed.y + 2;
    const { w, h } = FURNITURE.bed;
    const beside = [
      ...Array.from({ length: w }, (_, i) => ({ x: gx + i, y: gy + h })),
      ...Array.from({ length: h }, (_, i) => ({ x: gx + w, y: gy + h - 1 - i })),
      ...Array.from({ length: h }, (_, i) => ({ x: gx - 1, y: gy + h - 1 - i })),
    ];
    const spot = beside.find((t) => walkable(room, t.x, t.y));
    if (spot) return spot;
  }
  return { x: room.door.x, y: room.door.y - 1 };
}

/**
 * The piece the notebook sits on: my first desk, or failing that my first
 * table. In grid tiles, with its index among the room's items.
 */
export function journalSpot(interior: Interior): { index: number; x: number; y: number; w: number; kind: "desk" | "table" } | null {
  for (const kind of ["desk", "table"] as const) {
    const index = interior.items.findIndex((it) => it.k === kind);
    if (index >= 0) {
      const it = interior.items[index];
      return { index, x: it.x + 1, y: it.y + 2, w: FURNITURE[kind].w, kind };
    }
  }
  return null;
}

/** Am I close enough to write in the notebook? `tx`, `ty`: my place in grid tiles (feet, so a row's tile is its top + 0.75). */
export function nearJournal(spot: { x: number; y: number; w: number }, tx: number, ty: number): boolean {
  return tx >= spot.x - 1 && tx <= spot.x + spot.w + 1 && ty >= spot.y + 0.5 && ty < spot.y + 2.6;
}

export function buildArena(): ArenaScene {
  // Odd width and the ring on the middle column, so the gate, the ring and
  // the two marks all sit on the arena's centre line; the ring's middle is
  // the middle of the dirt both ways, and the marks stand level with it.
  const w = 19;
  const h = 14;
  // Fence all round; the stands along the back are for looking, not walking.
  const blocked = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => y < 2 || y === h - 1 || x === 0 || x === w - 1)
  );
  const gate = { x: 9, y: h - 1 };
  blocked[gate.y][gate.x] = false;
  return {
    kind: "arena",
    w,
    h,
    blocked,
    gate,
    spots: { a: { x: 6, y: 7 }, b: { x: 12, y: 7 } },
    ring: { cx: 9, cy: 7, r: 4 },
  };
}

/** The buildings on a village's road you can walk into (world.ts, BUILDINGS). */
export type Indoor = "library" | "store" | "bakery";

/**
 * A village's library, store or bakery: a room of its own that everyone in
 * that village who walks in shares, like the arena. The library has study
 * desks and the bakery café tables (work sessions can sit at either as well
 * as at the town hall); the store and the bakery a counter to buy things at.
 */
export type IndoorScene = Grid & {
  kind: Indoor;
  /** The door, in the middle of the front wall; stepping onto it leaves. */
  door: { x: number; y: number };
  /** The library's desks or the bakery's tables, each with its seats (the town hall's tables, indoors). */
  desks: Table[];
  /** The store's or the bakery's counter: stand in front of it to buy. */
  counter: { x: number; y: number; w: number } | null;
  /**
   * Things for sale set out in the room, each a "furniture:<kind>" good
   * (src/lib/shop.ts) standing on its tiles. Walk up to one to look at it at
   * the counter. `wall`: hung on the back wall above x instead.
   */
  displays: { x: number; y: number; w: number; good: string; wall?: boolean }[];
};

function walled(w: number, h: number): boolean[][] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => y < 2 || y === h - 1 || x === 0 || x === w - 1));
}

export function buildLibrary(): IndoorScene {
  const w = 15;
  const h = 11;
  const blocked = walled(w, h);
  const desks: Table[] = [];
  for (const [x, y] of [
    [2, 4],
    [10, 4],
    [2, 7],
    [10, 7],
  ]) {
    for (let i = 0; i < 3; i++) blocked[y][x + i] = true;
    desks.push({
      x,
      y,
      w: 3,
      seats: [
        { x, y: y + 1, face: 0 },
        { x: x + 1, y: y + 1, face: 0 },
        { x: x + 2, y: y + 1, face: 0 },
        { x: x - 1, y, face: 3 },
        { x: x + 3, y, face: 1 },
      ],
    });
  }
  const door = { x: 7, y: h - 1 };
  blocked[door.y][door.x] = false;
  return { kind: "library", w, h, blocked, door, desks, counter: null, displays: [] };
}

export function buildStore(): IndoorScene {
  const w = 13;
  const h = 9;
  const blocked = walled(w, h);
  // Shelves down both sides, the counter across the back.
  for (let y = 2; y < h - 2; y++) {
    blocked[y][1] = true;
    blocked[y][w - 2] = true;
  }
  const counter = { x: 4, y: 3, w: 5 };
  for (let i = 0; i < counter.w; i++) blocked[counter.y][counter.x + i] = true;
  // The furniture for sale, out on the floor either side of the way in, and
  // the stained glass on the back wall over the counter.
  const displays = [
    { x: 2, y: 5, w: 2, good: "furniture:piano" },
    { x: 9, y: 5, w: 2, good: "furniture:aquarium" },
    { x: 3, y: 7, w: 1, good: "furniture:telescope" },
    { x: 6, y: 0, w: 1, good: "furniture:stainedglass", wall: true },
  ];
  for (const d of displays) if (!d.wall) for (let i = 0; i < d.w; i++) blocked[d.y][d.x + i] = true;
  const door = { x: 6, y: h - 1 };
  blocked[door.y][door.x] = false;
  return { kind: "store", w, h, blocked, door, desks: [], counter, displays };
}

export function buildBakery(): IndoorScene {
  const w = 13;
  const h = 9;
  const blocked = walled(w, h);
  // The display case on the left, two café tables on the right to work at,
  // flour sacks in the front corner; the oven is in the back wall.
  const counter = { x: 2, y: 3, w: 5 };
  for (let i = 0; i < counter.w; i++) blocked[counter.y][counter.x + i] = true;
  const desks: Table[] = [3, 6].map((y) => {
    const x = 9;
    blocked[y][x] = blocked[y][x + 1] = true;
    return {
      x,
      y,
      w: 2,
      seats: [
        { x, y: y + 1, face: 0 },
        { x: x + 1, y: y + 1, face: 0 },
        { x: x - 1, y, face: 3 },
        { x: x + 2, y, face: 1 },
      ],
    };
  });
  blocked[6][1] = blocked[7][1] = true;
  const door = { x: 6, y: h - 1 };
  blocked[door.y][door.x] = false;
  return { kind: "bakery", w, h, blocked, door, desks, counter, displays: [] };
}

export const buildIndoor = (what: Indoor): IndoorScene =>
  what === "library" ? buildLibrary() : what === "store" ? buildStore() : buildBakery();
