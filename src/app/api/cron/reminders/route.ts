import { timingSafeEqual } from "node:crypto";
import { PUSH_CONFIGURED } from "@/lib/push";
import { runReminders } from "@/lib/reminders";

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
