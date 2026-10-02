"use client";

import { useState } from "react";
import { Panel } from "@/components/village/panels";
import TreatArt from "@/components/village/Treat";
import { setShop, useShop } from "@/components/village/shop-state";
import { sendTreat } from "@/lib/village-actions";
import { TREATS, type TreatId } from "@/lib/bakery";
import { NOTE_MAX } from "@/lib/village";

/* --------------------------------------------------------------------------
   The bakery's counter (src/lib/bakery.ts): pick a treat, pick a companion,
   add a note if you like, and it's left on their door. Paid for in the
   store's coins (shop-state.ts).
   -------------------------------------------------------------------------- */

export function BakeryPanel({ friends, onClose }: { friends: { id: string; name: string }[]; onClose: () => void }) {
  const shop = useShop();
  const [pick, setPick] = useState<TreatId | null>(null);
  const [to, setTo] = useState(friends[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const treat = TREATS.find((t) => t.id === pick) ?? null;

  async function send() {
    if (!treat || !to) return;
    setBusy(true);
    setNote(null);
    const r = await sendTreat(to, treat.id, text).catch(() => ({ ok: false as const, error: "Couldn't send that just now." }));
    setBusy(false);
    if (!r.ok) return setNote({ ok: false, text: r.error });
    setShop(r.shop);
    const name = friends.find((f) => f.id === to)?.name;
    setNote({ ok: true, text: `Wrapped up and left on ${name ? `${name}'s` : "their"} door.` });
    setPick(null);
    setText("");
  }

  return (
    <Panel title="Bakery" sub={shop ? `${shop.coins} coins · fresh from the oven` : "Warming up…"} onClose={onClose}>
      <p className="mb-2 text-xs text-mud-500">Send a companion something sweet. It waits on their door with your note.</p>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {TREATS.map((t) => {
          const short = !!shop && shop.coins < t.price;
          return (
            <li key={t.id}>
              <button
                onClick={() => {
                  setPick(pick === t.id ? null : t.id);
                  setNote(null);
                }}
                disabled={short}
                title={t.blurb}
                className={`flex w-full flex-col items-center rounded-lg p-2 text-center transition disabled:opacity-45 ${
                  pick === t.id ? "bg-grass-100 ring-2 ring-grass-400" : "bg-mud-100 hover:bg-mud-200"
                }`}
              >
                <span className="size-10">
                  <TreatArt id={t.id} />
                </span>
                <span className="mt-0.5 text-xs font-semibold text-mud-900">{t.name}</span>
                <span className="text-[11px] text-mud-500">{t.price} coins</span>
              </button>
            </li>
          );
        })}
      </ul>

      {treat &&
        (friends.length === 0 ? (
          <p className="mt-3 rounded-lg bg-mud-100 px-3 py-3 text-sm text-mud-600">
            Treats go to companions&apos; doors. Add a companion first, then come back.
          </p>
        ) : (
          <div className="mt-3 space-y-2 rounded-lg bg-[#fff6d8] p-2.5 ring-1 ring-[#eadba6]">
            <p className="text-xs text-mud-700">{treat.blurb}</p>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-mud-500">
              For
              <select value={to} onChange={(e) => setTo(e.target.value)} className="field mt-1 block w-full rounded-md px-2 py-1.5 text-sm normal-case tracking-normal">
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={text}
              maxLength={NOTE_MAX}
              onChange={(e) => setText(e.target.value)}
              placeholder="A note to go with it (optional)"
              className="field w-full rounded-md px-2 py-1.5 text-sm"
            />
            <button
              disabled={busy || !to}
              onClick={() => void send()}
              className="w-full rounded-lg bg-grass-600 px-3 py-2 text-sm font-semibold text-white hover:bg-grass-500 disabled:bg-mud-300"
            >
              {busy ? "Wrapping…" : `Send ${treat.a} · ${treat.price} coins`}
            </button>
          </div>
        ))}

      {note && (
        <p className={`mt-3 rounded-md px-2 py-1 text-xs ${note.ok ? "bg-grass-100 text-grass-700" : "bg-red-50 text-red-800"}`}>{note.text}</p>
      )}
    </Panel>
  );
}
