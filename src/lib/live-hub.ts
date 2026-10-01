import Redis from "ioredis";
import type { WebSocket } from "ws";
import { CHANNEL, poke, publishLive, type LiveMessage } from "@/lib/live";
import { HIT_COOLDOWN_MS, HIT_GRACE_MS, type Facing, type Stance } from "@/lib/duel";
import { landHit } from "@/lib/village-rooms";
import { readSpace } from "@/lib/village";

/** A village's arena: where stances are kept and swings judged. */
const isArena = (space: string | null) => readSpace(space ?? "")?.kind === "arena";
/** Outside in a village: everyone in it, so nobody is poked on the way in or out. */
const isOutside = (space: string) => readSpace(space)?.kind === "village";

/* --------------------------------------------------------------------------
   One server instance's share of the live village: the sockets it holds,
   which space each is in, and one Redis subscription per space that any of
   them is in. See live.ts for what the messages are.

   From the browser:
     { t: "join", space }      I'm in this space now (null: nowhere shared)
     { t: "pos", x, y, f, g }  where I'm standing, in tiles; g = guarding
     { t: "hit" }              a swing, in a duel

   Positions reach everyone in the same space: a house, the arena, or
   "village" — everywhere outside, one map for everyone, so strangers there
   see each other too (as a knight and a name; the check-in never tells
   them more).

   Hits are judged here, by the instance holding the swinger's socket: it
   hears every arena position through its subscription, so it knows where
   both fighters' own screens last had them. The database keeps the score.
   -------------------------------------------------------------------------- */

type PosMessage = Extract<LiveMessage, { t: "pos" }>;

type Conn = {
  ws: WebSocket;
  me: string;
  known: Set<string>;
  space: string | null;
  /** The newest position not yet passed on, and the space it was sent from. */
  nextPos: { space: string; msg: PosMessage } | null;
  /** Whether positions are being passed on right now (pumpPos). */
  pumping: boolean;
  lastPosAt: number;
  lastHit: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The soonest one socket's positions are passed on again. The page sends
 * ~7 a second while walking; any that come quicker are folded into the next.
 */
const POS_GAP_MS = 100;
/** The longest a position's publish is waited for before the next goes anyway. */
const POS_PUBLISH_WAIT_MS = 1_000;

const bySpace = new Map<string, Set<Conn>>();
/** The latest stance of everyone in the arena, as this instance has heard it. */
const stances = new Map<string, Stance>();
let sub: Redis | null = null;

function subscriber(): Redis {
  if (sub) return sub;
  sub = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  sub.on("message", (channel: string, raw: string) => {
    const space = channel.slice(CHANNEL.length);
    let msg: LiveMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === "pos" && isArena(space))
      stances.set(msg.id, { x: msg.x, y: msg.y, f: (msg.f % 4) as Facing, g: msg.g === 1 });
    const conns = bySpace.get(space);
    if (!conns) return;
    for (const c of conns) {
      if (msg.t === "pos" && c.me === msg.id) continue;
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(raw);
    }
  });
  sub.on("error", () => {
    /* ioredis reconnects by itself; polling covers the gap */
  });
  return sub;
}

/** May this person be in this space at all? The same rule the check-in uses. */
function allowed(c: Conn, space: string): boolean {
  const s = readSpace(space);
  if (s && s.kind !== "inside" && s.kind !== "hall") return true;
  if (!space.startsWith("inside:")) return false;
  const host = space.slice("inside:".length);
  return UUID.test(host) && (host === c.me || c.known.has(host));
}

function leave(c: Conn) {
  const space = c.space;
  if (!space) return;
  c.space = null;
  c.nextPos = null;
  if (isArena(space)) stances.delete(c.me);
  const conns = bySpace.get(space);
  conns?.delete(c);
  if (conns && conns.size === 0) {
    bySpace.delete(space);
    void sub?.unsubscribe(CHANNEL + space).catch(() => {});
  }
  // Whoever's still there should see them go now, not at the next check-in.
  // Not outside: that's everyone in the village, and they'll notice soon
  // enough without all checking in at once.
  if (!isOutside(space)) void poke(space);
  if (bySpace.size === 0 && sub) {
    sub.disconnect();
    sub = null;
  }
}

