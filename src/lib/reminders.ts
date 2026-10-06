import { sql } from "@/lib/db";
import { sendToUser } from "@/lib/push";
import { clockLabel, REHEARSAL_LEAD_MIN } from "@/lib/planets";

/* --------------------------------------------------------------------------
   What the every-five-minutes job sends (src/app/api/cron/reminders).

   Only people with at least one device subscribed are looked at, and each
   notification is *claimed* in notification_log before it's sent — insert,
   on conflict do nothing, returning what was new — so two runs that overlap
   can never both send it.

   Local times use each person's timezone from their profile. One that
   Postgres doesn't know falls back to UTC rather than failing the whole run
   for everybody.
   -------------------------------------------------------------------------- */

/** due_ms is a bigint, which the driver hands back as a string. */
/** Claims given back this run because the send failed; they'll be tried again. */
let retrying = 0;

/**
 * A notification that reached no device is un-claimed, so the next run tries
 * again — while it's still worth sending (the quest is still inside its lead
 * time, or it's still the morning window). Without this, one failed request
 * to a push service was a reminder lost for good.
 */
async function release(userId: string, kind: "due" | "morning" | "habit" | "rehearsal", refs: string[]) {
  if (!refs.length) return;
  await sql`
    delete from notification_log
     where user_id = ${userId}::uuid and kind = ${kind} and ref = any(${refs}::text[])
  `;
  retrying += refs.length;
}

type DueRow = { user_id: string; todo_id: string; title: string; due_ms: string; ref: string };

export async function runReminders(): Promise<{
  due: number;
  morning: number;
  habits: number;
  rehearsals: number;
  pruned: number;
  retrying: number;
}> {
  const pruned = (await sql`
    delete from notification_log where sent_at < now() - interval '3 days' returning 1
  `).length;

  retrying = 0;
  const due = await dueSoon();
  const morning = await morningSummaries();
  const habits = await habitReminders().catch(() => 0);
  const rehearsals = await rehearsalReminders().catch(() => 0); // db/schema.sql not run again yet
  return { due, morning, habits, rehearsals, pruned, retrying };
}

/* ------------------------------------------------------------ deadlines */

async function dueSoon(): Promise<number> {
  // Open quests whose deadline falls inside the person's chosen lead time and
  // hasn't been reminded about yet. The ref names the deadline too, so a
  // quest whose deadline moves gets reminded about the new one.
  const found = (await sql`
    with people as (
      select s.user_id, coalesce(np.lead_minutes, 60) as lead
        from (select distinct user_id from push_subscriptions) s
        left join notification_prefs np on np.user_id = s.user_id
       where coalesce(np.due_soon, true)
    )
    select t.user_id, t.id as todo_id, t.title,
           (extract(epoch from t.due_date) * 1000)::bigint as due_ms,
           t.id::text || '@' || floor(extract(epoch from t.due_date))::bigint as ref
      from todos t
      join people p on p.user_id = t.user_id
     where t.status = 'open'
       and t.due_date > now()
       and t.due_date <= now() + make_interval(mins => p.lead)
     order by t.due_date
     limit 1000
  `) as DueRow[];
  if (!found.length) return 0;

  const claimed = new Set(
    (
      (await sql`
        insert into notification_log (user_id, kind, ref)
        select u, 'due', r from unnest(${found.map((f) => f.user_id)}::uuid[], ${found.map((f) => f.ref)}::text[]) as x(u, r)
        on conflict do nothing
        returning ref
      `) as { ref: string }[]
    ).map((r) => r.ref)
  );

  const byUser = new Map<string, DueRow[]>();
  for (const f of found) {
    if (!claimed.has(f.ref)) continue;
    byUser.set(f.user_id, [...(byUser.get(f.user_id) ?? []), f]);
  }
  if (!byUser.size) return 0;

  const badges = await dueTodayCounts([...byUser.keys()]);
  let sent = 0;
  for (const [userId, rows] of byUser) {
    const first = rows[0];
    const payload =
      rows.length === 1
        ? {
            title: first.title,
            body: `Due ${fromNow(Number(first.due_ms))}.`,
            tag: `due-${first.todo_id}`,
          }
        : {
            title: `${rows.length} quests due soon`,
            body: listTitles(rows.map((r) => r.title)),
            tag: "due-soon",
          };
    if (await sendToUser(userId, { ...payload, url: "/", badge: badges.get(userId) ?? 0 }).catch(() => 0)) sent++;
    else await release(userId, "due", rows.map((r) => r.ref));
  }
  return sent;
}

