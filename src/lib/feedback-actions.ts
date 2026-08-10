"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { OWNER_EMAIL } from "@/lib/owner";
import { weekKey } from "@/lib/updates";

/* --------------------------------------------------------------------------
   Feedback, and the "seen this week's changelog" marker.

   The anonymity here is real rather than promised. Submitting requires a valid
   session — that is what lets the rate limiter work and keeps strangers out —
   but when someone chooses anonymous, the identity is used to authorise the
   request and then thrown away instead of written down. There is no hidden
   `user_id` beside an `anonymous` flag for the reader to peek at.
   -------------------------------------------------------------------------- */

const MAX_BODY = 4000;

export type FeedbackResult = { ok: true } | { ok: false; error: string };

export async function submitFeedback(
  body: string,
  anonymous: boolean
): Promise<FeedbackResult> {
  const userId = await requireUserId();

  const text = body.trim();
  if (!text) return { ok: false, error: "Write something first." };
  if (text.length > MAX_BODY)
    return { ok: false, error: `Please keep it under ${MAX_BODY} characters.` };

  // Keyed by the account even for anonymous notes: the limiter needs to know
  // who is asking, the table does not.
  if (await rateLimited("feedback", userId))
    return { ok: false, error: TOO_MANY };

  try {
    if (anonymous) {
      // No user id, and the timestamp is rounded to the hour. A to-the-second
      // stamp on a handful of users is often enough to identify the author.
      await sql`
        insert into feedback (user_id, body, created_at)
        values (null, ${text.slice(0, MAX_BODY)}, date_trunc('hour', now()))
      `;
    } else {
      await sql`
        insert into feedback (user_id, body)
        values (${userId}::uuid, ${text.slice(0, MAX_BODY)})
      `;
    }

    revalidatePath("/feedback");
    return { ok: true };
  } catch (e) {
    console.error("[feedback]", e);
    return { ok: false, error: "Could not send that. Please try again." };
  }
}

/* ========================================================================== */
/* The inbox — owner only                                                     */
/* ========================================================================== */

export type FeedbackNote = {
  id: string;
  body: string;
  created_at: string;
  /** Null for anonymous notes, and not recoverable. */
  from: { username: string; display_name: string } | null;
};

/** True only for the account whose email matches OWNER_EMAIL. */
export async function amOwner(): Promise<boolean> {
  const userId = await requireUserId();
  try {
    const rows = (await sql`
      select 1 from users
       where id = ${userId}::uuid and email = ${OWNER_EMAIL}
    `) as unknown[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Every note, newest first. Re-checks ownership itself rather than trusting a
 * caller to have done it — this is the one read in the app that returns other
 * people's words, so the gate belongs next to the query.
 */
export async function listFeedback(): Promise<FeedbackNote[]> {
  if (!(await amOwner())) return [];

  const rows = (await sql`
    select f.id, f.body, f.created_at,
           u.username::text as username,
           p.display_name
      from feedback f
      left join users u    on u.id = f.user_id
      left join profiles p on p.id = f.user_id
     order by f.created_at desc, f.id desc
     limit 300
  `) as {
    id: string;
    body: string;
    created_at: Date | string;
    username: string | null;
    display_name: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    created_at:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    from: r.username
      ? { username: r.username, display_name: r.display_name ?? r.username }
      : null,
  }));
}

/**
 * Mark a note resolved by deleting it. Owner only, and irreversible — there is
 * no archive, so the inbox stays a list of things still to deal with.
 */
export async function resolveFeedback(id: string): Promise<FeedbackResult> {
  if (!(await amOwner()))
    return { ok: false, error: "Not allowed." };

  try {
    await sql`delete from feedback where id = ${id}::uuid`;
    revalidatePath("/feedback");
    return { ok: true };
  } catch (e) {
    console.error("[feedback] resolve", e);
    return { ok: false, error: "Could not remove that." };
  }
}

/* ========================================================================== */
/* Weekly updates                                                             */
/* ========================================================================== */

/** Remembers that this week's changelog has been shown, so it stops asking. */
export async function markUpdatesSeen(week: string): Promise<void> {
  const userId = await requireUserId();

  // Only ever a week key, and never one from the future — a bad value here
  // would either re-show the popup forever or silence it permanently.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || week > weekKey()) return;

  await sql`
    update profiles set updates_seen = ${week} where id = ${userId}::uuid
  `;
  revalidatePath("/");
}
