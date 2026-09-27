import { getUserId } from "@/lib/session";
import { pulse } from "@/lib/village-server";
import type { Place } from "@/lib/village";

/* --------------------------------------------------------------------------
   The village's check-in: "I'm here" in, "here's everyone" out. Polled every
   few seconds while the village is open, and less often by the session timer
   elsewhere in the app (which sends no place, so it doesn't move you).

   A route rather than a server action on purpose: actions queue one at a
   time, and a check-in every five seconds would hold up the ones people
   actually click.
   -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readPlace(raw: unknown): Place | null {
  const p = raw as { kind?: unknown; hostId?: unknown } | null;
  switch (p?.kind) {
    case "home":
    case "square":
    case "hall":
      return { kind: p.kind };
    case "house":
      return typeof p.hostId === "string" && UUID.test(p.hostId) ? { kind: "house", hostId: p.hostId } : null;
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const me = await getUserId();
  if (!me) return Response.json({ error: "signed out" }, { status: 401 });

  let body: { place?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* no body: a check-in without a place */
  }

  try {
    return Response.json(await pulse(me, readPlace(body.place)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    const missing = /relation .* does not exist|function .* does not exist/i.test(String(e));
    return Response.json({ error: missing ? "village not set up" : "check-in failed" }, { status: missing ? 503 : 500 });
  }
}
