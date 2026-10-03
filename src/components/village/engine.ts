import { findPath, nearestOpen, T, tileAt, walkable, type Facing, type Grid } from "@/components/village/world";
import { headingToward, LEGACY_HEADING } from "@/lib/heading";

/* --------------------------------------------------------------------------
   Everyone who walks: you, and friends going where they are.

   Positions are world px at 1× — the point where the feet meet the ground.
   The loop moves each walker and writes its transform and sprite frame
   straight onto its element: a village of knights must not re-render React
   sixty times a second.
   -------------------------------------------------------------------------- */

export const FRAME = 64;
/** Where the feet sit in an LPC frame, from its top. */
const FEET = 60;
const WALK_SPEED = 96; // px/s, a relaxed stroll
const RUN_SPEED = 150; // you, when you're going somewhere

export type Agent = {
  id: string;
  x: number;
  y: number;
  path: { x: number; y: number }[];
  dir: Facing;
  /** Distance walked, which picks the walk-cycle frame. */
  stride: number;
  moving: boolean;
  speed: number;
  /**
   * Which way they face to 22.5° (heading.ts), for the 16-direction sheets.
   * `dir` stays the four-way facing everything else uses; the heading only
   * counts while `dir` is still what it was when the heading was set
   * (`headingDir`, see headingOf), so code that sets `dir` by hand — a
   * seat, a door — needs no change.
   */
  heading: number;
  headingDir: Facing;
  el: HTMLElement | null;
  /** Sitting at a table, facing it. */
  seat: { x: number; y: number; face: Facing } | null;
  /** Outside: the tile they stand on where they are (Village.tsx). */
  stand: { x: number; y: number } | null;
  /** Called once when the current path is finished. */
  onArrive?: () => void;
  /**
   * Someone in a shared room: exactly where their own screen has them, in
   * world px, and which way they face. Followed in a straight line — they
   * already walked the route themselves — so every screen ends up agreeing.
   */
  goal: { x: number; y: number; dir: Facing; heading: number | null } | null;
  /** Guarding, in a duel: held in the guard pose (paint). */
  guard: boolean;
  /** When they last swung (performance.now()), for the swing animation; 0 never. */
  swingAt: number;
  /** When they last jumped (performance.now()), for the hop; 0 never. */
  jumpAt: number;
};

/** How long a swing takes to play, start to finish. */
export const SWING_MS = 360;
/** Starts a swing (paint plays it) — once, however many times it's reported. */
export function swingNow(a: Agent | null | undefined, now: number) {
  if (a && now - a.swingAt > SWING_MS) a.swingAt = now;
}

/** A jump: how long it lasts, and how high it goes at the top, in px at 1×. */
export const JUMP_MS = 420;
const JUMP_PX = 18;
/** Starts a jump (paint plays it); false if one's still going. Purely a look: it clears nothing. */
export function jumpNow(a: Agent | null | undefined, now: number): boolean {
  if (!a || now - a.jumpAt < JUMP_MS) return false;
  a.jumpAt = now;
  return true;
}

/** How far off the ground a jump has them at `now`: a hop up and back down. */
function jumpLift(a: Agent, now: number): number {
  const k = (now - a.jumpAt) / JUMP_MS;
  return k > 0 && k < 1 ? 4 * JUMP_PX * k * (1 - k) : 0;
}

/** The frame of the duel animation a guard holds: weapon drawn across the body. */
const GUARD_FRAME = 1;

export function makeAgent(id: string, tx: number, ty: number, speed = WALK_SPEED): Agent {
  return {
    id,
    x: tx * T + T / 2,
    y: ty * T + T / 2 + 8,
    path: [],
    dir: 2,
    stride: 0,
    moving: false,
    speed,
    heading: LEGACY_HEADING[2],
    headingDir: 2,
    el: null,
    seat: null,
    stand: null,
    goal: null,
    guard: false,
    swingAt: 0,
    jumpAt: 0,
  };
}

/**
 * Keeps a fighter's feet inside the arena ring — the same ellipse the ring
 * is drawn as (scenes.tsx), less a little so they stay on the dirt side of
 * the line. The ring is in tiles.
 */
export function keepInRing(a: Agent, ring: { cx: number; cy: number; r: number }) {
  const ex = (ring.cx + 0.5) * T;
  const ey = (ring.cy + 0.5) * T;
  const rx = ring.r * T - 10;
  const ry = ring.r * T * 0.7 - 10;
  const fx = a.x - ex;
  const fy = a.y - 8 - ey;
  const k = Math.hypot(fx / rx, fy / ry);
  if (k <= 1) return;
  a.x = ex + fx / k;
  a.y = ey + fy / k + 8;
  a.path = [];
}