function join(c: Conn, space: string) {
  if (c.space === space) return;
  leave(c);
  if (!allowed(c, space)) return;
  c.space = space;
  let conns = bySpace.get(space);
  if (!conns) {
    conns = new Set();
    bySpace.set(space, conns);
    void subscriber().subscribe(CHANNEL + space).catch(() => {});
  }
  conns.add(c);
  // Outside, a newcomer's first footstep is what makes the others look.
  if (!isOutside(space)) void poke(space);
}

function onPos(c: Conn, m: { x?: unknown; y?: unknown; f?: unknown; g?: unknown }) {
  if (!c.space) return;
  const x = Number(m.x);
  const y = Number(m.y);
  const f = Number(m.f);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 200 || Math.abs(y) > 200) return;
  const msg: PosMessage = {
    t: "pos",
    id: c.me,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    f: Number.isInteger(f) && f >= 0 && f <= 3 ? f : 2,
    g: m.g === 1 ? 1 : 0,
  };
  // Straight into this instance's picture of the arena too: a swing right
  // after a step is judged from the step.
  if (isArena(c.space)) stances.set(c.me, { x: msg.x, y: msg.y, f: msg.f as Facing, g: msg.g === 1 });
  // Only the newest matters: it replaces any still waiting to go.
  c.nextPos = { space: c.space, msg };
  void pumpPos(c);
}

/**
 * Passes a socket's positions on one publish at a time, at most one per
 * POS_GAP_MS. Each publish is its own HTTP request, so sent side by side
 * they can land out of order — and where someone stopped would be
 * overwritten by a step from just before, leaving them a step short on
 * everyone else's screen. Whatever arrives meanwhile waits, newest only,
 * so where they stopped always goes last.
 */
async function pumpPos(c: Conn) {
  if (c.pumping) return;
  c.pumping = true;
  try {
    while (c.nextPos) {
      const wait = c.lastPosAt + POS_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const next = c.nextPos;
      c.nextPos = null;
      // Moved on (or gone) while it waited: it's no use to the old space.
      if (!next || next.space !== c.space) continue;
      c.lastPosAt = Date.now();
      // A publish that hangs mustn't hold up every step after it.
      await Promise.race([publishLive(next.space, next.msg), new Promise((r) => setTimeout(r, POS_PUBLISH_WAIT_MS))]);
    }
  } finally {
    c.pumping = false;
  }
}

async function onHit(c: Conn) {
  const arena = c.space;
  if (!arena || !isArena(arena)) return;
  const now = Date.now();
  if (now - c.lastHit < HIT_COOLDOWN_MS) return;
  c.lastHit = now;
  void publishLive(arena, { t: "swing", by: c.me });
  try {
    await new Promise((r) => setTimeout(r, HIT_GRACE_MS));
    const r = await landHit(c.me, (id) => stances.get(id) ?? null);
    if (r.kind === "hit") {
      await publishLive(arena, { t: "hit", duel: r.duelId, by: c.me, target: r.target, a: r.a, b: r.b });
      if (r.over) await poke(arena);
    } else if (r.kind === "blocked") {
      await publishLive(arena, { t: "block", by: c.me, target: r.target });
    }
  } catch {
    /* a swing that couldn't be judged simply doesn't land */
  }
}

/** Takes over a freshly upgraded socket for the rest of its life. */
export function attach(ws: WebSocket, me: string, known: Set<string>) {
  const c: Conn = { ws, me, known, space: null, nextPos: null, pumping: false, lastPosAt: 0, lastHit: 0 };

  ws.on("message", (data) => {
    let m: { t?: unknown; space?: unknown };
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (m.t === "join") {
      if (typeof m.space === "string" && m.space.length <= 60) join(c, m.space);
      else leave(c);
    } else if (m.t === "pos") onPos(c, m as { x?: unknown; y?: unknown; f?: unknown; g?: unknown });
    else if (m.t === "hit") void onHit(c);
  });

  // Keeps idle connections from being dropped along the way.
  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25_000);

  ws.on("close", () => {
    clearInterval(ping);
    leave(c);
  });
  ws.on("error", () => ws.close());

  ws.send(JSON.stringify({ t: "hello" }));
}
