"use client";

import { useSyncExternalStore } from "react";

/* --------------------------------------------------------------------------
   Whether the background's drifting dust is on. A per-device preference, so
   it lives in localStorage — it's a matter of taste on this screen, not a
   setting worth an account.

   Read through useSyncExternalStore so the server render (which can't see
   localStorage) and the first client render agree, and every open page
   follows a change at once. Storage can be missing or refuse writes — a
   private window, blocked site data — and then the dust simply stays on.
   -------------------------------------------------------------------------- */

const KEY = "habitknight.backdropMotion";
const EVENT = "habitknight:backdrop-motion";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useBackdropMotion(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const set = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable — the choice lasts until reload at best */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [on, set];
}
