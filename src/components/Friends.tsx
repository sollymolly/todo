"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import CharacterSprite from "@/components/CharacterSprite";
import Scenery from "@/components/Scenery";
import { colorOf, progressFor } from "@/lib/game";
import {
  cancelRequest,
  findPerson,
  listMessages,
  removeFriend,
  respondToRequest,
  sendFriendRequest,
  sendMessage,
  type FoundPerson,
  type FriendSummary,
  type PendingRequest,
  type SealedMessage,
} from "@/lib/social-actions";
import {
  loadPrivateKey,
  openMessage,
  safetyNumber,
  sealMessage,
} from "@/lib/crypto";
import { formatStamp } from "@/lib/date";

type Shown = { id: string; mine: boolean; text: string; at: string };

/** How often an open thread asks for anything new. */
const POLL_MS = 5000;

/**
 * Union by id, ordered the way the server orders: created_at, then id as the
 * tiebreak. A message can arrive twice — sent optimistically, then again from
 * the poll — and the id is what makes that harmless.
 */
function merge(prev: Shown[], incoming: Shown[]): Shown[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)
  );
}

export default function Friends({
  friends,
  requests,
  meId,
  myPublicKey,
}: {
  friends: FriendSummary[];
  requests: PendingRequest[];
  meId: string;
  myPublicKey: string | null;
}) {
  const hasKeys = !!myPublicKey;
  const router = useRouter();
  // The id rather than the row: a refresh replaces the objects in `friends`,
  // and an open thread should follow the new one (its unread count resets).
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = friends.find((f) => f.user_id === openId) ?? null;
  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFound(null);
    setBusy(true);
    try {
      const res = await findPerson(query);
      if (!res.ok) return setError(res.error);
      setFound(res.person);
    } finally {
      setBusy(false);
    }
  }

  async function ask(person: FoundPerson) {
    setError(null);
    const res = await sendFriendRequest(person.user_id);
    if (!res.ok) return setError(res.error);
    setFound(null);
    setQuery("");
    refresh();
  }

  const refresh = () => router.refresh();

  return (
    <>
      <Scenery />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
              Companions
            </h1>
            <p className="text-xs font-semibold text-mud-600">
              {friends.length === 0
                ? "No companions yet. Find one below."
                : `${friends.length} ${friends.length === 1 ? "companion" : "companions"} on the road.`}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            ← Back to quests
          </Link>
        </header>

        {!hasKeys && (
          <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-300">
            This account has no encryption keys yet. Sign out and back in to
            create them, then messaging will unlock.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
          {/* ------------------------------------------------------- left */}
          <div className="space-y-4 lg:sticky lg:top-6">
            <section className="panel rounded-2xl p-4">
              <h2 className="mb-2 font-display text-sm font-bold tracking-wide text-mud-800">
                Find an adventurer
              </h2>
              <form onSubmit={search} className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="username or email"
                  className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  disabled={busy || !query.trim()}
                  className="shrink-0 rounded-lg bg-grass-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
                >
                  {busy ? "…" : "Seek"}
                </button>
              </form>

              {error && (
                <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-800">
                  {error}
                </p>
              )}

              {found && (
                <div className="mt-3 rounded-xl border border-mud-200 bg-white/70 p-3">
                  <p className="font-display text-sm font-bold text-mud-900">
                    {found.display_name}
                  </p>
                  <p className="text-xs text-mud-500">
                    @{found.username} · Lv {progressFor(found.xp).level}{" "}
                    {progressFor(found.xp).title}
                  </p>
                  {found.status === "accepted" ? (
                    <p className="mt-2 text-xs font-semibold text-grass-700">
                      Already your companion.
                    </p>
                  ) : found.status === "pending" ||
                    (found.status === "declined" && found.i_asked) ? (
                    // A decline I received reads the same as one still waiting.
                    // Telling someone they were turned down invites a second
                    // attempt, which is the thing declining is meant to stop.
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      A request is already pending.
                    </p>
                  ) : (
                    <button
                      onClick={() => ask(found)}
                      className="mt-2 w-full rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-grass-500"
                    >
                      Send request
                    </button>
                  )}
                </div>
              )}
            </section>

            {incoming.length > 0 && (
              <section className="panel rounded-2xl p-4">
                <h2 className="mb-2 font-display text-sm font-bold tracking-wide text-mud-800">
                  Requests ({incoming.length})
                </h2>
                <ul className="space-y-2">
                  {incoming.map((r) => (
                    <li
                      key={r.friendship_id}
                      className="rounded-xl border border-mud-200 bg-white/70 p-2.5"
                    >
                      <p className="text-sm font-bold text-mud-900">
                        {r.display_name}
                      </p>
                      <p className="text-xs text-mud-500">@{r.username}</p>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          onClick={async () => {
                            await respondToRequest(r.friendship_id, true);
                            refresh();
                          }}
                          className="rounded-lg bg-grass-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-grass-500"
                        >
                          Accept
                        </button>
                        <button
                          onClick={async () => {
                            await respondToRequest(r.friendship_id, false);
                            refresh();
                          }}
                          className="rounded-lg px-2.5 py-1 text-xs font-semibold text-mud-500 hover:bg-mud-100"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {outgoing.length > 0 && (
              <section className="panel rounded-2xl p-4">
                <h2 className="mb-2 font-display text-sm font-bold tracking-wide text-mud-800">
                  Awaiting reply
                </h2>
                <ul className="space-y-1.5">
                  {outgoing.map((r) => (
                    <li
                      key={r.friendship_id}
                      className="flex items-center gap-2 text-xs text-mud-500"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        @{r.username} — sent
                      </span>
                      <button
                        onClick={async () => {
                          setError(null);
                          const res = await cancelRequest(r.friendship_id);
                          if (!res.ok) return setError(res.error);
                          refresh();
                        }}
                        title="Withdraw this request"
                        className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-mud-400 transition hover:bg-red-100 hover:text-red-700"
                      >
                        Unsend
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* ------------------------------------------------------ right */}
          <div className="min-w-0">
            {friends.length === 0 ? (
              <div className="panel rounded-2xl px-6 py-12 text-center">
                <p className="font-display text-lg font-bold text-mud-800">
                  The road is quiet
                </p>
                <p className="mt-1 text-sm text-mud-500">
                  Search for a friend by username or email to travel together.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {friends.map((f) => (
                  <FriendCard
                    key={f.friendship_id}
                    friend={f}
                    onOpen={() => setOpenId(f.user_id)}
                    onRemove={async () => {
                      await removeFriend(f.friendship_id);
                      if (openId === f.user_id) setOpenId(null);
                      refresh();
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <Thread
              key={open.user_id}
              friend={open}
              meId={meId}
              myPublicKey={myPublicKey}
              onClose={() => {
                setOpenId(null);
                refresh();
              }}
            />
          )}
        </AnimatePresence>
      </main>
    </>
  );
}

/* ========================================================================== */

function FriendCard({
  friend,
  onOpen,
  onRemove,
}: {
  friend: FriendSummary;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const p = progressFor(friend.xp);
  const [confirm, setConfirm] = useState(false);

  return (
    <li className="panel rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <CharacterSprite
          appearance={friend.appearance}
          equipped={friend.equipped}
          scale={2}
          idle={false}
          className="shrink-0 drop-shadow-[0_4px_6px_rgba(42,30,19,0.3)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-mud-900">
            {friend.display_name}
          </p>
          <p className="truncate text-xs text-mud-500">@{friend.username}</p>
          <p className="mt-1 text-xs font-bold text-grass-700">
            Lv {p.level} · {p.title}
          </p>
          <p className="text-[11px] text-mud-500">
            {friend.completed} quest{friend.completed === 1 ? "" : "s"} completed
          </p>

          {/* Today's activity, the bit that makes the list feel alive. Counted
              in their timezone, so it turns over at their midnight not yours. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
                friend.done_today > 0
                  ? "bg-grass-100 text-grass-700 ring-grass-300"
                  : "bg-mud-50 text-mud-400 ring-mud-200"
              }`}
              title="Quests they finished today"
            >
              {friend.done_today > 0
                ? `${friend.done_today} today`
                : "nothing yet today"}
            </span>
            {friend.streak > 0 && (
              <span
                className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-inset ring-amber-300"
                title="Their longest running habit streak"
              >
                {friend.streak}-day streak
              </span>
            )}
          </div>
        </div>
      </div>

      {friend.categories.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1">
          {friend.categories.map((c) => {
            const col = colorOf(c.color);
            return (
              <li
                key={c.name}
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${col.soft} ${col.text} ring-1 ring-inset ${col.ring}`}
              >
                {c.name} · {c.open}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <button
          onClick={onOpen}
          className="relative flex-1 rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-grass-500"
        >
          Message
          {friend.unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white">
              {friend.unread}
            </span>
          )}
        </button>
        {confirm ? (
          <>
            <button
              onClick={onRemove}
              className="rounded-lg bg-red-600 px-2 py-1.5 text-xs font-bold text-white"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-mud-500"
            >
              No
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            title="Part ways"
            className="rounded-lg px-2 py-1.5 text-xs text-mud-400 transition hover:bg-red-100 hover:text-red-700"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

/* ========================================================================== */
/* Encrypted thread                                                            */
/* ========================================================================== */

function Thread({
  friend,
  meId,
  myPublicKey,
  onClose,
}: {
  friend: FriendSummary;
  meId: string;
  myPublicKey: string | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  // Derived from props rather than set inside the effect, so the first render
  // is already correct and nothing cascades.
  const [state, setState] = useState<"loading" | "ready" | "locked" | "nokey">(
    friend.public_key ? "loading" : "nokey"
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  // Newest message the server has handed us. The poll asks for what follows it.
  const cursor = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const pub = friend.public_key;

  const decrypt = useCallback(
    async (priv: CryptoKey, sealed: SealedMessage[]): Promise<Shown[]> => {
      if (!pub) return [];
      const out: Shown[] = [];
      for (const m of sealed) {
        let text: string;
        try {
          text = await openMessage(
            priv,
            pub,
            { iv: m.iv, body: m.body },
            // Who the row claims wrote it. A tampered sender fails the tag.
            m.sender_id === meId
              ? { from: meId, to: friend.user_id }
              : { from: friend.user_id, to: meId }
          );
        } catch {
          text = "Could not decrypt this message.";
        }
        out.push({
          id: m.id,
          mine: m.sender_id === meId,
          text,
          at: m.created_at,
        });
      }
      return out;
    },
    [pub, meId, friend.user_id]
  );

  useEffect(() => {
    if (!pub) return; // state is already "nokey"

    let alive = true;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(first: boolean) {
      // `running` keeps the visibility listener from racing an in-flight poll.
      if (!alive || running) return;
      running = true;
      try {
        // A backgrounded tab is nobody reading. Skipping the round trip keeps
        // an idle thread from costing a request every few seconds forever.
        if (!first && typeof document !== "undefined" && document.hidden) return;

        const priv = keyRef.current ?? (await loadPrivateKey());
        if (!alive) return;
        if (!priv) {
          setState("locked");
          return; // no point polling a thread we can't read
        }
        keyRef.current = priv;

        const sealed = await listMessages(friend.user_id, cursor.current);
        if (!alive) return;

        if (sealed.length) {
          cursor.current = sealed[sealed.length - 1].id;
          const shown = await decrypt(priv, sealed);
          if (!alive) return;
          setMessages((prev) => merge(prev, shown));
        }
        if (first) setState("ready");
      } catch {
        // A failed poll is not worth surfacing — the next one usually works.
        if (first && alive) setState("ready");
      } finally {
        running = false;
        if (alive) {
          clearTimeout(timer);
          timer = setTimeout(() => void tick(false), POLL_MS);
        }
      }
    }

    // Coming back to the tab should feel instant rather than wait out the interval.
    const onVisibility = () => {
      if (!document.hidden) void tick(false);
    };
    document.addEventListener("visibilitychange", onVisibility);

    void tick(true);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pub, friend.user_id, decrypt]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!pub || !myPublicKey) return;
    let alive = true;
    void safetyNumber(myPublicKey, pub).then((n) => {
      if (alive) setFingerprint(n);
    });
    return () => {
      alive = false;
    };
  }, [pub, myPublicKey]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const priv = keyRef.current;
    if (!text || !priv || !pub || sending) return;

    setSending(true);
    setSendError(null);
    try {
      const sealed = await sealMessage(priv, pub, text, {
        from: meId,
        to: friend.user_id,
      });
      const res = await sendMessage(friend.user_id, sealed.iv, sealed.body);
      if (!res.ok) return setSendError(res.error);
      // Not advancing the cursor: a message from them may have landed since the
      // last poll, and skipping past it would lose it. merge() drops the
      // duplicate when the poll hands this one back.
      setMessages((prev) =>
        merge(prev, [
          { id: res.message.id, mine: true, text, at: res.message.created_at },
        ])
      );
      setDraft("");
    } catch (err) {
      // The draft is deliberately left in the box so nothing is lost.
      setSendError(
        err instanceof Error ? err.message : "That message did not send."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mud-900/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="panel flex h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
        initial={{ scale: 0.95, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-mud-200 bg-mud-100 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-bold text-mud-900">
              {friend.display_name}
            </p>
            <p className="text-[11px] text-mud-500">
              End-to-end encrypted · @{friend.username}
              {fingerprint && (
                <>
                  {" · "}
                  <button
                    onClick={() => setShowFingerprint((v) => !v)}
                    className="underline underline-offset-2 transition hover:text-grass-700"
                  >
                    {showFingerprint ? "hide" : "verify"}
                  </button>
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-mud-500 transition hover:bg-white/70 hover:text-mud-900"
          >
            ✕
          </button>
        </header>

        {showFingerprint && fingerprint && (
          <div className="border-b border-mud-200 bg-mud-50 px-4 py-3">
            <p className="font-mono text-sm font-bold tracking-widest text-mud-900">
              {fingerprint}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-mud-500">
              Read this aloud to {friend.display_name}. If their screen shows
              the same code, no one is in the middle. It only changes if one of
              you resets your keys — or if this server hands out a key that
              isn&apos;t theirs, which is the one attack the encryption cannot
              catch by itself.
            </p>
          </div>
        )}

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {state === "loading" && (
            <p className="text-center text-xs text-mud-400">Decrypting…</p>
          )}
          {state === "locked" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
              Your key isn&apos;t loaded in this tab. Sign out and back in to
              unlock messages — nothing is stored on the server that could
              decrypt them for you.
            </p>
          )}
          {state === "nokey" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
              {friend.display_name} hasn&apos;t set up encryption keys yet. Once
              they sign in again, you can message them.
            </p>
          )}
          {state === "ready" && messages.length === 0 && (
            <p className="text-center text-xs text-mud-400">
              No words yet. Say something.
            </p>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                  m.mine
                    ? "bg-grass-600 text-white"
                    : "border border-mud-200 bg-white text-mud-900"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p
                  className={`mt-0.5 text-[10px] ${
                    m.mine ? "text-white/70" : "text-mud-400"
                  }`}
                >
                  {formatStamp(m.at)}
                </p>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={send}
          className="border-t border-mud-200 bg-mud-50 p-3"
        >
          {sendError && (
            <p className="mb-2 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800">
              {sendError} Your words are still in the box — try again.
            </p>
          )}
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={state === "ready" ? "Send word…" : "Locked"}
              disabled={state !== "ready"}
              maxLength={2000}
              className="field min-w-0 flex-1 rounded-xl px-3 py-2 text-sm disabled:opacity-50"
            />
            <button
              disabled={state !== "ready" || !draft.trim() || sending}
              className="shrink-0 rounded-xl bg-grass-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