/* -------------------------------------------------------------- morning */

type MorningRow = { user_id: string; tz: string; today: string; name: string | null };

async function morningSummaries(): Promise<number> {
  // Everyone whose chosen time has passed today, locally — within three
  // hours of it, so a summary switched on at night waits for the morning
  // rather than arriving at 11pm.
  const people = (await sql`
    with people as (
      select s.user_id,
             coalesce(np.morning_minutes, 480) as at_minute,
             coalesce((select name from pg_timezone_names where name = pr.timezone), 'UTC') as tz,
             pr.display_name as name
        from (select distinct user_id from push_subscriptions) s
        join profiles pr on pr.id = s.user_id
        left join notification_prefs np on np.user_id = s.user_id
       where coalesce(np.morning, true)
    )
    select user_id, tz, name, (now() at time zone tz)::date::text as today
      from people
     where extract(hour from now() at time zone tz) * 60
           + extract(minute from now() at time zone tz)
           between at_minute and at_minute + 180
  `) as MorningRow[];
  if (!people.length) return 0;

  const claimed = new Set(
    (
      (await sql`
        insert into notification_log (user_id, kind, ref)
        select u, 'morning', r from unnest(${people.map((p) => p.user_id)}::uuid[], ${people.map((p) => p.today)}::text[]) as x(u, r)
        on conflict do nothing
        returning user_id
      `) as { user_id: string }[]
    ).map((r) => r.user_id)
  );

  let sent = 0;
  for (const p of people) {
    if (!claimed.has(p.user_id)) continue;

    // What opening the app would do first: settle yesterday's habits, so
    // today's count starts from an honest streak. Idempotent.
    let habitCount = 0;
    try {
      await sql`select settle_habits(${p.user_id}::uuid)`;
      const h = (await sql`
        select count(*)::int as n
          from habits h
         where h.user_id = ${p.user_id}::uuid
           and h.active
           and is_habit_due(h.days, ${p.today}::date)
           and not habit_over(
                 h.ends_on, h.occurrences_limit,
                 (select count(*)::int from habit_log l
                   where l.habit_id = h.id and l.day < ${p.today}::date),
                 ${p.today}::date)
           and not exists (select 1 from habit_log l
                            where l.habit_id = h.id and l.day = ${p.today}::date)
      `) as { n: number }[];
      habitCount = h[0]?.n ?? 0;
    } catch {
      /* habits not set up: the summary just won't count them */
    }

    const rows = (await sql`
      select t.title,
             (t.due_date at time zone ${p.tz})::date < ${p.today}::date as late
        from todos t
       where t.user_id = ${p.user_id}::uuid
         and t.status = 'open'
         and t.due_date is not null
         and (t.due_date at time zone ${p.tz})::date <= ${p.today}::date
       order by t.due_date
    `) as { title: string; late: boolean }[];

    const quests = rows.filter((r) => !r.late);
    const late = rows.filter((r) => r.late);

    const parts: string[] = [];
    if (quests.length)
      parts.push(`${quests.length} due today: ${listTitles(quests.map((q) => q.title))}.`);
    if (habitCount) parts.push(`${habitCount} habit${habitCount === 1 ? "" : "s"} to keep.`);
    if (late.length) parts.push(`${late.length} past deadline.`);

    const reached = await sendToUser(p.user_id, {
      title: p.name ? `Good morning, ${p.name}` : "Good morning",
      body: parts.length ? parts.join(" ") : "Nothing due today. A good day to get ahead.",
      url: "/",
      tag: "morning",
      badge: quests.length + habitCount,
    }).catch(() => 0);
    if (reached) sent++;
    else await release(p.user_id, "morning", [p.today]);
  }
  return sent;
}

