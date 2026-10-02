import { doorOf, FURNITURE, ROOM, type Interior } from "@/lib/furniture";
import type { Tier } from "@/lib/village";
import type { Grid, Table } from "@/components/village/world";

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
 * desks (work sessions can sit there as well as at the town hall); the store
 * and the bakery a counter to buy things at.
 */
export type IndoorScene = Grid & {
  kind: Indoor;
  /** The door, in the middle of the front wall; stepping onto it leaves. */
  door: { x: number; y: number };
  /** The library's desks, each with its seats (the town hall's tables, indoors). */
  desks: Table[];
  /** The store's or the bakery's counter: stand in front of it to buy. */
  counter: { x: number; y: number; w: number } | null;
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
  return { kind: "library", w, h, blocked, door, desks, counter: null };
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
  const door = { x: 6, y: h - 1 };
  blocked[door.y][door.x] = false;
  return { kind: "store", w, h, blocked, door, desks: [], counter };
}

export function buildBakery(): IndoorScene {
  const w = 13;
  const h = 9;
  const blocked = walled(w, h);
  // The display case on the left, a café table on the right, flour sacks in
  // the back corner; the ovens are in the back wall.
  const counter = { x: 2, y: 3, w: 5 };
  for (let i = 0; i < counter.w; i++) blocked[counter.y][counter.x + i] = true;
  blocked[2][w - 2] = true;
  blocked[3][w - 2] = true;
  blocked[5][9] = true;
  const door = { x: 6, y: h - 1 };
  blocked[door.y][door.x] = false;
  return { kind: "bakery", w, h, blocked, door, desks: [], counter };
}

export const buildIndoor = (what: Indoor): IndoorScene =>
  what === "library" ? buildLibrary() : what === "store" ? buildStore() : buildBakery();
