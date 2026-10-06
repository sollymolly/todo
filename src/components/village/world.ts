/* --------------------------------------------------------------------------
   The village's layout: one village for everyone, the same on every screen,
   so a position here means the same thing to all who see it.

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

   Everyone has a plot of their own (db: houses.plot; plotAt), numbered
   outward from the hall, and more bands are added at the bottom as people
   arrive — so nothing already there ever moves. Everything else is decided
   by a seeded random, so the trees are in the same places for everyone.
   -------------------------------------------------------------------------- */

import type { Tier } from "@/lib/village";

export const T = 32;

const MARGIN = 4; // forest around the edge
const PLOT_W = 8;
const SIDE_PLOTS = 3; // plots each side of the centre column: six houses a row
const CENTRE_W = 14;
const BAND_H = 9;

export const WORLD_W = MARGIN * 2 + SIDE_PLOTS * PLOT_W * 2 + CENTRE_W;

export type Rect = { x: number; y: number; w: number; h: number };

export type Plot = {
  /** Its number (plotAt), the same for everyone. */
  n: number;
  /** Owner's id, or null for an empty lot. */
  owner: string | null;
  /** The plot's top-left tile. */
  x: number;
  y: number;
  /** Where to stand to knock: the tile in front of the door. */
  door: { x: number; y: number };
  /** Where the building is drawn: walls and roof. */
  body: Rect;
};

/* ------------------------------------------------------------ empty lots */

/** One tile of an empty lot's fence: a post, and which neighbours its rails join. */
export type FenceTile = { x: number; y: number; l: boolean; r: boolean; d: boolean; post: boolean };

/**
 * The fence round an empty lot, which is 6×6 tiles from (x + 1, y + 1) in
 * its plot at (x, y): the ring of tiles on its edge, all blocked, with a
 * two-tile gate in the middle of the front, where a house's path to its door
 * would go. The tiles either side of the gate carry its posts (`post: false`:
 * LotGate draws them taller). Walking and drawing both read this.
 */
export function lotFence(x: number, y: number): { tiles: FenceTile[]; gate: { x: number; y: number; tiles: { x: number; y: number }[] } } {
  const ring = new Set<string>();
  const gate = [
    { x: x + 3, y: y + 6 },
    { x: x + 4, y: y + 6 },
  ];
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      const edge = i === 0 || i === 5 || j === 0 || j === 5;
      if (edge && !gate.some((g) => g.x === x + 1 + i && g.y === y + 1 + j)) ring.add(`${x + 1 + i},${y + 1 + j}`);
    }
  const has = (tx: number, ty: number) => ring.has(`${tx},${ty}`);
  const tiles = [...ring].map((k) => {
    const [tx, ty] = k.split(",").map(Number);
    const gatePost = ty === y + 6 && (tx === x + 2 || tx === x + 5);
    return { x: tx, y: ty, l: has(tx - 1, ty), r: has(tx + 1, ty), d: has(tx, ty + 1), post: !gatePost };
  });
  // The gate drawing starts at the left gate post's tile.
  return { tiles, gate: { x: x + 2, y: y + 6, tiles: gate } };
}

/**
 * What of a plot can't be walked through, by house size, in tiles from the
 * plot's top-left (House.tsx draws it). A tent is a triangle of canvas with
 * grass all round it, so only the canvas blocks; anything bigger fills its
 * 6×5 body.
 */
const FOOTPRINT: Partial<Record<Tier, Rect[]>> = {
  tent: [
    { x: 3, y: 3, w: 2, h: 1 },
    { x: 2, y: 4, w: 4, h: 2 },
  ],
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
  /** Which village (plot / PLOTS_PER_VILLAGE; a planet from PLANET_BASE up), its name and look. */
  v: number;
  name: string;
  theme: Theme;
  w: number;
  h: number;
  plots: Plot[];
  hall: { body: Rect; door: { x: number; y: number }; plaza: Rect };
  /** The arena's gatehouse; its door leads in. */
  arena: { body: Rect; door: { x: number; y: number } };
  tables: Table[];
  /** The rest of the village: a store, a library, parks… (Landmarks.tsx). */
  landmarks: Landmark[];
  /** Along the bottom: the station (its door opens onto the platform) and the line. */
  station: { body: Rect; door: { x: number; y: number }; platform: Rect; track: Rect };
  /** Hedge tiles round the shops and the arena: only the front path leads in. */
  hedges: { x: number; y: number }[];
  streets: Rect[];
  props: Prop[];
  /** blocked[y][x] */
  blocked: boolean[][];
};

/* -------------------------------------------------------------- landmarks */

export type LandmarkKind = "store" | "library" | "bakery" | "park" | "garden";

