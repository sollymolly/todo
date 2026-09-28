import { timingSafeEqual } from "node:crypto";
import { PUSH_CONFIGURED } from "@/lib/push";
import { runReminders } from "@/lib/reminders";
import { sweepSessions } from "@/lib/village-server";
import { sql } from "@/lib/db";

/* --------------------------------------------------------------------------
   Called every five minutes by an outside scheduler (cron-job.org), with
   `Authorization: Bearer <CRON_SECRET>`. Sends whatever deadline reminders
   and morning summaries are due — see src/lib/reminders.ts. Safe to call
   more often, or twice at once: nothing is ever sent twice.

   Outside the sign-in gate (src/proxy.ts), so the secret is the only lock.
   -------------------------------------------------------------------------- */

export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function handle(request: Request) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });

  // Work-session tables nobody's checked in at lately: close them, and pay
  // what was earned. Runs whether or not push is set up.
  await sweepSessions().catch(() => {
    /* db/schema.sql not run yet */
  });
  // Talk is only kept for an hour; challenges nobody answered expire; a duel
  // both fighters walked away from is closed with no winner.
  await sql`delete from space_chat where created_at < now() - interval '1 hour'`.catch(() => {});
  await sql`
    update duels set status = case when status = 'pending' then 'expired' else 'done' end,
                     round_ends = null, updated_at = now()
     where (status = 'pending' and created_at < now() - interval '60 seconds')
        or (status = 'active' and updated_at < now() - interval '10 minutes')
  `.catch(() => {});
  if (!PUSH_CONFIGURED) return Response.json({ skipped: "push keys not set" });
  try {
    return Response.json(await runReminders());
  } catch (e) {
    // The scheduler shows this in its history; keep it to the gist.
    console.error("reminders failed", e);
    return Response.json({ error: "reminders failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
