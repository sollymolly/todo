"use client";

import { useEffect, useState } from "react";
import { answerDuel, challenge, yieldDuel } from "@/lib/village-actions";
import { checkIn, serverNow } from "@/lib/session-store";
import type { DuelView } from "@/lib/village";

/* --------------------------------------------------------------------------
   Everything a fighter sees of a duel: the challenge coming in, waiting for
   an answer, the fight itself (health, clock, and Hit/Guard buttons for
   touch screens — the keys are H and G), and how it ended. Spectators get
   health bars over the fighters' heads instead (Village.tsx). The rules
   are in src/lib/duel.ts.
   -------------------------------------------------------------------------- */

function Bar({ hp, max, mine }: { hp: number; max: number; mine?: boolean }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-mud-200 ring-1 ring-mud-300">
      <div
        className={`h-full transition-all duration-500 ${pct > 50 ? "bg-grass-500" : pct > 25 ? "bg-amber-400" : "bg-red-500"} ${mine ? "" : "opacity-90"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Health over a fighter's head, for everyone watching. */
export function HeadBar({ hp, max }: { hp: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  return (
    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-black/40 ring-1 ring-black/30">
      <div className={`h-full ${pct > 50 ? "bg-grass-400" : pct > 25 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DuelUI({
  duel,
  meId,
  skew,
  live,
  onHit,
  onGuard,
  onDismiss,
}: {
  duel: DuelView;
  meId: string;
  skew: number;
  /** Whether the live connection is up: fighting needs it. */
  live: boolean;
  onHit: () => void;
  onGuard: (on: boolean) => void;
  onDismiss: () => void;
}) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const iAmA = duel.a.id === meId;
  const them = iAmA ? duel.b : duel.a;
  const now = serverNow(skew);

  async function act(fn: () => Promise<{ ok: boolean; error?: string } | void>) {
    setBusy(true);
    setError(null);
    const r = await fn().catch(() => ({ ok: false, error: "Something went wrong." }));
    if (r && !r.ok) setError(r.error ?? "Couldn't do that.");
    await checkIn(null);
    setBusy(false);
  }

  const card = "panel pointer-events-auto w-full max-w-md rounded-2xl p-4 shadow-xl";

  // An invitation to me.
  if (duel.status === "pending" && !iAmA) {
    const left = Math.max(0, 60 - Math.floor((now - duel.createdAt) / 1000));
    return (
      <div className={card} onPointerDown={(e) => e.stopPropagation()}>
        <p className="font-display text-lg font-bold text-mud-900">⚔ {them.name} challenges you to a duel</p>
        <p className="mt-1 text-xs text-mud-500">
          A live fight in the ring: 5 hearts each, first to land 5 hits wins. Nothing is won or lost but pride. ({left}s to answer)
        </p>
        {error && <p className="mt-2 text-xs text-red-800">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={() => act(() => answerDuel(duel.id, true))} className="flex-1 rounded-lg bg-grass-600 px-3 py-2 text-sm font-semibold text-white hover:bg-grass-500 disabled:opacity-50">
            Accept
          </button>
          <button disabled={busy} onClick={() => act(() => answerDuel(duel.id, false))} className="rounded-lg px-3 py-2 text-sm text-mud-600 hover:bg-mud-100">
            Decline
          </button>
        </div>
      </div>
    );
  }

  // Waiting on them.
  if (duel.status === "pending") {
    return (
      <div className={card} onPointerDown={(e) => e.stopPropagation()}>
        <p className="text-sm text-mud-800">
          Waiting for <b>{them.name}</b> to accept your challenge…
        </p>
        <button disabled={busy} onClick={() => act(() => yieldDuel(duel.id))} className="mt-2 text-xs font-semibold text-mud-500 hover:text-red-700">
          Withdraw
        </button>
      </div>
    );
  }

  // Over, one way or another.
  if (duel.status !== "active") {
    const won = duel.winner === meId;
    const text =
      duel.status === "declined"
        ? `${them.name} declined.`
        : duel.status === "expired"
          ? `${them.name} didn't answer.`
          : duel.status === "cancelled"
            ? "Challenge withdrawn."
            : duel.winner
              ? won
                ? `You beat ${them.name}!`
                : `${them.name} wins this one.`
              : "A draw — evenly matched.";
    return (
      <div className={card} onPointerDown={(e) => e.stopPropagation()}>
        <p className="font-display text-lg font-bold text-mud-900">{duel.status === "done" ? (won ? "🏆 " : "") + text : text}</p>
        <div className="mt-3 flex gap-2">
          {duel.status === "done" && (
            <button disabled={busy} onClick={() => act(() => challenge(them.id))} className="rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-grass-500">
              Rematch
            </button>
          )}
          <button onClick={onDismiss} className="rounded-lg px-3 py-1.5 text-xs text-mud-600 hover:bg-mud-100">
            Close
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-800">{error}</p>}
      </div>
    );
  }

  // Fighting.
  const hp = duel.hp!;
  const mine = { hp: iAmA ? hp.a : hp.b, max: iAmA ? hp.aMax : hp.bMax };
  const theirs = { hp: iAmA ? hp.b : hp.a, max: iAmA ? hp.bMax : hp.aMax };
  const toStart = duel.startsAt ? Math.ceil((duel.startsAt - now) / 1000) : 0;
  const left = duel.endsAt ? Math.max(0, Math.ceil((duel.endsAt - now) / 1000)) : 0;
  const hearts = (n: number, max: number) => "♥".repeat(Math.max(0, n)) + "♡".repeat(Math.max(0, max - n));

  return (
    <div className={card} onPointerDown={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-semibold text-mud-900">
            You <span className="tracking-widest text-red-600">{hearts(mine.hp, mine.max)}</span>
          </p>
          <Bar hp={mine.hp} max={mine.max} mine />
        </div>
        <div>
          <p className="mb-1 text-right font-semibold text-mud-900">
            <span className="tracking-widest text-red-600">{hearts(theirs.hp, theirs.max)}</span> {them.name}
          </p>
          <Bar hp={theirs.hp} max={theirs.max} />
        </div>
      </div>
      <p className="mt-2 text-center font-display text-lg font-bold text-mud-900 tabular-nums">
        {toStart > 0 ? `Take your marks… ${toStart}` : `Fight! · ${left}s`}
      </p>
      {!live && <p className="text-center text-xs font-semibold text-amber-700">Reconnecting to the arena…</p>}
      <p className="mt-1 text-center text-[11px] text-mud-500">
        <b>WASD</b>/arrows move · <b>H</b> hit · hold <b>G</b> to guard. Stay in the ring. Hits and guards work in every direction;
        while guarding you move slowly and can&apos;t hit.
      </p>
      {/* For touch screens: the same as H and G. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          disabled={toStart > 0}
          onPointerDown={(e) => {
            e.preventDefault();
            onHit();
          }}
          className="select-none rounded-xl bg-mud-800 px-2 py-2.5 text-sm font-bold text-white active:bg-mud-700 disabled:opacity-40"
        >
          ⚔ Hit
        </button>
        <button
          disabled={toStart > 0}
          onPointerDown={(e) => {
            e.preventDefault();
            onGuard(true);
          }}
          onPointerUp={() => onGuard(false)}
          onPointerLeave={() => onGuard(false)}
          onPointerCancel={() => onGuard(false)}
          className="select-none rounded-xl bg-sky-700 px-2 py-2.5 text-sm font-bold text-white active:bg-sky-600 disabled:opacity-40"
        >
          🛡 Guard (hold)
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button disabled={busy} onClick={() => act(() => yieldDuel(duel.id))} className="text-[11px] font-semibold text-mud-500 hover:text-red-700">
          Yield
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-800">{error}</p>}
    </div>
  );
}