/* --------------------------------------------------------------- habits */

type HabitRow = { user_id: string; today: string; slot: number; titles: string[]; streak: number };

/**
 * At 6pm and 9pm local: anyone with a habit due today that isn't ticked yet.
 * Each slot is a one-hour window, so a run that's late or retrying still
 * lands close to the hour, and nobody gets a "6pm" reminder at 8:40.
 * Ticking closes at 23:59:59 local; a day left unticked is then settled.
 */
async function habitReminders(): Promise<number> {
  const found = (await sql`
    with people as (
      select s.user_id,
             coalesce((select name from pg_timezone_names where name = pr.timezone), 'UTC') as tz
        from (select distinct user_id from push_subscriptions) s
        join profiles pr on pr.id = s.user_id
        left join notification_prefs np on np.user_id = s.user_id
       where coalesce(np.habits, true)
    ),
    now_local as (
      select user_id,
             (now() at time zone tz)::date as today,
             extract(hour from now() at time zone tz)::int as hour
        from people
    )
    select n.user_id, n.today::text as today, n.hour as slot,
           array_agg(h.title order by h.streak desc, h.created_at) as titles,
           max(h.streak)::int as streak
      from now_local n
      join habits h on h.user_id = n.user_id
     where n.hour in (18, 21)
       and h.active
       and is_habit_due(h.days, n.today)
       and not habit_over(
             h.ends_on, h.occurrences_limit,
             (select count(*)::int from habit_log l
               where l.habit_id = h.id and l.day < n.today),
             n.today)
       and not exists (select 1 from habit_log l
                        where l.habit_id = h.id and l.day = n.today and l.done)
     group by n.user_id, n.today, n.hour
  `) as HabitRow[];
  if (!found.length) return 0;

  const refs = found.map((f) => `${f.today}@${f.slot}`);
  const claimed = new Set(
    (
      (await sql`
        insert into notification_log (user_id, kind, ref)
        select u, 'habit', r from unnest(${found.map((f) => f.user_id)}::uuid[], ${refs}::text[]) as x(u, r)
        on conflict do nothing
        returning user_id || ' ' || ref as key
      `) as { key: string }[]
    ).map((r) => r.key)
  );

  let sent = 0;
  for (const f of found) {
    const ref = `${f.today}@${f.slot}`;
    if (!claimed.has(`${f.user_id} ${ref}`)) continue;

    const n = f.titles.length;
    const left = f.slot === 21 ? "Three hours left" : "Still time today";
    const streak = f.streak > 0 ? ` Keep your ${f.streak}-day streak going.` : "";
    const reached = await sendToUser(f.user_id, {
      title: n === 1 ? `Don't forget: ${f.titles[0]}` : `${n} habits still to tick`,
      body: `${n === 1 ? left : `${listTitles(f.titles)}. ${left}`} — open until 11:59 pm.${streak}`,
      url: "/habits",
      tag: "habits",
      badge: n,
    }).catch(() => 0);
    if (reached) sent++;
    else await release(f.user_id, "habit", [ref]);
  }
  return sent;
}

/* ----------------------------------------------------------- rehearsals */

type RehearsalRow = { user_id: string; rehearsal_id: number; label: string; planet: string; minute: number; ref: string };

/**
 * Everyone on a planet, REHEARSAL_LEAD_MIN before each of its weekly
 * rehearsals (src/lib/planets.ts). Each rehearsal keeps its own timezone, so
 * "Sunday 7pm" is Sunday 7pm where it's held, whoever's being reminded. The
 * ref names the day it's on, so each week's is sent once.
 */
