import { sql } from "@/lib/db";
import { levelFor } from "@/lib/game";
import { cleanHouse, type HouseLook, type Resident } from "@/lib/village";
import { cleanLook, MAX_MEMBERS, MAX_PLANETS, type PlanetInvite, type Planets, type PlanetView } from "@/lib/planets";
import { planetVillage, PLOTS_PER_VILLAGE } from "@/components/village/world";
import type { Appearance, Equipped } from "@/lib/types";
import { OWNER_EMAIL } from "@/lib/owner";

/* --------------------------------------------------------------------------
   Planets, the server side: who's on which, their houses there, and what
   the page is told. Server-only. See src/lib/planets.ts.

   Until db/schema.sql's planet tables exist, everything here answers as if
   nobody were on any planet, so the village works as it did.
   -------------------------------------------------------------------------- */

const missing = (e: unknown) => /relation .* does not exist/i.test(String(e));

async function orNone<T>(run: () => Promise<T>, none: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (missing(e)) return none;
    throw e;
  }
}

/**
 * May I found planets? For now only whoever runs this instance (OWNER_EMAIL)
 * can; anyone can be invited to one, or join with its code.
 */
export async function canFound(me: string): Promise<boolean> {
  const rows = (await sql`select 1 from users where id = ${me}::uuid and email = ${OWNER_EMAIL}`) as unknown[];
  return rows.length > 0;
}

/** The planets I'm on, by id. */
export async function planetIdsOf(me: string): Promise<number[]> {
  return orNone(async () => {
    const rows = (await sql`select planet_id from planet_members where user_id = ${me}::uuid`) as { planet_id: number }[];
    return rows.map((r) => r.planet_id);
  }, []);
}

export async function isMember(me: string, planetId: number): Promise<boolean> {
  if (!Number.isInteger(planetId) || planetId <= 0) return false;
  return orNone(async () => {
    const rows = (await sql`
      select 1 from planet_members where planet_id = ${planetId} and user_id = ${me}::uuid
    `) as unknown[];
    return rows.length > 0;
  }, false);
}

/**
 * A house for me on a planet I'm on, if I haven't one: on the free lot
 * nearest the town hall (lots are numbered from it outward). False if
 * there's no lot left.
 */
export async function ensurePlanetHouse(me: string, planetId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = (await sql`select user_id, slot from planet_houses where planet_id = ${planetId}`) as { user_id: string; slot: number }[];
    if (rows.some((r) => r.user_id === me)) return true;
    const taken = new Set(rows.map((r) => r.slot));
    let slot = 0;
    while (slot < PLOTS_PER_VILLAGE && taken.has(slot)) slot++;
    if (slot >= PLOTS_PER_VILLAGE) return false;
    try {
      await sql`
        insert into planet_houses (planet_id, user_id, slot) values (${planetId}, ${me}::uuid, ${slot})
        on conflict (planet_id, user_id) do nothing
      `;
      return true;
    } catch (e) {
      // Someone took that lot a moment ago: look again.
      if (!/planet_houses_slot_key|duplicate key/i.test(String(e))) throw e;
    }
  }
  return false;
}

/**
 * Puts me on a planet, with a house there. Anyone joining comes through
 * here, by invitation or by code; whether they may is for the caller.
 */
export async function joinPlanet(me: string, planetId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const counts = (await sql`
    select (select count(*)::int from planet_members where planet_id = ${planetId}) as members,
           (select count(*)::int from planet_members where user_id = ${me}::uuid) as mine,
           exists (select 1 from planet_members where planet_id = ${planetId} and user_id = ${me}::uuid) as already
  `) as { members: number; mine: number; already: boolean }[];
  const c = counts[0];
  if (!c.already) {
    if (c.members >= MAX_MEMBERS) return { ok: false, error: "That planet's full: every lot on it has a house." };
    if (c.mine >= MAX_PLANETS) return { ok: false, error: `You're on ${MAX_PLANETS} planets already. Leave one to join another.` };
    await sql`insert into planet_members (planet_id, user_id) values (${planetId}, ${me}::uuid) on conflict do nothing`;
  }
  if (await ensurePlanetHouse(me, planetId)) return { ok: true };
  await sql`delete from planet_members where planet_id = ${planetId} and user_id = ${me}::uuid and not exists (
    select 1 from planets where id = ${planetId} and owner_id = ${me}::uuid)`;
  return { ok: false, error: "That planet's full: every lot on it has a house." };
}

