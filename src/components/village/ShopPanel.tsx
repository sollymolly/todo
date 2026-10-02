"use client";

import { useState } from "react";
import { Panel } from "@/components/village/panels";
import { setShop, useShop } from "@/components/village/shop-state";
import { buyGood } from "@/lib/village-actions";
import Furniture from "@/components/village/Furniture";
import { COIN_GOODS, MONEY_GOODS, SECTIONS, XP_PER_COIN } from "@/lib/shop";
import type { FurnitureKind } from "@/lib/furniture";

/* --------------------------------------------------------------------------
   The store's counter (src/lib/shop.ts): coins, what's for sale for them,
   and the counter for real money — shut until payments are set up.
   -------------------------------------------------------------------------- */

export function ShopPanel({ onClose }: { onClose: () => void }) {
  const shop = useShop();
  const [tab, setTab] = useState<"coins" | "money">("coins");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function buy(id: string) {
    setBusy(id);
    setNote(null);
    const r = await buyGood(id).catch(() => ({ ok: false as const, error: "Couldn't buy that just now." }));
    setBusy(null);
    if (!r.ok) return setNote(r.error);
    setShop(r.shop);
    const kind = COIN_GOODS.find((g) => g.id === id)?.kind;
    setNote(
      kind === "freeze"
        ? "Bought. It keeps until a missed habit day needs it."
        : kind === "roof"
          ? "Bought. Pick it in your house's Customise options."
          : "Bought. Find it when you decorate inside your house."
    );
  }

  return (
    <Panel title="General store" sub={shop ? `${shop.coins} coins · ${shop.freezes} streak freeze${shop.freezes === 1 ? "" : "s"} left` : "Opening up…"} onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-lg bg-mud-100 p-1 text-xs font-semibold">
        {(["coins", "money"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1 transition ${tab === t ? "bg-white text-mud-900 shadow-sm" : "text-mud-500"}`}
          >
            {t === "coins" ? "For coins" : "For real money"}
          </button>
        ))}
      </div>

      {tab === "coins" ? (
        <>
          <p className="mb-2 text-xs text-mud-500">
            You earn a coin for every {XP_PER_COIN} XP: finishing quests, keeping habits and focus time.
          </p>
          {SECTIONS.map((s) => (
            <section key={s.kind} className="mt-3 first:mt-0">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mud-400">{s.label}</p>
              <ul className="space-y-1.5">
                {COIN_GOODS.filter((g) => g.kind === s.kind).map((g) => {
                  const have = g.kind !== "freeze" && !!shop?.owned.includes(g.id);
                  const short = !!shop && shop.coins < g.price;
                  return (
                    <li key={g.id} className="flex items-center gap-3 rounded-lg px-2.5 py-2 ring-1 ring-mud-200">
                      {g.kind === "furniture" ? (
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-mud-100 p-0.5 ring-1 ring-mud-300" aria-hidden>
                          <Furniture kind={g.id.slice("furniture:".length) as FurnitureKind} />
                        </span>
                      ) : (
                        <span className="size-8 shrink-0 rounded-md ring-1 ring-mud-300" style={{ background: g.color }} aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-mud-900">{g.name}</span>
                        <span className="block text-xs text-mud-500">{g.blurb}</span>
                      </span>
                      <button
                        disabled={!shop || have || short || busy === g.id}
                        onClick={() => void buy(g.id)}
                        className="shrink-0 rounded-lg bg-grass-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-grass-500 disabled:bg-mud-300"
                      >
                        {have ? "Yours" : busy === g.id ? "…" : `${g.price} coins`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      ) : MONEY_GOODS.length === 0 ? (
        <p className="rounded-lg bg-mud-100 px-3 py-6 text-center text-sm text-mud-600">This counter isn&apos;t open yet. Check back soon.</p>
      ) : null}

      {note && <p className="mt-3 text-xs text-mud-700">{note}</p>}
    </Panel>
  );
}