async function rehearsalReminders(): Promise<number> {
  const found = (await sql`
    with slots as (
      select r.id, r.label, r.minute, r.weekday, p.id as planet_id, p.name as planet,
             coalesce((select name from pg_timezone_names where name = r.tz limit 1), 'UTC') as tz
        from planet_rehearsals r join planets p on p.id = r.planet_id
    ),
    local as (
      -- The day it'd be on: the one the lead time ends in, so a rehearsal
      -- just after midnight is found from just before it.
      select s.*, now() at time zone s.tz as here,
             date_trunc('day', (now() at time zone s.tz) + make_interval(mins => ${REHEARSAL_LEAD_MIN}::int)) as day
        from slots s
    ),
    due as (
      select l.*, l.day + make_interval(mins => l.minute::int) as starts
        from local l
       where extract(dow from l.day)::int = l.weekday
    )
    select m.user_id, d.id as rehearsal_id, d.label, d.planet, d.minute,
           d.id::text || '@' || to_char(d.starts, 'YYYY-MM-DD') as ref
      from due d
      join planet_members m on m.planet_id = d.planet_id
      join (select distinct user_id from push_subscriptions) s on s.user_id = m.user_id
      left join notification_prefs np on np.user_id = m.user_id
     where d.starts > d.here
       and d.starts <= d.here + make_interval(mins => ${REHEARSAL_LEAD_MIN}::int)
       and coalesce(np.rehearsals, true)
  `) as RehearsalRow[];
  if (!found.length) return 0;

  const claimed = new Set(
    (
      (await sql`
        insert into notification_log (user_id, kind, ref)
        select u, 'rehearsal', r from unnest(${found.map((f) => f.user_id)}::uuid[], ${found.map((f) => f.ref)}::text[]) as x(u, r)
        on conflict do nothing
        returning user_id || ' ' || ref as key
      `) as { key: string }[]
    ).map((r) => r.key)
  );

  let sent = 0;
  for (const f of found) {
    if (!claimed.has(`${f.user_id} ${f.ref}`)) continue;
    const reached = await sendToUser(f.user_id, {
      title: `${f.label} in ${REHEARSAL_LEAD_MIN} minutes`,
      body: `${f.planet} · starts at ${clockLabel(f.minute)}.`,
      url: "/village",
      tag: `rehearsal-${f.rehearsal_id}`,
    }).catch(() => 0);
    if (reached) sent++;
    else await release(f.user_id, "rehearsal", [f.ref]);
  }
  return sent;
}

/* -------------------------------------------------------------- helpers */

/** Open quests due today, locally, per person: the number on the app icon. */
async function dueTodayCounts(userIds: string[]): Promise<Map<string, number>> {
  const rows = (await sql`
    with zones as (
      select pr.id as user_id,
             coalesce((select name from pg_timezone_names where name = pr.timezone), 'UTC') as tz
        from profiles pr where pr.id = any(${userIds}::uuid[])
    )
    select z.user_id, count(t.id)::int as n
      from zones z
      left join todos t
        on t.user_id = z.user_id and t.status = 'open' and t.due_date is not null
       and (t.due_date at time zone z.tz)::date = (now() at time zone z.tz)::date
     group by z.user_id
  `) as { user_id: string; n: number }[];
  return new Map(rows.map((r) => [r.user_id, r.n]));
}

function fromNow(ms: number): string {
  const min = Math.max(1, Math.round((ms - Date.now()) / 60_000));
  if (min < 90) return `in ${min} min`;
  const h = Math.round(min / 60);
  return h < 36 ? `in ${h} hours` : `in ${Math.round(h / 24)} days`;
}

/** "A, B and C", or "A, B and 3 more" once it gets long. */
function listTitles(titles: string[]): string {
  const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
  const shown = titles.slice(0, 2).map(clip);
  const rest = titles.length - shown.length;
  if (rest <= 0) return shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0];
  if (rest === 1) return `${shown.join(", ")} and ${clip(titles[2])}`;
  return `${shown.join(", ")} and ${rest} more`;
}
