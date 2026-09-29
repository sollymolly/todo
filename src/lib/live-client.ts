"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* --------------------------------------------------------------------------
   The village page's live connection (src/app/api/village/live). Keeps one
   socket open while the village is, tells the server which space we're in,
   sends where we stand and our duel swings, and hands on what arrives:
   someone's position, a duel blow, or a poke to check in now.

   Always optional. Until it's connected — and whenever it drops — the page
   polls exactly as it did before; `connected` is how it knows to poll less.
   Where sockets can't open at all (`next dev`, the feature switched off),
   it stops trying after a few attempts and only checks again now and then.
   -------------------------------------------------------------------------- */

export type LivePos = { id: string; x: number; y: number; f: number; g: boolean };
export type LiveBlow =
  | { t: "hit"; duel: string; by: string; target: string; a: number; b: number }
  | { t: "block"; by: string; target: string };

const GIVE_UP_AFTER = 3;
const RETRY_LATER_MS = 5 * 60_000;

export function useVillageLive(
  space: string | null,
  on: { pos: (p: LivePos) => void; poke: () => void; blow: (b: LiveBlow) => void; open: () => void }
): {
  connected: boolean;
  sendPos: (x: number, y: number, f: number, g: boolean) => void;
  sendHit: () => void;
} {
  const [connected, setConnected] = useState(false);
  const sock = useRef<WebSocket | null>(null);
  const spaceRef = useRef(space);
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  });

  // Say where we are whenever that changes, and on every (re)connect.
  useEffect(() => {
    spaceRef.current = space;
    const s = sock.current;
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t: "join", space }));
  }, [space]);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let delay = 1000;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let opened = false;
      let s: WebSocket;
      try {
        s = new WebSocket(`${proto}//${location.host}/api/village/live`);
      } catch {
        return;
      }
      sock.current = s;

      s.onopen = () => {
        opened = true;
        failures = 0;
        delay = 1000;
        setConnected(true);
        s.send(JSON.stringify({ t: "join", space: spaceRef.current }));
        onRef.current.open();
        // Anything missed while disconnected: catch up now.
        onRef.current.poke();
      };
      s.onmessage = (e) => {
        let m: { t?: string; id?: unknown; x?: unknown; y?: unknown; f?: unknown; g?: unknown };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === "poke") onRef.current.poke();
        else if (m.t === "pos" && typeof m.id === "string")
          onRef.current.pos({ id: m.id, x: Number(m.x), y: Number(m.y), f: Number(m.f), g: m.g === 1 });
        else if (m.t === "hit" || m.t === "block") onRef.current.blow(m as LiveBlow);
      };
      s.onclose = () => {
        if (sock.current === s) sock.current = null;
        setConnected(false);
        if (closed) return;
        if (!opened && ++failures >= GIVE_UP_AFTER) {
          failures = 0;
          timer = setTimeout(connect, RETRY_LATER_MS);
          return;
        }
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };

    connect();

    // A phone that slept has a dead socket it doesn't know about yet.
    const onVis = () => {
      if (document.visibilityState === "visible" && !sock.current && !closed) {
        clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      sock.current?.close();
      sock.current = null;
    };
  }, []);

  const sendPos = useCallback((x: number, y: number, f: number, g: boolean) => {
    const s = sock.current;
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t: "pos", x, y, f, g: g ? 1 : 0 }));
  }, []);

  const sendHit = useCallback(() => {
    const s = sock.current;
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t: "hit" }));
  }, []);

  return { connected, sendPos, sendHit };
}
