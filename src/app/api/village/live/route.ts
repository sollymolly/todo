import { experimental_upgradeWebSocket } from "@vercel/functions";
import { getUserId } from "@/lib/session";
import { liveEnabled } from "@/lib/live";
import { attach } from "@/lib/live-hub";
import { friendIdsOf } from "@/lib/village-server";

/* --------------------------------------------------------------------------
   The village's live connection: a WebSocket per open village, carrying
   positions and "check in now" pokes between people in the same space.
   See src/lib/live.ts.

   Anything short of a working socket answers with an error status, and the
   page simply keeps polling /api/village/pulse as it always has: signed
   out, switched off (VILLAGE_LIVE=off or no Redis), or a runtime without
   WebSocket upgrades — which includes `next dev` (use `vc dev` locally).

   A connection lasts at most maxDuration; the page reconnects.
   -------------------------------------------------------------------------- */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const me = await getUserId();
  if (!me) return new Response("signed out", { status: 401 });
  if (!liveEnabled()) return new Response("live village is off", { status: 503 });

  // Friends are read once per connection; one made mid-connection is picked
  // up at the next reconnect, at most a few minutes later.
  const known = new Set(await friendIdsOf(me).catch(() => [] as string[]));

  try {
    return await experimental_upgradeWebSocket((ws) => attach(ws, me, known), { maxPayload: 4 * 1024 });
  } catch {
    return new Response("WebSockets aren't available here", { status: 501 });
  }
}
