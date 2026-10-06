import { after } from "next/server";
import { sql } from "@/lib/db";
import { fightStartsAt, INVITE_MS, judge, strike, type Facing, type Stance } from "@/lib/duel";
import { poke } from "@/lib/live";
import type { Appearance, Equipped } from "@/lib/types";
import { arenaSpace, insideSpace, readSpace, type ChatLine, type DuelView, type Place, type RoomPerson } from "@/lib/village";
import { houseWorld, PLANET_BASE } from "@/components/village/world";

/* --------------------------------------------------------------------------
   Shared rooms, talk and duels — the server side. Used by
   the check-in (village-server.ts) and the actions (village-actions.ts).

   Who's visible where:
     inside a house   everyone in it, whoever they are — a companion's
                      friends meet at their place, like a table at the hall.
                      Getting in at all takes being the owner's companion.
     the arena        everyone there, and the fight going on — strangers
                      as a knight and a name. One duel at a time.
     the town hall    talk from your companions only.
   Strangers are only ever a knight and a name.
   -------------------------------------------------------------------------- */

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));
/** ONLINE_MS (village.ts), for SQL. */
export const ONLINE = "45 seconds";

/* --------------------------------------------------------------- rooms */

/** Everyone in my shared room but me, with where they stand. */
export async function roomPeople(me: string, place: Place, known: Set<string>, village: number): Promise<RoomPerson[]> {
  type Row = { user_id: string; x: number | null; y: number | null; facing: number | null; display_name: string; appearance: Appearance; equipped: Equipped };
  let rows: Row[] = [];
  if (place.kind === "inside") {
    // The house they have in every public village, or the one on this planet.
    const world = houseWorld(village);
    rows = (await sql`
      select v.user_id, v.x, v.y, v.facing, p.display_name, p.appearance, p.equipped
        from village_presence v join profiles p on p.id = v.user_id
       where v.place = 'inside' and v.host_id = ${place.hostId}::uuid
         and (case when ${world}::int = 0 then v.village < ${PLANET_BASE} else v.village = ${world}::int end)
         and v.seen_at > now() - ${ONLINE}::interval and v.user_id <> ${me}::uuid
    `) as Row[];
  } else if (place.kind === "arena" || place.kind === "library" || place.kind === "store" || place.kind === "bakery") {
    // Everyone in this village's arena (or library, store or bakery). Strangers
    // come back marked as such (known = false) and show as a knight and a name.
    rows = (await sql`
      select v.user_id, v.x, v.y, v.facing, p.display_name, p.appearance, p.equipped
        from village_presence v join profiles p on p.id = v.user_id
       where v.place = ${place.kind} and v.village = ${village}
         and v.seen_at > now() - ${ONLINE}::interval and v.user_id <> ${me}::uuid
    `) as Row[];
  }
  return rows.map((r) => ({
    villager: { id: r.user_id, name: r.display_name, appearance: r.appearance, equipped: r.equipped },
    known: known.has(r.user_id),
    x: r.x ?? 0,
    y: r.y ?? 0,
    facing: ((r.facing ?? 2) % 4) as 0 | 1 | 2 | 3,
  }));
}

/* ---------------------------------------------------------------- talk */

/** The last few minutes said in a space, as this viewer may hear it. */
export async function spaceChat(space: string, known: Set<string>): Promise<ChatLine[]> {
  const rows = (await sql`
    select c.id, c.author_id, p.display_name, c.body, c.created_at
      from space_chat c join profiles p on p.id = c.author_id
     where c.space = ${space} and c.created_at > now() - interval '3 minutes'
     order by c.created_at desc
     limit 30
  `) as { id: string; author_id: string; display_name: string; body: string; created_at: unknown }[];
  const open = space.startsWith("inside:");
  return rows
    .filter((r) => open || known.has(r.author_id))
    .reverse()
    .map((r) => ({ id: r.id, authorId: r.author_id, name: r.display_name, body: r.body, at: ms(r.created_at) }));
}

