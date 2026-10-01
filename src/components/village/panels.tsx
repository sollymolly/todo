"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { colorOf } from "@/lib/game";
import { sendFriendRequest } from "@/lib/social-actions";
import {
  deleteNote,
  joinSession,
  leaveNote,
  leaveSession,
  markNotesRead,
  nudgeStatus,
  nudgeTargets,
  saveHouse,
  sendNudge,
  setFocusRounds,
} from "@/lib/village-actions";
import { checkIn, clearMySession, serverNow, useSessionStore } from "@/lib/session-store";
import {
  bloomFor,
  clock,
  focusPhase,
  GARDENS,
  minutesLabel,
  NOTE_MAX,
  NUDGE_MAX,
  NUDGE_PRESETS,
  ROOFS,
  STATUS_LABEL,
  STYLES,
  tierFor,
  type HouseLook,
  type Neighbour,
  type SessionView,
  type Status,
} from "@/lib/village";
import { MyQuestSwitch, QuestPicker, StartSessionForm, useMyQuests } from "@/components/village/SessionControls";

/* --------------------------------------------------------------------------
   What opens in the village: a friend's house, your own, the town hall, and
   the list of who's about. A card on the right on a wide screen, a sheet
   from the bottom on a phone.
   -------------------------------------------------------------------------- */

export type Stats = Neighbour & { focusToday: number; focusWeek: number };

const BTN =
  "rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-grass-500 disabled:opacity-50";