export const PLAYER_SPEED = RUN_SPEED;

/** Further behind than this and they're simply put there. */
const SNAP_PX = T * 4;

/** The 22.5° heading to show: theirs, unless `dir` has been turned by hand since. */
export function headingOf(a: Agent): number {
  return a.headingDir === a.dir ? a.heading : LEGACY_HEADING[a.dir];
}

/** Where someone stands, in the tiles the check-in and the live connection carry. */
export function tilesOf(a: Agent): { x: number; y: number; facing: Facing; heading: number } {
  return { x: (a.x - T / 2) / T, y: (a.y - T / 2 - 8) / T, facing: a.dir, heading: headingOf(a) };
}

/**
 * Follow someone to where they reported being, in tiles (tilesOf, on their
 * screen). `snap` places them at once. `heading`: how finely they face, if
 * their screen said (older ones only know the four ways).
 */
export function follow(a: Agent, x: number, y: number, dir: Facing, snap = false, heading: number | null = null) {
  a.goal = { x: x * T + T / 2, y: y * T + T / 2 + 8, dir, heading };
  a.path = [];
  a.onArrive = undefined;
  if (snap) {
    a.x = a.goal.x;
    a.y = a.goal.y;
    face(a, dir, heading);
  }
}

/** Faces them a way, as finely as is known. */
function face(a: Agent, dir: Facing, heading: number | null) {
  a.dir = dir;
  a.heading = heading ?? LEGACY_HEADING[dir];
  a.headingDir = dir;
}

/**
 * Turns to look along (dx, dy), at any angle. The four-way facing is the
 * nearer axis; on an exact diagonal it's `tie`'s — "x" (left or right) unless
 * told otherwise, so walking up-left shows a knight walking left. The
 * heading is the same look to 22.5°.
 */
export function turn(a: Agent, dx: number, dy: number, tie: "x" | "y" = "x") {
  a.dir = faceToward(dx, dy, tie);
  a.heading = headingToward(dx, dy);
  a.headingDir = a.dir;
}

/** Whether feet can stand at (x, y): a few px either side, so shoulders don't clip corners. */
function clearAt(world: Grid, x: number, y: number): boolean {
  return [-8, 8].every((ox) => {
    const t = tileAt(x + ox, y - 4);
    return walkable(world, t.x, t.y);
  });
}

/** Whether a walker could go straight from one point to another without touching anything. */
function inSight(world: Grid, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4);
  for (let i = 1; i <= n; i++) if (!clearAt(world, from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n)) return false;
  return true;
}

/**
 * A tile-by-tile route pulled straight: from each point, on to the furthest
 * one along it that can be walked to in a line. So a walk across open ground
 * goes the direct way, at whatever angle, and only turns at corners.
 */
function straighten(world: Grid, start: { x: number; y: number }, path: { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  let at = start;
  let i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !inSight(world, at, path[j])) j--;
    out.push(path[j]);
    at = path[j];
    i = j + 1;
  }
  return out;
}

/** Walk to a tile along the streets; true if there's a way there. */
export function walkTo(world: Grid, a: Agent, tx: number, ty: number, onArrive?: () => void): boolean {
  const from = nearestOpen(world, Math.floor(a.x / T), Math.floor((a.y - 8) / T));
  const to = nearestOpen(world, tx, ty);
  const path = findPath(world, from, to);
  if (!path.length && (from.x !== to.x || from.y !== to.y)) return false;
  a.path = straighten(
    world,
    a,
    path.map((p) => ({ x: p.x * T + T / 2, y: p.y * T + T / 2 + 8 }))
  );
  a.onArrive = onArrive;
  if (!a.path.length) onArrive?.();
  return true;
}

function faceToward(dx: number, dy: number, tie: "x" | "y" = "x"): Facing {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sideways = ax > ay || (ax === ay && tie === "x");
  return sideways ? (dx < 0 ? 1 : 3) : dy < 0 ? 0 : 2;
}

/**
 * Moves one walker along its path by dt seconds. Nobody wanders: a walker
 * moves only to follow someone, or to get to where they've gone.
 */
