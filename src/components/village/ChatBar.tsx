"use client";

import { useState } from "react";
import { say } from "@/lib/village-actions";
import { SAY_MAX, type ChatLine } from "@/lib/village";

/* --------------------------------------------------------------------------
   Talking out loud in a shared space. What you say floats over your head
   for a few seconds for everyone there; the last few lines are kept here
   too, in case you looked away.
   -------------------------------------------------------------------------- */

export default function ChatBar({
  space,
  lines,
  others,
  onSaid,
}: {
  space: string;
  lines: ChatLine[];
  /** How many others are here to hear it. */
  others: number;
  onSaid: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const recent = lines.slice(-6);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    const r = await say(space, t).catch(() => ({ ok: false as const, error: "Couldn't say that." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setText("");
    onSaid(t);
  }

  return (
    <div className="pointer-events-auto w-full max-w-md" onPointerDown={(e) => e.stopPropagation()}>
      {showLog && recent.length > 0 && (
        <ul className="panel mb-1.5 max-h-40 space-y-0.5 overflow-y-auto rounded-xl px-3 py-2 text-[13px]">
          {recent.map((l) => (
            <li key={l.id} className="break-words text-mud-800">
              <b className="font-semibold">{l.name}:</b> {l.body}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mb-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="panel flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1 shadow-lg"
      >
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          aria-label={showLog ? "Hide what's been said" : "Show what's been said"}
          aria-pressed={showLog}
          className={`grid size-7 shrink-0 place-items-center rounded-full text-sm ${showLog ? "bg-grass-100 text-grass-700" : "text-mud-500 hover:bg-mud-100"}`}
        >
          💬
        </button>
        <input
          value={text}
          maxLength={SAY_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder={others ? "Say something…" : "Nobody else here yet"}
          aria-label="Say something to everyone here"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-mud-900 outline-none placeholder:text-mud-400"
        />
        <button
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-full bg-grass-600 px-3 py-1 text-xs font-semibold text-white hover:bg-grass-500 disabled:bg-mud-300"
        >
          Say
        </button>
      </form>
    </div>
  );
}
