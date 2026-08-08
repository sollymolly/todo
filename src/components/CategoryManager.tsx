"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { COLOR_KEYS, colorOf } from "@/lib/game";
import { addCategory, deleteCategory, updateCategory } from "@/lib/actions";
import type { Category } from "@/lib/types";

export default function CategoryManager({
  categories,
  counts,
  onClose,
  onChanged,
}: {
  categories: Category[];
  counts: Record<string, number>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_KEYS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="panel max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-2xl p-6"
        initial={{ scale: 0.94, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-bold tracking-wide text-mud-900">
          Categories
        </h2>
        <p className="mt-1 text-xs text-mud-500">
          Rename, recolour, or retire them. Deleting a category keeps its quests
          — they just move to Uncategorised.
        </p>

        <ul className="mt-4 space-y-2">
          {categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              count={counts[cat.id] ?? 0}
              busy={busy}
              confirming={confirmId === cat.id}
              onConfirm={() => setConfirmId(cat.id)}
              onCancelConfirm={() => setConfirmId(null)}
              onSave={(patch) => run(() => updateCategory(cat.id, patch))}
              onDelete={() =>
                run(async () => {
                  await deleteCategory(cat.id);
                  setConfirmId(null);
                })
              }
            />
          ))}
        </ul>

        {/* --------------------------------------------------------- new -- */}
        <div className="mt-5 rounded-xl border-2 border-dashed border-mud-300 p-3.5">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-mud-500">
            New category
          </p>

          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gardening, Reading, Side quest…"
              maxLength={40}
              className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
            />
            <button
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  await addCategory({ name, color });
                  setName("");
                })
              }
              className="shrink-0 rounded-lg bg-grass-600 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
            >
              Add
            </button>
          </div>

          <ColorPicker value={color} onChange={setColor} />
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-800">
            {error}
          </p>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-mud-800 px-4 py-2 text-sm font-bold text-mud-50 transition hover:bg-mud-900"
        >
          Done
        </button>
      </motion.div>
    </motion.div>
  );
}

function CategoryRow({
  cat,
  count,
  busy,
  confirming,
  onConfirm,
  onCancelConfirm,
  onSave,
  onDelete,
}: {
  cat: Category;
  count: number;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onSave: (patch: { name?: string; color?: string }) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cat.name);
  const c = colorOf(cat.color);

  return (
    <li className="rounded-xl border border-mud-200 bg-white/70">
      <div className="flex items-center gap-2 p-2">
        <span className={`size-2.5 rounded-full ${c.dot}`} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== cat.name && onSave({ name })}
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1.5 py-1 text-sm font-medium text-mud-900 outline-none focus:bg-white"
        />
        <span className="shrink-0 font-mono text-[11px] font-bold text-mud-400">
          {count} open
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg px-2 py-1 text-xs text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
        >
          {open ? "▲" : "▼"}
        </button>
        {confirming ? (
          <span className="flex shrink-0 gap-1">
            <button
              disabled={busy}
              onClick={onDelete}
              className="rounded-lg bg-red-600 px-2 py-1 text-xs font-bold text-white transition hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={onCancelConfirm}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-mud-500 hover:text-mud-900"
            >
              No
            </button>
          </span>
        ) : (
          <button
            onClick={onConfirm}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-mud-400 transition hover:bg-red-100 hover:text-red-700"
          >
            Delete
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-mud-200 px-2 pb-2">
          <ColorPicker value={cat.color} onChange={(v) => onSave({ color: v })} />
        </div>
      )}
    </li>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {COLOR_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-label={k}
          className={`size-6 rounded-full transition ${colorOf(k).dot} ${
            value === k
              ? "ring-2 ring-mud-800 ring-offset-2 ring-offset-mud-50"
              : "opacity-55 hover:opacity-100"
          }`}
        />
      ))}
    </div>
  );
}
