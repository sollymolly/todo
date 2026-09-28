/* --------------------------------------------------------------------------
   The village's layout, worked out afresh on each device from who's in it.

   All measurements are in tiles (32px, the LPC atlas's size) unless a name
   says px. The shape:

     forest margin
     ┌──── band 0 ──────────────────────────────────────────────┐
     │ house house house │   TOWN HALL   │ house house house   │
     │ garden …          │    plaza      │ garden …            │
     │ ═══════════════════ street ═══════════════════════════  │
     ├──── band 1 ──────────────── ║ road ║ ────────────────────┤
     │ house house house │  ║      ║     │ house house house   │
     │ ═══════════════════ street ═══════════════════════════  │
     └──────────────────────────────────────────────────────────┘
     forest margin

   Your house is the first plot beside the hall; friends fill outward,
   alphabetically, so a friend's house stays put as you add others.
   Everything else is decided by a seeded random, so the trees are in the
   same places every visit.
   -------------------------------------------------------------------------- */

export const T = 32;

const MARGIN = 4; // forest around the edge
const PLOT_W = 8;
const SIDE_PLOTS = 3; // plots each side of the centre column
const CENTRE_W = 14;
const BAND_H = 9;

export const WORLD_W = MARGIN * 2 + SIDE_PLOTS * PLOT_W * 2 + CENTRE_W;

export type Rect = { x: number; y: number; w: number; h: number };

export type Plot = {
  /** Owner's id, or null for an empty lot. */
  owner: string | null;
  /** The plot's top-left tile. */
  x: number;
  y: number;
  /** Where to stand to knock: the tile in front of the door. */
  door: { x: number; y: number };
  /** Walls and roof, which can't be walked through. */
  body: Rect;
};

export type Table = { x: number; y: number; w: number; seats: { x: number; y: number; face: Facing }[] };

export type Prop = {
  kind: PropKind;
  /** Bottom-centre, in px: where its base meets the ground. */
  px: number;
  py: number;
};

export type Facing = 0 | 1 | 2 | 3; // LPC rows: up, left, down, right

/** Anything that can be walked around: the village, a room, the arena. */
export type Grid = { w: number; h: number; blocked: boolean[][] };

export type World = {
  w: number;
  h: number;
  plots: Plot[];
  hall: { body: Rect; door: { x: number; y: number }; plaza: Rect };
  /** The arena's gatehouse; its door leads in (migration 027). */
  arena: { body: Rect; door: { x: number; y: number } };
  tables: Table[];
  streets: Rect[];
  props: Prop[];
  /** blocked[y][x] */
  blocked: boolean[][];
};

/* ------------------------------------------------------------------ props */

export type PropKind = "pine" | "oak" | "sapling" | "bush" | "stump" | "mushroom" | "lilies";

export const ATLAS = "/sprites/tiles/terrain_atlas.png";

/** Where each prop is in the atlas, in px, and which tiles its trunk blocks. */
export const PROPS: Record<PropKind, { sx: number; sy: number; w: number; h: number; blocks: number }> = {
  pine: { sx: 768, sy: 480, w: 96, h: 96, blocks: 1 },
  oak: { sx: 928, sy: 896, w: 96, h: 128, blocks: 1 },
  sapling: { sx: 864, sy: 928, w: 64, h: 96, blocks: 1 },
  bush: { sx: 768, sy: 384, w: 96, h: 96, blocks: 2 },
  stump: { sx: 384, sy: 384, w: 64, h: 64, blocks: 1 },
  mushroom: { sx: 832, sy: 992, w: 32, h: 32, blocks: 0 },
  lilies: { sx: 192, sy: 960, w: 96, h: 64, blocks: 0 },
};

/** Ground tiles, as atlas tile coordinates. */
export const GROUND = {
  grass: [1, 23] as const,
  dirt: [9, 21] as const,
  dirtPebbles: [10, 21] as const,
  stone: [16, 27] as const,
};

/* ----------------------------------------------------------------- layout */

/** A small deterministic random, so the village is laid out the same way every time. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const centreX = MARGIN + SIDE_PLOTS * PLOT_W;

/** Plot slots in the order they're handed out: nearest the hall first. */
function slotOrder(bands: number): { band: number; side: -1 | 1; i: number }[] {
  const out: { band: number; side: -1 | 1; i: number }[] = [];
  for (let band = 0; band < bands; band++)
    for (let i = 0; i < SIDE_PLOTS; i++) {
      out.push({ band, side: 1, i });
      out.push({ band, side: -1, i });
    }
  return out;
}

