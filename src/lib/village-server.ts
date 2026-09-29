import { sql } from "@/lib/db";
import { levelFor } from "@/lib/game";
import { listFriends } from "@/lib/social-actions";
import type { Appearance, Equipped } from "@/lib/types";
import { duelRecords, duelsFor, roomPeople, spaceChat, touchRoomPresence } from "@/lib/village-rooms";
import {
  cleanHouse,
  spaceOf,
  type HouseLook,
  type Neighbour,
  type NudgeView,
  type Place,
  type Pos,
  type Pulse,
  type SessionView,
} from "@/lib/village";

/* --------------------------------------------------------------------------
   The village's queries, shared by the page, its actions and
   the check-in route. Server-only; every read of another person is limited
   to accepted friends — except the knight and name of someone sharing a
   work-session table, which is what sitting at one means.
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

/* --------------------------------------------------------------- presence */

export async function touchPresence(me: string, place: Place | null) {
  if (!place) return;
  await sql`
    insert into village_presence (user_id, place, host_id, seen_at)
    values (${me}::uuid, ${place.kind},
            ${place.kind === "house" ? place.hostId : null}::uuid, now())
    on conflict (user_id) do update set
      place = excluded.place, host_id = excluded.host_id, seen_at = now()
  `;
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

/** One check-in: where I am, and what the village looks like from here. */
export async function pulse(me: string, place: Place | null, pos: Pos | null = null): Promise<Pulse> {
  await sweepSessions();
  const friends = await friendIdsOf(me);
  const known = new Set([me, ...friends]);

  // Inside a house or in the arena needs newer columns. If they're missing,
  // keep the outdoor village working and count them as out on the square.
  let shared = false;
  if (place && (place.kind === "inside" || place.kind === "arena")) {
    shared = await touchRoomPresence(me, place, pos, known).catch(() => false);
    if (!shared) await touchPresence(me, { kind: "square" });
  } else await touchPresence(me, place);
  const focusXp = await sessionHeartbeat(me);

  const presenceRows = (await sql`
    select user_id, place, host_id, seen_at from village_presence
     where user_id = any(${friends}::uuid[])
  `) as { user_id: string; place: string; host_id: string | null; seen_at: unknown }[];

  const presence: Pulse["presence"] = {};
  for (const r of presenceRows) {
    const p: Place =
      r.place === "house" && r.host_id
        ? { kind: "house", hostId: r.host_id }
        : r.place === "inside" && r.host_id
          ? { kind: "inside", hostId: r.host_id }
          : r.place === "arena"
            ? { kind: "arena" }
            : r.place === "hall"
          ? { kind: "hall" }
          : r.place === "square"
            ? { kind: "square" }
            : { kind: "home" };
    presence[r.user_id] = { place: p, seenAt: ms(r.seen_at) };
  }

  const sessions = await visibleSessions(me, known);
  const mine = (await sql`
    select session_id from session_members where user_id = ${me}::uuid and left_at is null
  `) as { session_id: string }[];

  // The shared space I'm in: who's there, and what's been said.
  let room: Pulse["room"] = null;
  let duels: Pulse["duels"] = [];
  const space = shared || place?.kind === "hall" ? spaceOf(place) : null;
  try {
    if (space && place)
      room = {
        space,
        people: place.kind === "hall" ? [] : await roomPeople(me, place, known),
        chat: await spaceChat(space, known),
      };
    duels = await duelsFor(me, place?.kind === "arena" && shared);
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
  pulse: Pulse;
  notes: { id: string; from: string; body: string; at: number; read: boolean }[];
};

export async function loadVillage(me: string): Promise<VillageData> {
  const friends = await listFriends();
  const ids = [me, ...friends.map((f) => f.user_id)];

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
    pulse: await pulse(me, null),
    notes: noteRows.map((n) => ({ id: n.id, from: n.author, body: n.body, at: ms(n.created_at), read: n.read })),
  };
}
