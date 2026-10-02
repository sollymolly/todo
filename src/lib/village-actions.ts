"use server";

import { after } from "next/server";
import { sql } from "@/lib/db";
import { levelFor } from "@/lib/game";
import { poke } from "@/lib/live";
import { requireUserId } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { sendToUser } from "@/lib/push";
import { friendIdsOf, leaveTable, residents, villageCount } from "@/lib/village-server";
import { villageOf } from "@/components/village/world";
import { duelById, inSpace } from "@/lib/village-rooms";
import { cleanInterior, defaultInterior, type Interior } from "@/lib/furniture";
import { coinsLeft, goodById, XP_PER_COIN } from "@/lib/shop";
import { treatById } from "@/lib/bakery";
import { COUNTDOWN_MS, DUEL_HP, DUEL_MS, INVITE_MS } from "@/lib/duel";
import {
  cleanHouse,
  cleanLine,
  NOTE_MAX,
  NUDGE_EVERY_MS,
  arenaSpace,
  NUDGE_MAX,
  outsideSpace,
  readSpace,
  SAY_MAX,
  tierFor,
  type HouseLook,
  type Resident,
  type Tier,
} from "@/lib/village";

/* --------------------------------------------------------------------------
   What you can do in the village. Every statement is scoped
   by user_id; anything touching another person checks the friendship first,
   on the server, whatever the page thinks.
   -------------------------------------------------------------------------- */

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function areFriends(a: string, b: string): Promise<boolean> {
  if (!UUID.test(b) || a === b) return false;
  const rows = (await sql`select are_friends(${a}::uuid, ${b}::uuid) as ok`) as { ok: boolean }[];
  return !!rows[0]?.ok;
}

/* ------------------------------------------------------------------ house */

export async function saveHouse(look: HouseLook): Promise<HouseLook> {
  const me = await requireUserId();
  const rows = (await sql`select xp from profiles where id = ${me}::uuid`) as { xp: number }[];
  const clean = cleanHouse(look, levelFor(rows[0]?.xp ?? 0), await owned(me));
  await sql`
    insert into houses (user_id, style, roof, garden, updated_at)
    values (${me}::uuid, ${clean.style}, ${clean.roof}, ${clean.garden}, now())
    on conflict (user_id) do update set
      style = excluded.style, roof = excluded.roof, garden = excluded.garden, updated_at = now()
  `;
  return clean;
}

/** Everyone's house, for redrawing the village after someone arrives or moves. */
export async function loadResidents(): Promise<Resident[]> {
  const me = await requireUserId();
  return residents(new Set([me, ...(await friendIdsOf(me))]));
}

/** Moves my house to an empty lot. My rooms come with me. */
export async function moveHouse(plot: number): Promise<Result> {
  const me = await requireUserId();
  // Any empty lot in any village there is; a new village opens by itself
  // when the last one fills (village-server.ts, ensurePlot).
  if (!Number.isInteger(plot) || plot < 0 || villageOf(plot) >= (await villageCount())) return { ok: false, error: "That's not a lot." };
  try {
    const moved = (await sql`
      update houses set plot = ${plot}, plot_at = now() where user_id = ${me}::uuid and plot is not null returning plot
    `) as { plot: number }[];
    if (!moved.length) return { ok: false, error: "Open the village first: that's where your house is." };
  } catch (e) {
    if (/houses_plot_key|duplicate key/i.test(String(e))) return { ok: false, error: "Someone's just moved in there." };
    throw e;
  }
  after(() => poke(outsideSpace(villageOf(plot))));
  return { ok: true };
}

/** Which village I'm in, as my last check-in had it. */
async function myVillage(me: string): Promise<number> {
  const rows = (await sql`select village from village_presence where user_id = ${me}::uuid`) as { village: number }[];
  return rows[0]?.village ?? 0;
}

/* ------------------------------------------------------------------ store */

/** Everything I've bought to keep (src/lib/shop.ts). */
async function owned(me: string): Promise<Set<string>> {
  const rows = (await sql`select item from purchases where user_id = ${me}::uuid`) as { item: string }[];
  return new Set(rows.map((r) => r.item));
}

export type ShopState = { coins: number; owned: string[]; freezes: number };

/** My coins, what I own, and how many freezes I've bought and not yet used. */
export async function loadShop(): Promise<ShopState> {
  const me = await requireUserId();
  const rows = (await sql`
    select xp, coins_spent,
           streak_freezes_left(id, (now() at time zone coalesce(timezone, 'UTC'))::date) as freezes
      from profiles where id = ${me}::uuid
  `) as { xp: number; coins_spent: number; freezes: number }[];
  const r = rows[0];
  return { coins: coinsLeft(r?.xp ?? 0, r?.coins_spent ?? 0), owned: [...(await owned(me))], freezes: r?.freezes ?? 0 };
}