export function buildWorld(meId: string, friendIds: string[]): World {
  const owners = [meId, ...friendIds];
  const perBand = SIDE_PLOTS * 2;
  // Always at least two bands, so a small village still has a road south.
  const bands = Math.max(2, Math.ceil(owners.length / perBand));
  const h = MARGIN * 2 + bands * BAND_H;
  const w = WORLD_W;
  const blocked = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const block = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (blocked[y]) blocked[y][x] = true;
  };
  const rand = seeded(hash(meId));

  // Forest margin: solid, apart from the trees drawn on it.
  block({ x: 0, y: 0, w, h: MARGIN - 1 });
  block({ x: 0, y: h - MARGIN + 1, w, h: MARGIN - 1 });
  block({ x: 0, y: 0, w: MARGIN - 1, h });
  block({ x: w - MARGIN + 1, y: 0, w: MARGIN - 1, h });

  const bandTop = (b: number) => MARGIN + b * BAND_H;

  // Streets along the bottom of every band, and the road down the middle.
  const streets: Rect[] = [];
  for (let b = 0; b < bands; b++) streets.push({ x: MARGIN - 1, y: bandTop(b) + 7, w: w - 2 * (MARGIN - 1), h: 2 });
  streets.push({ x: centreX + 5, y: bandTop(1), w: 4, h: (bands - 1) * BAND_H });

  // The hall and its plaza, in the middle of band 0. The hall reaches up into
  // the forest margin: it's the biggest thing in the village.
  const hallBody = { x: centreX + 3, y: bandTop(0) - 2, w: 8, h: 7 };
  block(hallBody);
  const hall = {
    body: hallBody,
    door: { x: centreX + 7, y: bandTop(0) + 5 },
    plaza: { x: centreX, y: bandTop(0) + 5, w: CENTRE_W, h: 4 },
  };

  // Work tables either side of the hall door, then down the road.
  const tables: Table[] = [];
  const addTable = (x: number, y: number) => {
    const t: Table = {
      x,
      y,
      w: 3,
      seats: [
        { x: x, y: y + 1, face: 0 },
        { x: x + 1, y: y + 1, face: 0 },
        { x: x + 2, y: y + 1, face: 0 },
        { x: x - 1, y, face: 3 },
        { x: x + 3, y, face: 1 },
      ],
    };
    block({ x, y, w: 3, h: 1 });
    tables.push(t);
  };
  addTable(centreX + 1, bandTop(0) + 5);
  addTable(centreX + 10, bandTop(0) + 5);
  // Band 1, west of the road: the arena's gatehouse.
  const arena = { body: { x: centreX, y: bandTop(1) + 1, w: 5, h: 4 }, door: { x: centreX + 2, y: bandTop(1) + 5 } };
  block(arena.body);

  // Plots.
  const plots: Plot[] = [];
  const slots = slotOrder(bands);
  slots.forEach((s, n) => {
    const top = bandTop(s.band);
    const x = s.side === 1 ? centreX + CENTRE_W + s.i * PLOT_W : centreX - (s.i + 1) * PLOT_W;
    const owner = owners[n] ?? null;
    const body = { x: x + 1, y: top + 1, w: 6, h: 5 };
    const plot: Plot = { owner, x, y: top, door: { x: x + 4, y: top + 6 }, body };
    if (owner) {
      block(body);
      // Garden beds either side of the path to the door.
      block({ x: x + 1, y: top + 6, w: 2, h: 1 });
      block({ x: x + 5, y: top + 6, w: 2, h: 1 });
      // The signpost with the owner's name, on the grass to the left.
      block({ x, y: top + 6, w: 1, h: 1 });
    }
    plots.push(plot);
  });

  // Scenery. Trees on the forest margin, and something on every empty lot.
  const props: Prop[] = [];
  const place = (kind: PropKind, tx: number, ty: number) => {
    const spec = PROPS[kind];
    props.push({ kind, px: tx * T + T / 2, py: (ty + 1) * T });
    if (spec.blocks) block({ x: tx - (spec.blocks > 1 ? 1 : 0), y: ty, w: spec.blocks === 2 ? 3 : 1, h: 1 });
  };
  for (let x = 1; x < w - 1; x += 2 + Math.floor(rand() * 2)) {
    place(rand() < 0.6 ? "pine" : "oak", x, 1 + Math.floor(rand() * 2));
    place(rand() < 0.7 ? "pine" : "bush", x, h - 2 - Math.floor(rand() * 2));
  }
  for (let y = MARGIN; y < h - MARGIN; y += 2 + Math.floor(rand() * 2)) {
    place(rand() < 0.7 ? "pine" : "oak", 1 + Math.floor(rand() * 2), y);
    place(rand() < 0.7 ? "pine" : "oak", w - 2 - Math.floor(rand() * 2), y);
  }
  for (const p of plots) {
    if (p.owner) continue;
    const r = rand();
    if (r < 0.4) {
      place("oak", p.x + 2, p.y + 3);
      place("bush", p.x + 5, p.y + 5);
    } else if (r < 0.7) {
      place("pine", p.x + 2, p.y + 2);
      place("pine", p.x + 5, p.y + 3);
      place("stump", p.x + 3, p.y + 5);
    } else {
      place("bush", p.x + 3, p.y + 3);
      place("sapling", p.x + 6, p.y + 2);
      props.push({ kind: "mushroom", px: (p.x + 1) * T, py: (p.y + 6) * T });
    }
  }
  // A little green on the road's shoulders.
  for (let b = 1; b < bands; b++) {
    if (b > 1) place("sapling", centreX + 2, bandTop(b) + 5);
    place("sapling", centreX + 11, bandTop(b) + 5);
  }

  // Keep the streets, the plaza and every door clear, whatever grew there.
  for (const s of [...streets, hall.plaza]) {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (blocked[y]) blocked[y][x] = false;
  }
  for (const t of tables) block({ x: t.x, y: t.y, w: t.w, h: 1 });
  for (const p of plots) if (blocked[p.door.y]) blocked[p.door.y][p.door.x] = false;
  blocked[hall.door.y][hall.door.x] = false;
  blocked[arena.door.y][arena.door.x] = false;

  return { w, h, plots, hall, arena, tables, streets, props, blocked };
}

