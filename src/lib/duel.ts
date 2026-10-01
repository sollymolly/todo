/* --------------------------------------------------------------------------
   Duel rules — pure, shared by the server (which decides) and the page
   (which explains and predicts). See live-hub.ts and village-rooms.ts.

   A duel is fought live, in the arena's ring:

     move    WASD or the arrow keys (fighters can't leave the ring)
     hit     H — lands on an opponent within reach, whichever way
             you're facing (you turn to swing at them)
     guard   hold G — blocks hits from any direction; you move at half
             speed and can't hit

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
/**
 * How long the server waits before judging a swing, so a guard raised at
 * the same moment — still on its way from the other fighter — counts.
 */
export const HIT_GRACE_MS = 150;
/** How close, in tiles (feet to feet), a hit reaches. A little generous, for lag. */
export const REACH = 1.5;

/** 0 up, 1 left, 2 down, 3 right — the same order as the sprite rows. */
export type Facing = 0 | 1 | 2 | 3;

/** Which way to face to look at something (dx, dy) away. */
export function facingToward(dx: number, dy: number): Facing {
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : dy < 0 ? 0 : 2;
}

/** Where a fighter stands (tiles), which way they face, and whether they guard. */
export type Stance = { x: number; y: number; f: Facing; g: boolean };

/**
 * What a swing from `att` does to `def`. All the way round: a swing reaches
 * whichever side they're on, and a guard covers every side.
 */
export function strike(att: Stance, def: Stance): "miss" | "blocked" | "hit" {
  if (att.g) return "miss";
  if (Math.hypot(def.x - att.x, def.y - att.y) > REACH) return "miss";
  if (def.g) return "blocked";
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
