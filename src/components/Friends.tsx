"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import { colorOf, progressFor } from "@/lib/game";
import {
  cancelRequest,
  findPerson,
  inbox,
  listMessages,
  removeFriend,
  respondToRequest,
  sendFriendRequest,
  sendMessage,
  type FoundPerson,
  type FriendSummary,
  type InboxEntry,
  type PendingRequest,
  type SealedMessage,
} from "@/lib/social-actions";
import { loadPrivateKey, openMessage, safetyNumber, sealMessage } from "@/lib/crypto";
import { escrowKey, getMessageKey } from "@/lib/message-key";

/* --------------------------------------------------------------------------
   Messages, laid out like any messaging app: conversations on the left,
   newest first, with a preview and an unread count; the open conversation on
   the right. On a phone, the list and the conversation take turns filling
   the screen, and the back button goes from one to the other.

   Everything is still end-to-end encrypted. The server hands over each
   conversation's latest message sealed, and the preview is decrypted here,
   with the same key as the thread.

   How friends are doing shrinks to one quiet line: level, what they've done
   today, their streak, and a dot when they're in the village. The rest is a
   tap on their name away.
   -------------------------------------------------------------------------- */

type Shown = { id: string; mine: boolean; text: string; at: string };

/** How often an open thread asks for anything new. */
const POLL_MS = 5000;
/** And the conversation list, for previews and unread counts. */
const INBOX_MS = 8000;

/**
 * Union by id, ordered the way the server orders: created_at, then id as the
 * tiebreak. A message can arrive twice — sent optimistically, then again from
 * the poll — and the id is what makes that harmless.
 */
