import { Redis } from "@upstash/redis";

/* --------------------------------------------------------------------------
   The village's live layer: the server's half of "tell everyone in this
   space, now". The database stays the source of truth for everything; this
   only carries two kinds of message between browsers in the same space:

     pos   where someone is standing, straight from their screen
     poke  "something changed here — check in now" (a line said, a duel
           starting, someone arriving). Carries nothing, so it can't leak.
     swing  someone in the arena swung, so everyone sees it at once
     hit / block   a duel blow the server judged (live-hub.ts), so
           everyone watching sees it the moment it lands

   Messages go through Redis pub/sub so every server instance hears them —
   a WebSocket is pinned to one instance, and the people in a room may be
   spread across several. Publishing uses Upstash's HTTP API (one request,
   nothing to keep open); the subscriber side is in live-hub.ts.

   Switched off by VILLAGE_LIVE=off, or simply by Redis not being set up:
   every publish becomes a no-op and the village falls back to polling.
   -------------------------------------------------------------------------- */

export type LiveMessage =
  /* g: guarding (duels). j: how many times they've jumped — a new number is a new jump. */
  /* h: how finely they face, 0-15 clockwise from up (heading.ts); f is the same in four. */
  | { t: "pos"; id: string; x: number; y: number; f: number; g: 0 | 1; j?: number; h?: number }
  | { t: "poke" }
  /* A duel hit that landed: the fighters' health after it. */
  | { t: "hit"; duel: string; by: string; target: string; a: number; b: number }
  /* A hit caught on a guard. */
  | { t: "block"; by: string; target: string }
  /* Someone swung, hit or miss: everyone watching sees the swing. */
  | { t: "swing"; by: string };

export const CHANNEL = "ql:space:";

export function liveEnabled(): boolean {
  return (
    process.env.VILLAGE_LIVE !== "off" &&
    !!process.env.KV_REST_API_URL &&
    !!process.env.KV_REST_API_TOKEN &&
    !!process.env.REDIS_URL
  );
}

let client: Redis | null = null;
function redis(): Redis | null {
  if (!liveEnabled()) return null;
  client ??= new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
  return client;
}

/**
 * Sends a message to everyone in a space. Never throws and never holds up
 * the caller for long: a lost poke only means people see the change at the
 * next ordinary check-in instead.
 */
export async function publishLive(space: string, msg: LiveMessage): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    await r.publish(CHANNEL + space, JSON.stringify(msg));
  } catch {
    /* polling covers it */
  }
}

/** The common case: "something changed in this space". */
export function poke(space: string): Promise<void> {
  return publishLive(space, { t: "poke" });
}
