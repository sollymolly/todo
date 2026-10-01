import { getUserId } from "@/lib/session";
import { pulse, releasePresence } from "@/lib/village-server";
import type { Place, Pos } from "@/lib/village";

/* --------------------------------------------------------------------------
   The village's check-in: "I'm here" in, "here's everyone" out. Polled every
   few seconds while the village is open, and less often from anywhere else
   in the app (Presence.tsx: "at home"). With no place, it moves nobody and
   only keeps a seat at a table.

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
    case "library":
    case "store":
      return { kind: p.kind };
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

/** Which village they're in: a small whole number, or none (wherever they last were). */
function readVillage(raw: unknown): number | null {
  const v = Number(raw);
  return raw != null && Number.isInteger(v) && v >= 0 && v < 100_000 ? v : null;
}

/** Which of someone's open apps is asking: an id it made up for itself. */
function readDevice(raw: unknown): string | null {
  return typeof raw === "string" && /^[\w-]{8,64}$/.test(raw) ? raw : null;
}

export async function POST(request: Request) {
  const me = await getUserId();
  if (!me) return Response.json({ error: "signed out" }, { status: 401 });

  // The body can arrive as text/plain: the app sends its goodbye with
  // navigator.sendBeacon as it closes.
  let body: { place?: unknown; pos?: unknown; device?: unknown; release?: unknown; village?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* no body: a check-in without a place */
  }

  // { release: device }: that app is closing (session-store.ts).
  const leaving = readDevice(body.release);
  if (leaving) {
    await releasePresence(me, leaving);
    return new Response(null, { status: 204 });
  }

  try {
    return Response.json(await pulse(me, readPlace(body.place), readPos(body.pos), readDevice(body.device), readVillage(body.village)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    const missing = /relation .* does not exist|function .* does not exist|column .* does not exist/i.test(String(e));
    return Response.json({ error: missing ? "village not set up" : "check-in failed" }, { status: missing ? 503 : 500 });
  }
}