/**
 * Something that isn't anyone's house, beside the road down the middle.
 * `area` is all of its ground (5×7 tiles); `body` the part that can't be
 * walked through (a building, a fountain, a well); `door` where a
 * building's way in is.
 */
export type Landmark = { kind: LandmarkKind; area: Rect; body: Rect; door: { x: number; y: number } | null };

/** Every village has one of each, beside the road; each village in its own order. */
const LANDMARKS: LandmarkKind[] = ["store", "park", "library", "bakery", "garden"];
export const BUILDINGS: LandmarkKind[] = ["store", "library", "bakery"];

/* ---------------------------------------------------------------- villages */

/**
 * The look of a village: how its grass and trees are tinted (Ground.tsx,
 * Village.tsx) and how thick its woods are. The first is the meadow the
 * village always was; the rest follow in turn. Planets have looks of their
 * own (PLANET_LOOKS), picked by whoever founds one.
 */
export type Theme = "meadow" | "forest" | "autumn" | "snowy" | "spring" | PlanetLook;
const THEMES: Theme[] = ["meadow", "autumn", "forest", "spring", "snowy"];

const NAMES = [
  "Oakvale", "Riverford", "Ashby", "Thornfield", "Brightwater", "Elmstead", "Millbrook", "Wrenhollow",
  "Stonebridge", "Fernley", "Hollowmere", "Kingsrest", "Larkspur", "Mossgate", "Fairhaven", "Briarwood",
];

/* ----------------------------------------------------------------- planets */

/**
 * Private, invite-only worlds (src/lib/planets.ts). Each is a village of its
 * own, laid out like any other, numbered from PLANET_BASE up (db: planets.id
 * + PLANET_BASE) — so everything keyed on a village number (presence, tables,
 * duels, talk) works there unchanged, and never meets a public village's.
 */
export const PLANET_BASE = 100_000;
export const isPlanet = (v: number) => v >= PLANET_BASE;
export const planetVillage = (id: number) => PLANET_BASE + id;
export const planetIdOf = (v: number) => v - PLANET_BASE;
/**
 * Which of someone's houses a village has: every public village shares the
 * one (0), and each planet has its own.
 */
export const houseWorld = (v: number) => (isPlanet(v) ? v : 0);

export type PlanetLook = "dust" | "moon" | "nebula" | "glacier";
export const PLANET_LOOKS: { look: PlanetLook; label: string; swatch: string }[] = [
  { look: "dust", label: "Red dust", swatch: "#c0613a" },
  { look: "moon", label: "Moon rock", swatch: "#a7a9b0" },
  { look: "nebula", label: "Nebula", swatch: "#8a4fc0" },
  { look: "glacier", label: "Glacier", swatch: "#6fc4dc" },
];

/** A planet's name and look, as the page knows it (VillageData.planets). */
export type PlanetInfo = { v: number; name: string; look: PlanetLook };

/**
 * A village's name and look, the same for everyone. A planet's come from
 * `planets`; one that isn't among them is one I'm not on.
 */
export function villageInfo(v: number, planets: PlanetInfo[] = []): { name: string; theme: Theme } {
  if (isPlanet(v)) {
    const p = planets.find((x) => x.v === v);
    return { name: p?.name ?? "A private planet", theme: p?.look ?? "dust" };
  }
  const round = Math.floor(v / NAMES.length);
  return { name: NAMES[v % NAMES.length] + (round ? ` ${round + 1}` : ""), theme: THEMES[v % THEMES.length] };
}

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
export const PLOTS_PER_BAND = SIDE_PLOTS * 2;
/** Rows of houses in a village. */
const BANDS = 4;
/** How many houses a village holds; the next ones start a new village. */
export const PLOTS_PER_VILLAGE = BANDS * PLOTS_PER_BAND;
const bandTop = (b: number) => MARGIN + b * BAND_H;
/** The railway, below the last row of houses. */
const RAIL_TOP = bandTop(BANDS);

/** Which village plot `plot` is in. */
export const villageOf = (plot: number) => Math.floor(plot / PLOTS_PER_VILLAGE);

/**
 * Where plot `n` is in its village, its top-left tile. Numbered nearest the
 * hall first — band by band, alternating sides — and fixed for good.
 */
export function plotAt(n: number): { x: number; y: number } {
  const local = n % PLOTS_PER_VILLAGE;
  const k = local % PLOTS_PER_BAND;
  const side = k % 2 ? -1 : 1;
  const i = Math.floor(k / 2);
  return { x: side === 1 ? centreX + CENTRE_W + i * PLOT_W : centreX - (i + 1) * PLOT_W, y: bandTop(Math.floor(local / PLOTS_PER_BAND)) };
}

/**
 * Village `v`, the same on every screen. `owners[i]` is whose house is on
 * its i-th plot — plot v × PLOTS_PER_VILLAGE + i (db: houses.plot) — or
 * nothing for an empty lot, and `tiers[i]` how big that house is. `planets`:
 * the planets I'm on, for a planet's name and look.
 */
