import { sql } from "@/lib/db";
import { levelFor } from "@/lib/game";
import { listFriends } from "@/lib/social-actions";
import type { Appearance, Equipped } from "@/lib/types";
import { duelRecords, duelsFor, ONLINE, roomPeople, spaceChat } from "@/lib/village-rooms";
import {
  cleanHouse,
  spaceOf,
  type HouseLook,
  type Neighbour,
  type NudgeView,
  type OutdoorPerson,
  type Place,
  type Pos,
  type Pulse,
  type Resident,
  type SessionView,
} from "@/lib/village";
import { lotsFor, plotAt } from "@/components/village/world";

/* --------------------------------------------------------------------------
   The village's queries, shared by the page, its actions and
   the check-in route. Server-only. It's one village for everyone: anyone's
   house, and anyone about in it, is shown as a knight and a name. Anything
   more (what they're working on, where they are when it isn't the village,
   their notes and rooms) is for accepted friends only.
   -------------------------------------------------------------------------- */

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));

export async function friendIdsOf(me: string): Promise<string[]> {
  const rows = (await sql`
    select case when requester_id = ${me}::uuid then addressee_id else requester_id end as id
      from friendships
     where status = 'accepted'
       and (requester_id = ${me}::uuid or addressee_id = ${me}::uuid)
  `) as { id: string }[];
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ plots */

/** Everyone with a house, wherever it stands: the whole village. `known`: me and my companions. */
export async function residents(known: Set<string>): Promise<Resident[]> {
  const rows = (await sql`
    select h.user_id, h.plot, p.display_name, p.appearance, p.equipped, p.xp, h.style, h.roof, h.garden,
           coalesce((select max(b.streak)::int from habits b where b.user_id = h.user_id and b.active), 0) as streak
      from houses h join profiles p on p.id = h.user_id
     where h.plot is not null
  `) as ({ user_id: string; plot: number; display_name: string; appearance: Appearance; equipped: Equipped; xp: number; streak: number } & HouseLook)[];
  return rows.map((r) => {
    const level = levelFor(r.xp);
    return {
      id: r.user_id,
      name: r.display_name,
      appearance: r.appearance,
      equipped: r.equipped,
      plot: r.plot,
      level,
      streak: r.streak,
      house: cleanHouse(r, level),
      known: known.has(r.user_id),
    };
  });
}

/** Changes whenever a plot is given or moved (Pulse.plotsAt). */
async function plotsVersion(): Promise<string> {
  const rows = (await sql`select count(*)::int as n, max(plot_at) as at from houses where plot is not null`) as { n: number; at: unknown }[];
  return `${rows[0]?.n ?? 0}:${rows[0]?.at ? ms(rows[0].at) : 0}`;
}

/**
 * Gives someone a plot if they haven't one: the empty lot nearest their
 * companions' houses — or nearest the hall if none of them has one yet — so
 * friends end up neighbours. They can move later (village-actions.ts,
 * moveHouse).
 */
export async function ensurePlot(me: string, friends: string[]): Promise<void> {
  const mine = (await sql`select plot from houses where user_id = ${me}::uuid`) as { plot: number | null }[];
  if (mine[0]?.plot != null) return;
  const companions = new Set(friends);
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = (await sql`select user_id, plot from houses where plot is not null`) as { user_id: string; plot: number }[];
    const taken = new Set(rows.map((r) => r.plot));
    const near = rows.filter((r) => companions.has(r.user_id)).map((r) => plotAt(r.plot));
    const highest = rows.reduce((m, r) => Math.max(m, r.plot), -1);
    const score = (n: number) => {
      if (!near.length) return n;
      const p = plotAt(n);
      return Math.min(...near.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
    };
    let pick = -1;
    for (let n = 0; n < lotsFor(highest); n++)
      if (!taken.has(n) && (pick < 0 || score(n) < score(pick))) pick = n;
    try {
      await sql`
        insert into houses (user_id, plot, plot_at) values (${me}::uuid, ${pick}, now())
        on conflict (user_id) do update set plot = excluded.plot, plot_at = now() where houses.plot is null
      `;
      return;
    } catch (e) {
      // Someone moved in there a moment ago: look again.
      if (!/houses_plot_key|duplicate key/i.test(String(e))) throw e;
    }
  }
}

function placeOf(kind: string, host: string | null): Place {
  if (kind === "house" && host) return { kind: "house", hostId: host };
  if (kind === "inside" && host) return { kind: "inside", hostId: host };
  if (kind === "arena") return { kind: "arena" };
  if (kind === "hall") return { kind: "hall" };
  if (kind === "square") return { kind: "square" };
  return { kind: "home" };
}

/** Everyone else outside in the village, or at home in the app — friends or not. */
async function outdoorsOf(me: string, known: Set<string>): Promise<OutdoorPerson[]> {
  const rows = (await sql`
    select v.user_id, v.place, v.host_id, v.x, v.y, v.facing, p.display_name, p.appearance, p.equipped
      from village_presence v join profiles p on p.id = v.user_id
     where v.seen_at > now() - ${ONLINE}::interval and v.user_id <> ${me}::uuid
       and v.place in ('home', 'square', 'hall', 'house')
  `) as {
    user_id: string;
    place: string;
    host_id: string | null;
    x: number | null;
    y: number | null;
    facing: number | null;
    display_name: string;
    appearance: Appearance;
    equipped: Equipped;
  }[];
  return rows.map((r) => ({
    villager: { id: r.user_id, name: r.display_name, appearance: r.appearance, equipped: r.equipped },
    known: known.has(r.user_id),
    place: placeOf(r.place, r.host_id),
    pos: r.place !== "home" && r.x != null && r.y != null ? { x: r.x, y: r.y, facing: ((r.facing ?? 2) % 4) as Pos["facing"] } : null,
  }));
}

/* --------------------------------------------------------------- presence */

/** Until db/schema.sql's `device` column is added, every device writes, as before. */
let haveDevice = true;

/**
 * Stores where I am, from this device (`device`, made up by each open app)
 * — unless another of my devices got here first and is still about: that
 * one keeps the row until it's closed, and this returns false. A position
 * goes with anywhere in the village; at home in the app there's none.
 */
async function writePresence(me: string, place: Place, pos: Pos | null, device: string | null): Promise<boolean> {
  const host = place.kind === "house" || place.kind === "inside" ? place.hostId : null;
  const at = place.kind === "home" ? null : pos;
  if (haveDevice) {
    try {
      const rows = (await sql`
        insert into village_presence as v (user_id, place, host_id, x, y, facing, device, seen_at)
        values (${me}::uuid, ${place.kind}, ${host}::uuid, ${at?.x ?? null}, ${at?.y ?? null}, ${at?.facing ?? null}, ${device}, now())
        on conflict (user_id) do update set
          place = excluded.place, host_id = excluded.host_id,
          x = excluded.x, y = excluded.y, facing = excluded.facing,
          device = excluded.device, seen_at = now()
         where v.device is null or excluded.device is null or v.device = excluded.device
            or v.seen_at < now() - ${ONLINE}::interval
        returning 1 as ok
      `) as { ok: number }[];
      return rows.length > 0;
    } catch (e) {
      if (!/column "device"/i.test(String(e))) throw e;
      haveDevice = false;
    }
  }
  await sql`
    insert into village_presence (user_id, place, host_id, x, y, facing, seen_at)
    values (${me}::uuid, ${place.kind}, ${host}::uuid, ${at?.x ?? null}, ${at?.y ?? null}, ${at?.facing ?? null}, now())
    on conflict (user_id) do update set
      place = excluded.place, host_id = excluded.host_id,
      x = excluded.x, y = excluded.y, facing = excluded.facing, seen_at = now()
  `;
  return true;
}

/**
 * This device is closing. If it's the one friends see, it lets go now — and
 * I'm offline now, rather than once my last check-in goes stale — so another
 * of my devices takes over at its next check-in.
 */
export async function releasePresence(me: string, device: string) {
  if (!haveDevice) return;
  await sql`
    update village_presence
       set device = null, seen_at = least(seen_at, now() - ${ONLINE}::interval)
     where user_id = ${me}::uuid and device = ${device}
  `.catch(() => {});
}

/* --------------------------------------------------------------- sessions */

/**
 * Takes anyone who stopped checking in off their table as of their last
 * check-in, pays what they'd earned, and closes tables nobody is at.
 */
export async function sweepSessions() {
  const gone = (await sql`
    update session_members set left_at = last_seen
     where left_at is null and last_seen < now() - interval '2 minutes'
     returning id
  `) as { id: string }[];
  for (const g of gone) await sql`select award_focus_xp(${g.id}::uuid)`;
  await sql`
    update work_sessions s set ended_at = now()
     where s.ended_at is null
       and not exists (select 1 from session_members m where m.session_id = s.id and m.left_at is null)
  `;
}

/** "Still here": keeps my seat, and pays any focus rounds now complete. */
export async function sessionHeartbeat(me: string): Promise<number> {
  const rows = (await sql`
    update session_members set last_seen = now()
     where user_id = ${me}::uuid and left_at is null
     returning id
  `) as { id: string }[];
  if (!rows[0]) return 0;
  const paid = (await sql`select award_focus_xp(${rows[0].id}::uuid) as xp`) as { xp: number }[];
  return paid[0]?.xp ?? 0;
}

/** Leaves whatever table I'm at, paying for the time. */
export async function leaveTable(me: string): Promise<number> {
  const rows = (await sql`
    update session_members set left_at = now(), last_seen = now()
     where user_id = ${me}::uuid and left_at is null
     returning id
  `) as { id: string }[];
  let xp = 0;
  for (const r of rows) {
    const paid = (await sql`select award_focus_xp(${r.id}::uuid) as xp`) as { xp: number }[];
    xp += paid[0]?.xp ?? 0;
  }
  await sql`
    update work_sessions s set ended_at = now()
     where s.ended_at is null
       and not exists (select 1 from session_members m where m.session_id = s.id and m.left_at is null)
  `;
  return xp;
}

/** Tables anyone I know is sitting at, with who's there. */
async function visibleSessions(me: string, known: Set<string>): Promise<SessionView[]> {
  const ids = [...known];
  const sessions = (await sql`
    select s.id, s.host_id, s.focus, s.focus_from, s.started_at
      from work_sessions s
     where s.ended_at is null
       and exists (
         select 1 from session_members m
          where m.session_id = s.id and m.left_at is null and m.user_id = any(${ids}::uuid[])
       )
     order by s.started_at
     limit 20
  `) as { id: string; host_id: string; focus: boolean; focus_from: unknown; started_at: unknown }[];
  if (!sessions.length) return [];

  const members = (await sql`
    select m.session_id, m.user_id, m.joined_at, p.display_name, p.appearance, p.equipped,
           c.name as cat_name, c.color as cat_color
      from session_members m
      join profiles p on p.id = m.user_id
      left join todos t on t.id = m.todo_id and t.user_id = m.user_id
      left join categories c on c.id = t.category_id
     where m.left_at is null and m.session_id = any(${sessions.map((s) => s.id)}::uuid[])
     order by m.joined_at
  `) as {
    session_id: string;
    user_id: string;
    joined_at: unknown;
    display_name: string;
    appearance: Appearance;
    equipped: Equipped;
    cat_name: string | null;
    cat_color: string | null;
  }[];

  return sessions.map((s) => ({
    id: s.id,
    hostId: s.host_id,
    focus: s.focus,
    focusFrom: s.focus_from ? ms(s.focus_from) : null,
    startedAt: ms(s.started_at),
    members: members
      .filter((m) => m.session_id === s.id)
      .map((m) => {
        const isKnown = known.has(m.user_id);
        return {
          villager: { id: m.user_id, name: m.display_name, appearance: m.appearance, equipped: m.equipped },
          known: isKnown,
          joinedAt: ms(m.joined_at),
          // What someone's working on is for their friends, not for strangers.
          working: isKnown && m.cat_name ? { name: m.cat_name, color: m.cat_color ?? "amber" } : null,
        };
      }),
  }));
}

/* ----------------------------------------------------------------- nudges */

export async function unseenNudges(me: string): Promise<NudgeView[]> {
  const rows = (await sql`
    select n.id, p.display_name as from_name, n.body, n.created_at,
           case when t.id is not null and t.status = 'open' then quest_hint(t.id, 'your') end as about
      from nudges n
      join profiles p on p.id = n.from_id
      left join todos t on t.id = n.todo_id and t.user_id = n.to_id
     where n.to_id = ${me}::uuid and n.seen_at is null
       and n.created_at > now() - interval '2 days'
     order by n.created_at desc
     limit 5
  `) as { id: string; from_name: string; body: string; created_at: unknown; about: string | null }[];
  return rows.map((r) => ({ id: r.id, fromName: r.from_name, body: r.body, about: r.about, at: ms(r.created_at) }));
}

/* ------------------------------------------------------------------ pulse */

/**
 * One check-in: where I am, and what the village looks like from here.
 * `place` null moves nobody: it only keeps my seat at a table. `device`
 * is which of my open apps is asking (see village_presence.device).
 */
export async function pulse(me: string, place: Place | null, pos: Pos | null = null, device: string | null = null): Promise<Pulse> {
  await sweepSessions();
  const friends = await friendIdsOf(me);
  const known = new Set([me, ...friends]);

  // Inside a house only if it's mine or a companion's; otherwise I'm out on
  // the square. What this device sees is wherever it has me, even when
  // another of my devices is the one friends see.
  const at: Place | null = place?.kind === "inside" && !known.has(place.hostId) ? { kind: "square" } : place;
  const elsewhere = at ? !(await writePresence(me, at, pos, device)) : false;
  const shared = at?.kind === "inside" || at?.kind === "arena";
  const focusXp = await sessionHeartbeat(me);

  const presenceRows = (await sql`
    select user_id, place, host_id, seen_at from village_presence
     where user_id = any(${friends}::uuid[])
  `) as { user_id: string; place: string; host_id: string | null; seen_at: unknown }[];

  const presence: Pulse["presence"] = {};
  for (const r of presenceRows) presence[r.user_id] = { place: placeOf(r.place, r.host_id), seenAt: ms(r.seen_at) };

  const sessions = await visibleSessions(me, known);
  const mine = (await sql`
    select session_id from session_members where user_id = ${me}::uuid and left_at is null
  `) as { session_id: string }[];

  // The shared space I'm in: who's there, and what's been said.
  let room: Pulse["room"] = null;
  let duels: Pulse["duels"] = [];
  const space = shared || at?.kind === "hall" ? spaceOf(at) : null;
  try {
    if (space && at)
      room = {
        space,
        people: at.kind === "hall" ? [] : await roomPeople(me, at, known),
        chat: await spaceChat(space, known),
      };
    duels = await duelsFor(me, at?.kind === "arena");
  } catch {
    /* db/schema.sql not run yet */
  }

  return {
    now: Date.now(),
    me,
    presence,
    sessions,
    mySessionId: mine[0]?.session_id ?? null,
    focusXp,
    nudges: await unseenNudges(me),
    room,
    duels,
    elsewhere,
    outdoors: await outdoorsOf(me, known),
    plotsAt: await plotsVersion(),
  };
}

/* ------------------------------------------------------------- the page */

async function housesOf(ids: string[]): Promise<Map<string, Partial<HouseLook>>> {
  const rows = (await sql`
    select user_id, style, roof, garden from houses where user_id = any(${ids}::uuid[])
  `) as ({ user_id: string } & HouseLook)[];
  return new Map(rows.map((r) => [r.user_id, r]));
}

/** Minutes at a work-session table today and this week, each in their own timezone. */
export async function focusTotals(ids: string[]): Promise<Map<string, { today: number; week: number }>> {
  const rows = (await sql`
    with z as (
      select pr.id,
             coalesce((select name from pg_timezone_names where name = pr.timezone), 'UTC') as tz
        from profiles pr where pr.id = any(${ids}::uuid[])
    ), b as (
      select z.id,
             (date_trunc('day', now() at time zone z.tz) at time zone z.tz) as day0,
             (date_trunc('week', now() at time zone z.tz) at time zone z.tz) as week0
        from z
    )
    select b.id,
           (coalesce(sum(extract(epoch from (coalesce(m.left_at, m.last_seen) - greatest(m.joined_at, b.day0))))
                     filter (where coalesce(m.left_at, m.last_seen) > b.day0), 0) / 60)::int as today,
           (coalesce(sum(extract(epoch from (coalesce(m.left_at, m.last_seen) - greatest(m.joined_at, b.week0)))), 0) / 60)::int as week
      from b
      left join session_members m
        on m.user_id = b.id and coalesce(m.left_at, m.last_seen) > b.week0
     group by b.id
  `) as { id: string; today: number; week: number }[];
  return new Map(rows.map((r) => [r.id, { today: r.today, week: r.week }]));
}

export type VillageData = {
  me: Neighbour & { focusToday: number; focusWeek: number };
  neighbours: (Neighbour & { focusToday: number; focusWeek: number })[];
  /** Everyone's house, mine included. */
  residents: Resident[];
  pulse: Pulse;
  notes: { id: string; from: string; body: string; at: number; read: boolean }[];
};

export async function loadVillage(me: string): Promise<VillageData> {
  const friends = await listFriends();
  const ids = [me, ...friends.map((f) => f.user_id)];
  // My house, and my companions': theirs are built the first time anyone
  // who knows them comes by, so nobody's missing from a friend's village
  // just because they haven't opened it themselves yet.
  await ensurePlot(me, ids.slice(1));
  const unplaced = (await sql`
    select f.id from unnest(${ids.slice(1)}::uuid[]) as f(id)
      left join houses h on h.user_id = f.id
     where h.plot is null
  `) as { id: string }[];
  for (const { id } of unplaced) await ensurePlot(id, await friendIdsOf(id));

  const [meRows, houses, totals] = await Promise.all([
    sql`
      select p.display_name, p.xp, p.appearance, p.equipped,
             coalesce((select max(h.streak)::int from habits h where h.user_id = p.id and h.active), 0) as streak,
             (select count(*)::int from todos t
               where t.user_id = p.id and t.status = 'done' and t.completed_at is not null
                 and (t.completed_at at time zone coalesce(p.timezone, 'UTC'))::date
                     = (now() at time zone coalesce(p.timezone, 'UTC'))::date) as done_today
        from profiles p where p.id = ${me}::uuid
    ` as unknown as Promise<
      { display_name: string; xp: number; appearance: Appearance; equipped: Equipped; streak: number; done_today: number }[]
    >,
    housesOf(ids),
    focusTotals(ids),
  ]);

  const m = meRows[0];
  const myLevel = levelFor(m.xp);
  const meView = {
    id: me,
    name: m.display_name,
    appearance: m.appearance,
    equipped: m.equipped,
    xp: m.xp,
    level: myLevel,
    streak: m.streak,
    doneToday: m.done_today,
    house: cleanHouse(houses.get(me), myLevel),
    categories: [],
    focusToday: totals.get(me)?.today ?? 0,
    focusWeek: totals.get(me)?.week ?? 0,
    duels: { wins: 0, losses: 0 },
  };

  const neighbours = friends.map((f) => {
    const level = levelFor(f.xp);
    return {
      id: f.user_id,
      name: f.display_name,
      appearance: f.appearance,
      equipped: f.equipped,
      xp: f.xp,
      level,
      streak: f.streak,
      doneToday: f.done_today,
      house: cleanHouse(houses.get(f.user_id), level),
      categories: f.categories,
      focusToday: totals.get(f.user_id)?.today ?? 0,
      focusWeek: totals.get(f.user_id)?.week ?? 0,
      duels: { wins: 0, losses: 0 },
    };
  });

  let records = new Map<string, { wins: number; losses: number }>();
  try {
    records = await duelRecords(ids);
  } catch {
    /* no duels yet */
  }
  meView.duels = records.get(me) ?? { wins: 0, losses: 0 };
  for (const n of neighbours) n.duels = records.get(n.id) ?? { wins: 0, losses: 0 };

  const noteRows = (await sql`
    select n.id, p.display_name as author, n.body, n.created_at, n.read_at is not null as read
      from door_notes n join profiles p on p.id = n.author_id
     where n.owner_id = ${me}::uuid
     order by n.created_at desc
     limit 30
  `) as { id: string; author: string; body: string; created_at: unknown; read: boolean }[];

  return {
    me: meView,
    neighbours,
    residents: await residents(new Set(ids)),
    pulse: await pulse(me, null),
    notes: noteRows.map((n) => ({ id: n.id, from: n.author, body: n.body, at: ms(n.created_at), read: n.read })),
  };
}