/** Am I in this space right now? Talking there takes being there. */
export async function inSpace(me: string, space: string): Promise<boolean> {
  const rows = (await sql`
    select place, host_id, village from village_presence
     where user_id = ${me}::uuid and seen_at > now() - ${ONLINE}::interval
  `) as { place: string; host_id: string | null; village: number }[];
  const r = rows[0];
  const s = readSpace(space);
  if (!r || !s) return false;
  if (s.kind === "inside") return r.place === "inside" && !!r.host_id && insideSpace(r.host_id, r.village) === space;
  return r.place === s.kind && r.village === s.village;
}

/* --------------------------------------------------------------- duels */

type DuelRow = {
  id: string;
  a_id: string;
  b_id: string;
  a_name: string;
  b_name: string;
  status: DuelView["status"];
  a_hp: number | null;
  b_hp: number | null;
  a_max: number | null;
  b_max: number | null;
  /* When the fight ends; it starts DUEL_MS before. */
  round_ends: unknown;
  /* Whose arena it's in. */
  village: number;
  winner: string | null;
  created_at: unknown;
  updated_at: unknown;
};

export async function duelById(id: string): Promise<DuelRow | null> {
  const rows = (await sql`
    select d.id, d.a_id, d.b_id, pa.display_name as a_name, pb.display_name as b_name, d.status,
           d.a_hp, d.b_hp, d.a_max, d.b_max, d.round_ends, d.village, d.winner, d.created_at, d.updated_at
      from duels d join profiles pa on pa.id = d.a_id join profiles pb on pb.id = d.b_id
     where d.id = ${id}::uuid
  `) as DuelRow[];
  return rows[0] ?? null;
}

/**
 * Finishes what time has decided: an invitation nobody answered, or a fight
 * whose clock ran out (more health left wins; level is a draw). Safe from
 * any check-in: each update only lands on the state it read.
 */
export async function advanceDuel(d: DuelRow): Promise<DuelRow> {
  const now = Date.now();
  if (d.status === "pending" && now - ms(d.created_at) > INVITE_MS) {
    await sql`update duels set status = 'expired', updated_at = now() where id = ${d.id}::uuid and status = 'pending'`;
    after(() => poke(arenaSpace(d.village)));
    return (await duelById(d.id)) ?? d;
  }
  if (d.status !== "active" || !d.round_ends || ms(d.round_ends) > now) return d;

  const verdict = judge(d.a_hp ?? 0, d.b_hp ?? 0);
  const winner = verdict === "a" ? d.a_id : verdict === "b" ? d.b_id : null;
  await sql`
    update duels set status = 'done', winner = ${winner}::uuid, round_ends = null, updated_at = now()
     where id = ${d.id}::uuid and status = 'active'
  `;
  // Settled by whichever check-in noticed the clock; everyone watching
  // should see it now too.
  after(() => poke(arenaSpace(d.village)));
  return (await duelById(d.id)) ?? d;
}

export function viewDuel(d: DuelRow): DuelView {
  const ends = d.status === "active" && d.round_ends ? ms(d.round_ends) : null;
  return {
    id: d.id,
    a: { id: d.a_id, name: d.a_name },
    b: { id: d.b_id, name: d.b_name },
    status: d.status,
    startsAt: ends ? fightStartsAt(ends) : null,
    endsAt: ends,
    createdAt: ms(d.created_at),
    hp: d.a_max != null ? { a: d.a_hp!, b: d.b_hp!, aMax: d.a_max!, bMax: d.b_max! } : null,
    winner: d.winner,
  };
}

/**
 * Duels to show: mine that are open or just finished, and — in an arena
 * (`arena`: which village's) — the fight going on there, whoever's in it.
 * Each is moved on first if due.
 */