function merge(prev: Shown[], incoming: Shown[]): Shown[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ time */

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/** For the list: a time today, a weekday this week, a date before that. */
function listStamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(d: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Level, today, streak — the whole status, kept to one small line. */
function statusLine(f: FriendSummary) {
  const bits = [`Lv ${progressFor(f.xp).level}`];
  if (f.done_today) bits.push(`${f.done_today} done today`);
  if (f.streak) bits.push(`${f.streak}-day streak`);
  return bits.join(" · ");
}

/* ================================================================== page */

export default function Friends({
  friends,
  requests,
  meId,
  myPublicKey,
  keyEscrowed,
}: {
  friends: FriendSummary[];
  requests: PendingRequest[];
  meId: string;
  myPublicKey: string | null;
  /** The server already holds this account's message key. */
  keyEscrowed: boolean;
  /** Read from the URL instead; kept so the page's call site stays simple. */
  initialChat?: string | null;
}) {
  const router = useRouter();
  const hasKeys = !!myPublicKey;

  // An account from before escrow, in a tab that still has its key unlocked:
  // file it now, so the history survives if the password is ever forgotten.
  useEffect(() => {
    if (keyEscrowed) return;
    void loadPrivateKey().then((key) => key && escrowKey(key));
  }, [keyEscrowed]);

  /* The open conversation lives in the URL (?chat=…), so a phone's back
     button goes from a conversation to the list, and the village's Message
     button can link straight to one. Changed with the History API, which
     Next keeps in step with useSearchParams without a server round trip. */
  const params = useSearchParams();
  const wanted = params.get("chat");
  const openId = wanted && friends.some((f) => f.user_id === wanted) ? wanted : null;
  const pushed = useRef(false);
  const openChat = (id: string) => {
    window.history.pushState(null, "", `/friends?chat=${id}`);
    pushed.current = true;
  };
  const closeChat = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else window.history.replaceState(null, "", "/friends");
  };

  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);

  /* ------------------------------------------------ inbox and previews */

  const [entries, setEntries] = useState<Map<string, InboxEntry>>(new Map());
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const keyRef = useRef<CryptoKey | null>(null);
  const byId = useMemo(() => new Map(friends.map((f) => [f.user_id, f])), [friends]);

  const refreshInbox = useCallback(async () => {
    let rows: InboxEntry[];
    try {
      rows = await inbox();
    } catch {
      return;
    }
    setEntries(new Map(rows.map((r) => [r.friend_id, r])));
    const priv = keyRef.current ?? (await getMessageKey().catch(() => null));
    if (!priv) return;
    keyRef.current = priv;
    const next = new Map<string, string>();
    for (const r of rows) {
      const f = byId.get(r.friend_id);
      if (!r.last || !f?.public_key) continue;
      try {
        const text = await openMessage(
          priv,
          f.public_key,
          { iv: r.last.iv, body: r.last.body },
          r.last.sender_id === meId ? { from: meId, to: f.user_id } : { from: f.user_id, to: meId }
        );
        next.set(r.friend_id, (r.last.sender_id === meId ? "You: " : "") + text.replace(/\s+/g, " "));
      } catch {
        next.set(r.friend_id, "Encrypted message");
      }
    }
    setPreviews(next);
  }, [byId, meId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const beat = async () => {
      if (!document.hidden) await refreshInbox();
      timer = setTimeout(beat, INBOX_MS);
    };
    void beat();
    const onVis = () => !document.hidden && void refreshInbox();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshInbox]);

  // Newest conversation first; people you've never written to after, by name.
  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return friends
      .filter((f) => !q || f.display_name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
      .sort((a, b) => {
        const la = entries.get(a.user_id)?.last?.created_at ?? "";
        const lb = entries.get(b.user_id)?.last?.created_at ?? "";
        return lb.localeCompare(la) || a.display_name.localeCompare(b.display_name);
      });
  }, [friends, entries, filter]);

  const incoming = requests.filter((r) => r.direction === "incoming");
  const open = openId ? (byId.get(openId) ?? null) : null;

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] max-w-6xl flex-col sm:h-[calc(100dvh-env(safe-area-inset-top))] sm:p-4 lg:p-6">
      <div className="panel flex min-h-0 flex-1 overflow-hidden sm:rounded-2xl">
        {/* ------------------------------------------------------ the list */}
        <aside
          className={`min-h-0 w-full flex-col border-mud-200 lg:flex lg:w-[340px] lg:shrink-0 lg:border-r ${open ? "hidden" : "flex"}`}
        >
          <header className="flex items-center gap-2 px-4 pb-2 pt-3">
            <Link href="/" className="-ml-1 rounded-md px-1 text-lg text-mud-500 hover:text-mud-900 sm:hidden" aria-label="Back to quests">
              ‹
            </Link>
            <h1 className="flex-1 font-display text-xl font-bold text-mud-900">Messages</h1>
            <button
              onClick={() => setAdding(true)}
              className="rounded-full bg-grass-600 px-3 py-1 text-xs font-semibold text-white hover:bg-grass-500"
            >
              + Add
            </button>
          </header>
          <div className="px-4 pb-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search companions"
              aria-label="Search companions"
              className="w-full rounded-full bg-mud-100 px-3.5 py-1.5 text-sm text-mud-900 outline-none placeholder:text-mud-400 focus:ring-2 focus:ring-grass-400"
            />
          </div>

          {!hasKeys && (
            <p className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
              This account has no encryption keys yet. Sign out and back in to create them.
            </p>
          )}

          {incoming.length > 0 && (
            <div className="mx-3 mb-2 space-y-1.5 rounded-xl bg-grass-100/60 p-2 ring-1 ring-grass-200">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-grass-700">
                {incoming.length === 1 ? "1 request" : `${incoming.length} requests`}
              </p>
              {incoming.map((r) => (
                <div key={r.friendship_id} className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-mud-900">{r.display_name}</p>
                    <p className="truncate text-[11px] text-mud-500">@{r.username}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await respondToRequest(r.friendship_id, true);
                      router.refresh();
                    }}
                    className="rounded-full bg-grass-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-grass-500"
                  >
                    Accept
                  </button>
                  <button
                    onClick={async () => {
                      await respondToRequest(r.friendship_id, false);
                      router.refresh();
                    }}
                    aria-label={`Decline ${r.display_name}`}
                    className="rounded-full px-1.5 py-1 text-xs text-mud-400 hover:bg-mud-100 hover:text-mud-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {friends.length === 0 && (
              <li className="px-3 py-10 text-center text-sm text-mud-500">
                No companions yet.{" "}
                <button onClick={() => setAdding(true)} className="font-semibold text-grass-700">
                  Find someone
                </button>{" "}
                to talk to.
              </li>
            )}
            {list.map((f) => {
              const e = entries.get(f.user_id);
              const unread = f.user_id === openId ? 0 : (e?.unread ?? f.unread);
              const preview = previews.get(f.user_id);
              return (
                <li key={f.user_id}>
                  <button
                    onClick={() => openChat(f.user_id)}
                    aria-current={f.user_id === openId ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                      f.user_id === openId ? "bg-grass-100/70" : "hover:bg-mud-100"
                    }`}
                  >
                    <Avatar appearance={f.appearance} equipped={f.equipped} size={46} online={!!e?.in_village} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`min-w-0 flex-1 truncate text-[15px] ${unread ? "font-bold" : "font-semibold"} text-mud-900`}>
                          {f.display_name}
                        </span>
                        {e?.last && (
                          <span className={`shrink-0 text-[11px] ${unread ? "font-semibold text-grass-700" : "text-mud-400"}`}>
                            {listStamp(e.last.created_at)}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "font-semibold text-mud-800" : "text-mud-500"}`}>
                          {preview ?? (e?.last ? "…" : "Say hello")}
                        </span>
                        {unread > 0 && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-grass-600 px-1.5 text-[11px] font-bold text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-mud-400">{statusLine(f)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ------------------------------------------------ the conversation */}
        <section className={`min-h-0 min-w-0 flex-1 flex-col ${open ? "flex" : "hidden lg:flex"}`}>
          {open ? (
            <Thread
              key={open.user_id}
              friend={open}
              meId={meId}
              myPublicKey={myPublicKey}
              seenAt={entries.get(open.user_id)?.seen_at ?? null}
              inVillage={!!entries.get(open.user_id)?.in_village}
              onBack={closeChat}
              onSent={() => void refreshInbox()}
              onRemove={async () => {
                await removeFriend(open.friendship_id);
                closeChat();
                router.refresh();
              }}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <p className="font-display text-lg font-bold text-mud-800">Pick a conversation</p>
                <p className="mt-1 text-sm text-mud-500">Messages are end-to-end encrypted.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {adding && <AddCompanion requests={requests} onClose={() => setAdding(false)} onChanged={() => router.refresh()} />}
    </main>
  );
}

/* ============================================================ add someone */

function AddCompanion({
  requests,
  onClose,
  onChanged,
}: {
  requests: PendingRequest[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="sheet panel w-full max-w-sm rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-mud-900">Add a companion</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-mud-500 hover:bg-mud-100">
            ✕
          </button>
        </div>
        <form onSubmit={search} className="flex gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Exact username or email"
            className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
          />
          <button
            disabled={busy || !query.trim()}
            className="shrink-0 rounded-lg bg-grass-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-grass-500 disabled:bg-mud-300"
          >
            {busy ? "…" : "Find"}
          </button>
        </form>
        {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-800">{error}</p>}
        {found && (
          <div className="mt-3 rounded-xl border border-mud-200 bg-white/70 p-3">
            <p className="font-display text-sm font-bold text-mud-900">{found.display_name}</p>
            <p className="text-xs text-mud-500">
              @{found.username} · Lv {progressFor(found.xp).level} {progressFor(found.xp).title}
            </p>
            {found.status === "accepted" ? (
              <p className="mt-2 text-xs font-semibold text-grass-700">Already your companion.</p>
            ) : found.status === "pending" || (found.status === "declined" && found.i_asked) ? (
              // A decline I received reads the same as one still waiting.
              // Telling someone they were turned down invites a second
              // attempt, which is the thing declining is meant to stop.
              <p className="mt-2 text-xs font-semibold text-amber-700">A request is already pending.</p>
            ) : (
              <button
                onClick={async () => {
                  setError(null);
                  const res = await sendFriendRequest(found.user_id);
                  if (!res.ok) return setError(res.error);
                  setFound(null);
                  setQuery("");
                  onChanged();
                }}
                className="mt-2 w-full rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-grass-500"
              >
                Send request
              </button>
            )}
          </div>
        )}
        {outgoing.length > 0 && (
          <div className="mt-4 border-t border-mud-200 pt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mud-400">Waiting for a reply</p>
            <ul className="space-y-1">
              {outgoing.map((r) => (
                <li key={r.friendship_id} className="flex items-center gap-2 text-xs text-mud-600">
                  <span className="min-w-0 flex-1 truncate">@{r.username}</span>
                  <button
                    onClick={async () => {
                      setError(null);
                      const res = await cancelRequest(r.friendship_id);
                      if (!res.ok) return setError(res.error);
                      onChanged();
                    }}
                    className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-mud-400 hover:bg-red-100 hover:text-red-700"
                  >
                    Unsend
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Encrypted thread                                                            */
/* ========================================================================== */

function Thread({
  friend,
  meId,
  myPublicKey,
  seenAt,
  inVillage,
  onBack,
  onSent,
  onRemove,
}: {
  friend: FriendSummary;
  meId: string;
  myPublicKey: string | null;
  /** When they last read something I sent. */
  seenAt: string | null;
  inVillage: boolean;
  onBack: () => void;
  onSent: () => void;
  onRemove: () => void;
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
  const [showInfo, setShowInfo] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  // Newest message the server has handed us. The poll asks for what follows it.
  const cursor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

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
            m.sender_id === meId ? { from: meId, to: friend.user_id } : { from: friend.user_id, to: meId }
          );
        } catch {
          text = "Could not decrypt this message.";
        }
        out.push({ id: m.id, mine: m.sender_id === meId, text, at: m.created_at });
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

        // This tab's key, or the account's from escrow — see message-key.ts.
        const priv = keyRef.current ?? (await getMessageKey());
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

  // Stay pinned to the newest message — unless you've scrolled up to read.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, state]);

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

  // The box grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  async function send() {
    const text = draft.trim();
    const priv = keyRef.current;
    if (!text || !priv || !pub || sending) return;

    setSending(true);
    setSendError(null);
    try {
      const sealed = await sealMessage(priv, pub, text, { from: meId, to: friend.user_id });
      const res = await sendMessage(friend.user_id, sealed.iv, sealed.body);
      if (!res.ok) return setSendError(res.error);
      // Not advancing the cursor: a message from them may have landed since the
      // last poll, and skipping past it would lose it. merge() drops the
      // duplicate when the poll hands this one back.
      pinned.current = true;
      setMessages((prev) => merge(prev, [{ id: res.message.id, mine: true, text, at: res.message.created_at }]));
      setDraft("");
      onSent();
    } catch (err) {
      // The draft is deliberately left in the box so nothing is lost.
      setSendError(err instanceof Error ? err.message : "That message did not send.");
    } finally {
      setSending(false);
      box.current?.focus();
    }
  }

  /* Bubbles in runs: the same person within five minutes is one group,
     with the time under its last bubble. A new day gets a divider. */
  const rows = useMemo(() => {
    const out: ({ kind: "day"; label: string; key: string } | { kind: "msg"; m: Shown; first: boolean; last: boolean })[] = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const d = new Date(m.at);
      if (!prev || !sameDay(new Date(prev.at), d)) out.push({ kind: "day", label: dayLabel(d), key: `d${m.id}` });
      const joins = (a?: Shown, b?: Shown) =>
        !!a && !!b && a.mine === b.mine && sameDay(new Date(a.at), new Date(b.at)) && Math.abs(new Date(b.at).getTime() - new Date(a.at).getTime()) < 5 * 60_000;
      out.push({ kind: "msg", m, first: !joins(prev, m), last: !joins(m, next) });
    });
    return out;
  }, [messages]);

  const lastMine = [...messages].reverse().find((m) => m.mine);
  const seen = !!lastMine && !!seenAt && seenAt >= lastMine.at;
  const p = progressFor(friend.xp);

  return (
    <>
      <header className="relative flex items-center gap-3 border-b border-mud-200 px-3 py-2.5">
        <button onClick={onBack} aria-label="Back to conversations" className="-ml-1 rounded-md px-1.5 text-2xl leading-none text-grass-700 lg:hidden">
          ‹
        </button>
        <button onClick={() => setShowInfo((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar appearance={friend.appearance} equipped={friend.equipped} size={38} online={inVillage} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-mud-900">{friend.display_name}</span>
            <span className="block truncate text-[11px] text-mud-500">
              {inVillage ? "In the village · " : ""}
              {statusLine(friend)}
            </span>
          </span>
        </button>
        <button
          onClick={() => setShowInfo((v) => !v)}
          aria-label="About this conversation"
          aria-expanded={showInfo}
          className="grid size-8 place-items-center rounded-full text-mud-500 hover:bg-mud-100 hover:text-mud-800"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </button>

        {showInfo && (
          <div className="panel absolute right-3 top-full z-20 mt-1 w-72 rounded-xl p-4 text-sm shadow-xl">
            <p className="font-semibold text-mud-900">{friend.display_name}</p>
            <p className="text-xs text-mud-500">
              @{friend.username} · Lv {p.level} {p.title}
            </p>
            <p className="mt-2 text-xs text-mud-600">
              {friend.completed} quest{friend.completed === 1 ? "" : "s"} completed · {friend.done_today} today
              {friend.streak ? ` · ${friend.streak}-day streak` : ""}
            </p>
            {friend.categories.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1">
                {friend.categories.map((c) => {
                  const col = colorOf(c.color);
                  return (
                    <li key={c.name} className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${col.soft} ${col.text} ring-1 ring-inset ${col.ring}`}>
                      {c.name} · {c.open}
                    </li>
                  );
                })}
              </ul>
            )}
            {fingerprint && (
              <div className="mt-3 border-t border-mud-200 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-mud-400">Verification code</p>
                <p className="mt-1 font-mono text-sm font-bold tracking-widest text-mud-900">{fingerprint}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-mud-500">
                  Read this aloud to {friend.display_name}. If their screen shows the same code, no one is in the middle.
                  It only changes if one of you resets your keys — or if this server hands out a key that isn&apos;t theirs,
                  which is the one attack the encryption cannot catch by itself.
                </p>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-mud-200 pt-3">
              <Link href="/village" className="rounded-lg px-2 py-1 text-xs font-semibold text-grass-700 hover:bg-grass-50">
                Visit their house
              </Link>
              <span className="flex-1" />
              {confirmRemove ? (
                <>
                  <button onClick={onRemove} className="rounded-lg bg-red-600 px-2 py-1 text-xs font-bold text-white">
                    Remove
                  </button>
                  <button onClick={() => setConfirmRemove(false)} className="rounded-lg px-2 py-1 text-xs text-mud-500">
                    No
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmRemove(true)}
                  className="rounded-lg px-2 py-1 text-xs text-mud-400 hover:bg-red-50 hover:text-red-700"
                  title="Removing a companion deletes this conversation for both of you"
                >
                  Remove companion
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-mud-50/60 px-3 py-3 sm:px-5"
      >
        {state === "loading" && <p className="py-6 text-center text-xs text-mud-400">Decrypting…</p>}
        {state === "locked" && (
          <p className="mx-auto max-w-sm rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
            Your message key isn&apos;t available on this device yet. Sign out and back in with your password to unlock
            messages — after that, they follow your account everywhere.
          </p>
        )}
        {state === "nokey" && (
          <p className="mx-auto max-w-sm rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
            {friend.display_name} hasn&apos;t set up encryption keys yet. Once they sign in again, you can message them.
          </p>
        )}
        {state === "ready" && messages.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Avatar appearance={friend.appearance} equipped={friend.equipped} size={72} />
              <p className="mt-2 text-sm font-semibold text-mud-800">{friend.display_name}</p>
              <p className="text-xs text-mud-500">No messages yet. Say hello — it&apos;s end-to-end encrypted.</p>
            </div>
          </div>
        )}

        {rows.map((r) =>
          r.kind === "day" ? (
            <p key={r.key} className="my-3 text-center text-[11px] font-semibold text-mud-400">
              {r.label}
            </p>
          ) : (
            <div key={r.m.id} className={`flex ${r.m.mine ? "justify-end" : "justify-start"} ${r.first ? "mt-2" : "mt-0.5"}`}>
              <div className={`flex max-w-[78%] flex-col ${r.m.mine ? "items-end" : "items-start"}`}>
                <p
                  className={`whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-snug ${
                    r.m.mine ? "bg-grass-600 text-white" : "bg-white text-mud-900 ring-1 ring-mud-200"
                  } ${
                    r.m.mine
                      ? `rounded-l-2xl ${r.first ? "rounded-tr-2xl" : "rounded-tr-md"} ${r.last ? "rounded-br-2xl" : "rounded-br-md"}`
                      : `rounded-r-2xl ${r.first ? "rounded-tl-2xl" : "rounded-tl-md"} ${r.last ? "rounded-bl-2xl" : "rounded-bl-md"}`
                  }`}
                >
                  {r.m.text}
                </p>
                {r.last && (
                  <span className="mt-0.5 px-1 text-[10px] text-mud-400">
                    {clockTime(r.m.at)}
                    {r.m.mine && r.m.id === lastMine?.id && seen ? " · Seen" : ""}
                  </span>
                )}
              </div>
            </div>
          )
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="border-t border-mud-200 px-3 py-2.5"
      >
        {sendError && (
          <p className="mb-2 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800">
            {sendError} Your words are still in the box — try again.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line. Not mid-composition
              // (typing Japanese, say), where Enter picks a character.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={state === "ready" ? `Message ${friend.display_name}` : "Locked"}
            disabled={state !== "ready"}
            maxLength={2000}
            aria-label={`Message ${friend.display_name}`}
            className="max-h-[140px] min-h-[40px] min-w-0 flex-1 resize-none rounded-2xl bg-mud-100 px-4 py-2 text-[15px] leading-snug text-mud-900 outline-none placeholder:text-mud-400 focus:ring-2 focus:ring-grass-400 disabled:opacity-50"
          />
          <button
            disabled={state !== "ready" || !draft.trim() || sending}
            aria-label="Send"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-grass-600 text-white transition hover:bg-grass-500 disabled:bg-mud-300"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" />
            </svg>
          </button>
        </div>
      </form>
    </>
  );
}
