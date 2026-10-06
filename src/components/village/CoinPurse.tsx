"use client";

import { useEffect } from "react";
import { setShop, useShop } from "@/components/village/shop-state";
import { loadShop } from "@/lib/village-actions";
import { XP_PER_COIN } from "@/lib/shop";

/* --------------------------------------------------------------------------
   My coins, always in sight in the village: a little gold coin that turns
   now and then, and the count, which pops when it changes. Fetched fresh
   when the village opens (coins come with XP, earned anywhere in the app);
   buying at the store or the bakery updates it straight away (shop-state.ts).
   -------------------------------------------------------------------------- */

export default function CoinPurse() {
  const shop = useShop();
  useEffect(() => {
    loadShop()
      .then(setShop)
      .catch(() => undefined);
  }, []);
  const coins = shop?.coins;
  return (
    <span
      role="status"
      aria-label={coins == null ? "Counting your coins" : `${coins} coin${coins === 1 ? "" : "s"}`}
      title={`Your coins: one for every ${XP_PER_COIN} XP. Spend them at the store and the bakery.`}
      className="panel flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-bold text-amber-900"
    >
      <Coin />
      <span key={coins ?? "…"} className="coin-pop min-w-[1.5ch] tabular-nums">
        {coins == null ? "…" : coins.toLocaleString()}
      </span>
    </span>
  );
}

/** A gold coin with a star struck in it, 20px. */
export function Coin({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className="shrink-0 drop-shadow-[0_1px_0_rgba(59,42,28,0.35)]">
      <g className="coin-spin">
        <circle cx="10" cy="10" r="9" fill="#d9a92b" stroke="#8a6a1c" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="6.5" fill="#f2c14e" stroke="#c9962a" strokeWidth="1" />
        <path d="M10 5.6 L11.2 8.6 L14.3 8.7 L11.9 10.6 L12.7 13.7 L10 11.9 L7.3 13.7 L8.1 10.6 L5.7 8.7 L8.8 8.6 Z" fill="#fff3c4" stroke="#c9962a" strokeWidth="0.6" />
        <path d="M5 6.5 A6.5 6.5 0 0 1 8 4" stroke="#fff8dc" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}
