"use server";

import { after } from "next/server";
import { randomInt } from "node:crypto";
import { sql } from "@/lib/db";
import { poke } from "@/lib/live";
import { sendToUser } from "@/lib/push";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";
import { leaveTable } from "@/lib/village-server";
import { canFound, joinPlanet, planetsFor } from "@/lib/planet-server";
import { outsideSpace } from "@/lib/village";
import { planetVillage, SPECIAL_LOOKS } from "@/components/village/world";
import {
  cleanCode,
  cleanLook,
  cleanPlanetName,
  cleanRehearsalLabel,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_MEMBERS,
  MAX_OWNED,
  MAX_PLANETS,
  MAX_REHEARSALS,
  type Planets,
} from "@/lib/planets";
import type { PlanetLook } from "@/components/village/world";

/* --------------------------------------------------------------------------
   Founding, joining and looking after planets (src/lib/planets.ts). Only a
   planet's owner can change it, invite to it or take anyone off it; anyone
   on it can leave. Every check is made here, whatever the page thinks.
   -------------------------------------------------------------------------- */

type Done = { ok: true; planets: Planets } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_SET_UP = "Planets aren't set up yet: run db/schema.sql in the Neon SQL Editor.";
const GONE = "That planet isn't there any more.";

const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const okId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

/** Runs a change and answers with the planets as they now are; a missing table says so. */
async function change(me: string, run: () => Promise<string | null>): Promise<Done> {
  try {
    const error = await run();
    return error ? { ok: false, error } : { ok: true, planets: await planetsFor(me) };
  } catch (e) {
    if (/relation .* does not exist/i.test(String(e))) return { ok: false, error: NOT_SET_UP };
    throw e;
  }
}

/** The planet, if I own it. */
async function ownedBy(me: string, id: number): Promise<{ id: number; name: string } | null> {
  if (!okId(id)) return null;
  const rows = (await sql`select id, name from planets where id = ${id} and owner_id = ${me}::uuid`) as { id: number; name: string }[];
  return rows[0] ?? null;
}

/** Off any table they're at on this planet, paid for the time. */
async function offTables(userIds: string[], id: number) {
  const seated = (await sql`
    select distinct m.user_id from session_members m join work_sessions s on s.id = m.session_id
     where m.left_at is null and s.village = ${planetVillage(id)} and m.user_id = any(${userIds}::uuid[])
  `) as { user_id: string }[];
  for (const s of seated) await leaveTable(s.user_id);
}

/** Everyone on the planet should look again: someone's come or gone. */
const stir = (id: number) => after(() => poke(outsideSpace(planetVillage(id))));

export async function loadPlanets(): Promise<Planets> {
  return planetsFor(await requireUserId());
}

export async function createPlanet(name: string, look: PlanetLook): Promise<Done> {
  const me = await requireUserId();
  const clean = cleanPlanetName(name);
  if (!clean) return { ok: false, error: "Give your planet a name." };
  if (await rateLimited("planet", me)) return { ok: false, error: TOO_MANY };
  return change(me, async () => {
    if (!(await canFound(me))) return "Founding planets isn't open to everyone yet. Ask to be invited to one instead.";
    const counts = (await sql`
      select (select count(*)::int from planets where owner_id = ${me}::uuid) as owned,
             (select count(*)::int from planet_members where user_id = ${me}::uuid) as joined
    `) as { owned: number; joined: number }[];
    if (counts[0].owned >= MAX_OWNED) return `You can found ${MAX_OWNED} planets. Close one of yours to start another.`;
    if (counts[0].joined >= MAX_PLANETS) return `You're on ${MAX_PLANETS} planets already. Leave one to start another.`;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const rows = (await sql`
          with p as (
            insert into planets (owner_id, name, look, code) values (${me}::uuid, ${clean}, ${cleanLook(look)}, ${newCode()})
            returning id
          )
          insert into planet_members (planet_id, user_id) select id, ${me}::uuid from p
          returning planet_id
        `) as { planet_id: number }[];
        const r = await joinPlanet(me, rows[0].planet_id);
        return r.ok ? null : r.error;
      } catch (e) {
        // The code was taken: roll another.
        if (!/planets_code_key|duplicate key/i.test(String(e))) throw e;
      }
    }
    return "Couldn't found it just now. Try again.";
  });
}

