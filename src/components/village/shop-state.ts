"use client";

import { useEffect, useSyncExternalStore } from "react";
import { loadShop, type ShopState } from "@/lib/village-actions";

/* --------------------------------------------------------------------------
   What I own and can spend at the store, shared by its counter
   (ShopPanel.tsx) and the house and room pickers, so a roof bought a moment
   ago is there to choose straight away. Loaded the first time it's asked
   for.
   -------------------------------------------------------------------------- */

let state: ShopState | null = null;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

export function setShop(s: ShopState) {
  state = s;
  listeners.forEach((l) => l());
}

export function useShop(): ShopState | null {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null
  );
  useEffect(() => {
    loading ??= loadShop()
      .then(setShop)
      .catch(() => {
        loading = null;
      });
  }, []);
  return s;
}

/** Whether a store-only option (a "roof:…", "wall:…" or "floor:…") is mine to pick. */
export function ownsGood(shop: ShopState | null, id: string): boolean {
  return !!shop?.owned.includes(id);
}
