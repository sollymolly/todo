import { doorOf, FURNITURE, ROOM, type Interior } from "@/lib/furniture";
import type { Tier } from "@/lib/village";
import type { Grid } from "@/components/village/world";

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
  const w = 18;
  const h = 13;
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
    spots: { a: { x: 6, y: 6 }, b: { x: 11, y: 6 } },
    ring: { cx: 9, cy: 6.5, r: 4 },
  };
}