export async function updatePlanet(id: number, name: string, look: PlanetLook): Promise<Done> {
  const me = await requireUserId();
  const clean = cleanPlanetName(name);
  if (!clean) return { ok: false, error: "Give your planet a name." };
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can change it.";
    // A special look (world.ts, SPECIAL_LOOKS) stays: it can't be picked
    // again once it's gone.
    await sql`
      update planets set name = ${clean},
             look = case when look = any(${SPECIAL_LOOKS.map((l) => l.look)}::text[]) then look else ${cleanLook(look)} end
       where id = ${id} and owner_id = ${me}::uuid
    `;
    stir(id);
    return null;
  });
}

/** Asks a companion to my planet. They say yes or no from any station. */
export async function inviteToPlanet(id: number, friendId: string): Promise<Done> {
  const me = await requireUserId();
  if (!UUID.test(friendId) || friendId === me) return { ok: false, error: "That's not a companion of yours." };
  if (await rateLimited("planet", me)) return { ok: false, error: TOO_MANY };
  return change(me, async () => {
    const planet = await ownedBy(me, id);
    if (!planet) return "Only whoever founded a planet can invite people to it.";
    const check = (await sql`
      select are_friends(${me}::uuid, ${friendId}::uuid) as friends,
             exists (select 1 from planet_members where planet_id = ${id} and user_id = ${friendId}::uuid) as member,
             (select count(*)::int from planet_members where planet_id = ${id}) as members,
             (select display_name from profiles where id = ${me}::uuid) as my_name
    `) as { friends: boolean; member: boolean; members: number; my_name: string }[];
    const c = check[0];
    if (!c.friends) return "You can only invite companions. Anyone else can join with the planet's code.";
    if (c.member) return "They're on it already.";
    if (c.members >= MAX_MEMBERS) return "Your planet's full: every lot on it has a house.";
    const fresh = (await sql`
      insert into planet_invites (planet_id, user_id, invited_by) values (${id}, ${friendId}::uuid, ${me}::uuid)
      on conflict do nothing returning 1 as ok
    `) as unknown[];
    if (fresh.length)
      await sendToUser(friendId, {
        title: `${c.my_name} invited you to ${planet.name}`,
        body: "A private planet. Say yes from any station in the village, and take a rocket there.",
        url: "/village",
        tag: `planet-${id}`,
      }).catch(() => 0);
    return null;
  });
}

export async function cancelPlanetInvite(id: number, userId: string): Promise<Done> {
  const me = await requireUserId();
  if (!UUID.test(userId)) return { ok: false, error: "That invitation isn't there any more." };
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can do that.";
    await sql`delete from planet_invites where planet_id = ${id} and user_id = ${userId}::uuid`;
    return null;
  });
}

export async function answerPlanetInvite(id: number, accept: boolean): Promise<Done> {
  const me = await requireUserId();
  if (!okId(id)) return { ok: false, error: GONE };
  return change(me, async () => {
    const gone = (await sql`
      delete from planet_invites where planet_id = ${id} and user_id = ${me}::uuid returning 1 as ok
    `) as unknown[];
    if (!gone.length) return "That invitation isn't there any more.";
    if (!accept) return null;
    const r = await joinPlanet(me, id);
    if (!r.ok) return r.error;
    stir(id);
    return null;
  });
}

/** Joins whichever planet this code is for. */
export async function joinPlanetByCode(raw: string): Promise<Done & { joined?: number }> {
  const me = await requireUserId();
  const code = cleanCode(raw);
  // Limited before the lookup, so codes can't be guessed at speed.
  if (await rateLimited("planetCode", me)) return { ok: false, error: TOO_MANY };
  if (!code) return { ok: false, error: "A code is 8 letters and numbers, like ABCD-2345." };
  let joined: number | undefined;
  const r = await change(me, async () => {
    const rows = (await sql`select id from planets where code = ${code}`) as { id: number }[];
    if (!rows[0]) return "No planet has that code. Check it with whoever gave it to you.";
    const j = await joinPlanet(me, rows[0].id);
    if (!j.ok) return j.error;
    await sql`delete from planet_invites where planet_id = ${rows[0].id} and user_id = ${me}::uuid`;
    joined = rows[0].id;
    stir(rows[0].id);
    return null;
  });
  return r.ok ? { ...r, joined } : r;
}