/**
 * Buys something for coins. Keeps are recorded first and paid for after —
 * taken back if the coins aren't there — so buying the same thing twice at
 * once can't charge twice.
 */
export async function buyGood(id: string): Promise<{ ok: true; shop: ShopState } | { ok: false; error: string }> {
  const me = await requireUserId();
  const good = goodById(id);
  if (!good) return { ok: false, error: "That's not for sale." };
  if (await rateLimited("buy", me)) return { ok: false, error: TOO_MANY };
  const pay = async () =>
    ((await sql`
      update profiles set coins_spent = coins_spent + ${good.price},
             bonus_freezes = bonus_freezes + ${good.kind === "freeze" ? 1 : 0}
       where id = ${me}::uuid and floor(xp / ${XP_PER_COIN}) - coins_spent >= ${good.price}
      returning id
    `) as unknown[]).length > 0;
  if (good.kind === "freeze") {
    if (!(await pay())) return { ok: false, error: "Not enough coins yet: finish a few more quests." };
  } else {
    const fresh = (await sql`
      insert into purchases (user_id, item) values (${me}::uuid, ${good.id}) on conflict do nothing returning item
    `) as unknown[];
    if (!fresh.length) return { ok: false, error: "You have that already." };
    if (!(await pay())) {
      await sql`delete from purchases where user_id = ${me}::uuid and item = ${good.id}`;
      return { ok: false, error: "Not enough coins yet: finish a few more quests." };
    }
  }
  return { ok: true, shop: await loadShop() };
}

/* ----------------------------------------------------------------- bakery */

/**
 * Buys a treat at the bakery (src/lib/bakery.ts) and leaves it on a
 * companion's door, with a note if there is one. Paid for and delivered in
 * one statement: no coins, no treat.
 */
export async function sendTreat(
  friendId: string,
  treatId: string,
  text: string
): Promise<{ ok: true; shop: ShopState } | { ok: false; error: string }> {
  const me = await requireUserId();
  const treat = treatById(treatId);
  if (!treat) return { ok: false, error: "The bakery doesn't make that." };
  const body = cleanLine(text, NOTE_MAX);
  if (!(await areFriends(me, friendId))) return { ok: false, error: "You can only send treats to companions." };
  if (await rateLimited("treat", me)) return { ok: false, error: TOO_MANY };
  const rows = (await sql`
    with paid as (
      update profiles set coins_spent = coins_spent + ${treat.price}
       where id = ${me}::uuid and floor(xp / ${XP_PER_COIN}) - coins_spent >= ${treat.price}
      returning display_name
    )
    insert into door_notes (owner_id, author_id, body, treat)
    select ${friendId}::uuid, ${me}::uuid, ${body}, ${treat.id} from paid
    returning (select display_name from paid) as from_name
  `) as { from_name: string }[];
  if (!rows.length) return { ok: false, error: "Not enough coins yet: finish a few more quests." };
  await sendToUser(friendId, {
    title: `${rows[0].from_name} sent you ${treat.a}`,
    body: body || "It's waiting on your doorstep in the village.",
    url: "/village",
    tag: `treat-${me}`,
  }).catch(() => 0);
  return { ok: true, shop: await loadShop() };
}

/* ------------------------------------------------------------------ notes */

export async function leaveNote(ownerId: string, text: string): Promise<Result> {
  const me = await requireUserId();
  const body = cleanLine(text, NOTE_MAX);
  if (!body) return { ok: false, error: "Write something first." };
  if (!(await areFriends(me, ownerId))) return { ok: false, error: "You can only leave notes for companions." };
  if (await rateLimited("doorNote", me)) return { ok: false, error: TOO_MANY };
  await sql`insert into door_notes (owner_id, author_id, body) values (${ownerId}::uuid, ${me}::uuid, ${body})`;
  return { ok: true };
}

export async function markNotesRead(): Promise<void> {
  const me = await requireUserId();
  await sql`update door_notes set read_at = now() where owner_id = ${me}::uuid and read_at is null`;
}

export async function deleteNote(id: string): Promise<void> {
  const me = await requireUserId();
  if (!UUID.test(id)) return;
  await sql`delete from door_notes where id = ${id}::uuid and owner_id = ${me}::uuid`;
}

/* ----------------------------------------------------------------- nudges */