export function Panel({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      className="panel absolute inset-x-0 bottom-0 z-[60000] max-h-[75%] overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-[calc(100%-5rem)] sm:w-80 sm:rounded-2xl"
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold text-mud-900">{title}</h2>
          {sub && <p className="text-xs text-mud-500">{sub}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-mud-500 hover:bg-mud-100 hover:text-mud-800">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

/** A knight's face and shoulders, cut from their walk sheet. */
export function Face({ sheet, size = 32 }: { sheet: string | undefined; size?: number }) {
  const s = size / 32;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 overflow-hidden rounded-full bg-mud-200 ring-1 ring-mud-300"
      style={{
        width: size,
        height: size,
        backgroundImage: sheet ? `url(${sheet})` : undefined,
        backgroundSize: `${576 * s}px ${256 * s}px`,
        backgroundPosition: `${-16 * s}px ${-(128 + 7) * s}px`,
        imageRendering: "pixelated",
      }}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-mud-100 px-2.5 py-2">
      <p className="text-[11px] text-mud-500">{label}</p>
      <p className="text-sm font-semibold text-mud-900">{value}</p>
    </div>
  );
}

/* ---------------------------------------------------------- friend house */

export function FriendHousePanel({
  n,
  where,
  session,
  onClose,
}: {
  n: Stats;
  where: string;
  session: SessionView | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"view" | "nudge" | "note">("view");
  const { pulse } = useSessionStore();
  const tier = tierFor(n.level);
  const mineIsThis = !!session && pulse?.mySessionId === session.id;

  return (
    <Panel title={`${n.name}'s ${tier.label.toLowerCase()}`} sub={`Level ${n.level} · ${where}`} onClose={onClose}>
      {mode === "nudge" ? (
        <NudgeForm friend={n} onDone={() => setMode("view")} />
      ) : mode === "note" ? (
        <NoteForm friend={n} onDone={() => setMode("view")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Done today" value={String(n.doneToday)} />
            <Stat label="Best streak" value={n.streak ? `${n.streak} days` : "—"} />
            <Stat label="Focus today" value={minutesLabel(n.focusToday)} />
            <Stat label="Focus this week" value={minutesLabel(n.focusWeek)} />
          </div>
          {n.categories.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mud-400">Open quests</p>
              <ul className="flex flex-wrap gap-1.5">
                {n.categories.map((c) => {
                  const col = colorOf(c.color);
                  return (
                    <li key={c.name} className={`rounded-md px-2 py-0.5 text-xs ${col.head} ${col.text}`}>
                      {c.name} · {c.open}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {session && !mineIsThis && <JoinButton session={session} label={`Join ${n.name}'s table`} />}
            <button className={BTN} onClick={() => setMode("nudge")}>
              Nudge
            </button>
            <button className={BTN} onClick={() => setMode("note")}>
              Leave a note
            </button>
            <Link className={BTN} href={`/friends?chat=${n.id}`}>
              Message
            </Link>
          </div>
        </>
      )}
    </Panel>
  );
}

function NudgeForm({ friend, onDone }: { friend: Neighbour; onDone: () => void }) {
  const [text, setText] = useState<string>(NUDGE_PRESETS[0]);
  const [todo, setTodo] = useState("");
  const [targets, setTargets] = useState<{ id: string; hint: string }[]>([]);
  const [status, setStatus] = useState<{ accepts: boolean; nextAt: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([nudgeTargets(friend.id), nudgeStatus(friend.id)]).then(([t, s]) => {
      if (!live) return;
      setTargets(t);
      setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [friend.id]);

  if (status && !status.accepts)
    return (
      <p className="text-sm text-mud-600">
        {friend.name} has nudges turned off.{" "}
        <button className="font-semibold text-grass-700" onClick={onDone}>
          Back
        </button>
      </p>
    );

  const waitUntil = status?.nextAt ? new Date(status.nextAt) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {NUDGE_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setText(p)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${text === p ? "bg-grass-100 text-grass-700 ring-1 ring-grass-300" : "bg-mud-100 text-mud-700 hover:bg-mud-200"}`}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        value={text}
        maxLength={NUDGE_MAX}
        onChange={(e) => setText(e.target.value)}
        aria-label="Nudge message"
        className="field w-full rounded-md px-2 py-1.5 text-sm"
      />
      {targets.length > 0 && (
        <label className="block text-xs font-semibold text-mud-600">
          About one of their quests (only its category and deadline are shown)
          <select
            value={todo}
            onChange={(e) => setTodo(e.target.value)}
            className="mt-1 w-full rounded-md bg-mud-100 px-2 py-1.5 text-[13px] font-normal text-mud-800 outline-none"
          >
            <option value="">Not about a quest</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.hint.charAt(0).toUpperCase() + t.hint.slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}
      {result && (
        <p className={`rounded-md px-2 py-1 text-xs ${result.ok ? "bg-grass-100 text-grass-700" : "bg-red-50 text-red-800"}`}>{result.text}</p>
      )}
      <div className="flex gap-2">
        <button
          className={PRIMARY}
          disabled={busy || !text.trim() || !!waitUntil || result?.ok}
          onClick={async () => {
            setBusy(true);
            const r = await sendNudge(friend.id, text, todo || null).catch(() => ({ ok: false as const, error: "Couldn't send." }));
            setResult(r.ok ? { ok: true, text: `Nudged ${friend.name}.` } : { ok: false, text: r.error });
            setBusy(false);
          }}
        >
          {busy ? "Sending…" : "Send nudge"}
        </button>
        <button className={BTN} onClick={onDone}>
          {result?.ok ? "Done" : "Cancel"}
        </button>
      </div>
      {waitUntil && !result?.ok && (
        <p className="text-xs text-mud-500">
          You nudged {friend.name} recently. You can again at{" "}
          {waitUntil.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
    </div>
  );
}

function NoteForm({ friend, onDone }: { friend: Neighbour; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        maxLength={NOTE_MAX}
        rows={3}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        placeholder={`A note for ${friend.name}'s door`}
        className="field w-full resize-none rounded-md px-2 py-1.5 text-sm"
      />
      <p className="text-[11px] text-mud-500">
        {text.length}/{NOTE_MAX} · Notes aren&apos;t encrypted like messages are.
      </p>
      {result && (
        <p className={`rounded-md px-2 py-1 text-xs ${result.ok ? "bg-grass-100 text-grass-700" : "bg-red-50 text-red-800"}`}>{result.text}</p>
      )}
      <div className="flex gap-2">
        <button
          className={PRIMARY}
          disabled={busy || !text.trim() || result?.ok}
          onClick={async () => {
            setBusy(true);
            const r = await leaveNote(friend.id, text).catch(() => ({ ok: false as const, error: "Couldn't pin it." }));
            setResult(r.ok ? { ok: true, text: "Pinned to their door." } : { ok: false, text: r.error });
            setBusy(false);
          }}
        >
          {busy ? "Pinning…" : "Pin it"}
        </button>
        <button className={BTN} onClick={onDone}>
          {result?.ok ? "Done" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function JoinButton({ session, label }: { session: SessionView; label: string }) {
  const [picking, setPicking] = useState(false);
  const [todo, setTodo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quests = useMyQuests();
  if (!picking)
    return (
      <button className={PRIMARY} onClick={() => setPicking(true)}>
        {label}
      </button>
    );
  return (
    <div className="w-full space-y-2 rounded-lg bg-mud-100 p-2.5">
      <QuestPicker value={todo} onChange={setTodo} quests={quests} />
      {error && <p className="text-xs text-red-800">{error}</p>}
      <div className="flex gap-2">
        <button
          className={PRIMARY}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await joinSession(session.id, todo || null).catch(() => ({ ok: false as const, error: "Couldn't join." }));
            if (!r.ok) setError(r.error);
            else await checkIn(null);
            setBusy(false);
            if (r.ok) setPicking(false);
          }}
        >
          {busy ? "Joining…" : "Sit down"}
        </button>
        <button className={BTN} onClick={() => setPicking(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- my house */

export function MyHousePanel({
  me,
  notes,
  onLook,
  onClose,
}: {
  me: Stats;
  notes: { id: string; from: string; body: string; at: number; read: boolean }[];
  onLook: (look: HouseLook) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"notes" | "house">(notes.length ? "notes" : "house");
  const [list, setList] = useState(notes);
  const [look, setLook] = useState(me.house);
  const [saving, setSaving] = useState(false);
  const tier = tierFor(me.level);

  useEffect(() => {
    if (notes.some((n) => !n.read)) void markNotesRead();
  }, [notes]);

  return (
    <Panel title={`Your ${tier.label.toLowerCase()}`} sub={`Level ${me.level} · streak ${me.streak} · focus this week ${minutesLabel(me.focusWeek)}`} onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-lg bg-mud-100 p-1 text-xs font-semibold">
        {(["notes", "house"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1 transition ${tab === t ? "bg-white text-mud-900 shadow-sm" : "text-mud-500"}`}
          >
            {t === "notes" ? `Door notes${list.length ? ` (${list.length})` : ""}` : "Customise"}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        list.length === 0 ? (
          <p className="text-sm text-mud-500">Nothing pinned to your door yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((n) => (
              <li key={n.id} className="rounded-lg bg-[#fff6d8] p-2.5 text-sm text-mud-800 shadow-sm ring-1 ring-[#eadba6]">
                <p className="break-words">{n.body}</p>
                <div className="mt-1 flex items-center justify-between text-[11px] text-mud-500">
                  <span>
                    {n.from} · {new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <button
                    className="hover:text-red-700"
                    onClick={() => {
                      setList((l) => l.filter((x) => x.id !== n.id));
                      void deleteNote(n.id);
                    }}
                  >
                    Take down
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-mud-500">
            Your {tier.label.toLowerCase()} grows as you level up; your garden blooms with your habit streak (now{" "}
            {["bare", "sprouting", "in flower", "lush"][bloomFor(me.streak)]}).
          </p>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mud-400">Walls</p>
            <div className="flex gap-1.5">
              {STYLES.map((s) => {
                const locked = me.level < s.level;
                return (
                  <button
                    key={s.style}
                    disabled={locked}
                    onClick={() => setLook({ ...look, style: s.style })}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs transition disabled:opacity-50 ${look.style === s.style ? "bg-grass-100 text-grass-700 ring-1 ring-grass-300" : "bg-mud-100 text-mud-700"}`}
                  >
                    {s.label}
                    {locked && <span className="block text-[10px]">Level {s.level}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mud-400">Roof</p>
            <div className="flex flex-wrap gap-1.5">
              {ROOFS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setLook({ ...look, roof: r.id })}
                  aria-label={r.label}
                  title={r.label}
                  className={`size-7 rounded-md transition ${look.roof === r.id ? "ring-2 ring-grass-500 ring-offset-2" : ""}`}
                  style={{ background: r.fill }}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mud-400">Garden</p>
            <div className="flex gap-1.5">
              {GARDENS.map((g) => (
                <button
                  key={g.garden}
                  onClick={() => setLook({ ...look, garden: g.garden })}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs transition ${look.garden === g.garden ? "bg-grass-100 text-grass-700 ring-1 ring-grass-300" : "bg-mud-100 text-mud-700"}`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className={PRIMARY}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const saved = await saveHouse(look).catch(() => null);
              if (saved) onLook(saved);
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- the hall */

export function HallPanel({
  sessions,
  sheets,
  me,
  onClose,
}: {
  sessions: SessionView[];
  sheets: Record<string, string>;
  me: Stats;
  onClose: () => void;
}) {
  const { pulse, skew } = useSessionStore();
  const [, tick] = useState(0);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = serverNow(skew);
  const mine = sessions.find((s) => s.id === pulse?.mySessionId) ?? null;

  return (
    <Panel title="Town hall" sub={`Your focus: ${minutesLabel(me.focusToday)} today · ${minutesLabel(me.focusWeek)} this week`} onClose={onClose}>
      {sessions.length === 0 && !mine && <p className="mb-3 text-sm text-mud-500">Nobody&apos;s working here right now.</p>}
      <ul className="space-y-2.5">
        {sessions.map((s) => {
          const phase = s.focus && s.focusFrom ? focusPhase(s.focusFrom, now) : null;
          const isMine = s.id === mine?.id;
          const host = s.members.find((m) => m.villager.id === s.hostId) ?? s.members[0];
          return (
            <li key={s.id} className={`rounded-xl p-3 ring-1 ${isMine ? "bg-grass-100/60 ring-grass-300" : "bg-mud-100 ring-mud-200"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-mud-900">
                  {isMine ? "Your table" : `${host?.villager.name ?? "A"}'s table`}
                </p>
                <p className="text-xs tabular-nums text-mud-600">
                  {phase ? `${phase.phase === "work" ? "Focus" : "Break"} ${clock(phase.left)}` : clock(now - s.startedAt)}
                </p>
              </div>
              <ul className="mt-2 space-y-1.5">
                {s.members.map((m) => (
                  <li key={m.villager.id} className="flex items-center gap-2 text-sm">
                    <Face sheet={sheets[m.villager.id]} size={26} />
                    <span className="min-w-0 flex-1 truncate text-mud-800">{m.villager.name}</span>
                    {m.working && (
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${colorOf(m.working.color).head} ${colorOf(m.working.color).text}`}>
                        {m.working.name}
                      </span>
                    )}
                    <span className="text-[11px] tabular-nums text-mud-500">{clock(now - m.joinedAt)}</span>
                    {!m.known && m.villager.id !== pulse?.me && (
                      <button
                        className="text-[11px] font-semibold text-grass-700 disabled:text-mud-400"
                        disabled={added.has(m.villager.id)}
                        onClick={async () => {
                          await sendFriendRequest(m.villager.id).catch(() => null);
                          setAdded((a) => new Set(a).add(m.villager.id));
                        }}
                      >
                        {added.has(m.villager.id) ? "Asked" : "Add"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {isMine ? (
                <div className="mt-3 space-y-2 border-t border-grass-200 pt-2">
                  <label className="block text-xs font-semibold text-mud-600">
                    Working on
                    <div className="mt-1">
                      <MyQuestSwitch />
                    </div>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-mud-700">
                    <input
                      type="checkbox"
                      checked={s.focus}
                      onChange={(e) => void setFocusRounds(e.target.checked).then(() => checkIn(null))}
                      className="size-4 accent-grass-600"
                    />
                    Shared focus rounds (25 / 5)
                  </label>
                  <button
                    className={BTN}
                    onClick={async () => {
                      await leaveSession();
                      clearMySession();
                      void checkIn(null);
                    }}
                  >
                    Leave the table
                  </button>
                </div>
              ) : (
                <div className="mt-2.5">
                  <JoinButton session={s} label="Join" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!mine && (
        <div className="mt-4 border-t border-mud-200 pt-3">
          <StartSessionForm />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- who's out */

/** In the village first, then at home, then offline. */
const STATUS_ORDER: Record<Status, number> = { village: 0, home: 1, offline: 2 };
export const STATUS_DOT: Record<Status, string> = { village: "bg-grass-500", home: "bg-amber-400", offline: "bg-mud-300" };

export function PeoplePanel({
  people,
  sheets,
  onGo,
  onClose,
}: {
  people: { n: Neighbour; status: Status; where: string }[];
  sheets: Record<string, string>;
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  const sorted = [...people].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.n.name.localeCompare(b.n.name));
  const count = (s: Status) => people.filter((p) => p.status === s).length;
  return (
    <Panel title="Your companions" sub={`${count("village")} in the village · ${count("home")} at home`} onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="text-sm text-mud-500">
          No companions yet. <Link href="/friends" className="font-semibold text-grass-700">Find some</Link> and their houses will appear here.
        </p>
      ) : (
        <ul className="space-y-1">
          {sorted.map(({ n, status, where }) => (
            <li key={n.id}>
              <button onClick={() => onGo(n.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-mud-100">
                <Face sheet={sheets[n.id]} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-mud-900">{n.name}</span>
                  <span className="block truncate text-xs text-mud-500">{where}</span>
                </span>
                <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} aria-label={STATUS_LABEL[status]} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
