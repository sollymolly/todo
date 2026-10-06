"use client";

import { useState } from "react";
import CharacterSprite from "@/components/CharacterSprite";
import { OutfitOptions, useOutfit, type Tab } from "@/components/CharacterStudio";
import { Panel } from "@/components/village/panels";
import type { Appearance, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   The wardrobe at home: change what you're wearing (and how you look)
   without leaving the house. The same choices as the Armoury
   (CharacterStudio.tsx), saved as you pick; `onChange` hears each one kept,
   so the knight in the room changes too.
   -------------------------------------------------------------------------- */

export default function WardrobePanel({
  level,
  appearance,
  equipped,
  onChange,
  onClose,
}: {
  level: number;
  appearance: Appearance;
  equipped: Equipped;
  onChange: (appearance: Appearance, equipped: Equipped) => void;
  onClose: () => void;
}) {
  const outfit = useOutfit({ appearance, equipped }, level, onChange);
  const [tab, setTab] = useState<Tab>("torso");
  const note = outfit.error ?? outfit.flash;

  return (
    <Panel wide title="Wardrobe" sub={outfit.saving ? "Saving…" : "Pick something to wear: it saves as you go"} onClose={onClose}>
      <div className="mb-3 flex justify-center rounded-xl bg-gradient-to-b from-[#f4ecd6] to-[#dcc59c] py-2 ring-1 ring-mud-200">
        <CharacterSprite appearance={outfit.appearance} equipped={outfit.equipped} scale={2} />
      </div>
      {note && (
        <p
          role="status"
          className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${
            outfit.error ? "bg-red-100 text-red-800 ring-red-300" : "bg-amber-100 text-amber-900 ring-amber-300"
          }`}
        >
          {note}
        </p>
      )}
      <OutfitOptions compact outfit={outfit} level={level} tab={tab} onTab={setTab} />
    </Panel>
  );
}