/**
 * A friend's quests that are worth a nudge — past their deadline or due
 * today, in their timezone — described without their titles.
 */
export async function nudgeTargets(friendId: string): Promise<{ id: string; hint: string }[]> {
  const me = await requireUserId();
  if (!(await areFriends(me, friendId))) return [];
  const rows = (await sql`
    select t.id, quest_hint(t.id, 'their') as hint
      from todos t
      join profiles p on p.id = t.user_id
     where t.user_id = ${friendId}::uuid and t.status = 'open' and t.due_date is not null
       and (t.due_date at time zone coalesce((select name from pg_timezone_names where name = p.timezone), 'UTC'))::date
           <= (now() at time zone coalesce((select name from pg_timezone_names where name = p.timezone), 'UTC'))::date
     order by t.due_date
     limit 10
  `) as { id: string; hint: string }[];
  return rows;
}

/** When I may next nudge this friend, or null if I can now. Also whether they take nudges at all. */
export async function nudgeStatus(friendId: string): Promise<{ accepts: boolean; nextAt: number | null }> {
  const me = await requireUserId();
  if (!(await areFriends(me, friendId))) return { accepts: false, nextAt: null };
  const rows = (await sql`
    select coalesce((select np.nudges from notification_prefs np where np.user_id = ${friendId}::uuid), true) as accepts,
           (select max(created_at) from nudges where from_id = ${me}::uuid and to_id = ${friendId}::uuid) as last
  `) as { accepts: boolean; last: Date | string | null }[];
  const last = rows[0]?.last ? new Date(rows[0].last).getTime() : null;
  const nextAt = last && last + NUDGE_EVERY_MS > Date.now() ? last + NUDGE_EVERY_MS : null;
  return { accepts: !!rows[0]?.accepts, nextAt };
}

export async function sendNudge(friendId: string, text: string, todoId: string | null): Promise<Result> {
  const me = await requireUserId();
  const body = cleanLine(text, NUDGE_MAX);
  if (!body) return { ok: false, error: "Say something with it." };
  if (!(await areFriends(me, friendId))) return { ok: false, error: "You can only nudge companions." };

  const status = await nudgeStatus(friendId);
  if (!status.accepts) return { ok: false, error: "They've turned nudges off." };
  if (status.nextAt) return { ok: false, error: "You've nudged them recently. Give them a little while." };
  if (await rateLimited("nudge", me)) return { ok: false, error: TOO_MANY };

  // A quest to point at must be theirs and still open; otherwise just drop it.
  let quest: string | null = null;
  if (todoId && UUID.test(todoId)) {
    const q = (await sql`
      select id from todos where id = ${todoId}::uuid and user_id = ${friendId}::uuid and status = 'open'
    `) as { id: string }[];
    quest = q[0]?.id ?? null;
  }

  const rows = (await sql`
    insert into nudges (from_id, to_id, body, todo_id)
    values (${me}::uuid, ${friendId}::uuid, ${body}, ${quest}::uuid)
    returning (select display_name from profiles where id = ${me}::uuid) as from_name,
              case when todo_id is not null then quest_hint(todo_id, 'your') end as about
  `) as { from_name: string; about: string | null }[];

  await sendToUser(friendId, {
    title: `${rows[0]?.from_name ?? "A companion"} nudged you`,
    body: rows[0]?.about ? `${body} (${rows[0].about})` : body,
    url: "/village",
    tag: `nudge-${me}`,
  }).catch(() => 0);
  return { ok: true };
}

export async function markNudgesSeen(ids: string[]): Promise<void> {
  const me = await requireUserId();
  const clean = ids.filter((x) => UUID.test(x)).slice(0, 20);
  if (!clean.length) return;
  await sql`
    update nudges set seen_at = now()
     where to_id = ${me}::uuid and id = any(${clean}::uuid[]) and seen_at is null
  `;
}

/* --------------------------------------------------------------- sessions */

