"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { readTaskScreenshot } from "@/lib/import-actions";
import { localInputToIso } from "@/lib/date";
import type { Category } from "@/lib/types";

/* --------------------------------------------------------------------------
   Screenshot → quests. Pick, paste or drop an image; it's shrunk here, read
   by the model on the server, and comes back as an editable list. Nothing is
   added until "Add" — a misread date or a garbled title is caught here rather
   than on the board.
   -------------------------------------------------------------------------- */

export type ImportDraft = { title: string; dueDate: string | null; categoryId: string | null };

type Row = {
  key: number;
  keep: boolean;
  title: string;
  date: string;
  time: string;
  categoryId: string;
};

/** Long edge, in px. Plenty to read list text; small enough to send quickly. */
const MAX_EDGE = 2000;

const MODEL_NAMES: Record<string, string> = {
  "google/gemma-4-31b-it:free": "Gemma 4 (free)",
};

export default function ScreenshotImport({
  categories,
  onClose,
  onAdd,
}: {
  categories: Category[];
  onClose: () => void;
  onAdd: (drafts: ImportDraft[]) => Promise<void>;
}) {
  const [stage, setStage] = useState<"pick" | "reading" | "review" | "adding">("pick");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+V a screenshot straight in, while the picker is showing.
  useEffect(() => {
    if (stage !== "pick") return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void read(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stage !== "adding" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  async function read(file: File) {
    if (!file.type.startsWith("image/")) return setError("That isn't an image.");
    setError(null);
    setStage("reading");
    try {
      const image = await shrink(file);
      setPreview(image);
      const res = await readTaskScreenshot({ image, today: localToday() });
      if (!res.ok) {
        setError(res.error);
        setStage("pick");
        return;
      }
      if (res.tasks.length === 0) {
        setError("No tasks found in that screenshot.");
        setStage("pick");
        return;
      }
      setModel(res.model);
      setRows(
        res.tasks.map((t, i) => ({
          key: i,
          // Already ticked off in the screenshot: offered, but not by default.
          keep: !t.done,
          title: t.title,
          date: t.date ?? "",
          time: t.time ?? "",
          categoryId: t.categoryId ?? "",
        }))
      );
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
      setStage("pick");
    }
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const chosen = rows.filter((r) => r.keep && r.title.trim());

  async function add() {
    setStage("adding");
    setError(null);
    try {
      await onAdd(
        chosen.map((r) => ({
          title: r.title.trim(),
          // A date with no time is due at the end of that day, as the picker does.
          dueDate: r.date ? localInputToIso(`${r.date}T${r.time || "23:59"}`) : null,
          categoryId: r.categoryId || null,
        }))
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add those quests.");
      setStage("review");
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => stage !== "adding" && onClose()}
    >
      <motion.div
        className="panel flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
        initial={{ scale: 0.94, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import quests from a screenshot"
      >
        <header className="flex items-center justify-between gap-3 border-b border-mud-200 px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-bold tracking-wide text-mud-900">
              Import from a screenshot
            </h2>
            <p className="text-xs text-mud-500">
              {stage === "review" || stage === "adding"
                ? "Check what was found, fix anything that's off, then add."
                : "A to-do list, notes, a syllabus, a group chat — anything with tasks in it."}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={stage === "adding"}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <p className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
              {error}
            </p>
          )}

          {/* ---------------------------------------------------- pick */}
          {stage === "pick" && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const file = e.dataTransfer.files[0];
                if (file) void read(file);
              }}
              className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-12 text-center transition ${
                over ? "border-grass-500 bg-grass-50" : "border-mud-300"
              }`}
            >
              <p className="font-display text-sm font-bold text-mud-800">
                Drop a screenshot here, or paste one
              </p>
              <p className="text-xs text-mud-500">Ctrl+V / ⌘V works while this is open</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-grass-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-grass-500"
              >
                Choose an image
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void read(file);
                }}
              />
            </div>
          )}

          {/* ------------------------------------------------- reading */}
          {stage === "reading" && (
            <div className="flex flex-col items-center gap-4 py-8">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing to optimise
                <img src={preview} alt="" className="max-h-48 rounded-lg opacity-70 shadow" />
              )}
              <p className="animate-pulse text-sm font-semibold text-mud-600">
                Reading your screenshot…
              </p>
            </div>
          )}

          {/* -------------------------------------------------- review */}
          {(stage === "review" || stage === "adding") && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className={`rounded-xl border p-2.5 transition ${
                    r.keep ? "border-mud-200 bg-white/80" : "border-mud-100 bg-white/30 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={r.keep}
                      onChange={(e) => update(r.key, { keep: e.target.checked })}
                      aria-label={`Include "${r.title}"`}
                      className="mt-2 size-4 shrink-0 accent-grass-600"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <input
                        value={r.title}
                        onChange={(e) => update(r.key, { title: e.target.value })}
                        maxLength={200}
                        aria-label="Quest name"
                        className="field w-full rounded-lg px-2.5 py-1.5 text-sm font-medium"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <input
                          type="date"
                          value={r.date}
                          onChange={(e) => update(r.key, { date: e.target.value })}
                          aria-label="Due date"
                          className="field rounded-lg px-2 py-1 text-xs"
                        />
                        <input
                          type="time"
                          value={r.time}
                          onChange={(e) => update(r.key, { time: e.target.value })}
                          disabled={!r.date}
                          aria-label="Due time"
                          className="field rounded-lg px-2 py-1 text-xs disabled:opacity-40"
                        />
                        <select
                          value={r.categoryId}
                          onChange={(e) => update(r.key, { categoryId: e.target.value })}
                          aria-label="Category"
                          className="field min-w-0 rounded-lg px-2 py-1 text-xs"
                        >
                          <option value="">Uncategorised</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(stage === "review" || stage === "adding") && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-mud-200 px-5 py-3">
            <button
              onClick={add}
              disabled={stage === "adding" || chosen.length === 0}
              className="rounded-lg bg-grass-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
            >
              {stage === "adding"
                ? "Adding…"
                : `Add ${chosen.length} quest${chosen.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => {
                setRows([]);
                setPreview(null);
                setStage("pick");
              }}
              disabled={stage === "adding"}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-mud-500 transition hover:bg-mud-100 hover:text-mud-900"
            >
              Try another screenshot
            </button>
            {model && (
              <span className="ml-auto text-[10px] text-mud-400">
                Read by {MODEL_NAMES[model] ?? model}
              </span>
            )}
          </footer>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Today as "YYYY-MM-DD" on this device's clock. */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Re-encodes the image as a JPEG no larger than MAX_EDGE on its long side.
 * Keeps the upload small (and the model's bill with it), and turns anything
 * the browser can display — HEIC from an iPhone included, where supported —
 * into a format every model accepts.
 */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This browser can't open that image. Try a PNG or JPEG."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't prepare that image.");
    // White behind transparent PNGs, or they'd turn black as a JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