export async function duelsFor(me: string, arena: number | null): Promise<DuelView[]> {
  const rows = (await sql`
    select d.id, d.a_id, d.b_id, pa.display_name as a_name, pb.display_name as b_name, d.status,
           d.a_hp, d.b_hp, d.a_max, d.b_max, d.round_ends, d.village, d.winner, d.created_at, d.updated_at
      from duels d join profiles pa on pa.id = d.a_id join profiles pb on pb.id = d.b_id
     where (d.status in ('pending', 'active') or d.updated_at > now() - interval '20 seconds')
       and (d.a_id = ${me}::uuid or d.b_id = ${me}::uuid
            or (d.village = ${arena ?? -1} and d.status <> 'pending'))
     order by d.created_at desc
     limit 10
  `) as DuelRow[];
  const out: DuelView[] = [];
  for (const r of rows) out.push(viewDuel(await advanceDuel(r)));
  return out;
}

export type HitResult =
  | { kind: "hit"; duelId: string; target: string; a: number; b: number; over: boolean }
  | { kind: "blocked"; target: string }
  | { kind: "miss" };

/** Where people in the arena last checked in: the fallback for a stance. */
async function arenaStances(ids: string[]): Promise<Map<string, Stance>> {
  const rows = (await sql`
    select user_id, x, y, facing from village_presence
     where user_id = any(${ids}::uuid[]) and place = 'arena' and x is not null and y is not null
  `) as { user_id: string; x: number; y: number; facing: number | null }[];
  return new Map(rows.map((r) => [r.user_id, { x: r.x, y: r.y, f: ((r.facing ?? 2) % 4) as Facing, g: false }]));
}

/**
 * A swing by `me`, judged from where each fighter's own screen last had
 * them (`stanceOf`, from the live connection; the check-in as a fallback).
 * Every hit takes 1; the one that takes the last ends it.
 */
export async function landHit(me: string, stanceOf: (id: string) => Stance | null): Promise<HitResult> {
  const rows = (await sql`
    select id, a_id, b_id, round_ends from duels
     where status = 'active' and (a_id = ${me}::uuid or b_id = ${me}::uuid) and round_ends > now()
     limit 1
  `) as { id: string; a_id: string; b_id: string; round_ends: unknown }[];
  const d = rows[0];
  if (!d || Date.now() < fightStartsAt(ms(d.round_ends))) return { kind: "miss" };
  const other = d.a_id === me ? d.b_id : d.a_id;

  let att = stanceOf(me);
  let def = stanceOf(other);
  if (!att || !def) {
    const seen = await arenaStances([me, other]);
    att ??= seen.get(me) ?? null;
    def ??= seen.get(other) ?? null;
  }
  if (!att || !def) return { kind: "miss" };

  const result = strike(att, def);
  if (result === "miss") return { kind: "miss" };
  if (result === "blocked") return { kind: "blocked", target: other };

  const hit = (await sql`
    update duels set
      a_hp = case when b_id = ${me}::uuid then greatest(a_hp - 1, 0) else a_hp end,
      b_hp = case when a_id = ${me}::uuid then greatest(b_hp - 1, 0) else b_hp end,
      updated_at = now()
     where id = ${d.id}::uuid and status = 'active' and round_ends > now()
    returning a_hp, b_hp
  `) as { a_hp: number; b_hp: number }[];
  if (!hit.length) return { kind: "miss" };
  const { a_hp: a, b_hp: b } = hit[0];
  const over = a <= 0 || b <= 0;
  if (over)
    await sql`
      update duels set status = 'done', winner = ${me}::uuid, round_ends = null, updated_at = now()
       where id = ${d.id}::uuid and status = 'active'
    `;
  return { kind: "hit", duelId: d.id, target: other, a, b, over };
}

/** Wins and losses, per person. */
export async function duelRecords(ids: string[]): Promise<Map<string, { wins: number; losses: number }>> {
  const rows = (await sql`
    select u.id,
           (select count(*)::int from duels d where d.status = 'done' and d.winner = u.id) as wins,
           (select count(*)::int from duels d
             where d.status = 'done' and d.winner is not null and d.winner <> u.id
               and (d.a_id = u.id or d.b_id = u.id)) as losses
      from unnest(${ids}::uuid[]) as u(id)
  `) as { id: string; wins: number; losses: number }[];
  return new Map(rows.map((r) => [r.id, { wins: r.wins, losses: r.losses }]));
}
