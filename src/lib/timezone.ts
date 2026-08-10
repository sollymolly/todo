"use server";

import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/* --------------------------------------------------------------------------
   Timezone support, deliberately kept to one file.

   Habits need to know when "the next day" starts, and that only means
   something in a place. The browser is the only thing that reliably knows which
   place, so it reports its IANA zone once and the value is stored on the
   profile. Every SQL read of it goes through `coalesce(timezone, 'UTC')`.

   TO REMOVE THIS FEATURE
   ----------------------
   Delete this file, drop <TimezoneSync /> from the dashboard, and
   `alter table profiles drop column timezone`. Nothing else needs touching:
   the coalesce in migration 013 means every query stays valid and habits simply
   roll over at UTC midnight for everyone.
   -------------------------------------------------------------------------- */

/** IANA names only: letters, digits and the handful of separators they use. */
const ZONE = /^[A-Za-z0-9+_\-/]{1,64}$/;

/**
 * Stores the caller's timezone if it has changed. Called from the client on
 * load, so it must be cheap and must never throw into the render.
 */
export async function reportTimezone(zone: string): Promise<void> {
  const userId = await requireUserId();
  if (!ZONE.test(zone)) return;

  try {
    // Postgres validates the name for us — an unknown zone raises rather than
    // being stored and quietly breaking every date calculation later.
    const ok = (await sql`
      select exists (
        select 1 from pg_timezone_names where name = ${zone}
      ) as ok
    `) as { ok: boolean }[];
    if (!ok[0]?.ok) return;

    await sql`
      update profiles set timezone = ${zone}
       where id = ${userId}::uuid
         and coalesce(timezone, '') <> ${zone}
    `;
  } catch {
    /* Habits fall back to UTC. Not worth surfacing to anyone. */
  }
}