export function buildWorld(v: number, owners: (string | null)[], tiers: (Tier | null)[] = [], planets: PlanetInfo[] = []): World {
  const { name, theme } = villageInfo(v, planets);
  const bands = BANDS;
  const h = RAIL_TOP + 7 + MARGIN;
  const w = WORLD_W;
  const blocked = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const block = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (blocked[y]) blocked[y][x] = true;
  };
  const rand = seeded(hash(`village:${v}`));

  // Forest margin: solid, apart from the trees drawn on it.
  block({ x: 0, y: 0, w, h: MARGIN - 1 });
  block({ x: 0, y: h - MARGIN + 1, w, h: MARGIN - 1 });
  block({ x: 0, y: 0, w: MARGIN - 1, h });
  block({ x: w - MARGIN + 1, y: 0, w: MARGIN - 1, h });

  // Streets along the bottom of every band, the road down the middle, and
  // paths either side of the station down to the platform.
  const streets: Rect[] = [];
  for (let b = 0; b < bands; b++) streets.push({ x: MARGIN - 1, y: bandTop(b) + 7, w: w - 2 * (MARGIN - 1), h: 2 });
  streets.push({ x: centreX + 5, y: bandTop(1), w: 4, h: (bands - 1) * BAND_H });
  streets.push({ x: centreX + 3, y: RAIL_TOP, w: 1, h: 4 }, { x: centreX + 10, y: RAIL_TOP, w: 1, h: 4 });

  // The hall and its plaza, in the middle of band 0. The hall reaches up into
  // the forest margin: it's the biggest thing in the village. The plaza is
  // a stone pad in front of the door as wide as the road (4) and as deep as
  // a street (2), with the dirt street running on just below it; the hall's
  // door is two tiles wide across the middle of both.
  const hallBody = { x: centreX + 3, y: bandTop(0) - 2, w: 8, h: 7 };
  block(hallBody);
  const hall = {
    body: hallBody,
    door: { x: centreX + 7, y: bandTop(0) + 5 },
    plaza: { x: centreX + 5, y: bandTop(0) + 5, w: 4, h: 2 },
  };

  // Work tables either side of the hall door.
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

  // A building beside the road sits inside a hedge: along the back, down
  // both sides of its forecourt, and along the front either side of the path
  // to its door (5 wide, door in the middle) — the only way in.
  const hedges: { x: number; y: number }[] = [];
  const hedgeRound = (x: number, y: number) => {
    for (let i = 0; i < 5; i++) {
      hedges.push({ x: x + i, y });
      if (i !== 2) hedges.push({ x: x + i, y: y + 6 });
    }
    hedges.push({ x, y: y + 5 }, { x: x + 4, y: y + 5 });
  };
  hedgeRound(arena.body.x, arena.body.y - 1);

  // The station, at the foot of the road, and the line along the bottom.
  const station = {
    body: { x: centreX + 4, y: RAIL_TOP, w: 6, h: 4 },
    door: { x: centreX + 7, y: RAIL_TOP + 4 },
    platform: { x: MARGIN - 1, y: RAIL_TOP + 4, w: w - 2 * (MARGIN - 1), h: 1 },
    track: { x: 0, y: RAIL_TOP + 5, w, h: 2 },
  };
  block(station.body);
  block(station.track);

  // Plots.
  const plots: Plot[] = [];
  for (let i = 0; i < PLOTS_PER_VILLAGE; i++) {
    const n = v * PLOTS_PER_VILLAGE + i;
    const { x, y: top } = plotAt(n);
    const owner = owners[i] ?? null;
    const body = { x: x + 1, y: top + 1, w: 6, h: 5 };
    const plot: Plot = { n, owner, x, y: top, door: { x: x + 4, y: top + 6 }, body };
    if (owner) {
      const tier = tiers[i];
      const foot = tier ? FOOTPRINT[tier] : undefined;
      if (foot) for (const r of foot) block({ ...r, x: x + r.x, y: top + r.y });
      else block(body);
      // Garden beds either side of the path to the door.
      block({ x: x + 1, y: top + 6, w: 2, h: 1 });
      block({ x: x + 5, y: top + 6, w: 2, h: 1 });
    }
    // The signpost: the owner's name on the grass to the left. An empty lot
    // is fenced instead (lotFence), with its sign on the gate.
    if (owner) block({ x, y: top + 6, w: 1, h: 1 });
    else for (const t of lotFence(x, top).tiles) block({ x: t.x, y: t.y, w: 1, h: 1 });
    plots.push(plot);
  }

  // Scenery: trees on the forest margin, thicker in a forest village.
  const props: Prop[] = [];
  const place = (kind: PropKind, tx: number, ty: number) => {
    const spec = PROPS[kind];
    props.push({ kind, px: tx * T + T / 2, py: (ty + 1) * T });
    if (spec.blocks) block({ x: tx - (spec.blocks > 1 ? 1 : 0), y: ty, w: spec.blocks === 2 ? 3 : 1, h: 1 });
  };
  const gap = () => (theme === "forest" ? 1 : 2) + Math.floor(rand() * 2);
  for (let x = 1; x < w - 1; x += gap()) {
    place(rand() < 0.6 ? "pine" : "oak", x, 1 + Math.floor(rand() * 2));
    place(rand() < 0.7 ? "pine" : "bush", x, h - 2 - Math.floor(rand() * 2));
  }
  for (let y = MARGIN; y < h - MARGIN; y += gap()) {
    place(rand() < 0.7 ? "pine" : "oak", 1 + Math.floor(rand() * 2), y);
    place(rand() < 0.7 ? "pine" : "oak", w - 2 - Math.floor(rand() * 2), y);
  }

  // Either side of the road, below the hall: one of each landmark, in this
  // village's own order (the first village keeps the order it always had).
  const order = [...LANDMARKS];
  if (v > 0)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  const landmarks: Landmark[] = [];
  let k = 0;
  for (let b = 1; b < bands; b++)
    for (const side of b === 1 ? [1] : [-1, 1]) {
      const kind = order[k++];
      const x = side === 1 ? centreX + 9 : centreX;
      const y = bandTop(b);
      const area = { x, y, w: 5, h: 7 };
      if (BUILDINGS.includes(kind)) {
        const body = { x, y: y + 1, w: 5, h: 4 };
        block(body);
        hedgeRound(x, y);
        landmarks.push({ kind, area, body, door: { x: x + 2, y: y + 5 } });
      } else {
        // A fountain or a well in the middle, trees at the back.
        const body = kind === "park" ? { x: x + 1, y: y + 3, w: 3, h: 1 } : { x: x + 2, y: y + 3, w: 1, h: 1 };
        block(body);
        place(kind === "park" ? "oak" : "pine", x, y + 1);
        place(kind === "park" ? "oak" : "sapling", x + 4, y + 1);
        landmarks.push({ kind, area, body, door: null });
      }
    }

  // Keep the streets, the plaza, the platform and every door clear, whatever grew there.
  for (const s of [...streets, hall.plaza, station.platform]) {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (blocked[y]) blocked[y][x] = false;
  }
  for (const t of tables) block({ x: t.x, y: t.y, w: t.w, h: 1 });
  for (const p of plots) if (blocked[p.door.y]) blocked[p.door.y][p.door.x] = false;
  blocked[hall.door.y][hall.door.x] = false;
  blocked[arena.door.y][arena.door.x] = false;

  for (const t of hedges) block({ x: t.x, y: t.y, w: 1, h: 1 });

  return { v, name, theme, w, h, plots, hall, arena, tables, landmarks, station, hedges, streets, props, blocked };
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
  const open = new Heap();
  open.push(start, 0);
  const closed = new Set<number>();
  const hf = (k: number) => {
    const dx = Math.abs((k % W) - to.x);
    const dy = Math.abs(Math.floor(k / W) - to.y);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };

  // Every tile at most once or twice over: plenty for the whole village.
  let guard = 0;
  const most = world.w * world.h * 2;
  while (open.size && guard++ < most) {
    const k = open.pop();
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
          open.push(nk, cost + hf(nk));
        }
      }
  }

  if (!came.has(goal)) return [];
  const path: { x: number; y: number }[] = [];
  for (let k = goal; k !== start; k = came.get(k)!) path.push({ x: k % W, y: Math.floor(k / W) });
  return path.reverse();
}

/** The open set: tile keys by lowest score first, a binary heap. */
class Heap {
  private keys: number[] = [];
  private scores: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, f: number) {
    const { keys, scores } = this;
    let i = keys.length;
    keys.push(k);
    scores.push(f);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (scores[up] <= f) break;
      keys[i] = keys[up];
      scores[i] = scores[up];
      i = up;
    }
    keys[i] = k;
    scores[i] = f;
  }
  pop(): number {
    const { keys, scores } = this;
    const top = keys[0];
    const k = keys.pop()!;
    const f = scores.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && scores[c + 1] < scores[c]) c++;
        if (scores[c] >= f) break;
        keys[i] = keys[c];
        scores[i] = scores[c];
        i = c;
      }
      keys[i] = k;
      scores[i] = f;
    }
    return top;
  }
}

/** The tile a px position stands on. */
export function tileAt(px: number, py: number) {
  return { x: Math.floor(px / T), y: Math.floor(py / T) };
}

export function inRect(r: Rect, x: number, y: number) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
