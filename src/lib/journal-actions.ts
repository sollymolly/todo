"use server";

import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { cleanAt, cleanBody, cleanChoice, cleanTopic, MOODS, WEATHER, type JournalDraft, type JournalEntry } from "@/lib/journal";

/* --------------------------------------------------------------------------
   The notebook on your desk. Every statement is scoped by user_id: an entry
   is only ever read, changed or deleted by the person who wrote it.
   -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; body: string; topic: string; mood: string | null; weather: string | null; created_at: unknown; updated_at: unknown };
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
const view = (r: Row): JournalEntry => ({
  id: r.id,
  body: r.body,
  topic: r.topic,
  mood: r.mood,
  weather: r.weather,
  at: ms(r.created_at),
  edited: ms(r.updated_at),
});

/** My entries, newest first. `null` if the journal isn't there yet, or is from before topics (db/schema.sql not run). */
export async function listJournal(): Promise<JournalEntry[] | null> {
  const me = await requireUserId();
  try {
    const rows = (await sql`
      select id, body, topic, mood, weather, created_at, updated_at from journal_entries
       where user_id = ${me}::uuid
       order by created_at desc
       limit 500
    `) as Row[];
    return rows.map(view);
  } catch (e) {
    if (/(relation|column) .* does not exist/i.test(String(e))) return null;
    throw e;
  }
}

/** Begins an entry (`id` null) or saves a change to one of mine. */
export async function saveJournalEntry(
  id: string | null,
  draft: JournalDraft
): Promise<{ ok: true; entry: JournalEntry } | { ok: false; error: string }> {
  const me = await requireUserId();
  const body = cleanBody(draft?.body);
  const topic = cleanTopic(draft?.topic);
  const mood = cleanChoice(draft?.mood, MOODS);
  const weather = cleanChoice(draft?.weather, WEATHER);
  const at = cleanAt(draft?.at);
  if (!body && !topic) return { ok: false, error: "Write something first." };
  if (at === null) return { ok: false, error: "That date doesn't look right." };
  if (id !== null && !UUID.test(id)) return { ok: false, error: "That entry isn't there." };
  if (await rateLimited("journal", me)) return { ok: false, error: TOO_MANY };

  const when = new Date(at).toISOString();
  const rows = (id
    ? await sql`
        update journal_entries
           set body = ${body}, topic = ${topic}, mood = ${mood}, weather = ${weather},
               created_at = ${when}::timestamptz, updated_at = now()
         where id = ${id}::uuid and user_id = ${me}::uuid
        returning id, body, topic, mood, weather, created_at, updated_at
      `
    : await sql`
        insert into journal_entries (user_id, body, topic, mood, weather, created_at)
        values (${me}::uuid, ${body}, ${topic}, ${mood}, ${weather}, ${when}::timestamptz)
        returning id, body, topic, mood, weather, created_at, updated_at
      `) as Row[];
  if (!rows[0]) return { ok: false, error: "That entry isn't there." };
  return { ok: true, entry: view(rows[0]) };
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const me = await requireUserId();
  if (!UUID.test(id)) return;
  await sql`delete from journal_entries where id = ${id}::uuid and user_id = ${me}::uuid`;
}
