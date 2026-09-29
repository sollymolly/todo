/* --------------------------------------------------------------------------
   Duel rules — pure, shared by the server (which decides) and the page
   (which explains and predicts). See live-hub.ts and village-rooms.ts.

   A duel is fought live, in the arena's ring:

     move    WASD or the arrow keys (fighters can't leave the ring)
     hit     H — lands on an opponent within reach that you're facing
     guard   hold G — blocks hits from the front, but you can't hit
             while guarding and you move at half speed

   Everyone has 5 health and every hit that lands takes 1. First to 0
   loses. If time runs out, whoever has more health left wins; level is
   a draw. Gear doesn't change the numbers: it's footwork and timing.

   The server decides every hit, from where each fighter's own screen last
   said they were standing — so both screens agree on what happened.
   -------------------------------------------------------------------------- */

export const DUEL_HP = 5;
export const INVITE_MS = 60_000;
/** From accepting to "Fight!": time to take your marks. */
export const COUNTDOWN_MS = 3_000;
/** How long the fight itself lasts at most. */
export const DUEL_MS = 90_000;
/** The quickest you can swing again. */
export const HIT_COOLDOWN_MS = 500;
/** How close, in tiles (feet to feet), a hit reaches. A little generous, for lag. */
export const REACH = 1.5;

/** 0 up, 1 left, 2 down, 3 right — the same order as the sprite rows. */
export type Facing = 0 | 1 | 2 | 3;
const AHEAD: [number, number][] = [
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
];

/** Is (dx, dy) in front of someone facing `f`? A wide cone: about ±70°. */
export function inFront(f: Facing, dx: number, dy: number): boolean {
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return true;
  const [fx, fy] = AHEAD[f];
  return (fx * dx + fy * dy) / d > 0.35;
}

/** Where a fighter stands (tiles), which way they face, and whether they guard. */
export type Stance = { x: number; y: number; f: Facing; g: boolean };

/** What a swing from `att` does to `def`. */
export function strike(att: Stance, def: Stance): "miss" | "blocked" | "hit" {
  if (att.g) return "miss";
  const dx = def.x - att.x;
  const dy = def.y - att.y;
  if (Math.hypot(dx, dy) > REACH || !inFront(att.f, dx, dy)) return "miss";
  if (def.g && inFront(def.f, -dx, -dy)) return "blocked";
  return "hit";
}

/** Who won once it's over: 'a', 'b', or 'draw'. */
export function judge(aHp: number, bHp: number): "a" | "b" | "draw" {
  if (aHp <= 0 && bHp <= 0) return "draw";
  if (aHp <= 0) return "b";
  if (bHp <= 0) return "a";
  return aHp === bHp ? "draw" : aHp > bHp ? "a" : "b";
}

/** When the fight proper starts, given when it ends. */
export const fightStartsAt = (endsAt: number) => endsAt - DUEL_MS;