/**
 * A weekly rehearsal on my planet, `minute` past midnight on `weekday`
 * (0 = Sunday), in timezone `tz` (the browser's, as an IANA name).
 */
export async function addRehearsal(id: number, weekday: number, minute: number, label: string, tz: string): Promise<Done> {
  const me = await requireUserId();
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(minute) || minute < 0 || minute > 1439)
    return { ok: false, error: "Pick a day and a time." };
  if (await rateLimited("planet", me)) return { ok: false, error: TOO_MANY };
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can set its rehearsals.";
    const n = (await sql`select count(*)::int as n from planet_rehearsals where planet_id = ${id}`) as { n: number }[];
    if (n[0].n >= MAX_REHEARSALS) return `A planet can have ${MAX_REHEARSALS} rehearsals a week. Take one off first.`;
    // A timezone Postgres doesn't know is UTC, as everywhere else.
    await sql`
      insert into planet_rehearsals (planet_id, weekday, minute, tz, label)
      values (${id}, ${weekday}, ${minute},
              coalesce((select name from pg_timezone_names where name = ${String(tz).slice(0, 64)} limit 1), 'UTC'),
              ${cleanRehearsalLabel(label) || "Rehearsal"})
    `;
    return null;
  });
}

export async function removeRehearsal(id: number, rehearsalId: number): Promise<Done> {
  const me = await requireUserId();
  if (!okId(rehearsalId)) return { ok: false, error: "That rehearsal isn't there any more." };
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can change its rehearsals.";
    await sql`delete from planet_rehearsals where id = ${rehearsalId} and planet_id = ${id}`;
    return null;
  });
}

/** A new code for my planet: the old one stops working. */
export async function newPlanetCode(id: number): Promise<Done> {
  const me = await requireUserId();
  if (await rateLimited("planet", me)) return { ok: false, error: TOO_MANY };
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can change its code.";
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await sql`update planets set code = ${newCode()} where id = ${id} and owner_id = ${me}::uuid`;
        return null;
      } catch (e) {
        if (!/planets_code_key|duplicate key/i.test(String(e))) throw e;
      }
    }
    return "Couldn't make a new code just now. Try again.";
  });
}

/** Takes someone off my planet. Their house there goes with them. */
export async function removeFromPlanet(id: number, userId: string): Promise<Done> {
  const me = await requireUserId();
  if (!UUID.test(userId) || userId === me) return { ok: false, error: "You can't take yourself off your own planet. Close it instead." };
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can take people off it.";
    await offTables([userId], id);
    await sql`delete from planet_members where planet_id = ${id} and user_id = ${userId}::uuid`;
    stir(id);
    return null;
  });
}

/** Leaves a planet I'm on (not my own: that one I close). My house there goes. */
export async function leavePlanet(id: number): Promise<Done> {
  const me = await requireUserId();
  if (!okId(id)) return { ok: false, error: GONE };
  return change(me, async () => {
    if (await ownedBy(me, id)) return "It's your planet: close it instead, from its page.";
    await offTables([me], id);
    await sql`delete from planet_members where planet_id = ${id} and user_id = ${me}::uuid`;
    stir(id);
    return null;
  });
}

/** Closes my planet for good: everyone's houses on it, and the planet itself. */
export async function closePlanet(id: number): Promise<Done> {
  const me = await requireUserId();
  return change(me, async () => {
    if (!(await ownedBy(me, id))) return "Only whoever founded a planet can close it.";
    const members = (await sql`select user_id from planet_members where planet_id = ${id}`) as { user_id: string }[];
    await offTables(
      members.map((m) => m.user_id),
      id
    );
    await sql`delete from planets where id = ${id} and owner_id = ${me}::uuid`;
    stir(id);
    return null;
  });
}
