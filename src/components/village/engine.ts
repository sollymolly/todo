import { findPath, nearestOpen, T, tileAt, walkable, type Facing, type Grid } from "@/components/village/world";

/* --------------------------------------------------------------------------
   Everyone who walks: you, and friends strolling about where they are.

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
  el: HTMLElement | null;
  /** Sitting at a table: no strolling, facing the table. */
  seat: { x: number; y: number; face: Facing } | null;
  /** Where they stroll around, and when they next set off. */
  home: { x: number; y: number; r: number } | null;
  nextStroll: number;
  /** Called once when the current path is finished. */
  onArrive?: () => void;
  /**
   * Someone in a shared room: exactly where their own screen has them, in
   * world px, and which way they face. Followed in a straight line — they
   * already walked the route themselves — so every screen ends up agreeing.
   */
  goal: { x: number; y: number; dir: Facing } | null;
  /** Guarding, in a duel: shown as a shield over their head. */
  guard: boolean;
};

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
    el: null,
    seat: null,
    home: null,
    nextStroll: 0,
    goal: null,
    guard: false,
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

/**
 * Follow someone to where they reported being, in tiles — the same numbers
 * the check-in and the live connection carry. `snap` places them at once.
 */
export function follow(a: Agent, x: number, y: number, dir: Facing, snap = false) {
  a.goal = { x: x * T + T / 2, y: y * T + T / 2 + 8, dir };
  a.path = [];
  a.onArrive = undefined;
  if (snap) {
    a.x = a.goal.x;
    a.y = a.goal.y;
    a.dir = dir;
  }
}

/** Walk to a tile along the streets; true if there's a way there. */
export function walkTo(world: Grid, a: Agent, tx: number, ty: number, onArrive?: () => void): boolean {
  const from = nearestOpen(world, Math.floor(a.x / T), Math.floor((a.y - 8) / T));
  const to = nearestOpen(world, tx, ty);
  const path = findPath(world, from, to);
  if (!path.length && (from.x !== to.x || from.y !== to.y)) return false;
  a.path = path.map((p) => ({ x: p.x * T + T / 2, y: p.y * T + T / 2 + 8 }));
  a.onArrive = onArrive;
  if (!a.path.length) onArrive?.();
  return true;
}

function faceToward(dx: number, dy: number): Facing {
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : dy < 0 ? 0 : 2;
}

/** Moves one walker along its path by dt seconds. */
export function step(world: Grid, a: Agent, dt: number, now: number) {
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
    a.dir = g.dir;
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
  } else if (!a.path.length && a.home && now >= a.nextStroll) {
    // Idle: now and then, amble to somewhere nearby.
    const r = a.home.r;
    for (let tries = 0; tries < 6; tries++) {
      const tx = a.home.x + Math.round((Math.random() * 2 - 1) * r);
      const ty = a.home.y + Math.round((Math.random() * 2 - 1) * r);
      if (walkable(world, tx, ty) && walkTo(world, a, tx, ty)) break;
    }
    a.nextStroll = now + 2500 + Math.random() * 5000;
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
  a.dir = faceToward(dx, dy);
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

/** Moves the player directly (keys), sliding along walls. */
export function nudgePlayer(world: Grid, a: Agent, vx: number, vy: number, dt: number) {
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
  // Test the feet: a few px either side, so shoulders don't clip corners.
  const clear = (x: number, y: number) =>
    [-8, 8].every((ox) => {
      const t = tileAt(x + ox, y - 4);
      return walkable(world, t.x, t.y);
    });
  let moved = false;
  if (clear(nx, a.y)) {
    a.x = nx;
    moved = true;
  }
  if (clear(a.x, ny)) {
    a.y = ny;
    moved = true;
  }
  a.dir = faceToward(vx, vy);
  a.moving = moved;
  if (moved) a.stride += move;
}

/** Writes a walker onto its element. */
export function paint(a: Agent, scale: number) {
  const el = a.el;
  if (!el) return;
  const frame = a.moving ? 1 + (Math.floor(a.stride / 10) % 8) : 0;
  el.style.transform = `translate3d(${Math.round((a.x - FRAME / 2) * scale)}px, ${Math.round((a.y - FEET) * scale)}px, 0)`;
  el.style.zIndex = String(Math.round(a.y));
  const guard = a.guard ? "1" : "0";
  if (el.dataset.guard !== guard) el.dataset.guard = guard;
  const sprite = el.firstElementChild as HTMLElement | null;
  if (sprite) sprite.style.backgroundPosition = `${-frame * FRAME * scale}px ${-a.dir * FRAME * scale}px`;
}
