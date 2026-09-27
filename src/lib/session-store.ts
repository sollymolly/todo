"use client";

import { useSyncExternalStore } from "react";
import type { Pulse, SessionView } from "@/lib/village";

/* --------------------------------------------------------------------------
   The latest check-in, shared. The village writes it every few seconds while
   it's open; the session timer (SessionPill) writes it, less often, from
   everywhere else. Either way there's one answer to "which table am I at",
   so the two can't disagree.

   Also keeps the offset between this device's clock and the server's, so a
   shared focus clock reads the same on every phone at the table.
   -------------------------------------------------------------------------- */

type State = {
  pulse: Pulse | null;
  /** server time − local time, in ms */
  skew: number;
  /** My table, if I'm at one. */
  mine: SessionView | null;
};

let state: State = { pulse: null, skew: 0, mine: null };
const listeners = new Set<() => void>();

export function publishPulse(p: Pulse) {
  const mine = p.mySessionId ? (p.sessions.find((s) => s.id === p.mySessionId) ?? null) : null;
  state = { pulse: p, skew: p.now - Date.now(), mine };
  listeners.forEach((l) => l());
}

/** Forget the table straight away (left it), before the next check-in confirms. */
export function clearMySession() {
  if (!state.pulse) return;
  publishPulse({ ...state.pulse, mySessionId: null });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: State = { pulse: null, skew: 0, mine: null };

export function useSessionStore(): State {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export function serverNow(skew: number) {
  return Date.now() + skew;
}

/** One check-in. `place` null: don't move me, just keep my seat. */
export async function checkIn(place: unknown): Promise<Pulse | null> {
  try {
    const res = await fetch("/api/village/pulse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ place }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const p = (await res.json()) as Pulse;
    publishPulse(p);
    return p;
  } catch {
    return null;
  }
}
