"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { leaveSession } from "@/lib/village-actions";
import { checkIn, clearMySession, serverNow, useSessionStore } from "@/lib/session-store";
import { clock, focusPhase } from "@/lib/village";

/* --------------------------------------------------------------------------
   The running work session, wherever you are in the app: how long you've
   been at it, the shared focus clock if there is one, who's with you, and a
   way out. The check-ins that keep your seat are the village's and
   Presence.tsx's — close every page and the table lets you go after two
   minutes.
   -------------------------------------------------------------------------- */

export default function SessionPill() {
  const pathname = usePathname();
  const { mine, skew, pulse } = useSessionStore();
  const [, tick] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inVillage = pathname === "/village";

  // The clocks tick every second.
  useEffect(() => {
    if (!mine) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [mine]);

  if (!mine && !note) return null;

  const now = serverNow(skew);
  const me = mine?.members.find((m) => m.villager.id === pulse?.me) ?? null;
  const since = me ? me.joinedAt : now;
  const phase = mine?.focus && mine.focusFrom ? focusPhase(mine.focusFrom, now, mine.rhythm) : null;
  const others = mine ? mine.members.length - 1 : 0;

  return (
    <div
      // In Messages on a phone it would sit on the message box; the timer
      // keeps running and shows again on any other page.
      className={`fixed left-3 z-40 max-w-[calc(100%-6rem)] sm:bottom-4 sm:left-4 ${pathname === "/friends" ? "max-sm:hidden" : ""} ${
        inVillage ? "bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] sm:bottom-4" : "bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)]"
      }`}
    >
      {note ? (
        <p role="status" className="panel rounded-full px-4 py-2 text-[13px] text-mud-800">
          {note}
        </p>
      ) : mine ? (
        <div className="panel flex items-center gap-2.5 rounded-full py-1.5 pl-3 pr-1.5 text-[13px] text-mud-800 shadow-lg">
          <span className={`size-2.5 shrink-0 rounded-full ${phase?.phase === "break" ? "bg-amber-400" : "animate-pulse bg-grass-500"}`} />
          <span className="whitespace-nowrap font-semibold tabular-nums">
            {phase ? (
              <>
                {phase.phase === "work" ? "Focus" : "Break"} · {clock(phase.left)}
              </>
            ) : (
              <>Working · {clock(now - since)}</>
            )}
          </span>
          {others > 0 && (
            <span className="hidden truncate text-xs text-mud-500 sm:inline">
              with {others} {others === 1 ? "other" : "others"}
            </span>
          )}
          {!inVillage && (
            <Link href="/village" className="rounded-full px-2 py-1 text-xs font-semibold text-grass-700 hover:bg-grass-100">
              Table
            </Link>
          )}
          <button
            disabled={leaving}
            onClick={async () => {
              setLeaving(true);
              try {
                const { xp } = await leaveSession();
                clearMySession();
                const min = Math.round((now - since) / 60000);
                setNote(`Logged ${min} min${xp ? ` · +${xp} XP` : ""}`);
                setTimeout(() => setNote(null), 4000);
                void checkIn(null);
              } finally {
                setLeaving(false);
              }
            }}
            className="rounded-full bg-mud-100 px-2.5 py-1 text-xs font-semibold text-mud-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            {leaving ? "…" : "Stop"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
