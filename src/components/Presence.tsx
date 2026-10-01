"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { checkIn, keepSeat, releaseDevice, useSessionStore } from "@/lib/session-store";
import { APP_PULSE_MS } from "@/lib/village";

/* --------------------------------------------------------------------------
   Being in the app counts for something in the village. Anywhere but the
   village itself (which checks in for itself, every few seconds), friends
   see me "at home": by my own front door, or still in my seat at a table
   if I'm in a work session — going off to finish a quest doesn't take me
   away from it.

   Only while the app is in view, though. Hidden, I'm offline once my last
   check-in goes stale — but a seat at a table is still kept, since working
   somewhere else is the point of one. Closing the app says so at once.
   -------------------------------------------------------------------------- */

const HOME = { kind: "home" } as const;

export default function Presence() {
  const inVillage = usePathname() === "/village";
  const { mine } = useSessionStore();
  const seated = useRef(!!mine);
  useEffect(() => {
    seated.current = !!mine;
  }, [mine]);

  useEffect(() => {
    if (inVillage) return;
    const beat = () => {
      if (document.visibilityState === "visible") void checkIn(HOME);
      else if (seated.current) keepSeat();
    };
    beat();
    const id = setInterval(beat, APP_PULSE_MS);
    const onVis = () => document.visibilityState === "visible" && void checkIn(HOME);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [inVillage]);

  // Closing the app (or leaving it for another site) frees this device's
  // hold on the village, for any other I'm signed in on.
  useEffect(() => {
    window.addEventListener("pagehide", releaseDevice);
    return () => window.removeEventListener("pagehide", releaseDevice);
  }, []);

  return null;
}
