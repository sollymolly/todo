"use client";

import { useState } from "react";
import Furniture from "@/components/village/Furniture";
import { FLOORS, FURNITURE, KIND_LIST, MAX_ITEMS, WALLS, type FurnitureKind, type Interior } from "@/lib/furniture";
import { Panel } from "@/components/village/panels";
import { ownsGood, useShop } from "@/components/village/shop-state";

/* --------------------------------------------------------------------------
   Decorating your house, Animal Crossing style: pick a piece, then tap the
   floor (or a spot on the back wall, for hangings) to put it there. Tap a
   piece that's already down to move or remove it. Nicer pieces unlock as
   you level up. Nothing is saved until you press Save.
   -------------------------------------------------------------------------- */

export default function DecoratePanel({
  draft,
  level,
  pick,
  selected,
  saving,
  onPick,
  onChange,
  onRemoveSelected,
  onMoveSelected,
  onSave,
  onCancel,
}: {
  draft: Interior;
  level: number;
  pick: FurnitureKind | null;
  selected: number | null;
  saving: boolean;
  onPick: (k: FurnitureKind | null) => void;
  onChange: (next: Interior) => void;
  onRemoveSelected: () => void;
  onMoveSelected: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  // Wallpapers and floors bought at the store join the rest (shop-state.ts).
  const shop = useShop();
  const [tab, setTab] = useState<"furniture" | "walls" | "floors">("furniture");
  const sel = selected != null ? draft.items[selected] : null;

  return (
    <Panel title="Decorate" sub={`${draft.items.length}/${MAX_ITEMS} pieces · tap the floor to place`} onClose={onCancel}>
      {sel ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-grass-100/60 p-2 ring-1 ring-grass-200">
          <span className="min-w-0 flex-1 text-sm font-semibold text-mud-800">{FURNITURE[sel.k].label}</span>
          <button onClick={onMoveSelected} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-mud-700 ring-1 ring-mud-300">
            Move
          </button>
          <button onClick={onRemoveSelected} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-red-700 ring-1 ring-mud-300">
            Put away
          </button>
        </div>
      ) : pick ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 ring-1 ring-amber-200">
          <span className="min-w-0 flex-1 text-sm text-mud-800">
            Placing <b>{FURNITURE[pick].label}</b>
            {FURNITURE[pick].layer === "wall" ? " — tap the back wall" : " — tap the floor"}
          </span>
          <button onClick={() => onPick(null)} className="text-xs text-mud-500 hover:text-mud-800">
            Stop
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex gap-1 rounded-lg bg-mud-100 p-1 text-xs font-semibold">
        {(["furniture", "walls", "floors"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-md px-2 py-1 capitalize ${tab === t ? "bg-white text-mud-900 shadow-sm" : "text-mud-500"}`}>
            {t === "walls" ? "Wallpaper" : t}
          </button>
        ))}
      </div>

      {tab === "furniture" && (
        <div className="grid grid-cols-4 gap-1.5">
          {KIND_LIST.map((k) => {
            const spec = FURNITURE[k];
            const locked = level < spec.level;
            return (
              <button
                key={k}
                disabled={locked || draft.items.length >= MAX_ITEMS}
                onClick={() => onPick(pick === k ? null : k)}
                title={locked ? `Unlocks at level ${spec.level}` : spec.label}
                className={`flex flex-col items-center gap-0.5 rounded-lg p-1.5 text-[10px] transition disabled:opacity-40 ${
                  pick === k ? "bg-grass-100 ring-2 ring-grass-400" : "bg-mud-100 hover:bg-mud-200"
                }`}
              >
                <span className="grid h-10 w-full place-items-center">
                  <span style={{ width: Math.min(40, spec.w * 20), height: 40 }} className="block">
                    <Furniture kind={k} />
                  </span>
                </span>
                <span className="w-full truncate text-center text-mud-700">{locked ? `🔒 Lv ${spec.level}` : spec.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === "walls" && (
        <div className="grid grid-cols-4 gap-1.5">
          {WALLS.filter((w) => !w.shop || ownsGood(shop, `wall:${w.id}`)).map((w) => (
            <button
              key={w.id}
              disabled={level < w.level}
              onClick={() => onChange({ ...draft, wall: w.id })}
              className={`rounded-lg p-1.5 text-[10px] disabled:opacity-40 ${draft.wall === w.id ? "ring-2 ring-grass-400" : ""}`}
            >
              <span className="block h-9 rounded-md ring-1 ring-mud-300" style={{ background: `repeating-linear-gradient(90deg, ${w.fill} 0 8px, ${w.line} 8px 10px)` }} />
              <span className="mt-0.5 block truncate text-mud-700">{level < w.level ? `🔒 Lv ${w.level}` : w.label}</span>
            </button>
          ))}
        </div>
      )}
      {tab === "floors" && (
        <div className="grid grid-cols-4 gap-1.5">
          {FLOORS.filter((f) => !f.shop || ownsGood(shop, `floor:${f.id}`)).map((f) => (
            <button
              key={f.id}
              disabled={level < f.level}
              onClick={() => onChange({ ...draft, floor: f.id })}
              className={`rounded-lg p-1.5 text-[10px] disabled:opacity-40 ${draft.floor === f.id ? "ring-2 ring-grass-400" : ""}`}
            >
              <span className="block h-9 rounded-md ring-1 ring-mud-300" style={{ background: `repeating-linear-gradient(0deg, ${f.a} 0 7px, ${f.b} 7px 8px)` }} />
              <span className="mt-0.5 block truncate text-mud-700">{level < f.level ? `🔒 Lv ${f.level}` : f.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button disabled={saving} onClick={onSave} className="flex-1 rounded-lg bg-grass-600 px-3 py-2 text-sm font-semibold text-white hover:bg-grass-500 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-mud-600 hover:bg-mud-100">
          Cancel
        </button>
      </div>
    </Panel>
  );
}
