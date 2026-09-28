import { findItem } from "@/lib/game";
import type { Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   Duel rules — pure, shared by the server (which decides) and the page
   (which explains). See migration 027.

   Every round both fighters choose at once:

       strike  beats  feint     (the feint opens you up; the strike lands)
       guard   beats  strike    (the blow is caught, and answered)
       feint   beats  guard     (you slip round the guard)

   Same move: two strikes trade half-blows; two guards or two feints, nothing.
   Choosing nothing before the round's time runs out is hesitating: any move
   beats it, at full strength (a guard against it does nothing).

   Gear sets the numbers, gently, so a better-geared knight has an edge but
   reading your opponent still wins duels:
       health   60 + armour level ÷ 2        (60–70)
       attack   9 + weapon level ÷ 7         (9–11)
       guard    4 + off-hand level ÷ 5       (4–7), what a caught blow costs them

   Tuned by simulation: with both sides choosing at random, a brand-new
   knight still beats a fully geared one about a quarter of the time, and
   an even match is a coin toss. Choosing well matters more than gear.

   A duel ends when someone falls to 0, someone yields, or after 12 rounds
   (then the one with more health left, as a share of their total, wins).
   -------------------------------------------------------------------------- */

export type Move = "strike" | "guard" | "feint";
export const MOVES: { move: Move; label: string; beats: Move; hint: string }[] = [
  { move: "strike", label: "Strike", beats: "feint", hint: "Beats a feint. Caught by a guard." },
  { move: "guard", label: "Guard", beats: "strike", hint: "Catches a strike. Fooled by a feint." },
  { move: "feint", label: "Feint", beats: "guard", hint: "Slips a guard. Punished by a strike." },
];

export const ROUND_MS = 15_000;
export const INVITE_MS = 60_000;
export const MAX_ROUNDS = 12;

export type Fighter = { hp: number; max: number; atk: number; def: number };

const levelOf = (slot: "torso" | "weapon" | "offhand", id: string | undefined) =>
  (id && findItem(slot, id)?.level) || 1;

export function statsFor(equipped: Equipped): Fighter {
  const max = 60 + Math.floor(levelOf("torso", equipped.torso) / 2);
  return {
    hp: max,
    max,
    atk: 9 + Math.floor(levelOf("weapon", equipped.weapon) / 7),
    def: equipped.offhand && equipped.offhand !== "none" ? 4 + Math.floor(levelOf("offhand", equipped.offhand) / 5) : 4,
  };
}

/** Damage each side takes this round. `null` is hesitating. */
export function resolveRound(
  a: Fighter,
  b: Fighter,
  am: Move | null,
  bm: Move | null
): { ad: number; bd: number } {
  // What `x` does to its opponent when `x` wins with move `m`.
  const hit = (x: Fighter, m: Move) => (m === "strike" ? x.atk : m === "feint" ? Math.round(x.atk * 0.8) : x.def);

  if (!am && !bm) return { ad: 0, bd: 0 };
  if (!am) return { ad: bm === "guard" ? 0 : hit(b, bm!), bd: 0 };
  if (!bm) return { ad: 0, bd: am === "guard" ? 0 : hit(a, am) };
  if (am === bm) {
    const half = am === "strike";
    return { ad: half ? Math.round(b.atk / 2) : 0, bd: half ? Math.round(a.atk / 2) : 0 };
  }
  const aWins = MOVES.find((m) => m.move === am)!.beats === bm;
  return aWins ? { ad: 0, bd: hit(a, am) } : { ad: hit(b, bm), bd: 0 };
}

/** Who won, once it's over: 'a', 'b', or 'draw'. */
export function judge(aHp: number, aMax: number, bHp: number, bMax: number): "a" | "b" | "draw" {
  if (aHp <= 0 && bHp <= 0) return "draw";
  if (aHp <= 0) return "b";
  if (bHp <= 0) return "a";
  const ra = aHp / aMax;
  const rb = bHp / bMax;
  return Math.abs(ra - rb) < 1e-9 ? "draw" : ra > rb ? "a" : "b";
}

/** A line for what happened in a round, from one fighter's side. */
export function describeRound(me: Move | null, them: Move | null, meTook: number, themTook: number): string {
  const say = (m: Move | null) => (m ? MOVES.find((x) => x.move === m)!.label.toLowerCase() : "hesitate");
  const what = `You ${say(me)}${me ? "" : "d"}, they ${say(them)}${them ? "" : "d"}.`;
  if (!meTook && !themTook) return `${what} Nothing lands.`;
  if (meTook && themTook) return `${what} You trade blows: −${meTook} / −${themTook}.`;
  return themTook ? `${what} You land it: −${themTook}.` : `${what} You take −${meTook}.`;
}
