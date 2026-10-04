"use server";

import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { cleanBody, type JournalEntry } from "@/lib/journal";

/* --------------------------------------------------------------------------
   The notebook on your desk. Every statement is scoped by user_id: an entry
   is only ever read, changed or deleted by the person who wrote it.
   -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; body: string; created_at: unknown; updated_at: unknown };
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
const view = (r: Row): JournalEntry => ({ id: r.id, body: r.body, at: ms(r.created_at), edited: ms(r.updated_at) });

/** My entries, newest first. `null` if the journal isn't there yet (db/schema.sql not run). */
export async function listJournal(): Promise<JournalEntry[] | null> {
  const me = await requireUserId();
  try {
    const rows = (await sql`
      select id, body, created_at, updated_at from journal_entries
       where user_id = ${me}::uuid
       order by created_at desc
       limit 500
    `) as Row[];
    return rows.map(view);
  } catch (e) {
    if (/relation .* does not exist/i.test(String(e))) return null;
    throw e;
  }
}

/** Begins an entry (`id` null) or saves a change to one of mine. */
export async function saveJournalEntry(
  id: string | null,
  text: string
): Promise<{ ok: true; entry: JournalEntry } | { ok: false; error: string }> {
  const me = await requireUserId();
  const body = cleanBody(text);
  if (!body) return { ok: false, error: "Write something first." };
  if (id !== null && !UUID.test(id)) return { ok: false, error: "That entry isn't there." };
  if (await rateLimited("journal", me)) return { ok: false, error: TOO_MANY };

  const rows = (id
    ? await sql`
        update journal_entries set body = ${body}, updated_at = now()
         where id = ${id}::uuid and user_id = ${me}::uuid
        returning id, body, created_at, updated_at
      `
    : await sql`
        insert into journal_entries (user_id, body) values (${me}::uuid, ${body})
        returning id, body, created_at, updated_at
      `) as Row[];
  if (!rows[0]) return { ok: false, error: "That entry isn't there." };
  return { ok: true, entry: view(rows[0]) };
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const me = await requireUserId();
  if (!UUID.test(id)) return;
  await sql`delete from journal_entries where id = ${id}::uuid and user_id = ${me}::uuid`;
}
