"use client";

import { useState } from "react";
import Link from "next/link";
import { submitFeedback, type FeedbackNote } from "@/lib/feedback-actions";
import { formatStamp } from "@/lib/date";

const MAX = 4000;

export default function FeedbackForm({
  notes,
  isOwner,
}: {
  /** Only populated for the owner; everyone else gets an empty list. */
  notes: FeedbackNote[];
  isOwner: boolean;
}) {
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await submitFeedback(body, anonymous);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setBody("");
    setSent(true);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
            Feedback
          </h1>
          <p className="text-xs font-semibold text-mud-600">
            Tell me what&apos;s broken, missing, or annoying.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
        >
          ← Back to quests
        </Link>
      </header>

      <section className="panel rounded-2xl p-5">
        {sent ? (
          <div className="py-4 text-center">
            <p className="font-display text-lg font-bold text-grass-700">
              Sent — thank you.
            </p>
            <p className="mt-1 text-sm text-mud-600">
              {anonymous
                ? "Sent without your name attached."
                : "Sent with your name attached."}
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-4 rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
            >
              Write another
            </button>
          </div>
        ) : (
          <form onSubmit={send}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              maxLength={MAX}
              autoFocus
              placeholder="A bug, an idea, something that felt wrong…"
              className="field w-full resize-y rounded-xl px-3.5 py-3 text-sm leading-relaxed"
            />
            <div className="mt-1 flex justify-end">
              <span className="text-[10px] text-mud-400">
                {body.length}/{MAX}
              </span>
            </div>

            <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-mud-200 bg-white/70 p-3">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-grass-600"
              />
              <span className="text-sm text-mud-800">
                <span className="font-semibold">Send anonymously.</span>{" "}
                <span className="text-mud-600">
                  Your name isn&apos;t stored alongside it — not hidden, not
                  stored. The time is recorded only to the hour, so a precise
                  timestamp can&apos;t point back at you either.
                </span>
              </span>
            </label>

            {error && (
              <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !body.trim()}
              className="mt-4 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.98] disabled:bg-mud-300 disabled:shadow-none"
            >
              {busy ? "Sending…" : anonymous ? "Send anonymously" : "Send"}
            </button>
          </form>
        )}
      </section>

      {isOwner && (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-sm font-bold tracking-wide text-mud-800 drop-shadow-sm">
            Inbox ({notes.length})
          </h2>

          {notes.length === 0 ? (
            <div className="panel rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-mud-500">Nothing yet.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="panel rounded-2xl p-4">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <p className="text-xs font-bold text-mud-700">
                      {n.from ? (
                        <>
                          {n.from.display_name}{" "}
                          <span className="font-normal text-mud-400">
                            @{n.from.username}
                          </span>
                        </>
                      ) : (
                        <span className="text-mud-400">Anonymous</span>
                      )}
                    </p>
                    <p className="shrink-0 text-[10px] text-mud-400">
                      {formatStamp(n.created_at)}
                    </p>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-mud-800">
                    {n.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