async function ownOpenQuest(me: string, todoId: string | null): Promise<string | null> {
  if (!todoId || !UUID.test(todoId)) return null;
  const rows = (await sql`
    select id from todos where id = ${todoId}::uuid and user_id = ${me}::uuid and status = 'open'
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** My open quests, to pick one to work on. Mine, so titles are fine. */
export async function myOpenQuests(): Promise<{ id: string; title: string }[]> {
  const me = await requireUserId();
  return (await sql`
    select id, title from todos
     where user_id = ${me}::uuid and status = 'open'
     order by due_date nulls last, created_at desc
     limit 50
  `) as { id: string; title: string }[];
}

export async function startSession(input: { focus: boolean; todoId: string | null; spot?: "hall" | "library" }): Promise<Result> {
  const me = await requireUserId();
  if (await rateLimited("session", me)) return { ok: false, error: TOO_MANY };
  await leaveTable(me);
  const todo = await ownOpenQuest(me, input.todoId);
  // One statement, so the table never exists without anyone at it.
  await sql`
    with s as (
      insert into work_sessions (host_id, focus, focus_from, village, spot)
      values (${me}::uuid, ${!!input.focus}, case when ${!!input.focus} then now() end, ${await myVillage(me)},
              ${input.spot === "library" ? "library" : "hall"})
      returning id
    )
    insert into session_members (session_id, user_id, todo_id)
    select id, ${me}::uuid, ${todo}::uuid from s
  `;
  return { ok: true };
}

export async function joinSession(sessionId: string, todoId: string | null): Promise<Result> {
  const me = await requireUserId();
  if (!UUID.test(sessionId)) return { ok: false, error: "That table isn't there any more." };
  if (await rateLimited("session", me)) return { ok: false, error: TOO_MANY };

  // Joinable if a friend of mine is sitting at it right now.
  const friends = await friendIdsOf(me);
  const ok = (await sql`
    select 1 from work_sessions s
     where s.id = ${sessionId}::uuid and s.ended_at is null
       and exists (
         select 1 from session_members m
          where m.session_id = s.id and m.left_at is null and m.user_id = any(${friends}::uuid[])
       )
  `) as unknown[];
  if (!ok.length) return { ok: false, error: "That table has emptied, or no companion of yours is at it." };

  await leaveTable(me);
  const todo = await ownOpenQuest(me, todoId);
  const rows = (await sql`
    insert into session_members (session_id, user_id, todo_id)
    select ${sessionId}::uuid, ${me}::uuid, ${todo}::uuid
     where exists (select 1 from work_sessions where id = ${sessionId}::uuid and ended_at is null)
    returning id
  `) as { id: string }[];
  return rows.length ? { ok: true } : { ok: false, error: "That table just emptied." };
}

export async function leaveSession(): Promise<{ xp: number }> {
  const me = await requireUserId();
  return { xp: await leaveTable(me) };
}

export async function setSessionQuest(todoId: string | null): Promise<void> {
  const me = await requireUserId();
  const todo = await ownOpenQuest(me, todoId);
  await sql`
    update session_members set todo_id = ${todo}::uuid
     where user_id = ${me}::uuid and left_at is null
  `;
}

/** Focus rounds on or off for the whole table; turning on starts a fresh round. */
export async function setFocusRounds(on: boolean): Promise<void> {
  const me = await requireUserId();
  await sql`
    update work_sessions s set focus = ${!!on}, focus_from = case when ${!!on} then now() end
     where s.ended_at is null
       and s.id = (select session_id from session_members where user_id = ${me}::uuid and left_at is null)
  `;
}

/* ------------------------------------------------------------ interiors */

/** A house's inside, as everyone who walks in sees it. Owner or companions only. */
export async function loadInterior(hostId: string): Promise<{ interior: Interior; tier: Tier; level: number; name: string } | null> {
  const me = await requireUserId();
  if (!UUID.test(hostId) || (hostId !== me && !(await areFriends(me, hostId)))) return null;
  const rows = (await sql`
    select p.display_name, p.xp, h.interior
      from profiles p left join houses h on h.user_id = p.id
     where p.id = ${hostId}::uuid
  `) as { display_name: string; xp: number; interior: unknown }[];
  const r = rows[0];
  if (!r) return null;
  const level = levelFor(r.xp);
  const tier = tierFor(level).tier;
  return { interior: r.interior ? cleanInterior(r.interior, tier, level) : defaultInterior(tier), tier, level, name: r.display_name };
}

export async function saveInterior(raw: Interior): Promise<Interior> {
  const me = await requireUserId();
  const rows = (await sql`select xp from profiles where id = ${me}::uuid`) as { xp: number }[];
  const level = levelFor(rows[0]?.xp ?? 0);
  const clean = cleanInterior(raw, tierFor(level).tier, level, await owned(me));
  await sql`
    insert into houses (user_id, interior, updated_at) values (${me}::uuid, ${JSON.stringify(clean)}::jsonb, now())
    on conflict (user_id) do update set interior = excluded.interior, updated_at = now()
  `;
  return clean;
}

/* ------------------------------------------------------------------ talk */

export async function say(space: string, text: string): Promise<Result> {
  const me = await requireUserId();
  const body = cleanLine(text, SAY_MAX);
  if (!body) return { ok: false, error: "Say something first." };
  if (typeof space !== "string" || space.length > 60) return { ok: false, error: "You're not anywhere to talk." };
  if (!(await inSpace(me, space))) return { ok: false, error: "You've wandered off: nobody here to hear it." };
  if (await rateLimited("say", me)) return { ok: false, error: TOO_MANY };
  await sql`insert into space_chat (space, author_id, body) values (${space}, ${me}::uuid, ${body})`;
  // A town hall is out in its village: its listeners are on that village's
  // live space (village.ts, liveSpaceOf).
  const at = readSpace(space);
  after(() => poke(at?.kind === "hall" ? outsideSpace(at.village) : space));
  return { ok: true };
}

/* ----------------------------------------------------------------- duels */

const ARENA_BUSY = "This arena's taken — one duel at a time in each. Wait for this one to finish.";

/**
 * Settles what time has already decided — an unanswered challenge, a fight
 * whose clock ran out — so a stale row can't keep the arena closed.
 */
async function clearArena() {
  await sql`
    update duels set status = 'expired', updated_at = now()
     where status = 'pending' and created_at < now() - interval '60 seconds'
  `;
  await sql`
    update duels set
      status = 'done', round_ends = null, updated_at = now(),
      winner = case when a_hp > b_hp then a_id when b_hp > a_hp then b_id end
     where status = 'active' and (round_ends is null or round_ends <= now())
  `;
}

export async function challenge(opponentId: string): Promise<Result> {
  const me = await requireUserId();
  if (!(await areFriends(me, opponentId))) return { ok: false, error: "You can only duel companions." };
  const v = await myVillage(me);
  if (!(await inSpace(me, arenaSpace(v))) || !(await inSpace(opponentId, arenaSpace(v))))
    return { ok: false, error: "You both need to be in the same arena." };
  if (await rateLimited("duel", me)) return { ok: false, error: TOO_MANY };
  await clearArena();
  const open = (await sql`select 1 from duels where status in ('pending', 'active') and village = ${v} limit 1`) as unknown[];
  if (open.length) return { ok: false, error: ARENA_BUSY };
  try {
    await sql`insert into duels (a_id, b_id, village) values (${me}::uuid, ${opponentId}::uuid, ${v})`;
  } catch (e) {
    // Two challenges at the same moment: the one-duel-per-arena index lets one in.
    if (/duels_one_per_arena/.test(String(e))) return { ok: false, error: ARENA_BUSY };
    throw e;
  }
  after(() => poke(arenaSpace(v)));
  return { ok: true };
}

export async function answerDuel(duelId: string, accept: boolean): Promise<Result> {
  const me = await requireUserId();
  if (!UUID.test(duelId)) return { ok: false, error: "That challenge isn't there any more." };
  const d = await duelById(duelId);
  const age = d ? Date.now() - new Date(d.created_at as string | Date).getTime() : Infinity;
  if (!d || d.b_id !== me || d.status !== "pending" || age > INVITE_MS)
    return { ok: false, error: "That challenge has expired." };
  after(() => poke(arenaSpace(d.village)));
  if (!accept) {
    await sql`update duels set status = 'declined', updated_at = now() where id = ${duelId}::uuid and status = 'pending'`;
    return { ok: true };
  }
  // Everyone starts level: 5 health each. The clock covers the countdown to
  // "Fight!" and then the fight itself (src/lib/duel.ts).
  const seconds = (COUNTDOWN_MS + DUEL_MS) / 1000;
  const rows = (await sql`
    update duels set status = 'active', round = 1,
           round_ends = now() + make_interval(secs => ${seconds}),
           a_hp = ${DUEL_HP}, a_max = ${DUEL_HP}, b_hp = ${DUEL_HP}, b_max = ${DUEL_HP},
           updated_at = now()
     where id = ${duelId}::uuid and status = 'pending'
    returning id
  `) as unknown[];
  return rows.length ? { ok: true } : { ok: false, error: "That challenge has expired." };
}

export async function yieldDuel(duelId: string): Promise<void> {
  const me = await requireUserId();
  if (!UUID.test(duelId)) return;
  const rows = (await sql`
    update duels set
      winner = case when status = 'active' then (case when a_id = ${me}::uuid then b_id else a_id end) end,
      status = case when status = 'pending' then 'cancelled' else 'done' end,
      round_ends = null, updated_at = now()
     where id = ${duelId}::uuid and status in ('pending', 'active')
       and (a_id = ${me}::uuid or b_id = ${me}::uuid)
    returning village
  `) as { village: number }[];
  if (rows[0]) after(() => poke(arenaSpace(rows[0].village)));
}
