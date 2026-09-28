import { getUserId } from "@/lib/session";
import { pulse } from "@/lib/village-server";
import type { Place, Pos } from "@/lib/village";

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
    case "inside":
      return typeof p.hostId === "string" && UUID.test(p.hostId) ? { kind: p.kind, hostId: p.hostId } : null;
    case "arena":
      return { kind: "arena" };
    default:
      return null;
  }
}

function readPos(raw: unknown): Pos | null {
  const p = raw as { x?: unknown; y?: unknown; facing?: unknown } | null;
  const x = Number(p?.x);
  const y = Number(p?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 200 || Math.abs(y) > 200) return null;
  const f = Number(p?.facing);
  return { x, y, facing: (Number.isInteger(f) && f >= 0 && f <= 3 ? f : 2) as Pos["facing"] };
}

export async function POST(request: Request) {
  const me = await getUserId();
  if (!me) return Response.json({ error: "signed out" }, { status: 401 });

  let body: { place?: unknown; pos?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* no body: a check-in without a place */
  }

  try {
    return Response.json(await pulse(me, readPlace(body.place), readPos(body.pos)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    const missing = /relation .* does not exist|function .* does not exist/i.test(String(e));
    return Response.json({ error: missing ? "village not set up" : "check-in failed" }, { status: missing ? 503 : 500 });
  }
}