export function step(world: Grid, a: Agent, dt: number) {
  if (a.goal) {
    const g = a.goal;
    const dx = g.x - a.x;
    const dy = g.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SNAP_PX) {
      a.x = g.x;
      a.y = g.y;
      a.moving = false;
    } else {
      // Walking pace, or quicker when behind, so the lag never builds up.
      const move = Math.max(a.speed, dist * 8) * dt;
      a.moving = dist > 0.5;
      if (dist <= move) {
        a.x = g.x;
        a.y = g.y;
        a.stride += dist;
      } else {
        a.x += (dx / dist) * move;
        a.y += (dy / dist) * move;
        a.stride += move;
      }
    }
    face(a, g.dir, g.heading);
    return;
  }
  if (a.seat) {
    // Walk to the seat first, then stay put, facing the table.
    const sx = a.seat.x * T + T / 2;
    const sy = a.seat.y * T + T / 2 + 8;
    if (!a.path.length && Math.hypot(a.x - sx, a.y - sy) > 2) walkTo(world, a, a.seat.x, a.seat.y);
    if (!a.path.length) {
      a.moving = false;
      a.dir = a.seat.face;
      return;
    }
  }

  if (!a.path.length) {
    a.moving = false;
    return;
  }
  const target = a.path[0];
  const dx = target.x - a.x;
  const dy = target.y - a.y;
  const dist = Math.hypot(dx, dy);
  const move = a.speed * dt;
  a.moving = true;
  turn(a, dx, dy);
  if (dist <= move) {
    a.x = target.x;
    a.y = target.y;
    a.stride += dist;
    a.path.shift();
    if (!a.path.length) {
      a.moving = false;
      const done = a.onArrive;
      a.onArrive = undefined;
      done?.();
    }
  } else {
    a.x += (dx / dist) * move;
    a.y += (dy / dist) * move;
    a.stride += move;
  }
}

/**
 * Moves the player directly, sliding along walls: in any direction (vx, vy)
 * — the keys' eight, or towards a held pointer all the way round.
 */
export function nudgePlayer(world: Grid, a: Agent, vx: number, vy: number, dt: number, tie: "x" | "y" = "x") {
  const len = Math.hypot(vx, vy);
  if (!len) {
    if (!a.path.length) a.moving = false;
    return;
  }
  a.path = [];
  a.onArrive = undefined;
  const move = a.speed * dt;
  const nx = a.x + (vx / len) * move;
  const ny = a.y + (vy / len) * move;
  let moved = false;
  if (clearAt(world, nx, a.y)) {
    a.x = nx;
    moved = true;
  }
  if (clearAt(world, a.x, ny)) {
    a.y = ny;
    moved = true;
  }
  turn(a, vx, vy, tie);
  a.moving = moved;
  if (moved) a.stride += move;
}

/**
 * Writes a walker onto its element, at `now` (performance.now()). The
 * element's first child is the walk sheet; the second, when it has one
 * (data-cols), the duel sheet (sprite.ts, composeAttack), shown instead
 * while they swing or guard.
 */
export function paint(a: Agent, scale: number, now: number) {
  const el = a.el;
  if (!el) return;
  el.style.transform = `translate3d(${Math.round((a.x - FRAME / 2) * scale)}px, ${Math.round((a.y - FEET) * scale)}px, 0)`;
  // Walkers start hidden (Village.tsx) so none shows at the scene's corner
  // before its first placing.
  if (el.style.visibility) el.style.visibility = "";
  el.style.zIndex = String(Math.round(a.y));
  const sprite = el.firstElementChild as HTMLElement | null;
  const duel = sprite?.nextElementSibling as HTMLElement | null;
  const cols = Number(duel?.dataset.cols || 0);
  const swing = now - a.swingAt;
  const pose = !cols ? -1 : swing >= 0 && swing < SWING_MS ? Math.floor((swing / SWING_MS) * cols) : a.guard ? GUARD_FRAME : -1;
  // A jump lifts the knight, not where they stand: their shadow, name and
  // place in the crowd stay on the ground.
  const lift = `translateY(${-Math.round(jumpLift(a, now) * scale)}px)`;
  if (sprite && sprite.style.transform !== lift) sprite.style.transform = lift;
  if (duel && duel.style.transform !== lift) duel.style.transform = lift;
  if (sprite) {
    show(sprite, pose < 0);
    if (pose < 0) {
      const frame = a.moving ? 1 + (Math.floor(a.stride / 10) % 8) : 0;
      // A sheet of 16 rows (Walker's data-rows) shows the heading itself; a
      // plain one, the nearest of its four ways.
      const row = Number(sprite.dataset.rows) === 16 ? headingOf(a) : a.dir;
      sprite.style.backgroundPosition = `${-frame * FRAME * scale}px ${-row * FRAME * scale}px`;
    }
  }
  if (duel && cols) {
    show(duel, pose >= 0);
    if (pose >= 0) {
      const f = Number(duel.dataset.frame) * scale;
      duel.style.backgroundPosition = `${-pose * f}px ${-a.dir * f}px`;
    }
  }
}

function show(el: HTMLElement, on: boolean) {
  const v = on ? "visible" : "hidden";
  if (el.style.visibility !== v) el.style.visibility = v;
}
