import Redis from "ioredis";
import type { WebSocket } from "ws";
import { CHANNEL, publishLive, type LiveMessage } from "@/lib/live";

/* --------------------------------------------------------------------------
   One server instance's share of the live village: the sockets it holds,
   which space each is in, and one Redis subscription per space that any of
   them is in. See live.ts for what the messages are.

   From the browser:
     { t: "join", space }   I'm in this space now (null: nowhere shared)
     { t: "pos", x, y, f }  where I'm standing, in tiles

   Who hears what follows village-rooms.ts: inside a house everyone sees
   everyone; in the arena, only your companions' positions reach you (a
   stranger's knight still turns up through the ordinary check-in, which
   applies the fuller rules). A poke says nothing, so it goes to everyone.
   -------------------------------------------------------------------------- */

type Conn = { ws: WebSocket; me: string; known: Set<string>; space: string | null; sent: number[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Positions a socket may send per second: plenty for walking, not a flood. */
const POS_PER_SECOND = 6;

const bySpace = new Map<string, Set<Conn>>();
let sub: Redis | null = null;

function subscriber(): Redis {
  if (sub) return sub;
  sub = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null, lazyConnect: false });
  sub.on("message", (channel: string, raw: string) => {
    const space = channel.slice(CHANNEL.length);
    const conns = bySpace.get(space);
    if (!conns) return;
    let msg: LiveMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    for (const c of conns) {
      if (msg.t === "pos") {
        if (c.me === msg.id) continue;
        if (!space.startsWith("inside:") && !c.known.has(msg.id)) continue;
      }
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
  if (space === "arena" || space === "hall") return true;
  if (!space.startsWith("inside:")) return false;
  const host = space.slice("inside:".length);
  return UUID.test(host) && (host === c.me || c.known.has(host));
}

function leave(c: Conn) {
  const space = c.space;
  if (!space) return;
  c.space = null;
  const conns = bySpace.get(space);
  conns?.delete(c);
  if (conns && conns.size === 0) {
    bySpace.delete(space);
    void sub?.unsubscribe(CHANNEL + space).catch(() => {});
  }
  // Whoever's still there should see them go now, not at the next check-in.
  void publishLive(space, { t: "poke" });
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
  void publishLive(space, { t: "poke" });
}

function onPos(c: Conn, m: { x?: unknown; y?: unknown; f?: unknown }) {
  if (!c.space || c.space === "hall") return; // the hall has no floor to stand on
  const now = Date.now();
  c.sent = c.sent.filter((t) => now - t < 1000);
  if (c.sent.length >= POS_PER_SECOND) return;
  const x = Number(m.x);
  const y = Number(m.y);
  const f = Number(m.f);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 200 || Math.abs(y) > 200) return;
  c.sent.push(now);
  void publishLive(c.space, {
    t: "pos",
    id: c.me,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    f: Number.isInteger(f) && f >= 0 && f <= 3 ? f : 2,
  });
}

/** Takes over a freshly upgraded socket for the rest of its life. */
export function attach(ws: WebSocket, me: string, known: Set<string>) {
  const c: Conn = { ws, me, known, space: null, sent: [] };

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
    } else if (m.t === "pos") onPos(c, m as { x?: unknown; y?: unknown; f?: unknown });
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
