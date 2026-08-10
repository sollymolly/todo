"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import CharacterSprite from "@/components/CharacterSprite";
import XPBar from "@/components/XPBar";
import Scenery from "@/components/Scenery";
import {
  BODY_TYPES,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKINS,
  SLOTS,
  dyesFor,
  findItem,
  isDyeSlot,
  itemsForSlot,
  levelFor,
  progressFor,
  resolveDye,
  type Item,
} from "@/lib/game";
import { saveAppearance, saveDisplayName, saveEquipped } from "@/lib/actions";
import type { Appearance, DyeSlot, Equipped, Profile, Slot } from "@/lib/types";

type Tab = "look" | Slot;

export default function CharacterStudio({
  profile,
  initialSlot,
}: {
  profile: Profile;
  initialSlot?: Slot;
}) {
  const [appearance, setAppearance] = useState<Appearance>(profile.appearance);
  const [equipped, setEquipped] = useState<Equipped>(profile.equipped);
  const [name, setName] = useState(profile.display_name);
  const [tab, setTab] = useState<Tab>(initialSlot ?? "look");
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Earned levels are permanent, so the wardrobe gate follows the stored one.
  const level = profile.level ?? levelFor(profile.xp);
  const p = progressFor(profile.xp);

  function setLook(patch: Partial<Appearance>) {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    startSaving(async () => {
      try {
        await saveAppearance(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save");
      }
    });
  }

  function equip(slot: Slot, item: Item) {
    if (item.level > level) {
      setFlash(`${item.name} unlocks at level ${item.level}.`);
      window.setTimeout(() => setFlash(null), 2200);
      return;
    }
    save({ ...equipped, [slot]: item.id });
  }

  function dye(slot: DyeSlot, id: string) {
    save({ ...equipped, dyes: { ...equipped.dyes, [slot]: id } });
  }

  function save(next: Equipped) {
    setEquipped(next);
    startSaving(async () => {
      try {
        await saveEquipped(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save");
      }
    });
  }

  return (
    <>
      <Scenery />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
              The Armoury
            </h1>
            <p className="text-xs font-semibold text-mud-600">
              Level {level} · {p.title}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            ← Back to quests
          </Link>
        </header>

        <AnimatePresence>
          {(error || flash) && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mb-4 rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 ${
                error
                  ? "bg-red-100 text-red-800 ring-red-300"
                  : "bg-amber-100 text-amber-900 ring-amber-300"
              }`}
            >
              {error ? error : flash}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
          {/* ---------------------------------------------------- preview */}
          <div className="panel rounded-2xl p-5 lg:sticky lg:top-6">
            <motion.div
              key={JSON.stringify(equipped)}
              initial={{ scale: 0.96, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="mx-auto w-fit"
            >
              <CharacterSprite
                appearance={appearance}
                equipped={equipped}
                scale={4}
                className="drop-shadow-[0_8px_12px_rgba(42,30,19,0.35)]"
              />
            </motion.div>

            <label className="mt-3 block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mud-500">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (name.trim() && name !== profile.display_name) {
                    startSaving(async () => {
                      try {
                        await saveDisplayName(name);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not save");
                      }
                    });
                  }
                }}
                maxLength={40}
                className="field w-full rounded-xl px-3 py-2 text-center font-display text-lg font-bold tracking-wide"
              />
            </label>

            <div className="mt-3">
              <XPBar xp={profile.xp} />
            </div>

            <p className="mt-3 text-center text-[11px] font-semibold text-mud-400">
              {saving ? "Saving…" : "Changes save automatically"}
            </p>

            {/* CC-BY-SA requires the attribution stay reachable. */}
            <a
              href="/sprites/lpc/CREDITS.md"
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-center text-[10px] text-mud-400 underline-offset-2 hover:text-grass-700 hover:underline"
            >
              Sprite art: Liberated Pixel Cup (CC-BY-SA 3.0 / GPL 3.0)
            </a>
          </div>

          {/* ---------------------------------------------------- options */}
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-1.5">
              <TabButton on={tab === "look"} onClick={() => setTab("look")}>
                Appearance
              </TabButton>
              {SLOTS.map(({ slot, label }) => (
                <TabButton
                  key={slot}
                  on={tab === slot}
                  onClick={() => setTab(slot)}
                >
                  {label}
                </TabButton>
              ))}
            </div>

            {tab === "look" ? (
              <div className="space-y-4">
                <Group title="Body">
                  <div className="flex flex-wrap gap-1.5">
                    {BODY_TYPES.map((b) => (
                      <Chip
                        key={b.id}
                        on={appearance.body === b.id}
                        onClick={() => setLook({ body: b.id })}
                      >
                        {b.label}
                      </Chip>
                    ))}
                  </div>
                </Group>

                <Group title="Skin">
                  <div className="flex flex-wrap gap-2">
                    {SKINS.map((s) => (
                      <Swatch
                        key={s.id}
                        hex={s.hex}
                        label={s.label}
                        on={appearance.skin === s.id}
                        onClick={() => setLook({ skin: s.id })}
                      />
                    ))}
                  </div>
                </Group>

                <Group title="Hair color">
                  <div className="flex flex-wrap gap-2">
                    {HAIR_COLORS.map((h) => (
                      <Swatch
                        key={h.id}
                        hex={h.hex}
                        label={h.label}
                        on={appearance.hairColor === h.id}
                        onClick={() => setLook({ hairColor: h.id })}
                      />
                    ))}
                  </div>
                </Group>

                <Group title="Hair style">
                  <div className="flex flex-wrap gap-1.5">
                    {HAIR_STYLES.map((h) => (
                      <Chip
                        key={h.id}
                        on={appearance.hair === h.id}
                        onClick={() => setLook({ hair: h.id })}
                      >
                        {h.label}
                      </Chip>
                    ))}
                  </div>
                </Group>

                <Group title="Eye color">
                  <div className="flex flex-wrap gap-2">
                    {EYE_COLORS.map((e) => (
                      <Swatch
                        key={e.id}
                        hex={e.hex}
                        label={e.label}
                        on={appearance.eyes === e.id}
                        onClick={() => setLook({ eyes: e.id })}
                      />
                    ))}
                  </div>
                </Group>
              </div>
            ) : (
              <div className="space-y-4">
                <Group
                  title={SLOTS.find((s) => s.slot === tab)?.label ?? ""}
                >
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {itemsForSlot(tab).map((item) => {
                      const locked = item.level > level;
                      const on = equipped[tab] === item.id;
                      return (
                        <li key={`${tab}-${item.id}`}>
                          <button
                            onClick={() => equip(tab, item)}
                            className={`flex w-full items-start gap-2.5 rounded-xl border-2 px-3 py-2 text-left transition ${
                              on
                                ? "border-grass-500 bg-grass-50"
                                : locked
                                  ? "cursor-not-allowed border-mud-200 bg-mud-50 opacity-60"
                                  : "border-mud-200 bg-white/70 hover:border-mud-400 hover:bg-white"
                            }`}
                          >
                            <span className="mt-0.5 text-sm">
                              {locked ? "✕" : on ? "✓" : "·"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span
                                  className={`truncate text-sm font-bold ${
                                    on ? "text-grass-700" : "text-mud-900"
                                  }`}
                                >
                                  {item.name}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] font-bold text-mud-400">
                                  Lv {item.level}
                                </span>
                              </span>
                              <span className="mt-0.5 block text-[11.5px] leading-snug text-mud-500">
                                {item.blurb}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Group>

                {isDyeSlot(tab) && (
                  <DyeGroup
                    slot={tab}
                    equipped={equipped}
                    onPick={(id) => dye(tab, id)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/* ========================================================================== */

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition ${
        on
          ? "border-grass-600 bg-grass-600 text-white shadow-sm"
          : "border-mud-200 bg-white/70 text-mud-600 hover:border-mud-400 hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The colours the equipped piece can wear. Which swatches appear follows the
 * art, not the slot: a linen tunic is offered cloth dyes and a steel helm the
 * metal finishes, because a palette swap can only move a sheet within the ramp
 * family it was painted in. Empty slots have nothing to dye, and say so rather
 * than showing a dead row.
 */
function DyeGroup({
  slot,
  equipped,
  onPick,
}: {
  slot: DyeSlot;
  equipped: Equipped;
  onPick: (id: string) => void;
}) {
  const worn = findItem(slot, equipped[slot]);
  const swatches = dyesFor(worn);
  const current = resolveDye(worn, equipped.dyes?.[slot]);

  return (
    <Group title={worn?.dye?.kind === "metal" ? "Finish" : "Dye"}>
      {swatches.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {swatches.map((d) => (
            <Swatch
              key={d.id}
              hex={d.hex}
              label={d.label}
              on={current === d.id}
              onClick={() => onPick(d.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11.5px] leading-snug text-mud-500">
          {worn && worn.id !== "none"
            ? `${worn.name} is painted in colours that can't be swapped.`
            : "Nothing to dye — this slot is empty."}
        </p>
      )}
    </Group>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel rounded-2xl p-4">
      <h2 className="mb-2.5 font-display text-sm font-bold tracking-wide text-mud-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({
  hex,
  label,
  on,
  onClick,
}: {
  hex: string;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`size-9 rounded-full border transition ${
        on
          ? "scale-110 border-white ring-2 ring-grass-600 ring-offset-2 ring-offset-mud-50"
          : "border-mud-300 hover:scale-105"
      }`}
      style={{ background: hex }}
    />
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition ${
        on
          ? "border-grass-600 bg-grass-600 text-white"
          : "border-mud-200 bg-white/70 text-mud-600 hover:border-mud-400 hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}
