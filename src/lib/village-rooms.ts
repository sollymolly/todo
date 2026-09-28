import { sql } from "@/lib/db";
import { judge, MAX_ROUNDS, resolveRound, type Move } from "@/lib/duel";
import type { Appearance, Equipped } from "@/lib/types";
import type { ChatLine, DuelView, Place, Pos, RoomPerson } from "@/lib/village";

/* --------------------------------------------------------------------------
   Shared rooms, talk and duels — the server side. Used by
   the check-in (village-server.ts) and the actions (village-actions.ts).

   Who's visible where:
     inside a house   everyone in it, whoever they are — a companion's
                      friends meet at their place, like a table at the hall.
                      Getting in at all takes being the owner's companion.
     the arena        your companions, and whoever is duelling one of them.
     the town hall    talk from your companions only.
   Strangers are only ever a knight and a name.
   -------------------------------------------------------------------------- */

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));
const ONLINE = "45 seconds";
const MOVES = new Set(["strike", "guard", "feint"]);

/* --------------------------------------------------------------- rooms */

/** Everyone in my shared room but me, with where they stand. */
export async function roomPeople(me: string, place: Place, known: Set<string>): Promise<RoomPerson[]> {
  type Row = { user_id: string; x: number | null; y: number | null; facing: number | null; display_name: string; appearance: Appearance; equipped: Equipped };
  let rows: Row[] = [];
  if (place.kind === "inside") {
    rows = (await sql`
      select v.user_id, v.x, v.y, v.facing, p.display_name, p.appearance, p.equipped
        from village_presence v join profiles p on p.id = v.user_id
       where v.place = 'inside' and v.host_id = ${place.hostId}::uuid
         and v.seen_at > now() - ${ONLINE}::interval and v.user_id <> ${me}::uuid
    `) as Row[];
  } else if (place.kind === "arena") {
    // Companions, plus anyone in a live duel with a companion.
    rows = (await sql`
      select v.user_id, v.x, v.y, v.facing, p.display_name, p.appearance, p.equipped
        from village_presence v join profiles p on p.id = v.user_id
       where v.place = 'arena' and v.seen_at > now() - ${ONLINE}::interval and v.user_id <> ${me}::uuid
         and (v.user_id = any(${[...known]}::uuid[])
              or exists (select 1 from duels d
                          where d.status in ('pending', 'active')
                            and ((d.a_id = v.user_id and d.b_id = any(${[...known]}::uuid[]))
                              or (d.b_id = v.user_id and d.a_id = any(${[...known]}::uuid[])))))
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

/** Store where I am. Inside a house only if it's mine or a companion's. */
export async function touchRoomPresence(me: string, place: Place, pos: Pos | null, known: Set<string>): Promise<boolean> {
  if (place.kind === "inside" && !known.has(place.hostId)) return false;
  await sql`
    insert into village_presence (user_id, place, host_id, x, y, facing, seen_at)
    values (${me}::uuid, ${place.kind}, ${place.kind === "inside" ? place.hostId : null}::uuid,
            ${pos?.x ?? null}, ${pos?.y ?? null}, ${pos?.facing ?? null}, now())
    on conflict (user_id) do update set
      place = excluded.place, host_id = excluded.host_id,
      x = excluded.x, y = excluded.y, facing = excluded.facing, seen_at = now()
  `;
  return true;
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
    select place, host_id from village_presence
     where user_id = ${me}::uuid and seen_at > now() - ${ONLINE}::interval
  `) as { place: string; host_id: string | null }[];
  const r = rows[0];
  if (!r) return false;
  if (space === "arena" || space === "hall") return r.place === space;
  return r.place === "inside" && `inside:${r.host_id}` === space;
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
  a_atk: number | null;
  b_atk: number | null;
  a_def: number | null;
  b_def: number | null;
  round: number;
  a_move: Move | null;
  b_move: Move | null;
  round_ends: unknown;
  winner: string | null;
  log: { r: number; a: Move | null; b: Move | null; ad: number; bd: number }[];
  created_at: unknown;
  updated_at: unknown;
};

export async function duelById(id: string): Promise<DuelRow | null> {
  const rows = (await sql`
    select d.id, d.a_id, d.b_id, pa.display_name as a_name, pb.display_name as b_name, d.status,
           d.a_hp, d.b_hp, d.a_max, d.b_max, d.a_atk, d.b_atk, d.a_def, d.b_def,
           d.round, d.a_move, d.b_move, d.round_ends, d.winner, d.log, d.created_at, d.updated_at
      from duels d join profiles pa on pa.id = d.a_id join profiles pb on pb.id = d.b_id
     where d.id = ${id}::uuid
  `) as DuelRow[];
  return rows[0] ?? null;
}

/**
 * Resolves the current round if both have picked or its time is up, and
 * expires an invitation nobody answered. Safe to call from any check-in:
 * the update only lands if the round is still the one it read, so two
 * callers can't both resolve it.
 */
export async function advanceDuel(d: DuelRow): Promise<DuelRow> {
  const now = Date.now();
  if (d.status === "pending" && now - ms(d.created_at) > 60_000) {
    await sql`update duels set status = 'expired', updated_at = now() where id = ${d.id}::uuid and status = 'pending'`;
    return (await duelById(d.id)) ?? d;
  }
  if (d.status !== "active") return d;
  const due = d.round_ends ? ms(d.round_ends) <= now : false;
  if (!(d.a_move && d.b_move) && !due) return d;

  const a = { hp: d.a_hp!, max: d.a_max!, atk: d.a_atk!, def: d.a_def! };
  const b = { hp: d.b_hp!, max: d.b_max!, atk: d.b_atk!, def: d.b_def! };
  const { ad, bd } = resolveRound(a, b, d.a_move, d.b_move);
  const aHp = Math.max(0, a.hp - ad);
  const bHp = Math.max(0, b.hp - bd);
  const entry = { r: d.round, a: d.a_move, b: d.b_move, ad, bd };
  const over = aHp <= 0 || bHp <= 0 || d.round >= MAX_ROUNDS;
  const verdict = over ? judge(aHp, a.max, bHp, b.max) : null;
  const winner = verdict === "a" ? d.a_id : verdict === "b" ? d.b_id : null;

  await sql`
    update duels set
      a_hp = ${aHp}, b_hp = ${bHp},
      log = log || ${JSON.stringify([entry])}::jsonb,
      a_move = null, b_move = null,
      round = case when ${over} then round else round + 1 end,
      round_ends = case when ${over} then null else now() + interval '15 seconds' end,
      status = case when ${over} then 'done' else status end,
      winner = ${winner}::uuid,
      updated_at = now()
     where id = ${d.id}::uuid and status = 'active' and round = ${d.round}
  `;
  return (await duelById(d.id)) ?? d;
}

export function viewDuel(d: DuelRow, me: string): DuelView {
  const last = d.log.length ? d.log[d.log.length - 1] : null;
  return {
    id: d.id,
    a: { id: d.a_id, name: d.a_name },
    b: { id: d.b_id, name: d.b_name },
    status: d.status,
    round: d.round,
    roundEndsAt: d.round_ends ? ms(d.round_ends) : null,
    createdAt: ms(d.created_at),
    hp: d.a_max != null ? { a: d.a_hp!, b: d.b_hp!, aMax: d.a_max!, bMax: d.b_max! } : null,
    picked: { a: !!d.a_move, b: !!d.b_move },
    myMove: me === d.a_id ? d.a_move : me === d.b_id ? d.b_move : null,
    last,
    winner: d.winner,
  };
}

/**
 * Duels to show: mine that are open or just finished, and — in the arena —
 * companions' duels. Each is moved on first if it's due.
 */
export async function duelsFor(me: string, inArena: boolean, known: Set<string>): Promise<DuelView[]> {
  const ids = [...known];
  const rows = (await sql`
    select d.id, d.a_id, d.b_id, pa.display_name as a_name, pb.display_name as b_name, d.status,
           d.a_hp, d.b_hp, d.a_max, d.b_max, d.a_atk, d.b_atk, d.a_def, d.b_def,
           d.round, d.a_move, d.b_move, d.round_ends, d.winner, d.log, d.created_at, d.updated_at
      from duels d join profiles pa on pa.id = d.a_id join profiles pb on pb.id = d.b_id
     where (d.status in ('pending', 'active') or d.updated_at > now() - interval '20 seconds')
       and (d.a_id = ${me}::uuid or d.b_id = ${me}::uuid
            or (${inArena} and (d.a_id = any(${ids}::uuid[]) or d.b_id = any(${ids}::uuid[]))))
     order by d.created_at desc
     limit 10
  `) as DuelRow[];
  const out: DuelView[] = [];
  for (const r of rows) out.push(viewDuel(await advanceDuel(r), me));
  return out;
}

export function isMove(m: unknown): m is Move {
  return typeof m === "string" && MOVES.has(m);
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