/** Everyone's house on the planets given, as residents of each planet's village. */
export async function planetResidents(planetIds: number[], known: Set<string>): Promise<Resident[]> {
  if (!planetIds.length) return [];
  return orNone(async () => {
    const rows = (await sql`
      select h.planet_id, h.user_id, h.slot, p.display_name, p.appearance, p.equipped, p.xp, h.style, h.roof, h.garden,
             coalesce((select max(b.streak)::int from habits b where b.user_id = h.user_id and b.active), 0) as streak
        from planet_houses h join profiles p on p.id = h.user_id
       where h.planet_id = any(${planetIds}::int[])
    `) as ({ planet_id: number; user_id: string; slot: number; display_name: string; appearance: Appearance; equipped: Equipped; xp: number; streak: number } & HouseLook)[];
    return rows.map((r) => {
      const level = levelFor(r.xp);
      return {
        id: r.user_id,
        name: r.display_name,
        appearance: r.appearance,
        equipped: r.equipped,
        plot: planetVillage(r.planet_id) * PLOTS_PER_VILLAGE + r.slot,
        level,
        streak: r.streak,
        house: cleanHouse(r, level),
        known: known.has(r.user_id),
      };
    });
  }, []);
}

/** Changes whenever anyone gets a house on a planet, moves it, or leaves (Pulse.plotsAt). */
export async function planetHousesVersion(): Promise<string> {
  return orNone(async () => {
    const rows = (await sql`select count(*)::int as n, max(slot_at) as at from planet_houses`) as { n: number; at: unknown }[];
    const at = rows[0]?.at;
    return `${rows[0]?.n ?? 0}:${at instanceof Date ? at.getTime() : at ? new Date(String(at)).getTime() : 0}`;
  }, "");
}

/** The planets I'm on, and the invitations waiting for me. */
export async function planetsFor(me: string): Promise<Planets> {
  return orNone(
    async () => {
      const rows = (await sql`
        select p.id, p.name, p.look, p.code, p.owner_id, o.display_name as owner_name
          from planets p
          join planet_members m on m.planet_id = p.id and m.user_id = ${me}::uuid
          join profiles o on o.id = p.owner_id
         order by p.created_at
      `) as { id: number; name: string; look: string; code: string; owner_id: string; owner_name: string }[];
      const ids = rows.map((r) => r.id);
      const owned = rows.filter((r) => r.owner_id === me).map((r) => r.id);
      const [members, invited, invites, founder] = await Promise.all([
        sql`
          select m.planet_id, m.user_id, p.display_name from planet_members m join profiles p on p.id = m.user_id
           where m.planet_id = any(${ids}::int[]) order by m.joined_at
        ` as unknown as Promise<{ planet_id: number; user_id: string; display_name: string }[]>,
        sql`
          select i.planet_id, i.user_id, p.display_name from planet_invites i join profiles p on p.id = i.user_id
           where i.planet_id = any(${owned}::int[]) order by i.created_at
        ` as unknown as Promise<{ planet_id: number; user_id: string; display_name: string }[]>,
        sql`
          select i.planet_id, p.name, p.look, f.display_name as from_name,
                 (select count(*)::int from planet_members m where m.planet_id = p.id) as members
            from planet_invites i
            join planets p on p.id = i.planet_id
            join profiles f on f.id = i.invited_by
           where i.user_id = ${me}::uuid
           order by i.created_at desc
        ` as unknown as Promise<{ planet_id: number; name: string; look: string; from_name: string; members: number }[]>,
        canFound(me),
      ]);
      const planets: PlanetView[] = rows.map((r) => {
        const mine = r.owner_id === me;
        return {
          id: r.id,
          v: planetVillage(r.id),
          name: r.name,
          look: cleanLook(r.look),
          owner: { id: r.owner_id, name: r.owner_name },
          code: mine ? r.code : null,
          members: members.filter((m) => m.planet_id === r.id).map((m) => ({ id: m.user_id, name: m.display_name })),
          invited: mine ? invited.filter((m) => m.planet_id === r.id).map((m) => ({ id: m.user_id, name: m.display_name })) : [],
        };
      });
      return {
        planets,
        canFound: founder,
        invites: invites
          .filter((i) => !ids.includes(i.planet_id))
          .map((i): PlanetInvite => ({ planetId: i.planet_id, name: i.name, look: cleanLook(i.look), from: i.from_name, members: i.members })),
      };
    },
    { planets: [], invites: [], canFound: false }
  );
}
