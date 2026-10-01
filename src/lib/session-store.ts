"use client";

import { useSyncExternalStore } from "react";
import type { Pulse, SessionView } from "@/lib/village";

/* --------------------------------------------------------------------------
   The latest check-in, shared. The village writes it every few seconds while
   it's open; Presence.tsx writes it, less often, from everywhere else.
   Either way there's one answer to "which table am I at", so the session
   timer and the village can't disagree.

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

/**
 * A duel hit, as the live connection reported it: the fighters' health now,
 * before the next check-in brings the rest. The clock offset stays as it is.
 */
export function patchDuelHp(duelId: string, a: number, b: number) {
  if (!state.pulse) return;
  const duels = state.pulse.duels.map((d) => (d.id === duelId && d.hp ? { ...d, hp: { ...d.hp, a, b } } : d));
  state = { ...state, pulse: { ...state.pulse, duels } };
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

/**
 * While the village is open: where I am in it. A check-in from anything
 * else on the page (a duel's buttons, a table's) then says the same, rather
 * than "nowhere in particular" — which answers with no room, and would empty
 * the room I'm standing in until the village's own next check-in.
 */
let villageWhere: (() => { place: unknown; pos: unknown; village?: number }) | null = null;
export function setVillageWhere(fn: typeof villageWhere) {
  villageWhere = fn;
}

/**
 * Which open app this is: made up once per tab, and kept across reloads.
 * Signed in on two, the first one in keeps the village until it's closed
 * (village_presence.device in db/schema.sql).
 */
let device: string | null = null;
function deviceId(): string {
  if (device) return device;
  try {
    device = sessionStorage.getItem("ql:device");
    if (!device) sessionStorage.setItem("ql:device", (device = crypto.randomUUID()));
  } catch {
    device ??= crypto.randomUUID();
  }
  return device;
}

/** Check-ins sent, and the latest whose answer has been published. */
let sent = 0;
let shown = 0;

/**
 * One check-in. `place` null: don't move me, just keep my seat. `village`:
 * which village I'm in (none: wherever I last was).
 */
export async function checkIn(place: unknown, pos: unknown = null, village?: number): Promise<Pulse | null> {
  if (place == null && villageWhere) ({ place, pos, village } = villageWhere());
  const n = ++sent;
  try {
    const res = await fetch("/api/village/pulse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ place, pos, village, device: deviceId() }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const p = (await res.json()) as Pulse;
    // Answers can overtake each other. One older than what's showing would
    // put everyone back where they were a moment ago.
    if (n > shown) {
      shown = n;
      publishPulse(p);
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * Keeps my seat at a table and nothing else: for while the app is hidden,
 * when I'm not around to be seen but am still working. Its answer isn't
 * shown — nobody's looking, and it has no room in it.
 */
export function keepSeat() {
  void fetch("/api/village/pulse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ place: null }),
    cache: "no-store",
  }).catch(() => {});
}

/**
 * The app is closing: if friends see me through this one, I'm offline now,
 * and another of my devices can take over at once. A beacon, because it's
 * the one request a closing page still gets to send.
 */
export function releaseDevice() {
  if (!device) return; // never checked in, so never had the village
  try {
    navigator.sendBeacon("/api/village/pulse", JSON.stringify({ release: device }));
  } catch {
    /* it goes stale in a minute anyway */
  }
}