/* ------------------------------------------------------------ pathfinding */

export function walkable(world: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.w && y < world.h && !world.blocked[y][x];
}

/** Nearest walkable tile to (x, y), searching outward. */
export function nearestOpen(world: Grid, x: number, y: number): { x: number; y: number } {
  const tx = Math.round(x);
  const ty = Math.round(y);
  for (let r = 0; r < 12; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(world, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
  return { x: tx, y: ty };
}

/**
 * A* over the tile grid, 8 directions (no cutting corners past walls).
 * Returns tile centres from the step after `from` to `to`, or [] if there's
 * no way.
 */
export function findPath(
  world: Grid,
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number }[] {
  const W = world.w;
  const start = from.y * W + from.x;
  const goal = to.y * W + to.x;
  if (!walkable(world, to.x, to.y)) return [];
  if (start === goal) return [];

  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: { k: number; f: number }[] = [{ k: start, f: 0 }];
  const closed = new Set<number>();
  const hf = (k: number) => {
    const dx = Math.abs((k % W) - to.x);
    const dy = Math.abs(Math.floor(k / W) - to.y);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };

  let guard = 0;
  while (open.length && guard++ < 6000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { k } = open.splice(bi, 1)[0];
    if (k === goal) break;
    if (closed.has(k)) continue;
    closed.add(k);
    const cx = k % W;
    const cy = Math.floor(k / W);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkable(world, nx, ny)) continue;
        if (dx && dy && (!walkable(world, cx + dx, cy) || !walkable(world, cx, cy + dy))) continue;
        const nk = ny * W + nx;
        const cost = (g.get(k) ?? 0) + (dx && dy ? 1.41 : 1);
        if (cost < (g.get(nk) ?? Infinity)) {
          g.set(nk, cost);
          came.set(nk, k);
          open.push({ k: nk, f: cost + hf(nk) });
        }
      }
  }

  if (!came.has(goal)) return [];
  const path: { x: number; y: number }[] = [];
  for (let k = goal; k !== start; k = came.get(k)!) path.push({ x: k % W, y: Math.floor(k / W) });
  return path.reverse();
}

/** The tile a px position stands on. */
export function tileAt(px: number, py: number) {
  return { x: Math.floor(px / T), y: Math.floor(py / T) };
}

export function inRect(r: Rect, x: number, y: number) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
